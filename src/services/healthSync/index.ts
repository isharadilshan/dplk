/**
 * JS entry point for background health data collection.
 *
 * The heavy lifting is native, because schedulers, HealthKit, Health Connect
 * and watch links must work while JS isn't running at all:
 *   Android → android/app/src/main/java/com/testhello/healthsync/
 *   iOS     → ios/testhello/HealthSync/
 *
 * JS only acts as the remote control: start and stop things, and show the
 * activity log.
 */
import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import NativeHealthSync, {
  type HealthEvent,
  type WearableStatus,
} from '../../specs/NativeHealthSync';

export type { HealthEvent, WearableStatus };
export { NativeHealthSync as HealthSync };

/**
 * Android only: runtime permissions the live session needs BEFORE the
 * foreground service starts. Android 14+ throws a SecurityException if a
 * "health" foreground service starts without ACTIVITY_RECOGNITION (or
 * BODY_SENSORS). POST_NOTIFICATIONS lets its ongoing notification show.
 * iOS needs nothing extra, since the session runs on the watch.
 */
async function ensureLiveSessionPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const wanted: Permission[] = [
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
  ];
  if (Platform.Version >= 33) {
    wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return (
    result[PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION] ===
    PermissionsAndroid.RESULTS.GRANTED
  );
}

export async function startLiveSession(): Promise<void> {
  if (!(await ensureLiveSessionPermissions())) {
    throw new Error(
      'Physical activity permission is required for a live session.',
    );
  }
  await NativeHealthSync.startLiveSession();
}

/**
 * Typical setup after login: ask for health permissions, then turn on every
 * background mechanism the platform supports.
 */
export async function setUpBackgroundHealthSync(): Promise<void> {
  const granted = await NativeHealthSync.requestHealthPermissions();
  if (!granted) {
    return;
  }
  // Android: WorkManager periodic job. iOS: BGTask requests.
  await NativeHealthSync.schedulePeriodicSync(15);
  // iOS: HealthKit wakes us on new data. Android: no-op (resolves false).
  await NativeHealthSync.enableHealthBackgroundDelivery();
}

/** Human-readable explanation of how each platform collects in the background. */
export const platformSummary =
  Platform.OS === 'ios'
    ? {
        scheduler: 'BGTaskScheduler: iOS decides when to run (often hours).',
        healthStore:
          'HealthKit background delivery: iOS wakes the app when new samples are saved.',
        session:
          'Starts an HKWorkoutSession on the Apple Watch, which streams heart rate over WCSession.',
        wearable: 'WatchConnectivity (WCSession)',
      }
    : {
        scheduler:
          'WorkManager: runs at most every 15 min, with constraints and retries.',
        healthStore:
          'Health Connect has no push. WorkManager polls it with a changes token.',
        session:
          'A foreground service (type=health) reads the step sensor with a visible notification.',
        wearable: 'Wearable Data Layer (MessageClient / DataClient)',
      };
