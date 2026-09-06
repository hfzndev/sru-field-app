import {
  STATUS_SEVERITY,
  compareBySeverity,
  severityOf,
  sortBySeverity,
} from '../severity';

const eq = (tagNumber: string, status: string) => ({ tagNumber, status });

describe('severityOf', () => {
  it('orders the plant vocabulary worst-first', () => {
    expect(severityOf('NEED_REPAIR')).toBeLessThan(severityOf('ON_REPAIR'));
    expect(severityOf('ON_REPAIR')).toBeLessThan(severityOf('STANDBY'));
    expect(severityOf('STANDBY')).toBeLessThan(severityOf('NORMAL'));
  });

  it('sorts an unknown status below NORMAL rather than above it', () => {
    expect(severityOf('WHAT_IS_THIS')).toBeGreaterThan(severityOf('NORMAL'));
  });

  it('covers every status the equipment list can hold', () => {
    for (const s of ['NEED_REPAIR', 'ON_REPAIR', 'STANDBY', 'NORMAL']) {
      expect(STATUS_SEVERITY[s]).toBeDefined();
    }
  });
});

describe('sortBySeverity', () => {
  it('puts the worst equipment at the top', () => {
    const rows = [
      eq('93P-9101', 'NORMAL'),
      eq('93P-9102', 'STANDBY'),
      eq('93P-9103', 'NEED_REPAIR'),
      eq('93P-9104', 'ON_REPAIR'),
    ];
    expect(sortBySeverity(rows).map((r) => r.tagNumber)).toEqual([
      '93P-9103', '93P-9104', '93P-9102', '93P-9101',
    ]);
  });

  it('breaks ties by tag number so the order is stable between renders', () => {
    const rows = [eq('93P-9110', 'NORMAL'), eq('93P-9102', 'NORMAL')];
    expect(sortBySeverity(rows).map((r) => r.tagNumber)).toEqual(['93P-9102', '93P-9110']);
  });

  it('does not mutate the caller array', () => {
    const rows = [eq('93P-9101', 'NORMAL'), eq('93P-9103', 'NEED_REPAIR')];
    sortBySeverity(rows);
    expect(rows[0].tagNumber).toBe('93P-9101');
  });

  it('matches the shipped v0.3.0 comparator exactly', () => {
    // The inline map this replaced, reproduced here as the oracle.
    const SEVERITY: Record<string, number> = {
      NEED_REPAIR: 0, ON_REPAIR: 1, STANDBY: 2, NORMAL: 3,
    };
    const rows = [
      eq('93P-9104', 'ON_REPAIR'), eq('93P-9101', 'NORMAL'),
      eq('93P-9103', 'NEED_REPAIR'), eq('93P-9102', 'STANDBY'),
      eq('93P-9105', 'MYSTERY'),
    ];
    const shipped = [...rows].sort((a, b) =>
      (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9)
      || a.tagNumber.localeCompare(b.tagNumber));
    expect(sortBySeverity(rows)).toEqual(shipped);
  });
});

describe('compareBySeverity', () => {
  it('is usable directly as an Array.sort comparator', () => {
    expect(compareBySeverity(eq('93P-1', 'NEED_REPAIR'), eq('93P-2', 'NORMAL'))).toBeLessThan(0);
    expect(compareBySeverity(eq('93P-1', 'NORMAL'), eq('93P-1', 'NORMAL'))).toBe(0);
  });
});
