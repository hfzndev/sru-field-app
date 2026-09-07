import { SheetCellDto, SheetColumnDto, SheetDto, SheetRowDto } from './api';
import { getDb } from './db';

/**
 * Lembar tugas on the handset (doc 05 §4).
 *
 * A lembar is a table a supervisor designs in the admin web — columns of a
 * chosen kind, rows naming the equipment to visit, and an example photo per
 * photo-column. The operator fills it here, offline, one row at a time. The
 * grid is the supervisor's view; a 5-inch screen in a glove cannot be one.
 *
 * Two things shape every query below:
 *
 *   Cells are append-only, exactly as on the server (doc 07 §4). Filling a cell
 *   twice writes two rows and the later `filled_at` is the value that counts.
 *   Nothing is overwritten, so two operators working one lembar out of signal
 *   is a non-event rather than a conflict nobody can resolve in the plant.
 *
 *   Rows are keyed by client_id, never by server id. An operator can create a
 *   row where no server id exists yet, and the server mints a client_id for its
 *   own rows too, so there is one way to address a row and no branch on origin.
 */

/** Kinds an operator can put something in — LABEL is text the supervisor wrote. */
export const FILLABLE_KINDS = new Set(['TEXT', 'NUMBER', 'PHOTO', 'CHECK', 'CHOICE']);

/** A CHECK column stores one of these in value_text. */
export const CHECK_YES = 'Ya';
export const CHECK_NO = 'Tidak';

export type SheetRecord = {
  id: number;
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  allowOperatorRows: boolean;
};

export type SheetColumn = {
  id: number;
  sheetId: number;
  label: string;
  kind: string;
  isRequired: boolean;
  options: string[];
  examplePhoto: string;
  hint: string;
};

export type SheetRow = {
  clientId: string;
  serverId: number | null;
  sheetId: number;
  label: string;
  sortOrder: number;
  addedByName: string;
  syncStatus: string;
};

export type SheetCell = {
  clientId: string;
  sheetId: number;
  rowClientId: string;
  columnId: number;
  valueText: string;
  valueNumber: number | null;
  photoLocalUri: string;
  photoPath: string;
  filledByName: string;
  filledAt: string;
  syncStatus: string;
};

/** Progress toward finishing a lembar, in the units an operator thinks in. */
export type SheetProgress = { filled: number; total: number; rowsDone: number; rows: number };

/**
 * Whether a cell reads as done.
 *
 * Per kind rather than "any field non-empty": a NUMBER of 0 is a real answer
 * and must not look blank, while an empty string in the same place must. Same
 * rule as the server's lib/sheets.js, so the progress an operator sees matches
 * the progress the supervisor sees.
 */
export function cellIsFilled(kind: string, cell: SheetCell | undefined): boolean {
  if (!cell) return false;
  if (kind === 'PHOTO') return Boolean(cell.photoLocalUri || cell.photoPath);
  if (kind === 'NUMBER') return cell.valueNumber !== null;
  return Boolean(cell.valueText);
}

function parseOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((o) => typeof o === 'string') : [];
  } catch {
    // Never throw on a read: one malformed column must not cost the operator
    // the whole lembar.
    return [];
  }
}

/* ------------------------------------------------------------------- reads */

/**
 * Lembar this handset should show, newest first.
 *
 * Only OPEN and active ones: a lembar the supervisor closed or deleted is not
 * work any more, and leaving it on the list invites a walk that will be
 * rejected at sync (lib/sync.js SHEET_CLOSED).
 */
export async function listSheets(): Promise<SheetRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM task_sheets WHERE is_active = 1 AND status = 'OPEN' ORDER BY id DESC`,
  );
  return rows.map(toSheet);
}

export async function getSheet(id: number): Promise<SheetRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>('SELECT * FROM task_sheets WHERE id = ?', id);
  return row ? toSheet(row) : null;
}

export async function listColumns(sheetId: number): Promise<SheetColumn[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM task_sheet_columns WHERE sheet_id = ? AND is_active = 1 ORDER BY sort_order, id',
    sheetId,
  );
  return rows.map((c) => ({
    id: c.id,
    sheetId: c.sheet_id,
    label: c.label,
    kind: c.kind,
    isRequired: c.is_required === 1,
    options: parseOptions(c.options),
    examplePhoto: c.example_photo ?? '',
    hint: c.hint ?? '',
  }));
}

export async function listRows(sheetId: number): Promise<SheetRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM task_sheet_rows WHERE sheet_id = ? AND is_active = 1 ORDER BY sort_order, created_at',
    sheetId,
  );
  return rows.map(toRow);
}

export async function getRow(clientId: string): Promise<SheetRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM task_sheet_rows WHERE client_id = ?', clientId,
  );
  return row ? toRow(row) : null;
}

/**
 * The current value of every cell on one lembar, keyed `rowClientId:columnId`.
 *
 * "Current" is the newest write per cell, resolved here rather than on read at
 * each call site — the append-only rule is easy to forget, and a screen that
 * forgot it would show the operator their first attempt instead of their
 * correction. `filled_at` ties break by rowid: the last write wins.
 */
export async function currentCells(sheetId: number): Promise<Map<string, SheetCell>> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT c.* FROM task_sheet_cells c
      WHERE c.sheet_id = ?
        AND c.rowid = (
          SELECT c2.rowid FROM task_sheet_cells c2
           WHERE c2.sheet_id = c.sheet_id
             AND c2.row_client_id = c.row_client_id
             AND c2.column_id = c.column_id
           ORDER BY c2.filled_at DESC, c2.rowid DESC LIMIT 1
        )`,
    sheetId,
  );

  const map = new Map<string, SheetCell>();
  for (const c of rows) {
    const cell = toCell(c);
    map.set(`${cell.rowClientId}:${cell.columnId}`, cell);
  }
  return map;
}

