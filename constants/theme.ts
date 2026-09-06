/**
 * Design tokens (doc 03 §1).
 *
 * Sized for the actual conditions: a phone held in a plant, often with gloves
 * on, sometimes in direct sun. Nothing tappable is under 44pt and nothing
 * readable is under 16pt — those are floors, not suggestions.
 *
 * Light only. The app is used outdoors far more than in a dark control room,
 * and a dark theme would halve the contrast exactly where it matters.
 *
 * Because size is spent (the 16pt floor) and inversion is unavailable (light
 * only), hierarchy is built from five other levers: ink contrast, weight, case
 * and tracking, leading, and structure. One rule holds it together — no two
 * adjacent levels differ by only one lever. Body and secondary body differ in
 * colour *and* weight; a section title differs from body in case *and* tracking
 * *and* colour. Anything resting on a single lever disappears behind glare.
 */
import type { TextStyle } from 'react-native';

export const colors = {
  bg: '#f4f5f7',
  surface: '#ffffff',
  surfaceAlt: '#f7f8fa',
  border: '#d8dce2',
  borderStrong: '#b9c0c9',
  /** Separators between rows inside a group. Lighter than `border`, which outlines. */
  hairline: '#e4e7ec',

  /**
   * The ink ramp. Ratios below are against `surface`; every one also clears
   * 4.5:1 against `bg` and `surfaceAlt`, which constants/__tests__ enforces.
   *
   * Primary text targets AAA rather than AA deliberately. Midday illuminance in
   * Cilacap runs 80–100 klx against a ~450-nit panel, and a 4.5:1 pair measures
   * closer to 1.8:1 through that glare layer. 7:1 is the cheapest insurance
   * available in a light-only theme.
   */
  text: '#14181d',          // 17.8:1  primary
  textSecondary: '#3d4650', //  9.6:1  emphasis inside a secondary block
  muted: '#5b646f',         //  6.0:1  secondary
  faint: '#656d78',         //  5.2:1  tertiary — was #8a939e at 3.1:1, below AA

  accent: '#1b5e9c',
  accentDark: '#164e83',
  accentSoft: '#e8f1f9',

  ok: '#17703a',
  okSoft: '#e4f3ea',
  warn: '#96570a',
  warnSoft: '#fdf0dc',
  danger: '#a52020',
  dangerSoft: '#fbe9e9',
  neutral: '#59616b',
  neutralSoft: '#eceef1',

  onAccent: '#ffffff',
  /** Text on any dark fill, so no screen has to reach for a bare '#fff'. */
  inkInverse: '#ffffff',

  toastBg: '#14181d',
  okBorder: '#c3e3d0',
  dangerBorder: '#f0c6c6',

  /** Camera chrome — the one screen that is deliberately dark. */
  cameraBg: '#000000',
  cameraScrim: 'rgba(0,0,0,0.55)',
  cameraRing: 'rgba(255,255,255,0.45)',
  cameraShutter: '#ffffff',
} as const;

/** 4pt grid. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Nothing drops below 16 (doc 03 §1). Secondary text is distinguished by
 * colour, weight and tracking rather than by shrinking it — an operator
 * reading a hint in daylight through a scratched screen protector needs it at
 * full size, and "supporting" text is still text somebody has to read.
 *
 * Declared with `satisfies`, not `as const`. React Native types `fontVariant`
 * as a mutable FontVariant[] (StyleSheetTypes.d.ts), so `as const` would make
 * it a readonly tuple and fail typecheck at every consumer; `satisfies` still
 * narrows the fontWeight literals.
 *
 * Weight caveat: RN resolves a numeric fontWeight to a real typeface only on
 * API >= 28 — below that, anything under 700 collapses to regular. So '500'
 * never carries a distinction on its own here. Every 400/500 pair also differs
 * in colour or leading, and the step guaranteed everywhere is 400 vs 700.
 */
const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

export const type = {
  /** The one number read at arm's length — the computed tank level. */
  display: {
    fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -0.8,
    fontVariant: tabular, includeFontPadding: false,
  },
  /**
   * Secondary figures: dashboard stats, summary counts, the numeric input.
   * The single home for what were three conflicting local overrides of
   * `display` (30, 32 and 34, in three different screens).
   */
  metric: {
    fontSize: 32, lineHeight: 36, fontWeight: '700', letterSpacing: -0.4,
    fontVariant: tabular, includeFontPadding: false,
  },

  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  subhead: { fontSize: 18, lineHeight: 24, fontWeight: '500' },

  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  bodyBold: { fontSize: 16, lineHeight: 24, fontWeight: '700' },

  /** Form labels and button faces. Body size; tighter leading reads as chrome. */
  label: { fontSize: 16, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: 0.2 },

  /**
   * The hierarchy unlock. Uppercase and tracked reads as chrome rather than
   * content without dropping below the floor — this is what replaces the 13pt
   * caption any other design system would reach for here. Carries section
   * titles, status words, step counts and the unsent marker.
   *
   * The uppercasing is applied by the component through textTransform, so the
   * Indonesian source strings are never edited and the change is reversible.
   */
  eyebrow: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: 0.8 },

  /** Figures inside prose: mm values, percentages, times, counts. */
  numeric: { fontSize: 16, lineHeight: 24, fontWeight: '500', fontVariant: tabular },
  numericLarge: {
    fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2,
    fontVariant: tabular, includeFontPadding: false,
  },
} satisfies Record<string, TextStyle>;

/** Minimum tappable size. Applied as minHeight/minWidth, never bypassed. */
export const TOUCH_TARGET = 44;

/** The primary action on the measurement screens — reachable with a thumb. */
export const BIG_TOUCH_TARGET = 56;

/** A scannable list row: well over the touch floor, and denser than a Card. */
export const ROW_HEIGHT = 72;

/** The status colour bar on a row's leading edge. */
export const RAIL_WIDTH = 8;

export const shadow = {
  card: {
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  /** Things that float above the page — the toast. Lists use a border instead. */
  raised: {
    shadowColor: '#101828',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

/** Equipment and task vocabulary → the colour it reads as (doc 03 §3.5). */
export const statusColor = {
  NORMAL: { fg: colors.ok, bg: colors.okSoft },
  STANDBY: { fg: colors.neutral, bg: colors.neutralSoft },
  ON_REPAIR: { fg: colors.warn, bg: colors.warnSoft },
  NEED_REPAIR: { fg: colors.danger, bg: colors.dangerSoft },
  OPEN: { fg: colors.accent, bg: colors.accentSoft },
  IN_PROGRESS: { fg: colors.warn, bg: colors.warnSoft },
  DONE: { fg: colors.ok, bg: colors.okSoft },
  CANCELLED: { fg: colors.neutral, bg: colors.neutralSoft },
  PENDING_SYNC: { fg: colors.warn, bg: colors.warnSoft },
  SYNC_ERROR: { fg: colors.danger, bg: colors.dangerSoft },
  SYNCED: { fg: colors.ok, bg: colors.okSoft },
} as const;

/** Storage code → what the operator reads (doc 02 §1.2). */
export const STATUS_LABEL: Record<string, string> = {
  NORMAL: 'Normal',
  STANDBY: 'Stand By',
  ON_REPAIR: 'On Repair',
  NEED_REPAIR: 'Need Repair',
  OPEN: 'Open',
  IN_PROGRESS: 'Dikerjakan',
  DONE: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const SHIFT_TIME_LABEL: Record<string, string> = {
  pagi: 'Pagi',
  sore: 'Sore',
  malam: 'Malam',
};
