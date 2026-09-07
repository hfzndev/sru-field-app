import * as Crypto from 'expo-crypto';
import { STATUS_LABEL } from '@/constants/theme';
import { isoDaysAgo } from './format';
import {
  ActivityPayload, CleaningPayload, EquipmentStatusPayload, ReadingPayload,
  SheetCellPayload, SheetRowPayload, TaskLogPayload,
} from './api';
import { FIELD_TABLES, FieldTable, getDb } from './db';
import { deletePhoto, sweepOrphanPhotos } from './photos';
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
 * PENDING_SYNC only. A SYNC_ERROR row was rejected on domain grounds and
 * nothing about it has changed since, so re-sending it every cycle produced the
 * same rejection forever: a badge that never reaches zero, "N ditolak" on every
 * sync, and no way out. It goes again when the operator asks it to, from the
 * Sync screen (retryRecord), which is also where it can be discarded.
 */
export async function pendingReadings(): Promise<ReadingPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, never>>(
    `SELECT * FROM tank_readings WHERE sync_status = 'PENDING_SYNC' ORDER BY created_at`,
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

/**
 * `required` decides what happens when the local file has gone missing.
 *
 * For cleaning the photographs *are* the record — a session with no before and
 * after proves nothing happened, so it must not go up without them (doc 02 §3).
 * A reading's photo and a task log's are corroboration; the form itself calls
 * the latter "Foto bukti (opsional)". Discarding a valid measurement because a
 * file vanished would be the worse loss, so those go without it and say so.
 */
export const PHOTO_COLUMNS: {
  table: FieldTable; local: string; remote: string; required: boolean;
}[] = [
  { table: 'tank_readings', local: 'photo_local_uri', remote: 'photo_path', required: false },
  { table: 'cleaning_sessions', local: 'before_photo_local_uri', remote: 'before_photo', required: true },
  { table: 'cleaning_sessions', local: 'after_photo_local_uri', remote: 'after_photo', required: true },
  { table: 'maintenance_task_logs', local: 'photo_local_uri', remote: 'photo_path', required: false },
  // A photo column on a lembar tugas. Not required: the supervisor decides
  // whether the column is mandatory, and a lost file must not strand the rest
  // of a row the operator walked out to fill.
  { table: 'task_sheet_cells', local: 'photo_local_uri', remote: 'photo_path', required: false },
];

export type PendingPhoto = {
  table: FieldTable;
  clientId: string;
  localUri: string;
  localColumn: string;
  remoteColumn: string;
  required: boolean;
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
        WHERE sync_status = 'PENDING_SYNC'
          AND ${column.local} != ''
          AND ${column.remote} = ''`,
    );
    for (const row of rows) {
      out.push({
        table: column.table,
        clientId: row.client_id,
        localUri: row.local,
        localColumn: column.local,
        remoteColumn: column.remote,
        required: column.required,
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
    `SELECT * FROM activity_logs WHERE sync_status = 'PENDING_SYNC' ORDER BY created_at`,
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

/* ------------------------------------------------------------------ cleaning

   The only two-stage record in the app (doc 02 §3). A session is created with
   its BEFORE photo and saved as IN_PROGRESS; the area is cleaned; the AFTER
   photo arrives later — sometimes much later, and often after the first stage
   has already synced.

   That makes cleaning the single exception to "SYNCED is terminal" (doc 07 §1).
   Everywhere else in this app a synced record is finished.                    */

export type QueuedCleaning = {
  location: string;
  note: string;
  beforePhotoLocalUri: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

/** Starts a session from its BEFORE photo. Returns the client_id. */
export async function enqueueCleaning(session: QueuedCleaning): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO cleaning_sessions
       (client_id, location, note, status, operator_name, shift_group, shift_time,
        before_photo_local_uri, before_photo_at, sync_status, created_at)
     VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
    clientId, session.location, session.note, session.operatorName,
    session.shiftGroup, session.shiftTime, session.beforePhotoLocalUri, now, now,
  );

  await refreshUnsent();
  return clientId;
}

/**
 * Attaches the AFTER photo and completes the session.
 *
 * A session that already synced is pushed back to PENDING_SYNC so the completed
 * version goes up (doc 07 §1). The server treats that as an upsert on the same
 * client_id and moves only the four columns it is allowed to (doc 07 §4), so
 * the location, the BEFORE photo and the attribution stay as first recorded
 * even though the record is being sent a second time.
 */
export async function completeCleaning(clientId: string, afterPhotoLocalUri: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE cleaning_sessions
        SET after_photo_local_uri = ?, after_photo_at = ?, status = 'DONE',
            sync_status = 'PENDING_SYNC', error_code = NULL, error_message = NULL
      WHERE client_id = ?`,
    afterPhotoLocalUri, new Date().toISOString(), clientId,
  );
  await refreshUnsent();
}

