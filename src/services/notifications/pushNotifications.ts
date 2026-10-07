/**
 * PUSH (REMOTE) NOTIFICATIONS
 * ===========================
 * Sent by *your backend* through Firebase Cloud Messaging (FCM). On iOS, FCM
 * hands the message to Apple Push Notification service (APNs). Use push for
 * events the phone can't know about by itself:
 *   - "Your lab results are ready"
 *   - "Dr. Silva sent you a message"
 *   - "Your appointment was rescheduled"
 *
 * The flow:
 *   1. The app asks FCM for a device token (a unique address for this install).
 *   2. The app sends that token to our backend and links it to the patient.
 *   3. When something happens, the backend calls the FCM API with the token.
 *   4. FCM delivers the message to the device.
 *
 * What happens on the device depends on the app's state:
 *   - FOREGROUND: the OS does NOT show anything. `onMessage` fires and we have
 *     to display it ourselves (we use Notifee for that).
 *   - BACKGROUND / KILLED: if the message has a `notification` block, the OS
 *     shows it automatically. If it's data-only, the background handler runs
 *     and we display it ourselves.
 *
 * ⚠️ PRIVACY: push payloads pass through Google's and Apple's servers and can
 * appear on the lock screen. Never put diagnoses, test values or medicine
 * names in them. Send a neutral text plus an ID, e.g. "Your results are ready"
 * + { labResultId: "123" }, and let the app fetch the details from our API
 * after the user has logged in.
 */
import { Platform } from 'react-native';
import notifee from '@notifee/react-native';
import { getApps } from '@react-native-firebase/app';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  setBackgroundMessageHandler,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { CHANNELS, NotificationType } from './constants';
import { handleNotificationOpen } from './notificationRouter';

/**
 * Push needs a Firebase project config (google-services.json on Android,
 * GoogleService-Info.plist on iOS). Until those files are added, we skip push
 * setup instead of crashing, so the local notification demo still works.
 */
export function isFirebaseConfigured(): boolean {
  try {
    return getApps().length > 0;
  } catch {
    return false;
  }
}

/** Chooses the Android channel based on the clinical type in the payload. */
function channelForType(type?: string): string {
  switch (type) {
    case NotificationType.VITALS_ALERT:
    case NotificationType.DOCTOR_MESSAGE:
      return CHANNELS.HEALTH_ALERT;
    case NotificationType.APPOINTMENT_REMINDER:
      return CHANNELS.APPOINTMENT;
    case NotificationType.MEDICATION_REMINDER:
      return CHANNELS.MEDICATION;
    default:
      return CHANNELS.GENERAL;
  }
}

/**
 * Shows an FCM message as a visible notification using Notifee.
 *
 * Used in two cases where the OS won't show it for us: a message arriving
 * while the app is open, and a data-only message arriving in the background.
 * Going through Notifee also gives push messages the same channels, colors
 * and tap handling as our local notifications.
 */
