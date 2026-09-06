import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ICON, Icon } from '@/components/icon';
import { colors, radius, space, type } from '@/constants/theme';
import { photoExists } from '@/lib/photos';
import { fetchRemotePhoto } from '@/lib/remotePhotos';

/**
 * One cleaning photograph.
 *
 * Three cases, and the difference between them matters to an operator deciding
 * whether a session is really documented:
 *
 *   the file is on this phone      → shown, online or not
 *   only the server has it         → fetched when online (doc 07 §5)
 *   neither, or no signal          → a labelled placeholder, never a blank box
 *
 * The third case is normal, not an error: four handsets rotate, and a session
 * another phone documented has its photographs on the server only. Saying so
 * plainly beats an empty square the operator has to interpret.
 */
export function PhotoThumb({ localUri, serverPath, label, size = 132 }: {
  localUri?: string;
  serverPath?: string;
  label: string;
  size?: number;
}) {
  const [remoteUri, setRemoteUri] = useState<string | null>(null);

  const hasLocal = !!localUri && photoExists(localUri);
  const wantsRemote = !hasLocal && !!serverPath;

  useEffect(() => {
    if (!wantsRemote || !serverPath) return;
    let ignore = false;
    fetchRemotePhoto(serverPath)
      .then((uri) => { if (!ignore) setRemoteUri(uri); })
      // Offline, or the photo is gone. Either way the placeholder already says
      // the right thing, so there is nothing to report on top of it.
      .catch(() => {});
    return () => { ignore = true; };
  }, [wantsRemote, serverPath]);

  const uri = hasLocal ? (localUri as string) : remoteUri;

  return (
    <View style={{ width: size }}>
      <Text style={styles.label}>{label}</Text>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.image, { width: size, height: size }]}
          accessibilityLabel={label}
        />
      ) : (
        <View style={[styles.placeholder, { width: size, height: size }]}>
          <Icon name={ICON.photo} size="lg" color={colors.faint} />
          <Text style={styles.placeholderText}>
            {serverPath ? 'Perlu sinyal' : 'Belum ada'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.label, color: colors.muted, marginBottom: space.xs },
  image: { borderRadius: radius.sm, backgroundColor: colors.border },
  placeholder: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    gap: space.xs,
  },
  placeholderText: { ...type.body, color: colors.muted },
});
