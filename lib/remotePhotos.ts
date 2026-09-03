import { Directory, File, Paths } from 'expo-file-system';
import { API_URL } from './config';
import { getToken } from './session';

/**
 * Photographs that live on the server, not on this phone (doc 07 §5).
 *
 * Four handsets rotate through a shift, so most cleaning sessions an operator
 * looks at were documented by a different phone. Those photos are fetched on
 * demand rather than synced down — the point of the 7-day window is that a
 * handset does not carry everyone's images.
 *
 * They are fetched rather than pointed at directly because the endpoint needs
 * the device token, and React Native's Image does not reliably attach request
 * headers on Android — it fails the load and reports it the same way it reports
 * having no signal, which would leave an operator staring at "perlu sinyal"
 * with four bars.
 *
 * The copy goes in the *cache* directory on purpose. Android may evict it at
 * any time, which is exactly right: this is a convenience for looking at a
 * photograph twice, not a second home for it.
 */

const CACHE_DIR = 'remote-photos';

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** A filename that is stable for a given server path and safe on disk. */
function cacheName(serverPath: string): string {
  const cleaned = serverPath.replace(/[^a-zA-Z0-9.]+/g, '_');
  return cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
}

/**
 * Returns a local file:// uri for a server-held photo, downloading it once.
 *
 * @throws when offline or the photo is unavailable — callers show a placeholder
 */
export async function fetchRemotePhoto(serverPath: string): Promise<string> {
  const target = new File(cacheDirectory(), cacheName(serverPath));
  if (target.exists && (target.size ?? 0) > 0) return target.uri;

  const token = await getToken();
  if (!token) throw new Error('Belum login');

  const url = `${API_URL}/api/photo?path=${encodeURIComponent(serverPath)}`;
  const downloaded = await File.downloadFileAsync(url, target, {
    headers: { Authorization: `Bearer ${token}` },
    idempotent: true,
  });

  return downloaded.uri;
}
