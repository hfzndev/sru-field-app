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
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BIG_TOUCH_TARGET,
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

export function Heading({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
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

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'normal' | 'big';
  disabled?: boolean;
  busy?: boolean;
};

export function Button({
  title, onPress, variant = 'secondary', size = 'normal', disabled, busy,
}: ButtonProps) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        size === 'big' && styles.buttonBig,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'danger' && styles.buttonDanger,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.text : colors.onAccent} />
      ) : (
        <Text style={[
          styles.buttonText,
          (variant === 'primary' || variant === 'danger') && styles.buttonTextOnColor,
        ]}>
          {title}
        </Text>
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

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      {...props}
      style={[styles.input, props.multiline && styles.inputMultiline, props.style]}
    />
  );
}

/**
 * For DCS levels, tape lengths and bandul heights. Large and numeric-only —
 * these are read off a gauge and typed with one thumb, often in gloves.
 */
export function NumericInput(props: TextInputProps & { unit?: string }) {
  const { unit, ...rest } = props;
  return (
    <View style={styles.numericWrap}>
      <TextInput
        keyboardType="numeric"
        inputMode="decimal"
        placeholderTextColor={colors.faint}
        {...rest}
        style={[styles.numericInput, rest.style]}
      />
      {unit ? <Text style={styles.numericUnit}>{unit}</Text> : null}
    </View>
  );
}

export function Chip({ value, label }: { value: string; label?: string }) {
  const tone = statusColor[value as keyof typeof statusColor]
    ?? { fg: colors.neutral, bg: colors.neutralSoft };
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Text style={[styles.chipText, { color: tone.fg }]}>
        {label ?? STATUS_LABEL[value] ?? value}
      </Text>
    </View>
  );
}

export function Empty({ icon = '📋', title, hint }: {
  icon?: string; title: string; hint?: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 34, marginBottom: space.sm }}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
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
  return (
    <View style={[styles.alert, error ? styles.alertError : styles.alertOk]}>
      <Text style={{ color: error ? colors.danger : colors.ok, ...type.caption }}>
        {error || ok}
      </Text>
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
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

/** "Langkah 2 dari 3" — one step per screen, so progress must be visible. */
export function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={styles.stepCount}>Langkah {step} dari {total}</Text>
      <Text style={styles.title}>{title}</Text>
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
      <Text style={styles.offlineText}>Mode offline — catatan tetap tersimpan di HP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { padding: space.lg, flex: 1 },
  scrollPad: { paddingBottom: space.xxl },

  title: { ...type.title, color: colors.text },
  sub: { ...type.caption, color: colors.muted, marginTop: 2 },
  label: { ...type.label, color: colors.text, marginBottom: 6 },
  hint: { ...type.caption, color: colors.muted, marginTop: 4 },

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
  buttonBig: { minHeight: BIG_TOUCH_TARGET },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...type.bodyStrong, color: colors.text },
  buttonTextOnColor: { color: colors.onAccent },

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

  numericWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  numericInput: {
    flex: 1,
    minHeight: BIG_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
  },
  numericUnit: { ...type.heading, color: colors.muted },

  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  chipText: { fontSize: 16, fontWeight: '700' },

  empty: {
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  emptyTitle: { ...type.bodyStrong, color: colors.text, textAlign: 'center' },
  emptyHint: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: 4 },

  loading: { padding: space.xl, alignItems: 'center', gap: space.sm },

  alert: { padding: space.md, borderRadius: radius.sm, marginBottom: space.md, borderWidth: 1 },
  alertError: { backgroundColor: colors.dangerSoft, borderColor: '#f0c6c6' },
  alertOk: { backgroundColor: colors.okSoft, borderColor: '#c3e3d0' },

  offline: { backgroundColor: colors.warnSoft, paddingVertical: space.sm, paddingHorizontal: space.lg },
  offlineText: { ...type.caption, color: colors.warn, textAlign: 'center', fontWeight: '600' },

  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xl,
    backgroundColor: '#14181d',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  toastText: { ...type.bodyStrong, color: '#fff', textAlign: 'center' },

  stepCount: { ...type.caption, color: colors.accent, fontWeight: '700', marginBottom: 2 },
});
