import Foundation
import HealthKit

/// Reads heart rate and steps from HealthKit, and asks iOS to WAKE the app
/// when new samples are saved, using "background delivery".
///
/// How background delivery works:
///  1. `enableBackgroundDelivery(for:frequency:)` tells HealthKit we want to
///     know about new samples of a type, even while the app isn't running.
///  2. An `HKObserverQuery` per type is the callback HealthKit calls. When a
///     sample is saved (e.g. the Apple Watch records heart rate), iOS launches
///     the app in the background and the observer query fires.
///  3. The observer only says "something changed". We then run an
///     `HKAnchoredObjectQuery`, which returns only samples added since our
///     saved anchor (bookmark).
///  4. We MUST call the observer's completion handler when done. If we don't,
///     HealthKit assumes we failed and retries with backoff. After 3 misses it
///     stops waking us.
///
/// Requirements:
///  - Entitlements: com.apple.developer.healthkit + ...healthkit.background-delivery
///  - Observer queries must be started again on EVERY launch, early, in
///    application(_:didFinishLaunchingWithOptions:). When iOS wakes the app
///    for delivery, the query has to exist before launch finishes.
///  - `frequency` is a request, not a promise. Many types (stepCount) are
///    capped at `.hourly` no matter what you ask for, and wakes are skipped
///    when the phone is locked (HealthKit data is encrypted while locked).
final class HealthKitBackgroundDelivery {
  static let shared = HealthKitBackgroundDelivery()

  private let store = HKHealthStore()
  private let heartRate = HKQuantityType(.heartRate)
  private let steps = HKQuantityType(.stepCount)
  private var readTypes: Set<HKObjectType> { [heartRate, steps] }
  private var observersStarted = false

  private let enabledKey = "healthkit_background_delivery_enabled"

  var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() } // false on iPad and Mac

  /// Shows the HealthKit permission sheet.
  ///
  /// Privacy detail: for READ permissions, iOS never tells the app whether
  /// the user said yes or no. A denied type just looks like "no data". The
  /// `success` flag only means the sheet was shown without an error.
  func requestAuthorization() async throws {
    try await store.requestAuthorization(toShare: [], read: readTypes)
    HealthActivityLog.shared.record("health-store", "HealthKit", "Authorization sheet completed.")
  }

  /// Turns on background delivery and starts the observer queries.
  func enableBackgroundDelivery() async throws {
    // .immediate for heart rate (iOS may still throttle it). Steps are capped
    // at hourly by the system, so asking for more is pointless.
    try await store.enableBackgroundDelivery(for: heartRate, frequency: .immediate)
    try await store.enableBackgroundDelivery(for: steps, frequency: .hourly)
    UserDefaults.standard.set(true, forKey: enabledKey)
    startObserverQueries()
    HealthActivityLog.shared.record(
      "health-store", "HealthKit", "Background delivery on: heart rate (immediate), steps (hourly).")
  }

  func disableBackgroundDelivery() {
    store.disableAllBackgroundDelivery { _, _ in }
    UserDefaults.standard.set(false, forKey: enabledKey)
  }

  /// Called from AppDelegate on every launch, including background launches
  /// triggered by HealthKit itself.
  func restoreOnLaunch() {
    guard isAvailable, UserDefaults.standard.bool(forKey: enabledKey) else { return }
    startObserverQueries()
  }

  private func startObserverQueries() {
    guard !observersStarted else { return }
    observersStarted = true

    for type in [heartRate, steps] {
      let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completionHandler, error in
        guard let self else { return completionHandler() }
        if let error {
          HealthActivityLog.shared.record("error", "HealthKit", "Observer error: \(error.localizedDescription)")
          return completionHandler()
        }

        // We may have only a few seconds before iOS suspends us again. Save
        // locally now, and leave the upload to a BGTask.
        Task {
          let count = (try? await self.fetchNewSamples(for: type)) ?? 0
          HealthActivityLog.shared.record(
            "health-store", "HealthKit",
            "Woken by background delivery (\(type.identifier.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: ""))): \(count) new sample(s).")
          // Tell HealthKit we're done, which keeps future deliveries coming.
          completionHandler()
        }
      }
      store.execute(query)
    }
  }

  /// Catch-up read of both types. The BGAppRefreshTask calls it in case a
  /// background delivery was missed (e.g. the phone was locked at the time).
  func fetchAllNewSamples() async throws -> Int {
    let hr = try await fetchNewSamples(for: heartRate)
    let st = try await fetchNewSamples(for: steps)
    return hr + st
  }

  /// Returns only samples added since the last call, using a saved HKQueryAnchor.
  /// This is the iOS counterpart of Health Connect's changes token on Android.
  private func fetchNewSamples(for type: HKQuantityType) async throws -> Int {
    let anchorKey = "healthkit_anchor_\(type.identifier)"
    let savedAnchor = UserDefaults.standard.data(forKey: anchorKey).flatMap {
      try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0)
    }

    // First run (no anchor): only fetch the last 24 h instead of all history.
    let predicate = savedAnchor == nil
      ? HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-86_400), end: nil)
      : nil

    let (samples, newAnchor): ([HKQuantitySample], HKQueryAnchor?) = try await withCheckedThrowingContinuation { continuation in
      let query = HKAnchoredObjectQuery(
        type: type, predicate: predicate, anchor: savedAnchor, limit: HKObjectQueryNoLimit
      ) { _, added, _, anchor, error in
        if let error { return continuation.resume(throwing: error) }
        continuation.resume(returning: ((added as? [HKQuantitySample]) ?? [], anchor))
      }
      store.execute(query)
    }

    let isHeartRate = type == heartRate
    let unit = isHeartRate ? HKUnit.count().unitDivided(by: .minute()) : HKUnit.count()
    HealthLocalStore.shared.add(samples.map {
      HealthSample(
        type: isHeartRate ? "heart_rate" : "steps",
        value: $0.quantity.doubleValue(for: unit),
        unit: isHeartRate ? "bpm" : "count",
        startTime: $0.startDate,
        endTime: $0.endDate,
        source: "healthkit")
    })

    // Save the anchor only AFTER the samples are stored, so a crash in between
    // means re-reading, never losing data.
    if let newAnchor, let data = try? NSKeyedArchiver.archivedData(withRootObject: newAnchor, requiringSecureCoding: true) {
      UserDefaults.standard.set(data, forKey: anchorKey)
    }
    return samples.count
  }

  // MARK: - Live session on the Apple Watch

  /// Launches our watchOS app in the background and hands it a workout
  /// configuration. On the watch, `WKApplicationDelegate.handle(_:)` receives
  /// it and starts an `HKWorkoutSession`. While that session runs, watchOS
  /// keeps the heart-rate sensor on at a high rate and keeps the watch app
  /// running, then streams readings back via WCSession (WatchSessionManager).
  ///
  /// Why on the watch? iOS gives no "keep my app running to collect data"
  /// mode like Android's foreground service. Continuous collection belongs
  /// on the watch, inside a workout session.
  func startWatchWorkout() async throws {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .walking
    configuration.locationType = .outdoor
    try await store.startWatchApp(toHandle: configuration)
    HealthActivityLog.shared.record("session", "HKWorkoutSession", "Asked Apple Watch to start a workout session.")
  }
}