/** Cleaning sessions waiting to go, oldest first. */
export async function pendingCleaning(): Promise<CleaningPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM cleaning_sessions WHERE sync_status = 'PENDING_SYNC' ORDER BY created_at`,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    location: r.location,
    note: r.note ?? '',
    beforePhoto: r.before_photo ?? '',
    beforePhotoAt: r.before_photo_at ?? null,
    afterPhoto: r.after_photo ?? '',
    afterPhotoAt: r.after_photo_at ?? null,
    operatorName: r.operator_name,
    shiftGroup: r.shift_group,
    shiftTime: r.shift_time,
  }));
}

export type CleaningRow = {
  clientId: string;
  location: string;
  note: string;
  status: string;
  operatorName: string;
  shiftTime: string;
  beforePhotoLocalUri: string;
  beforePhoto: string;
  afterPhotoLocalUri: string;
  afterPhoto: string;
  beforePhotoAt: string | null;
  afterPhotoAt: string | null;
  syncStatus: string;
  createdAt: string;
};

/**
 * Sessions for the list, unfinished ones first.
 *
 * An IN_PROGRESS session is a job the shift still owes; a DONE one is history.
 * Sorting by status before time puts the outstanding work where it gets seen.
 */
export async function listCleaning(limit = 100): Promise<CleaningRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM cleaning_sessions
      ORDER BY (status = 'IN_PROGRESS') DESC, created_at DESC
      LIMIT ?`,
    limit,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    location: r.location,
    note: r.note ?? '',
    status: r.status,
    operatorName: r.operator_name,
    shiftTime: r.shift_time,
    beforePhotoLocalUri: r.before_photo_local_uri ?? '',
    beforePhoto: r.before_photo ?? '',
    afterPhotoLocalUri: r.after_photo_local_uri ?? '',
    afterPhoto: r.after_photo ?? '',
    beforePhotoAt: r.before_photo_at ?? null,
    afterPhotoAt: r.after_photo_at ?? null,
    syncStatus: r.sync_status,
    createdAt: r.created_at,
  }));
}

export async function getCleaning(clientId: string): Promise<CleaningRow | null> {
  const rows = await listCleaning(500);
  return rows.find((r) => r.clientId === clientId) ?? null;
}

/* --------------------------------------------------------- equipment status */

