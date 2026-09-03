import { Link, Tabs } from 'expo-router';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { ColorValue, Pressable, Text, View } from 'react-native';
import { TOUCH_TARGET, colors, space, type } from '@/constants/theme';
import { runSync } from '@/lib/sync';
import { useUnsent } from '@/lib/status';

/**
 * Bottom tabs.
 *
 * Beranda, Tangki, Aktivitas, Bersih-bersih and Sync. Maintenance arrives in
 * Phase 4 and will make six, which is more than fits a phone bar at this label
 * size — that is the point to re-cut the navigation, not now.
 *
 * A tab is added only once it leads somewhere real. Dead tabs train operators
 * to ignore parts of the bar.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

/**
 * The unsent count, in the header of every tab (doc 03 §1).
 *
 * Hidden at zero rather than shown as "0": a permanent badge becomes furniture
 * and stops being read, and the whole point is that it is noticed on the day it
 * is not zero.
 */
function UnsentBadge() {
  const unsent = useUnsent();
  if (unsent === 0) return null;
  return (
    <View style={{
      backgroundColor: colors.warnSoft,
      paddingHorizontal: space.md,
      paddingVertical: 4,
      borderRadius: 999,
      marginRight: space.xs,
    }}>
      <Text style={{ color: colors.warn, fontWeight: '700', fontSize: 15 }}>
        ⬆ {unsent}
      </Text>
    </View>
  );
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <UnsentBadge />
            <Link href="/settings" asChild>
            <Pressable
              accessibilityLabel="Pengaturan"
              hitSlop={8}
              style={{ minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}
            >
                <Text style={{ fontSize: 20 }}>⚙️</Text>
              </Pressable>
            </Link>
          </View>
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
        name="activities"
        options={{ title: 'Aktivitas', headerShown: false, tabBarIcon: ({ color }) => <TabIcon glyph="📝" color={color} /> }}
      />
      <Tabs.Screen
        name="sync"
        options={{ title: 'Sync', tabBarIcon: ({ color }) => <TabIcon glyph="🔄" color={color} /> }}
      />
    </Tabs>
  );
}
