package com.testhello.healthsync

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One health measurement, whatever collected it (Health Connect, the watch, or
 * the phone's step sensor).
 */
data class HealthSample(
    val type: String, // "heart_rate" | "steps"
    val value: Double,
    val unit: String, // "bpm" | "count"
    val startTime: Long, // epoch millis
    val endTime: Long,
    val source: String, // "health-connect" | "wear-os" | "step-sensor"
) {
  fun toJson(): JSONObject =
      JSONObject()
          .put("type", type)
          .put("value", value)
          .put("unit", unit)
          .put("startTime", startTime)
          .put("endTime", endTime)
          .put("source", source)

  companion object {
    fun fromJson(json: JSONObject) =
        HealthSample(
            type = json.getString("type"),
            value = json.getDouble("value"),
            unit = json.getString("unit"),
            startTime = json.getLong("startTime"),
            endTime = json.getLong("endTime"),
            source = json.getString("source"),
        )
  }
}

/**
 * On-device "outbox" for samples waiting to be uploaded, plus small sync state.
 *
 * Why a local queue? Collection and upload are separate steps on purpose:
 *   - Data can arrive when there's no network (the watch syncs in a basement).
 *   - Uploading is battery-heavy, so WorkManager batches it and waits for a
 *     network connection.
 * Collectors only append here. UploadWorker drains it when conditions allow.
 *
 * This is kept simple with SharedPreferences + JSON for the demo. A production
 * app would use an encrypted database (e.g. Room + SQLCipher), because this is
 * protected health information sitting on the device.
 */
object HealthLocalStore {
  private const val PREFS = "health_sync_store"
  private const val KEY_PENDING = "pending_samples"
  private const val KEY_CHANGES_TOKEN = "health_connect_changes_token"

  // Workers, the wearable service and the session service can all run at the
  // same time on different threads, so every read-modify-write is serialized.
  private val lock = Any()

  private fun prefs(context: Context) =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun addSamples(context: Context, samples: List<HealthSample>) {
    if (samples.isEmpty()) return
    synchronized(lock) {
      val array = JSONArray(prefs(context).getString(KEY_PENDING, "[]"))
      samples.forEach { array.put(it.toJson()) }
      prefs(context).edit().putString(KEY_PENDING, array.toString()).apply()
    }
  }

  fun pendingCount(context: Context): Int =
      synchronized(lock) { JSONArray(prefs(context).getString(KEY_PENDING, "[]")).length() }

  /** Returns up to [max] of the oldest samples, without removing them yet. */
  fun peekBatch(context: Context, max: Int): List<HealthSample> =
      synchronized(lock) {
        val array = JSONArray(prefs(context).getString(KEY_PENDING, "[]"))
        (0 until minOf(max, array.length())).map { HealthSample.fromJson(array.getJSONObject(it)) }
      }

  /**
   * Removes the first [count] samples, but only after the server confirmed it
   * stored them. If the upload fails halfway, nothing is lost: the same batch
   * is retried on the next run.
   */
  fun removeBatch(context: Context, count: Int) {
    synchronized(lock) {
      val array = JSONArray(prefs(context).getString(KEY_PENDING, "[]"))
      val remaining = JSONArray()
      for (i in count until array.length()) remaining.put(array.get(i))
      prefs(context).edit().putString(KEY_PENDING, remaining.toString()).apply()
    }
  }

  /**
   * Health Connect "changes token": a bookmark of the last data we read.
   * Next time, we ask for changes since this bookmark, not all history.
   * It's the Android counterpart of HealthKit's HKQueryAnchor.
   */
  fun getChangesToken(context: Context): String? =
      prefs(context).getString(KEY_CHANGES_TOKEN, null)

  fun setChangesToken(context: Context, token: String?) {
    prefs(context).edit().putString(KEY_CHANGES_TOKEN, token).apply()
  }
}
