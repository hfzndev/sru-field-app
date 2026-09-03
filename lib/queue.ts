import * as Crypto from 'expo-crypto';
import { ActivityPayload, ReadingPayload } from './api';
import { FIELD_TABLES, FieldTable, getDb } from './db';
import { sweepOrphanPhotos } from './photos';
import { refreshUnsent } from './status';

/**
 * The record queue (doc 07 §1).
 *
 * Every write an operator makes goes in here first, with a client_id and a
 * sync_status. That pair is the entire offline guarantee: the id makes a retry
 * a no-op on the server, and the status means nothing leaves the phone until
 * the server has said it arrived.
 */

export type QueuedReading = {
  clientId: string;
  tankId: number;
  dcsLevelMm: number | null;
  tapeLengthMm: number;
  bandulSulfurMm: number;
  levelMm: number;
  deviationMm: number | null;
  attempts: number;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
  note: string;
  photoLocalUri?: string;
  readingAt: string;
};

/**
 * Saves a reading locally. Returns its client_id.
 *
 * The id is minted here, once, and never changes afterwards — regenerating it
 * on a retry would defeat the server's idempotency and produce exactly the
 * duplicate rows the protocol forbids (doc 07 §3).
 */
export async function enqueueReading(reading: Omit<QueuedReading, 'clientId'>): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();

  await db.runAsync(
    `INSERT INTO tank_readings
       (client_id, tank_id, dcs_level_mm, tape_length_mm, bandul_sulfur_mm, level_mm, deviation_mm,
        attempts, operator_name, shift_group, shift_time, note, photo_local_uri,
        reading_at, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
    clientId, reading.tankId, reading.dcsLevelMm, reading.tapeLengthMm, reading.bandulSulfurMm,
    reading.levelMm, reading.deviationMm, reading.attempts, reading.operatorName,
    reading.shiftGroup, reading.shiftTime, reading.note, reading.photoLocalUri ?? '',
    reading.readingAt, new Date().toISOString(),
  );

  // Every badge in the app updates from here, so the count can never lag behind
  // the record the operator just saved.
  await refreshUnsent();
  return clientId;
}

/**
 * Records waiting to go, oldest first.
 *
 * SYNC_ERROR rows are included: the server rejected them once, but the operator
 * may have corrected the data since, and a record that is never retried is a
 * record silently abandoned.
 */
export async function pendingReadings(): Promise<ReadingPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, never>>(
    `SELECT * FROM tank_readings WHERE sync_status != 'SYNCED' ORDER BY created_at`,
  );

  return rows.map((r: any) => ({
    clientId: r.client_id,
    tankId: r.tank_id,
    dcsLevelMm: r.dcs_level_mm,
    tapeLengthMm: r.tape_length_mm,
    bandulSulfurMm: r.bandul_sulfur_mm,
    attempts: r.attempts,
    operatorName: r.operator_name,
    shiftGroup: r.shift_group,
    shiftTime: r.shift_time,
    note: r.note ?? '',
    ...(r.photo_path ? { photoPath: r.photo_path } : {}),
    readingAt: r.reading_at,
  }));
}

/* -------------------------------------------------------------------- photos

   Every place a record can carry a photograph. Kept as data rather than spread
   through the sync code so that adding one later is a single line here, and so
   the retention sweep and the uploader can never disagree about where photos
   live.                                                                       */

export const PHOTO_COLUMNS: { table: FieldTable; local: string; remote: string }[] = [
  { table: 'tank_readings', local: 'photo_local_uri', remote: 'photo_path' },
  { table: 'cleaning_sessions', local: 'before_photo_local_uri', remote: 'before_photo' },
  { table: 'cleaning_sessions', local: 'after_photo_local_uri', remote: 'after_photo' },
];

export type PendingPhoto = {
  table: FieldTable;
  clientId: string;
  localUri: string;
  remoteColumn: string;
};

/**
 * Photos belonging to unsent records that have not been uploaded yet.
 *
 * "Not uploaded yet" is `local set, remote empty`. Once the server path is
 * written the file stops being pending even though it is still on the phone —
 * re-uploading would create a second copy on the server that nothing points at.
 */
export async function pendingPhotos(): Promise<PendingPhoto[]> {
  const db = await getDb();
  const out: PendingPhoto[] = [];

  for (const column of PHOTO_COLUMNS) {
    const rows = await db.getAllAsync<{ client_id: string; local: string }>(
      `SELECT client_id, ${column.local} AS local FROM ${column.table}
        WHERE sync_status != 'SYNCED'
          AND ${column.local} != ''
          AND ${column.remote} = ''`,
    );
    for (const row of rows) {
      out.push({
        table: column.table,
        clientId: row.client_id,
        localUri: row.local,
        remoteColumn: column.remote,
      });
    }
  }

  return out;
}

/** Records the server path for an uploaded photo so the push can embed it. */
export async function markPhotoUploaded(photo: PendingPhoto, serverPath: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE ${photo.table} SET ${photo.remoteColumn} = ? WHERE client_id = ?`,
    serverPath, photo.clientId,
  );
}

