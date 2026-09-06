import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { Alert, Button, Field, Input, Loading, Screen } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { suggestShiftTime } from '@/lib/format';
import { getSession, setShiftContext } from '@/lib/session';

/**
 * "Mulai Shift" (doc 03 §3.1, steps 3–4).
 *
 * Asked once at the start rather than on every entry, because the whole point
 * is that recording a reading takes seconds. Everything captured afterwards is
 * attributed to this slot and this name.
 */
const SLOTS = ['pagi', 'sore', 'malam'] as const;

export default function ShiftStartScreen() {
  const [slot, setSlot] = useState<string>(suggestShiftTime());
  const [operator, setOperator] = useState('');
  const [crew, setCrew] = useState<string[] | null>(null);
  const [shiftName, setShiftName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    (async () => {
      const db = await getDb();
      const rows = await db.getAllAsync<{ name: string }>(
        'SELECT name FROM crew WHERE is_active = 1 ORDER BY sort_order, id',
      );
      const session = await getSession();
      if (ignore) return;
      setCrew(rows.map((r) => r.name));
      setShiftName(session?.shiftName ?? '');
    })();
    return () => { ignore = true; };
  }, []);

  async function start() {
    const name = operator.trim();
    if (!name) return;
    try {
      await setShiftContext(slot, name);
      router.replace('/(tabs)');
    } catch {
      setError('Gagal menyimpan data shift. Coba lagi.');
    }
  }

  if (crew === null) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      {shiftName ? <Text style={styles.shift}>{shiftName}</Text> : null}

      <Alert error={error} />

      <Field label="Waktu shift" hint="Disarankan dari jam sekarang — ubah bila perlu.">
        <Choice
          layout="segments"
          value={slot}
          onChange={(v) => setSlot(v ?? slot)}
          accessibilityLabel="Waktu shift"
          testID="shift-slot"
          options={SLOTS.map((value) => ({ value, label: SHIFT_TIME_LABEL[value] }))}
        />
      </Field>

      <Field
        label="Nama operator"
        hint={crew.length
          ? 'Pilih dari daftar crew shift ini, atau ketik nama lain.'
          : 'Daftar crew belum diisi admin — ketik nama manual.'}
      >
        {/* The roster is a shortcut, never a constraint: doc 01 §8 expects
            operators to type a name until an admin fills the list in. */}
        {crew.length > 0 && (
          <View style={styles.crewPicker}>
            <Choice
              layout="wrap"
              value={crew.includes(operator) ? operator : null}
              onChange={(v) => setOperator(v ?? '')}
              accessibilityLabel="Crew shift ini"
              testID="crew"
              options={crew.map((name) => ({ value: name, label: name }))}
            />
          </View>
        )}
        <Input
          value={operator}
          onChangeText={setOperator}
          placeholder="Contoh: Budi"
          autoCapitalize="words"
          returnKeyType="go"
          onSubmitEditing={start}
        />
      </Field>

      <Button
        title="Mulai"
        variant="primary"
        size="big"
        disabled={!operator.trim()}
        onPress={start}
      />

      <Text style={styles.note}>
        Nama ini menempel pada setiap catatan yang dibuat selama shift.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shift: { ...type.title, color: colors.text, marginBottom: space.md },
  crewPicker: { marginBottom: space.sm },
  note: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: space.lg },
});
