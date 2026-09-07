import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Alert, Button, Card, Empty, Heading, ListGroup, ListRow, Loading, ProgressBar, Screen, Toast,
} from '@/components/ui';
import { ICON } from '@/components/icon';
import { colors, space, type } from '@/constants/theme';
import {
  FILLABLE_KINDS, SheetCell, SheetColumn, SheetRecord, SheetRow, cellIsFilled, completionText,
  loadSheet,
} from '@/lib/sheets';

/**
 * One lembar tugas, as a list of rows (doc 03 §4).
 *
 * The supervisor's grid becomes a row list here on purpose. A phone cannot show
 * a table without either shrinking the text under the 16pt floor or making
 * every cell a target smaller than a thumb, and both are rules this app does
 * not bend (constants/theme.ts).
 *
 * What survives the translation is the shape of the work: one row per piece of
 * equipment, worst-first by being unfinished, with a rail and a count of the
 * required cells still empty. The operator taps a row and gets that row's
 * fields, one screenful, with the supervisor's example photo beside the shutter.
 */
type Loaded = {
  sheet: SheetRecord;
  columns: SheetColumn[];
  rows: SheetRow[];
  cells: Map<string, SheetCell>;
  progress: { filled: number; total: number; rowsDone: number; rows: number };
};

export default function SheetScreen() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const sheetId = Number(id);

  const [toast, setToast] = useState<string | null>(saved ?? null);
  const [data, setData] = useState<Loaded | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let ignore = false;
      loadSheet(sheetId)
        .then((loaded) => { if (!ignore) setData(loaded as Loaded | null); })
        .catch(() => { if (!ignore) setData(null); });
      return () => { ignore = true; };
    }, [sheetId]),
  );

  if (data === undefined) return <Screen><Loading /></Screen>;
  if (!data) {
    return (
      <Screen>
        <Alert error="Lembar tugas ini tidak ada di HP. Coba sync dulu." />
      </Screen>
    );
  }

  const { sheet, columns, rows, cells, progress } = data;
  const required = columns.filter((c) => c.isRequired && FILLABLE_KINDS.has(c.kind));

  return (
    <Screen>
      <Heading sub={sheet.description || undefined}>{sheet.title}</Heading>

      <Card>
        <ProgressBar
          done={progress.rowsDone}
          total={progress.rows}
          label={completionText(progress)}
        />
        {/* Said once, here, rather than on every row: the completion moment is
            the reward this feature offers, and repeating it would wear it out. */}
        {progress.total > 0 && progress.rowsDone === progress.rows && (
          <Text style={styles.done}>
            Semua baris selesai. Catatan terkirim otomatis saat ada sinyal.
          </Text>
        )}
      </Card>

      {rows.length === 0 ? (
        <Empty
          icon={ICON.emptyList}
          title="Belum ada baris"
          hint={sheet.allowOperatorRows
            ? 'Tambahkan sendiri equipment yang harus didatangi.'
            : 'Supervisor belum menambahkan baris pada lembar ini.'}
        />
      ) : (
        <ListGroup>
          {rows.map((row) => {
            const done = required.filter(
              (c) => cellIsFilled(c.kind, cells.get(`${row.clientId}:${c.id}`)),
            ).length;
            const complete = required.length > 0 && done === required.length;

            return (
              <ListRow
                key={row.clientId}
                title={row.label}
                titleNumeric
                subtitle={required.length === 0
                  ? undefined
                  : complete ? 'Lengkap' : `${done} dari ${required.length} terisi`}
                meta={row.addedByName && row.addedByName !== 'admin'
                  ? `Ditambah ${row.addedByName}`
                  : undefined}
                // The rail resolves at arm's length, before any word does —
                // which is what makes a half-walked lembar readable at a glance.
                status={complete ? 'DONE' : 'OPEN'}
                statusLabel={complete ? 'Selesai' : 'Belum'}
                onPress={() => router.push({
                  pathname: '/(tabs)/sheets/row/[clientId]',
                  params: { clientId: row.clientId, sheetId: String(sheetId) },
                })}
              />
            );
          })}
        </ListGroup>
      )}

      {sheet.allowOperatorRows && (
        <View style={styles.addRow}>
          <Button
            title="+ Tambah baris"
            variant="secondary"
            size="big"
            onPress={() => router.push({
              pathname: '/(tabs)/sheets/add-row',
              params: { sheetId: String(sheetId) },
            })}
          />
          <Text style={styles.addHint}>
            Untuk equipment yang belum ada di daftar supervisor.
          </Text>
        </View>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  done: { ...type.body, color: colors.ok, marginTop: space.sm },
  addRow: { marginTop: space.lg },
  addHint: { ...type.body, color: colors.muted, marginTop: space.xs },
});