export const EQUIPMENT_STATUSES = ['NORMAL', 'STANDBY', 'ON_REPAIR', 'NEED_REPAIR'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export type EquipmentRow = {
  id: number;
  tagNumber: string;
  name: string;
  unitKey: string;
  location: string;
  status: string;
  statusNote: string;
  statusChangedBy: string;
  statusChangedAt: string | null;
  /** A queued change on this handset that the server has not confirmed yet. */
  pendingStatus: string | null;
};

/**
 * The equipment list, with any unsent change folded in.
 *
 * `pendingStatus` matters more than it looks: an operator who reports a fault
 * with no signal and then reopens the screen must see their own report, not the
 * status the server last knew. Without it the app appears to have discarded the
 * report, and the operator writes it again.
 */
export async function listEquipment(): Promise<EquipmentRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT e.*, (
       SELECT l.new_status FROM equipment_status_logs l
        WHERE l.equipment_id = e.id AND l.sync_status != 'SYNCED'
        ORDER BY l.changed_at DESC, l.rowid DESC LIMIT 1
     ) AS pending_status
       FROM equipment e
      WHERE e.is_active = 1
      ORDER BY e.tag_number`,
  );

  return rows.map((e) => ({
    id: e.id,
    tagNumber: e.tag_number,
    name: e.name ?? '',
    unitKey: e.unit_key ?? '',
    location: e.location ?? '',
    status: e.status,
    statusNote: e.status_note ?? '',
    statusChangedBy: e.status_changed_by ?? '',
    statusChangedAt: e.status_changed_at ?? null,
    pendingStatus: e.pending_status ?? null,
  }));
}

export async function getEquipment(id: number): Promise<EquipmentRow | null> {
  const all = await listEquipment();
  return all.find((e) => e.id === id) ?? null;
}

export type EquipmentStatusRow = {
  clientId: string;
  equipmentId: number;
  oldStatus: string;
  newStatus: string;
  description: string;
  changedAt: string;
  operatorName: string;
  shiftTime: string;
  syncStatus: string;
};

/** The status history this handset knows about for one piece of equipment. */
export async function listEquipmentStatus(equipmentId: number, limit = 50): Promise<EquipmentStatusRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM equipment_status_logs WHERE equipment_id = ?
      ORDER BY changed_at DESC, rowid DESC LIMIT ?`,
    equipmentId, limit,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    equipmentId: r.equipment_id,
    oldStatus: r.old_status ?? '',
    newStatus: r.new_status,
    description: r.description,
    changedAt: r.changed_at,
    operatorName: r.operator_name,
    shiftTime: r.shift_time,
    syncStatus: r.sync_status,
  }));
}

export type QueuedEquipmentStatus = {
  equipmentId: number;
  newStatus: EquipmentStatus;
  description: string;
  changedAt: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

/**
 * Queues a status change and moves the cached master row to match.
 *
 * The local master row is written optimistically because the operator is
 * looking at the equipment they just reported on; leaving it showing NORMAL
 * until the next sync would read as the app having ignored them. The server
 * still decides — the next pull overwrites this row either way.
 */
export async function enqueueEquipmentStatus(change: QueuedEquipmentStatus): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();
  const current = await db.getFirstAsync<{ status: string }>(
    'SELECT status FROM equipment WHERE id = ?', change.equipmentId,
  );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO equipment_status_logs
         (client_id, equipment_id, old_status, new_status, description, changed_at,
          operator_name, shift_group, shift_time, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
      clientId, change.equipmentId, current?.status ?? '', change.newStatus,
      change.description, change.changedAt, change.operatorName,
      change.shiftGroup, change.shiftTime, new Date().toISOString(),
    );

    await db.runAsync(
      `UPDATE equipment
          SET status = ?, status_note = ?, status_changed_by = ?, status_changed_at = ?
        WHERE id = ?`,
      change.newStatus, change.description, change.operatorName, change.changedAt,
      change.equipmentId,
    );
  });

  await refreshUnsent();
  return clientId;
}

/** Status changes waiting to go, oldest first. Includes SYNC_ERROR — see pendingReadings. */
export async function pendingEquipmentStatus(): Promise<EquipmentStatusPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM equipment_status_logs WHERE sync_status = 'PENDING_SYNC' ORDER BY created_at`,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    equipmentId: r.equipment_id,
    newStatus: r.new_status,
    description: r.description,
    changedAt: r.changed_at,
    operatorName: r.operator_name,
    shiftGroup: r.shift_group,
    shiftTime: r.shift_time,
  }));
}

/* -------------------------------------------------------- maintenance tasks */

export type TaskRow = {
  id: number;
  equipmentId: number | null;
  equipmentTag: string;
  equipmentName: string;
  title: string;
  description: string;
  status: string;
  progressPct: number;
  dueDate: string | null;
};

/**
 * Tasks from the master cache, unfinished first.
 *
 * Read-only on the phone: tasks are created by an admin and travel down with
 * the pull (doc 07 §7). What the operator adds is progress, which is a separate
 * record type entirely.
 */
export async function getTask(id: number): Promise<TaskRow | null> {
  const all = await listTasks();
  return all.find((t) => t.id === id) ?? null;
}

export async function listTasks(): Promise<TaskRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM tasks
      ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END,
               COALESCE(due_date, '9999'), id`,
  );

  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipment_id ?? null,
    equipmentTag: r.equipment_tag ?? '',
    equipmentName: r.equipment_name ?? '',
    title: r.title,
    description: r.description ?? '',
    status: r.status,
    progressPct: r.progress_pct ?? 0,
    dueDate: r.due_date ?? null,
  }));
}

