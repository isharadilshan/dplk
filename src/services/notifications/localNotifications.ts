/**
 * LOCAL NOTIFICATIONS
 * ===================
 * Created and scheduled by the app itself, on the device. No server or
 * internet connection is involved, so the OS fires them even in airplane mode
 * or after the app has been closed.
 *
 * Good for things the app already knows ahead of time:
 *   - Medication schedules ("Take Metformin 500mg at 8:00 every day")
 *   - Appointment reminders ("Dr. Perera in 1 hour")
 *   - Device-detected events (a paired monitor reads a high heart rate)
 *
 * Compare with push notifications (pushNotifications.ts), which come from a
 * server and are for things only the server knows, like new lab results.
 */
import { Platform } from 'react-native';
import notifee, {
  AndroidStyle,
  RepeatFrequency,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';
import {
  ACTIONS,
  CHANNELS,
  IOS_CATEGORIES,
  NotificationType,
  SNOOZE_MINUTES,
} from './constants';
import { canScheduleExactAlarms } from './setup';

export interface Medication {
  id: string;
  name: string;
  dosage: string;
}

export interface Appointment {
  id: string;
  doctorName: string;
  specialty: string;
  location: string;
  startsAt: Date;
}

/**
 * Builds the trigger that tells the OS *when* to fire a scheduled notification.
 *
 * Uses Android's AlarmManager when exact alarms are allowed, so a dose
 * reminder fires on time even while the phone is in Doze. Otherwise it falls
 * back to the default scheduler, which may run a few minutes late.
 */
async function buildTimestampTrigger(
  date: Date,
  repeatFrequency?: RepeatFrequency,
): Promise<TimestampTrigger> {
  const exact = await canScheduleExactAlarms();
  return {
    type: TriggerType.TIMESTAMP,
    timestamp: date.getTime(),
    repeatFrequency,
    alarmManager: exact ? { allowWhileIdle: true } : undefined,
  };
}

/**
 * 1) IMMEDIATE local notification: shown as soon as it's called.
 *
 * Example: a paired blood-pressure cuff reports a high reading. The app works
 * this out on the device, so there's no need to round-trip through a server.
 */
export async function showVitalsAlert(
  systolic: number,
  diastolic: number,
): Promise<string> {
  return notifee.displayNotification({
    title: '⚠️ High blood pressure reading',
    body: `Your latest reading is ${systolic}/${diastolic} mmHg. Rest for 5 minutes and measure again.`,
    // `data` is invisible to the user. We read it back when they tap the
    // notification to decide which screen to open. Values must be strings.
    data: {
      type: NotificationType.VITALS_ALERT,
      systolic: String(systolic),
      diastolic: String(diastolic),
    },
    android: {
      channelId: CHANNELS.HEALTH_ALERT,
      smallIcon: 'ic_launcher', // Use a monochrome icon in production.
      color: '#D32F2F',
      // Without pressAction, tapping the notification wouldn't open the app.
      pressAction: { id: 'default' },
    },
    ios: {
      // 'timeSensitive' can break through Focus modes, which fits a health
      // alert. It needs the Time Sensitive capability in Xcode.
      interruptionLevel: 'timeSensitive',
      sound: 'default',
    },
  });
}

/**
 * 2) SCHEDULED + REPEATING local notification: a daily medication reminder.
 *
 * The OS stores the schedule, so it keeps firing after the app is killed.
 * The notification ID comes from the medication ID, which lets us update or
 * cancel this one reminder later, e.g. when the doctor stops the medicine.
 */
export async function scheduleDailyMedicationReminder(
  medication: Medication,
  hour: number,
  minute: number,
): Promise<string> {
  // Find the next occurrence of HH:MM. If today's time has already passed,
  // start tomorrow, because a trigger in the past would throw an error.
  const firstDose = new Date();
  firstDose.setHours(hour, minute, 0, 0);
  if (firstDose.getTime() <= Date.now()) {
    firstDose.setDate(firstDose.getDate() + 1);
  }

  const trigger = await buildTimestampTrigger(firstDose, RepeatFrequency.DAILY);
  return notifee.createTriggerNotification(
    buildMedicationNotification(medication, `med-${medication.id}`),
    trigger,
  );
}

/**
 * Same medication reminder, but a few seconds from now, so you can watch a
 * scheduled notification arrive during a demo without waiting until 8:00.
 * Tip: send the app to the background or lock the phone before it fires.
 */
export async function scheduleMedicationReminderIn(
  medication: Medication,
  seconds: number,
): Promise<string> {
  const trigger = await buildTimestampTrigger(
    new Date(Date.now() + seconds * 1000),
  );
  return notifee.createTriggerNotification(
    buildMedicationNotification(medication, `med-demo-${medication.id}`),
    trigger,
  );
}

/**
 * Builds the medication notification with "Mark as taken" / "Snooze" buttons.
 * Both buttons are handled in notificationEvents.ts, without opening the app.
 */
function buildMedicationNotification(medication: Medication, id: string) {
  return {
    id,
    title: '💊 Time for your medication',
    body: `${medication.name} ${medication.dosage}`,
    data: {
      type: NotificationType.MEDICATION_REMINDER,
      medicationId: medication.id,
      medicationName: medication.name,
      dosage: medication.dosage,
    },
    android: {
      channelId: CHANNELS.MEDICATION,
      smallIcon: 'ic_launcher',
      color: '#1976D2',
      pressAction: { id: 'default' },
      actions: [
        // No `launchActivity` here, so these run in the background without
        // bringing the app to the foreground.
        { title: '✅ Mark as taken', pressAction: { id: ACTIONS.MARK_TAKEN } },
        { title: '⏰ Snooze', pressAction: { id: ACTIONS.SNOOZE } },
      ],
    },
    ios: {
      // Links this notification to the category registered in setup.ts,
      // which is how iOS knows to show the action buttons.
      categoryId: IOS_CATEGORIES.MEDICATION,
      sound: 'default',
    },
  };
}

/**
 * Handles the "Snooze" button: shows the same medication reminder again
 * SNOOZE_MINUTES from now. Called from notificationEvents.ts.
 */
export async function snoozeMedicationReminder(
  data: Record<string, string | number | object>,
): Promise<void> {
  const medication: Medication = {
    id: String(data.medicationId),
    name: String(data.medicationName),
    dosage: String(data.dosage),
  };
  const trigger = await buildTimestampTrigger(
    new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000),
  );
  await notifee.createTriggerNotification(
    buildMedicationNotification(medication, `med-snooze-${medication.id}`),
    trigger,
  );
}

