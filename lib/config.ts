import Constants from 'expo-constants';

/**
 * Where the server lives.
 *
 * Resolution order, most specific first:
 *   EXPO_PUBLIC_API_URL   — set when running against a local server in dev
 *   app.json extra.apiUrl — what a built APK ships with
 *   the production host   — last resort, so a misconfigured build still points
 *                           somewhere real rather than at localhost
 *
 * On the emulator, `adb reverse tcp:3000 tcp:3000` makes the host's server
 * reachable at 127.0.0.1:3000 from inside the device.
 */
const PRODUCTION_URL = 'https://ops.sruipal.com';

function resolve(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  if (fromConfig) return fromConfig.replace(/\/+$/, '');

  return PRODUCTION_URL;
}

export const API_URL = resolve();

/** True when talking to a local server over plain http — surfaced in Settings. */
export const IS_LOCAL_API = /^http:\/\/(127\.0\.0\.1|10\.0\.2\.2|localhost|192\.168\.)/.test(API_URL);

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/**
 * How long a request may hang before it is treated as no-signal.
 *
 * Deliberately short. In a plant dead zone the request will not succeed, and an
 * operator staring at a spinner is an operator who assumes the app is broken —
 * far better to say "no signal, saved locally" quickly (doc 03 §1).
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Photos are up to 1MB and share the link with everything else, so they get a
 * longer leash than a JSON round trip. Still bounded: a stalled upload must
 * eventually give the record back to the queue rather than hold the whole sync.
 */
export const PHOTO_TIMEOUT_MS = 60_000;
