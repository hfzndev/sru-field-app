/**
 * Design tokens (doc 03 §1).
 *
 * Sized for the actual conditions: a phone held in a plant, often with gloves
 * on, sometimes in direct sun. Nothing tappable is under 44pt and nothing
 * readable is under 16pt — those are floors, not suggestions.
 *
 * Light only. The app is used outdoors far more than in a dark control room,
 * and a dark theme would halve the contrast exactly where it matters.
 */

export const colors = {
  bg: '#f4f5f7',
  surface: '#ffffff',
  surfaceAlt: '#fafbfc',
  border: '#d8dce2',
  borderStrong: '#b9c0c9',

  text: '#14181d',
  muted: '#5b646f',
  faint: '#8a939e',

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
 * `body` is the floor at 16. `display` exists for the one number an operator
 * squints at from arm's length — the computed tank level.
 */
/**
 * Nothing drops below 16 (doc 03 §1). Secondary text is distinguished by colour
 * and weight rather than by shrinking it — an operator reading a hint in
 * daylight through a scratched screen protector needs it at full size, and
 * "supporting" text is still text somebody has to read.
 */
export const type = {
  display: { fontSize: 40, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  label: { fontSize: 16, fontWeight: '600' as const },
  caption: { fontSize: 16, fontWeight: '400' as const },
} as const;

/** Minimum tappable size. Applied as minHeight/minWidth, never bypassed. */
export const TOUCH_TARGET = 44;

/** The primary action on the measurement screens — reachable with a thumb. */
export const BIG_TOUCH_TARGET = 56;

export const shadow = {
  card: {
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
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
