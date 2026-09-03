import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeaderBack } from '@/components/HeaderBack';
import { colors, space, type } from '@/constants/theme';
import { ensureInstallId, getDb } from '@/lib/db';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Root navigator.
 *
 * Nothing renders until local storage is open and migrated. Every screen in
 * this app reads or writes the database, and a screen that mounts against a
 * half-open connection would either flash empty or silently drop a write —
 * the one failure mode this product cannot have.
 *
 * Login sits outside the tabs: an operator who is not signed in has no shift
 * context, and everything inside depends on one.
 */
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        await getDb();
        await ensureInstallId();
        if (!ignore) setReady(true);
      } catch (err) {
        // Surfaced rather than swallowed: if storage cannot open, the app
        // cannot keep a promise it is built on, and pretending otherwise would
        // let an operator record work that was never saved.
        if (!ignore) setFailure(err instanceof Error ? err.message : String(err));
      } finally {
        SplashScreen.hideAsync().catch(() => {});
      }
    })();
    return () => { ignore = true; };
  }, []);

  if (failure) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl, justifyContent: 'center' }}>
          <Text style={{ ...type.title, color: colors.danger, marginBottom: space.sm }}>
            Penyimpanan HP gagal dibuka
          </Text>
          <Text style={{ ...type.body, color: colors.text }}>
            Aplikasi tidak bisa menyimpan catatan dengan aman. Jangan dipakai mencatat
            dulu — laporkan ke admin.
          </Text>
          <Text style={{ ...type.caption, color: colors.muted, marginTop: space.lg }}>{failure}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) return null; // splash stays up

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
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="shift-start" options={{ title: 'Mulai Shift', headerBackVisible: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Pengaturan' }} />
        <Stack.Screen name="summary" options={{ title: 'Rangkuman Shift' }} />
        {/* Full bleed: a viewfinder with a navigation bar over it wastes the
            part of the screen the operator is actually aiming. */}
        <Stack.Screen name="camera" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
