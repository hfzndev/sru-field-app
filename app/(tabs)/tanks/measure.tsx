import { useLocalSearchParams } from 'expo-router';
import { Empty, Screen } from '@/components/ui';

/**
 * The guided midband measurement (doc 03 §3.2, doc 02 §2).
 *
 * One step per screen: DCS reading, then the tape suggestion with the
 * empty-bob retry loop, then the actual tape length and bandul height, then a
 * preview before saving. That retry loop is the SOP rather than an error path —
 * an empty bob on the first pull is the normal outcome.
 *
 * Built in task 6, on top of the calculator from task 3.
 */
export default function MeasureScreen() {
  useLocalSearchParams<{ tankId: string }>();

  return (
    <Screen>
      <Empty
        icon="📏"
        title="Alur ukur belum aktif"
        hint="Kalkulator midband dan langkah pengukuran menyusul."
      />
    </Screen>
  );
}
