import { Stack } from 'expo-router';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, type } from '@/constants/theme';

/**
 * Tank stack: list → history → measure. The measure flow is its own route so
 * that backing out of a half-finished measurement returns to the tank rather
 * than the tab root (doc 03 §5).
 */
export default function TanksLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Midband' }} />
      <Stack.Screen name="[id]" options={{ title: 'Riwayat' }} />
      <Stack.Screen name="measure" options={{ title: 'Ukur tangki' }} />
    </Stack>
  );
}
