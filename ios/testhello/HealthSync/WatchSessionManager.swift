import Foundation
import WatchConnectivity

/// Phone side of WatchConnectivity (WCSession), the link between this iPhone
/// app and its Apple Watch companion app. It's the iOS counterpart of
/// Android's Wearable Data Layer.
///
/// WCSession has several channels with very different delivery guarantees:
///
/// | API                       | Delivery                               | We use it for                 |
/// |---------------------------|----------------------------------------|-------------------------------|
/// | sendMessage               | Live, only if `isReachable`            | Heart rate during a workout   |
/// | transferUserInfo          | Queued, guaranteed, in order, wakes us | Spot readings, symptom logs   |
/// | updateApplicationContext  | Latest value only (overwrites)         | Today's step total            |
/// | transferFile              | Queued file transfer                   | Raw ECG / accelerometer dumps |
///
/// `isReachable` on the phone is usually true only while the watch app is in
/// the foreground or running an HKWorkoutSession. That's why live streaming
/// happens during a workout session (HealthKitBackgroundDelivery.startWatchWorkout).
///
/// The session must be activated early in every launch: iOS may launch the
/// app in the background only to deliver queued userInfo, and the delegate
/// has to exist to receive it.
final class WatchSessionManager: NSObject, WCSessionDelegate {
  static let shared = WatchSessionManager()

  private let highHeartRate = 120.0

  private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

  func activate() {
    guard let session else { return } // Not supported on iPad.
    session.delegate = self
    session.activate()
  }

  var status: [String: Any] {
    guard let session, session.activationState == .activated else {
      return ["supported": WCSession.isSupported(), "paired": false, "appInstalled": false, "reachable": false]
    }
    return [
      "supported": true,
      "paired": session.isPaired,
      "appInstalled": session.isWatchAppInstalled,
      "reachable": session.isReachable,
    ]
  }

  /// Sends a command to the watch app. Live if reachable, otherwise queued
  /// via transferUserInfo, so the watch gets it next time it can.
  func send(command: String) {
    guard let session, session.activationState == .activated, session.isWatchAppInstalled else { return }
    let payload: [String: Any] = ["command": command, "sentAt": Date().timeIntervalSince1970]
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil) { error in
        HealthActivityLog.shared.record("error", "WCSession", "sendMessage failed: \(error.localizedDescription)")
      }
    } else {
      session.transferUserInfo(payload)
    }
    HealthActivityLog.shared.record("wearable", "WCSession", "Sent '\(command)' to watch (\(session.isReachable ? "live" : "queued")).")
  }

  // MARK: - Receiving (delegate methods run on a background queue)

  /// Live message, e.g. a heart-rate reading streamed during a workout.
  /// Watch side: WCSession.default.sendMessage(["type": "heart_rate", "bpm": 82, "timestamp": ...], replyHandler: nil)
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handleIncoming(message, via: "sendMessage")
  }

  /// Queued, guaranteed delivery. iOS can launch the app in the background
  /// to deliver this, which is background data collection with no scheduler.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handleIncoming(userInfo, via: "transferUserInfo")
  }

  /// "Latest state" channel. Only the newest context is kept, so it's good
  /// for totals (today's steps) and bad for individual readings.
  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    if let steps = applicationContext["dailySteps"] as? Double {
      let startOfDay = Calendar.current.startOfDay(for: Date())
      HealthLocalStore.shared.add([
        HealthSample(type: "steps", value: steps, unit: "count", startTime: startOfDay, endTime: Date(), source: "apple-watch"),
      ])
      HealthActivityLog.shared.record("wearable", "applicationContext", "Watch synced today's steps: \(Int(steps))")
    }
  }

  /// Shared by real messages and the demo's "simulate" button.
  func handleIncoming(_ payload: [String: Any], via: String) {
    guard payload["type"] as? String == "heart_rate", let bpm = payload["bpm"] as? Double else { return }
    let time = (payload["timestamp"] as? Double).map { Date(timeIntervalSince1970: $0) } ?? Date()
    HealthLocalStore.shared.add([
      HealthSample(type: "heart_rate", value: bpm, unit: "bpm", startTime: time, endTime: time, source: "apple-watch"),
    ])
    let flag = bpm >= highHeartRate ? " ⚠️ above \(Int(highHeartRate)) bpm" : ""
    HealthActivityLog.shared.record("wearable", via, "Heart rate from watch: \(Int(bpm)) bpm\(flag)")
    // No upload here. The next BGTask or "Sync now" sends the outbox, which
    // keeps radio usage low during a long workout stream.
  }

  // MARK: - Session lifecycle

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if let error {
      HealthActivityLog.shared.record("error", "WCSession", "Activation failed: \(error.localizedDescription)")
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    HealthActivityLog.shared.record("wearable", "WCSession", "Watch is now \(session.isReachable ? "reachable" : "unreachable").")
  }

  // The next two are iOS-only and handle switching between several paired
  // watches. Apple's guidance: when a session deactivates, activate again,
  // so the newly selected watch gets connected.
  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}
