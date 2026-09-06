import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ICON } from '@/components/icon';
import { Card, Empty, Loading, Screen, StatusBadge } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { deviation as fmtDeviation, formatDateTime, mm } from '@/lib/format';

/**
 * Per-tank reading history (doc 03 §3.2.4).
 *
 * Reads entirely from local storage, so it works with no signal — that is what
 * the 7-day window is for (doc 07 §5). It shows the shift's readings, not just
 * this handset's: pull writes the window in, so an operator who picked up a
 * different phone still sees the morning's work.
 */
type Row = {
  clientId: string;
  levelMm: number;
  dcsLevelMm: number | null;
  deviationMm: number | null;
  tapeLengthMm: number;
  bandulSulfurMm: number;
  attempts: number;
  operatorName: string;
  shiftGroup: string;
  note: string;
  readingAt: string;
  syncStatus: string;
};

export default function TankHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tankId = Number(id);

  const [tankCode, setTankCode] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const db = await getDb();
      const tank = await db.getFirstAsync<{ code: string }>(
        'SELECT code FROM tanks WHERE id = ?', tankId,
      );
      const readings = await db.getAllAsync<any>(
        `SELECT client_id, level_mm, dcs_level_mm, deviation_mm, tape_length_mm,
                bandul_sulfur_mm, attempts, operator_name, shift_group, note,
                reading_at, sync_status
           FROM tank_readings
          WHERE tank_id = ?
          ORDER BY reading_at DESC
          LIMIT 200`,
        tankId,
      );
      if (ignore) return;
      setTankCode(tank?.code ?? '');
      setRows(readings.map((r) => ({
        clientId: r.client_id,
        levelMm: r.level_mm,
        dcsLevelMm: r.dcs_level_mm,
        deviationMm: r.deviation_mm,
        tapeLengthMm: r.tape_length_mm,
        bandulSulfurMm: r.bandul_sulfur_mm,
        attempts: r.attempts,
        operatorName: r.operator_name,
        shiftGroup: r.shift_group,
        note: r.note ?? '',
        readingAt: r.reading_at,
        syncStatus: r.sync_status,
      })));
    })();
    return () => { ignore = true; };
  }, [tankId]));

  if (!rows) return <Screen><Loading /></Screen>;

  return (
    <>
      {/* Full code in the title — never "T-401" (doc 02 §1.1). */}
      <Stack.Screen options={{ title: tankCode ? `Riwayat ${tankCode}` : 'Riwayat' }} />
      <Screen>
        {rows.length === 0 ? (
          <Empty
            icon={ICON.emptyTank}
            title="Belum ada pengukuran"
            hint="Riwayat 7 hari terakhir muncul di sini setelah ada pengukuran atau sync."
          />
        ) : (
          <>
            <Text style={styles.count}>{rows.length} pengukuran tersimpan di HP ini</Text>
            {rows.map((row) => (
              <Card key={row.clientId}>
                <View style={styles.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.level}>{mm(row.levelMm)}</Text>
                    <Text style={styles.when}>{formatDateTime(row.readingAt)}</Text>
                  </View>
                  {/* Only flagged when it is not on the server — a synced record
                      needs no badge, and badging everything would drain the
                      meaning out of the ones that matter. */}
                  {row.syncStatus !== 'SYNCED' && (
                    <StatusBadge
                      value={row.syncStatus}
                      label={row.syncStatus === 'SYNC_ERROR' ? 'Ditolak' : 'Belum terkirim'}
                    />
                  )}
                </View>

                <View style={styles.deviationRow}>
                  <Text style={styles.label}>Selisih DCS</Text>
                  <Text style={styles.deviationValue}>
                    {row.dcsLevelMm === null ? 'DCS tidak terbaca' : fmtDeviation(row.deviationMm)}
                  </Text>
                </View>

                <Text style={styles.detail}>
                  Meteran {mm(row.tapeLengthMm)} · bandul {mm(row.bandulSulfurMm)}
                  {row.attempts > 1 ? ` · ${row.attempts}× percobaan` : ''}
                </Text>

                {row.note ? <Text style={styles.note}>{row.note}</Text> : null}

                <Text style={styles.by}>
                  {row.operatorName || '—'}{row.shiftGroup ? ` · ${row.shiftGroup}` : ''}
                </Text>
              </Card>
            ))}
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  count: { ...type.body, color: colors.muted, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  level: { ...type.title, color: colors.text },
  when: { ...type.body, color: colors.muted, marginTop: 2 },
  deviationRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  label: { ...type.body, color: colors.muted },
  deviationValue: { ...type.bodyStrong, color: colors.accent },
  detail: { ...type.body, color: colors.muted, marginTop: space.sm },
  note: { ...type.body, color: colors.text, marginTop: space.xs },
  by: { ...type.body, color: colors.faint, marginTop: space.sm },
});
