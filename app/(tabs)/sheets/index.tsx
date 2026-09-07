import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Card, Empty, Heading, Loading, ProgressBar, Screen, Toast } from '@/components/ui';
import { ICON } from '@/components/icon';
import { StyleSheet, Text } from 'react-native';
import { colors, space, type } from '@/constants/theme';
import { formatDate } from '@/lib/format';
import {
  SheetProgress, SheetRecord, completionText, currentCells, listColumns, listRows, listSheets,
  progressOf,
} from '@/lib/sheets';

/**
 * Lembar tugas an operator can still fill (doc 03 §4).
 *
 * Only OPEN ones are stored locally at all (lib/sheets.ts listSheets), so this
 * list is the work outstanding and nothing else. A lembar the supervisor closed
 * disappears on the next pull rather than sitting here inviting a walk that
 * would be rejected on sync.
 *
 * Everything is read from SQLite, so the screen renders identically with or
 * without signal — which is the only state that matters, because the lembar is
 * filled out in the plant.
 */
type Entry = { sheet: SheetRecord; progress: SheetProgress };

export default function SheetsScreen() {
  const { saved } = useLocalSearchParams<{ saved?: string }>();
  const [toast, setToast] = useState<string | null>(saved ?? null);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  // On focus, not on mount: the operator comes back here after filling a row,
  // and a progress count one row out of date is the one thing this screen must
  // never show.
  useFocusEffect(
    useCallback(() => {
      let ignore = false;
      (async () => {
        const sheets = await listSheets();
        const loaded: Entry[] = [];
        for (const sheet of sheets) {
          const [columns, rows, cells] = await Promise.all([
            listColumns(sheet.id), listRows(sheet.id), currentCells(sheet.id),
          ]);
          loaded.push({ sheet, progress: progressOf(columns, rows, cells) });
        }
        if (!ignore) setEntries(loaded);
      })();
      return () => { ignore = true; };
    }, []),
  );

  if (!entries) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Heading sub="Tugas dari supervisor. Bisa diisi tanpa sinyal.">Lembar Tugas</Heading>

      {entries.length === 0 ? (
        <Empty
          icon={ICON.emptyDoc}
          title="Belum ada lembar tugas"
          hint="Lembar baru muncul di sini setelah sync berikutnya."
        />
      ) : (
        entries.map(({ sheet, progress }) => (
          <Card key={sheet.id} onPress={() => router.push(`/(tabs)/sheets/${sheet.id}`)}>
            <Text style={styles.title}>{sheet.title}</Text>
            {sheet.description ? (
              <Text style={styles.description} numberOfLines={2}>{sheet.description}</Text>
            ) : null}
            {sheet.dueDate ? (
              <Text style={styles.due}>Target selesai {formatDate(sheet.dueDate)}</Text>
            ) : null}

            <ProgressBar
              done={progress.rowsDone}
              total={progress.rows}
              label={completionText(progress)}
            />
          </Card>
        ))
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...type.bodyStrong, color: colors.text },
  description: { ...type.body, color: colors.muted, marginTop: space.xs },
  due: { ...type.body, color: colors.muted, marginTop: space.xs },
});
