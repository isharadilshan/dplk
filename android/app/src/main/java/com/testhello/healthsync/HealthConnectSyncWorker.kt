package com.testhello.healthsync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters

/**
 * WorkManager job #1: COLLECT. Pulls new data from Health Connect into the
 * local outbox.
 *
 * WorkManager is Android's scheduler for *deferrable, guaranteed* work:
 *   - Deferrable: it runs "soon", when the OS decides it's cheap (Doze
 *     windows, battery), not at an exact time.
 *   - Guaranteed: it survives app kills and reboots, and retries on failure.
 * It's the right tool for "sync health data every ~15 minutes". It's the
 * wrong tool for "alarm at 8:00 sharp" (use AlarmManager) or "stream heart
 * rate during a workout" (use a foreground service, see LiveMonitoringService).
 *
 * CoroutineWorker runs doWork() on a background dispatcher, so it can use
 * suspend APIs like Health Connect directly.
 */
class HealthConnectSyncWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

  override suspend fun doWork(): Result {
    // runAttemptCount > 0 means this is a retry after a previous failure.
    HealthActivityLog.record(
        applicationContext,
        "scheduler",
        "WorkManager",
        "HealthConnectSyncWorker started (attempt ${runAttemptCount + 1}, tags=${tags.filter { it.startsWith("health") }})")

    if (!HealthConnectRepository.isAvailable(applicationContext)) {
      HealthActivityLog.record(
          applicationContext, "health-store", "HealthConnect", "Health Connect is not installed. Skipping read.")
      // success(), not failure(): retrying won't install Health Connect.
      // failure() would also cancel the rest of a chain (the upload step).
      return Result.success()
    }

    return try {
      val repository = HealthConnectRepository(applicationContext)
      if (!repository.hasReadPermissions()) {
        HealthActivityLog.record(
            applicationContext, "health-store", "HealthConnect", "Read permission not granted. Skipping read.")
        return Result.success()
      }

      val samples = repository.readNewSamples()
      HealthActivityLog.record(
          applicationContext,
          "health-store",
          "HealthConnect",
          "Read ${samples.size} new sample(s). Outbox now holds ${HealthLocalStore.pendingCount(applicationContext)}.")
      Result.success()
    } catch (e: SecurityException) {
      // Typically: Android 15+ background read without
      // READ_HEALTH_DATA_IN_BACKGROUND. Retrying won't help until the user grants it.
      HealthActivityLog.record(applicationContext, "error", "HealthConnect", "Permission error: ${e.message}")
      Result.success()
    } catch (e: Exception) {
      // Temporary problem (e.g. Health Connect is busy). Returning retry()
      // makes WorkManager run us again later, using the backoff policy set
      // in HealthWorkScheduler.
      HealthActivityLog.record(applicationContext, "error", "HealthConnect", "Read failed, will retry: ${e.message}")
      Result.retry()
    }
  }

  /**
   * Required for EXPEDITED work ("Sync now") on Android 11 and lower, where
   * WorkManager runs expedited work as a foreground service that needs a
   * visible notification. Android 12+ uses expedited jobs instead and never
   * calls this.
   */
  override suspend fun getForegroundInfo(): ForegroundInfo {
    val channelId = "health-sync-work"
    val manager = applicationContext.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
          NotificationChannel(channelId, "Health data sync", NotificationManager.IMPORTANCE_LOW))
    }
    val notification =
        NotificationCompat.Builder(applicationContext, channelId)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Syncing health data")
            .setOngoing(true)
            .build()
    return ForegroundInfo(4201, notification)
  }
}
