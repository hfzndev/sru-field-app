import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { ICON } from '@/components/icon';
import {
  Button, Empty, Heading, ListGroup, ListRow, Loading, Screen, SectionTitle, Toast, UnsentMark,
} from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
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
        <Choice
          layout="wrap"
          value={filter}
          onChange={(v) => setFilter((v ?? 'ALL') as Filter)}
          accessibilityLabel="Saring aktivitas"
          testID="activity-filter"
          options={FILTERS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </View>

      {rows === null ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Empty
          icon={ICON.activity}
          title={filter === 'ALL' ? 'Belum ada aktivitas' : 'Tidak ada di filter ini'}
          hint="Catat begitu selesai — jangan ditunda sampai akhir shift."
        />
      ) : (
        groups.map(([day, items]) => (
          <View key={day}>
            <SectionTitle count={items.length}>{day}</SectionTitle>
            <ListGroup>
              {items.map((row) => {
                const kontraktor = row.type === 'KONTRAKTOR';
                return (
                  <ListRow
                    key={row.clientId}
                    icon={kontraktor ? ICON.contractor : ICON.operator}
                    iconColor={kontraktor ? colors.warn : colors.accent}
                    title={row.description}
                    subtitle={kontraktor ? 'Kontraktor' : 'Operator'}
                    meta={[
                      row.contractorName,
                      row.unitArea,
                      row.operatorName,
                      SHIFT_TIME_LABEL[row.shiftTime] ?? row.shiftTime,
                    ].filter(Boolean).join(' · ')}
                    right={<Text style={styles.time}>{formatTime(row.activityAt)}</Text>}
                    chevron={false}
                    footer={<UnsentMark
                      status={row.syncStatus}
                      label={row.syncStatus === 'SYNC_ERROR' ? 'Ditolak' : 'Menunggu'}
                    />}
                  />
                );
              })}
            </ListGroup>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { marginTop: space.lg },
  time: { ...type.numeric, color: colors.muted },
});
