import * as Network from 'expo-network';
import { ApiError, OfflineError, pull as apiPull, sync as apiSync } from './api';
import { getDb, getMetaNumber, setMeta } from './db';
import { markError, markSynced, pendingReadings, runRetention } from './queue';
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
  pushed: number;
  duplicates: number;
  rejected: number;
  pulled: number;
  purged: number;
  message: string;
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
    ok: false, offline: false, pushed: 0, duplicates: 0,
    rejected: 0, pulled: 0, purged: 0, message: '',
  };

  const token = await getToken();
  if (!token) return { ...base, message: 'Belum login' };

  if (!(await isOnline())) {
    return { ...base, offline: true, message: 'Tidak ada koneksi — catatan tetap tersimpan di HP' };
  }

  const readings = await pendingReadings();

  let pushed = 0;
  let duplicates = 0;
  let rejected = 0;

  if (readings.length > 0) {
    try {
      const response = await apiSync(token, { readings });

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
  try {
    const since = await getMetaNumber('dataVersion', 0);
    const response = await apiPull(token, since);
    pulled = await applyPull(response);
    await setMeta('dataVersion', String(response.dataVersion));
  } catch (err) {
    if (!(err instanceof OfflineError)) {
      // A failed pull is not a failed sync — the push already landed, which is
      // the half that matters.
      console.warn('pull failed:', err);
    }
  }

  const purged = await runRetention();
  await setMeta('lastSyncAt', new Date().toISOString());

  return {
    ok: true,
    offline: false,
    pushed, duplicates, rejected, pulled, purged,
    message: summarise(pushed, duplicates, rejected),
  };
}

function summarise(pushed: number, duplicates: number, rejected: number): string {
  if (pushed === 0 && duplicates === 0 && rejected === 0) return 'Tidak ada yang perlu dikirim';

  const parts: string[] = [];
  if (pushed) parts.push(`${pushed} terkirim`);
  if (duplicates) parts.push(`${duplicates} sudah ada di server`);
  if (rejected) parts.push(`${rejected} ditolak`);
  return parts.join(' · ');
}

/**
 * Applies a pull: master data replaced, deviation cache refreshed.
 *
 * Field records from `recent` are not written back. They are already on the
 * server, and re-inserting them would only give the phone rows it cannot act
 * on — the 7-day window is for reading history (doc 07 §5), which task 7 shows
 * from what this device recorded plus what the pull returns for display.
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

    for (const item of master.equipment ?? []) {
      await txn.runAsync(
        `INSERT INTO equipment (id, tag_number, name, status, is_active) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tag_number = excluded.tag_number, name = excluded.name,
           status = excluded.status, is_active = excluded.is_active`,
        item.id, item.tagNumber, item.name, item.status, item.isActive ? 1 : 0,
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
