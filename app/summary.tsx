import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Empty, Loading, Screen } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { formatDate, formatTime } from '@/lib/format';
import { ShiftSummary, shiftSummary } from '@/lib/queue';
import { Session, getSession } from '@/lib/session';

/**
 * End-of-shift summary (doc 02 §4, doc 03 §3.3).
 *
 * The handover document. An operator reads this while writing the control-room
 * board, so it is laid out to be read aloud from top to bottom and to survive
 * being screenshotted and sent to someone: no controls, no filters, nothing
 * that changes what it says depending on where you tapped.
 *
 * It covers the whole shift, not this handset. Three phones share an account,
 * and the pull window brings back what the other two recorded (doc 07 §5).
 */
const KIND_LABEL: Record<string, string> = {
  READING: 'Ukur',
  ACTIVITY: 'Aktivitas',
  CLEANING: 'Bersih',
  EQUIPMENT: 'Alat',
  TASK: 'Task',
};

const KIND_COLOR: Record<string, string> = {
  READING: colors.accent,
  ACTIVITY: colors.ok,
  CLEANING: colors.warn,
  // A pump that changed status is the line on this page the next shift is most
  // likely to act on, so it is the one that reads as an alarm.
  EQUIPMENT: colors.danger,
  TASK: colors.neutral,
};

export default function SummaryScreen() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<ShiftSummary | null>(null);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const current = await getSession();
      if (ignore) return;
      setSession(current);
      if (!current) return;
      const summary = await shiftSummary(current.shiftName, current.shiftTime);
      if (!ignore) setData(summary);
    })();
    return () => { ignore = true; };
  }, []));

  if (session === undefined) return <Screen><Loading /></Screen>;
  if (!session) {
    return (
      <Screen>
        <Empty icon="🔒" title="Belum login" hint="Rangkuman mengikuti shift yang sedang login." />
      </Screen>
    );
  }
  if (!data) return <Screen><Loading /></Screen>;

  const unsent = data.entries.filter((e) => e.unsent).length;

  return (
    <Screen>
      <View style={styles.masthead}>
        <Text style={styles.shift}>
          {session.shiftName} · {SHIFT_TIME_LABEL[session.shiftTime] ?? session.shiftTime}
        </Text>
        <Text style={styles.day}>{formatDate(new Date().toISOString())}</Text>
        <Text style={styles.crew}>Operator: {session.operatorName}</Text>
      </View>

      <Card>
        <View style={styles.stats}>
          <Stat value={data.readings} label="Pengukuran" />
          <Stat value={data.activities} label="Aktivitas" />
          <Stat value={data.cleaning} label="Bersih-bersih" />
        </View>

        {/* Second row rather than five across: at the 16pt floor five columns
            wrap into unreadable stacks on a narrow handset. */}
        {(data.equipmentChanges > 0 || data.taskUpdates > 0) && (
          <View style={styles.stats}>
            <Stat value={data.equipmentChanges} label="Status alat" />
            <Stat value={data.taskUpdates} label="Progres task" />
          </View>
        )}

        {/* Both of these are things the next shift inherits, so they are said
            here rather than left for someone to notice. */}
        {data.unfinishedCleaning > 0 && (
          <Text style={styles.warn}>
            {data.unfinishedCleaning} sesi bersih-bersih belum selesai — foto sesudah belum diambil.
          </Text>
        )}
        {unsent > 0 && (
          <Text style={styles.warn}>
            {unsent} catatan belum terkirim ke server.
          </Text>
        )}
      </Card>

      <Text style={styles.sectionTitle}>Urutan kejadian</Text>

      {data.entries.length === 0 ? (
        <Empty
          icon="🕐"
          title="Belum ada catatan shift ini"
          hint="Pengukuran, aktivitas, bersih-bersih, status alat dan progres task akan muncul di sini."
        />
      ) : (
        data.entries.map((entry) => (
          <View key={entry.key} style={styles.row}>
            <Text style={styles.time}>{formatTime(entry.at)}</Text>
            <View style={styles.body}>
              <Text style={[styles.kind, { color: KIND_COLOR[entry.kind] }]}>
                {KIND_LABEL[entry.kind]}
              </Text>
              <Text style={styles.title}>{entry.title}</Text>
              {!!entry.detail && <Text style={styles.detail}>{entry.detail}</Text>}
              <Text style={styles.by}>
                {entry.operatorName}{entry.unsent ? ' · belum terkirim' : ''}
              </Text>
            </View>
          </View>
        ))
      )}

      <Text style={styles.footer}>
        Rangkuman 12 jam terakhir untuk shift ini, dari semua HP yang dipakai shift ini.
      </Text>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  masthead: { marginBottom: space.md },
  shift: { ...type.title, color: colors.text },
  day: { ...type.body, color: colors.muted },
  crew: { ...type.body, color: colors.muted },
  stats: { flexDirection: 'row' },
  stat: { flex: 1 },
  statValue: { ...type.display, fontSize: 30, color: colors.text },
  statLabel: { ...type.caption, color: colors.muted },
  warn: { ...type.caption, color: colors.warn, marginTop: space.sm },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.lg, marginBottom: space.sm },
  row: {
    flexDirection: 'row', gap: space.md, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  time: { ...type.bodyStrong, color: colors.text, width: 92 },
  body: { flex: 1 },
  kind: { ...type.caption, fontWeight: '700' },
  title: { ...type.bodyStrong, color: colors.text },
  detail: { ...type.caption, color: colors.muted },
  by: { ...type.caption, color: colors.muted, marginTop: 2 },
  footer: { ...type.caption, color: colors.muted, marginTop: space.lg },
});
