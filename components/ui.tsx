import { ReactNode, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ICON, Icon, IconName, STATUS_ICON } from '@/components/icon';
import { DURATION, useDuration, useReducedMotion } from '@/components/motion';
import {
  BIG_TOUCH_TARGET,
  RAIL_WIDTH,
  ROW_HEIGHT,
  STATUS_LABEL,
  TOUCH_TARGET,
  colors,
  radius,
  shadow,
  space,
  statusColor,
  type,
} from '@/constants/theme';
import { useOnline } from '@/lib/status';

/**
 * Shared primitives. Every tappable thing here is at least TOUCH_TARGET tall by
 * construction, so no screen has to remember to enforce it (doc 03 §1).
 *
 * Two shapes carry lists, and the difference is deliberate:
 *
 *   Card                  — one thing you read.
 *   ListGroup + ListRow   — many things you scan.
 *
 * Every list used to be Cards, which meant eight equipment items were eight
 * floating rectangles with 24pt of chrome between them: four visible at a time
 * on a 360dp handset, when the question being asked is "what is broken across
 * the whole plant". Rows are denser and carry a status rail, so the answer is
 * legible before any text resolves.
 */

export function Screen({ children, scroll = true, style, banner = true }: {
  children: ReactNode; scroll?: boolean; style?: ViewStyle; banner?: boolean;
}) {
  // The offline banner lives here rather than in each screen. Doc 03 §1 wants
  // it visible whenever there is no connection, and a screen that forgot to
  // render it would quietly tell an operator everything is fine.
  const online = useOnline();
  const inner = <View style={[styles.screenInner, style]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      {banner && <OfflineBanner visible={!online} />}
      {scroll
        ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollPad}>{inner}</ScrollView>
        : inner}
    </SafeAreaView>
  );
}

export function Heading({ children, sub, icon }: {
  children: ReactNode; sub?: string; icon?: IconName;
}) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={styles.headingRow}>
        {icon ? <Icon name={icon} size="lg" color={colors.accent} /> : null}
        <Text style={styles.title}>{children}</Text>
      </View>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

/**
 * A section label. Uppercase and tracked rather than small — the 16pt floor
 * means "quieter" has to be carried by case, tracking and colour instead of
 * by size (doc 03 §1).
 */
