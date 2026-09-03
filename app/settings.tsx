import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { DbDiagnostics, diagnostics, ensureInstallId, getMeta } from '@/lib/db';
import { formatDateTime } from '@/lib/format';

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
export default function SettingsScreen() {
  const appVersion = Constants.expoConfig?.version ?? 'tidak diketahui';
  const [db, setDb] = useState<DbDiagnostics | null>(null);
  const [installId, setInstallId] = useState('');
  const [firstOpened, setFirstOpened] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const [stats, id, opened] = await Promise.all([
        diagnostics(),
        ensureInstallId(),
        getMeta('firstOpenedAt'),
      ]);
      if (ignore) return;
      setDb(stats);
      setInstallId(id);
      setFirstOpened(opened);
    })();
    return () => { ignore = true; };
  }, []);

  return (
    <Screen>
      <Card>
        <Row label="Versi aplikasi" value={appVersion} />
        <Row label="Server" value="belum tersambung" />
        <Row label="Akun shift" value="—" />
      </Card>

      <Text style={styles.section}>Penyimpanan HP</Text>
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

      <Text style={styles.section}>Identitas HP</Text>
      <Card>
        <Row label="ID instalasi" value={installId ? `${installId.slice(0, 8)}…` : '—'} />
        <Row label="Dipasang" value={formatDateTime(firstOpened)} />
      </Card>

      <Button title="Ganti akun / keluar" variant="danger" onPress={() => router.replace('/login')} />

      <Text style={styles.note}>
        Keluar tidak menghapus catatan yang belum terkirim. Catatan tetap tersimpan
        di HP sampai berhasil dikirim ke server.
      </Text>
    </Screen>
  );
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, gap: space.md },
  label: { ...type.body, color: colors.muted, flexShrink: 1 },
  value: { ...type.bodyStrong, color: colors.text },
  section: { ...type.heading, color: colors.text, marginTop: space.md, marginBottom: space.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  note: { ...type.caption, color: colors.muted, marginTop: space.lg },
});
