/**
 * Shared identifiers for the notification system.
 *
 * Keeping these in one place means the code that *creates* a notification
 * and the code that *reacts* to a tap on it always agree on the same strings.
 */

/**
 * Android notification channels.
 *
 * Since Android 8, every notification must belong to a channel. The user can
 * mute or change each channel independently in system settings, so we split
 * them by clinical importance instead of using one generic channel. A user can
 * silence "General updates" without ever missing a medication dose.
 */
export const CHANNELS = {
  MEDICATION: 'medication-reminders',
  APPOINTMENT: 'appointment-reminders',
  HEALTH_ALERT: 'health-alerts',
  GENERAL: 'general-updates',
} as const;

/**
 * The kind of health event a notification represents. It travels in the
 * notification's `data` payload (for both local and push notifications) and
 * decides which screen opens when the user taps it.
 */
export enum NotificationType {
  MEDICATION_REMINDER = 'MEDICATION_REMINDER',
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
  LAB_RESULT_READY = 'LAB_RESULT_READY',
  VITALS_ALERT = 'VITALS_ALERT',
  DOCTOR_MESSAGE = 'DOCTOR_MESSAGE',
}

/**
 * Interactive buttons shown on a notification. The user can act without
 * opening the app, which matters for adherence: "Mark as taken" is one tap.
 */
export const ACTIONS = {
  MARK_TAKEN: 'mark-taken',
  SNOOZE: 'snooze',
} as const;

/** iOS needs action buttons grouped into a "category" registered up front. */
export const IOS_CATEGORIES = {
  MEDICATION: 'medication-category',
} as const;

/** How long "Snooze" pushes a medication reminder back. */
export const SNOOZE_MINUTES = 10;
