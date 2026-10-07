import { ScrollView, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../app/navigationRef';
import { NotificationType } from '../services/notifications';

type Props = NativeStackScreenProps<AppStackParamList, 'NotificationDetail'>;

// What the patient would see in a full app for each notification type.
const DESCRIPTIONS: Record<string, string> = {
  [NotificationType.MEDICATION_REMINDER]:
    'Would open the medication schedule, where you can log this dose.',
  [NotificationType.APPOINTMENT_REMINDER]:
    'Would open the appointment with directions and check-in.',
  [NotificationType.LAB_RESULT_READY]:
    'Would fetch the report from the secure API using labResultId. The result itself is never in the push payload.',
  [NotificationType.VITALS_ALERT]:
    'Would show the reading history and the option to contact your doctor.',
  [NotificationType.DOCTOR_MESSAGE]:
    'Would open the chat thread with your care team.',
};

/**
 * Opens when the user taps a notification. It shows the `data` payload that
 * came with the notification, so you can see exactly what reached the app.
 */
export function NotificationDetailScreen({ route }: Props) {
  const { type, data } = route.params;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Opened from notification</Text>
      <Text style={styles.type}>{type}</Text>
      <Text style={styles.body}>{DESCRIPTIONS[type] ?? 'Unknown type.'}</Text>
      <Text style={styles.label}>Payload (notification.data)</Text>
      <Text style={styles.code}>{JSON.stringify(data, null, 2)}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8 },
  label: {
    fontSize: 12,
    color: '#777',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  type: { fontSize: 20, fontWeight: '700', color: '#0D47A1' },
  body: { fontSize: 15, color: '#333' },
  code: {
    fontFamily: 'Courier',
    fontSize: 13,
    backgroundColor: '#F1F5F9',
    padding: 12,
    borderRadius: 8,
  },
});
