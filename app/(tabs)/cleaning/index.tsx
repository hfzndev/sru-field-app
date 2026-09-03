import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PhotoThumb } from '@/components/PhotoThumb';
import { Button, Card, Chip, Empty, Heading, Loading, Screen, Toast } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import { CleaningRow, listCleaning } from '@/lib/queue';

/**
 * Cleaning sessions (doc 03 §3.4).
 *
 * Unfinished sessions sit at the top, because an IN_PROGRESS session is work
 * the shift still owes — the area was photographed and cleaned, and the record
 * is not evidence of anything until the AFTER photo is on it.
 */
export default function CleaningScreen() {
  const { saved } = useLocalSearchParams<{ saved?: string }>();
  const [rows, setRows] = useState<CleaningRow[] | null>(null);
  const [toast, setToast] = useState<string | null>(saved ?? null);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const data = await listCleaning();
      if (!ignore) setRows(data);
    })();
    return () => { ignore = true; };
  }, []));

  const unfinished = (rows ?? []).filter((r) => r.status === 'IN_PROGRESS').length;

  return (
    <Screen>
      <Toast message={toast} onDone={() => setToast(null)} />

      <Heading sub="Foto sebelum, bersihkan, foto sesudah dari sudut yang sama.">
        Bersih-bersih
      </Heading>

      <Button
        title="+ Dokumentasi baru"
        variant="primary"
        size="big"
        onPress={() => router.push('/(tabs)/cleaning/new')}
      />

      {unfinished > 0 && (
        <Text style={styles.pending}>
          {unfinished} sesi belum selesai — masih menunggu foto sesudah.
        </Text>
      )}

      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          icon="🧹"
          title="Belum ada dokumentasi"
          hint="Foto dulu sebelum dibersihkan — sesudahnya tidak bisa diulang."
        />
      ) : (
        rows.map((row) => (
          <Card key={row.clientId} onPress={() => router.push({
            pathname: '/(tabs)/cleaning/[id]',
            params: { id: row.clientId },
          })}>
            <View style={styles.head}>
              <Text style={styles.location}>{row.location}</Text>
              <Chip
                value={row.status}
                label={row.status === 'DONE' ? 'Selesai' : 'Belum selesai'}
              />
            </View>

            <Text style={styles.meta}>
              {[
                row.operatorName,
                SHIFT_TIME_LABEL[row.shiftTime] ?? row.shiftTime,
                formatDateTime(row.beforePhotoAt ?? row.createdAt),
              ].filter(Boolean).join(' · ')}
            </Text>

            <View style={styles.photos}>
              <PhotoThumb
                label="Sebelum"
                localUri={row.beforePhotoLocalUri}
                serverPath={row.beforePhoto}
                size={120}
              />
              <PhotoThumb
                label="Sesudah"
                localUri={row.afterPhotoLocalUri}
                serverPath={row.afterPhoto}
                size={120}
              />
            </View>

            {row.syncStatus !== 'SYNCED' && (
              <Text style={styles.unsent}>
                {row.syncStatus === 'SYNC_ERROR' ? 'Ditolak server' : 'Belum terkirim'}
              </Text>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  location: { ...type.bodyStrong, color: colors.text, flex: 1 },
  meta: { ...type.caption, color: colors.muted, marginTop: 2 },
  photos: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  pending: { ...type.body, color: colors.warn, marginTop: space.md },
  unsent: { ...type.caption, color: colors.warn, marginTop: space.sm },
});
