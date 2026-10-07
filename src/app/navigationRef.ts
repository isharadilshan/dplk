import { createNavigationContainerRef } from '@react-navigation/native';

export type AppStackParamList = {
  Main: undefined;
  NotificationDetail: { type: string; data: Record<string, string> };
};

/**
 * A navigation handle that works outside React components.
 *
 * Notification taps are reported by listeners that aren't inside any screen,
 * so they can't use the `navigation` prop. This ref lets them navigate anyway.
 */
export const navigationRef = createNavigationContainerRef<AppStackParamList>();
