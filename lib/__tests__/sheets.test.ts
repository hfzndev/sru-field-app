import {
  SheetCell, SheetColumn, SheetRow, cellIsFilled, completionText, progressOf,
} from '../sheets';

/**
 * The rules a lembar tugas is counted by (doc 05 §4).
 *
 * These decide the one number an operator reads on Beranda, so they are worth
 * pinning: a count that overstates progress sends someone home with a pump
 * unphotographed, and one that understates it teaches them to ignore the count.
 *
 * The same rules exist on the server in sru-field-api/lib/sheets.js. They are
 * tested on both sides rather than shared, because a supervisor watching "7 of
 * 12" and an operator watching "8 of 12" is exactly the kind of drift nobody
 * reports and everybody stops trusting.
 */

function column(over: Partial<SheetColumn> & { id: number }): SheetColumn {
  return {
    sheetId: 1,
    label: `Kolom ${over.id}`,
    kind: 'PHOTO',
    isRequired: true,
    options: [],
    examplePhoto: '',
    hint: '',
    ...over,
  };
}

function row(clientId: string): SheetRow {
  return {
    clientId,
    serverId: null,
    sheetId: 1,
    label: clientId,
    sortOrder: 0,
    addedByName: '',
    syncStatus: 'PENDING_SYNC',
  };
}

function cell(over: Partial<SheetCell> = {}): SheetCell {
  return {
    clientId: 'c1',
    sheetId: 1,
    rowClientId: 'r1',
    columnId: 1,
    valueText: '',
    valueNumber: null,
    photoLocalUri: '',
    photoPath: '',
    filledByName: 'Budi',
    filledAt: '2026-09-02T01:00:00.000Z',
    syncStatus: 'PENDING_SYNC',
    ...over,
  };
}

const cellMap = (entries: [string, SheetCell][]) => new Map(entries);

describe('cellIsFilled', () => {
  it('treats a photo as filled whether it is still local or already uploaded', () => {
    expect(cellIsFilled('PHOTO', cell({ photoLocalUri: 'file:///a.jpg' }))).toBe(true);
    expect(cellIsFilled('PHOTO', cell({ photoPath: 'uploads/x.jpg' }))).toBe(true);
    expect(cellIsFilled('PHOTO', cell())).toBe(false);
  });

  it('counts a numeric zero as an answer', () => {
    // The reason this function exists per kind. A tank at 0 mm, a count of 0
    // faults — both are readings someone walked out to take, and "empty" is a
    // different thing entirely.
    expect(cellIsFilled('NUMBER', cell({ valueNumber: 0 }))).toBe(true);
    expect(cellIsFilled('NUMBER', cell({ valueNumber: null }))).toBe(false);
  });

  it('treats an empty string as unfilled for text-shaped kinds', () => {
    expect(cellIsFilled('TEXT', cell({ valueText: 'bocor' }))).toBe(true);
    expect(cellIsFilled('TEXT', cell({ valueText: '' }))).toBe(false);
    expect(cellIsFilled('CHOICE', cell({ valueText: 'Kotor' }))).toBe(true);
    expect(cellIsFilled('CHECK', cell({ valueText: 'Tidak' }))).toBe(true);
  });

  it('is false for a cell that does not exist', () => {
    expect(cellIsFilled('PHOTO', undefined)).toBe(false);
  });
});

describe('progressOf', () => {
  const wide = column({ id: 1, label: 'Foto Wide' });
  const close = column({ id: 2, label: 'Foto Close' });
  const rows = [row('r1'), row('r2')];

  it('counts only required fillable columns', () => {
    const optional = column({ id: 3, label: 'Catatan', kind: 'TEXT', isRequired: false });
    const heading = column({ id: 4, label: 'Keterangan', kind: 'LABEL' });

    const progress = progressOf([wide, close, optional, heading], rows, cellMap([]));

    // Two required columns across two rows — the optional column and the
    // read-only heading are not work.
    expect(progress.total).toBe(4);
  });

  it('marks a row done only when every required cell is filled', () => {
    const cells = cellMap([
      ['r1:1', cell({ photoLocalUri: 'file:///wide.jpg' })],
      ['r1:2', cell({ photoLocalUri: 'file:///close.jpg' })],
      ['r2:1', cell({ photoLocalUri: 'file:///wide2.jpg' })],
    ]);

    const progress = progressOf([wide, close], rows, cells);

    expect(progress).toEqual({ filled: 3, total: 4, rowsDone: 1, rows: 2 });
  });

  it('does not credit a row for filling an optional column', () => {
    const optional = column({ id: 3, kind: 'TEXT', isRequired: false });
    const cells = cellMap([['r1:3', cell({ valueText: 'catatan' })]]);

    expect(progressOf([wide, optional], rows, cells).rowsDone).toBe(0);
  });

  it('reports no rows done when the lembar has no required columns', () => {
    // Otherwise every row would trivially be "complete", and a lembar the
    // supervisor is still designing would show as finished work.
    const optional = column({ id: 3, kind: 'TEXT', isRequired: false });

    expect(progressOf([optional], rows, cellMap([]))).toEqual({
      filled: 0, total: 0, rowsDone: 0, rows: 2,
    });
  });
});

describe('completionText', () => {
  it('counts rows, not percent', () => {
    expect(completionText({ filled: 7, total: 24, rowsDone: 3, rows: 12 }))
      .toBe('3 dari 12 baris selesai');
  });

  it('says so plainly when there is nothing to walk yet', () => {
    expect(completionText({ filled: 0, total: 0, rowsDone: 0, rows: 0 }))
      .toBe('Belum ada baris');
  });

  it('distinguishes an unfinished design from unfinished work', () => {
    expect(completionText({ filled: 0, total: 0, rowsDone: 0, rows: 4 }))
      .toBe('4 baris · belum ada kolom wajib');
  });
});