/**
 * How far through a lembar the shift is.
 *
 * Only required fillable columns count toward `total`. Counting the optional
 * ones would leave a finished round reading "10 dari 14" forever, which teaches
 * operators to ignore the number — the one thing a progress count must not do.
 */
export function progressOf(
  columns: SheetColumn[], rows: SheetRow[], cells: Map<string, SheetCell>,
): SheetProgress {
  const required = columns.filter((c) => c.isRequired && FILLABLE_KINDS.has(c.kind));

  let filled = 0;
  let rowsDone = 0;
  for (const row of rows) {
    let done = 0;
    for (const column of required) {
      if (cellIsFilled(column.kind, cells.get(`${row.clientId}:${column.id}`))) done += 1;
    }
    filled += done;
    if (required.length > 0 && done === required.length) rowsDone += 1;
  }

  return { filled, total: required.length * rows.length, rowsDone, rows: rows.length };
}

/** Everything one lembar screen needs, in one round trip. */
export async function loadSheet(sheetId: number): Promise<{
  sheet: SheetRecord | null;
  columns: SheetColumn[];
  rows: SheetRow[];
  cells: Map<string, SheetCell>;
  progress: SheetProgress;
} | null> {
  const sheet = await getSheet(sheetId);
  if (!sheet) return null;

  const [columns, rows, cells] = await Promise.all([
    listColumns(sheetId), listRows(sheetId), currentCells(sheetId),
  ]);
  return { sheet, columns, rows, cells, progress: progressOf(columns, rows, cells) };
}

/**
 * "7 dari 12 baris selesai" — the same sentence the admin panel uses.
 *
 * The count, not a percentage: an operator thinks in rows walked. A lembar with
 * no required columns has nothing to complete, and "0 dari 4 baris selesai"
 * there would read as work not done rather than as a design still being written.
 */
export function completionText(progress: SheetProgress): string {
  if (progress.rows === 0) return 'Belum ada baris';
  if (progress.total === 0) return `${progress.rows} baris · belum ada kolom wajib`;
  return `${progress.rowsDone} dari ${progress.rows} baris selesai`;
}

/* ------------------------------------------------------- writes from pull */

type Txn = { runAsync: (sql: string, ...args: any[]) => Promise<unknown>;
             getFirstAsync: <T>(sql: string, ...args: any[]) => Promise<T | null> };

/**
 * Stores the lembar design from a pull or a login bootstrap.
 *
 * Upsert rather than replace, because `task_sheet_rows` is a field table: it
 * can hold a row this operator created that the server has not seen yet, and a
 * DELETE-then-insert would throw that away along with any cells hanging off it.
 * The design tables have no local state and could be replaced, but are upserted
 * too so the two paths read the same.
 *
 * Shared by lib/session.ts (login) and lib/sync.ts (pull) for the reason
 * written at the top of lib/db.ts: login stores the server's dataVersion as the
 * pull cursor, so anything one path omits the other will never fetch.
 */
