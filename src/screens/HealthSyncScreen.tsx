import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  HealthSync,
  platformSummary,
  startLiveSession,
  type HealthEvent,
  type WearableStatus,
} from '../services/healthSync';

/**
 * Demo screen for background health data collection and schedulers.
 *
 * Try this: tap "Schedule periodic sync", close the app, and come back later.
 * The activity log shows entries marked BACKGROUND, written by native code
 * while the app (and JS) wasn't running.
 */
export function HealthSyncScreen() {
  const [log, setLog] = useState<HealthEvent[]>([]);
  const [pending, setPending] = useState(0);
  const [wearable, setWearable] = useState<WearableStatus | null>(null);
  const [sessionActive, setSessionActive] = useState(false);

  // Pull the persisted log from native. This includes entries written while
  // JS wasn't running, which live events can't deliver.
  const refresh = useCallback(async () => {
    setLog(await HealthSync.getActivityLog());
    setPending(await HealthSync.getPendingSampleCount());
    setWearable(await HealthSync.getWearableStatus().catch(() => null));
  }, []);

  useEffect(() => {
    refresh();

    // Live events while the screen is open (codegen EventEmitter).
    const subscription = HealthSync.onHealthEvent(event => {
      setLog(previous => [event, ...previous].slice(0, 200));
      HealthSync.getPendingSampleCount().then(setPending);
    });

    // Coming back to the foreground: reload to show what happened while we
    // were in the background.
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });

    return () => {
      subscription.remove();
      appState.remove();
    };
  }, [refresh]);

  // Runs an action and shows any native error (missing permission, no watch,
  // missing entitlement...) instead of failing silently.
  const run = (action: () => Promise<unknown>) => async () => {
    try {
      await action();
    } catch (error) {
      Alert.alert('Not available', String((error as Error).message ?? error));
    } finally {
      refresh();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.outbox}>
        📦 Outbox: {pending} sample(s) waiting to upload
      </Text>

      <Section title="1. Health store permission" />
      <DemoButton
        title={`Connect ${
          Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'
        }`}
        subtitle="Read heart rate and steps"
        onPress={run(HealthSync.requestHealthPermissions)}
      />

      <Section title="2. Scheduler" note={platformSummary.scheduler} />
      <DemoButton
        title="Schedule periodic sync (15 min)"
        subtitle="Keeps running after the app is closed or the phone reboots"
        onPress={run(() => HealthSync.schedulePeriodicSync(15))}
      />
      <DemoButton
        title="Sync now"
        subtitle={
          Platform.OS === 'android'
            ? 'Expedited WorkManager chain: read → upload (needs network)'
            : 'Runs the sync routine in the foreground'
        }
        onPress={run(HealthSync.runSyncNow)}
      />
      <DemoButton
        title="Cancel scheduled work"
        subtitle="What you'd call on logout"
        danger
        onPress={run(HealthSync.cancelScheduledWork)}
      />

      <Section
        title="3. Health store background delivery"
        note={platformSummary.healthStore}
      />
      <DemoButton
        title="Enable background delivery"
        subtitle={
          Platform.OS === 'ios'
            ? 'HKObserverQuery + enableBackgroundDelivery'
            : 'Not supported by Health Connect (see the log)'
        }
        onPress={run(HealthSync.enableHealthBackgroundDelivery)}
      />

      <Section title="4. Live session" note={platformSummary.session} />
      <DemoButton
        title={sessionActive ? 'Stop live session' : 'Start live session'}
        subtitle={
          Platform.OS === 'android'
            ? 'Watch the ongoing notification, then walk around'
            : 'Needs a paired Apple Watch with the companion app'
        }
        onPress={run(async () => {
          if (sessionActive) {
            await HealthSync.stopLiveSession();
            setSessionActive(false);
          } else {
            await startLiveSession();
            setSessionActive(true);
          }
        })}
      />

      <Section title="5. Wearable" note={platformSummary.wearable} />
      <Text style={styles.note}>
        {wearable
          ? `Supported: ${yesNo(wearable.supported)} · Paired: ${yesNo(
              wearable.paired,
            )} · App installed: ${yesNo(
              wearable.appInstalled,
            )} · Reachable: ${yesNo(wearable.reachable)}`
          : 'Status unavailable'}
      </Text>
      <View style={styles.row}>
        <DemoButton
          title="Simulate 78 bpm"
          subtitle="Normal reading"
          onPress={run(async () => HealthSync.simulateWearableSample(78))}
        />
        <DemoButton
          title="Simulate 135 bpm"
          subtitle="Above threshold"
          danger
          onPress={run(async () => HealthSync.simulateWearableSample(135))}
        />
      </View>

      <View style={styles.logHeader}>
        <Text style={styles.sectionTitle}>Background activity log</Text>
        <Pressable onPress={run(HealthSync.clearActivityLog)}>
          <Text style={styles.link}>Clear</Text>
        </Pressable>
      </View>
      {log.length === 0 && <Text style={styles.note}>No activity yet.</Text>}
      {log.map((entry, index) => (
        <LogRow key={`${entry.timestamp}-${index}`} entry={entry} />
      ))}
    </ScrollView>
  );
}

const yesNo = (value: boolean) => (value ? '✅' : '—');

const KIND_COLORS: Record<string, string> = {
  scheduler: '#6A1B9A',
  'health-store': '#2E7D32',
  wearable: '#00838F',
  session: '#EF6C00',
  upload: '#1565C0',
  error: '#C62828',
};

function LogRow({ entry }: { entry: HealthEvent }) {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const isBackground = entry.appState === 'background';
  return (
    <View style={styles.logRow}>
      <View style={styles.logMeta}>
        <Text
          style={[
            styles.kind,
            { backgroundColor: KIND_COLORS[entry.kind] ?? '#555' },
          ]}
        >
          {entry.source}
        </Text>
        {/* BACKGROUND entries are the interesting ones: native code ran
            while the app wasn't on screen. */}
        <Text style={[styles.state, isBackground && styles.stateBackground]}>
          {isBackground ? 'BACKGROUND' : 'foreground'}
        </Text>
        <Text style={styles.time}>{time}</Text>
      </View>
      <Text style={styles.message}>{entry.message}</Text>
    </View>
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
  outbox: {
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 10,
  },
  section: { marginTop: 14, gap: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#0D47A1' },
  note: { fontSize: 13, color: '#555' },
  row: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    backgroundColor: '#1976D2',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  buttonDanger: { backgroundColor: '#C62828' },
  buttonPressed: { opacity: 0.8 },
  buttonTitle: { color: 'white', fontSize: 15, fontWeight: '600' },
  buttonSubtitle: { color: '#E3F2FD', fontSize: 12, marginTop: 2 },
  logHeader: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: { color: '#1976D2', fontWeight: '600' },
  logRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    paddingVertical: 8,
    gap: 4,
  },
  logMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kind: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  state: { fontSize: 11, color: '#777' },
  stateBackground: { color: '#EF6C00', fontWeight: '700' },
  time: { fontSize: 11, color: '#999', marginLeft: 'auto' },
  message: { fontSize: 13, color: '#222' },
});
