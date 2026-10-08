package com.testhello.healthsync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ChangesTokenRequest

/**
 * Reads new data from Health Connect, Android's shared on-device health
 * database. Fitness apps, Samsung Health, Fitbit, Wear OS and others write to
 * it, and we read from it.
 *
 * Key difference from iOS HealthKit: Health Connect has NO push mechanism.
 * There's nothing like HealthKit's background delivery that wakes our app
 * when a new sample is saved. Instead, we poll it from a WorkManager job
 * (HealthConnectSyncWorker) using the Changes API, which returns only what
 * changed since our last read.
 */
class HealthConnectRepository(private val context: Context) {

  companion object {
    val READ_PERMISSIONS =
        setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
        )

    /**
     * Android 15+: reading while the app is NOT in the foreground (which is
     * exactly what a WorkManager job does) needs this extra permission.
     * Without it, background reads throw a SecurityException.
     */
    const val BACKGROUND_PERMISSION = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

    fun isAvailable(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
  }

  private val client by lazy { HealthConnectClient.getOrCreate(context) }

  /** True when this device's Health Connect version supports background reads. */
  fun supportsBackgroundRead(): Boolean =
      client.features.getFeatureStatus(
          HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
          HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

  /** The permissions to request: always the read ones, plus background read when supported. */
  fun permissionsToRequest(): Set<String> =
      if (supportsBackgroundRead()) READ_PERMISSIONS + BACKGROUND_PERMISSION else READ_PERMISSIONS

  suspend fun hasReadPermissions(): Boolean =
      client.permissionController.getGrantedPermissions().containsAll(READ_PERMISSIONS)

  /**
   * Returns every steps / heart-rate record added since the last call.
   *
   * How the changes token works:
   *   1. First run: there's no token yet. We ask for one, which acts as a
   *      "start from now" bookmark, and return nothing.
   *   2. Later runs: getChanges(token) returns only new or updated records,
   *      plus a new token for next time.
   * The token is only saved AFTER the records are in our local outbox, so a
   * crash mid-read means re-reading, never losing data.
   */
  suspend fun readNewSamples(): List<HealthSample> {
    var token = HealthLocalStore.getChangesToken(context)
    if (token == null) {
      token =
          client.getChangesToken(
              ChangesTokenRequest(recordTypes = setOf(StepsRecord::class, HeartRateRecord::class)))
      HealthLocalStore.setChangesToken(context, token)
      HealthActivityLog.record(
          context, "health-store", "HealthConnect", "Baseline set. New data will be read from now on.")
      return emptyList()
    }

    val samples = mutableListOf<HealthSample>()
    var hasMore = true
    while (hasMore) {
      val response = client.getChanges(token!!)

      // Tokens expire after ~30 days without use. We reset the bookmark here.
      // A real app would also do a time-range readRecords() to fill the gap.
      if (response.changesTokenExpired) {
        HealthLocalStore.setChangesToken(context, null)
        HealthActivityLog.record(
            context, "error", "HealthConnect", "Changes token expired. Baseline will be reset.")
        return samples
      }

      for (change in response.changes) {
        // Changes can also be DeletionChange (the user deleted data). A full
        // implementation would send those deletions to the backend too.
        if (change !is UpsertionChange) continue
        when (val record = change.record) {
          is StepsRecord ->
              samples +=
                  HealthSample(
                      "steps",
                      record.count.toDouble(),
                      "count",
                      record.startTime.toEpochMilli(),
                      record.endTime.toEpochMilli(),
                      "health-connect")
          // One HeartRateRecord holds a series of readings, so we flatten it.
          is HeartRateRecord ->
              record.samples.forEach {
                samples +=
                    HealthSample(
                        "heart_rate",
                        it.beatsPerMinute.toDouble(),
                        "bpm",
                        it.time.toEpochMilli(),
                        it.time.toEpochMilli(),
                        "health-connect")
              }
        }
      }
      token = response.nextChangesToken
      hasMore = response.hasMore
    }

    HealthLocalStore.addSamples(context, samples)
    HealthLocalStore.setChangesToken(context, token)
    return samples
  }
}
