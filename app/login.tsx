import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert, Button, Field, Input, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';

/**
 * Shift login (doc 03 §3.1).
 *
 * The one screen that requires a connection: the account is verified against
 * the server and the response carries the whole bootstrap the phone needs for
 * the rest of the shift. Done once, in the control room, before walking out.
 *
 * Task 4 wires this to the API and SecureStore. For now it establishes the
 * layout and navigation.
 */
const SHIFTS = ['shift_a', 'shift_b', 'shift_c', 'shift_d'] as const;
const SHIFT_LABEL: Record<string, string> = {
  shift_a: 'Shift A', shift_b: 'Shift B', shift_c: 'Shift C', shift_d: 'Shift D',
};

export default function LoginScreen() {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState('');
  const [error] = useState('');

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.brand}>SRU Field</Text>
        <Text style={styles.tagline}>Catat di lapangan, bukan diingat-ingat</Text>
      </View>

      <Alert error={error} />

      <Field label="Akun shift" hint="Satu akun dipakai bersama satu shift, bukan per orang.">
        <View style={styles.shiftGrid}>
          {SHIFTS.map((code) => (
            <View key={code} style={styles.shiftCell}>
              <Button
                title={SHIFT_LABEL[code]}
                variant={username === code ? 'primary' : 'secondary'}
                onPress={() => setUsername(code)}
              />
            </View>
          ))}
        </View>
      </Field>

      <Field label="Password">
        <Input
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
        />
      </Field>

      <Button
        title="Masuk"
        variant="primary"
        size="big"
        disabled={!username || !password}
        onPress={() => router.replace('/shift-start')}
      />

      <Text style={styles.note}>
        Login perlu sinyal. Setelah masuk, semua pencatatan bisa dilakukan tanpa koneksi.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: space.xxl, marginBottom: space.xl },
  brand: { ...type.display, fontSize: 34, color: colors.text },
  tagline: { ...type.body, color: colors.muted, marginTop: space.xs },
  shiftGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  shiftCell: { width: '50%', paddingHorizontal: space.xs, marginBottom: space.sm },
  note: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: space.lg },
});
