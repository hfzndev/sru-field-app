import * as Network from 'expo-network';
import { ApiError, OfflineError, pull as apiPull, sync as apiSync, uploadPhoto } from './api';
import { getDb, getMetaNumber, setMeta } from './db';
import {
  markError, markPhotoUploaded, markSynced, pendingActivities, pendingCleaning,
  pendingEquipmentStatus, pendingTaskLogs,
  pendingPhotos, pendingReadings, runRetention,
} from './queue';
import { refreshUnsent } from './status';
import { getToken } from './session';

/**
 * One sync cycle (doc 07 §2).
 *
 * The order is not arbitrary: push before pull, so a record the operator made
 * is on the server before the phone accepts anything back; retention last, so a
 * failed push never triggers a delete.
 *
 * Nothing here throws for an expected condition. No signal is where these
 * handsets spend most of their time, and an exception for the normal case would
 * make every caller defensive.
 */

export type SyncOutcome = {
  ok: boolean;
  offline: boolean;
  photos: number;
  pushed: number;
  duplicates: number;
  rejected: number;
  pulled: number;
  purged: number;
  message: string;
  /**
   * Why the pull half failed, when it did.
   *
   * Push and pull fail independently, and a failed pull used to be a
   * console.warn and nothing else. That is the worst shape this bug can take:
   * records keep going up, so every visible signal says the app is fine, while
   * master data quietly stops arriving — a tank an admin added, a piece of
   * equipment another shift put on repair. It is not an error for the push, so
   * it does not clear `ok`; it is shown alongside.
   */
  pullError?: string;
};

let inFlight: Promise<SyncOutcome> | null = null;

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    // isInternetReachable is undefined on some devices; a connected interface
    // is the best signal available, and the request itself is the real test.
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/**
 * Runs a cycle, or joins the one already running.
 *
 * Sync is triggered from three places — app open, connectivity returning, and
 * the operator's own button — and they overlap constantly. Two concurrent
 * pushes would send the same records twice; the server would dedupe them, but
 * the phone would then be reconciling acks against a batch it no longer knows
 * the shape of.
 */
export function runSync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = execute().finally(() => { inFlight = null; });
  return inFlight;
}