export type TaskLogRow = {
  clientId: string;
  taskId: number;
  newStatus: string | null;
  progressPct: number | null;
  note: string;
  photoLocalUri: string;
  photoPath: string;
  /** The photo file went missing before it could be uploaded. */
  photoLost: boolean;
  logTime: string;
  operatorName: string;
  shiftTime: string;
  syncStatus: string;
};

/** What this handset knows about one task's progress, newest first. */
export async function listTaskLogs(taskId: number, limit = 50): Promise<TaskLogRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM maintenance_task_logs WHERE task_id = ?
      ORDER BY log_time DESC, rowid DESC LIMIT ?`,
    taskId, limit,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    taskId: r.task_id,
    newStatus: r.new_status ?? null,
    progressPct: r.progress_pct ?? null,
    note: r.note ?? '',
    photoLocalUri: r.photo_local_uri ?? '',
    photoPath: r.photo_path ?? '',
    photoLost: r.photo_lost === 1,
    logTime: r.log_time,
    operatorName: r.operator_name ?? '',
    shiftTime: r.shift_time ?? '',
    syncStatus: r.sync_status,
  }));
}

export type QueuedTaskLog = {
  taskId: number;
  newStatus: string | null;
  progressPct: number | null;
  note: string;
  photoLocalUri: string;
  logTime: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

/**
 * Records progress and moves the cached task to match.
 *
 * The local task row is updated optimistically for the same reason the
 * equipment row is: the operator just reported 60% and is looking at the
 * screen. The server decides in the end -- tasks are master data and the next
 * pull overwrites this row either way (doc 07 §7).
 */
export async function enqueueTaskLog(log: QueuedTaskLog): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO maintenance_task_logs
         (client_id, task_id, new_status, progress_pct, note, photo_local_uri,
          operator_name, shift_group, shift_time, log_time, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
      clientId, log.taskId, log.newStatus, log.progressPct, log.note, log.photoLocalUri,
      log.operatorName, log.shiftGroup, log.shiftTime, log.logTime,
      new Date().toISOString(),
    );

    // COALESCE, not overwrite: a note-only log must not blank the task's status
    // or reset its progress to zero.
    if (log.newStatus !== null || log.progressPct !== null) {
      await db.runAsync(
        `UPDATE tasks SET status = COALESCE(?, status), progress_pct = COALESCE(?, progress_pct)
          WHERE id = ?`,
        log.newStatus, log.progressPct, log.taskId,
      );
    }
  });

  await refreshUnsent();
  return clientId;
}

/** Task progress waiting to go, oldest first. Includes SYNC_ERROR — see pendingReadings. */
export async function pendingTaskLogs(): Promise<TaskLogPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM maintenance_task_logs WHERE sync_status = 'PENDING_SYNC' ORDER BY created_at`,
  );

  return rows.map((r) => ({
    clientId: r.client_id,
    taskId: r.task_id,
    newStatus: r.new_status ?? null,
    progressPct: r.progress_pct ?? null,
    note: r.note ?? '',
    photoPath: r.photo_path ?? '',
    logTime: r.log_time,
    operatorName: r.operator_name ?? '',
    shiftGroup: r.shift_group ?? '',
    shiftTime: r.shift_time ?? '',
  }));
}

/* ------------------------------------------------------------ shift summary */

export type SummaryEntry = {
  key: string;
  at: string;
  kind: 'READING' | 'ACTIVITY' | 'CLEANING' | 'EQUIPMENT' | 'TASK';
  title: string;
  detail: string;
  operatorName: string;
  unsent: boolean;
};

export type ShiftSummary = {
  entries: SummaryEntry[];
  readings: number;
  activities: number;
  cleaning: number;
  unfinishedCleaning: number;
  equipmentChanges: number;
  taskUpdates: number;
};

