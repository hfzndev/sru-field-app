/**
 * Display formatting.
 *
 * Storage and the wire are ISO-8601 UTC (doc 06 §1); the screen is always WIB
 * (doc 03 §1). The timezone is pinned rather than taken from the device: a
 * handset with its clock set wrong would otherwise relabel every record, and
 * these phones are shared between shifts with nobody checking their settings.
 */

const WIB = 'Asia/Jakarta';

function fmt(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: WIB, ...options });
}

const dateTimeFmt = fmt({
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${dateTimeFmt.format(d)} WIB`;
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${timeFmt.format(d)} WIB`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : dateFmt.format(d);
}

export function relative(iso?: string | null): string {
  if (!iso) return 'belum pernah';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'baru saja';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam lalu`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} hari lalu`;
  return formatDate(iso);
}

/** Millimetres with Indonesian separators — levels run to four digits. */
export function mm(value?: number | null): string {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('id-ID')} mm`;
}

/** Deviation always carries its sign; the direction is the whole point. */
export function deviation(value?: number | null): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toLocaleString('id-ID')} mm`;
}

/**
 * Which shift slot the current WIB time falls in (doc 03 §3.1): pagi 08–16,
 * sore 16–24, malam 00–08. Only a suggestion — the operator can override,
 * because someone starting a night shift at 23:50 is still on malam.
 */
export function suggestShiftTime(now: Date = new Date()): 'pagi' | 'sore' | 'malam' {
  const wibHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: WIB, hour: '2-digit', hour12: false }).format(now),
  );
  if (wibHour >= 8 && wibHour < 16) return 'pagi';
  if (wibHour >= 16) return 'sore';
  return 'malam';
}

/**
 * ISO cutoff for "n days before now" — for comparing against stored columns.
 *
 * Every timestamp column on this phone holds ISO (created_at, reading_at,
 * activity_at...), so the cutoff must be ISO too. Comparing them against
 * SQLite's own `datetime('now', '-7 days')` mixes formats, and SQLite compares
 * these as plain text: at index 10 ISO has 'T' (0x54) where the SQLite form has
 * ' ' (0x20), so an ISO value always sorts above a SQLite one for the same
 * instant. The comparison then turns on the separator rather than the time.
 *
 * The server hit this too and solved it the other way round, converting the
 * bound to SQLite format (sru-field-api/lib/time.js `isoToSqlite`). Here the
 * columns are ISO, so the honest fix is to keep everything ISO and never let
 * the two meet.
 */
export function isoDaysAgo(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() - days * 86400000).toISOString();
}

/**
 * ISO instant for midnight WIB at the start of today.
 *
 * "Hari ini" has to mean the calendar day the operator is living in. A rolling
 * 24 hours quietly includes half of yesterday, and a UTC day starts at 07:00
 * WIB — which would put the whole malam shift on the wrong date.
 */
export function isoStartOfWibToday(from: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(from);
  // WIB is UTC+7 year-round — Indonesia has no daylight saving — so midnight
  // WIB is 17:00 UTC on the previous day.
  return new Date(`${parts}T00:00:00+07:00`).toISOString();
}
