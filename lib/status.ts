import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { unsentCount } from './db';

/**
 * Two facts every screen needs: is there a connection, and is anything still
 * stuck on this phone (doc 03 §1).
 *
 * Both live here rather than in each screen so they cannot drift apart. A
 * dashboard saying "semua terkirim" while the sync tab says otherwise would
 * destroy exactly the trust this app is trying to build.
 */

/* ------------------------------------------------------------ connectivity */

const onlineListeners = new Set<(online: boolean) => void>();
let lastKnownOnline = true;

/** Live connectivity, shared by every subscriber. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(lastKnownOnline);

  useEffect(() => {
    let ignore = false;

    (async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        const value = !!state.isConnected && state.isInternetReachable !== false;
        if (!ignore) { lastKnownOnline = value; setOnline(value); }
      } catch {
        // Treated as offline: claiming a connection we cannot confirm would
        // show the operator a green state while nothing is sending.
        if (!ignore) { lastKnownOnline = false; setOnline(false); }
      }
    })();

    const subscription = Network.addNetworkStateListener(({ isConnected }) => {
      const value = !!isConnected;
      lastKnownOnline = value;
      onlineListeners.forEach((fn) => fn(value));
    });

    const handler = (value: boolean) => { if (!ignore) setOnline(value); };
    onlineListeners.add(handler);

    return () => {
      ignore = true;
      onlineListeners.delete(handler);
      subscription.remove();
    };
  }, []);

  return online;
}

/* --------------------------------------------------------------- unsent count

   Push-based rather than polled. The count changes at exactly two moments — a
   record is saved, or a sync finishes — and both are known, so a timer would be
   spending battery to rediscover something the app already knows.              */

const unsentListeners = new Set<(n: number) => void>();
let lastUnsent = 0;

/** Called after a save or a sync so every badge updates at once. */
export async function refreshUnsent(): Promise<number> {
  const n = await unsentCount();
  lastUnsent = n;
  unsentListeners.forEach((fn) => fn(n));
  return n;
}

export function useUnsent(): number {
  const [count, setCount] = useState(lastUnsent);

  useEffect(() => {
    let ignore = false;
    const handler = (n: number) => { if (!ignore) setCount(n); };
    unsentListeners.add(handler);
    refreshUnsent().catch(() => {});
    return () => { ignore = true; unsentListeners.delete(handler); };
  }, []);

  return count;
}
