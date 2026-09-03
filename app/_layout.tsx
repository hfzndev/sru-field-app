import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, type } from '@/constants/theme';

export const unstable_settings = { initialRouteName: 'login' };

/**
 * Root navigator.
 *
 * Login sits outside the tabs: an operator who is not signed in has no shift
 * context, and every screen inside depends on one.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { ...type.heading, color: colors.text },
          headerTintColor: colors.accent,
          contentStyle: { backgroundColor: colors.bg },
          headerLeft: ({ canGoBack }) => (canGoBack ? <HeaderBack /> : null),
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="shift-start" options={{ title: 'Mulai Shift', headerBackVisible: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Pengaturan' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
