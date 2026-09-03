import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

/**
 * The handset's local database.
 *
 * This file is the reason the product works. Everything an operator records
 * lands here first, synchronously with the tap, and stays here until the server
 * has confirmed receipt (doc 07 §1). No network, no in-memory state that a
 * force-close can lose — a file on disk.
 *
 * Two shapes live here:
 *
 *   Master cache — tanks, equipment, contractors, crew, tasks. Pulled from the
 *   server, read-only on the phone, kept so the app works with no signal.
 *
 *   Field records — what the operator writes. Each carries a client_id and a
 *   sync_status, and that pair is the whole offline guarantee.
 *
 * Column names stay snake_case to match the server (doc 05), so a record can be
 * read on either side without a mental translation step.
 */

const DATABASE_NAME = 'field.db';

let handle: SQLite.SQLiteDatabase | null = null;

/**
 * Local-only lifecycle of a record (doc 07 §1).
 *
 * SYNCED is terminal except for cleaning sessions, which return to
 * PENDING_SYNC when their after-photo is added — the single exception the
 * protocol allows.
 */
export type SyncStatus = 'PENDING_SYNC' | 'SYNCED' | 'SYNC_ERROR';

/**
 * Migrations are additive and never re-ordered. Same rule as the server
 * (doc 09 §7): an operator's handset may be several versions behind, and the
 * upgrade has to carry their unsynced records forward untouched.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      -- ============ MASTER CACHE (pulled; never edited on the phone) ============

      CREATE TABLE IF NOT EXISTS tanks (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL,                      -- '93T-401', always in full
        name TEXT NOT NULL DEFAULT '',
        height_mm REAL NOT NULL,
        dcs_tag TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS equipment (
        id INTEGER PRIMARY KEY,
        tag_number TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        unit_key TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'NORMAL',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS contractors (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS crew (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        equipment_id INTEGER,
        equipment_tag TEXT NOT NULL DEFAULT '',
        equipment_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN',
        progress_pct INTEGER NOT NULL DEFAULT 0,
        due_date TEXT
      );

      -- ============ DEVIATION CACHE ============
      -- The last readings per tank, kept permanently rather than in the 7-day
      -- window (doc 07 §5). Without these the tape suggestion silently falls
      -- back to raw DCS and the feature stops earning its keep.

      CREATE TABLE IF NOT EXISTS tank_deviation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tank_id INTEGER NOT NULL,
        level_mm REAL NOT NULL,
        dcs_level_mm REAL NOT NULL,
        reading_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deviation_tank ON tank_deviation(tank_id, reading_at DESC);

      -- ============ FIELD RECORDS (queue) ============
      -- client_id is the identity, minted once and never regenerated: it is
      -- what makes a retried sync a no-op instead of a duplicate (doc 07 §3).

      CREATE TABLE IF NOT EXISTS tank_readings (
        client_id TEXT PRIMARY KEY NOT NULL,
        tank_id INTEGER NOT NULL,
        dcs_level_mm REAL,
        tape_length_mm REAL NOT NULL,
        bandul_sulfur_mm REAL NOT NULL,
        level_mm REAL NOT NULL,          -- local preview; server value wins on ack
        deviation_mm REAL,
        attempts INTEGER NOT NULL DEFAULT 1,
        operator_name TEXT NOT NULL,
        shift_group TEXT NOT NULL DEFAULT '',
        shift_time TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        reading_at TEXT NOT NULL,
        photo_local_uri TEXT NOT NULL DEFAULT '',   -- on this phone, pre-upload
        photo_path TEXT NOT NULL DEFAULT '',        -- server path once uploaded
        sync_status TEXT NOT NULL DEFAULT 'PENDING_SYNC',
        server_id INTEGER,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_readings_status ON tank_readings(sync_status);
      CREATE INDEX IF NOT EXISTS idx_readings_tank ON tank_readings(tank_id, reading_at DESC);

      CREATE TABLE IF NOT EXISTS activity_logs (
        client_id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        contractor_name TEXT NOT NULL DEFAULT '',
        unit_area TEXT NOT NULL DEFAULT '',
        activity_at TEXT NOT NULL,
        operator_name TEXT NOT NULL,
        shift_group TEXT NOT NULL DEFAULT '',
        shift_time TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'PENDING_SYNC',
        server_id INTEGER,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activities_status ON activity_logs(sync_status);

      CREATE TABLE IF NOT EXISTS cleaning_sessions (
        client_id TEXT PRIMARY KEY NOT NULL,
        location TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        operator_name TEXT NOT NULL,
        shift_group TEXT NOT NULL DEFAULT '',
        shift_time TEXT NOT NULL DEFAULT '',
        before_photo_local_uri TEXT NOT NULL DEFAULT '',
        before_photo TEXT NOT NULL DEFAULT '',
        before_photo_at TEXT,
        after_photo_local_uri TEXT NOT NULL DEFAULT '',
        after_photo TEXT NOT NULL DEFAULT '',
        after_photo_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'PENDING_SYNC',
        server_id INTEGER,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cleaning_status ON cleaning_sessions(sync_status);

      CREATE TABLE IF NOT EXISTS maintenance_task_logs (
        client_id TEXT PRIMARY KEY NOT NULL,
        task_id INTEGER NOT NULL,
        new_status TEXT,
        progress_pct INTEGER,
        note TEXT NOT NULL DEFAULT '',
        photo_local_uri TEXT NOT NULL DEFAULT '',
        photo_path TEXT NOT NULL DEFAULT '',
        operator_name TEXT NOT NULL DEFAULT '',
        shift_group TEXT NOT NULL DEFAULT '',
        shift_time TEXT NOT NULL DEFAULT '',
        log_time TEXT,
        sync_status TEXT NOT NULL DEFAULT 'PENDING_SYNC',
        server_id INTEGER,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasklogs_status ON maintenance_task_logs(sync_status);

      -- ============ META ============
      -- dataVersion (the pull cursor), lastSyncAt, and the shift context.
      -- The device token is NOT here — it belongs in SecureStore (doc 08 §2.3).

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `,
  },
];

/** Every table holding operator input. The sync engine iterates this. */
export const FIELD_TABLES = [
  'tank_readings',
  'activity_logs',
  'cleaning_sessions',
  'maintenance_task_logs',
] as const;

