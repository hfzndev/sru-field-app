import * as SecureStore from 'expo-secure-store';
import { LoginResponse } from './api';
import { ensureInstallId, getDb, getMeta, setMeta } from './db';

/**
 * The signed-in shift, and the token that proves it.
 *
 * The token lives in SecureStore, never in SQLite (doc 08 §2.3): the database
 * is a plain file that ends up in backups and bug reports, and a device token
 * grants write access to the shift's records until an admin revokes it.
 *
 * Everything else — which shift, which slot, whose name — is ordinary state and
 * lives in the meta table alongside the records it attributes.
 */

const TOKEN_KEY = 'sru.deviceToken';

export type Session = {
  shiftCode: string;      // SHIFT_A
  shiftName: string;      // 'Shift A' — what lands on each record
  shiftTime: string;      // pagi | sore | malam
  operatorName: string;
  deviceName: string;
};

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // A wiped keystore (restored backup, changed lock screen) reads as signed
    // out rather than crashing. The operator logs in again; nothing queued is
    // lost, because the queue lives in SQLite.
    return null;
  }
}

async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Nothing to do — the token is already unreachable.
  }
}

/**
 * A name the admin Devices tab can tell three identical handsets apart by
 * (doc 06 §4). Derived from the install id so it survives logout and stays
 * stable for the life of the install.
 */
export async function deviceName(): Promise<string> {
  const existing = await getMeta('deviceName');
  if (existing) return existing;

  const installId = await ensureInstallId();
  const name = `HP-${installId.slice(0, 4).toUpperCase()}`;
  await setMeta('deviceName', name);
  return name;
}

/**
 * Stores the token and caches the bootstrap locally.
 *
 * Order matters: the cache is written before the token. If the app dies
 * midway, a phone with no token simply asks the operator to log in again —
 * whereas a phone holding a token with no master data would look signed in and
 * then be unable to show a single tank.
 */
export async function startSession(bootstrap: LoginResponse): Promise<void> {
  await cacheBootstrap(bootstrap);
  await setMeta('shiftCode', bootstrap.shiftGroup.code);
  await setMeta('shiftName', bootstrap.shiftGroup.displayName);
  await setMeta('dataVersion', String(bootstrap.dataVersion));
  await setMeta('lastLoginAt', new Date().toISOString());
  await setToken(bootstrap.token);
}

/** Records the shift slot and operator chosen on the Mulai Shift screen. */
export async function setShiftContext(shiftTime: string, operatorName: string): Promise<void> {
  await setMeta('shiftTime', shiftTime);
  await setMeta('operatorName', operatorName);
}

export async function getSession(): Promise<Session | null> {
  const token = await getToken();
  if (!token) return null;

  const shiftCode = await getMeta('shiftCode');
  if (!shiftCode) return null;

  return {
    shiftCode,
    shiftName: (await getMeta('shiftName')) ?? shiftCode,
    shiftTime: (await getMeta('shiftTime')) ?? '',
    operatorName: (await getMeta('operatorName')) ?? '',
    deviceName: (await getMeta('deviceName')) ?? '',
  };
}

/** True once the operator has picked a slot and a name (doc 03 §3.1). */
export async function hasShiftContext(): Promise<boolean> {
  const session = await getSession();
  return !!session?.shiftTime && !!session.operatorName;
}

/**
 * Signs out. Clears the token and the shift context but leaves every field
 * record where it is — signing out must never be the reason a shift's work
 * disappears. Callers warn about anything unsent before calling this.
 */
export async function endSession(): Promise<void> {
  await clearToken();
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM meta WHERE key IN ('shiftCode','shiftName','shiftTime','operatorName')",
  );
}

/* --------------------------------------------------------- bootstrap cache */

/**
 * Writes the login bootstrap into local tables so the app works with no signal.
 *
 * Replace-in-place per table: the server's list is the truth, and a row it no
 * longer sends is one the operator should stop seeing. Field records are never
 * touched here — only reference data.
 */
export async function cacheBootstrap(bootstrap: LoginResponse): Promise<void> {
  const db = await getDb();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM tanks');
    for (const t of bootstrap.tanks) {
      await txn.runAsync(
        'INSERT INTO tanks (id, code, name, height_mm, dcs_tag, is_active) VALUES (?, ?, ?, ?, ?, 1)',
        t.id, t.code, t.name ?? '', t.heightMm, t.dcsTag ?? '',
      );
    }

    await txn.runAsync('DELETE FROM equipment');
    for (const e of bootstrap.equipment) {
      await txn.runAsync(
        'INSERT INTO equipment (id, tag_number, name, status, is_active) VALUES (?, ?, ?, ?, 1)',
        e.id, e.tagNumber, e.name, e.status,
      );
    }

    await txn.runAsync('DELETE FROM contractors');
    for (const c of bootstrap.contractors) {
      await txn.runAsync('INSERT INTO contractors (id, name, is_active) VALUES (?, ?, 1)', c.id, c.name);
    }

    // Crew arrives as bare names (doc 06 §4), so the local id is positional.
    await txn.runAsync('DELETE FROM crew');
    for (const [index, name] of bootstrap.crew.entries()) {
      await txn.runAsync(
        'INSERT INTO crew (id, name, sort_order, is_active) VALUES (?, ?, ?, 1)',
        index + 1, name, index,
      );
    }

    await txn.runAsync('DELETE FROM tasks');
    for (const t of bootstrap.tasks) {
      await txn.runAsync(
        `INSERT INTO tasks (id, equipment_id, equipment_tag, equipment_name, title, description, status, progress_pct, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.id, t.equipmentId, t.equipmentTag ?? '', t.equipmentName ?? '',
        t.title, t.description ?? '', t.status, t.progressPct, t.dueDate ?? null,
      );
    }

    // The deviation cache is what makes the tape suggestion work offline
    // (doc 04 §4). Without it the suggestion silently degrades to raw DCS.
    await txn.runAsync('DELETE FROM tank_deviation');
    for (const [tankId, samples] of Object.entries(bootstrap.tankDeviation ?? {})) {
      for (const s of samples) {
        await txn.runAsync(
          'INSERT INTO tank_deviation (tank_id, level_mm, dcs_level_mm, reading_at) VALUES (?, ?, ?, ?)',
          Number(tankId), s.levelMm, s.dcsLevelMm, s.readingAt,
        );
      }
    }
  });
}
