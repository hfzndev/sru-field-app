import Constants from 'expo-constants';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';

/**
 * About and account (doc 03 §5).
 *
 * The app version shown here is the same string sent to the server at login and
 * listed in the admin Devices tab (doc 09 §4, layer 2). With no store to manage
 * updates, that is how anyone knows which handsets are still on an old build —
 * so it needs to be readable from the phone itself, not just inferred remotely.
 */
export default function SettingsScreen() {
  const appVersion = Constants.expoConfig?.version ?? 'tidak diketahui';

  return (
    <Screen>
      <Card>
        <Row label="Versi aplikasi" value={appVersion} />
        <Row label="Server" value="belum tersambung" />
        <Row label="Akun shift" value="—" />
      </Card>

      <Button title="Ganti akun / keluar" variant="danger" onPress={() => router.replace('/login')} />

      <Text style={styles.note}>
        Keluar tidak menghapus catatan yang belum terkirim. Catatan tetap tersimpan
        di HP sampai berhasil dikirim ke server.
      </Text>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm },
  label: { ...type.body, color: colors.muted },
  value: { ...type.bodyStrong, color: colors.text },
  note: { ...type.caption, color: colors.muted, marginTop: space.lg },
});
