import { useFocusEffect } from 'expo-router';
import * as Network from 'expo-network';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert, Button, Card, Chip, Empty, Heading, OfflineBanner, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { getMeta } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { UnsentRecord, unsentRecords } from '@/lib/queue';
import { SyncOutcome, isOnline, runSync } from '@/lib/sync';

/**
 * Sync screen (doc 03 §3.6).
 *
 * Sync also runs on its own — when the app opens and when the connection comes
 * back — so this screen exists less to trigger it than to answer the question
 * an operator actually has: is anything of mine still stuck on this phone?
 *
 * The button is safe to press repeatedly. client_id makes a replayed batch a
 * no-op on the server (doc 07 §3), and saying so on screen is what stops an
 * anxious operator from avoiding it.
 */
export default function SyncScreen() {
  const [records, setRecords] = useState<UnsentRecord[] | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const refresh = useCallback(async () => {
    setRecords(await unsentRecords());
    setLastSync(await getMeta('lastSyncAt'));
    setOnline(await isOnline());
  }, []);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => { if (!ignore) await refresh(); })();
    return () => { ignore = true; };
  }, [refresh]));

  // Reacts to the connection returning, which in a plant happens as an operator
  // walks back toward the control room rather than at any moment they choose.
  useEffect(() => {
    const subscription = Network.addNetworkStateListener(({ isConnected }) => {
      setOnline(!!isConnected);
    });
    return () => subscription.remove();
  }, []);

  async function syncNow() {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await runSync();
      setOutcome(result);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const unsent = records?.length ?? 0;
  const failed = records?.filter((r) => r.status === 'SYNC_ERROR').length ?? 0;

  return (
    <>
      <OfflineBanner visible={!online} />
      <Screen>
        <Heading sub="Aman dipencet berkali-kali — data tidak akan terkirim dua kali.">
          Sinkronisasi
        </Heading>

        {outcome && (
          // A cycle that rejected records is not a success, even though it
          // completed. Green next to "1 ditolak" tells an operator their work
          // went through when it did not.
          <Alert
            error={outcome.offline || !outcome.ok || outcome.rejected > 0 ? outcome.message : null}
            ok={outcome.ok && !outcome.offline && outcome.rejected === 0 ? outcome.message : null}
          />
        )}

        <Card>
          <View style={styles.badgeRow}>
            <Chip
              value={unsent === 0 ? 'SYNCED' : failed > 0 ? 'SYNC_ERROR' : 'PENDING_SYNC'}
              label={unsent === 0 ? 'Semua terkirim' : `${unsent} belum terkirim`}
            />
          </View>
          <Text style={styles.meta}>
            Terakhir sync: {lastSync ? formatDateTime(lastSync) : 'belum pernah'}
          </Text>
          {failed > 0 && (
            <Text style={styles.warn}>
              {failed} catatan ditolak server — perlu diperbaiki, tidak akan terkirim sendiri.
            </Text>
          )}
        </Card>

        <Button
          title={busy ? 'Mengirim…' : 'Sync Sekarang'}
          variant="primary"
          size="big"
          busy={busy}
          onPress={syncNow}
        />

        <Text style={styles.sectionTitle}>Belum terkirim</Text>
        {records === null ? null : records.length === 0 ? (
          <Empty
            icon="✅"
            title="Tidak ada yang tertahan"
            hint="Semua catatan sudah sampai ke server."
          />
        ) : (
          records.map((record) => (
            <Card key={record.clientId}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{record.label}</Text>
                  <Text style={styles.meta}>{formatDateTime(record.createdAt)}</Text>
                  {record.errorMessage && (
                    <Text style={styles.error}>{record.errorMessage}</Text>
                  )}
                </View>
                <Chip value={record.status} label={record.status === 'SYNC_ERROR' ? 'Ditolak' : 'Menunggu'} />
              </View>
            </Card>
          ))
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  label: { ...type.bodyStrong, color: colors.text },
  meta: { ...type.caption, color: colors.muted, marginTop: 2 },
  warn: { ...type.caption, color: colors.danger, marginTop: space.sm },
  error: { ...type.caption, color: colors.danger, marginTop: 4 },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.lg, marginBottom: space.sm },
});
