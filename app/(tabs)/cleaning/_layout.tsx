import { Stack } from 'expo-router';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, type } from '@/constants/theme';

/**
 * Cleaning stack: list → new session → session detail.
 *
 * The detail screen is its own route because a session is returned to later,
 * often on a different day, to add the AFTER photo (doc 02 §3).
 */
export default function CleaningLayout() {
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
      <Stack.Screen name="index" options={{ title: 'GHK' }} />
      <Stack.Screen name="new" options={{ title: 'Dokumentasi baru' }} />
      <Stack.Screen name="[id]" options={{ title: 'Sesi bersih-bersih' }} />
    </Stack>
  );
}
