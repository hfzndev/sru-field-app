import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Empty, Loading, Screen, Toast } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { formatTime, mm } from '@/lib/format';

/**
 * Tank list (doc 03 §3.2).
 *
 * Two tanks, and the code is always written in full. Doc 02 §1.1 is blunt about
 * this: "T-401" invites measuring the wrong tank, and these two sit next to
 * each other.
 *
 * The last reading comes from whatever this handset holds — its own records
 * plus anything a sync pulled back — so it is right with or without signal.
 */
type TankRow = {
  id: number;
  code: string;
  heightMm: number;
  lastLevelMm: number | null;
  lastAt: string | null;
  unsent: number;
};

export default function TanksScreen() {
  const params = useLocalSearchParams<{ saved?: string }>();
  const [tanks, setTanks] = useState<TankRow[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // The save confirmation is handed over from the measure screen, which
  // unmounts as it navigates. Derived from the route param rather than copied
  // into state: the param is already the source of truth, and mirroring it
  // would mean a render pass whose only job is to catch up with itself.
  const toast = !dismissed && params.saved ? String(params.saved) : null;

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const db = await getDb();
      const rows = await db.getAllAsync<any>(`
        SELECT t.id, t.code, t.height_mm,
               (SELECT r.level_mm FROM tank_readings r
                 WHERE r.tank_id = t.id ORDER BY r.reading_at DESC LIMIT 1) AS last_level,
               (SELECT r.reading_at FROM tank_readings r
                 WHERE r.tank_id = t.id ORDER BY r.reading_at DESC LIMIT 1) AS last_at,
               (SELECT COUNT(*) FROM tank_readings r
                 WHERE r.tank_id = t.id AND r.sync_status != 'SYNCED') AS unsent
          FROM tanks t WHERE t.is_active = 1 ORDER BY t.code
      `);
      if (ignore) return;
      setTanks(rows.map((r) => ({
        id: r.id,
        code: r.code,
        heightMm: r.height_mm,
        lastLevelMm: r.last_level,
        lastAt: r.last_at,
        unsent: r.unsent,
      })));
    })();
    return () => { ignore = true; };
  }, []));

  if (!tanks) return <Screen><Loading /></Screen>;

  return (
    <>
      <Screen>
        {tanks.length === 0 ? (
          <Empty
            icon="🛢️"
            title="Belum ada data tangki"
            hint="Sambungkan ke server lalu sync untuk mengambil daftar tangki."
          />
        ) : tanks.map((tank) => (
          <Card key={tank.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.code}>{tank.code}</Text>
                <Text style={styles.meta}>Tinggi {mm(tank.heightMm)}</Text>
              </View>
              <View style={styles.lastWrap}>
                <Text style={styles.lastLabel}>Terakhir</Text>
                <Text style={styles.lastValue}>
                  {tank.lastLevelMm === null ? '—' : mm(tank.lastLevelMm)}
                </Text>
                {tank.lastAt && <Text style={styles.lastTime}>{formatTime(tank.lastAt)}</Text>}
              </View>
            </View>

            {tank.unsent > 0 && (
              <Text style={styles.unsent}>⬆ {tank.unsent} belum terkirim</Text>
            )}

            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button
                  title="+ Ukur"
                  variant="primary"
                  onPress={() => router.push({
                    pathname: '/(tabs)/tanks/measure',
                    params: { tankId: String(tank.id) },
                  })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Riwayat"
                  onPress={() => router.push({
                    pathname: '/(tabs)/tanks/[id]',
                    params: { id: String(tank.id) },
                  })}
                />
              </View>
            </View>
          </Card>
        ))}
      </Screen>
      <Toast message={toast} onDone={() => setDismissed(true)} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  code: { ...type.title, color: colors.text },
  meta: { ...type.caption, color: colors.muted, marginTop: 2 },
  lastWrap: { alignItems: 'flex-end' },
  lastLabel: { ...type.caption, color: colors.muted },
  lastValue: { ...type.bodyStrong, color: colors.text },
  lastTime: { ...type.caption, color: colors.faint },
  unsent: { ...type.caption, color: colors.warn, marginTop: space.sm, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