export const MASTER_TABLES = ['tanks', 'equipment', 'contractors', 'crew', 'tasks'] as const;

export type FieldTable = (typeof FIELD_TABLES)[number];

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.execAsync(migration.sql);
    // PRAGMA will not take a bound parameter, and the value comes from this
    // file's own constant list rather than any input.
    await db.execAsync(`PRAGMA user_version = ${migration.version}`);
  }

  const after = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return after?.user_version ?? 0;
}

/**
 * Opens the database, applying any pending migrations. Safe to call repeatedly;
 * the connection is reused.
 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return handle;

  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // WAL for the same reason as the server: a read while a write is in flight
  // should not block, and a crash mid-write must not corrupt the file.
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');
  await runMigrations(db);

  handle = db;
  return db;
}

/** Test seam — forces the next getDb() to reopen. */
export async function closeDb(): Promise<void> {
  if (!handle) return;
  await handle.closeAsync();
  handle = null;
}

/* ------------------------------------------------------------------- meta */

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value,
  );
}

export async function getMetaNumber(key: string, fallback = 0): Promise<number> {
  const raw = await getMeta(key);
  const parsed = Number(raw);
  return raw !== null && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A stable identifier for this installation, created once and kept for the life
 * of the install.
 *
 * It gives `deviceName` a sensible default at login so the admin Devices tab
 * can tell three identical handsets apart (doc 06 §4), and it survives a logout
 * so a phone keeps its identity across shift changes.
 */
export async function ensureInstallId(): Promise<string> {
  const existing = await getMeta('installId');
  if (existing) return existing;

  const id = Crypto.randomUUID();
  await setMeta('installId', id);
  await setMeta('firstOpenedAt', new Date().toISOString());
  return id;
}

/* ------------------------------------------------------------- diagnostics */

export type DbDiagnostics = {
  schemaVersion: number;
  journalMode: string;
  unsent: number;
  failed: number;
  synced: number;
  perTable: { table: string; total: number; unsent: number }[];
  masterCounts: { table: string; rows: number }[];
};

/**
 * A readable summary of local state, surfaced in Settings.
 *
 * Not developer scaffolding: when an operator says "it did not send", the
 * useful answer is how many records are queued and why, and nobody in the plant
 * has a laptop and adb to hand.
 */
export async function diagnostics(): Promise<DbDiagnostics> {
  const db = await getDb();

  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const journal = await db.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode');

  const perTable: DbDiagnostics['perTable'] = [];
  let unsent = 0;
  let failed = 0;
  let synced = 0;

  for (const table of FIELD_TABLES) {
    const row = await db.getFirstAsync<{ total: number; pending: number; error: number; ok: number }>(
      `SELECT COUNT(*) AS total,
              SUM(sync_status = 'PENDING_SYNC') AS pending,
              SUM(sync_status = 'SYNC_ERROR')   AS error,
              SUM(sync_status = 'SYNCED')       AS ok
         FROM ${table}`,
    );
    const pending = row?.pending ?? 0;
    const error = row?.error ?? 0;
    unsent += pending + error;
    failed += error;
    synced += row?.ok ?? 0;
    perTable.push({ table, total: row?.total ?? 0, unsent: pending + error });
  }

  const masterCounts: DbDiagnostics['masterCounts'] = [];
  for (const table of MASTER_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    masterCounts.push({ table, rows: row?.n ?? 0 });
  }

  return {
    schemaVersion: version?.user_version ?? 0,
    journalMode: journal?.journal_mode ?? 'unknown',
    unsent,
    failed,
    synced,
    perTable,
    masterCounts,
  };
}

/**
 * Everything not yet on the server — pending *and* rejected.
 *
 * SYNC_ERROR counts here. A rejected record has not arrived, and a badge
 * reading "0 belum terkirim" while one sits unsent tells an operator their work
 * is safe when it is not. That mistake was made once already in the protocol
 * simulator; it does not get made again.
 */
export async function unsentCount(): Promise<number> {
  const db = await getDb();
  let total = 0;
  for (const table of FIELD_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE sync_status != 'SYNCED'`,
    );
    total += row?.n ?? 0;
  }
  return total;
}

/**
 * Wipes local state on logout. Deliberately keeps anything unsent: signing out
 * must never be the reason a shift's work disappears (doc 07 §1).
 *
 * @returns how many unsent records were preserved
 */
export async function clearSyncedLocalData(): Promise<number> {
  const db = await getDb();
  let kept = 0;

  // Exclusive, not withTransactionAsync: the plain variant is documented as
  // non-exclusive with no guaranteed ordering, so another query could land
  // between the DELETE and the COUNT and the "records preserved" figure would
  // be wrong — the one number an operator is being asked to trust here.
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const table of FIELD_TABLES) {
      await txn.runAsync(`DELETE FROM ${table} WHERE sync_status = 'SYNCED'`);
      const row = await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      kept += row?.n ?? 0;
    }
    for (const table of MASTER_TABLES) {
      await txn.runAsync(`DELETE FROM ${table}`);
    }
    await txn.runAsync('DELETE FROM tank_deviation');
    await txn.runAsync("DELETE FROM meta WHERE key != 'installId'");
  });

  return kept;
}