export async function applySheetMaster(txn: Txn, master: {
  sheets?: SheetDto[]; sheetColumns?: SheetColumnDto[]; sheetRows?: SheetRowDto[];
}): Promise<number> {
  let count = 0;

  for (const sheet of master.sheets ?? []) {
    await txn.runAsync(
      `INSERT INTO task_sheets
         (id, title, description, status, due_date, assigned_shift, allow_operator_rows, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, description = excluded.description, status = excluded.status,
         due_date = excluded.due_date, assigned_shift = excluded.assigned_shift,
         allow_operator_rows = excluded.allow_operator_rows, is_active = excluded.is_active`,
      sheet.id, sheet.title, sheet.description ?? '', sheet.status, sheet.dueDate ?? null,
      sheet.assignedShift ?? '', sheet.allowOperatorRows ? 1 : 0, sheet.isActive ? 1 : 0,
    );
    count += 1;
  }

  for (const column of master.sheetColumns ?? []) {
    await txn.runAsync(
      `INSERT INTO task_sheet_columns
         (id, sheet_id, label, kind, is_required, options, example_photo, hint, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, kind = excluded.kind, is_required = excluded.is_required,
         options = excluded.options, example_photo = excluded.example_photo,
         hint = excluded.hint, sort_order = excluded.sort_order, is_active = excluded.is_active`,
      column.id, column.sheetId, column.label, column.kind, column.isRequired ? 1 : 0,
      JSON.stringify(column.options ?? []), column.examplePhoto ?? '', column.hint ?? '',
      column.sortOrder, column.isActive ? 1 : 0,
    );
    count += 1;
  }

  for (const row of master.sheetRows ?? []) {
    // A row with no client_id cannot be addressed by a cell, so it is skipped
    // rather than stored half-usable. Every row the API creates carries one;
    // this guards against a database seeded directly.
    if (!row.clientId) continue;

    await txn.runAsync(
      `INSERT INTO task_sheet_rows
         (client_id, sheet_id, label, sort_order, added_by_name, is_active,
          sync_status, server_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'SYNCED', ?, datetime('now'))
       ON CONFLICT(client_id) DO UPDATE SET
         label = excluded.label, sort_order = excluded.sort_order,
         added_by_name = excluded.added_by_name, is_active = excluded.is_active,
         -- The server id is news; the sync_status is not. A row still
         -- PENDING here is one whose ack this device has not seen, and
         -- overwriting that would drop it out of the push queue before the
         -- server ever confirmed it.
         server_id = excluded.server_id`,
      row.clientId, row.sheetId, row.label, row.sortOrder, row.addedByName ?? '',
      row.isActive ? 1 : 0, row.id,
    );
    count += 1;
  }

  return count;
}

/**
 * Stores cell values pulled from the server — including ones this shift did not
 * write.
 *
 * DO NOTHING on conflict, never an upsert: a client_id already here belongs to
 * a record this device created, which may still be PENDING or carry a rejection
 * the operator has yet to see. The server's copy must not overwrite that.
 */
export async function applySheetCells(txn: Txn, cells: SheetCellDto[]): Promise<number> {
  let count = 0;

  for (const cell of cells) {
    // Cells arrive addressed by the row's server id; locally rows are keyed by
    // client_id. A cell whose row this handset has not received yet is dropped
    // — it will arrive on a later pull, once the row does.
    const row = await txn.getFirstAsync<{ client_id: string }>(
      'SELECT client_id FROM task_sheet_rows WHERE server_id = ?', cell.rowId,
    );
    if (!row) continue;

    await txn.runAsync(
      `INSERT INTO task_sheet_cells
         (client_id, sheet_id, row_client_id, column_id, value_text, value_number,
          photo_path, filled_by_name, shift_group, shift_time, filled_at,
          sync_status, server_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)
       ON CONFLICT(client_id) DO NOTHING`,
      cell.clientId, cell.sheetId, row.client_id, cell.columnId, cell.valueText ?? '',
      cell.valueNumber, cell.photoPath ?? '', cell.filledByName ?? '', cell.shiftGroup ?? '',
      cell.shiftTime ?? '', cell.filledAt,
      cell.id,
      // created_at drives retention, so it tracks when the server received the
      // record — not now, or a pulled cell would restart its 7 days on every
      // device that ever sees it.
      cell.receivedAt ?? cell.filledAt,
    );
    count += 1;
  }

  return count;
}

/* ------------------------------------------------------------------ shapes */

function toSheet(s: any): SheetRecord {
  return {
    id: s.id,
    title: s.title,
    description: s.description ?? '',
    status: s.status,
    dueDate: s.due_date ?? null,
    allowOperatorRows: s.allow_operator_rows === 1,
  };
}

function toRow(r: any): SheetRow {
  return {
    clientId: r.client_id,
    serverId: r.server_id ?? null,
    sheetId: r.sheet_id,
    label: r.label,
    sortOrder: r.sort_order,
    addedByName: r.added_by_name ?? '',
    syncStatus: r.sync_status,
  };
}

function toCell(c: any): SheetCell {
  return {
    clientId: c.client_id,
    sheetId: c.sheet_id,
    rowClientId: c.row_client_id,
    columnId: c.column_id,
    valueText: c.value_text ?? '',
    valueNumber: c.value_number ?? null,
    photoLocalUri: c.photo_local_uri ?? '',
    photoPath: c.photo_path ?? '',
    filledByName: c.filled_by_name ?? '',
    filledAt: c.filled_at,
    syncStatus: c.sync_status,
  };
}