async function execute(): Promise<SyncOutcome> {
  const base: SyncOutcome = {
    ok: false, offline: false, photos: 0, pushed: 0, duplicates: 0,
    rejected: 0, pulled: 0, purged: 0, message: '',
  };

  const token = await getToken();
  if (!token) return { ...base, message: 'Belum login' };

  if (!(await isOnline())) {
    return { ...base, offline: true, message: 'Tidak ada koneksi — catatan tetap tersimpan di HP' };
  }

  // Photos first (doc 07 §2 step 2). The path has to be on the record before it
  // is pushed, or the server stores a record pointing at nothing and there is
  // no second call to complete it.
  const photos = await pendingPhotos();
  const blocked = new Set<string>();
  let uploaded = 0;

  for (const photo of photos) {
    try {
      const { path } = await uploadPhoto(token, photo.localUri);
      await markPhotoUploaded(photo, path);
      uploaded += 1;
    } catch (err) {
      // The record waits for the next cycle rather than going up without its
      // photograph. A cleaning session whose evidence never arrives is worse
      // than one that is still marked unsent — the second is visibly unfinished.
      blocked.add(photo.clientId);
      if (!(err instanceof OfflineError)) {
        console.warn('photo upload failed:', err);
      }
    }
  }

  const readings = (await pendingReadings()).filter((r) => !blocked.has(r.clientId));
  const activities = (await pendingActivities()).filter((a) => !blocked.has(a.clientId));
  const cleaning = (await pendingCleaning()).filter((c) => !blocked.has(c.clientId));
  // No photo on a status change, so nothing can hold one back.
  const equipmentStatus = await pendingEquipmentStatus();
  const taskLogs = (await pendingTaskLogs()).filter((l) => !blocked.has(l.clientId));

  let pushed = 0;
  let duplicates = 0;
  let rejected = 0;

  if (readings.length > 0 || activities.length > 0 || cleaning.length > 0
      || equipmentStatus.length > 0 || taskLogs.length > 0) {
    try {
      const response = await apiSync(token, {
        readings, activities, cleaning, equipmentStatus, taskLogs,
      });

      // Acks are applied one at a time. If the app dies partway through, the
      // records already marked stay marked and the rest are simply retried —
      // scenario S8. Nothing is lost either way.
      for (const ack of response.acked) {
        await markSynced(ack.clientId, ack.serverId, {
          levelMm: ack.levelMm,
          deviationMm: ack.deviationMm,
        });
        pushed += 1;
      }

      // A duplicate means the server already has it — the safe outcome of a
      // retry, not a failure (doc 07 §3).
      for (const dup of response.duplicates) {
        await markSynced(dup.clientId, dup.serverId);
        duplicates += 1;
      }

      for (const failure of response.errors ?? []) {
        await markError(failure.clientId, failure.error.code, failure.error.message);
        rejected += 1;
      }
    } catch (err) {
      if (err instanceof OfflineError) {
        return { ...base, offline: true, message: 'Koneksi terputus saat mengirim — akan dicoba lagi' };
      }
      if (err instanceof ApiError) {
        // 401 means the token was revoked or expired. The queue is untouched;
        // the operator logs in again and it goes on the next cycle.
        return { ...base, message: err.status === 401 ? 'Sesi berakhir — login ulang' : err.message };
      }
      return { ...base, message: 'Gagal mengirim. Coba lagi.' };
    }
  }

  // Pull runs even when there was nothing to push: master data changes on the
  // admin side and the phone needs it regardless.
  let pulled = 0;
  let pullError: string | undefined;
  try {
    const since = await getMetaNumber('dataVersion', 0);
    const response = await apiPull(token, since);
    pulled = await applyPull(response);
    // Only after applyPull returns. Advancing the cursor past rows that failed
    // to land would make them invisible forever — the next pull would ask for
    // changes newer than data this phone never received.
    await setMeta('dataVersion', String(response.dataVersion));
  } catch (err) {
    // Offline is the normal case out in the plant and says nothing new: the
    // push already reported it.
    if (!(err instanceof OfflineError)) {
      pullError = err instanceof Error ? err.message : String(err);
      console.warn('pull failed:', err);
    }
  }

  const purged = await runRetention();
  await setMeta('lastSyncAt', new Date().toISOString());
  await refreshUnsent();

  return {
    ok: true,
    offline: false,
    photos: uploaded,
    pushed, duplicates, rejected, pulled, purged, pullError,
    message: summarise(pushed, duplicates, rejected, blocked.size),
  };
}

function summarise(pushed: number, duplicates: number, rejected: number, waiting: number): string {
  if (pushed === 0 && duplicates === 0 && rejected === 0 && waiting === 0) {
    return 'Tidak ada yang perlu dikirim';
  }

  const parts: string[] = [];
  if (pushed) parts.push(`${pushed} terkirim`);
  if (duplicates) parts.push(`${duplicates} sudah ada di server`);
  if (rejected) parts.push(`${rejected} ditolak`);
  // Named rather than folded into "belum terkirim": the operator should know
  // the hold-up is the photo, not the record.
  if (waiting) parts.push(`${waiting} menunggu foto terkirim`);
  return parts.join(' · ');
}

/**
 * Applies a pull: master data upserted, the shift's 7-day window stored, and
 * the deviation cache rebuilt.
 *
 * The window is written into tank_readings as SYNCED rows, which is what makes
 * history correct: three handsets share a shift, so a device that only knew its
 * own records would show a third of the work, and one swapped in mid-rotation
 * would show none (doc 07 §5).
 */
