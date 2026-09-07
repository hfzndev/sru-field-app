import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Heading, Loading, ProgressBar, Screen, StatusBadge } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { isoStartOfWibToday } from '@/lib/format';
import { getDb, unsentCount } from '@/lib/db';
import { Session, getSession } from '@/lib/session';
import {
  SheetProgress, SheetRecord, completionText, currentCells, listColumns, listRows, listSheets,
  progressOf,
} from '@/lib/sheets';
import { refreshUpdateStatus, useUpdateStatus } from '@/lib/update';

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
type SheetEntry = { sheet: SheetRecord; progress: SheetProgress };
type Summary = {
  session: Session | null;
  unsent: number;
  readingsToday: number;
  sheets: SheetEntry[];
};

/**
 * Open lembar tugas with their counts.
 *
 * On Beranda rather than in the tab bar: five tabs is already the ceiling at
 * the 16pt label floor (see the tabs layout), and a lembar is work handed down
 * for today rather than a permanent part of the app — it belongs where an
 * operator lands, next to the other numbers about today.
 */
async function loadSheetEntries(): Promise<SheetEntry[]> {
  const sheets = await listSheets();
  const entries: SheetEntry[] = [];
  for (const sheet of sheets) {
    const [columns, rows, cells] = await Promise.all([
      listColumns(sheet.id), listRows(sheet.id), currentCells(sheet.id),
    ]);
    entries.push({ sheet, progress: progressOf(columns, rows, cells) });
  }
  return entries;
}

export default function DashboardScreen() {
  const [data, setData] = useState<Summary | null>(null);
  const update = useUpdateStatus();

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
        const sheets = await loadSheetEntries();
        if (!ignore) setData({ session, unsent, readingsToday: row?.n ?? 0, sheets });

        // Fired after the local reads, never awaited before them: this screen
        // must draw from SQLite alone with no signal, and a 10s HEAD request
        // in front of that would make the dashboard feel broken in a dead
        // spot. Throttled inside refreshUpdateStatus, so returning to Beranda
        // twenty times a shift costs one round trip.
        refreshUpdateStatus().catch(() => {});
      })();
      return () => { ignore = true; };
    }, []),
  );

  if (!data) return <Screen><Loading /></Screen>;

  const { session, unsent, readingsToday, sheets } = data;
  const subtitle = session
    ? [session.shiftName, SHIFT_TIME_LABEL[session.shiftTime] ?? session.shiftTime, session.operatorName]
      .filter(Boolean).join(' · ')
    : undefined;

  return (
    <Screen>
      <Heading sub={subtitle}>SRU Field App</Heading>

      {/* The outdated-version warning (doc 09 §3 lapis 3).
          It lives here as well as in Pengaturan because nobody opens
          Pengaturan. With no store behind these four handsets, a phone left on
          an old build keeps that build's bugs until someone deliberately
          updates it, and the only screen an operator reliably sees is this one.
          Shown only for AVAILABLE — CURRENT, NONE and UNKNOWN all render
          nothing, so a dead spot never turns into a warning about itself. */}
      {update.state === 'AVAILABLE' && (
        <Card onPress={() => router.push('/settings')} style={styles.updateCard}>
          <Text style={styles.updateTitle}>Versi aplikasi sudah lama</Text>
          <Text style={styles.updateBody}>
            Ada versi {update.version} di server. Ketuk untuk membuka Pengaturan dan update
            saat sinyal bagus.
          </Text>
        </Card>
      )}

      <Card>
        <View style={styles.badgeRow}>
          <StatusBadge
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
            <Text style={styles.statLabel}>Midband</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{unsent}</Text>
            <Text style={styles.statLabel}>Belum terkirim</Text>
          </View>
        </View>
      </Card>

      {sheets.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Tugas</Text>
          {sheets.map(({ sheet, progress }) => (
            <Card
              key={sheet.id}
              onPress={() => router.push({
                pathname: '/(tabs)/sheets/[id]',
                params: { id: String(sheet.id) },
              })}
            >
              <Text style={styles.sheetTitle}>{sheet.title}</Text>
              <ProgressBar
                done={progress.rowsDone}
                total={progress.rows}
                label={completionText(progress)}
              />
            </Card>
          ))}
        </>
      )}

      <Button
        title="Midband Calc"
        variant="primary"
        size="big"
        onPress={() => router.push('/(tabs)/tanks')}
      />

      {/* Sync has no tab (see the tabs layout). The header badge covers the
          case where something is queued; this covers the other one — pulling
          master changes down when nothing is waiting to go up. */}
      <Button
        title="Sync"
        variant="secondary"
        onPress={() => router.push('/(tabs)/sync')}
      />

      {/* The handover document (doc 02 §4). Kept on the dashboard because that
          is where an operator lands when the shift is ending. */}
      <Button
        title="Summary"
        variant="secondary"
        onPress={() => router.push('/summary')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', marginBottom: space.sm },
  // Bordered rather than tinted: this sits directly above the "semua terkirim"
  // card, and a filled warning block there competes with the one number this
  // screen exists to show.
  updateCard: { borderColor: colors.warn, borderWidth: 2 },
  updateTitle: { ...type.bodyStrong, color: colors.warn, marginBottom: space.xs },
  updateBody: { ...type.body, color: colors.text },
  hint: { ...type.body, color: colors.muted },
  sheetTitle: { ...type.bodyStrong, color: colors.text },
  sectionTitle: { ...type.heading, color: colors.text, marginBottom: space.sm, marginTop: space.sm },
  statRow: { flexDirection: 'row' },
  stat: { flex: 1 },
  statNumber: { ...type.metric, color: colors.text },
  statLabel: { ...type.body, color: colors.muted },
});
