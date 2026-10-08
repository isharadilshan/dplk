package com.testhello.healthsync

import androidx.activity.ComponentActivity
import androidx.health.connect.client.PermissionController
import com.facebook.fbreact.specs.NativeHealthSyncSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Turbo Module that exposes the Android background health system to JS.
 *
 * It extends NativeHealthSyncSpec, which codegen generates from
 * src/specs/NativeHealthSync.ts, so the method names and types are checked
 * against the TS spec at compile time.
 *
 * Important: this module is only a *remote control*. It schedules work and
 * reads state, but none of the background components depend on it.
 * WorkManager jobs, WearableDataListenerService and LiveMonitoringService all
 * run fine when JS (and this module) doesn't exist, e.g. at 3 AM with the app
 * killed.
 */
class HealthSyncModule(reactContext: ReactApplicationContext) : NativeHealthSyncSpec(reactContext) {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val context get() = reactApplicationContext

  override fun initialize() {
    super.initialize()
    // While JS is alive, forward every new log entry to it as an event.
    HealthActivityLog.listener = { entry -> emitOnHealthEvent(entry.toWritableMap()) }
  }

  override fun invalidate() {
    // JS is being torn down (reload or app exit). Stop forwarding and
    // cancel any in-flight calls.
    HealthActivityLog.listener = null
    scope.cancel()
    super.invalidate()
  }

  /**
   * Opens the Health Connect permission screen.
   *
   * Health Connect permissions aren't normal runtime permissions: they use an
   * ActivityResultContract that opens the Health Connect app. We register the
   * launcher on the fly through the activity's result registry, because a
   * React Native module can't use registerForActivityResult() in onCreate().
   */
  override fun requestHealthPermissions(promise: Promise) {
    if (!HealthConnectRepository.isAvailable(context)) {
      promise.reject("E_UNAVAILABLE", "Health Connect is not installed or needs an update.")
      return
    }
    val activity = context.currentActivity as? ComponentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity to show the permission screen.")
      return
    }

    val repository = HealthConnectRepository(context)
    val wanted = repository.permissionsToRequest()

    activity.runOnUiThread {
      var launcher: androidx.activity.result.ActivityResultLauncher<Set<String>>? = null
      launcher =
          activity.activityResultRegistry.register(
              "health-connect-permissions",
              PermissionController.createRequestPermissionResultContract()) { granted ->
                launcher?.unregister()
                val readOk = granted.containsAll(HealthConnectRepository.READ_PERMISSIONS)
                val bgOk = HealthConnectRepository.BACKGROUND_PERMISSION in granted
                HealthActivityLog.record(
                    context,
                    "health-store",
                    "HealthConnect",
                    "Permissions: read=${if (readOk) "granted" else "denied"}, background=${if (bgOk) "granted" else "not granted"}")
                promise.resolve(readOk)
              }
      launcher.launch(wanted)
    }
  }

  override fun schedulePeriodicSync(intervalMinutes: Double, promise: Promise) {
    HealthWorkScheduler.schedulePeriodicSync(context, intervalMinutes.toLong())
    promise.resolve(null)
  }

  override fun runSyncNow(promise: Promise) {
    HealthWorkScheduler.runSyncNow(context)
    promise.resolve(null)
  }

  override fun cancelScheduledWork(promise: Promise) {
    HealthWorkScheduler.cancelAll(context)
    promise.resolve(null)
  }

  /** Health Connect can't push changes to us. Polling via WorkManager is the Android approach. */
  override fun enableHealthBackgroundDelivery(promise: Promise) {
    HealthActivityLog.record(
        context,
        "health-store",
        "HealthConnect",
        "Health Connect has no background delivery. Using WorkManager polling instead.")
    promise.resolve(false)
  }

  override fun startLiveSession(promise: Promise) {
    try {
      LiveMonitoringService.start(context)
      promise.resolve(null)
    } catch (e: Exception) {
      // E.g. ForegroundServiceStartNotAllowedException when started while the
      // app is in the background (Android 12+), or a missing runtime permission.
      promise.reject("E_SESSION", e.message, e)
    }
  }

  override fun stopLiveSession(promise: Promise) {
    LiveMonitoringService.stop(context)
    promise.resolve(null)
  }

  override fun getWearableStatus(promise: Promise) {
    scope.launch {
      try {
        val status = WearableGateway(context).status()
        promise.resolve(
            Arguments.createMap().apply {
              putBoolean("supported", status.supported)
              putBoolean("paired", status.paired)
              putBoolean("appInstalled", status.appInstalled)
              putBoolean("reachable", status.reachable)
            })
      } catch (e: Exception) {
        promise.reject("E_WEARABLE", e.message, e)
      }
    }
  }

  override fun simulateWearableSample(bpm: Double) {
    // Same path as a real watch message (WearableDataListenerService).
    WearableIngest.onHeartRate(context, bpm, System.currentTimeMillis(), via = "MessageClient (simulated)")
  }

  override fun getPendingSampleCount(promise: Promise) {
    promise.resolve(HealthLocalStore.pendingCount(context))
  }

  override fun getActivityLog(promise: Promise) {
    val entries = HealthActivityLog.entries(context)
    val array = Arguments.createArray()
    for (i in 0 until entries.length()) array.pushMap(entries.getJSONObject(i).toWritableMap())
    promise.resolve(array)
  }

  override fun clearActivityLog(promise: Promise) {
    HealthActivityLog.clear(context)
    promise.resolve(null)
  }

  // Note: `json` is named explicitly. Inside `createMap().apply { }`, a bare
  // getString() would resolve to the WritableMap being built, not the JSON.
  private fun JSONObject.toWritableMap(): WritableMap {
    val json = this
    return Arguments.createMap().apply {
      putString("kind", json.getString("kind"))
      putString("source", json.getString("source"))
      putString("message", json.getString("message"))
      putDouble("timestamp", json.getLong("timestamp").toDouble())
      putString("appState", json.getString("appState"))
    }
  }
}
