import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleProp, TextStyle } from 'react-native';
import { colors } from '@/constants/theme';

/**
 * The icon layer.
 *
 * Deep import, deliberately: `@expo/vector-icons` re-exports every family from
 * its index, and Metro bundles the TTF of every family it sees — about 3.5 MB.
 * The deep path pulls one 348 KB font. This is the ONLY file allowed to import
 * the package; eslint enforces that, because the cost of a stray barrel import
 * is invisible until somebody downloads the APK over plant signal.
 *
 * Filled Material rather than an outlined or hairline set: a 2px stroke at 24pt
 * disappears in 90 klx of daylight, and solid mass does not.
 *
 * Screens name a MEANING from ICON, never a glyph string. Swapping the family
 * later is then one file rather than forty call sites.
 */

export type IconName = keyof typeof MaterialIcons.glyphMap;

const SIZE = {
  sm: 20,
  md: 24,
  lg: 32,
  /** A standalone icon that is itself the tap target. */
  xl: 44,
} as const;

export type IconProps = {
  name: IconName;
  size?: keyof typeof SIZE | number;
  color?: string;
  style?: StyleProp<TextStyle>;
  /**
   * Omit for decorative icons that sit beside a text label — announcing both
   * makes TalkBack read every row twice. Required when the icon is alone.
   */
  accessibilityLabel?: string;
};

export function Icon({ name, size = 'md', color = colors.text, style, accessibilityLabel }: IconProps) {
  return (
    <MaterialIcons
      name={name}
      size={typeof size === 'number' ? size : SIZE[size]}
      color={color}
      style={style}
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    />
  );
}

/**
 * Preloaded during the splash in app/_layout.tsx, which is already held open
 * for the database migration. Without it the first frame renders tofu boxes in
 * the tab bar — the one piece of chrome that must never look broken.
 */
export function loadIconFont(): Promise<void> {
  return MaterialIcons.loadFont();
}

/**
 * The vocabulary. `satisfies` means typecheck proves every glyph exists in the
 * installed font, so a missing one fails the build at one line instead of
 * rendering an empty box on a handset in the field.
 */
export const ICON = {
  // navigation
  home: 'home',
  tank: 'oil-barrel',
  activity: 'edit-note',
  cleaning: 'cleaning-services',
  service: 'build',
  settings: 'settings',
  back: 'chevron-left',
  forward: 'chevron-right',

  // sync
  sync: 'sync',
  unsent: 'arrow-upward',
  rejected: 'error-outline',
  synced: 'cloud-done',
  offline: 'cloud-off',
  retry: 'refresh',

  // capture
  camera: 'photo-camera',
  photo: 'image',

  // feedback
  check: 'check',
  clear: 'close',
  warn: 'warning-amber',
  info: 'info-outline',
  remove: 'delete-outline',
  add: 'add',

  // empty states
  emptyList: 'inbox',
  emptyDoc: 'description',
  emptyTank: 'oil-barrel',
  emptyClean: 'cleaning-services',
  emptyTask: 'description',
  emptyRoute: 'explore',
  emptyDone: 'done-all',

  // measurement + meta
  measure: 'straighten',
  level: 'water-drop',
  clock: 'schedule',
  history: 'history',
  person: 'person-outline',
  lock: 'lock-outline',
  contractor: 'local-shipping',
  operator: 'engineering',

  // status glyphs
  statusNeedRepair: 'error',
  statusOnRepair: 'build-circle',
  statusStandby: 'pause-circle',
  statusNormal: 'check-circle',
  statusOpen: 'radio-button-unchecked',
  statusCancelled: 'cancel',
} as const satisfies Record<string, IconName>;

/**
 * Status → glyph, so status is never carried by colour alone. An operator with
 * a colour-vision deficiency, or one holding the phone in glare where hue
 * washes out first, still reads the shape.
 */
export const STATUS_ICON: Record<string, IconName> = {
  NEED_REPAIR: ICON.statusNeedRepair,
  ON_REPAIR: ICON.statusOnRepair,
  STANDBY: ICON.statusStandby,
  NORMAL: ICON.statusNormal,
  OPEN: ICON.statusOpen,
  IN_PROGRESS: ICON.statusOnRepair,
  DONE: ICON.statusNormal,
  CANCELLED: ICON.statusCancelled,
  PENDING_SYNC: ICON.unsent,
  SYNC_ERROR: ICON.rejected,
  SYNCED: ICON.synced,
};
