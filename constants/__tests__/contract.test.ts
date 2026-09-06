import fs from 'fs';
import path from 'path';

/**
 * The two things a visual redesign is never allowed to move: where the app
 * goes, and what it says to an operator.
 *
 * Routes matter structurally — `typedRoutes` is on, so a rename cascades
 * silently through generated types rather than failing loudly. Copy matters
 * because the documents are the source of truth (README), the labels are
 * Indonesian by mandate (doc 01 §6), and the equipment vocabulary is the
 * English the plant actually speaks (doc 02 §1.2).
 */

const ROOT = path.join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

/** The route tree as shipped in v0.3.0 (doc 03 §5). */
const ROUTES = [
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/activities/_layout.tsx',
  'app/(tabs)/activities/index.tsx',
  'app/(tabs)/activities/new.tsx',
  'app/(tabs)/cleaning/[id].tsx',
  'app/(tabs)/cleaning/_layout.tsx',
  'app/(tabs)/cleaning/index.tsx',
  'app/(tabs)/cleaning/new.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/maintenance/_layout.tsx',
  'app/(tabs)/maintenance/equipment/[id].tsx',
  'app/(tabs)/maintenance/equipment/status.tsx',
  'app/(tabs)/maintenance/index.tsx',
  'app/(tabs)/maintenance/tasks/[id].tsx',
  'app/(tabs)/sync.tsx',
  'app/(tabs)/tanks/[id].tsx',
  'app/(tabs)/tanks/_layout.tsx',
  'app/(tabs)/tanks/index.tsx',
  'app/(tabs)/tanks/measure.tsx',
  'app/+not-found.tsx',
  'app/_layout.tsx',
  'app/camera.tsx',
  'app/index.tsx',
  'app/login.tsx',
  'app/settings.tsx',
  'app/shift-start.tsx',
  'app/summary.tsx',
];

describe('route freeze', () => {
  it('has neither added, removed nor renamed a screen', () => {
    expect(walk(path.join(ROOT, 'app')).sort()).toEqual([...ROUTES].sort());
  });
});

describe('copy freeze', () => {
  const app = walk(path.join(ROOT, 'app'))
    .concat(walk(path.join(ROOT, 'components')))
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');

  /** Five tabs, and Servis stays short so it does not truncate (doc 03 §1). */
  it.each(['Beranda', 'Tangki', 'Aktivitas', 'Bersih', 'Servis'])(
    'keeps the %s tab label',
    (label) => expect(app).toContain(`'${label}'`),
  );

  it('never renames Servis to Maintenance, which truncates at a 16pt label', () => {
    expect(app).not.toContain("title: 'Maintenance'");
  });

  it.each([
    'Mode offline — catatan tetap tersimpan di HP',
    'Belum terkirim',
    'Ditolak server',
    'Menunggu',
    'Simpan & catat lagi',
    'Simpan & selesai',
    'Langkah',
    'Turunkan meteran',
    'Riwayat di HP ini',
    'Rangkuman Shift',
    'Mulai Shift',
    'Pengaturan',
    'Memuat…',
  ])('keeps the Indonesian string %p', (phrase) => {
    expect(app).toContain(phrase);
  });

  /**
   * Codes arrive from the database, so the full string is correctly absent from
   * source — the rule to enforce here is that no screen shortens one on the way
   * to the label. floors.test.ts covers the literal 'T-401' form separately.
   */
  it('never truncates a tank code or equipment tag before display', () => {
    expect(app).not.toMatch(/(?:tank\.code|tagNumber)\s*\.\s*(?:slice|substring|substr)\s*\(/);
  });
});
