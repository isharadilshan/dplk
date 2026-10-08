/* eslint-env jest */
/**
 * Native notification modules don't exist in the Jest (Node) environment, so
 * we replace them with mocks to let components that use them render in tests.
 */

// Notifee ships an official mock.
jest.mock('@notifee/react-native', () =>
  require('@notifee/react-native/jest-mock'),
);

// Firebase isn't configured in tests, which makes push setup a no-op.
jest.mock('@react-native-firebase/app', () => ({
  getApps: jest.fn(() => []),
}));

jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2, DENIED: 0 },
  getMessaging: jest.fn(),
  getToken: jest.fn(),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  onTokenRefresh: jest.fn(() => jest.fn()),
  requestPermission: jest.fn(),
  setBackgroundMessageHandler: jest.fn(),
}));

// Our own Turbo Module (src/specs/NativeHealthSync.ts) has no native side in Jest.
jest.mock('./src/specs/NativeHealthSync', () => ({
  __esModule: true,
  default: {
    requestHealthPermissions: jest.fn(() => Promise.resolve(true)),
    schedulePeriodicSync: jest.fn(() => Promise.resolve()),
    runSyncNow: jest.fn(() => Promise.resolve()),
    cancelScheduledWork: jest.fn(() => Promise.resolve()),
    enableHealthBackgroundDelivery: jest.fn(() => Promise.resolve(false)),
    startLiveSession: jest.fn(() => Promise.resolve()),
    stopLiveSession: jest.fn(() => Promise.resolve()),
    getWearableStatus: jest.fn(() =>
      Promise.resolve({
        supported: false,
        paired: false,
        appInstalled: false,
        reachable: false,
      }),
    ),
    simulateWearableSample: jest.fn(),
    getPendingSampleCount: jest.fn(() => Promise.resolve(0)),
    getActivityLog: jest.fn(() => Promise.resolve([])),
    clearActivityLog: jest.fn(() => Promise.resolve()),
    onHealthEvent: jest.fn(() => ({ remove: jest.fn() })),
  },
}));
