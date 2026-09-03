import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Heading, Loading, Screen, Toast } from '@/components/ui';
import { SHIFT_TIME_LABEL, TOUCH_TARGET, colors, space, type } from '@/constants/theme';
import { formatDate, formatTime } from '@/lib/format';
import { ActivityRow, listActivities } from '@/lib/queue';

/**
 * The shift's activity log (doc 03 §3.3).
 *
 * Shows the whole shift, not just this handset: three phones share an account,
 * and an operator writing the handover needs what the other two recorded as
 * much as their own (doc 02 §4).
 *
 * Grouped by day and ordered by when the work happened rather than when it was
 * typed — someone recording twenty minutes late still expects it to land in the
 * right place in the story.
 */
type Filter = 'ALL' | 'OPERATOR' | 'KONTRAKTOR';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Semua' },
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'KONTRAKTOR', label: 'Kontraktor' },
];

export default function ActivitiesScreen() {
  const { saved } = useLocalSearchParams<{ saved?: string }>();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [toast, setToast] = useState<string | null>(saved ?? null);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const data = await listActivities();
      if (!ignore) setRows(data);
    })();
    return () => { ignore = true; };
  }, []));

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === 'ALL' || r.type === filter),
    [rows, filter],
  );

  // Day headings, so a shift that crosses midnight does not read as one blur.
  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    for (const row of visible) {
      const day = formatDate(row.activityAt);
      const list = map.get(day) ?? [];
      list.push(row);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <Screen>
      <Toast message={toast} onDone={() => setToast(null)} />

      <Heading sub="Dicatat di lokasi kejadian, bukan diingat sampai akhir shift.">
        Aktivitas
      </Heading>

      <Button
        title="+ Catat aktivitas"
        variant="primary"
        size="big"
        onPress={() => router.push('/(tabs)/activities/new')}
      />

      <View style={styles.filters}>
        {FILTERS.map((option) => {
          const active = filter === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setFilter(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.filter, active && styles.filterActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {rows === null ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Empty
          icon="📝"
          title={filter === 'ALL' ? 'Belum ada aktivitas' : 'Tidak ada di filter ini'}
          hint="Catat begitu selesai — jangan ditunda sampai akhir shift."
        />
      ) : (
        groups.map(([day, items]) => (
          <View key={day}>
            <Text style={styles.day}>{day}</Text>
            {items.map((row) => (
              <Card key={row.clientId}>
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <View style={styles.tags}>
                      <Text style={row.type === 'KONTRAKTOR' ? styles.tagKontraktor : styles.tagOperator}>
                        {row.type === 'KONTRAKTOR' ? 'Kontraktor' : 'Operator'}
                      </Text>
                      <Text style={styles.time}>{formatTime(row.activityAt)}</Text>
                    </View>

                    <Text style={styles.description}>{row.description}</Text>

                    <Text style={styles.meta}>
                      {[
                        row.contractorName,
                        row.unitArea,
                        row.operatorName,
                        SHIFT_TIME_LABEL[row.shiftTime] ?? row.shiftTime,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>

                  {/* Only the unsent state is worth a chip. Marking every synced
                      row would make the exceptions harder to spot, not easier. */}
                  {row.syncStatus !== 'SYNCED' && (
                    <Chip
                      value={row.syncStatus}
                      label={row.syncStatus === 'SYNC_ERROR' ? 'Ditolak' : 'Menunggu'}
                    />
                  )}
                </View>
              </Card>
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  filter: {
    minHeight: TOUCH_TARGET, paddingHorizontal: space.lg, justifyContent: 'center',
    borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { ...type.bodyStrong, color: colors.text },
  filterTextActive: { color: '#fff' },
  day: { ...type.heading, color: colors.muted, marginTop: space.lg, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  grow: { flex: 1 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
  tagOperator: { ...type.caption, color: colors.accent, fontWeight: '700' },
  tagKontraktor: { ...type.caption, color: colors.warn, fontWeight: '700' },
  time: { ...type.caption, color: colors.muted },
  description: { ...type.bodyStrong, color: colors.text },
  meta: { ...type.caption, color: colors.muted, marginTop: 2 },
});
