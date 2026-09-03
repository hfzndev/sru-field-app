import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Heading, OfflineBanner, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';

/**
 * Dashboard (doc 03 §5).
 *
 * Deliberately thin: it answers "what has this shift done so far" and "is
 * anything still stuck on this phone", then gets out of the way. The unsent
 * count is the number that matters — it is the operator's assurance that
 * nothing is sitting on the handset unnoticed.
 *
 * Counts are wired to the local database in task 5.
 */
export default function DashboardScreen() {
  const unsent = 0;
  const offline = false;

  return (
    <>
      <OfflineBanner visible={offline} />
      <Screen>
        <Heading sub="Shift A · Pagi · Budi">Beranda</Heading>

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
              <Text style={styles.statNumber}>0</Text>
              <Text style={styles.statLabel}>Pengukuran</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>0</Text>
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
      </Screen>
    </>
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
