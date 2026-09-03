import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert, Button, Field, Input, Loading, Screen } from '@/components/ui';
import { BIG_TOUCH_TARGET, TOUCH_TARGET, colors, space, type } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { formatTime } from '@/lib/format';
import { enqueueActivity } from '@/lib/queue';
import { Session, getSession } from '@/lib/session';

/**
 * Record one activity (doc 03 §3.3).
 *
 * The target is under ten seconds, because the alternative this replaces is
 * remembering it until the end of the shift and writing it on a whiteboard —
 * which is where things get missed (doc 02 §4). Everything here is in service
 * of that: two taps to choose a type, contractors as quick-picks, time already
 * filled in, and a save button that comes straight back for the next one.
 */
type Kind = 'OPERATOR' | 'KONTRAKTOR';

/**
 * Nudges rather than a date picker. An operator recording something they
 * finished a few minutes ago wants two taps, not a spinner — and the shift is
 * only ever a few hours long, so the useful corrections are small ones.
 */
const NUDGES = [
  { label: '−15 mnt', minutes: 15 },
  { label: '−30 mnt', minutes: 30 },
  { label: '−1 jam', minutes: 60 },
];

export default function NewActivityScreen() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [contractors, setContractors] = useState<string[]>([]);

  const [kind, setKind] = useState<Kind>('OPERATOR');
  const [description, setDescription] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [unitArea, setUnitArea] = useState('');
  const [minutesAgo, setMinutesAgo] = useState(0);
  // The clock is read on mount for display only. The saved timestamp is taken
  // fresh at save time, so a form left open for a while is still recorded at
  // the moment the operator pressed the button.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const [current, db] = await Promise.all([getSession(), getDb()]);
      const rows = await db.getAllAsync<{ name: string }>(
        'SELECT name FROM contractors WHERE is_active = 1 ORDER BY name',
      );
      if (ignore) return;
      setSession(current);
      setContractors(rows.map((r) => r.name));
      setOpenedAt(Date.now());
    })();
    return () => { ignore = true; };
  }, []);

  /** Timestamp to store — read at the moment of saving, not of opening. */
  function activityAt(): string {
    return new Date(Date.now() - minutesAgo * 60_000).toISOString();
  }

  /** What the operator sees, derived from the mount-time reading. */
  const displayedAt = openedAt === null
    ? null
    : new Date(openedAt - minutesAgo * 60_000).toISOString();

  async function save(again: boolean) {
    if (!session) return;

    const text = description.trim();
    if (!text) {
      setError('Deskripsi wajib diisi.');
      return;
    }
    // Checked here as well as on the server (doc 02 §4): rejecting it after a
    // sync would tell the operator hours later, when they are nowhere near the
    // work and cannot remember which contractor it was.
    if (kind === 'KONTRAKTOR' && !contractorName.trim()) {
      setError('Nama kontraktor wajib diisi untuk aktivitas kontraktor.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await enqueueActivity({
        type: kind,
        description: text,
        contractorName: kind === 'KONTRAKTOR' ? contractorName.trim() : '',
        unitArea: unitArea.trim(),
        activityAt: activityAt(),
        operatorName: session.operatorName,
        shiftGroup: session.shiftName,
        shiftTime: session.shiftTime,
      });

      if (again) {
        // Type, contractor and area survive: a run of contractor entries is
        // usually the same company in the same unit, and retyping that is most
        // of the ten seconds.
        setDescription('');
        setMinutesAgo(0);
        setError('');
      } else {
        router.replace({
          pathname: '/(tabs)/activities',
          params: { saved: 'Aktivitas tersimpan · belum terkirim' },
        });
      }
    } catch {
      setError('Gagal menyimpan di HP. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) return <Screen><Loading /></Screen>;
  if (!session) {
    return (
      <Screen>
        <Alert error="Sesi shift tidak ditemukan. Login ulang sebelum mencatat." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Alert error={error || null} />

      <Field label="Jenis aktivitas">
        <View style={styles.kinds}>
          {(['OPERATOR', 'KONTRAKTOR'] as Kind[]).map((option) => {
            const active = kind === option;
            return (
              <Pressable
                key={option}
                onPress={() => setKind(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.kind, active && styles.kindActive]}
              >
                <Text style={[styles.kindText, active && styles.kindTextActive]}>
                  {option === 'OPERATOR' ? 'Operator' : 'Kontraktor'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      {kind === 'KONTRAKTOR' && (
        <Field
          label="Nama kontraktor"
          hint="Pilih dari daftar, atau ketik nama lain kalau belum terdaftar."
        >
          {contractors.length > 0 && (
            <View style={styles.picks}>
              {contractors.map((name) => {
                const active = contractorName === name;
                return (
                  <Pressable
                    key={name}
                    onPress={() => setContractorName(name)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.pick, active && styles.pickActive]}
                  >
                    <Text style={[styles.pickText, active && styles.pickTextActive]}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Input
            value={contractorName}
            onChangeText={setContractorName}
            placeholder="mis. PT Tejo Lomanis"
          />
        </Field>
      )}

      <Field
        label="Deskripsi"
        hint={kind === 'KONTRAKTOR' ? 'Pekerjaan yang dilakukan kontraktor.' : 'Apa yang dikerjakan.'}
      >
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder={kind === 'KONTRAKTOR' ? 'mis. pengecatan kompresor' : 'mis. buka valve drain kolom A'}
          multiline
        />
      </Field>

      <Field label="Unit / lokasi (opsional)">
        <Input value={unitArea} onChangeText={setUnitArea} placeholder="mis. unit 91" />
      </Field>

      <Field label="Waktu kejadian">
        <Text style={styles.clock}>{displayedAt ? formatTime(displayedAt) : '—'}</Text>
        <View style={styles.picks}>
          {NUDGES.map((nudge) => {
            const active = minutesAgo === nudge.minutes;
            return (
              <Pressable
                key={nudge.minutes}
                onPress={() => setMinutesAgo(active ? 0 : nudge.minutes)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.pick, active && styles.pickActive]}
              >
                <Text style={[styles.pickText, active && styles.pickTextActive]}>{nudge.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Button
        title={busy ? 'Menyimpan…' : 'Simpan & catat lagi'}
        variant="primary"
        size="big"
        busy={busy}
        onPress={() => save(true)}
      />
      <Button title="Simpan & selesai" variant="secondary" disabled={busy} onPress={() => save(false)} />

      <Text style={styles.note}>
        Tersimpan di HP dulu. Terkirim sendiri saat ada sinyal.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kinds: { flexDirection: 'row', gap: space.sm },
  kind: {
    flex: 1, minHeight: BIG_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  kindActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindText: { ...type.bodyStrong, color: colors.text },
  kindTextActive: { color: '#fff' },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  pick: {
    minHeight: TOUCH_TARGET, paddingHorizontal: space.lg, justifyContent: 'center',
    borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  pickActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pickText: { ...type.body, color: colors.text },
  pickTextActive: { color: colors.accent, fontWeight: '600' },
  clock: { ...type.title, color: colors.text, marginBottom: space.sm },
  note: { ...type.caption, color: colors.muted, marginTop: space.lg },
});