/** Every local photo path any record still refers to. Drives the orphan sweep. */
export async function referencedPhotoUris(): Promise<string[]> {
  const db = await getDb();
  const uris: string[] = [];

  for (const column of PHOTO_COLUMNS) {
    const rows = await db.getAllAsync<{ local: string }>(
      `SELECT ${column.local} AS local FROM ${column.table} WHERE ${column.local} != ''`,
    );
    for (const row of rows) uris.push(row.local);
  }

  return uris;
}

/* ---------------------------------------------------------------- activities */

export type QueuedActivity = {
  type: 'OPERATOR' | 'KONTRAKTOR';
  description: string;
  contractorName: string;
  unitArea: string;
  activityAt: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

/**
 * Saves an activity locally. Returns its client_id.
 *
 * The point of this record type is that it is captured where the work happened
 * rather than remembered at the end of the shift (doc 02 §4), so it has to save
 * instantly and offline — the same guarantee readings get.
 */
export async function enqueueActivity(activity: QueuedActivity): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();

  await db.runAsync(
    `INSERT INTO activity_logs
       (client_id, type, description, contractor_name, unit_area, activity_at,
        operator_name, shift_group, shift_time, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
    clientId, activity.type, activity.description, activity.contractorName,
    activity.unitArea, activity.activityAt, activity.operatorName,
    activity.shiftGroup, activity.shiftTime, new Date().toISOString(),
  );

  await refreshUnsent();
  return clientId;
}

/** Activities waiting to go, oldest first. Includes SYNC_ERROR — see pendingReadings. */
export async function pendingActivities(): Promise<ActivityPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM activity_logs WHERE sync_status != 'SYNCED' ORDER BY created_at`,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    type: r.type,
    description: r.description,
    contractorName: r.contractor_name ?? '',
    unitArea: r.unit_area ?? '',
    activityAt: r.activity_at,
    operatorName: r.operator_name,
    shiftGroup: r.shift_group,
    shiftTime: r.shift_time,
  }));
}

export type ActivityRow = {
  clientId: string;
  type: 'OPERATOR' | 'KONTRAKTOR';
  description: string;
  contractorName: string;
  unitArea: string;
  activityAt: string;
  operatorName: string;
  shiftTime: string;
  syncStatus: string;
};

/**
 * Activities for the list, newest first.
 *
 * Ordered by when the work happened, not when it was typed: an operator who
 * records something twenty minutes late still expects it to sit in the right
 * place in the shift story (doc 02 §4).
 */
