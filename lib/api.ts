import { File, UploadType } from 'expo-file-system';
import { API_URL, APP_VERSION, PHOTO_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './config';

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

/* ------------------------------------------------------------------- photos */

/**
 * Uploads one photo and returns the path the server filed it under.
 *
 * Photos go up *before* the record that references them (doc 07 §2), so the
 * path is already in hand when the record is pushed and no follow-up call is
 * needed to complete it.
 *
 * Not routed through `request()`: this body is multipart, not JSON, and the
 * Content-Type header must be left alone so the runtime can attach the
 * boundary it generated.
 */
export async function uploadPhoto(token: string, localUri: string): Promise<{ path: string }> {
  const file = new File(localUri);
  if (!file.exists) {
    // The file is gone — evicted, swept, or never written. Reported as a server
    // refusal rather than as "offline", because retrying forever will not bring
    // it back and the record needs to stop waiting on it.
    throw new ApiError(0, 'PHOTO_MISSING', 'File foto tidak ditemukan di HP');
  }

  const controller = new AbortController();
  // Photos are far larger than a sync payload and go over the same bad link, so
  // they get their own, longer budget rather than the shared request timeout.
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);

  let result: { status: number; body: string };
  try {
    // Not fetch + FormData: React Native's fetch no longer uploads the legacy
    // `{uri, name, type}` shape, and fails in a way indistinguishable from
    // having no signal. This streams the file from native code instead.
    result = await file.upload(`${API_URL}/api/upload`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }

  let payload: any = null;
  try {
    payload = JSON.parse(result.body);
  } catch {
    payload = null;
  }

  if (result.status < 200 || result.status >= 300) {
    const error = payload?.error;
    throw new ApiError(
      result.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Foto gagal diunggah',
      error?.details,
    );
  }

  if (!payload?.path) {
    throw new ApiError(result.status, 'UNKNOWN', 'Server tidak mengembalikan path foto');
  }

  return { path: payload.path };
}

/**
 * Where to fetch a photo that lives on the server — one taken by another
 * handset, or one this phone has already purged (doc 07 §5).
 *
 * The endpoint requires the device token, so callers must pass it as a header
 * on the image request; the path alone is not enough to open it.
 */
export function photoSource(token: string, path: string): { uri: string; headers: Record<string, string> } {
  return {
    uri: `${API_URL}/api/photo?path=${encodeURIComponent(path)}`,
    headers: { Authorization: `Bearer ${token}` },
  };
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

export type ActivityPayload = {
  clientId: string;
  type: 'OPERATOR' | 'KONTRAKTOR';
  description: string;
  contractorName: string;
  unitArea: string;
  activityAt: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

export type CleaningPayload = {
  clientId: string;
  location: string;
  note: string;
  beforePhoto: string;
  beforePhotoAt: string | null;
  afterPhoto: string;
  afterPhotoAt: string | null;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
};

export type SyncPayload = {
  readings?: ReadingPayload[];
  activities?: ActivityPayload[];
  cleaning?: CleaningPayload[];
  taskLogs?: unknown[];
};

export type SyncAck = {
  clientId: string;
  serverId: number;
  /** Set when the server updated an existing cleaning session rather than inserting (doc 07 §4). */
  updated?: boolean;
  levelMm?: number;
  deviationMm?: number | null;
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

/**
 * The shift's own records from the last seven days, as the server holds them.
 *
 * Three handsets share a shift, so this is most of what any one of them knows.
 * A device that stored only its own work would show a third of the shift in the
 * summary and give no sign that the rest existed.
 */
export type RecentActivity = {
  id: number;
  clientId: string;
  type: string;
  description: string;
  contractorName: string;
  unitArea: string;
  activityAt: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
  receivedAt: string;
};

export type RecentCleaning = {
  id: number;
  clientId: string;
  location: string;
  note: string;
  status: string;
  operatorName: string;
  shiftGroup: string;
  shiftTime: string;
  beforePhoto: string;
  beforePhotoAt: string | null;
  afterPhoto: string;
  afterPhotoAt: string | null;
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
    activities: RecentActivity[];
    cleaning: RecentCleaning[];
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
