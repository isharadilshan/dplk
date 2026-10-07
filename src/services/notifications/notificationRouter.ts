/**
 * Decides what happens when the user taps a notification.
 *
 * Local notifications (Notifee) and push notifications (FCM) report taps
 * through different listeners, but both pass their `data` payload here. That
 * gives us one place that maps "type of health event" to "screen to open".
 */
import { navigationRef } from '../../app/navigationRef';

type NotificationData = Record<string, string> | undefined;

// If the app was launched from a notification tap, the tap is reported before
// the navigator has mounted. We park it here and replay it once nav is ready.
let pendingData: NotificationData;

export function handleNotificationOpen(data: NotificationData): void {
  if (!data?.type) {
    return; // Not one of ours or no deep-link info, so just open the app.
  }

  if (!navigationRef.isReady()) {
    pendingData = data;
    return;
  }

  // In a full app each type would open its own screen, for example:
  //   MEDICATION_REMINDER  → Medication schedule
  //   APPOINTMENT_REMINDER → Appointment details (data.appointmentId)
  //   LAB_RESULT_READY     → Lab report (data.labResultId, fetched from API)
  //   DOCTOR_MESSAGE       → Chat thread (data.threadId)
  // For this demo, one detail screen shows what was opened and the payload.
  navigationRef.navigate('NotificationDetail', { type: data.type, data });
}

/** Called by NavigationContainer's onReady to replay a cold-start tap. */
export function flushPendingNotification(): void {
  if (pendingData) {
    const data = pendingData;
    pendingData = undefined;
    handleNotificationOpen(data);
  }
}
