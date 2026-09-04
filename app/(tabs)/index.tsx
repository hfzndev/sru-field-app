import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Heading, Loading, Screen } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { isoStartOfWibToday } from '@/lib/format';
import { getDb, unsentCount } from '@/lib/db';
import { Session, getSession } from '@/lib/session';

/**
 * Dashboard (doc 03 §5).
 *
 * Deliberately thin: what has this shift done, and is anything still stuck on
 * this phone. The unsent count is the number that matters — it is the
 * operator's assurance that nothing is sitting here unnoticed.
 *
 * Everything is read from local storage, so this screen renders identically
 * with or without signal.
 */
type Summary = { session: Session | null; unsent: number; readingsToday: number };

export default function DashboardScreen() {
  const [data, setData] = useState<Summary | null>(null);

  // Refreshes on focus rather than mount: the counts change while the operator
  // is off recording, and a stale "0 belum terkirim" is the one thing this
  // screen must never show.
  useFocusEffect(
    useCallback(() => {
      let ignore = false;
      (async () => {
        const db = await getDb();
        const session = await getSession();
        const unsent = await unsentCount();
        // Midnight WIB, not a rolling 24 hours and not a UTC day. The old
        // query compared ISO reading_at against datetime('now','-1 day'),
        // whose space separator sorts below 'T', so the window opened at
        // 00:00 UTC of yesterday and "Hari ini" counted up to two days.
        const row = await db.getFirstAsync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM tank_readings WHERE reading_at >= ?',
          isoStartOfWibToday(),
        );
        if (!ignore) setData({ session, unsent, readingsToday: row?.n ?? 0 });
      })();
      return () => { ignore = true; };
    }, []),
  );

  if (!data) return <Screen><Loading /></Screen>;

  const { session, unsent, readingsToday } = data;
  const subtitle = session
    ? [session.shiftName, SHIFT_TIME_LABEL[session.shiftTime] ?? session.shiftTime, session.operatorName]
      .filter(Boolean).join(' · ')
    : undefined;

  return (
    <Screen>
      <Heading sub={subtitle}>Beranda</Heading>

      <Card>
        <View style={styles.badgeRow}>
          <Chip
            value={unsent === 0 ? 'SYNCED' : 'PENDING_SYNC'}
            label={unsent === 0 ? 'Semua terkirim' : `${unsent} belum terkirim`}
          />
        </View>
        <Text style={styles.hint}>
          {unsent === 0
            ? 'Tidak ada catatan yang tertahan di HP ini.'
            : 'Catatan tersimpan aman di HP dan akan terkirim saat ada sinyal.'}
        </Text>
      </Card>

      <Text style={styles.sectionTitle}>Hari ini</Text>
      <Card>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{readingsToday}</Text>
            <Text style={styles.statLabel}>Pengukuran</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{unsent}</Text>
            <Text style={styles.statLabel}>Belum terkirim</Text>
          </View>
        </View>
      </Card>

      <Button
        title="+ Ukur tangki"
        variant="primary"
        size="big"
        onPress={() => router.push('/(tabs)/tanks')}
      />

      {/* Sync has no tab (see the tabs layout). The header badge covers the
          case where something is queued; this covers the other one — pulling
          master changes down when nothing is waiting to go up. */}
      <Button
        title="Sync sekarang"
        variant="secondary"
        onPress={() => router.push('/(tabs)/sync')}
      />

      {/* The handover document (doc 02 §4). Kept on the dashboard because that
          is where an operator lands when the shift is ending. */}
      <Button
        title="Rangkuman shift"
        variant="secondary"
        onPress={() => router.push('/summary')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', marginBottom: space.sm },
  hint: { ...type.caption, color: colors.muted },
  sectionTitle: { ...type.heading, color: colors.text, marginBottom: space.sm, marginTop: space.sm },
  statRow: { flexDirection: 'row' },
  stat: { flex: 1 },
  statNumber: { ...type.display, fontSize: 32, color: colors.text },
  statLabel: { ...type.caption, color: colors.muted },
});