/**
 * 3) SCHEDULED one-off notification: an appointment reminder 1 hour before.
 */
export async function scheduleAppointmentReminder(
  appointment: Appointment,
  minutesBefore = 60,
): Promise<string | null> {
  const remindAt = new Date(
    appointment.startsAt.getTime() - minutesBefore * 60 * 1000,
  );

  // Don't schedule reminders for a time that has already passed.
  if (remindAt.getTime() <= Date.now()) {
    return null;
  }

  const time = appointment.startsAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return notifee.createTriggerNotification(
    {
      id: `appt-${appointment.id}`,
      title: '📅 Upcoming appointment',
      body: `${appointment.doctorName} (${appointment.specialty}) at ${time}`,
      data: {
        type: NotificationType.APPOINTMENT_REMINDER,
        appointmentId: appointment.id,
      },
      android: {
        channelId: CHANNELS.APPOINTMENT,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
        // BigText lets the user read the full details by expanding the
        // notification, without opening the app.
        style: {
          type: AndroidStyle.BIGTEXT,
          text: `${appointment.doctorName} – ${appointment.specialty}\n${time} at ${appointment.location}\nPlease bring your previous reports.`,
        },
      },
    },
    await buildTimestampTrigger(remindAt),
  );
}

/** Lists every scheduled notification that hasn't fired yet. */
export async function getScheduledNotifications() {
  return notifee.getTriggerNotifications();
}

/** Cancels one reminder, e.g. when a prescription ends. */
export function cancelNotification(notificationId: string): Promise<void> {
  return notifee.cancelNotification(notificationId);
}

/**
 * Cancels everything: both the schedules and the notifications currently in
 * the tray. Call this on logout so the next person using the phone doesn't
 * get the previous patient's reminders.
 */
export async function cancelAllNotifications(): Promise<void> {
  await notifee.cancelAllNotifications();
  if (Platform.OS === 'ios') {
    await notifee.setBadgeCount(0);
  }
}