/**
 * Everything this shift recorded, in the order it happened (doc 02 §4).
 *
 * This is the screen an operator writes the control-room handover from, which
 * is why it draws on the whole shift rather than this handset alone — the pull
 * window fills in what the other two phones did (doc 07 §5). A summary showing
 * a third of the shift, with nothing to say the rest existed, would be worse
 * than no summary at all.
 *
 * The window is the last twelve hours rather than "since midnight" because the
 * malam shift crosses midnight, and a handover that loses everything before
 * 00:00 loses most of the night.
 */
export async function shiftSummary(shiftGroup: string, shiftTime: string): Promise<ShiftSummary> {
  const db = await getDb();
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const readings = await db.getAllAsync<any>(
    `SELECT r.client_id, r.level_mm, r.deviation_mm, r.reading_at, r.operator_name,
            r.sync_status, r.note, t.code AS tank_code
       FROM tank_readings r
       LEFT JOIN tanks t ON t.id = r.tank_id
      WHERE r.shift_group = ? AND r.shift_time = ? AND r.reading_at >= ?`,
    shiftGroup, shiftTime, since,
  );

  const activities = await db.getAllAsync<any>(
    `SELECT client_id, type, description, contractor_name, unit_area, activity_at,
            operator_name, sync_status
       FROM activity_logs
      WHERE shift_group = ? AND shift_time = ? AND activity_at >= ?`,
    shiftGroup, shiftTime, since,
  );

  const cleaning = await db.getAllAsync<any>(
    `SELECT client_id, location, status, note, before_photo_at, created_at,
            operator_name, sync_status
       FROM cleaning_sessions
      WHERE shift_group = ? AND shift_time = ? AND created_at >= ?`,
    shiftGroup, shiftTime, since,
  );

  // A pump that went to NEED_REPAIR mid-shift is exactly what the handover is
  // for, so status changes sit in the same timeline as everything else.
  const equipmentChanges = await db.getAllAsync<any>(
    `SELECT l.client_id, l.old_status, l.new_status, l.description, l.changed_at,
            l.operator_name, l.sync_status, e.tag_number
       FROM equipment_status_logs l
       LEFT JOIN equipment e ON e.id = l.equipment_id
      WHERE l.shift_group = ? AND l.shift_time = ? AND l.changed_at >= ?`,
    shiftGroup, shiftTime, since,
  );

  const taskProgress = await db.getAllAsync<any>(
    `SELECT l.client_id, l.new_status, l.progress_pct, l.note, l.log_time,
            l.operator_name, l.sync_status, t.title
       FROM maintenance_task_logs l
       LEFT JOIN tasks t ON t.id = l.task_id
      WHERE l.shift_group = ? AND l.shift_time = ? AND l.log_time >= ?`,
    shiftGroup, shiftTime, since,
  );

  const entries: SummaryEntry[] = [
    ...readings.map((r) => ({
      key: `r:${r.client_id}`,
      at: r.reading_at,
      kind: 'READING' as const,
      // Full tank code, never abbreviated (doc 02 §1.1).
      title: `${r.tank_code ?? 'Tangki'} — ${Number(r.level_mm).toLocaleString('id-ID')} mm`,
      detail: [
        r.deviation_mm === null ? '' : `selisih DCS ${r.deviation_mm > 0 ? '+' : ''}${r.deviation_mm} mm`,
        r.note,
      ].filter(Boolean).join(' · '),
      operatorName: r.operator_name,
      unsent: r.sync_status !== 'SYNCED',
    })),
    ...activities.map((a) => ({
      key: `a:${a.client_id}`,
      at: a.activity_at,
      kind: 'ACTIVITY' as const,
      title: a.description,
      detail: [
        a.type === 'KONTRAKTOR' ? (a.contractor_name || 'Kontraktor') : 'Operator',
        a.unit_area,
      ].filter(Boolean).join(' · '),
      operatorName: a.operator_name,
      unsent: a.sync_status !== 'SYNCED',
    })),
    ...cleaning.map((c) => ({
      key: `c:${c.client_id}`,
      at: c.before_photo_at ?? c.created_at,
      kind: 'CLEANING' as const,
      title: c.location,
      detail: [
        c.status === 'DONE' ? 'selesai' : 'belum selesai',
        c.note,
      ].filter(Boolean).join(' · '),
      operatorName: c.operator_name,
      unsent: c.sync_status !== 'SYNCED',
    })),
    ...equipmentChanges.map((s) => ({
      key: `e:${s.client_id}`,
      at: s.changed_at,
      kind: 'EQUIPMENT' as const,
      // The tag is never abbreviated, same rule as tank codes (doc 02 §1.1).
      title: `${s.tag_number ?? 'Equipment'} → ${STATUS_LABEL[s.new_status] ?? s.new_status}`,
      detail: [
        s.old_status ? `dari ${STATUS_LABEL[s.old_status] ?? s.old_status}` : '',
        s.description,
      ].filter(Boolean).join(' · '),
      operatorName: s.operator_name,
      unsent: s.sync_status !== 'SYNCED',
    })),
    ...taskProgress.map((l) => ({
      key: `t:${l.client_id}`,
      at: l.log_time,
      kind: 'TASK' as const,
      title: l.title ?? 'Task maintenance',
      detail: [
        l.progress_pct === null ? '' : `${l.progress_pct}%`,
        l.new_status ? (STATUS_LABEL[l.new_status] ?? l.new_status) : '',
        l.note,
      ].filter(Boolean).join(' · '),
      operatorName: l.operator_name,
      unsent: l.sync_status !== 'SYNCED',
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    entries,
    readings: readings.length,
    activities: activities.length,
    cleaning: cleaning.length,
    unfinishedCleaning: cleaning.filter((c) => c.status !== 'DONE').length,
    equipmentChanges: equipmentChanges.length,
    taskUpdates: taskProgress.length,
  };
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

/**
 * Records the fact that a photo file is gone, and lets the record go without it.
 *
 * Only for tables where the photo is corroboration (PHOTO_COLUMNS.required is
 * false). The dead local URI is cleared so the uploader stops retrying a file
 * that will never come back, and photo_lost is set so the record can say why it
 * has no photograph rather than looking like one was never taken.
 */
export async function markPhotoLost(photo: PendingPhoto): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE ${photo.table} SET ${photo.localColumn} = '', photo_lost = 1 WHERE client_id = ?`,
    photo.clientId,
  );
}

/**
 * Puts a rejected record back in the queue at the operator's request.
 *
 * The server's reason is cleared with it: leaving a stale message on a record
 * that is trying again would describe a verdict that no longer applies.
 */
export async function retryRecord(clientId: string): Promise<void> {
  const db = await getDb();
  const table = await tableForClientId(clientId);
  if (!table) return;

  await db.runAsync(
    `UPDATE ${table}
        SET sync_status = 'PENDING_SYNC', error_code = NULL, error_message = NULL
      WHERE client_id = ? AND sync_status = 'SYNC_ERROR'`,
    clientId,
  );
  await refreshUnsent();
}

/**
 * Deletes a record the server refused, at the operator's request.
 *
 * This is the only path in the app that destroys operator input, and it is
 * deliberately narrow: `SYNC_ERROR` only. The server never accepted these, so
 * the phone is the only copy (doc 07 §5) — which is exactly why it is behind a
 * confirmation and why PENDING_SYNC is not eligible. A record still waiting for
 * signal has done nothing wrong.
 *
 * @returns true when a row was actually removed
 */
export async function discardRejected(clientId: string): Promise<boolean> {
  const db = await getDb();
  const table = await tableForClientId(clientId);
  if (!table) return false;

  const guard = `client_id = ? AND sync_status = 'SYNC_ERROR'`;

  // Photos go with the record, same rule as retention: a file nothing refers to
  // is one the operator cannot explain or reach.
  for (const column of PHOTO_COLUMNS.filter((c) => c.table === table)) {
    const rows = await db.getAllAsync<{ local: string }>(
      `SELECT ${column.local} AS local FROM ${table} WHERE ${guard} AND ${column.local} != ''`,
      clientId,
    );
    for (const row of rows) deletePhoto(row.local);
  }

  const result = await db.runAsync(`DELETE FROM ${table} WHERE ${guard}`, clientId);
  await refreshUnsent();
  return result.changes > 0;
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
 *
 * The header badge counts straight from FIELD_TABLES, so a table added there
 * but forgotten here produces exactly that contradiction — the badge says one
 * record is waiting and this screen says nothing is. Adding a record type means
 * adding it in both places.
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

  const equipmentStatus = await db.getAllAsync<any>(
    `SELECT l.client_id, l.sync_status, l.error_message, l.created_at, l.new_status,
            e.tag_number
       FROM equipment_status_logs l
       LEFT JOIN equipment e ON e.id = l.equipment_id
      WHERE l.sync_status != 'SYNCED'`,
  );

  const taskLogs = await db.getAllAsync<any>(
    `SELECT l.client_id, l.sync_status, l.error_message, l.created_at,
            l.progress_pct, l.new_status, t.title
       FROM maintenance_task_logs l
       LEFT JOIN tasks t ON t.id = l.task_id
      WHERE l.sync_status != 'SYNCED'`,
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
    ...equipmentStatus.map((s) => ({
      clientId: s.client_id,
      table: 'equipment_status_logs' as FieldTable,
      // Tag in full, same rule as tank codes (doc 02 §1.1).
      label: `${s.tag_number ?? 'Alat'} — ${STATUS_LABEL[s.new_status] ?? s.new_status}`,
      status: s.sync_status,
      errorMessage: s.error_message,
      createdAt: s.created_at,
    })),
    ...taskLogs.map((l) => ({
      clientId: l.client_id,
      table: 'maintenance_task_logs' as FieldTable,
      label: `${l.title ?? 'Task'} — ${[
        l.progress_pct === null ? '' : `${l.progress_pct}%`,
        l.new_status ? (STATUS_LABEL[l.new_status] ?? l.new_status) : '',
      ].filter(Boolean).join(' · ') || 'catatan'}`,
      status: l.sync_status,
      errorMessage: l.error_message,
      createdAt: l.created_at,
    })),
  ];

  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The phone's rolling window (doc 07 §5). */
export const RETENTION_DAYS = 7;

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
  const cutoff = isoDaysAgo(RETENTION_DAYS);
  let removed = 0;

  for (const table of FIELD_TABLES) {
    const keepUnfinishedCleaning = table === 'cleaning_sessions'
      ? " AND status != 'IN_PROGRESS'"
      : '';

    // A lembar the supervisor has not closed is unfinished work, the same as an
    // IN_PROGRESS cleaning session. Purging its rows and cells at seven days
    // would empty the screen of a round still being walked — and for a handset
    // that has been out of signal that long, there is no pull coming to refill
    // it. Once the lembar is closed or deleted the normal window applies.
    const keepOpenSheets = table === 'task_sheet_rows' || table === 'task_sheet_cells'
      ? ` AND sheet_id NOT IN (SELECT id FROM task_sheets WHERE is_active = 1 AND status = 'OPEN')`
      : '';

    // The cutoff is ISO because created_at is ISO. It used to compare against
    // datetime('now','-7 days'), whose space separator sorts below ISO's 'T',
    // so every row dated on the cutoff day looked newer than the cutoff and
    // survived — a 7-to-8 day window rather than 7. It erred safe, but by
    // accident rather than design.
    const expiring = `sync_status = 'SYNCED'
          AND created_at < ?
          ${keepUnfinishedCleaning}${keepOpenSheets}`;

    // The photos of rows about to go are collected first and deleted with them
    // (doc 07 §5 purges "record + foto"). Leaving them to the orphan sweep
    // would keep them on the phone for the length of its grace period, which
    // exists to protect photos an operator is still working on — not these,
    // which this very statement is orphaning.
    for (const column of PHOTO_COLUMNS.filter((c) => c.table === table)) {
      const rows = await db.getAllAsync<{ local: string }>(
        `SELECT ${column.local} AS local FROM ${table} WHERE ${column.local} != '' AND ${expiring}`,
        cutoff,
      );
      for (const row of rows) deletePhoto(row.local);
    }

    const result = await db.runAsync(`DELETE FROM ${table} WHERE ${expiring}`, cutoff);
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

/* --------------------------------------------------------- lembar tugas

   Rows and cells an operator writes against a lembar the supervisor published
   (doc 05 §4). Both are ordinary queued records — client_id, sync_status — but
   they carry one extra rule between them: a cell may name its row by client_id,
   so rows must be pushed before cells (lib/sync.ts).                          */

export type QueuedSheetRow = {
  sheetId: number;
  label: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

/**
 * Adds a row the supervisor did not define — an operator standing in front of a
 * pump nobody put on the list.
 *
 * `sort_order` is guessed locally as "after everything I can see", and the
 * server overwrites it on acceptance. It only decides where the row sits on
 * this screen until then; proposing a real position would be a guess about a
 * lembar that may have grown while this handset was offline.
 */
export async function enqueueSheetRow(row: QueuedSheetRow): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();

  const last = await db.getFirstAsync<{ last: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) AS last FROM task_sheet_rows WHERE sheet_id = ?',
    row.sheetId,
  );

  await db.runAsync(
    `INSERT INTO task_sheet_rows
       (client_id, sheet_id, label, sort_order, added_by_name, is_active,
        operator_name, shift_group, shift_time, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'PENDING_SYNC', ?)`,
    clientId, row.sheetId, row.label, (last?.last ?? -1) + 1, row.operatorName,
    row.operatorName, row.shiftGroup, row.shiftTime, new Date().toISOString(),
  );

  await refreshUnsent();
  return clientId;
}

export type QueuedSheetCell = {
  sheetId: number;
  rowClientId: string;
  columnId: number;
  valueText?: string;
  valueNumber?: number | null;
  photoLocalUri?: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

/**
 * Fills one cell.
 *
 * Always an insert, never an update — the append-only rule (doc 07 §4). An
 * operator correcting a value writes a second cell and the later `filled_at`
 * wins, which is the same thing the server does with two handsets that filled
 * the same cell offline. The earlier value stays as evidence of what was seen.
 */
export async function enqueueSheetCell(cell: QueuedSheetCell): Promise<string> {
  const db = await getDb();
  const clientId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO task_sheet_cells
       (client_id, sheet_id, row_client_id, column_id, value_text, value_number,
        photo_local_uri, filled_by_name, operator_name, shift_group, shift_time,
        filled_at, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SYNC', ?)`,
    clientId, cell.sheetId, cell.rowClientId, cell.columnId, cell.valueText ?? '',
    cell.valueNumber ?? null, cell.photoLocalUri ?? '', cell.operatorName,
    cell.operatorName, cell.shiftGroup, cell.shiftTime, now, now,
  );

  await refreshUnsent();
  return clientId;
}

export async function pendingSheetRows(): Promise<SheetRowPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM task_sheet_rows WHERE sync_status = 'PENDING_SYNC' ORDER BY created_at`,
  );

  return rows.map((r: any) => ({
    clientId: r.client_id,
    sheetId: r.sheet_id,
    label: r.label,
    operatorName: r.operator_name,
    shiftGroup: r.shift_group,
    shiftTime: r.shift_time,
  }));
}

/**
 * Cells waiting to go, each addressed by whichever row identity exists.
 *
 * `rowId` when the row has a server id, `rowClientId` when it does not — the
 * second form is only resolvable because rows are pushed first in the same
 * batch (lib/sync.js processSync).
 */
export async function pendingSheetCells(): Promise<SheetCellPayload[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT c.*, r.server_id AS row_server_id
       FROM task_sheet_cells c
       JOIN task_sheet_rows r ON r.client_id = c.row_client_id
      WHERE c.sync_status = 'PENDING_SYNC'
      ORDER BY c.created_at`,
  );

  return rows.map((c: any) => ({
    clientId: c.client_id,
    sheetId: c.sheet_id,
    rowId: c.row_server_id ?? null,
    rowClientId: c.row_server_id ? null : c.row_client_id,
    columnId: c.column_id,
    valueText: c.value_text ?? '',
    valueNumber: c.value_number ?? null,
    ...(c.photo_path ? { photoPath: c.photo_path } : {}),
    filledAt: c.filled_at,
    operatorName: c.operator_name,
    shiftGroup: c.shift_group,
    shiftTime: c.shift_time,
  }));
}
