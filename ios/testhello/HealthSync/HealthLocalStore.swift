import Foundation
import UIKit
import os

/// One health measurement, whatever collected it (HealthKit or the Apple Watch).
struct HealthSample: Codable {
  let type: String       // "heart_rate" | "steps"
  let value: Double
  let unit: String       // "bpm" | "count"
  let startTime: Date
  let endTime: Date
  let source: String     // "healthkit" | "apple-watch"
}

/// On-device "outbox" for samples waiting to be uploaded, plus sync state.
///
/// Collection and upload are separate steps on purpose:
///  - HealthKit may wake us for 1-2 seconds of work. That's enough to save
///    samples locally, but not always enough for a network request.
///  - Uploads are batched into BGTasks, where iOS gives us more time.
///
/// For the demo this is a JSON file. Production apps should use a database
/// with Data Protection (`.completeUntilFirstUserAuthentication`) because this
/// is health data. Note: if the phone was never unlocked since boot, protected
/// files can't be read, and a background wake must handle that case.
final class HealthLocalStore {
  static let shared = HealthLocalStore()

  // HealthKit callbacks, WCSession delegate and BGTasks run on different
  // threads. A serial queue serializes every read-modify-write.
  private let queue = DispatchQueue(label: "health.local.store")
  private let fileURL: URL = {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("pending_health_samples.json")
  }()

  func add(_ samples: [HealthSample]) {
    guard !samples.isEmpty else { return }
    queue.sync {
      var all = load()
      all.append(contentsOf: samples)
      save(all)
    }
  }

  var pendingCount: Int { queue.sync { load().count } }

  /// Oldest samples first. They're only removed after a confirmed upload.
  func peekBatch(max: Int) -> [HealthSample] { queue.sync { Array(load().prefix(max)) } }

  func removeFirst(_ count: Int) {
    queue.sync {
      var all = load()
      all.removeFirst(min(count, all.count))
      save(all)
    }
  }

  private func load() -> [HealthSample] {
    guard let data = try? Data(contentsOf: fileURL) else { return [] }
    return (try? JSONDecoder().decode([HealthSample].self, from: data)) ?? []
  }

  private func save(_ samples: [HealthSample]) {
    guard let data = try? JSONEncoder().encode(samples) else { return }
    try? data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
}

/// Persistent log of everything the background system does.
///
/// Background work is hard to observe: iOS may run a BGTask at 4 AM, or
/// HealthKit may wake the app for 2 seconds. Every component writes here, so
/// the demo screen can later show what ran and whether the app was in the
/// background. When JS is running, `listener` forwards each entry live.
final class HealthActivityLog {
  static let shared = HealthActivityLog()

  /// Set by the Turbo Module while the JS runtime is alive.
  var listener: (([String: Any]) -> Void)?

  private let defaultsKey = "health_activity_log"
  private let maxEntries = 200
  private let queue = DispatchQueue(label: "health.activity.log")
  private let logger = Logger(subsystem: "com.testhello", category: "HealthSync")

  /// UIApplication.applicationState is main-thread only, but we log from
  /// background threads, so the state is kept here, updated by notifications.
  private var isForeground = false

  /// Called once at launch, on the main thread.
  func startTrackingAppState() {
    isForeground = UIApplication.shared.applicationState == .active
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.isForeground = true
    }
    center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.isForeground = false
    }
  }

  func record(_ kind: String, _ source: String, _ message: String) {
    let entry: [String: Any] = [
      "kind": kind,
      "source": source,
      "message": message,
      "timestamp": Date().timeIntervalSince1970 * 1000,
      "appState": isForeground ? "foreground" : "background",
    ]
    // Shows in Console.app. Filter by subsystem "com.testhello" to watch
    // background wakes live, even when Xcode isn't attached.
    logger.info("[\(kind)/\(source)] \(message)")

    queue.sync {
      var entries = UserDefaults.standard.array(forKey: defaultsKey) as? [[String: Any]] ?? []
      entries.insert(entry, at: 0) // Newest first.
      UserDefaults.standard.set(Array(entries.prefix(maxEntries)), forKey: defaultsKey)
    }
    listener?(entry)
  }

  func entries() -> [[String: Any]] {
    queue.sync { UserDefaults.standard.array(forKey: defaultsKey) as? [[String: Any]] ?? [] }
  }

  func clear() {
    queue.sync { UserDefaults.standard.removeObject(forKey: defaultsKey) }
  }
}