export function SectionTitle({ children, count, action, icon }: {
  children: string;
  count?: number;
  action?: { label: string; onPress: () => void };
  icon?: IconName;
}) {
  return (
    <View style={styles.sectionTitle}>
      {icon ? <Icon name={icon} size="sm" color={colors.muted} /> : null}
      <Text style={styles.sectionTitleText}>{children}</Text>
      {typeof count === 'number' ? <Text style={styles.sectionCount}>{count}</Text> : null}
      <View style={styles.sectionRule} />
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          style={({ pressed }) => [styles.sectionAction, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.sectionActionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, onPress, style }: {
  children: ReactNode; onPress?: () => void; style?: ViewStyle;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Outlines a run of ListRows and draws the hairlines between them. */
export function ListGroup({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.listGroup, style]}>{children}</View>;
}

export function ListRow({
  title, titleNumeric, subtitle, meta, status, statusLabel, right, footer,
  icon, iconColor, onPress, chevron, testID,
}: {
  title: string;
  /** Tabular figures — tank codes, tags, levels, so columns line up. */
  titleNumeric?: boolean;
  subtitle?: string;
  meta?: string;
  status?: string;
  statusLabel?: string;
  right?: ReactNode;
  footer?: ReactNode;
  /** Leading glyph for rows whose kind matters as much as their status. */
  icon?: IconName;
  iconColor?: string;
  onPress?: () => void;
  chevron?: boolean;
  testID?: string;
}) {
  const showChevron = chevron ?? !!onPress;
  const body = (
    <>
      {/* The rail is why worst-first sorting is worth doing: a red block at the
          top of the list resolves at arm's length, before any word does. */}
      {status ? <StatusRail value={status} /> : null}
      <View style={styles.rowBody}>
        {icon ? <Icon name={icon} size="md" color={iconColor ?? colors.muted} /> : null}
        <View style={styles.rowMain}>
          <View style={styles.rowTitleLine}>
            <Text style={titleNumeric ? styles.rowTitleNumeric : styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            {status ? <StatusBadge value={status} label={statusLabel} size="compact" /> : null}
          </View>
          {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
          {meta ? <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text> : null}
          {footer}
        </View>
        {right ? <View style={styles.rowRight}>{right}</View> : null}
        {showChevron ? <Icon name={ICON.forward} size="sm" color={colors.faint} /> : null}
      </View>
    </>
  );

  if (!onPress) return <View style={styles.row} testID={testID}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'normal' | 'big';
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
};

export function Button({
  title, onPress, variant = 'secondary', size = 'normal', icon, iconRight,
  disabled, busy, testID,
}: ButtonProps) {
  const isDisabled = disabled || busy;
  const onColor = variant === 'primary' || variant === 'danger';
  const tint = onColor ? colors.onAccent : variant === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!busy }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        size === 'big' && styles.buttonBig,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        // Scale rather than a colour shift, computed synchronously here rather
        // than through an animation: this is the most-tapped element in the app
        // and it should never wait on a worklet to acknowledge a thumb.
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tint} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Icon name={icon} size="sm" color={tint} /> : null}
          <Text style={[styles.buttonText, { color: tint }]} numberOfLines={1}>{title}</Text>
          {iconRight ? <Icon name={iconRight} size="sm" color={tint} /> : null}
        </View>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, children }: {
  label?: string; hint?: string; children: ReactNode;
}) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input({ invalid, ...props }: TextInputProps & { invalid?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      {...props}
      style={[
        styles.input,
        props.multiline && styles.inputMultiline,
        invalid && styles.inputInvalid,
        props.style,
      ]}
    />
  );
}

/**
 * For DCS levels, tape lengths and bandul heights. Large and numeric-only —
 * these are read off a gauge and typed with one thumb, often in gloves.
 * Tabular figures so the digits do not shuffle sideways as the value changes.
 */
export function NumericInput(props: TextInputProps & { unit?: string; invalid?: boolean }) {
  const { unit, invalid, ...rest } = props;
  return (
    <View style={styles.numericWrap}>
      <TextInput
        keyboardType="numeric"
        inputMode="decimal"
        placeholderTextColor={colors.faint}
        {...rest}
        style={[styles.numericInput, invalid && styles.inputInvalid, rest.style]}
      />
      {unit ? <Text style={styles.numericUnit}>{unit}</Text> : null}
    </View>
  );
}

export function StatusBadge({ value, label, size = 'normal', icon = true }: {
  value: string; label?: string; size?: 'normal' | 'compact'; icon?: boolean;
}) {
  const tone = statusColor[value as keyof typeof statusColor]
    ?? { fg: colors.neutral, bg: colors.neutralSoft };
  const glyph = STATUS_ICON[value];
  return (
    <View style={[styles.chip, size === 'compact' && styles.chipCompact, { backgroundColor: tone.bg }]}>
      {icon && glyph ? <Icon name={glyph} size={16} color={tone.fg} /> : null}
      <Text style={[styles.chipText, { color: tone.fg }]} numberOfLines={1}>
        {label ?? STATUS_LABEL[value] ?? value}
      </Text>
    </View>
  );
}

/** The colour bar on a row's leading edge. Always paired with the badge. */
export function StatusRail({ value }: { value: string }) {
  const tone = statusColor[value as keyof typeof statusColor]
    ?? { fg: colors.neutral, bg: colors.neutralSoft };
  return <View style={[styles.rail, { backgroundColor: tone.fg }]} />;
}

/**
 * One presentation for "this is still on the handset".
 *
 * The same fact previously appeared five ways across the app — a chip, an
 * orange sentence, an arrow and a count, in different weights. The wording is
 * still the screen's to choose (`label` is passed through verbatim, so
 * "Menunggu", "Ditolak" and "Belum terkirim" all survive); only the form is
 * unified. Returns null for a synced record: only exceptions are marked.
 */
export function UnsentMark({ status, label, detail, variant = 'inline', count }: {
  status: string;
  label?: string;
  detail?: string;
  variant?: 'inline' | 'badge' | 'count';
  count?: number;
}) {
  if (status === 'SYNCED') return null;
  const rejected = status === 'SYNC_ERROR';
  const tone = rejected ? colors.danger : colors.warn;
  const glyph = rejected ? ICON.rejected : ICON.unsent;
  const text = label ?? (rejected ? 'Ditolak server' : 'Belum terkirim');

  if (variant === 'count') {
    if (!count) return null;
    return (
      <View style={[styles.countPill, { backgroundColor: rejected ? colors.dangerSoft : colors.warnSoft }]}>
        <Icon name={glyph} size={16} color={tone} />
        <Text style={[styles.countText, { color: tone }]}>{count}</Text>
      </View>
    );
  }

  if (variant === 'badge') return <StatusBadge value={status} label={text} size="compact" />;

  return (
    <View style={styles.unsentInline}>
      <Icon name={glyph} size={16} color={tone} />
      <Text style={[styles.unsentText, { color: tone }]} numberOfLines={1}>
        {text}{detail ? ` · ${detail}` : ''}
      </Text>
    </View>
  );
}

export function Empty({ icon = ICON.emptyList, title, hint, action }: {
  icon?: IconName; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size="lg" color={colors.faint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: space.md, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/**
 * For a history section inside a detail screen, where a full dashed Empty box
 * would outweigh the thing it is reporting on.
 */
export function EmptyInline({ children }: { children: string }) {
  return (
    <View style={styles.emptyInline}>
      <Icon name={ICON.emptyDoc} size="sm" color={colors.faint} />
      <Text style={styles.emptyInlineText}>{children}</Text>
    </View>
  );
}

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.sub}>{label}</Text>
    </View>
  );
}

export function Alert({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (!error && !ok) return null;
  const tone = error ? colors.danger : colors.ok;
  return (
    <View style={[styles.alert, error ? styles.alertError : styles.alertOk]}>
      <Icon name={error ? ICON.warn : ICON.check} size="sm" color={tone} />
      <Text style={[styles.alertText, { color: tone }]}>{error || ok}</Text>
    </View>
  );
}

/**
 * Brief confirmation after a save (doc 03 §3.2, step 3).
 *
 * It states both halves — saved, and not yet sent — because those are different
 * facts and an operator needs to trust the first without being misled about the
 * second.
 */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  const duration = useDuration(DURATION.base);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!message) return undefined;
    progress.value = withTiming(1, { duration });
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [message, onDone, duration, progress]);

  // Fade and a short lift. It previously appeared and vanished by mounting,
  // which at the end of a save read as a glitch rather than a confirmation.
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  if (!message) return null;
  return (
    <Animated.View style={[styles.toast, animated]} pointerEvents="none">
      <Icon name={ICON.check} size="sm" color={colors.inkInverse} />
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

/**
 * Wraps a block that appears in place — the delete confirmation on Sync, the
 * sign-out confirmation in Pengaturan. Both replace a button with a question
 * under the operator's thumb, and appearing instantly makes it easy to answer
 * one the operator never meant to open.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  if (reduced) return <View>{children}</View>;
  return (
    <Animated.View entering={FadeInDown.duration(DURATION.base)}>
      {children}
    </Animated.View>
  );
}

/** "Langkah 2 dari 3" — one step per screen, so progress must be visible. */
export function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.stepCount}>Langkah {step} dari {total}</Text>
      <View style={styles.pips}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.pip, i < step && styles.pipOn]} />
        ))}
      </View>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

