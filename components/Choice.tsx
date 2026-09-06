import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ICON, Icon, IconName, STATUS_ICON } from '@/components/icon';
import {
  BIG_TOUCH_TARGET,
  TOUCH_TARGET,
  colors,
  radius,
  space,
  type,
} from '@/constants/theme';

/**
 * The one way this app asks "pick one".
 *
 * It replaces five hand-rolled implementations that had drifted apart — button
 * grids on login, pills on Aktivitas, radio cards on Servis, step pills on a
 * task, segment bars in two more places. They looked different, they sized
 * their targets differently, and three of them announced themselves to TalkBack
 * as buttons rather than radios, so an operator using a screen reader could not
 * tell what was already selected.
 *
 * Five layouts, one behaviour. The layout is a presentation choice; the
 * contract — target size, selected state, accessibility, press feedback — is
 * identical everywhere.
 */

export type ChoiceTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral';

export type ChoiceOption<T> = {
  value: T;
  /** Indonesian, exactly as the screen wrote it. */
  label: string;
  /** Second line. `stack` layout only — ignored elsewhere. */
  hint?: string;
  /** Trailing clause on the label line, e.g. ' · 3' or ' · sekarang'. */
  badge?: string;
  /** Leading glyph. Defaults to the status icon when `value` is a status code. */
  icon?: IconName;
  /** Overrides the accent used when selected. */
  tone?: ChoiceTone;
  disabled?: boolean;
};

export type ChoiceLayout =
  /** Equal cells over `columns`. The login shift picker. */
  | 'grid'
  /** One row, equal widths. Shift slots, activity type, Alat/Task. */
  | 'segments'
  /** Flow-wrapped pills. Crew names, contractors, filters. */
  | 'wrap'
  /** Full-width rows carrying a hint. Equipment status, task status. */
  | 'stack'
  /** One row of equal pills reading as a scale. Progress 0–100%. */
  | 'steps';

export type ChoiceProps<T extends string | number> = {
  options: readonly ChoiceOption<T>[];
  value: T | null;
  /** Receives null when `clearable` and the selected option is tapped again. */
  onChange: (value: T | null) => void;
  layout?: ChoiceLayout;
  /** `grid` only. */
  columns?: number;
  clearable?: boolean;
  size?: 'normal' | 'big';
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

const TONE: Record<ChoiceTone, { fg: string; soft: string }> = {
  accent: { fg: colors.accent, soft: colors.accentSoft },
  ok: { fg: colors.ok, soft: colors.okSoft },
  warn: { fg: colors.warn, soft: colors.warnSoft },
  danger: { fg: colors.danger, soft: colors.dangerSoft },
  neutral: { fg: colors.neutral, soft: colors.neutralSoft },
};

export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  layout = 'wrap',
  columns = 2,
  clearable = false,
  size = 'normal',
  disabled = false,
  accessibilityLabel,
  testID,
}: ChoiceProps<T>) {
  const minHeight = size === 'big' ? BIG_TOUCH_TARGET : TOUCH_TARGET;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.group, layout === 'stack' ? styles.groupStack : styles.groupRow]}
    >
      {options.map((option) => {
        const selected = value === option.value;
        const isDisabled = disabled || option.disabled;
        const tone = TONE[option.tone ?? 'accent'];
        const glyph = option.icon
          ?? (typeof option.value === 'string' ? STATUS_ICON[option.value] : undefined);

        return (
          <Pressable
            key={String(option.value)}
            disabled={isDisabled}
            onPress={() => onChange(clearable && selected ? null : option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected, disabled: !!isDisabled }}
            accessibilityLabel={option.hint ? `${option.label}. ${option.hint}` : option.label}
            testID={testID ? `${testID}-${option.value}` : undefined}
            style={({ pressed }) => [
              styles.option,
              { minHeight },
              layoutStyle(layout, columns),
              selected && { borderColor: tone.fg, backgroundColor: tone.soft },
              pressed && !isDisabled && styles.pressed,
              isDisabled && styles.disabled,
            ]}
          >
            <View style={[styles.row, layout !== 'stack' && styles.rowCentred]}>
              {selected ? (
                <Icon name={ICON.check} size="sm" color={tone.fg} />
              ) : glyph ? (
                <Icon name={glyph} size="sm" color={colors.muted} />
              ) : null}

              <View style={styles.labelWrap}>
                <Text
                  style={[
                    layout === 'steps' ? styles.labelNumeric : styles.label,
                    selected && { color: tone.fg, fontWeight: '700' },
                    layout !== 'stack' && styles.labelCentred,
                  ]}
                  numberOfLines={layout === 'stack' ? 2 : 1}
                >
                  {option.label}
                  {option.badge ? <Text style={styles.badge}>{option.badge}</Text> : null}
                </Text>

                {/* Hints stay at body size. A hint an operator cannot read in
                    daylight is not a hint (doc 03 §1). */}
                {layout === 'stack' && option.hint ? (
                  <Text style={[styles.hint, selected && { color: tone.fg }]}>{option.hint}</Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function layoutStyle(layout: ChoiceLayout, columns: number) {
  switch (layout) {
    case 'grid':
      // Percentage basis rather than flex:1, so the last row of an odd count
      // keeps its cells the same width as every other row instead of stretching.
      return { flexBasis: `${100 / columns}%` as const, flexGrow: 0, flexShrink: 1 };
    case 'segments':
    case 'steps':
      return styles.equal;
    case 'stack':
      return styles.full;
    case 'wrap':
    default:
      return styles.hug;
  }
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  // gap keeps 44pt targets from abutting. With gloves, adjacent targets without
  // dead space between them reintroduce exactly the misfires the floor prevents.
  groupRow: { flexDirection: 'row', flexWrap: 'wrap' },
  groupStack: { flexDirection: 'column' },

  option: {
    // Always 2px. Growing the border on selection would reflow the row by a
    // pixel on every tap, which reads as the layout twitching under the thumb.
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    justifyContent: 'center',
  },
  equal: { flex: 1, flexBasis: 0, minWidth: 0 },
  full: { width: '100%' },
  hug: { flexGrow: 0, flexShrink: 1 },

  pressed: { backgroundColor: colors.surfaceAlt },
  disabled: { opacity: 0.5 },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowCentred: { justifyContent: 'center' },
  labelWrap: { flexShrink: 1 },

  label: { ...type.bodyStrong, color: colors.text },
  labelNumeric: { ...type.numeric, color: colors.text },
  labelCentred: { textAlign: 'center' },
  badge: { ...type.body, color: colors.muted },
  hint: { ...type.body, color: colors.muted, marginTop: 2 },
});
