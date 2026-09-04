import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert, Button, Card, Chip, Heading, Loading, Screen } from '@/components/ui';
import { SHIFT_TIME_LABEL, STATUS_LABEL, colors, space, type } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import {
  EquipmentRow, EquipmentStatusRow, getEquipment, listEquipmentStatus,
} from '@/lib/queue';

/**
 * One piece of equipment and why it is in the state it is in (doc 02 §1.2).
 *
 * The history is the reason this screen exists. A status on its own says a pump
 * is on repair; the history says who found it, when, and what they saw — which
 * is what the next shift actually has to act on.
 *
 * What is shown is what this handset knows: its own reports plus this shift's
 * 7-day pull window. Older entries, and entries from other shifts, live on the
 * server (doc 07 §5) — the current reason still reaches here on the equipment
 * row itself, so the top of this screen is never blank.
 */
export default function EquipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const equipmentId = Number(id);

  const [item, setItem] = useState<EquipmentRow | null | undefined>(undefined);
  const [history, setHistory] = useState<EquipmentStatusRow[]>([]);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const [row, log] = await Promise.all([
        getEquipment(equipmentId),
        listEquipmentStatus(equipmentId),
      ]);
      if (ignore) return;
      setItem(row);
      setHistory(log);
    })();
    return () => { ignore = true; };
  }, [equipmentId]));

  if (item === undefined) return <Screen><Loading /></Screen>;
  if (!item) {
    return (
      <Screen>
        <Alert error="Alat tidak ditemukan di HP ini." />
        <Button title="Kembali" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading sub={[item.name, item.location].filter(Boolean).join(' · ')}>
        {item.tagNumber}
      </Heading>

      <Card>
        <View style={styles.head}>
          <Chip value={item.status} />
          {item.pendingStatus && <Text style={styles.unsent}>Belum terkirim</Text>}
        </View>

        {item.statusNote
          ? <Text style={styles.note}>{item.statusNote}</Text>
          : <Text style={styles.empty}>Belum ada keterangan status.</Text>}

        {/* formatDateTime returns an em dash for nothing, which rendered as a
            lone "—" under equipment that has never changed status. */}
        {!!(item.statusChangedBy || item.statusChangedAt) && (
          <Text style={styles.meta}>
            {[
              item.statusChangedBy,
              item.statusChangedAt ? formatDateTime(item.statusChangedAt) : '',
            ].filter(Boolean).join(' · ')}
          </Text>
        )}
      </Card>

      <Button
        title="Ubah status"
        variant="primary"
        size="big"
        onPress={() => router.push({
          pathname: '/(tabs)/maintenance/equipment/status',
          params: { id: String(item.id) },
        })}
      />

      <Text style={styles.sectionTitle}>Riwayat di HP ini</Text>

      {history.length === 0 ? (
        <Text style={styles.empty}>
          Belum ada perubahan status yang tercatat di HP ini.
        </Text>
      ) : (
        history.map((entry) => (
          <Card key={entry.clientId}>
            <View style={styles.head}>
              <Text style={styles.transition}>
                {entry.oldStatus
                  ? `${STATUS_LABEL[entry.oldStatus] ?? entry.oldStatus} → ${STATUS_LABEL[entry.newStatus] ?? entry.newStatus}`
                  : (STATUS_LABEL[entry.newStatus] ?? entry.newStatus)}
              </Text>
              {entry.syncStatus !== 'SYNCED' && (
                <Text style={styles.unsent}>
                  {entry.syncStatus === 'SYNC_ERROR' ? 'Ditolak server' : 'Belum terkirim'}
                </Text>
              )}
            </View>

            <Text style={styles.note}>{entry.description}</Text>

            <Text style={styles.meta}>
              {[
                entry.operatorName,
                SHIFT_TIME_LABEL[entry.shiftTime] ?? entry.shiftTime,
                formatDateTime(entry.changedAt),
              ].filter(Boolean).join(' · ')}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  transition: { ...type.bodyStrong, color: colors.text, flex: 1 },
  note: { ...type.body, color: colors.text, marginTop: space.sm },
  meta: { ...type.caption, color: colors.muted, marginTop: space.xs },
  empty: { ...type.body, color: colors.muted, marginTop: space.sm },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.lg, marginBottom: space.sm },
  unsent: { ...type.caption, color: colors.warn },
});
