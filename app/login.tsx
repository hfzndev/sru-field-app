import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { ICON, Icon } from '@/components/icon';
import { Alert, Button, Field, Input, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { ApiError, OfflineError, login as apiLogin } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { deviceName, startSession } from '@/lib/session';

/**
 * Shift login (doc 03 §3.1).
 *
 * The one screen that needs a connection. It is done once, in the control room
 * before walking out, and the response carries everything the phone needs for
 * the rest of the shift — so this is also the last time signal is required.
 */
const SHIFTS = ['shift_a', 'shift_b', 'shift_c', 'shift_d'] as const;
const SHIFT_LABEL: Record<string, string> = {
  shift_a: 'Shift A', shift_b: 'Shift B', shift_c: 'Shift C', shift_d: 'Shift D',
};

export default function LoginScreen() {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const name = await deviceName();
      const bootstrap = await apiLogin(username, password, name);
      await startSession(bootstrap);
      router.replace('/shift-start');
    } catch (err) {
      // Offline is worth distinguishing: nothing the operator typed is wrong,
      // they just need to stand somewhere with signal.
      if (err instanceof OfflineError) {
        setError('Tidak ada koneksi. Login perlu sinyal — coba di control room.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Gagal masuk. Coba lagi.');
      }
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Icon name={ICON.tank} size="lg" color={colors.accent} />
        <Text style={styles.brand}>SRU Field</Text>
        <Text style={styles.tagline}>Catat di lapangan, bukan diingat-ingat</Text>
      </View>

      <Alert error={error} />

      <Field label="Akun shift" hint="Satu akun dipakai bersama satu shift, bukan per orang.">
        <Choice
          layout="grid"
          columns={2}
          size="big"
          value={username || null}
          onChange={(v) => setUsername(v ?? '')}
          disabled={busy}
          accessibilityLabel="Akun shift"
          testID="shift-account"
          options={SHIFTS.map((code) => ({ value: code, label: SHIFT_LABEL[code] }))}
        />
      </Field>

      <Field label="Password">
        <Input
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onSubmitEditing={() => { if (username && password && !busy) submit(); }}
          returnKeyType="go"
        />
      </Field>

      <Button
        title="Masuk"
        variant="primary"
        size="big"
        busy={busy}
        disabled={!username || !password}
        onPress={submit}
      />

      <Text style={styles.note}>
        Login perlu sinyal. Setelah masuk, semua pencatatan bisa dilakukan tanpa koneksi.
      </Text>
      <Text style={styles.server}>{API_URL}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: space.xxl, marginBottom: space.xl, gap: space.xs },
  // type.display, unoverridden. This is a wordmark, not a measurement — the
  // three ad-hoc display sizes this app carried are now one token each.
  brand: { ...type.display, color: colors.text },
  tagline: { ...type.body, color: colors.muted, marginTop: space.xs },
  note: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: space.lg },
  // Shown so a misconfigured build is obvious from the login screen rather than
  // presenting as "wrong password" against a server nobody meant to use.
  server: { ...type.body, color: colors.faint, textAlign: 'center', marginTop: space.xs },
});
