import fs from 'fs';
import path from 'path';

/**
 * Source-level guards for the rules in doc 03 §1.
 *
 * These read the files off disk rather than rendering them, which is the point:
 * they cover screens no test happens to mount, and they catch a regression in a
 * file somebody edited at the end of a long day. Every one of these would have
 * failed somewhere in the app before this pass.
 */

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['app', 'components'];

/**
 * Comments are stripped before scanning. Several of these rules are *described*
 * in prose next to the code that honours them — the note in tanks/index.tsx
 * saying a code must never be written "T-401" is the rule, not a breach of it.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !full.includes('__tests__')) {
        out.push({
          file: path.relative(ROOT, full),
          text: stripComments(fs.readFileSync(full, 'utf8')),
        });
      }
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

const FILES = sources();

/** Reports every offender at once, so one run fixes the whole class. */
function offenders(test: (text: string) => string[]): string[] {
  return FILES.flatMap(({ file, text }) => test(text).map((hit) => `${file}: ${hit}`));
}

describe('source floors', () => {
  it('finds the screens to check', () => {
    expect(FILES.length).toBeGreaterThan(25);
  });

  it('has no fontSize literal below 16', () => {
    expect(offenders((text) =>
      [...text.matchAll(/fontSize:\s*(\d+)/g)]
        .filter((m) => Number(m[1]) < 16)
        .map((m) => m[0]),
    )).toEqual([]);
  });

  it('has no minHeight or minWidth literal below the 44pt touch floor', () => {
    // `height` is excluded on purpose — hairlines and rails are 1-8pt by design.
    // So is a literal 0, which is the flexbox shrink idiom, not a touch target.
    expect(offenders((text) =>
      [...text.matchAll(/min(?:Height|Width):\s*(\d+)/g)]
        .filter((m) => Number(m[1]) > 0 && Number(m[1]) < 44)
        .map((m) => m[0]),
    )).toEqual([]);
  });

  it('has no raw colour literals outside the token file', () => {
    expect(offenders((text) =>
      [...text.matchAll(/'#[0-9a-fA-F]{3,8}'|rgba?\([^)]*\)/g)].map((m) => m[0]),
    )).toEqual([]);
  });

  /**
   * Covers the two blocks every emoji icon in this app actually came from —
   * pictographs (the tab glyphs, the gear, the picture placeholder) and misc
   * symbols (the checkmark that used to live inside a button label).
   *
   * Arrow blocks are deliberately out of scope. `→` is ordinary punctuation in
   * Indonesian copy ("On Repair → Normal"), and `⬆` is prescribed copy: doc 03
   * §3.2 specifies the save toast as "Tersimpan · ⬆️ belum terkirim". Widening
   * this to catch those would be the guard overruling the documents, which have
   * final say.
   */
  it('has no emoji left as an icon', () => {
    expect(offenders((text) =>
      [...text.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)].map((m) => m[0]),
    )).toEqual([]);
  });

  it('has no fontWeight 600, which collapses to regular below API 28', () => {
    expect(offenders((text) =>
      [...text.matchAll(/fontWeight:\s*'600'/g)].map((m) => m[0]),
    )).toEqual([]);
  });

  it('imports icon families only through components/icon.tsx', () => {
    expect(offenders((text) =>
      [...text.matchAll(/from '@expo\/vector-icons[^']*'/g)].map((m) => m[0]),
    ).filter((hit) => !hit.startsWith('components\\icon.tsx') && !hit.startsWith('components/icon.tsx')))
      .toEqual([]);
  });

  it('writes tank codes in full, never abbreviated (doc 02 §1.1)', () => {
    expect(offenders((text) =>
      [...text.matchAll(/'T-4\d{2}'|"T-4\d{2}"/g)].map((m) => m[0]),
    )).toEqual([]);
  });
});
