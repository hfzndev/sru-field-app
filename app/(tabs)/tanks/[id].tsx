import { useLocalSearchParams } from 'expo-router';
import { Empty, Screen } from '@/components/ui';

/**
 * Per-tank reading history (doc 03 §3.2.4).
 *
 * Reads from the local cache, so it works with no signal — that is the point of
 * keeping a 7-day window on the device (doc 07 §5). Task 7 fills it in.
 */
export default function TankHistoryScreen() {
  useLocalSearchParams<{ id: string }>();

  return (
    <Screen>
      <Empty
        icon="🛢️"
        title="Belum ada pengukuran"
        hint="Riwayat 7 hari terakhir akan muncul di sini."
      />
    </Screen>
  );
}
