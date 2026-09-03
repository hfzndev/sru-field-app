import { Stack } from 'expo-router';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, type } from '@/constants/theme';

export default function ActivitiesLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Aktivitas' }} />
      <Stack.Screen name="new" options={{ title: 'Catat aktivitas' }} />
    </Stack>
  );
}