async function applyPull(response: Awaited<ReturnType<typeof apiPull>>): Promise<number> {
  const db = await getDb();
  const { master, recent } = response;
  let rows = 0;

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const tank of master.tanks ?? []) {
      await txn.runAsync(
        `INSERT INTO tanks (id, code, name, height_mm, dcs_tag, is_active) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code = excluded.code, name = excluded.name, height_mm = excluded.height_mm,
           dcs_tag = excluded.dcs_tag, is_active = excluded.is_active`,
        tank.id, tank.code, tank.name ?? '', tank.heightMm, tank.dcsTag ?? '', tank.isActive ? 1 : 0,
      );
      rows += 1;
    }

    // The reason comes down with the status. The server's copy wins outright,
    // including over a change this handset made optimistically: by the time a
    // row is in this delta the server has already decided what it holds.
    for (const item of master.equipment ?? []) {
      await txn.runAsync(
        `INSERT INTO equipment
           (id, tag_number, name, unit_key, location, status, status_note,
            status_changed_by, status_changed_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tag_number = excluded.tag_number, name = excluded.name,
           unit_key = excluded.unit_key, location = excluded.location,
           status = excluded.status, status_note = excluded.status_note,
           status_changed_by = excluded.status_changed_by,
           status_changed_at = excluded.status_changed_at,
           is_active = excluded.is_active`,
        item.id, item.tagNumber, item.name, item.unitKey ?? '', item.location ?? '',
        item.status, item.statusNote ?? '', item.statusChangedBy ?? '',
        item.statusChangedAt ?? null, item.isActive ? 1 : 0,
      );
      rows += 1;
    }

    for (const c of master.contractors ?? []) {
      await txn.runAsync(
        `INSERT INTO contractors (id, name, is_active) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_active = excluded.is_active`,
        c.id, c.name, c.isActive ? 1 : 0,
      );
      rows += 1;
    }

    for (const member of master.crew ?? []) {
      await txn.runAsync(
        `INSERT INTO crew (id, name, sort_order, is_active) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, sort_order = excluded.sort_order, is_active = excluded.is_active`,
        member.id, member.name, member.sortOrder, member.isActive ? 1 : 0,
      );
      rows += 1;
    }

    for (const task of master.tasks ?? []) {
      await txn.runAsync(
        `INSERT INTO tasks (id, equipment_id, equipment_tag, equipment_name, title, description, status, progress_pct, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description, status = excluded.status,
           progress_pct = excluded.progress_pct, due_date = excluded.due_date`,
        task.id, task.equipmentId, task.equipmentTag ?? '', task.equipmentName ?? '',
        task.title, task.description ?? '', task.status, task.progressPct, task.dueDate ?? null,
      );
      rows += 1;
    }

    // ON CONFLICT DO NOTHING, never an upsert: a client_id already here belongs
    // to a record this device created, which may still be PENDING or carry a
    // rejection the operator has yet to fix. The server's copy must not
    // overwrite that local state.
    for (const r of recent.readings ?? []) {
      await txn.runAsync(
        `INSERT INTO tank_readings
           (client_id, tank_id, dcs_level_mm, tape_length_mm, bandul_sulfur_mm, level_mm, deviation_mm,
            attempts, operator_name, shift_group, shift_time, note, photo_path,
            reading_at, sync_status, server_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
        r.clientId, r.tankId, r.dcsLevelMm, r.tapeLengthMm, r.bandulSulfurMm,
        r.levelMm, r.deviationMm, r.attempts, r.operatorName, r.shiftGroup,
        r.shiftTime, r.note ?? '', r.photoPath ?? '', r.readingAt, r.id,
        // created_at drives retention, so it tracks when the server received
        // the record — not now, or a pulled record would restart its 7 days on
        // every device that ever sees it.
        r.receivedAt ?? r.readingAt,
      );
      rows += 1;
    }

    // Same ON CONFLICT DO NOTHING rule as readings, and for the same reason:
    // a client_id already here belongs to a record this device created, which
    // may still be PENDING or carry a rejection the operator has yet to fix.
    for (const a of recent.activities ?? []) {
      await txn.runAsync(
        `INSERT INTO activity_logs
           (client_id, type, description, contractor_name, unit_area, activity_at,
            operator_name, shift_group, shift_time, sync_status, server_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
        a.clientId, a.type, a.description, a.contractorName, a.unitArea, a.activityAt,
        a.operatorName, a.shiftGroup, a.shiftTime, a.id, a.receivedAt ?? a.activityAt,
      );
      rows += 1;
    }

    // Cleaning carries no local photo paths here on purpose. These rows describe
    // sessions from the other handsets; their photographs live on the server and
    // are fetched when online (doc 07 §5). Writing a local uri we do not have
    // would make the retention sweep think a file went missing.
    for (const c of recent.cleaning ?? []) {
      await txn.runAsync(
        `INSERT INTO cleaning_sessions
           (client_id, location, note, status, operator_name, shift_group, shift_time,
            before_photo, before_photo_at, after_photo, after_photo_at,
            sync_status, server_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
        c.clientId, c.location, c.note, c.status, c.operatorName, c.shiftGroup, c.shiftTime,
        c.beforePhoto, c.beforePhotoAt, c.afterPhoto, c.afterPhotoAt,
        c.id, c.receivedAt ?? c.beforePhotoAt,
      );
      rows += 1;
    }

    // Task progress from the shift's window, so a handset swapped in mid-shift
    // sees what the others reported. Same ON CONFLICT DO NOTHING rule.
    for (const l of recent.taskLogs ?? []) {
      await txn.runAsync(
        `INSERT INTO maintenance_task_logs
           (client_id, task_id, new_status, progress_pct, note, photo_path,
            operator_name, shift_group, shift_time, log_time, sync_status, server_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
        l.clientId, l.taskId, l.newStatus, l.progressPct, l.note ?? '', l.photoPath ?? '',
        l.operatorName ?? '', l.shiftGroup, l.shiftTime, l.logTime, l.id,
        l.receivedAt ?? l.logTime,
      );
      rows += 1;
    }

    // Same ON CONFLICT DO NOTHING rule again: a client_id already here is this
    // handset's own record, and the server's copy must not overwrite a local
    // rejection the operator still has to fix. Rows from the server carry no
    // client_id at all when an admin wrote them, so they are skipped entirely —
    // the current reason reaches this phone on the equipment row instead.
    for (const s of recent.equipmentStatus ?? []) {
      if (!s.clientId) continue;
      await txn.runAsync(
        `INSERT INTO equipment_status_logs
           (client_id, equipment_id, old_status, new_status, description, changed_at,
            operator_name, shift_group, shift_time, sync_status, server_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)
         ON CONFLICT(client_id) DO NOTHING`,
        s.clientId, s.equipmentId, s.oldStatus ?? '', s.newStatus, s.description,
        s.changedAt, s.operatorName, s.shiftGroup, s.shiftTime, s.id,
        s.receivedAt ?? s.changedAt,
      );
      rows += 1;
    }

    // The deviation cache is rebuilt from what the server returned, so the tape
    // suggestion reflects readings taken on the other handsets too — three
    // phones share a shift, and drift is a property of the tank, not the device.
    const withDcs = (recent.readings ?? []).filter((r) => r.dcsLevelMm !== null);
    if (withDcs.length > 0) {
      await txn.runAsync('DELETE FROM tank_deviation');
      for (const r of withDcs) {
        await txn.runAsync(
          'INSERT INTO tank_deviation (tank_id, level_mm, dcs_level_mm, reading_at) VALUES (?, ?, ?, ?)',
          r.tankId, r.levelMm, r.dcsLevelMm, r.readingAt,
        );
      }
    }
  });

  return rows;
}

/** Most recent deviation samples for a tank, newest first (doc 02 §2.2). */
export async function deviationSamples(
  tankId: number,
  limit = 5,
): Promise<{ levelMm: number; dcsLevelMm: number }[]> {
  const db = await getDb();
  return db.getAllAsync<{ levelMm: number; dcsLevelMm: number }>(
    `SELECT level_mm AS levelMm, dcs_level_mm AS dcsLevelMm
       FROM tank_deviation WHERE tank_id = ?
      ORDER BY reading_at DESC LIMIT ?`,
    tankId, limit,
  );
}
