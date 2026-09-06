/**
 * Equipment ordering (doc 03 §3.5).
 *
 * An operator opening the Servis list mid-shift is asking "what is broken",
 * not "where is P-9101 in the alphabet". Anything not NORMAL sorts to the top,
 * worst first, and carries the reason it is there.
 *
 * This lives in lib/ rather than constants/ so it is testable without the
 * React Native runtime — the ordering is a rule the plant depends on, not a
 * presentation detail.
 *
 * Extracted verbatim from app/(tabs)/maintenance/index.tsx. Sorting keys off
 * the server `status` only, deliberately matching the shipped v0.3.0 ordering.
 * See the note on `pendingStatus` below.
 */

/** Lower sorts higher up the list. Unknown statuses fall to the bottom. */
export const STATUS_SEVERITY: Record<string, number> = {
  NEED_REPAIR: 0,
  ON_REPAIR: 1,
  STANDBY: 2,
  NORMAL: 3,
};

/** Where an unrecognised status sorts. Past NORMAL, so it can never hide a fault. */
const UNKNOWN_SEVERITY = 9;

export function severityOf(status: string): number {
  return STATUS_SEVERITY[status] ?? UNKNOWN_SEVERITY;
}

/**
 * Worst status first, then tag number so the order is stable between renders.
 *
 * NOTE: an unsent local change (`pendingStatus`) is shown on the card but does
 * not affect this ordering — a fault reported offline still sorts by the status
 * the server last knew. That is the shipped behaviour and is preserved here
 * rather than changed as a side effect of a UI redesign.
 */
export function compareBySeverity<T extends { status: string; tagNumber: string }>(
  a: T,
  b: T,
): number {
  const delta = severityOf(a.status) - severityOf(b.status);
  if (delta !== 0) return delta;
  return a.tagNumber.localeCompare(b.tagNumber);
}

/** Non-mutating sort, so callers never reorder state in place. */
export function sortBySeverity<T extends { status: string; tagNumber: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(compareBySeverity);
}
