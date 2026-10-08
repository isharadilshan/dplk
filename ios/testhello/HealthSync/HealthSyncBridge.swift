import Foundation

/// Swift facade that the ObjC++ Turbo Module (RCTNativeHealthSync.mm) calls.
///
/// Why the extra layer? Turbo Modules on iOS are ObjC++ (they talk to C++
/// JSI), and ObjC++ can't call pure Swift APIs like async/await or structs
/// directly. This class exposes everything through simple @objc methods with
/// completion blocks.
///
/// `applicationDidFinishLaunching()` is also called by AppDelegate on EVERY
/// launch, including background launches started by HealthKit, a BGTask or a
/// WatchConnectivity transfer, where the JS/React Native side may never start.
@objc(HealthSyncBridge)
public final class HealthSyncBridge: NSObject {
  @objc public static let shared = HealthSyncBridge()

  /// Set by the Turbo Module to forward log entries to JS as events.
  @objc public var eventListener: (([String: Any]) -> Void)? {
    didSet { HealthActivityLog.shared.listener = eventListener }
  }

  /// Order matters, and everything here must finish before
  /// didFinishLaunching returns, or iOS will not route background wakes to us.
  @objc public func applicationDidFinishLaunching() {
    HealthActivityLog.shared.startTrackingAppState()
    BackgroundTaskScheduler.shared.registerHandlers()   // BGTask handlers
    HealthKitBackgroundDelivery.shared.restoreOnLaunch() // HealthKit observer queries
    WatchSessionManager.shared.activate()                // WCSession delegate
  }

  @objc public func requestHealthPermissions(_ completion: @escaping (Bool, String?) -> Void) {
    guard HealthKitBackgroundDelivery.shared.isAvailable else {
      return completion(false, "HealthKit is not available on this device.")
    }
    Task {
      do {
        try await HealthKitBackgroundDelivery.shared.requestAuthorization()
        completion(true, nil)
      } catch {
        completion(false, error.localizedDescription)
      }
    }
  }

  @objc public func schedulePeriodicSync(_ intervalMinutes: Double) {
    BackgroundTaskScheduler.shared.schedule(intervalMinutes: intervalMinutes)
  }

  /// A BGTask can't be forced to run, so "Sync now" runs the same routine in
  /// the foreground.
  @objc public func runSyncNow(_ completion: @escaping () -> Void) {
    Task {
      await HealthSyncEngine.shared.runSync(trigger: "Sync now (foreground)", uploadLimit: .max)
      completion()
    }
  }

  @objc public func cancelScheduledWork() {
    BackgroundTaskScheduler.shared.cancelAll()
    HealthKitBackgroundDelivery.shared.disableBackgroundDelivery()
  }

  @objc public func enableBackgroundDelivery(_ completion: @escaping (Bool, String?) -> Void) {
    Task {
      do {
        try await HealthKitBackgroundDelivery.shared.enableBackgroundDelivery()
        completion(true, nil)
      } catch {
        // Most common cause: the HealthKit background-delivery entitlement is missing.
        HealthActivityLog.shared.record("error", "HealthKit", "Background delivery failed: \(error.localizedDescription)")
        completion(false, error.localizedDescription)
      }
    }
  }

  @objc public func startLiveSession(_ completion: @escaping (Bool, String?) -> Void) {
    Task {
      do {
        try await HealthKitBackgroundDelivery.shared.startWatchWorkout()
        completion(true, nil)
      } catch {
        // Expected without a paired watch running our watchOS app.
        HealthActivityLog.shared.record("error", "HKWorkoutSession", "Could not start watch session: \(error.localizedDescription)")
        completion(false, error.localizedDescription)
      }
    }
  }

  @objc public func stopLiveSession() {
    // There's no phone-side API to end a watch workout. We ask the watch app,
    // which calls HKWorkoutSession.end() itself.
    WatchSessionManager.shared.send(command: "stopWorkout")
  }

  @objc public func wearableStatus() -> [String: Any] { WatchSessionManager.shared.status }

  @objc public func simulateWearableSample(_ bpm: Double) {
    WatchSessionManager.shared.handleIncoming(
      ["type": "heart_rate", "bpm": bpm, "timestamp": Date().timeIntervalSince1970],
      via: "sendMessage (simulated)")
  }

  @objc public func pendingSampleCount() -> Int { HealthLocalStore.shared.pendingCount }

  @objc public func activityLog() -> [[String: Any]] { HealthActivityLog.shared.entries() }

  @objc public func clearActivityLog() { HealthActivityLog.shared.clear() }
}
