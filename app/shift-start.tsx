import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, Input, Screen } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { suggestShiftTime } from '@/lib/format';

/**
 * "Mulai Shift" (doc 03 §3.1, steps 3–4).
 *
 * Every record captured from here on is attributed to this shift slot and this
 * operator, so it is asked once at the start rather than on every entry — the
 * whole point is that recording a reading takes seconds.
 *
 * The slot is suggested from the WIB clock but stays editable: someone clocking
 * on at 23:50 for the night shift would otherwise be labelled "sore".
 */
const SLOTS = ['pagi', 'sore', 'malam'] as const;

export default function ShiftStartScreen() {
  const [slot, setSlot] = useState<string>(suggestShiftTime());
  const [operator, setOperator] = useState('');

  // Task 4 replaces this with the crew list from the login bootstrap.
  const crew: string[] = [];

  return (
    <Screen>
      <Field label="Waktu shift" hint="Disarankan dari jam sekarang — ubah bila perlu.">
        <View style={styles.row}>
          {SLOTS.map((value) => (
            <View key={value} style={styles.cell}>
              <Button
                title={SHIFT_TIME_LABEL[value]}
                variant={slot === value ? 'primary' : 'secondary'}
                onPress={() => setSlot(value)}
              />
            </View>
          ))}
        </View>
      </Field>

      <Field
        label="Nama operator"
        hint={crew.length ? 'Pilih dari daftar crew shift ini.' : 'Daftar crew belum diisi admin — ketik nama manual.'}
      >
        <Input
          value={operator}
          onChangeText={setOperator}
          placeholder="Contoh: Budi"
          autoCapitalize="words"
        />
      </Field>

      <Button
        title="Mulai"
        variant="primary"
        size="big"
        disabled={!operator.trim()}
        onPress={() => router.replace('/(tabs)')}
      />

      <Text style={styles.note}>
        Nama ini menempel pada setiap catatan yang dibuat selama shift.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: -space.xs },
  cell: { flex: 1, paddingHorizontal: space.xs },
  note: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: space.lg },
});