export async function displayRemoteMessage(message: RemoteMessage) {
  const data = (message.data ?? {}) as Record<string, string>;

  // The backend can send text in the `notification` block or, for data-only
  // messages, in `data.title` / `data.body`. Support both.
  const title = message.notification?.title ?? data.title ?? 'Health update';
  const body = message.notification?.body ?? data.body ?? '';

  await notifee.displayNotification({
    // Reusing the FCM message ID means a duplicate delivery replaces the
    // existing notification instead of showing it twice.
    id: message.messageId,
    title,
    body,
    data,
    android: {
      channelId: channelForType(data.type),
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
    ios: { sound: 'default' },
  });
}

/**
 * Sends the device token to our backend so it can target this phone.
 *
 * In a real app this is an authenticated call, so the backend knows which
 * patient the token belongs to. Remove the token on logout as well, or the
 * next person to log in on this phone could receive the previous patient's
 * notifications.
 */
async function registerTokenWithBackend(token: string): Promise<void> {
  console.log('[Push] FCM token (send this to your backend):', token);

  // Example of what the real call would look like:
  // await fetch('https://api.example-health.com/v1/devices', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     Authorization: `Bearer ${accessToken}`,
  //   },
  //   body: JSON.stringify({ token, platform: Platform.OS }),
  // });
}

/**
 * Asks for permission, gets the FCM token and registers it with the backend.
 * Returns the token so the demo screen can show it. You can paste it into the
 * Firebase console ("Send test message") to send a real push to this device.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!isFirebaseConfigured()) {
    console.warn('[Push] Firebase is not configured, skipping push setup.');
    return null;
  }

  const messaging = getMessaging();

  // On iOS this shows the system prompt. On Android 13+ the permission is
  // POST_NOTIFICATIONS, which we already request through Notifee.
  const status = await requestPermission(messaging);
  const allowed =
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL;
  if (!allowed) {
    console.warn('[Push] User denied notification permission.');
    return null;
  }

  const token = await getToken(messaging);
  await registerTokenWithBackend(token);
  return token;
}

/**
 * Subscribes to push events while the app is running. Call it once from the
 * root component. It returns a cleanup function that removes the listeners.
 */
export function subscribeToPushEvents(): () => void {
  if (!isFirebaseConfigured()) {
    return () => {};
  }

  const messaging = getMessaging();

  // FOREGROUND: a message arrived while the user is looking at the app.
  // Without this the message would be received but nothing would appear.
  const unsubscribeMessage = onMessage(messaging, async message => {
    console.log('[Push] Foreground message:', message);
    await displayRemoteMessage(message);
  });

  // FCM can rotate the token (after a reinstall, restore or cleared data).
  // Send the new one to the backend, or pushes to this device will stop.
  const unsubscribeToken = onTokenRefresh(messaging, registerTokenWithBackend);

  // BACKGROUND → FOREGROUND: the user tapped a notification that the OS
  // displayed while the app was in the background.
  const unsubscribeOpened = onNotificationOpenedApp(messaging, message => {
    handleNotificationOpen(message.data as Record<string, string>);
  });

  // KILLED → LAUNCHED: the app was fully closed and a tap on an OS-displayed
  // push started it. This only resolves once, on cold start.
  getInitialNotification(messaging).then(message => {
    if (message) {
      handleNotificationOpen(message.data as Record<string, string>);
    }
  });

  return () => {
    unsubscribeMessage();
    unsubscribeToken();
    unsubscribeOpened();
  };
}

/**
 * Background / killed-state handler for push messages.
 *
 * It has to be registered outside React, in index.js, before the app is
 * registered: when a message arrives while the app is killed, the OS starts
 * the JS engine headless (without UI) and only runs this function.
 * Keep it short; the OS gives it roughly 30 seconds.
 */
export function registerBackgroundPushHandler(): void {
  if (!isFirebaseConfigured()) {
    return;
  }

  setBackgroundMessageHandler(getMessaging(), async message => {
    console.log('[Push] Background message:', message);

    // If the message has a `notification` block, the OS has already shown it.
    // Displaying it again would show the patient a duplicate.
    if (!message.notification) {
      await displayRemoteMessage(message);
    }
  });
}

/**
 * DEMO ONLY: builds fake FCM messages and runs them through the same display
 * code as real pushes. This lets you see how a push looks before Firebase is
 * set up. A real push comes from your backend or the Firebase console.
 */
export async function simulateIncomingPush(
  type: NotificationType.LAB_RESULT_READY | NotificationType.DOCTOR_MESSAGE,
): Promise<void> {
  const samples: Record<string, RemoteMessage> = {
    [NotificationType.LAB_RESULT_READY]: {
      messageId: `demo-lab-${Date.now()}`,
      // Notice the neutral wording: no test name or values (see PRIVACY above).
      notification: {
        title: '🧪 Your lab results are ready',
        body: 'Tap to view your latest report securely.',
      },
      data: { type: NotificationType.LAB_RESULT_READY, labResultId: 'LR-1024' },
      fcmOptions: {},
    },
    [NotificationType.DOCTOR_MESSAGE]: {
      messageId: `demo-msg-${Date.now()}`,
      notification: {
        title: '👩‍⚕️ New message from your care team',
        body: 'Dr. Silva replied to your question.',
      },
      data: { type: NotificationType.DOCTOR_MESSAGE, threadId: 'T-77' },
      fcmOptions: {},
    },
  };

  await displayRemoteMessage(samples[type]);
}

export const pushPlatformNote =
  Platform.OS === 'ios'
    ? 'iOS: push only works on a real device with the Push Notifications capability and an APNs key uploaded to Firebase.'
    : 'Android: push works on emulators that have Google Play services.';
