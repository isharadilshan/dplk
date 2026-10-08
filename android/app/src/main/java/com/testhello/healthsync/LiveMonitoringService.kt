package com.testhello.healthsync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * A LIVE monitoring session (e.g. a guided walk or cardiac rehab exercise)
 * that collects data continuously while the app is in the background.
 *
 * Why a foreground service, not WorkManager?
 *   WorkManager decides WHEN to run and limits each run to ~10 minutes.
 *   Continuous collection needs the process alive for the whole session. On
 *   modern Android, the only allowed way is a foreground service: it shows an
 *   ongoing notification, so the user always knows the app is collecting.
 *
 * Android 14+ requires a declared type. "health" is meant for fitness and
 * health tracking and needs FOREGROUND_SERVICE_HEALTH in the manifest plus
 * ACTIVITY_RECOGNITION (or BODY_SENSORS) granted at runtime before starting.
 *
 * Data source here: the phone's own hardware step counter, so the demo works
 * without a watch. If a watch is connected, we also ask it to start
 * streaming heart rate (see WearableGateway).
 */
class LiveMonitoringService : Service(), SensorEventListener {

  companion object {
    private const val CHANNEL_ID = "live-monitoring"
    private const val NOTIFICATION_ID = 4202
    private const val ACTION_STOP = "com.testhello.healthsync.STOP_SESSION"

    /** How often the session saves a step sample to the outbox. */
    private const val FLUSH_INTERVAL_MS = 60_000L

    fun start(context: Context) {
      // startForegroundService() promises the OS that the service will call
      // startForeground() within ~5 seconds, or the app is killed.
      ContextCompat.startForegroundService(context, Intent(context, LiveMonitoringService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LiveMonitoringService::class.java))
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private lateinit var sensorManager: SensorManager

  // TYPE_STEP_COUNTER reports total steps since the phone last rebooted, so
  // we remember the first value and subtract it.
  private var baselineSteps: Float? = null
  private var lastFlushedSteps = 0
  private var lastFlushAt = 0L
  private var sessionStartedAt = 0L

  override fun onBind(intent: Intent?): IBinder? = null // Started, not bound.

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    // Must be called right away. See the ~5 second rule in start().
    ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification("Starting…"),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        else 0)

    if (sessionStartedAt == 0L) startSession()

    // NOT_STICKY: if the OS kills the process, don't restart the session on
    // its own. A session the patient didn't start again would be confusing.
    return START_NOT_STICKY
  }

  private fun startSession() {
    sessionStartedAt = System.currentTimeMillis()
    lastFlushAt = sessionStartedAt
    sensorManager = getSystemService(SensorManager::class.java)

    val stepCounter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (stepCounter == null) {
      HealthActivityLog.record(this, "session", "ForegroundService", "No step counter sensor on this device.")
    } else {
      // maxReportLatency lets the sensor chip batch events in hardware and
      // deliver them every ~10 s, instead of waking the CPU on every step.
      // This is one of the main battery savers for continuous collection.
      sensorManager.registerListener(
          this, stepCounter, SensorManager.SENSOR_DELAY_NORMAL, 10_000_000 /* µs */)
    }

    HealthActivityLog.record(this, "session", "ForegroundService", "Live session started (type=health).")

    // Ask the watch (if any) to start its own heart-rate session.
    scope.launch {
      val count = runCatching { WearableGateway(this@LiveMonitoringService).sendSessionCommand(true) }.getOrDefault(0)
      if (count > 0) {
        HealthActivityLog.record(
            this@LiveMonitoringService, "wearable", "MessageClient", "Asked $count watch(es) to start streaming heart rate.")
      }
    }
  }

  override fun onSensorChanged(event: SensorEvent) {
    val total = event.values[0]
    val baseline = baselineSteps ?: total.also { baselineSteps = it }
    val sessionSteps = (total - baseline).toInt()

    updateNotification("$sessionSteps steps this session")

    // Save in 1-minute chunks, not on every sensor event, to keep the outbox
    // (and the later upload) small.
    val now = System.currentTimeMillis()
    if (now - lastFlushAt >= FLUSH_INTERVAL_MS) flush(sessionSteps, now)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  private fun flush(sessionSteps: Int, now: Long) {
    val delta = sessionSteps - lastFlushedSteps
    if (delta <= 0) return
    HealthLocalStore.addSamples(
        this, listOf(HealthSample("steps", delta.toDouble(), "count", lastFlushAt, now, "step-sensor")))
    HealthActivityLog.record(this, "session", "StepSensor", "+$delta steps (session total $sessionSteps)")
    lastFlushedSteps = sessionSteps
    lastFlushAt = now
  }

  override fun onDestroy() {
    if (::sensorManager.isInitialized) sensorManager.unregisterListener(this)
    baselineSteps?.let { flush(lastFlushedSteps, System.currentTimeMillis()) }

    val minutes = (System.currentTimeMillis() - sessionStartedAt) / 60_000
    HealthActivityLog.record(this, "session", "ForegroundService", "Live session stopped after $minutes min.")

    // Hand the collected data to WorkManager, which uploads it when there's network.
    HealthWorkScheduler.enqueueUpload(this)

    scope.launch {
      runCatching { WearableGateway(this@LiveMonitoringService).sendSessionCommand(false) }
      scope.cancel()
    }
    super.onDestroy()
  }

  private fun buildNotification(text: String): android.app.Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Live health monitoring", NotificationManager.IMPORTANCE_LOW))
    }

    // A "Stop" button right in the notification. Users must always be able
    // to end background collection easily.
    val stopIntent =
        PendingIntent.getService(
            this,
            0,
            Intent(this, LiveMonitoringService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE)

    val openApp = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent =
        PendingIntent.getActivity(this, 1, openApp, PendingIntent.FLAG_IMMUTABLE)

    return NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle("Health monitoring active")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(contentIntent)
        .addAction(0, "Stop", stopIntent)
        .build()
  }

  private fun updateNotification(text: String) {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
  }
}