export async function listActivities(limit = 100): Promise<ActivityRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM activity_logs ORDER BY activity_at DESC LIMIT ?`, limit,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    type: r.type,
    description: r.description,
    contractorName: r.contractor_name ?? '',
    unitArea: r.unit_area ?? '',
    activityAt: r.activity_at,
    operatorName: r.operator_name,
    shiftTime: r.shift_time,
    syncStatus: r.sync_status,
  }));
}

/** Which table a client_id belongs to, so acks can be applied generically. */
async function tableForClientId(clientId: string): Promise<FieldTable | null> {
  const db = await getDb();
  for (const table of FIELD_TABLES) {
    const row = await db.getFirstAsync<{ client_id: string }>(
      `SELECT client_id FROM ${table} WHERE client_id = ?`, clientId,
    );
    if (row) return table;
  }
  return null;
}

/**
 * Marks a record accepted.
 *
 * The server's recomputed level replaces the local preview when it differs
 * (doc 07 §2.4a). The phone's number was only ever for immediate feedback; the
 * stored value must match what the server holds, or the two disagree forever.
 */
export async function markSynced(
  clientId: string,
  serverId: number | null,
  serverValues?: { levelMm?: number; deviationMm?: number | null },
): Promise<void> {
  const db = await getDb();
  const table = await tableForClientId(clientId);
  if (!table) return;

  await db.runAsync(
    `UPDATE ${table} SET sync_status = 'SYNCED', server_id = ?, error_code = NULL, error_message = NULL
      WHERE client_id = ?`,
    serverId, clientId,
  );

  if (table === 'tank_readings' && serverValues?.levelMm !== undefined) {
    await db.runAsync(
      'UPDATE tank_readings SET level_mm = ?, deviation_mm = ? WHERE client_id = ?',
      serverValues.levelMm, serverValues.deviationMm ?? null, clientId,
    );
  }
}

/**
 * Marks a record rejected on domain grounds.
 *
 * It stays on the phone and keeps counting as unsent. The operator is shown the
 * server's reason so they can fix it — a rejected record that quietly vanished
 * would be indistinguishable from one that synced.
 */
export async function markError(clientId: string, code: string, message: string): Promise<void> {
  const db = await getDb();
  const table = await tableForClientId(clientId);
  if (!table) return;

  await db.runAsync(
    `UPDATE ${table} SET sync_status = 'SYNC_ERROR', error_code = ?, error_message = ? WHERE client_id = ?`,
    code, message, clientId,
  );
}

export type UnsentRecord = {
  clientId: string;
  table: FieldTable;
  label: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

/**
 * What the Sync screen lists — everything not yet on the server.
 *
 * Every field table, not only readings: a screen reporting "semua terkirim"
 * while an activity sits unsent is worse than no screen at all.
 */
export async function unsentRecords(): Promise<UnsentRecord[]> {
  const db = await getDb();

  const readings = await db.getAllAsync<any>(
    `SELECT r.client_id, r.sync_status, r.error_message, r.created_at, r.level_mm, t.code AS tank_code
       FROM tank_readings r
       LEFT JOIN tanks t ON t.id = r.tank_id
      WHERE r.sync_status != 'SYNCED'`,
  );

  const activities = await db.getAllAsync<any>(
    `SELECT client_id, sync_status, error_message, created_at, type, description
       FROM activity_logs WHERE sync_status != 'SYNCED'`,
  );

  const cleaning = await db.getAllAsync<any>(
    `SELECT client_id, sync_status, error_message, created_at, location
       FROM cleaning_sessions WHERE sync_status != 'SYNCED'`,
  );

  const all: UnsentRecord[] = [
    ...readings.map((r) => ({
      clientId: r.client_id,
      table: 'tank_readings' as FieldTable,
      // Full tank code, never abbreviated (doc 02 §1.1).
      label: `${r.tank_code ?? 'Tangki'} — ${Number(r.level_mm).toLocaleString('id-ID')} mm`,
      status: r.sync_status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    })),
    ...activities.map((a) => ({
      clientId: a.client_id,
      table: 'activity_logs' as FieldTable,
      label: `${a.type === 'KONTRAKTOR' ? 'Kontraktor' : 'Operator'} — ${a.description}`,
      status: a.sync_status,
      errorMessage: a.error_message,
      createdAt: a.created_at,
    })),
    ...cleaning.map((c) => ({
      clientId: c.client_id,
      table: 'cleaning_sessions' as FieldTable,
      label: `Bersih-bersih — ${c.location}`,
      status: c.sync_status,
      errorMessage: c.error_message,
      createdAt: c.created_at,
    })),
  ];

  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Rolling 7-day retention (doc 07 §5).
 *
 * Two rules are absolute and both exist to stop the phone deleting work:
 *   PENDING_SYNC is never purged, at any age. A handset offline for ten days
 *   still holds everything it recorded.
 *   Cleaning sessions still IN_PROGRESS are never purged either, even once
 *   synced — they are waiting for an after-photo, and losing them locally would
 *   strand work the operator intends to finish.
 *
 * @returns how many rows were removed
 */
export async function runRetention(): Promise<number> {
  const db = await getDb();
  let removed = 0;

  for (const table of FIELD_TABLES) {
    const keepUnfinishedCleaning = table === 'cleaning_sessions'
      ? " AND status != 'IN_PROGRESS'"
      : '';

    const result = await db.runAsync(
      `DELETE FROM ${table}
        WHERE sync_status = 'SYNCED'
          AND created_at < datetime('now', '-7 days')
          ${keepUnfinishedCleaning}`,
    );
    removed += result.changes;
  }

  // Deleting rows without deleting their files fills the phone with images
  // nothing can display or explain. Sweeping afterwards — from what the tables
  // still reference — also collects photos abandoned before their record was
  // ever saved, and it reads the surviving rows, so the cleaning carve-out
  // above automatically protects those sessions' BEFORE photos (doc 07 §5).
  sweepOrphanPhotos(await referencedPhotoUris());

  return removed;
}
