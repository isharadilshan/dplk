/**
 * Handles user interaction with notifications displayed by Notifee: taps,
 * action buttons and dismissals. This covers all local notifications, plus
 * push messages we displayed ourselves via displayRemoteMessage().
 *
 * Notifee reports these through two separate listeners:
 *   - onForegroundEvent: the app is open (registered in the root component).
 *   - onBackgroundEvent: the app is in the background or killed (registered
 *     in index.js, because no React tree exists in that case).
 * Both pass the event to handleNotifeeEvent() so the behavior is identical.
 */
import notifee, { Event, EventType } from '@notifee/react-native';
import { ACTIONS } from './constants';
import { snoozeMedicationReminder } from './localNotifications';
import {
  flushPendingNotification,
  handleNotificationOpen,
} from './notificationRouter';

async function handleNotifeeEvent({ type, detail }: Event): Promise<void> {
  const { notification, pressAction } = detail;
  const data = notification?.data as Record<string, string> | undefined;

  switch (type) {
    // The user tapped the notification body, so open the related screen.
    case EventType.PRESS:
      handleNotificationOpen(data);
      break;

    // The user tapped one of the buttons (Android actions / iOS category).
    case EventType.ACTION_PRESS:
      if (pressAction?.id === ACTIONS.MARK_TAKEN) {
        // In a real app: record the dose in the adherence log, e.g.
        // POST /medications/{data.medicationId}/doses. Queue it offline if
        // there's no connection, so no dose record is lost.
        console.log('[Local] Dose marked as taken:', data?.medicationName);
      }
      if (pressAction?.id === ACTIONS.SNOOZE && data) {
        await snoozeMedicationReminder(data);
        console.log('[Local] Reminder snoozed:', data.medicationName);
      }
      // Remove the notification so it doesn't stay in the tray once handled.
      if (notification?.id) {
        await notifee.cancelNotification(notification.id);
      }
      break;

    // The user swiped it away. A care app could count missed doses here.
    case EventType.DISMISSED:
      console.log('[Local] Notification dismissed:', notification?.id);
      break;
  }
}

/**
 * Foreground listener. Call it from the root component and run the returned
 * function on unmount. It also checks whether a tap on a Notifee notification
 * cold-started the app.
 */
export function subscribeToNotifeeEvents(): () => void {
  notifee.getInitialNotification().then(initial => {
    if (initial?.notification) {
      handleNotificationOpen(
        initial.notification.data as Record<string, string> | undefined,
      );
    }
  });

  return notifee.onForegroundEvent(handleNotifeeEvent);
}

/**
 * Background listener. Must be registered in index.js, before
 * AppRegistry.registerComponent, so it also runs when the app is killed.
 */
export function registerNotifeeBackgroundHandler(): void {
  notifee.onBackgroundEvent(handleNotifeeEvent);
}

export { flushPendingNotification };
