import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PhotoThumb } from '@/components/PhotoThumb';
import { Alert, Button, Card, Chip, Heading, Loading, Screen } from '@/components/ui';
import { SHIFT_TIME_LABEL, colors, space, type } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import { photoUriFor } from '@/lib/photos';
import { CleaningRow, completeCleaning, getCleaning } from '@/lib/queue';

/**
 * One cleaning session, and the place its AFTER photo is added (doc 02 §3).
 *
 * Completing a session is the one action in this app that reopens a record the
 * server already has. The session goes back to PENDING_SYNC and is sent again
 * under the same client_id; the server moves only the four columns it is
 * allowed to (doc 07 §4), so the location, the BEFORE photo and who recorded it
 * cannot be rewritten by the second send.
 */
export default function CleaningSessionScreen() {
  const { id, photoName } = useLocalSearchParams<{ id: string; photoName?: string }>();

  const [row, setRow] = useState<CleaningRow | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let ignore = false;
    (async () => {
      const found = await getCleaning(id);
      if (ignore) return;

      // The camera hands the photo back through params. Attaching it here — on
      // arrival rather than behind another button — means the operator cannot
      // walk away believing a photo they just took has been saved when it has
      // not.
      if (photoName && found && !found.afterPhotoLocalUri && found.status !== 'DONE') {
        try {
          await completeCleaning(id, photoUriFor(photoName));
          if (!ignore) setRow(await getCleaning(id));
          return;
        } catch {
          if (!ignore) setError('Foto sesudah gagal disimpan. Coba lagi.');
        }
      }
      setRow(found);
    })();
    return () => { ignore = true; };
  }, [id, photoName]));

  if (row === undefined) return <Screen><Loading /></Screen>;
  if (!row) {
    return (
      <Screen>
        <Alert error="Sesi tidak ditemukan di HP ini." />
        <Button title="Kembali" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const done = row.status === 'DONE';

  return (
    <Screen>
      <Alert error={error || null} />

      <Heading sub={[
        row.operatorName,
        SHIFT_TIME_LABEL[row.shiftTime] ?? row.shiftTime,
      ].filter(Boolean).join(' · ')}>
        {row.location}
      </Heading>

      <Card>
        <View style={styles.head}>
          <Chip value={row.status} label={done ? 'Selesai' : 'Belum selesai'} />
          {row.syncStatus !== 'SYNCED' && (
            <Text style={styles.unsent}>
              {row.syncStatus === 'SYNC_ERROR' ? 'Ditolak server' : 'Belum terkirim'}
            </Text>
          )}
        </View>

        {!!row.note && <Text style={styles.note}>{row.note}</Text>}

        <View style={styles.photos}>
          <PhotoThumb
            label={`Sebelum · ${formatDateTime(row.beforePhotoAt)}`}
            localUri={row.beforePhotoLocalUri}
            serverPath={row.beforePhoto}
            size={150}
          />
          <PhotoThumb
            label={done ? `Sesudah · ${formatDateTime(row.afterPhotoAt)}` : 'Sesudah'}
            localUri={row.afterPhotoLocalUri}
            serverPath={row.afterPhoto}
            size={150}
          />
        </View>
      </Card>

      {done ? (
        <Text style={styles.finished}>
          Sesi selesai. Kedua foto tersimpan dan akan terkirim ke server.
        </Text>
      ) : (
        <>
          <Button
            title={busy ? 'Menyimpan…' : 'Ambil foto sesudah'}
            variant="primary"
            size="big"
            busy={busy}
            onPress={() => {
              setBusy(true);
              router.push({
                pathname: '/camera',
                params: {
                  returnTo: '/(tabs)/cleaning/[id]',
                  id,
                  label: 'Foto SESUDAH — sudut yang sama',
                },
              });
              setBusy(false);
            }}
          />
          <Text style={styles.hint}>
            Ambil dari sudut yang sama seperti foto sebelum, supaya perbedaannya terlihat.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  note: { ...type.body, color: colors.text, marginTop: space.sm },
  photos: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  unsent: { ...type.caption, color: colors.warn },
  hint: { ...type.caption, color: colors.muted, marginTop: space.sm },
  finished: { ...type.body, color: colors.ok, marginTop: space.md },
});
