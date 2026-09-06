import Constants from 'expo-constants';
import type { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert, Button, Card, Loading, Reveal, Screen, SectionTitle } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { revoke } from '@/lib/api';
import { API_URL, IS_LOCAL_API } from '@/lib/config';
import { DbDiagnostics, diagnostics, ensureInstallId, getMeta } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { Session, endSession, getSession, getToken } from '@/lib/session';
import { refreshUnsent, useOnline, useUnsent } from '@/lib/status';
import { isOnline } from '@/lib/sync';
import {
  UpdateStatus, downloadUpdate, installApk, refreshUpdateStatus, resetUpdateStatus,
  sweepOldApks, useUpdateStatus,
} from '@/lib/update';

/**
 * About, account, and local diagnostics (doc 03 §5).
 *
 * The version shown here is the same string sent at login and listed in the
 * admin Devices tab (doc 09 §4, layer 2) — with no store managing updates, that
 * is how anyone knows which handsets are behind.
 *
 * The diagnostics block is not developer scaffolding. When an operator says "it
 * did not send", the useful answer is how many records are queued and why, and
 * nobody in the plant has a laptop and adb to hand.
 */
type Info = { session: Session | null; lastSync: string | null };

export default function SettingsScreen() {
  const appVersion = Constants.expoConfig?.version ?? 'tidak diketahui';
  const online = useOnline();
  const unsent = useUnsent();

  const [db, setDb] = useState<DbDiagnostics | null>(null);
  const [installId, setInstallId] = useState('');
  const [firstOpened, setFirstOpened] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const update = useUpdateStatus();
  const [checking, setChecking] = useState(false);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const [stats, id, opened, session, lastSync] = await Promise.all([
        diagnostics(),
        ensureInstallId(),
        getMeta('firstOpenedAt'),
        getSession(),
        getMeta('lastSyncAt'),
      ]);
      if (ignore) return;
      setDb(stats);
      setInstallId(id);
      setFirstOpened(opened);
      setInfo({ session, lastSync });

      // After the screen has drawn, not before: the check needs the network and
      // this screen must render instantly with no signal. Unforced, so opening
      // Pengaturan twice in a shift does not cost two round trips.
      refreshUpdateStatus().catch(() => {});
    })();
    return () => { ignore = true; };
  }, []));

  /**
   * The "Periksa update" button.
   *
   * Forced, unlike the check on focus. The operator has been told by someone —
   * the control room, usually — that there is a new build, and showing them a
   * cached "sudah versi terbaru" from hours ago would make the app the thing
   * that is wrong rather than the thing that helps.
   */
  async function checkNow() {
    setChecking(true);
    try {
      await refreshUpdateStatus(true);
    } finally {
      setChecking(false);
    }
  }

  /**
   * Signs out for real.
   *
   * The token is revoked server-side first when there is signal, so a handset
   * handed to another shift — or lost — stops being able to write immediately
   * rather than when its 12h expiry runs out (doc 08 §2.2). When that call
   * cannot be made the local sign-out still happens: refusing to log out
   * because the plant has no signal would be the worse failure.
   */
  async function signOut() {
    setLeaving(true);
    try {
      const token = await getToken();
      if (token && (await isOnline())) {
        try {
          await revoke(token);
        } catch {
          // Offline, or the token was already revoked by an admin. Neither is
          // a reason to keep the operator signed in on this phone.
        }
      }
      await endSession();
      // The check is made with this operator's token; the next one on this
      // handset must not inherit its verdict.
      resetUpdateStatus();
      await refreshUnsent();
      router.replace('/login');
    } finally {
      setLeaving(false);
    }
  }

  const session = info?.session ?? null;
  const shiftTime = session?.shiftTime ? SHIFT_TIME_LABEL[session.shiftTime] ?? session.shiftTime : '';

  return (
    <Screen>
      <Card>
        <Row label="Versi aplikasi" value={appVersion} />
        <Row label="Server" value={hostOf(API_URL)} />
        <Row label="Koneksi" value={online ? 'Ada sinyal' : 'Tidak ada sinyal'} />
        <Row
          label="Terakhir sync"
          value={info ? (info.lastSync ? formatDateTime(info.lastSync) : 'belum pernah') : '…'}
        />
      </Card>

      {/* A handset pointing at a dev server looks completely normal until a
          whole shift of records turns out to be on somebody's laptop. */}
      {IS_LOCAL_API && (
        <Alert error="Aplikasi ini menunjuk ke server lokal, bukan server lapangan. Jangan dipakai untuk mencatat sungguhan." />
      )}

      <UpdateCard
        status={update}
        currentVersion={appVersion}
        checking={checking}
        onCheck={checkNow}
      />

      <SectionTitle>Akun shift</SectionTitle>
      <Card>
        {!info ? <Loading /> : session ? (
          <>
            <Row label="Shift" value={session.shiftName} />
            <Row label="Waktu" value={shiftTime || 'belum dipilih'} />
            <Row label="Operator" value={session.operatorName || 'belum dipilih'} />
            {/* The name the admin Devices tab lists, so a phone in the hand can
                be matched to a row on the screen (doc 06 §4). */}
            <Row label="Nama HP" value={session.deviceName || '—'} />
          </>
        ) : (
          <Row label="Status" value="Belum login" />
        )}
      </Card>

      <SectionTitle>Penyimpanan HP</SectionTitle>
      {!db ? <Loading /> : (
        <Card>
          <Row label="Versi skema" value={`v${db.schemaVersion}`} />
          <Row label="Mode jurnal" value={db.journalMode.toUpperCase()} />
          <Row label="Belum terkirim" value={String(db.unsent)} />
          {db.failed > 0 && <Row label="Ditolak server" value={String(db.failed)} />}
          <Row label="Sudah terkirim" value={String(db.synced)} />

          <View style={styles.divider} />
          {db.perTable.map((row) => (
            <Row key={row.table} label={LABELS[row.table] ?? row.table} value={`${row.total} catatan`} />
          ))}

          <View style={styles.divider} />
          <Row label="Data master" value={db.masterCounts.map((m) => m.rows).reduce((a, b) => a + b, 0) + ' baris'} />
        </Card>
      )}

      <SectionTitle>Identitas HP</SectionTitle>
      <Card>
        <Row label="ID instalasi" value={installId ? `${installId.slice(0, 8)}…` : '—'} />
        <Row label="Dipasang" value={formatDateTime(firstOpened)} />
      </Card>

      {/* Confirmed in-screen rather than in a system dialog: the native alert
          renders below this app's 16pt floor and cannot be styled to meet it
          (doc 03 §1). */}
      {!confirming ? (
        <Button
          title={session ? 'Ganti akun / keluar' : 'Login'}
          variant={session ? 'danger' : 'primary'}
          onPress={() => (session ? setConfirming(true) : router.replace('/login'))}
        />
      ) : (
        <Reveal>
        <Card>
          <Text style={styles.confirmTitle}>Keluar dari {session?.shiftName}?</Text>
          {unsent > 0 && (
            <Text style={styles.warn}>
              {unsent} catatan belum terkirim. Catatan tetap tersimpan di HP, tapi baru
              bisa dikirim setelah ada yang login lagi.
            </Text>
          )}
          <View style={styles.confirmRow}>
            <View style={{ flex: 1 }}>
              <Button title="Batal" variant="secondary" onPress={() => setConfirming(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={leaving ? 'Keluar…' : 'Ya, keluar'}
                variant="danger"
                busy={leaving}
                onPress={signOut}
              />
            </View>
          </View>
        </Card>
        </Reveal>
      )}

      <Text style={styles.note}>
        Keluar tidak menghapus catatan yang belum terkirim. Catatan tetap tersimpan
        di HP sampai berhasil dikirim ke server.
      </Text>
    </Screen>
  );
}

/** Host only — the scheme is noise, and the host is what identifies the server. */
function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

const LABELS: Record<string, string> = {
  tank_readings: 'Pengukuran tangki',
  activity_logs: 'Aktivitas',
  cleaning_sessions: 'Bersih-bersih',
  maintenance_task_logs: 'Log maintenance',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/**
 * The update card (doc 09 §3 lapis 3).
 *
 * Always on screen, unlike the banner it replaces. That card only appeared when
 * a newer build existed, which made "apakah HP saya sudah terbaru?" a question
 * with no answer anywhere in the app: nothing shown could mean up to date, no
 * signal, or a check that never ran, and an operator cannot tell those apart
 * from an absence. Now each of them says which one it is, and there is a button
 * to ask again.
 *
 * A pending update is styled as a warning, not as news. The plant runs four
 * handsets with no store behind them, so a phone left on an old build keeps
 * whatever bugs that build had, and it stays that way until somebody
 * deliberately updates it.
 *
 * Downloading and installing are two separate taps on purpose. The download is
 * ~70MB and finishes whenever it finishes; installing interrupts whatever the
 * operator is doing and hands them to the system installer. Bundling them
 * would mean a tap in the control room ambushes them in the field.
 */
function UpdateCard({ status, currentVersion, checking, onCheck }: {
  status: UpdateStatus;
  currentVersion: string;
  checking: boolean;
  onCheck: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState<File | null>(null);
  const [error, setError] = useState('');

  const outdated = status.state === 'AVAILABLE';

  async function download() {
    if (status.state !== 'AVAILABLE') return;
    setBusy(true);
    setError('');
    try {
      const file = await downloadUpdate(status.version, setProgress);
      // Older builds are dead weight once this one is on the phone, and 70MB
      // each competes with a week of photographs for space.
      sweepOldApks(status.version);
      setReady(file);
    } catch {
      setError('Unduhan gagal — coba lagi saat sinyal lebih baik.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>Update aplikasi</SectionTitle>
      <Card style={outdated ? styles.updateCardWarn : undefined}>
        {outdated && (
          <Text style={styles.updateWarnTitle}>
            Versi aplikasi di HP ini sudah lama
          </Text>
        )}

        <Row label="Versi di HP" value={currentVersion} />
        {status.state === 'AVAILABLE' && <Row label="Versi di server" value={status.version} />}
        {/* One decimal, not a round number: a small build shown as "0 MB"
            reads as a broken download rather than a quick one. */}
        {status.state === 'AVAILABLE' && status.bytes > 0 && (
          <Row label="Ukuran" value={`${(status.bytes / 1024 / 1024).toFixed(1)} MB`} />
        )}

        <Alert error={error || null} />

        {status.state === 'AVAILABLE' ? (
          ready ? (
            <>
              <Button
                title="Pasang sekarang"
                variant="primary"
                onPress={async () => {
                  try {
                    await installApk(ready);
                  } catch {
                    setError('Tidak bisa membuka installer. Buka file APK-nya secara manual.');
                  }
                }}
              />
              <Text style={styles.updateNote}>
                Android akan meminta izin &quot;install aplikasi tidak dikenal&quot; sekali.
                Catatan yang tersimpan di HP tidak hilang saat update.
              </Text>
            </>
          ) : (
            <>
              <Button
                title={busy
                  ? (progress > 0 ? `Mengunduh… ${Math.round(progress * 100)}%` : 'Mengunduh…')
                  : 'Unduh update'}
                variant="primary"
                busy={busy}
                onPress={download}
              />
              <Text style={styles.updateNote}>
                Unduh saat sinyal bagus. Catatan yang belum terkirim tidak hilang saat update —
                tapi kirim dulu kalau bisa.
              </Text>
            </>
          )
        ) : (
          <>
            <Button
              title={checking ? 'Memeriksa…' : 'Periksa update'}
              variant="secondary"
              busy={checking}
              onPress={onCheck}
            />
            <Text style={styles.updateNote}>{HINT[status.state]}</Text>
          </>
        )}
      </Card>
    </>
  );
}

/**
 * What each non-update state means, in the operator's terms.
 *
 * UNKNOWN is deliberately not phrased as a failure. Being out of signal is the
 * normal case out in the plant, and an operator must not be handed a problem to
 * solve for a check they did not ask for — it says what to do, not what broke.
 */
const HINT: Record<Exclude<UpdateStatus['state'], 'AVAILABLE'>, string> = {
  CURRENT: 'Aplikasi sudah versi terbaru.',
  NONE: 'Server belum punya build untuk dibagikan.',
  UNKNOWN: 'Belum bisa memeriksa ke server. Coba lagi saat ada sinyal.',
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, gap: space.md },
  label: { ...type.body, color: colors.muted, flexShrink: 1 },
  value: { ...type.bodyStrong, color: colors.text, flexShrink: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  updateNote: { ...type.body, color: colors.muted, marginTop: space.sm },
  // Bordered, not filled: the card sits among four others that all look alike,
  // and a tint alone is not something an operator reads as "act on this".
  updateCardWarn: { borderColor: colors.warn, borderWidth: 2 },
  updateWarnTitle: { ...type.bodyStrong, color: colors.warn, marginBottom: space.sm },
  confirmTitle: { ...type.bodyStrong, color: colors.text, marginBottom: space.sm },
  confirmRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  warn: { ...type.body, color: colors.danger, marginBottom: space.sm },
  note: { ...type.body, color: colors.muted, marginTop: space.lg },
});
