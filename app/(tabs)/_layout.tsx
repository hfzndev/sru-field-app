import { Link, Tabs } from 'expo-router';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { ColorValue, Pressable, Text } from 'react-native';
import { TOUCH_TARGET, colors, space, type } from '@/constants/theme';
import { runSync } from '@/lib/sync';

/**
 * Bottom tabs.
 *
 * Only the Phase 2 scope is here: Beranda, Tangki and Sync. Aktivitas and
 * Bersih-bersih arrive in Phase 3, Maintenance in Phase 4. Showing them now as
 * dead tabs would train operators to ignore parts of the bar.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  // Auto-sync on open and whenever the connection returns (doc 03 §3.6).
  // Deliberately fire-and-forget: sync must never block the operator from
  // recording, and runSync already collapses overlapping calls.
  useEffect(() => {
    runSync().catch(() => {});

    const subscription = Network.addNetworkStateListener(({ isConnected }) => {
      if (isConnected) runSync().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        // 16pt labels and a taller bar: doc 03 §1 sets 16 as the floor for
        // readable text, and the usual 12pt tab label sits below it. With only
        // three tabs there is room, so the floor holds here too.
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 74, paddingTop: 6, paddingBottom: 10 },
        tabBarLabelStyle: { fontSize: 16, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { ...type.heading, color: colors.text },
        headerRight: () => (
          <Link href="/settings" asChild>
            <Pressable
              accessibilityLabel="Pengaturan"
              hitSlop={8}
              style={{ minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}
            >
              <Text style={{ fontSize: 20 }}>⚙️</Text>
            </Pressable>
          </Link>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Beranda', tabBarIcon: ({ color }) => <TabIcon glyph="🏠" color={color} /> }}
      />
      <Tabs.Screen
        name="tanks"
        options={{ title: 'Tangki', headerShown: false, tabBarIcon: ({ color }) => <TabIcon glyph="🛢️" color={color} /> }}
      />
      <Tabs.Screen
        name="sync"
        options={{ title: 'Sync', tabBarIcon: ({ color }) => <TabIcon glyph="🔄" color={color} /> }}
      />
    </Tabs>
  );
}
