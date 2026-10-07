import { Platform } from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidNotificationSetting,
  AndroidVisibility,
  AuthorizationStatus,
} from '@notifee/react-native';
import { ACTIONS, CHANNELS, IOS_CATEGORIES } from './constants';

/**
 * Creates the Android channels. Safe to call on every launch: creating a
 * channel that already exists is a no-op, but note that once a channel exists
 * the user owns its settings and the app can no longer change its importance.
 */
export async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  await notifee.createChannels([
    {
      id: CHANNELS.MEDICATION,
      name: 'Medication reminders',
      description: 'Reminders to take your scheduled medicines',
      // HIGH importance shows a heads-up banner and plays a sound.
      importance: AndroidImportance.HIGH,
      // PRIVATE hides the content on a locked screen. The name of a medicine
      // is health information and shouldn't be readable by anyone nearby.
      visibility: AndroidVisibility.PRIVATE,
      vibration: true,
    },
    {
      id: CHANNELS.APPOINTMENT,
      name: 'Appointment reminders',
      description: 'Upcoming doctor visits and tele-consultations',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: CHANNELS.HEALTH_ALERT,
      name: 'Health alerts',
      description: 'Abnormal vitals and urgent messages from your care team',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PRIVATE,
      vibration: true,
      vibrationPattern: [300, 500, 300, 500],
      lights: true,
    },
    {
      id: CHANNELS.GENERAL,
      name: 'General updates',
      description: 'Lab results ready, health tips and other updates',
      // DEFAULT importance: sound and status-bar icon, but no heads-up banner.
      importance: AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PRIVATE,
    },
  ]);
}

/**
 * Registers the iOS category that adds "Taken" / "Snooze" buttons to
 * medication reminders. Android declares its buttons per notification instead.
 */
export async function registerIosCategories(): Promise<void> {
  if (Platform.OS !== 'ios') {
    return;
  }

  await notifee.setNotificationCategories([
    {
      id: IOS_CATEGORIES.MEDICATION,
      actions: [
        { id: ACTIONS.MARK_TAKEN, title: '✅ Mark as taken' },
        { id: ACTIONS.SNOOZE, title: `⏰ Snooze` },
      ],
    },
  ]);
}

/**
 * Asks the user for permission to show notifications.
 *
 * - iOS: always needs an explicit prompt.
 * - Android 13+ (API 33): needs the POST_NOTIFICATIONS runtime permission.
 * - Android 12 and lower: granted at install time, this resolves immediately.
 *
 * Best practice: call this after explaining *why* (e.g. "so we can remind you
 * about your medicines"), not on the very first screen. The OS only lets you
 * show the system prompt once; after a denial the user has to go to Settings.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission({
    alert: true,
    badge: true,
    sound: true,
    // Critical alerts can bypass Do Not Disturb, which makes sense for e.g. a
    // dangerously low glucose reading. They need a special entitlement that
    // Apple grants only to approved health apps, so it's off here.
    criticalAlert: false,
  });

  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

/**
 * On Android 12+, exact alarms (firing at precisely 8:00, even in Doze mode)
 * need the SCHEDULE_EXACT_ALARM permission, which the user can turn off.
 * Without it, Android may delay a reminder by several minutes to save battery.
 */
export async function canScheduleExactAlarms(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const settings = await notifee.getNotificationSettings();
  return settings.android.alarm === AndroidNotificationSetting.ENABLED;
}

/** Opens the system screen where the user can allow exact alarms. */
export function openExactAlarmSettings(): Promise<void> {
  return notifee.openAlarmPermissionSettings();
}

/**
 * One-time setup run at app start. It creates the channels and categories
 * before any notification is shown, since a notification posted to a channel
 * that doesn't exist yet is silently dropped on Android.
 */
export async function initializeNotifications(): Promise<void> {
  await createChannels();
  await registerIosCategories();
}
