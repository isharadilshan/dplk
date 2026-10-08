package com.testhello.healthsync

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await

/**
 * Phone → watch direction of the Wearable Data Layer: checks connection state
 * and sends commands such as "start a monitoring session".
 */
class WearableGateway(private val context: Context) {

  companion object {
    /**
     * The watch app advertises this capability in its res/values/wear.xml:
     *   <string-array name="android_wear_capabilities">
     *     <item>health_monitor_watch</item>
     *   </string-array>
     * Finding it on a connected node means our watch app is installed there.
     */
    const val WATCH_CAPABILITY = "health_monitor_watch"
    const val PATH_SESSION_START = "/health/session/start"
    const val PATH_SESSION_STOP = "/health/session/stop"
  }

  data class Status(
      val supported: Boolean,
      val paired: Boolean,
      val appInstalled: Boolean,
      val reachable: Boolean
  )

  suspend fun status(): Status {
    // The Data Layer is part of Google Play services and doesn't exist without it.
    val playServices =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
            ConnectionResult.SUCCESS
    if (!playServices) return Status(false, false, false, false)

    // "Connected nodes" are watches currently connected over Bluetooth or the cloud.
    // Phones/emulators without the Wear OS companion stack throw ApiException
    // (API_UNAVAILABLE). That just means "no watch support", not an error.
    val (connected, withApp) =
        try {
          Wearable.getNodeClient(context).connectedNodes.await() to
              Wearable.getCapabilityClient(context)
                  .getCapability(WATCH_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
                  .await()
                  .nodes
        } catch (e: ApiException) {
          return Status(false, false, false, false)
        }
    return Status(
        supported = true,
        paired = connected.isNotEmpty(),
        appInstalled = withApp.isNotEmpty(),
        reachable = withApp.any { it.isNearby })
  }

  /**
   * Tells every watch running our app to start (or stop) streaming heart
   * rate. On the watch, this would start a Health Services ExerciseClient
   * session, which keeps the heart-rate sensor on and sends readings back via
   * MessageClient to WearableDataListenerService.
   */
  suspend fun sendSessionCommand(start: Boolean): Int {
    val nodes =
        Wearable.getCapabilityClient(context)
            .getCapability(WATCH_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
            .await()
            .nodes
    val path = if (start) PATH_SESSION_START else PATH_SESSION_STOP
    nodes.forEach { Wearable.getMessageClient(context).sendMessage(it.id, path, ByteArray(0)).await() }
    return nodes.size
  }
}
