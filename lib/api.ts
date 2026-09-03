import { API_URL, APP_VERSION, REQUEST_TIMEOUT_MS } from './config';

/**
 * Typed client for the field API (doc 06).
 *
 * The distinction that matters here is between "no signal" and "the server said
 * no". The first is the expected condition in the plant and means retry later;
 * the second means something is actually wrong and the operator needs telling.
 * Collapsing them into one error type would make the app either cry wolf in
 * every dead zone or stay quiet about real failures.
 */

/** No connection, DNS failure, or timeout — retryable, not the operator's fault. */
export class OfflineError extends Error {
  constructor(message = 'Tidak ada koneksi ke server') {
    super(message);
    this.name = 'OfflineError';
  }
}

/** The server responded and refused. Carries the code from doc 06 §1. */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    // fetch rejects for DNS, refused connections and aborts alike. From the
    // phone's side these are the same thing: the server could not be reached.
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Terjadi kesalahan di server',
      error?.details,
    );
  }

  return payload as T;
}

/* ------------------------------------------------------------------- types */

export type TankDto = { id: number; code: string; name?: string; heightMm: number; dcsTag?: string };
export type EquipmentDto = { id: number; tagNumber: string; name: string; status: string };
export type ContractorDto = { id: number; name: string };
export type TaskDto = {
  id: number; equipmentId: number; equipmentTag?: string; equipmentName?: string;
  title: string; description?: string; status: string; progressPct: number; dueDate?: string | null;
};
export type DeviationDto = { levelMm: number; dcsLevelMm: number; readingAt: string };

/** The login response doubles as the offline bootstrap (doc 06 §4). */
export type LoginResponse = {
  token: string;
  shiftGroup: { code: string; displayName: string };
  crew: string[];
  tanks: TankDto[];
  equipment: EquipmentDto[];
  contractors: ContractorDto[];
  tasks: TaskDto[];
  tankDeviation: Record<string, DeviationDto[]>;
  dataVersion: number;
};

/* ---------------------------------------------------------------- endpoints */

/**
 * Signs in and returns everything the phone needs for the shift.
 *
 * This is the one call that requires signal (doc 03 §3.1). It is answered with
 * the full bootstrap rather than a bare token precisely so that it is the only
 * one — an operator walks out of the control room with the master data already
 * on the handset.
 */
export function login(
  username: string,
  password: string,
  deviceName: string,
): Promise<LoginResponse> {
  return request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password, deviceName, appVersion: APP_VERSION },
  });
}

/** Ends the session server-side. Best-effort: logout must work offline too. */
export function revoke(token: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/revoke', { method: 'POST', token });
}

/* --------------------------------------------------------------- sync/pull */

export type ReadingPayload = {
  clientId: string;
  tankId: number;
  dcsLevelMm: number | null;
  tapeLengthMm: number;
  bandulSulfurMm: number;
  attempts: number;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
  note: string;
  photoPath?: string;
  readingAt: string;
};

export type SyncPayload = {
  readings?: ReadingPayload[];
  cleaning?: unknown[];
  activities?: unknown[];
  taskLogs?: unknown[];
};

export type SyncAck = {
  clientId: string;
  serverId: number;
  levelMm?: number;
  deviationMm?: number | null;
  updated?: boolean;
};

export type SyncResponse = {
  acked: SyncAck[];
  duplicates: { clientId: string; serverId: number | null }[];
  errors?: { clientId: string; error: { code: string; message: string } }[];
  serverTime: string;
};

/**
 * Pushes queued records (doc 06 §5).
 *
 * Safe to call repeatedly by construction: client_id makes a replayed batch
 * return `duplicates` rather than inserting twice.
 */
export function sync(token: string, payload: SyncPayload): Promise<SyncResponse> {
  return request<SyncResponse>('/api/sync', { method: 'POST', token, body: payload });
}

/**
 * A reading from the server's 7-day window.
 *
 * Stored locally rather than only read, because three handsets share a shift
 * (doc 02 §1.3): history assembled from this device alone would show roughly a
 * third of the work, and a phone swapped in mid-rotation would show none of it
 * (doc 07 §5).
 */
export type RecentReading = {
  id: number;
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
  photoPath: string;
  note: string;
  readingAt: string;
  receivedAt: string;
};

export type PullResponse = {
  dataVersion: number;
  master: {
    tanks: (TankDto & { isActive: boolean })[];
    equipment: (EquipmentDto & { isActive: boolean })[];
    contractors: (ContractorDto & { isActive: boolean })[];
    tasks: TaskDto[];
    crew: { id: number; name: string; sortOrder: number; isActive: boolean }[];
  };
  recent: {
    readings: RecentReading[];
    activities: unknown[];
    cleaning: unknown[];
    taskLogs: unknown[];
  };
  serverTime: string;
};

/** Delta master plus this shift's last 7 days (doc 06 §5). */
export function pull(token: string, since: number): Promise<PullResponse> {
  return request<PullResponse>(`/api/pull?since=${encodeURIComponent(since)}`, { token });
}

export function health(): Promise<{ status: string; database: string }> {
  return request<{ status: string; database: string }>('/api/health', { timeoutMs: 5000 });
}

export function serverVersion(): Promise<{ version: string; commit: string; buildDate: string }> {
  return request<{ version: string; commit: string; buildDate: string }>('/api/version', { timeoutMs: 5000 });
}
