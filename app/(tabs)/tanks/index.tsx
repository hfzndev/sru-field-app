import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { mm } from '@/lib/format';

/**
 * Tank list (doc 03 §3.2).
 *
 * Two tanks, and the code is always written in full. Doc 02 §1.1 is blunt about
 * this: "T-401" invites measuring the wrong tank, and these two sit next to each
 * other. Nothing in this app ever abbreviates them.
 *
 * Task 7 replaces the placeholder data with the cached master list.
 */
const PLACEHOLDER_TANKS = [
  { id: 1, code: '93T-401', name: 'Tangki Sulfur 93T-401', heightMm: 7953, lastLevelMm: null as number | null },
  { id: 2, code: '93T-402', name: 'Tangki Sulfur 93T-402', heightMm: 7974, lastLevelMm: null as number | null },
];

export default function TanksScreen() {
  return (
    <Screen>
      {PLACEHOLDER_TANKS.map((tank) => (
        <Card key={tank.id}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.code}>{tank.code}</Text>
              <Text style={styles.meta}>Tinggi {mm(tank.heightMm)}</Text>
            </View>
            <View style={styles.lastWrap}>
              <Text style={styles.lastLabel}>Terakhir</Text>
              <Text style={styles.lastValue}>
                {tank.lastLevelMm === null ? '—' : mm(tank.lastLevelMm)}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <Button
                title="+ Ukur"
                variant="primary"
                onPress={() => router.push({ pathname: '/(tabs)/tanks/measure', params: { tankId: String(tank.id) } })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Riwayat"
                onPress={() => router.push({ pathname: '/(tabs)/tanks/[id]', params: { id: String(tank.id) } })}
              />
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  code: { ...type.title, color: colors.text },
  meta: { ...type.caption, color: colors.muted, marginTop: 2 },
  lastWrap: { alignItems: 'flex-end' },
  lastLabel: { ...type.caption, color: colors.muted },
  lastValue: { ...type.bodyStrong, color: colors.text },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
