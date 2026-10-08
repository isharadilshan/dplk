# Background health data collection & schedulers

How this app collects health data while it isn't on screen, and how to see each mechanism working.

## The mental model

Every background mechanism answers one question: **who wakes the app up?**

| Who wakes us | Android | iOS | Used here for |
|---|---|---|---|
| **A scheduler** (time + conditions) | WorkManager | BGTaskScheduler | Periodic sync, batched upload |
| **The health store** (new data saved) | ❌ none, so poll it | HealthKit background delivery | New heart-rate / step samples |
| **The wearable** (message arrives) | `WearableListenerService` (Data Layer) | `WCSession` delegate | Watch readings |
| **Nobody: stay awake** (continuous) | Foreground service `type=health` | `HKWorkoutSession` *on the watch* | Live session (rehab walk) |

All of them write into **one local outbox**, and **only uploads** touch the network:

```
 Health Connect ──(WorkManager poll)──┐
 HealthKit ─────(background delivery)─┤
 Wear OS / Apple Watch ──(Data Layer / WCSession)──┼──▶ Local outbox ──▶ Upload job ──▶ Backend
 Step sensor ──(foreground service)───┘          (on-device)    (network constraint,
                                                                   retry + backoff)
```

Why split collection from upload? A wake can be very short (HealthKit gives a few seconds), and the network may be missing. Saving locally first means **nothing is lost**. Samples are removed from the outbox only after the server confirms them.

## Where the code lives

| Piece | Android (`android/app/src/main/java/com/testhello/healthsync/`) | iOS (`ios/testhello/HealthSync/`) |
|---|---|---|
| Scheduler | `HealthWorkScheduler.kt`, `HealthConnectSyncWorker.kt`, `UploadWorker.kt` | `BackgroundTaskScheduler.swift` (+ `HealthSyncEngine`) |
| Health store | `HealthConnectRepository.kt` (changes token) | `HealthKitBackgroundDelivery.swift` (anchor) |
| Wearable | `WearableDataListenerService.kt`, `WearableGateway.kt` | `WatchSessionManager.swift` |
| Live session | `LiveMonitoringService.kt` | `HealthKitBackgroundDelivery.startWatchWorkout()` |
| Outbox + log | `HealthLocalStore.kt`, `HealthActivityLog.kt` | `HealthLocalStore.swift` |
| JS bridge | `HealthSyncModule.kt` | `RCTNativeHealthSync.mm` → `HealthSyncBridge.swift` |
| Contract | `src/specs/NativeHealthSync.ts` (Turbo Module spec; codegen generates both native interfaces) | |

The JS side (`src/services/healthSync`, `src/screens/HealthSyncScreen.tsx`) is only a remote control. **None of the background code needs JS to be running.**

## Schedulers compared

| | WorkManager (Android) | BGTaskScheduler (iOS) |
|---|---|---|
| Minimum interval | 15 min (periodic) | `earliestBeginDate`: a lower bound, not a schedule |
| Who decides timing | You request; Doze/battery can delay | iOS decides entirely, based on app usage patterns |
| Constraints | Network, charging, battery not low, storage, idle | Processing tasks: network, external power |
| Run time | ~10 min per run | Refresh ~30 s; processing: minutes |
| Survives reboot | ✅ | ✅ (requests persist) |
| Survives force-stop / force-quit | ❌ (until next launch) | ❌ (until next launch) |
| Retries | `Result.retry()` + backoff policy | Handle it yourself (re-submit) |
| Chaining | `beginWith(a).then(b)` | Handle it yourself |
| De-duplication | Unique work + `ExistingWorkPolicy` | Same identifier replaces the pending request |

**When NOT to use a scheduler:**
- Exact time ("take pill at 8:00"): use a local notification / AlarmManager (see `src/services/notifications`).
- Continuous data (a workout): use a foreground service on Android, or a workout session on the watch.

## Health stores compared

| | Health Connect (Android) | HealthKit (iOS) |
|---|---|---|
| Push on new data | ❌ | ✅ `HKObserverQuery` + `enableBackgroundDelivery` |
| "Only what's new" | Changes token (`getChanges`) | `HKAnchoredObjectQuery` + `HKQueryAnchor` |
| Background read | Needs `READ_HEALTH_DATA_IN_BACKGROUND` (Android 15+) | Allowed, but **not while the phone is locked** (data is encrypted) |
| Read permission visible to app? | Yes | **No**: a denied read looks the same as "no data" |

## Testing each piece

The **Background Sync** tab has a button per mechanism, and an activity log where every entry is tagged `foreground` / **`BACKGROUND`**. Close the app, come back, and look for **BACKGROUND** entries.

