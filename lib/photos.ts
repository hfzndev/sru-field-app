import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Local photo storage for cleaning documentation (doc 02 §3).
 *
 * Two rules shape everything here.
 *
 * Photos are compressed to ≤1MB on the phone before they are ever uploaded
 * (doc 02 §3.6). The plant link is the same one the operator is waiting on, and
 * a 6MB camera original would hold up the record it belongs to.
 *
 * Files live in the documents directory, never the cache. Android evicts cache
 * under storage pressure, and a BEFORE photo belonging to a PENDING record has
 * to survive that — losing it means an operator documented something and the
 * evidence quietly vanished.
 */

/** doc 02 §3.6. The server accepts 5MB (doc 08 §7); this is the phone-side budget. */
export const MAX_PHOTO_BYTES = 1024 * 1024;

const PHOTO_DIR = 'field-photos';

/**
 * Successive attempts at getting under budget, gentlest first.
 *
 * Resolution is spent before quality: a dirty patch of floor stays legible when
 * the image is smaller, but goes to mush when JPEG quality drops far enough,
 * and the photograph exists to be looked at later by someone deciding whether
 * the area was actually cleaned.
 */
const LADDER = [
  { maxEdge: 1600, quality: 0.7 },
  { maxEdge: 1600, quality: 0.5 },
  { maxEdge: 1200, quality: 0.5 },
  { maxEdge: 1000, quality: 0.4 },
  { maxEdge: 800, quality: 0.35 },
];

export type StoredPhoto = {
  /** file:// URI inside the documents directory. */
  uri: string;
  /** Just the filename. Safe to carry through a route param — see photoUriFor. */
  name: string;
  bytes: number;
  width: number;
  height: number;
};

/**
 * Rebuilds a stored photo's uri from its filename.
 *
 * Screens hand photos to each other by name rather than by uri because the
 * documents path can contain percent signs (Expo Go sandboxes each project
 * under an encoded directory), and a router param is percent-decoded on the way
 * through — which silently turns %2540 into %40 and points at a file that does
 * not exist. A uuid filename has no such characters.
 */
export function photoUriFor(name: string): string {
  return new File(photoDirectory(), name).uri;
}

function photoDirectory(): Directory {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function sizeOf(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Compresses a freshly taken photo and moves it somewhere permanent.
 *
 * @param sourceUri the camera's original, which lives in the cache
 * @returns where the compressed copy now lives
 */
export async function storePhoto(sourceUri: string): Promise<StoredPhoto> {
  // Decoded once and reused for every rung — passing the rendered reference back
  // into manipulate() avoids re-reading a multi-megabyte original five times.
  const source = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const longEdge = Math.max(source.width, source.height);

  let attempt: { uri: string; bytes: number; width: number; height: number } | null = null;

  for (let i = 0; i < LADDER.length; i += 1) {
    const rung = LADDER[i];
    const scale = Math.min(1, rung.maxEdge / longEdge);

    const context = ImageManipulator.manipulate(source);
    if (scale < 1) {
      context.resize({
        width: Math.round(source.width * scale),
        height: Math.round(source.height * scale),
      });
    }

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: rung.quality });
    const bytes = sizeOf(saved.uri);

    if (attempt) deleteFile(attempt.uri);
    attempt = { uri: saved.uri, bytes, width: rendered.width, height: rendered.height };

    if (bytes > 0 && bytes <= MAX_PHOTO_BYTES) break;
  }

  if (!attempt) throw new Error('Foto gagal diproses');

  // The last rung is aggressive enough that this should not happen. If it does,
  // the photograph is still kept: an oversized record the server may accept
  // (its limit is 5×) beats discarding evidence the operator went and took.
  if (attempt.bytes > MAX_PHOTO_BYTES) {
    console.warn(`photo still ${attempt.bytes} bytes after full compression ladder`);
  }

  // The capture time leads the filename so the orphan sweep can tell a photo
  // taken thirty seconds ago from one abandoned last week without asking the
  // filesystem for timestamps — which the modern API does not expose.
  const destination = new File(photoDirectory(), `${Date.now()}-${Crypto.randomUUID()}.jpg`);
  new File(attempt.uri).move(destination);

  return {
    uri: destination.uri,
    name: destination.name,
    bytes: destination.size ?? attempt.bytes,
    width: attempt.width,
    height: attempt.height,
  };
}

function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A photo that cannot be deleted is a few hundred kilobytes wasted. Nothing
    // the operator does next should fail because of it.
  }
}

/** Removes a stored photo. Safe to call with an empty or already-gone path. */
export function deletePhoto(uri: string | null | undefined): void {
  if (!uri) return;
  deleteFile(uri);
}

export function photoExists(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * How long an unreferenced photo is left alone before it counts as abandoned.
 *
 * A photo file exists from the moment the shutter is pressed, but it only gains
 * an owner when the operator finishes the form — and sync runs on app open and
 * whenever the connection returns. Without this grace period, a background sync
 * during the thirty seconds someone spends typing a location deletes the BEFORE
 * photo they just took, and the area is about to be cleaned, so there is no
 * second chance to take it.
 *
 * The server's sweeper leaves orphans for seven days for the same reason
 * (doc 09 §5). Six hours is far longer than any form takes and far shorter than
 * storage pressure takes to matter.
 */
export const ORPHAN_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Deletes stored photos that no record refers to and that are old enough to be
 * certain nobody is still working on them.
 *
 * This is the phone-side twin of the server's orphan sweeper (doc 09 §5) and it
 * takes the same care: it deletes only what it can prove is both unreferenced
 * and abandoned.
 *
 * @param referenced every local photo path currently held by a record
 * @param now injectable for tests
 * @returns how many files were removed
 */
export function sweepOrphanPhotos(referenced: Iterable<string>, now: number = Date.now()): number {
  const keep = new Set<string>();
  for (const uri of referenced) {
    if (uri) keep.add(uri);
  }

  let removed = 0;
  try {
    for (const entry of photoDirectory().list()) {
      if (!(entry instanceof File) || keep.has(entry.uri)) continue;

      // A file whose age cannot be read is kept. Deleting an operator's
      // photograph on the strength of an unparseable filename is the wrong way
      // to resolve that doubt.
      const capturedAt = Number(entry.name.split('-')[0]);
      if (!Number.isFinite(capturedAt) || capturedAt <= 0) continue;
      if (now - capturedAt < ORPHAN_GRACE_MS) continue;

      entry.delete();
      removed += 1;
    }
  } catch {
    // Sweeping is housekeeping. If the directory cannot be listed, the app
    // carries on with a few stale files rather than failing a sync.
  }
  return removed;
}
