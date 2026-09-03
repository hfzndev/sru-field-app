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