/**
 * How far through a list of work the operator is.
 *
 * The sentence carries the meaning and the bar only supports it — "7 dari 12
 * baris selesai" is what an operator is actually counting, and a bare
 * percentage on a lembar tugas would have to be translated back into rows every
 * time. The bar is 10pt, well under the 16pt text floor, because it is not text
 * and is never the only thing saying this.
 *
 * `done` reaching `total` is the completion moment: the bar goes to the OK
 * colour rather than the accent, which is the whole reward. There is no badge
 * and no score — see the note at the top of constants/theme.ts on why this app
 * does not decorate.
 */
export function ProgressBar({ done, total, label }: {
  done: number;
  total: number;
  label: string;
}) {
  const complete = total > 0 && done >= total;
  const fraction = total > 0 ? Math.min(1, done / total) : 0;

  return (
    <View style={{ marginTop: space.sm }}>
      <Text
        style={[styles.progressLabel, complete && styles.progressLabelDone]}
        accessibilityRole="text"
      >
        {label}
      </Text>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: done }}
      >
        <View
          style={[
            styles.progressFill,
            { width: `${fraction * 100}%` },
            complete && styles.progressFillDone,
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Shown whenever the device has no connection (doc 03 §1). Deliberately
 * reassuring: offline is the expected state in the plant, not a fault.
 */
export function OfflineBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.offline}>
      <Icon name={ICON.offline} size="sm" color={colors.warn} />
      <Text style={styles.offlineText}>Mode offline — catatan tetap tersimpan di HP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progressLabel: { ...type.body, color: colors.muted, marginBottom: space.xs },
  progressLabelDone: { ...type.bodyStrong, color: colors.ok },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  progressFillDone: { backgroundColor: colors.ok },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { padding: space.lg, flex: 1 },
  scrollPad: { paddingBottom: space.xxl },

  title: { ...type.title, color: colors.text },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sub: { ...type.body, color: colors.muted, marginTop: space.xs },
  label: { ...type.label, color: colors.text, marginBottom: space.sm },
  hint: { ...type.body, color: colors.muted, marginTop: space.xs },

  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  sectionTitleText: { ...type.eyebrow, color: colors.muted, textTransform: 'uppercase' },
  sectionCount: { ...type.numeric, color: colors.faint },
  sectionRule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  sectionAction: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingLeft: space.sm },
  sectionActionText: { ...type.label, color: colors.accent },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.card,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt },

  listGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    minHeight: ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rail: { width: RAIL_WIDTH, alignSelf: 'stretch' },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  rowTitle: { ...type.bodyBold, color: colors.text, flexShrink: 1 },
  rowTitleNumeric: { ...type.numericLarge, color: colors.text, flexShrink: 1 },
  rowSubtitle: { ...type.body, color: colors.muted },
  rowMeta: { ...type.body, color: colors.faint },
  rowRight: { alignItems: 'flex-end' },

  button: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonBig: { minHeight: BIG_TOUCH_TARGET },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...type.button },

  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    ...type.body,
    color: colors.text,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },
  inputInvalid: { borderColor: colors.danger },

  numericWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  numericInput: {
    flex: 1,
    minHeight: BIG_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    ...type.metric,
    color: colors.text,
  },
  numericUnit: { ...type.heading, color: colors.muted },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  chipCompact: { paddingHorizontal: space.sm },
  chipText: { ...type.eyebrow, textTransform: 'uppercase' },

  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  countText: { ...type.numeric, fontWeight: '700' },

  unsentInline: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  unsentText: { ...type.eyebrow, textTransform: 'uppercase', flexShrink: 1 },

  empty: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  emptyTitle: { ...type.bodyBold, color: colors.text, textAlign: 'center' },
  emptyHint: { ...type.body, color: colors.muted, textAlign: 'center' },

  emptyInline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  emptyInlineText: { ...type.body, color: colors.muted, flexShrink: 1 },

  loading: { padding: space.xl, alignItems: 'center', gap: space.sm },

  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.sm,
    marginBottom: space.md,
    borderWidth: 1,
  },
  alertText: { ...type.body, flexShrink: 1 },
  alertError: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
  alertOk: { backgroundColor: colors.okSoft, borderColor: colors.okBorder },

  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.warnSoft,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  offlineText: { ...type.bodyStrong, color: colors.warn, textAlign: 'center', flexShrink: 1 },

  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.toastBg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    ...shadow.raised,
  },
  toastText: { ...type.bodyStrong, color: colors.inkInverse, textAlign: 'center', flexShrink: 1 },

  stepCount: { ...type.eyebrow, color: colors.accent, textTransform: 'uppercase', marginBottom: space.sm },
  pips: { flexDirection: 'row', gap: space.xs, marginBottom: space.sm },
  pip: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  pipOn: { backgroundColor: colors.accent },
});
