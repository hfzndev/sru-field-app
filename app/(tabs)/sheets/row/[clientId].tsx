import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { PhotoThumb } from '@/components/PhotoThumb';
import {
  Alert, Button, Field, Heading, Input, Loading, NumericInput, Screen,
} from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { photoUriFor } from '@/lib/photos';
import { enqueueSheetCell } from '@/lib/queue';
import { Session, getSession } from '@/lib/session';
import {
  CHECK_NO, CHECK_YES, FILLABLE_KINDS, SheetCell, SheetColumn, SheetRow, cellIsFilled, loadSheet,
} from '@/lib/sheets';

/**
 * Filling one row of a lembar tugas (doc 03 §4).
 *
 * This screen is the answer to the question the whole feature exists for: the
 * supervisor wrote "Foto Wide" and the operator has to guess what wide means.
 * The example photo sits directly beside the shutter, so there is nothing to
 * remember and nothing to interpret — take the picture that looks like that one.
 *
 * Saving writes one cell per field the operator touched, append-only
 * (doc 07 §4). Coming back and retaking a photo writes another cell rather than
 * replacing the first: the later `filled_at` is what everyone sees, and the
 * earlier shot stays as evidence of what the equipment looked like then.
 */
export default function SheetRowScreen() {
  const params = useLocalSearchParams<{
    clientId: string;
    sheetId: string;
    /** Set by app/camera.tsx on its way back, along with the column it was for. */
    photoName?: string;
    photoColumnId?: string;
  }>();

  const sheetId = Number(params.sheetId);
  const rowClientId = params.clientId;

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<{
    columns: SheetColumn[]; row: SheetRow | undefined; cells: Map<string, SheetCell>;
  } | null | undefined>(undefined);

  /** Only what the operator changed on this visit; untouched fields write nothing. */
  const [draft, setDraft] = useState<Record<number, { text?: string; number?: string }>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    getSession().then((s) => { if (!ignore) setSession(s); }).catch(() => {});
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    loadSheet(sheetId)
      .then((data) => {
        if (ignore) return;
        if (!data) { setLoaded(null); return; }
        setLoaded({
          columns: data.columns.filter((c) => FILLABLE_KINDS.has(c.kind) || c.kind === 'LABEL'),
          row: data.rows.find((r) => r.clientId === rowClientId),
          cells: data.cells,
        });
      })
      .catch(() => { if (!ignore) setLoaded(null); });
    return () => { ignore = true; };
  }, [sheetId, rowClientId, params.photoName]);

  if (session === undefined || loaded === undefined) return <Screen><Loading /></Screen>;
  if (!session) {
    return <Screen><Alert error="Sesi shift tidak ditemukan. Login ulang sebelum mencatat." /></Screen>;
  }
  if (!loaded?.row) {
    return <Screen><Alert error="Baris ini tidak ada di HP. Coba sync dulu." /></Screen>;
  }

  const { columns, row, cells } = loaded;

  // Derived from the route param, never copied into state — the same rule the
  // cleaning form follows. Two answers to "which photo is attached" would
  // disagree the moment the operator retakes it.
  const capturedColumnId = params.photoColumnId ? Number(params.photoColumnId) : null;
  const capturedUri = params.photoName ? photoUriFor(params.photoName) : '';

  function photoFor(column: SheetColumn): string {
    if (capturedColumnId === column.id && capturedUri) return capturedUri;
    const cell = cells.get(`${rowClientId}:${column.id}`);
    return cell?.photoLocalUri ?? '';
  }

  function textFor(column: SheetColumn): string {
    const pending = draft[column.id]?.text;
    if (pending !== undefined) return pending;
    return cells.get(`${rowClientId}:${column.id}`)?.valueText ?? '';
  }

  function numberFor(column: SheetColumn): string {
    const pending = draft[column.id]?.number;
    if (pending !== undefined) return pending;
    const stored = cells.get(`${rowClientId}:${column.id}`)?.valueNumber;
    return stored === null || stored === undefined ? '' : String(stored);
  }

  function setText(columnId: number, text: string) {
    setDraft((current) => ({ ...current, [columnId]: { ...current[columnId], text } }));
  }

  function setNumber(columnId: number, value: string) {
    setDraft((current) => ({ ...current, [columnId]: { ...current[columnId], number: value } }));
  }

  async function save() {
    if (!session || !row) return;
    setError('');

    const writes: { columnId: number; text?: string; number?: number | null; photo?: string }[] = [];

    for (const column of columns) {
      if (column.kind === 'LABEL') continue;

      if (column.kind === 'PHOTO') {
        // Only a photo taken on this visit is a new cell. An existing one is
        // already stored and re-writing it every save would fill the append-only
        // table with copies of the same picture.
        if (capturedColumnId === column.id && capturedUri) {
          writes.push({ columnId: column.id, photo: capturedUri });
        }
        continue;
      }

      const pending = draft[column.id];
      if (!pending) continue;

      if (column.kind === 'NUMBER') {
        const raw = (pending.number ?? '').trim();
        if (raw === '') continue;
        const value = Number(raw.replace(',', '.'));
        if (!Number.isFinite(value)) {
          setError(`${column.label} harus berupa angka.`);
          return;
        }
        writes.push({ columnId: column.id, number: value });
      } else {
        const text = (pending.text ?? '').trim();
        if (text === '') continue;
        writes.push({ columnId: column.id, text });
      }
    }

    if (writes.length === 0) {
      setError('Belum ada yang diisi pada baris ini.');
      return;
    }

    setBusy(true);
    try {
      for (const write of writes) {
        await enqueueSheetCell({
          sheetId,
          rowClientId,
          columnId: write.columnId,
          valueText: write.text ?? '',
          valueNumber: write.number ?? null,
          photoLocalUri: write.photo ?? '',
          operatorName: session.operatorName,
          shiftGroup: session.shiftName,
          shiftTime: session.shiftTime,
        });
      }
      router.replace({
        pathname: '/(tabs)/sheets/[id]',
        params: { id: String(sheetId), saved: `${row.label} tersimpan` },
      });
    } catch {
      setError('Gagal menyimpan di HP. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Heading sub="Isi yang bisa diisi sekarang; sisanya bisa dilanjutkan nanti.">
        {row.label}
      </Heading>

      <Alert error={error || null} />

      {columns.map((column) => {
        if (column.kind === 'LABEL') {
          return (
            <View key={column.id} style={styles.labelBlock}>
              <Text style={styles.labelTitle}>{column.label}</Text>
              {column.hint ? <Text style={styles.labelBody}>{column.hint}</Text> : null}
            </View>
          );
        }

        const stored = cells.get(`${rowClientId}:${column.id}`);
        const label = column.isRequired ? column.label : `${column.label} (opsional)`;

        if (column.kind === 'PHOTO') {
          const attached = photoFor(column);
          return (
            <Field key={column.id} label={label} hint={column.hint || undefined}>
              <View style={styles.photoRow}>
                {/* The supervisor's shot and the operator's, side by side. This
                    pairing is the feature: "wide" stops being a word to
                    interpret and becomes a picture to match. */}
                {column.examplePhoto ? (
                  <PhotoThumb label="Contoh" serverPath={column.examplePhoto} size={132} />
                ) : null}
                <PhotoThumb
                  label={attached ? 'Foto anda' : 'Belum ada'}
                  localUri={attached}
                  serverPath={!attached ? stored?.photoPath : undefined}
                  size={132}
                />
              </View>
              <Button
                title={attached ? 'Ambil ulang' : 'Ambil foto'}
                variant={attached ? 'secondary' : 'primary'}
                size="big"
                onPress={() => router.push({
                  pathname: '/camera',
                  params: {
                    // The camera passes every extra param straight back, which
                    // is how the photo finds its way to the right column.
                    returnTo: '/(tabs)/sheets/row/[clientId]',
                    label: column.label.toUpperCase(),
                    clientId: rowClientId,
                    sheetId: String(sheetId),
                    photoColumnId: String(column.id),
                  },
                })}
              />
              {stored && cellIsFilled('PHOTO', stored) && attached !== stored.photoLocalUri ? (
                <Text style={styles.note}>Foto lama tetap tersimpan sebagai riwayat.</Text>
              ) : null}
            </Field>
          );
        }

        if (column.kind === 'NUMBER') {
          return (
            <Field key={column.id} label={label} hint={column.hint || undefined}>
              <NumericInput
                value={numberFor(column)}
                onChangeText={(value) => setNumber(column.id, value)}
                unit={column.options[0]}
                placeholder="0"
              />
            </Field>
          );
        }

        if (column.kind === 'CHECK' || column.kind === 'CHOICE') {
          const options = column.kind === 'CHECK' ? [CHECK_YES, CHECK_NO] : column.options;
          return (
            <Field key={column.id} label={label} hint={column.hint || undefined}>
              <Choice
                layout={options.length <= 3 ? 'segments' : 'wrap'}
                value={textFor(column) || null}
                onChange={(value) => setText(column.id, value ?? '')}
                options={options.map((option) => ({ value: option, label: option }))}
              />
            </Field>
          );
        }

        return (
          <Field key={column.id} label={label} hint={column.hint || undefined}>
            <Input
              value={textFor(column)}
              onChangeText={(value) => setText(column.id, value)}
              placeholder="Tulis di sini"
              multiline
            />
          </Field>
        );
      })}

      <Button
        title={busy ? 'Menyimpan…' : 'Simpan baris'}
        variant="primary"
        size="big"
        busy={busy}
        onPress={save}
      />

      <Text style={styles.note}>
        Tersimpan di HP dulu. Terkirim otomatis begitu ada sinyal.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  labelBlock: { marginBottom: space.lg },
  labelTitle: { ...type.bodyStrong, color: colors.text },
  labelBody: { ...type.body, color: colors.muted, marginTop: space.xs },
  photoRow: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  note: { ...type.body, color: colors.muted, marginTop: space.sm },
});
