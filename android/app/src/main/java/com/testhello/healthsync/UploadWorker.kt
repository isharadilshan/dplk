package com.testhello.healthsync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.delay

/**
 * WorkManager job #2: UPLOAD. Sends the local outbox to the backend in batches.
 *
 * It's a separate worker from collection because it needs different
 * conditions: collection can run offline, but upload needs a network. The
 * NetworkType.CONNECTED constraint (set in HealthWorkScheduler) makes
 * WorkManager wait until there's connectivity, so we don't burn battery on
 * requests that are bound to fail.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

  companion object {
    private const val BATCH_SIZE = 100
    private const val MAX_ATTEMPTS = 5
  }

  override suspend fun doWork(): Result {
    var uploaded = 0
    try {
      // Drain in batches, so one huge request doesn't time out.
      while (true) {
        // isStopped turns true if the OS cancels us (constraints lost, e.g.
        // Wi-Fi dropped, or our time ran out). Stop cleanly and let
        // WorkManager reschedule. Nothing is lost, because samples are only
        // removed after a confirmed upload.
        if (isStopped) return Result.retry()

        val batch = HealthLocalStore.peekBatch(applicationContext, BATCH_SIZE)
        if (batch.isEmpty()) break
        FakeHealthApi.uploadVitals(batch)
        HealthLocalStore.removeBatch(applicationContext, batch.size)
        uploaded += batch.size
      }
    } catch (e: Exception) {
      // Exponential backoff (configured in HealthWorkScheduler) spaces out
      // retries: 30s, 60s, 120s... We give up after MAX_ATTEMPTS so a broken
      // server doesn't keep waking the phone. The periodic sync tries again later.
      val giveUp = runAttemptCount + 1 >= MAX_ATTEMPTS
      HealthActivityLog.record(
          applicationContext,
          "error",
          "WorkManager",
          "Upload failed (attempt ${runAttemptCount + 1}/$MAX_ATTEMPTS): ${e.message}${if (giveUp) ". Giving up." else ". Will retry with backoff."}")
      return if (giveUp) Result.failure() else Result.retry()
    }

    HealthActivityLog.record(
        applicationContext,
        "upload",
        "WorkManager",
        if (uploaded == 0) "UploadWorker: outbox empty, nothing to send." else "UploadWorker: uploaded $uploaded sample(s).")

    // Output data can be read by the next worker in a chain, or by observing
    // the WorkInfo from the UI.
    return Result.success(workDataOf("uploaded" to uploaded))
  }
}

/**
 * Stand-in for the real backend client. A real one would POST the batch over
 * HTTPS with the patient's auth token to an endpoint like /v1/vitals/batch,
 * and the server would de-duplicate by (type, startTime, source), so a
 * retried batch is never stored twice.
 */
object FakeHealthApi {
  suspend fun uploadVitals(batch: List<HealthSample>) {
    delay(500) // Pretend network latency.
  }
}
