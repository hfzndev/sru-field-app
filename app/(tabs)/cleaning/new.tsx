import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { PhotoThumb } from '@/components/PhotoThumb';
import { Alert, Button, Field, Input, Loading, Screen } from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { photoUriFor } from '@/lib/photos';
import { enqueueCleaning } from '@/lib/queue';
import { Session, getSession } from '@/lib/session';

/**
 * Start a cleaning session (doc 03 §3.4, doc 02 §3).
 *
 * The BEFORE photo is taken first and deliberately gates everything else: once
 * the area is cleaned there is no way back to photograph it, so a session
 * cannot be started without one.
 *
 * Saving leaves the session IN_PROGRESS. The AFTER photo is added later from
 * the session's own screen, often after this one has already synced.
 */
export default function NewCleaningScreen() {
  const { photoName } = useLocalSearchParams<{ photoName?: string }>();

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    getSession().then((current) => { if (!ignore) setSession(current); }).catch(() => {});
    return () => { ignore = true; };
  }, []);

  // Derived, not stored: the camera hands the photo back through route params,
  // which are already the source of truth. Copying it into state would give two
  // answers to "which photo is attached" and let them disagree after a retake.
  const before = photoName ? photoUriFor(photoName) : '';

  async function save() {
    if (!session) return;

    if (!before) {
      setError('Ambil foto sebelum dulu.');
      return;
    }
    if (!location.trim()) {
      setError('Lokasi kotoran wajib diisi.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await enqueueCleaning({
        location: location.trim(),
        note: note.trim(),
        beforePhotoLocalUri: before,
        operatorName: session.operatorName,
        shiftGroup: session.shiftName,
        shiftTime: session.shiftTime,
      });
      router.replace({
        pathname: '/(tabs)/cleaning',
        params: { saved: 'Sesi dimulai · tambahkan foto sesudah setelah dibersihkan' },
      });
    } catch {
      setError('Gagal menyimpan di HP. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) return <Screen><Loading /></Screen>;
  if (!session) {
    return (
      <Screen>
        <Alert error="Sesi shift tidak ditemukan. Login ulang sebelum mencatat." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Alert error={error || null} />

      <Field label="Foto sebelum" hint="Pastikan lokasi terlihat jelas dan cukup terang.">
        <PhotoThumb label={before ? 'Terpasang' : 'Belum ada'} localUri={before} size={160} />
        <Button
          title={before ? 'Ambil ulang' : 'Ambil foto sebelum'}
          variant={before ? 'secondary' : 'primary'}
          size="big"
          onPress={() => router.push({
            pathname: '/camera',
            params: { returnTo: '/(tabs)/cleaning/new', label: 'Foto SEBELUM' },
          })}
        />
      </Field>

      <Field label="Lokasi kotoran" hint="Sejelas mungkin — orang lain harus bisa menemukannya.">
        <Input
          value={location}
          onChangeText={setLocation}
          placeholder="mis. lantai area U-93 dekat kolom A"
          multiline
        />
      </Field>

      <Field label="Catatan (opsional)">
        <Input value={note} onChangeText={setNote} placeholder="mis. tumpahan sulfur" />
      </Field>

      <Button
        title={busy ? 'Menyimpan…' : 'Simpan sesi'}
        variant="primary"
        size="big"
        busy={busy}
        onPress={save}
      />

      <Text style={styles.note}>
        Sesi tersimpan sebagai belum selesai. Setelah dibersihkan, buka lagi sesi ini
        untuk menambahkan foto sesudah.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { ...type.caption, color: colors.muted, marginTop: space.lg },
});
