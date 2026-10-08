import BackgroundTasks
import Foundation
import UIKit

/// iOS background scheduling with the BackgroundTasks framework. This is the
/// closest thing to Android's WorkManager, with one big difference: iOS
/// decides when (and whether) a task runs. You can request, never demand.
///
/// Two task types:
///  - BGAppRefreshTask: short (~30 s) and fairly frequent. iOS learns when the
///    user usually opens the app and runs it just before. We use it for a
///    quick HealthKit catch-up plus a small upload.
///  - BGProcessingTask: long (minutes), usually at night while charging. Can
///    require a network and/or power. We use it to upload the whole outbox.
///
/// Rules that trip people up:
///  1. Every identifier must be listed in Info.plist under
///     BGTaskSchedulerPermittedIdentifiers, or `submit` throws.
///  2. Handlers must be registered before didFinishLaunching returns.
///  3. A request is used once. The handler must submit the next request
///     itself, or the chain stops.
///  4. Each handler must call setTaskCompleted, and must stop work in
///     expirationHandler. iOS remembers apps that overrun and runs them less.
///  5. No runs if the user turned off Background App Refresh, in Low Power
///     Mode, or after the user force-quits the app from the app switcher.
///
/// Debug: these never fire on their own while you watch. Pause in Xcode
/// (with the app in the background) and run in LLDB:
///   e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.testhello.health.refresh"]
final class BackgroundTaskScheduler {
  static let shared = BackgroundTaskScheduler()

  static let refreshTaskId = "com.testhello.health.refresh"
  static let processingTaskId = "com.testhello.health.upload"

  private let enabledKey = "bg_tasks_enabled"
  private let intervalKey = "bg_refresh_interval_minutes"

  /// Step 1 (at launch): tell iOS which code handles each identifier.
  func registerHandlers() {
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskId, using: nil) { task in
      self.handleRefresh(task as! BGAppRefreshTask)
    }
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingTaskId, using: nil) { task in
      self.handleProcessing(task as! BGProcessingTask)
    }

    // Common pattern: (re)submit requests when the app goes to the
    // background, so a request is always pending.
    NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self, UserDefaults.standard.bool(forKey: self.enabledKey) else { return }
      self.submitRefresh()
      self.submitProcessing()
    }
  }

  /// Step 2: ask iOS to run our tasks.
  func schedule(intervalMinutes: Double) {
    UserDefaults.standard.set(true, forKey: enabledKey)
    UserDefaults.standard.set(max(intervalMinutes, 15), forKey: intervalKey)
    submitRefresh()
    submitProcessing()
  }

  func cancelAll() {
    UserDefaults.standard.set(false, forKey: enabledKey)
    BGTaskScheduler.shared.cancelAllTaskRequests()
    HealthActivityLog.shared.record("scheduler", "BGTaskScheduler", "All background task requests cancelled.")
  }

  private func submitRefresh() {
    let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
    // "Not earlier than", NOT "at". iOS often runs it much later.
    let minutes = UserDefaults.standard.double(forKey: intervalKey)
    request.earliestBeginDate = Date(timeIntervalSinceNow: max(minutes, 15) * 60)
    submit(request, label: "BGAppRefreshTask (earliest in \(Int(max(minutes, 15))) min)")
  }

  private func submitProcessing() {
    let request = BGProcessingTaskRequest(identifier: Self.processingTaskId)
    // Constraints, like WorkManager's: only with network, and only while
    // charging, so a big upload never drains the patient's battery.
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = true
    request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
    submit(request, label: "BGProcessingTask (network + charging)")
  }

  private func submit(_ request: BGTaskRequest, label: String) {
    do {
      // Submitting an identifier that's already pending replaces the old
      // request, so there are no duplicates (like WorkManager's unique work).
      try BGTaskScheduler.shared.submit(request)
      HealthActivityLog.shared.record("scheduler", "BGTaskScheduler", "Submitted \(label).")
    } catch {
      // Common: BGTaskSchedulerErrorCodeUnavailable on the Simulator, or when
      // Background App Refresh is off.
      HealthActivityLog.shared.record("error", "BGTaskScheduler", "Submit failed for \(label): \(error.localizedDescription)")
    }
  }

  // MARK: - Handlers (iOS calls these on a background queue)

  private func handleRefresh(_ task: BGAppRefreshTask) {
    HealthActivityLog.shared.record("scheduler", "BGAppRefreshTask", "Started by iOS.")
    // Rule 3: queue the next run first, so the chain continues even if this
    // run is cut short.
    submitRefresh()

    let work = Task {
      await HealthSyncEngine.shared.runSync(trigger: "BGAppRefreshTask", uploadLimit: 200)
    }
    // Rule 4: iOS calls this when our time is up. Cancel and report back.
    task.expirationHandler = {
      work.cancel()
      HealthActivityLog.shared.record("scheduler", "BGAppRefreshTask", "Expired. iOS ended our time window.")
    }
    Task {
      await work.value
      task.setTaskCompleted(success: !work.isCancelled)
    }
  }

  private func handleProcessing(_ task: BGProcessingTask) {
    HealthActivityLog.shared.record("scheduler", "BGProcessingTask", "Started by iOS (on power + network).")
    submitProcessing()

    let work = Task {
      await HealthSyncEngine.shared.runSync(trigger: "BGProcessingTask", uploadLimit: .max)
    }
    task.expirationHandler = {
      work.cancel()
      HealthActivityLog.shared.record("scheduler", "BGProcessingTask", "Expired before finishing. Will resume next time.")
    }
    Task {
      await work.value
      task.setTaskCompleted(success: !work.isCancelled)
    }
  }
}

