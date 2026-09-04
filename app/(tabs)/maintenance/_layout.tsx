import { Stack } from 'expo-router';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, type } from '@/constants/theme';

/**
 * Maintenance stack: the Alat/Task list → one item → its form (doc 03 §3.5).
 *
 * The status form is its own route rather than a sheet on the detail screen
 * because the description is mandatory (doc 02 §1.2), and a mandatory field
 * hidden behind an expander is a field people learn to skip.
 */
export default function MaintenanceLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Servis' }} />
      <Stack.Screen name="equipment/[id]" options={{ title: 'Detail alat' }} />
      <Stack.Screen name="equipment/status" options={{ title: 'Ubah status' }} />
      <Stack.Screen name="tasks/[id]" options={{ title: 'Progres task' }} />
    </Stack>
  );
}
