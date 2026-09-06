import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { ICON, Icon } from '@/components/icon';
import { TOUCH_TARGET, colors, space } from '@/constants/theme';

/**
 * Replaces the navigator's default back chevron, which renders at 30pt — below
 * the 44pt floor in doc 03 §1. That floor is not cosmetic: this is pressed with
 * gloved thumbs, and a miss means backing out of a half-entered measurement.
 */
export function HeaderBack() {
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Kembali"
      hitSlop={8}
      style={({ pressed }) => ({
        minWidth: TOUCH_TARGET,
        minHeight: TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: space.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={ICON.back} size="lg" color={colors.accent} />
    </Pressable>
  );
}