/// The actual sync routine, shared by every trigger: BGTasks, the "Sync now"
/// button and HealthKit wakes. Schedulers only decide WHEN this runs.
final class HealthSyncEngine {
  static let shared = HealthSyncEngine()
  private let batchSize = 100

  func runSync(trigger: String, uploadLimit: Int) async {
    // 1) Catch up on HealthKit, in case a background delivery was missed.
    if HealthKitBackgroundDelivery.shared.isAvailable {
      do {
        let count = try await HealthKitBackgroundDelivery.shared.fetchAllNewSamples()
        HealthActivityLog.shared.record("health-store", "HealthKit", "\(trigger): catch-up read \(count) sample(s).")
      } catch {
        HealthActivityLog.shared.record("error", "HealthKit", "\(trigger): read failed: \(error.localizedDescription)")
      }
    }

    // 2) Upload the outbox in batches, stopping as soon as we're cancelled.
    var uploaded = 0
    while uploaded < uploadLimit, !Task.isCancelled {
      let batch = HealthLocalStore.shared.peekBatch(max: min(batchSize, uploadLimit - uploaded))
      if batch.isEmpty { break }
      do {
        try await FakeHealthApi.uploadVitals(batch)
        // Only remove after the server confirmed. A cancelled or failed
        // batch stays queued for next time.
        HealthLocalStore.shared.removeFirst(batch.count)
        uploaded += batch.count
      } catch {
        HealthActivityLog.shared.record("error", "Upload", "\(trigger): upload failed: \(error.localizedDescription)")
        break
      }
    }

    HealthActivityLog.shared.record(
      "upload", trigger,
      "Uploaded \(uploaded) sample(s); \(HealthLocalStore.shared.pendingCount) still pending\(Task.isCancelled ? " (cancelled)" : "").")
  }
}

/// Stand-in for the real backend client (HTTPS POST /v1/vitals/batch with the
/// patient's token). In production use a background URLSession for large
/// uploads: it keeps transferring even after the app is suspended.
enum FakeHealthApi {
  static func uploadVitals(_ batch: [HealthSample]) async throws {
    try await Task.sleep(nanoseconds: 500_000_000) // Pretend network latency.
  }
}
