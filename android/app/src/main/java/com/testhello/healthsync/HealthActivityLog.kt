package com.testhello.healthsync

import android.content.Context
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persistent log of everything the background system does.
 *
 * Background work is hard to observe: WorkManager might run a job at 3 AM
 * while the app is closed. Every component writes here, so the demo screen
 * can later show what ran, when, and whether the app was in the background.
 *
 * It also works as a small event bus. If the React Native module is alive, it
 * registers a [listener] and each entry is forwarded to JS straight away.
 */
object HealthActivityLog {
  private const val TAG = "HealthSync"
  private const val PREFS = "health_sync_log"
  private const val KEY = "entries"
  private const val MAX_ENTRIES = 200

  /** Set by HealthSyncModule while JS is running, null otherwise. */
  @Volatile var listener: ((JSONObject) -> Unit)? = null

  private val lock = Any()

  fun record(context: Context, kind: String, source: String, message: String) {
    val entry =
        JSONObject()
            .put("kind", kind)
            .put("source", source)
            .put("message", message)
            .put("timestamp", System.currentTimeMillis())
            .put("appState", currentAppState())

    // Logcat too: `adb logcat -s HealthSync` shows background runs live.
    Log.i(TAG, "[$kind/$source] $message")

    synchronized(lock) {
      val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val existing = JSONArray(prefs.getString(KEY, "[]"))
      // Newest first, capped so the log can't grow forever.
      val updated = JSONArray().put(entry)
      for (i in 0 until minOf(existing.length(), MAX_ENTRIES - 1)) updated.put(existing.get(i))
      prefs.edit().putString(KEY, updated.toString()).apply()
    }

    // Forwarding to JS is best-effort. A failure there must never crash the
    // background job that is logging (the entry is already persisted).
    try {
      listener?.invoke(entry)
    } catch (e: Exception) {
      Log.w(TAG, "Could not forward log entry to JS", e)
    }
  }

  fun entries(context: Context): JSONArray =
      synchronized(lock) {
        JSONArray(
            context.applicationContext
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, "[]"))
      }

  fun clear(context: Context) {
    synchronized(lock) {
      context.applicationContext
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .remove(KEY)
          .apply()
    }
  }

  /**
   * "foreground" when a UI is visible, otherwise "background". This is what
   * shows that a WorkManager job really ran while the app was closed.
   */
  private fun currentAppState(): String =
      try {
        val state = ProcessLifecycleOwner.get().lifecycle.currentState
        if (state.isAtLeast(Lifecycle.State.STARTED)) "foreground" else "background"
      } catch (_: Throwable) {
        "background"
      }
}