Live native logs:
- Android: `adb logcat -s HealthSync`
- iOS: Console.app → filter subsystem `com.testhello`

### Android

```bash
# Ask WorkManager what it holds: every job, its state and its JobScheduler id
adb shell am broadcast -a androidx.work.diagnostics.REQUEST_DIAGNOSTICS -p com.testhello
adb logcat -s WM-DiagnosticsWrkr

# Force a job to run now. On Android 14+, WorkManager 2.10 puts its jobs in a
# JobScheduler *namespace*, so -n is required ("Could not find job" otherwise).
adb shell cmd jobscheduler run -f -n androidx.work.systemjobscheduler com.testhello <JOB_ID>

# Simulate Doze to check that work is deferred, then exit Doze
adb shell dumpsys deviceidle force-idle
adb shell dumpsys deviceidle unforce
```

**The easiest way to see a real background run (network constraint):**

```bash
adb shell svc wifi disable && adb shell svc data disable
# tap "Sync now": the read runs, the upload waits (ENQUEUED, needs network)
adb shell input keyevent KEYCODE_HOME          # app goes to the background
adb shell svc wifi enable && adb shell svc data enable
# a few seconds later UploadWorker runs, and the log shows it as BACKGROUND
```

**Gotchas we hit while testing on an emulator:**
- **Forcing a periodic job early does nothing.** WorkManager logs "being executed before schedule" and puts it back. Periodic work only runs when its interval is due. Use one-time work (Sync now / network test above) to observe a run.
- **`ExistingPeriodicWorkPolicy.UPDATE` never revives a finished job.** If the periodic worker once threw an uncaught exception, it's `FAILED` for good, and re-scheduling with UPDATE silently keeps it dead. `HealthWorkScheduler` detects this and uses `CANCEL_AND_REENQUEUE`.
- **Never let a side effect crash a worker.** Logging/forwarding to JS is wrapped in try/catch, so a UI-side bug can't fail background work.
- **Reinstalling or force-stopping the app clears its JobScheduler jobs** until the app launches again (WorkManager then re-registers them).

- **Health Connect:** add steps/heart rate in the Health Connect app (or Google Fit), then "Sync now". The first sync only sets a baseline, so new data shows up on the second one.
- **Live session:** start it, put the app in the background, walk. The notification updates and log entries arrive every minute.
- **Wearable:** without a watch, use "Simulate 78/135 bpm". It goes through the exact same code path as a real Data Layer message.

### iOS

BGTasks **never** fire on their own while you're watching. Force one from Xcode:

1. Run the app from Xcode, tap **Schedule periodic sync**, and send the app to the background.
2. Pause the debugger (⏸) and run in LLDB:
   ```
   e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.testhello.health.refresh"]
   ```
3. Resume (▶). The log shows `BGAppRefreshTask: Started by iOS` marked **BACKGROUND**.

To test expiration, use `_simulateExpirationForTaskWithIdentifier:` the same way.

- **HealthKit background delivery:** needs a **real device**. Tap *Connect Apple Health* → *Enable background delivery*, background the app, then add a heart-rate sample in the Health app. Within seconds the log shows "Woken by background delivery".
- **Watch:** without a watch, use the simulate buttons. With one, you need a watchOS companion app (not included) that answers `startWatchApp` with an `HKWorkoutSession` and sends `["type": "heart_rate", "bpm": …]` via `WCSession.sendMessage`.

## One-time setup checklist

**iOS**
- In Xcode → Signing & Capabilities, the **HealthKit** capability (with *Background Delivery*) must be allowed by your team's provisioning profile. The entitlements are already in `testhello.entitlements`.
- Make sure **Background Modes** shows *Background fetch* and *Background processing* (already set in `Info.plist`).
- Run `cd ios && LANG=en_US.UTF-8 pod install` after pulling these changes.

**Android**
- Health Connect is part of Android 14+. On Android 13 and lower, install the *Health Connect* app from the Play Store.
- `minSdkVersion` was raised to 26 (Health Connect requirement).
- A Wear OS companion app must use the same `applicationId` and signing key, and declare the `health_monitor_watch` capability.

## Healthcare-specific notes

- **Encrypt the outbox** in production (Room + SQLCipher / iOS Data Protection). It's PHI at rest.
- **Clear everything on logout**: cancel work, clear the outbox and tokens/anchors, so the next user of a shared device never syncs as the previous patient.
- **Server de-duplication** by `(type, startTime, source)`: retries and re-reads can send the same sample twice, by design.
- **Tell the user** when collection is running. Android forces this with the notification, but on iOS it's still good practice.
