import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Alert, Button, Field, Input, Loading, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { enqueueSheetRow } from '@/lib/queue';
import { Session, getSession } from '@/lib/session';
import { SheetRecord, getSheet } from '@/lib/sheets';

/**
 * A row the operator adds to a lembar the supervisor already published
 * (doc 05 §4).
 *
 * The case this exists for: the lembar lists twelve pumps and the operator
 * finds a thirteenth. Refusing it would mean the pump goes undocumented or ends
 * up in a note nobody reads, which is worse than a list that is not exactly
 * what the supervisor typed. The row records who added it, so the supervisor
 * can see at a glance what came from the field.
 *
 * The supervisor can lock the list, and a locked lembar has no button leading
 * here — but the server refuses it too (SHEET_ROWS_LOCKED), because the lock
 * may have been turned on while this handset was out of signal.
 */
export default function AddSheetRowScreen() {
  const { sheetId } = useLocalSearchParams<{ sheetId: string }>();
  const id = Number(sheetId);

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [sheet, setSheet] = useState<SheetRecord | null | undefined>(undefined);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    Promise.all([getSession(), getSheet(id)])
      .then(([current, found]) => {
        if (ignore) return;
        setSession(current);
        setSheet(found);
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, [id]);

  async function save() {
    if (!session) return;

    const trimmed = label.trim();
    if (!trimmed) {
      setError('Nama equipment wajib diisi.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await enqueueSheetRow({
        sheetId: id,
        label: trimmed,
        operatorName: session.operatorName,
        shiftGroup: session.shiftName,
        shiftTime: session.shiftTime,
      });
      router.replace({
        pathname: '/(tabs)/sheets/[id]',
        params: { id: String(id), saved: `${trimmed} ditambahkan` },
      });
    } catch {
      setError('Gagal menyimpan di HP. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined || sheet === undefined) return <Screen><Loading /></Screen>;
  if (!session) {
    return <Screen><Alert error="Sesi shift tidak ditemukan. Login ulang sebelum mencatat." /></Screen>;
  }
  if (!sheet?.allowOperatorRows) {
    return (
      <Screen>
        <Alert error="Supervisor mengunci daftar baris pada lembar ini." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Alert error={error || null} />

      <Field
        label="Nama equipment"
        hint="Tulis lengkap seperti di papan nama alat — orang lain harus bisa menemukannya."
      >
        <Input
          value={label}
          onChangeText={setLabel}
          placeholder="mis. 93P-104C"
          autoCapitalize="characters"
        />
      </Field>

      <Button
        title={busy ? 'Menyimpan…' : 'Tambah baris'}
        variant="primary"
        size="big"
        busy={busy}
        onPress={save}
      />

      <Text style={styles.note}>
        Baris ini akan muncul untuk shift lain juga setelah terkirim, dengan nama anda
        sebagai penambah.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { ...type.body, color: colors.muted, marginTop: space.lg },
});
