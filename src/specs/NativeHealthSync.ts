/**
 * Turbo Module spec: the typed contract between JS and the native background
 * health-sync code.
 *
 * React Native's codegen reads this file at build time and generates:
 *   - Android: an abstract `NativeHealthSyncSpec` Kotlin/Java class that
 *     HealthSyncModule.kt extends.
 *   - iOS: an ObjC++ `NativeHealthSyncSpec` protocol that RCTNativeHealthSync.mm
 *     implements.
 * If the native side doesn't match this file, the build fails, which catches
 * mistakes at compile time instead of at runtime.
 *
 * The file name must start with "Native" for codegen to pick it up.
 */
import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * One entry in the background activity log. Every scheduler run, health
 * sample batch or wearable message produces one, so you can see what ran
 * while the app was closed.
 */
export type HealthEvent = {
  /** 'scheduler' | 'health-store' | 'wearable' | 'session' | 'upload' | 'error' */
  kind: string;
  /** e.g. 'WorkManager', 'BGAppRefreshTask', 'HealthKit', 'WCSession' */
  source: string;
  message: string;
  /** Unix epoch in milliseconds. */
  timestamp: number;
  /** 'foreground' or 'background': the app state when this happened. */
  appState: string;
};

export type WearableStatus = {
  /** The platform supports a watch connection on this device. */
  supported: boolean;
  /** A watch is paired (iOS) / a Wear OS node is connected (Android). */
  paired: boolean;
  /** Our companion app is installed on the watch. */
  appInstalled: boolean;
  /** The watch is reachable right now for live messages. */
  reachable: boolean;
};

export interface Spec extends TurboModule {
  /** Shows the HealthKit / Health Connect permission sheet. */
  requestHealthPermissions(): Promise<boolean>;

  /**
   * Registers the recurring background sync.
   * Android: WorkManager periodic work (minimum 15 minutes).
   * iOS: BGAppRefreshTask + BGProcessingTask requests (the OS picks the time).
   */
  schedulePeriodicSync(intervalMinutes: number): Promise<void>;

  /**
   * Runs one sync immediately.
   * Android: an expedited WorkManager chain (read → upload).
   * iOS: runs the same sync routine in the foreground (a BGTask can't be forced).
   */
  runSyncNow(): Promise<void>;

  /** Cancels all scheduled background work. */
  cancelScheduledWork(): Promise<void>;

  /**
   * iOS: HealthKit background delivery, so iOS wakes the app when new
   * heart-rate / step samples are saved. Android: resolves false, because
   * Health Connect has no push mechanism and must be polled (WorkManager).
   */
  enableHealthBackgroundDelivery(): Promise<boolean>;

  /**
   * Starts a live monitoring session.
   * Android: a foreground service (type "health") reading the step sensor.
   * iOS: launches the watch app's workout session via HealthKit.
   */
  startLiveSession(): Promise<void>;
  stopLiveSession(): Promise<void>;

  getWearableStatus(): Promise<WearableStatus>;

  /** DEV ONLY: feeds a fake heart-rate message through the wearable receive path. */
  simulateWearableSample(bpm: number): void;

  /** Samples collected locally but not uploaded yet. */
  getPendingSampleCount(): Promise<number>;

  /** The persisted background activity log, newest first. */
  getActivityLog(): Promise<HealthEvent[]>;
  clearActivityLog(): Promise<void>;

  /** Fires for each new log entry while the JS runtime is alive. */
  readonly onHealthEvent: CodegenTypes.EventEmitter<HealthEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeHealthSync');
