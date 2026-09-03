import { StyleSheet, Text } from 'react-native';
import { Button, Card, Chip, Heading, OfflineBanner, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';

/**
 * Sync screen (doc 03 §3.6).
 *
 * Sync also runs automatically when the app opens and when the connection
 * returns; this screen exists so an operator can force it and, more
 * importantly, see exactly what is still waiting. Pressing it repeatedly is
 * safe by design — client_id makes a replayed batch a no-op (doc 07 §3).
 *
 * Wired in task 8.
 */
export default function SyncScreen() {
  const unsent = 0;
  const offline = false;

  return (
    <>
      <OfflineBanner visible={offline} />
      <Screen>
        <Heading sub="Aman dipencet berkali-kali — data tidak akan terkirim dua kali.">
          Sinkronisasi
        </Heading>

        <Card>
          <Chip
            value={unsent === 0 ? 'SYNCED' : 'PENDING_SYNC'}
            label={unsent === 0 ? 'Semua terkirim' : `${unsent} belum terkirim`}
          />
          <Text style={styles.meta}>Terakhir sync: belum pernah</Text>
        </Card>

        <Button title="Sync Sekarang" variant="primary" size="big" disabled={offline} />

        <Text style={styles.sectionTitle}>Belum terkirim</Text>
        <Card>
          <Text style={styles.meta}>Tidak ada catatan yang tertahan.</Text>
        </Card>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  meta: { ...type.caption, color: colors.muted, marginTop: space.sm },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.lg, marginBottom: space.sm },
});
