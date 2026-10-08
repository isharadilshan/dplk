package com.testhello.healthsync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * All WorkManager scheduling in one place. It shows the four main patterns:
 *
 *  1. PERIODIC work: repeats every N minutes (minimum 15) for as long as the
 *     app is installed, even after reboots.
 *  2. CONSTRAINTS: only run when conditions are good (network, battery).
 *  3. CHAINING: run B only after A succeeds (read → upload).
 *  4. EXPEDITED work: run as soon as possible, for user-initiated actions.
 *
 * Every request uses *unique work* names. Enqueueing the same name again
 * follows a policy (KEEP, REPLACE, UPDATE...) instead of creating duplicates.
 * Without this, calling schedulePeriodicSync() on every app launch would pile
 * up dozens of identical jobs.
 *
 * To debug: `adb shell dumpsys jobscheduler | grep -A5 com.testhello`
 * shows each job's constraints and when it will run next.
 */
object HealthWorkScheduler {
  private const val PERIODIC_SYNC = "health-periodic-sync"
  private const val SYNC_NOW = "health-sync-now"
  private const val UPLOAD = "health-upload"
  const val TAG = "health-sync"

  /** Upload only with a network connection. */
  private val uploadConstraints =
      Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

  /**
   * Pattern 1 + 2: periodic collection with constraints.
   *
   * The interval is a *minimum*. With interval=15, the job runs at most once
   * per 15-minute window, and the OS may delay it further in Doze or battery
   * saver. Health sync is a good fit for that: "roughly every 15 min" is
   * fine, while precise timing (medication alarms) is not what this is for.
   */
  fun schedulePeriodicSync(context: Context, intervalMinutes: Long) {
    // WorkManager silently raises anything below 15 minutes to 15.
    val interval = intervalMinutes.coerceAtLeast(15)

    val request =
        PeriodicWorkRequestBuilder<HealthConnectSyncWorker>(interval, TimeUnit.MINUTES)
            // Skip runs when the battery is low. Health sync can wait.
            .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(TAG)
            .build()

    // UPDATE keeps the existing schedule (and its next run time) but applies
    // new settings, such as a changed interval. Pitfall: UPDATE never restarts
    // *finished* work. If the periodic job ever ended up FAILED or CANCELLED
    // (e.g. the worker threw an uncaught exception), UPDATE would leave it dead
    // forever. In that case we use CANCEL_AND_REENQUEUE to start it fresh.
    val workManager = WorkManager.getInstance(context)
    val existing = workManager.getWorkInfosForUniqueWork(PERIODIC_SYNC).get()
    val isDead = existing.isNotEmpty() && existing.all { it.state.isFinished }
    val policy =
        if (isDead) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE
        else ExistingPeriodicWorkPolicy.UPDATE
    workManager.enqueueUniquePeriodicWork(PERIODIC_SYNC, policy, request)

    HealthActivityLog.record(
        context, "scheduler", "WorkManager", "Periodic sync scheduled every $interval min (battery-not-low)${if (isDead) ", restarted a finished job" else ""}.")
  }

  /**
   * Pattern 3 + 4: a user-initiated "Sync now" as an expedited chain.
   *
   *   [HealthConnectSyncWorker (expedited)] ──then──▶ [UploadWorker (needs network)]
   *
   * Expedited work starts within seconds, but the OS gives each app a limited
   * quota. RUN_AS_NON_EXPEDITED_WORK_REQUEST means: if the quota is used up,
   * run it as normal work rather than dropping it.
   * The upload only starts after the read succeeds. If the read fails, the
   * whole chain stops.
   */
  fun runSyncNow(context: Context) {
    val read =
        OneTimeWorkRequestBuilder<HealthConnectSyncWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag(TAG)
            .build()

    WorkManager.getInstance(context)
        // REPLACE: tapping "Sync now" twice restarts the chain, it doesn't queue two.
        .beginUniqueWork(SYNC_NOW, ExistingWorkPolicy.REPLACE, read)
        .then(buildUploadRequest())
        .enqueue()

    HealthActivityLog.record(context, "scheduler", "WorkManager", "Sync-now chain enqueued: read → upload.")
  }

  /**
   * Called by collectors (the wearable listener, the live session) after they
   * add samples. KEEP means: if an upload is already waiting, don't add
   * another. The waiting one will pick up the new samples too. This batches
   * many small watch messages into one network call.
   */
  fun enqueueUpload(context: Context) {
    WorkManager.getInstance(context)
        .enqueueUniqueWork(UPLOAD, ExistingWorkPolicy.KEEP, buildUploadRequest())
  }

  private fun buildUploadRequest() =
      OneTimeWorkRequestBuilder<UploadWorker>()
          .setConstraints(uploadConstraints)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .addTag(TAG)
          .build()

  /** Cancels every job we created. Do this on logout. */
  fun cancelAll(context: Context) {
    WorkManager.getInstance(context).cancelAllWorkByTag(TAG)
    HealthActivityLog.record(context, "scheduler", "WorkManager", "All health work cancelled.")
  }
}
