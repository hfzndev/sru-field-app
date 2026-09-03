import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Screen, Heading } from '@/components/ui';
import { BIG_TOUCH_TARGET, colors, space, type } from '@/constants/theme';
import { storePhoto } from '@/lib/photos';

/**
 * Camera for cleaning documentation (doc 03 §3.4).
 *
 * Takes the photo, compresses it and hands the caller back a path to a file
 * that is already somewhere permanent — so by the time this screen closes,
 * there is nothing left that a low-storage eviction could take away.
 *
 * The result travels as route params rather than through a module-level
 * variable: an operator who takes a photo and then gets pulled away leaves
 * nothing half-attached behind, and there is no stale capture waiting to
 * attach itself to whatever they open next.
 *
 * Photos are the one thing in this app that cannot be re-created later. The
 * area gets cleaned; the "before" is gone. That is why the shutter is the
 * largest control on the screen and why failures here say what happened
 * instead of quietly returning.
 */
export default function CameraScreen() {
  // returnTo and label are this screen's own; everything else belongs to the
  // caller and is handed straight back, so a screen can send along whatever it
  // needs to find itself again — a session id, for instance.
  const { returnTo, label, ...caller } = useLocalSearchParams<{
    returnTo: string;
    label?: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  async function capture() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // skipProcessing stays off: it hands back an image whose orientation
      // depends on how the phone was held, and a sideways photograph of a
      // floor is hard to compare against its pair.
      const shot = await cameraRef.current?.takePictureAsync({ quality: 1 });
      if (!shot?.uri) throw new Error('Kamera tidak mengembalikan foto');

      const stored = await storePhoto(shot.uri);

      router.replace({
        pathname: returnTo as never,
        params: {
          ...caller,
          // The filename, not the uri — a uri survives a router param only by
          // luck, because params are percent-decoded in transit.
          photoName: stored.name,
          photoBytes: String(stored.bytes),
        },
      });
    } catch (err) {
      // Kept on screen rather than thrown away: the operator is standing in
      // front of the thing they need to photograph and can simply try again.
      setError(err instanceof Error ? err.message : 'Foto gagal disimpan. Coba lagi.');
      setBusy(false);
    }
  }

  if (!permission) {
    return (
      <Screen banner={false}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen banner={false}>
        <Heading sub="Foto sebelum dan sesudah adalah bukti pekerjaan bersih-bersih.">
          Izin kamera
        </Heading>
        {permission.canAskAgain ? (
          <Button title="Izinkan kamera" variant="primary" size="big" onPress={requestPermission} />
        ) : (
          <Text style={styles.denied}>
            Izin kamera ditolak permanen. Buka Setelan HP → Aplikasi → SRU Field → Izin →
            aktifkan Kamera, lalu kembali ke sini.
          </Text>
        )}
        <Button title="Batal" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      {label && (
        <View style={styles.labelBar}>
          <Text style={styles.labelText}>{label}</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.controls}>
        <Pressable
          onPress={() => router.back()}
          style={styles.cancel}
          accessibilityRole="button"
          accessibilityLabel="Batal"
        >
          <Text style={styles.cancelText}>Batal</Text>
        </Pressable>

        <Pressable
          onPress={capture}
          disabled={busy}
          style={[styles.shutter, busy && styles.shutterBusy]}
          accessibilityRole="button"
          accessibilityLabel="Ambil foto"
        >
          {busy ? <ActivityIndicator color={colors.text} /> : <View style={styles.shutterInner} />}
        </Pressable>

        {/* Balances the row so the shutter sits in the centre of the screen
            rather than the centre of the space left over by "Batal". */}
        <View style={styles.cancel} />
      </View>
    </View>
  );
}

const SHUTTER = 88;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  labelBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: space.md, paddingHorizontal: space.lg,
  },
  labelText: { ...type.heading, color: '#fff', textAlign: 'center' },
  errorBar: {
    position: 'absolute', bottom: 200, left: space.lg, right: space.lg,
    backgroundColor: colors.danger, borderRadius: 6, padding: space.md,
  },
  errorText: { ...type.body, color: '#fff' },
  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#000', paddingVertical: space.lg, paddingHorizontal: space.lg,
  },
  cancel: {
    minWidth: 96, minHeight: BIG_TOUCH_TARGET,
    alignItems: 'flex-start', justifyContent: 'center',
  },
  cancelText: { ...type.bodyStrong, color: '#fff' },
  shutter: {
    width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2,
    backgroundColor: '#fff', borderWidth: 4, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterBusy: { opacity: 0.6 },
  shutterInner: {
    width: SHUTTER - 22, height: SHUTTER - 22, borderRadius: (SHUTTER - 22) / 2,
    backgroundColor: '#fff', borderWidth: 2, borderColor: colors.border,
  },
  denied: { ...type.body, color: colors.danger, marginBottom: space.md },
});
