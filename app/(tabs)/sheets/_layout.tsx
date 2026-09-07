import { Stack } from 'expo-router';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, type } from '@/constants/theme';

/**
 * Lembar tugas stack: list → one lembar's rows → one row's cells.
 *
 * Three levels rather than a grid, and that is the whole adaptation. The
 * supervisor designs a table and sees it as a table on a desk monitor; an
 * operator holding a 5-inch phone in a glove cannot hit a cell in one, so the
 * same data arrives here as a list of rows and then as one row's worth of
 * fields at a time (doc 03 §1: nothing tappable under 44pt).
 */
export default function SheetsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { ...type.heading, color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.bg },
        headerLeft: ({ canGoBack }) => (canGoBack ? <HeaderBack /> : null),
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Lembar Tugas' }} />
      <Stack.Screen name="[id]" options={{ title: 'Lembar tugas' }} />
      <Stack.Screen name="row/[clientId]" options={{ title: 'Isi baris' }} />
      <Stack.Screen name="add-row" options={{ title: 'Tambah baris' }} />
    </Stack>
  );
}
