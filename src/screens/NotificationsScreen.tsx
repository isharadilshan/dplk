import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  NotificationType,
  cancelAllNotifications,
  canScheduleExactAlarms,
  getScheduledNotifications,
  isFirebaseConfigured,
  openExactAlarmSettings,
  pushPlatformNote,
  registerForPushNotifications,
  requestNotificationPermission,
  scheduleAppointmentReminder,
  scheduleDailyMedicationReminder,
  scheduleMedicationReminderIn,
  showVitalsAlert,
  simulateIncomingPush,
  type Medication,
} from '../services/notifications';

// Sample patient data. In a real app this comes from the prescriptions API.
const METFORMIN: Medication = {
  id: 'metformin',
  name: 'Metformin',
  dosage: '500mg – 1 tablet after breakfast',
};

/**
 * Demo screen: each button triggers one notification scenario so you can
 * compare how local and push notifications behave.
 */
export function NotificationsScreen() {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [exactAlarms, setExactAlarms] = useState(true);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<string[]>([]);

  // Show what the OS currently has scheduled, so the result of each button
  // press is visible on screen.
  const refreshScheduled = useCallback(async () => {
    const triggers = await getScheduledNotifications();
    setScheduled(
      triggers.map(t => {
        const at =
          'timestamp' in t.trigger
            ? new Date(t.trigger.timestamp).toLocaleString()
            : '';
        return `${t.notification.title} → ${at}`;
      }),
    );
    setExactAlarms(await canScheduleExactAlarms());
  }, []);

  useEffect(() => {
    refreshScheduled();
  }, [refreshScheduled]);

  // Wraps every button: run the action, refresh the list and show any error
  // (permission denied, time in the past, etc.) instead of failing silently.
  const run =
    (action: () => Promise<unknown>, success?: string) => async () => {
      try {
        await action();
        await refreshScheduled();
        if (success) {
          Alert.alert('Done', success);
        }
      } catch (error) {
        Alert.alert('Something went wrong', String(error));
      }
    };

  const onRequestPermission = run(async () => {
    const granted = await requestNotificationPermission();
    setPermissionGranted(granted);
    // Once notifications are allowed, register for push too. With Firebase not
    // configured yet this returns null and only local notifications work.
    if (granted) {
      setFcmToken(await registerForPushNotifications());
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.status}>
        Permission:{' '}
        {permissionGranted === null
          ? 'not requested yet'
          : permissionGranted
          ? '✅ granted'
          : '❌ denied (enable it in Settings)'}
      </Text>
      <DemoButton
        title="1. Allow notifications"
        subtitle="Required before anything can be shown"
        onPress={onRequestPermission}
      />

      {!exactAlarms && (
        <DemoButton
          title="Allow exact alarms (Android 12+)"
          subtitle="Without this, medication reminders may arrive a few minutes late"
          onPress={run(openExactAlarmSettings)}
        />
      )}

      <Section
        title="Local notifications"
        note="Created on the device. No server or internet needed. They still fire after the app is closed."
      />
      <DemoButton
        title="High blood pressure alert (now)"
        subtitle="Immediate: e.g. a paired BP cuff reports a high reading"
        onPress={run(() => showVitalsAlert(162, 104))}
      />
      <DemoButton
        title="Medication reminder in 10 seconds"
        subtitle="Scheduled: put the app in the background and wait. Try the Taken / Snooze buttons"
        onPress={run(
          () => scheduleMedicationReminderIn(METFORMIN, 10),
          'Reminder scheduled for 10 seconds from now. Background the app to see it.',
        )}
      />
      <DemoButton
        title="Daily medication reminder at 8:00 AM"
        subtitle="Repeating: fires every day until it's cancelled"
        onPress={run(
          () => scheduleDailyMedicationReminder(METFORMIN, 8, 0),
          'Metformin reminder set for 8:00 AM daily.',
        )}
      />
      <DemoButton
        title="Appointment reminder"
        subtitle="One-off: appointment in 62 min, so the reminder fires in 2 min"
        onPress={run(
          () =>
            scheduleAppointmentReminder({
              id: 'A-501',
              doctorName: 'Dr. Perera',
              specialty: 'Cardiology',
              location: 'City Medical Center, Room 12',
              startsAt: new Date(Date.now() + 62 * 60 * 1000),
            }),
          'You will get a reminder in about 2 minutes.',
        )}
      />

      <Section
        title="Push notifications"
        note={`Sent by the backend through Firebase Cloud Messaging. ${pushPlatformNote}`}
      />
      <Text style={styles.status}>
        Firebase:{' '}
        {isFirebaseConfigured()
          ? '✅ configured'
          : '⚠️ not configured (add google-services.json / GoogleService-Info.plist)'}
      </Text>
      {fcmToken && (
        // `selectable` lets you long-press to copy the token, then paste it in
        // Firebase console → Messaging → "Send test message".
        <Text selectable style={styles.token}>
          FCM token: {fcmToken}
        </Text>
      )}
      <DemoButton
        title="Simulate push: Lab results ready"
        subtitle="Runs a fake FCM message through the real display code"
        onPress={run(() =>
          simulateIncomingPush(NotificationType.LAB_RESULT_READY),
        )}
      />
      <DemoButton
        title="Simulate push: Doctor message"
        subtitle="Uses the high-importance Health alerts channel"
        onPress={run(() =>
          simulateIncomingPush(NotificationType.DOCTOR_MESSAGE),
        )}
      />

      <Section title={`Scheduled (${scheduled.length})`} />
      {scheduled.length === 0 ? (
        <Text style={styles.note}>Nothing scheduled.</Text>
      ) : (
        scheduled.map(item => (
          <Text key={item} style={styles.note}>
            • {item}
          </Text>
        ))
      )}
      <DemoButton
        title="Cancel all notifications"
        subtitle="What you'd call on logout, so the next user doesn't see this patient's reminders"
        danger
        onPress={run(cancelAllNotifications, 'All notifications cancelled.')}
      />
    </ScrollView>
  );
}

function Section({ title, note }: { title: string; note?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

function DemoButton({
  title,
  subtitle,
  onPress,
  danger,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        danger && styles.buttonDanger,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonTitle}>{title}</Text>
      <Text style={styles.buttonSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 40 },
  section: { marginTop: 16, gap: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#0D47A1' },
  note: { fontSize: 13, color: '#555' },
  status: { fontSize: 14, color: '#333' },
  token: { fontSize: 11, color: '#1565C0', fontFamily: 'Courier' },
  button: {
    backgroundColor: '#1976D2',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  buttonDanger: { backgroundColor: '#C62828' },
  buttonPressed: { opacity: 0.8 },
  buttonTitle: { color: 'white', fontSize: 15, fontWeight: '600' },
  buttonSubtitle: { color: '#E3F2FD', fontSize: 12, marginTop: 2 },
});
