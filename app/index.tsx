import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Loading, Screen } from '@/components/ui';
import { getSession, hasShiftContext } from '@/lib/session';

/**
 * Entry gate.
 *
 * Three states, checked against local storage rather than the network so the
 * app opens straight into work when there is no signal:
 *
 *   no token          → log in (needs signal, done once per shift)
 *   token, no slot    → Mulai Shift, to attribute the coming records
 *   both              → straight to the tabs
 */
export default function Index() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const session = await getSession();
      const ready = session ? await hasShiftContext() : false;
      if (ignore) return;
      setTarget(!session ? '/login' : ready ? '/(tabs)' : '/shift-start');
    })();
    return () => { ignore = true; };
  }, []);

  if (!target) return <Screen><Loading label="Membuka…" /></Screen>;
  return <Redirect href={target as never} />;
}
