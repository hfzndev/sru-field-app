import { Link, Tabs } from 'expo-router';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { ColorValue, Pressable, Text, View } from 'react-native';
import { TOUCH_TARGET, colors, space, type } from '@/constants/theme';
import { runSync } from '@/lib/sync';
import { useUnsent } from '@/lib/status';

/**
 * Bottom tabs: Beranda, Tangki, Aktivitas, Bersih-bersih, Servis.
 *
 * Phase 4 brought equipment, and six tabs do not fit a phone bar at a 16pt
 * label. Sync gave up its place rather than any record type: it is the only one
 * that is not a thing the operator records, it already runs by itself on open
 * and whenever the connection returns, and the two ways in that remain — the
 * unsent badge in the header, and the button on Beranda — are both closer to
 * where an operator actually notices something is unsent.
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
 *
 * It is the way into Sync now that Sync has no tab. That is the right pairing:
 * the moment an operator wants to send is the moment they notice this number,
 * and tapping the thing you just noticed beats hunting the bar for it.
 */
function UnsentBadge() {
  const unsent = useUnsent();
  if (unsent === 0) return null;
  return (
    <Link href="/(tabs)/sync" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${unsent} catatan belum terkirim — buka Sync`}
        hitSlop={8}
        style={{
          minHeight: TOUCH_TARGET,
          justifyContent: 'center',
          backgroundColor: colors.warnSoft,
          paddingHorizontal: space.md,
          borderRadius: 999,
          marginRight: space.xs,
        }}
      >
        <Text style={{ color: colors.warn, fontWeight: '700', fontSize: 15 }}>
          ⬆ {unsent}
        </Text>
      </Pressable>
    </Link>
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
        name="cleaning"
        options={{ title: 'Bersih', headerShown: false, tabBarIcon: ({ color }) => <TabIcon glyph="🧹" color={color} /> }}
      />
      <Tabs.Screen
        name="maintenance"
        // Short on purpose: at the 16pt label floor with five tabs, anything
        // longer truncates mid-word ("Mainte…", "Perawa…"). Same trade the
        // Bersih tab already makes.
        options={{ title: 'Servis', headerShown: false, tabBarIcon: ({ color }) => <TabIcon glyph="🔧" color={color} /> }}
      />
      {/* Still a route, no longer a tab — reached from the header badge and
          from Beranda. href: null keeps it navigable while taking it out of
          the bar. */}
      <Tabs.Screen name="sync" options={{ title: 'Sync', href: null }} />
    </Tabs>
  );
}
