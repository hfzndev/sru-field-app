import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { API_URL, APP_VERSION } from './config';
import { OfflineError } from './api';
import { getToken } from './session';

/**
 * In-app APK update (doc 09 §3 lapis 3).
 *
 * There is no app store here. Four handsets get their builds from the server,
 * and this is the whole update path, so it is written around the two things
 * that actually go wrong in a plant.
 *
 * **The check must be nearly free.** A build is ~70MB and the link is 2G in
 * places. `HEAD /api/apk/latest` returns the version in a header and no body,
 * so asking "is there something newer" costs one round trip rather than a
 * download the operator did not ask for.
 *
 * **The download must never leave a half file that looks whole.** It writes to
 * a `.part` name and renames only once the bytes are all there. An installer
 * truncated by a dead spot would fail at install time, which is confusing, or
 * worse, be retried forever.
 */

export type UpdateStatus =
  | { state: 'CURRENT' }
  | { state: 'AVAILABLE'; version: string; bytes: number }
  | { state: 'NONE' }        // server has no build published yet
  | { state: 'UNKNOWN' };    // offline, or the check failed — never an error state

/** Where a downloaded build waits to be installed. Documents, never cache. */
const APK_DIR = 'apk';

function parse(version: string): [number, number, number] | null {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True when `candidate` is strictly newer than `current`.
 *
 * Numeric, never string comparison: "0.10.0" < "0.9.0" as text, and an app that
 * believes it is ahead of the server stops offering updates entirely.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * Asks the server whether a newer build exists.
 *
 * Never throws. Being out of signal is the normal case out in the plant, and a
 * failed update check must not be presented to an operator as a problem they
 * have to solve — it returns UNKNOWN and the banner simply does not appear.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const token = await getToken();
  if (!token) return { state: 'UNKNOWN' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${API_URL}/api/apk/latest`, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (response.status === 404) return { state: 'NONE' };
    if (!response.ok) return { state: 'UNKNOWN' };

    const version = response.headers.get('X-App-Version') ?? '';
    const bytes = Number(response.headers.get('Content-Length') ?? 0);
    if (!parse(version)) return { state: 'UNKNOWN' };

    return isNewer(version, APP_VERSION)
      ? { state: 'AVAILABLE', version, bytes }
      : { state: 'CURRENT' };
  } catch {
    return { state: 'UNKNOWN' };
  } finally {
    clearTimeout(timer);
  }
}

function apkDirectory(): Directory {
  const dir = new Directory(Paths.document, APK_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function apkFileFor(version: string): File {
  return new File(apkDirectory(), `sru-field-${version}.apk`);
}

/**
 * Downloads a build and returns the file once it is complete.
 *
 * Already-downloaded builds are returned as they are rather than fetched again:
 * an operator who taps twice, or comes back after killing the app, should not
 * pay for 70MB a second time.
 */
export async function downloadUpdate(
  version: string,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  const token = await getToken();
  if (!token) throw new Error('Belum login');

  const target = apkFileFor(version);
  if (target.exists) return target;

  // Written under a .part name and renamed on completion. A file that exists
  // under its real name is therefore always whole — nothing has to inspect a
  // length to decide whether an installer can be trusted.
  const partial = new File(apkDirectory(), `sru-field-${version}.apk.part`);
  if (partial.exists) partial.delete();

  try {
    const downloaded = await File.downloadFileAsync(
      `${API_URL}/api/apk/latest`,
      partial,
      {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
        onProgress: onProgress
          // totalBytes is -1 when the server sent no Content-Length. Ours
          // always does, but a proxy in between may strip it, and dividing by
          // -1 would drive a progress bar backwards.
          ? ({ bytesWritten, totalBytes }) => {
            if (totalBytes > 0) onProgress(bytesWritten / totalBytes);
          }
          : undefined,
      },
    );
    await downloaded.move(target);
    return target;
  } catch (err) {
    if (partial.exists) partial.delete();
    throw err instanceof Error ? err : new OfflineError();
  }
}

/**
 * Removes builds other than the one named.
 *
 * A 70MB file per release adds up on a handset that also has to hold a week of
 * photographs, and once a build is installed its APK is dead weight.
 */
export function sweepOldApks(keepVersion?: string): number {
  const dir = new Directory(Paths.document, APK_DIR);
  if (!dir.exists) return 0;

  const keep = keepVersion ? `sru-field-${keepVersion}.apk` : null;
  let removed = 0;
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name !== keep) {
      entry.delete();
      removed += 1;
    }
  }
  return removed;
}

/**
 * Hands a downloaded build to Android's package installer.
 *
 * A `file://` path shown on screen is not an instruction an operator can act
 * on — there is no file manager on a plant handset they would navigate to
 * `/data/user/0/.../apk/` with. The installer has to be opened for them.
 *
 * Android will not accept a `file://` URI in an intent (it throws
 * FileUriExposedException since Nougat), so the path is converted to a
 * `content://` URI backed by Expo's FileProvider first. FLAG_GRANT_READ_URI_
 * PERMISSION (1) is what lets the installer, a different app, read it.
 *
 * The first time, Android asks the operator to allow "install unknown apps".
 * That prompt is the system's, not ours, and it is asked once per app.
 */
export async function installApk(file: File): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Update APK hanya untuk Android');

  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
