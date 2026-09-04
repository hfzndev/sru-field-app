import { isoDaysAgo, isoStartOfWibToday } from '../format';

/**
 * Time-window cutoffs (doc 07 §5, doc 03 §1).
 *
 * Every timestamp column on this phone holds ISO, and these two cutoffs used to
 * be compared against SQLite's own `datetime('now', ...)`. SQLite compares them
 * as text, and at index 10 ISO carries 'T' (0x54) where the SQLite form carries
 * ' ' (0x20) — so for the same instant the ISO value always sorts higher and
 * the comparison turns on the separator instead of the time.
 *
 * These tests pin the property that made that a bug, so a future change back to
 * a SQLite-format cutoff fails here rather than in the field.
 */

const SQLITE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('the separator that caused it', () => {
  it('sorts an ISO string above the SQLite form of the same instant', () => {
    // The whole bug in one line. Both are 2026-09-03 10:00:00 UTC.
    expect('2026-09-03T10:00:00.000Z' > '2026-09-03 10:00:00').toBe(true);
  });

  it('produces cutoffs in ISO, never the SQLite form', () => {
    expect(isoDaysAgo(7)).toMatch(ISO);
    expect(isoDaysAgo(7)).not.toMatch(SQLITE);
    expect(isoStartOfWibToday()).toMatch(ISO);
  });
});

describe('isoDaysAgo — the retention cutoff', () => {
  const now = new Date('2026-09-10T04:00:00.000Z');

  it('is exactly n days back, to the second', () => {
    expect(isoDaysAgo(7, now)).toBe('2026-09-03T04:00:00.000Z');
  });

  it('keeps a record one second inside the window and drops one outside', () => {
    // The boundary is the case the old comparison got wrong: it kept everything
    // dated on the cutoff day, whatever the hour, stretching 7 days to nearly 8.
    const cutoff = isoDaysAgo(7, now);
    const justInside = '2026-09-03T04:00:01.000Z';
    const justOutside = '2026-09-03T03:59:59.000Z';

    expect(justInside < cutoff).toBe(false);   // survives
    expect(justOutside < cutoff).toBe(true);   // purged
  });

  it('drops a record from earlier the same day as the cutoff', () => {
    // Precisely what used to survive: same calendar date, hours older.
    expect('2026-09-03T00:00:00.000Z' < isoDaysAgo(7, now)).toBe(true);
  });
});

describe('isoStartOfWibToday — the "Hari ini" cutoff', () => {
  it('is midnight WIB, which is 17:00 UTC the day before', () => {
    // WIB is UTC+7 all year; Indonesia has no daylight saving.
    const midMorningWib = new Date('2026-09-04T03:00:00.000Z'); // 10:00 WIB
    expect(isoStartOfWibToday(midMorningWib)).toBe('2026-09-03T17:00:00.000Z');
  });

  it('puts the malam shift on the right date', () => {
    // 02:00 WIB on the 4th is 19:00 UTC on the 3rd. A UTC day would file this
    // under the 3rd; the operator working it calls it the 4th.
    const duringNightShift = new Date('2026-09-03T19:00:00.000Z');
    expect(isoStartOfWibToday(duringNightShift)).toBe('2026-09-03T17:00:00.000Z');
  });

  it('excludes yesterday rather than counting a rolling 24 hours', () => {
    const now = new Date('2026-09-04T03:00:00.000Z');       // 10:00 WIB today
    const cutoff = isoStartOfWibToday(now);

    const yesterdayEvening = '2026-09-03T14:00:00.000Z';     // 21:00 WIB yesterday
    const thisMorning = '2026-09-03T23:00:00.000Z';          // 06:00 WIB today

    expect(yesterdayEvening >= cutoff).toBe(false);
    expect(thisMorning >= cutoff).toBe(true);
  });
});
