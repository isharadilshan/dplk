package com.testhello.healthsync

import android.content.Context
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Receives data from the Wear OS watch app through the Wearable Data Layer API.
 *
 * Google Play services owns the Bluetooth/Wi-Fi link to the watch. When a
 * message arrives, Play services starts THIS service, even if our app was
 * killed. That's what makes it background data collection: no scheduler is
 * needed, because delivery itself wakes us. (Declared in AndroidManifest.xml
 * with intent filters for the paths we care about.)
 *
 * The Data Layer has two channels, and we use both:
 *   - MessageClient (onMessageReceived): fire-and-forget, only delivered if
 *     the phone is connected right now. Good for live heart-rate during a
 *     workout session.
 *   - DataClient (onDataChanged): a synced key-value store. It's guaranteed to
 *     arrive eventually, even after a disconnect. Good for the daily step
 *     total that must not be lost.
 *
 * Requirement: the watch app must have the SAME applicationId and be signed
 * with the SAME key as this phone app, or Play services won't route its
 * messages here.
 *
 * Watch-side example (in the Wear OS app):
 *   Wearable.getMessageClient(ctx).sendMessage(phoneNodeId, "/health/heart-rate",
 *       """{"bpm":82,"timestamp":${System.currentTimeMillis()}}""".toByteArray())
 */
class WearableDataListenerService : WearableListenerService() {

  companion object {
    const val PATH_HEART_RATE = "/health/heart-rate"
    const val PATH_DAILY_STEPS = "/health/daily-steps"
  }

  // Runs on a background thread (not the main thread), so local I/O is fine here.
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path != PATH_HEART_RATE) return
    val json = JSONObject(String(event.data, Charsets.UTF_8))
    WearableIngest.onHeartRate(
        this,
        bpm = json.getDouble("bpm"),
        timestamp = json.optLong("timestamp", System.currentTimeMillis()),
        via = "MessageClient")
  }

  override fun onDataChanged(events: DataEventBuffer) {
    events.forEach { event ->
      if (event.type != DataEvent.TYPE_CHANGED) return@forEach
      val item = event.dataItem
      if (item.uri.path != PATH_DAILY_STEPS) return@forEach

      val map = DataMapItem.fromDataItem(item).dataMap
      val steps = map.getLong("steps")
      val start = map.getLong("startTime")
      val end = map.getLong("endTime")
      HealthLocalStore.addSamples(
          this, listOf(HealthSample("steps", steps.toDouble(), "count", start, end, "wear-os")))
      HealthActivityLog.record(this, "wearable", "DataClient", "Watch synced daily steps: $steps")
      HealthWorkScheduler.enqueueUpload(this)
    }
    // The buffer holds native resources and must be released.
    events.release()
  }
}

/**
 * Shared handling for heart-rate samples coming from the watch. The real
 * listener and the "simulate" button in the demo both call this, so the
 * simulation goes through exactly the same path.
 */
object WearableIngest {
  // Alert threshold for the demo. Real thresholds come from the care plan
  // (age, condition, medication) and would be configured per patient.
  private const val HIGH_HEART_RATE = 120.0

  fun onHeartRate(context: Context, bpm: Double, timestamp: Long, via: String) {
    HealthLocalStore.addSamples(
        context, listOf(HealthSample("heart_rate", bpm, "bpm", timestamp, timestamp, "wear-os")))

    val flag = if (bpm >= HIGH_HEART_RATE) " ⚠️ above ${HIGH_HEART_RATE.toInt()} bpm" else ""
    HealthActivityLog.record(context, "wearable", via, "Heart rate from watch: ${bpm.toInt()} bpm$flag")

    // Don't upload each sample on its own. enqueueUpload() uses KEEP, so a
    // burst of messages ends up in a single network-constrained upload job.
    HealthWorkScheduler.enqueueUpload(context)
  }
}
