import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ICON } from '@/components/icon';
import {
  Alert, Button, Card, Field, Loading, NumericInput, Screen, StepHeader, Toast,
} from '@/components/ui';
import { colors, space, type } from '@/constants/theme';
import { getDb } from '@/lib/db';
import { deviation as fmtDeviation, mm } from '@/lib/format';
import {
  BANDUL_MAX_MM, DeviationSample, adjustTape, evaluateReading, suggestTapeLength,
} from '@/lib/midband';
import { enqueueReading } from '@/lib/queue';
import { getSession } from '@/lib/session';
import { deviationSamples } from '@/lib/sync';

/**
 * The guided midband measurement (doc 03 §3.2, doc 02 §2).
 *
 * One step per screen. The operator is standing at a manhole holding a steel
 * tape, often in gloves — every screen asks for exactly one thing, in type
 * large enough to read at arm's length.
 *
 * The empty-bob loop between steps 2 and 3 is the SOP's normal path, not an
 * error path. An empty bob on the first pull is the expected outcome, which is
 * why it gets adjust buttons and an attempt counter rather than a warning.
 */
type Step = 'dcs' | 'lower' | 'read' | 'result';

type Tank = { id: number; code: string; heightMm: number };

export default function MeasureScreen() {
  const params = useLocalSearchParams<{ tankId: string }>();
  const tankId = Number(params.tankId);

  const [tank, setTank] = useState<Tank | null>(null);
  const [samples, setSamples] = useState<DeviationSample[]>([]);
  const [step, setStep] = useState<Step>('dcs');

  const [dcsText, setDcsText] = useState('');
  const [dcsUnknown, setDcsUnknown] = useState(false);
  // Only used when there is no DCS reading and no history — see the 'NONE'
  // basis below. The operator's own guess is better than a fabricated one.
  const [manualTapeText, setManualTapeText] = useState('');
  const [plannedTape, setPlannedTape] = useState(0);
  const [attempts, setAttempts] = useState(1);

  const [tapeText, setTapeText] = useState('');
  const [bandulText, setBandulText] = useState('');
  const [note, setNote] = useState('');

  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const db = await getDb();
      const row = await db.getFirstAsync<{ id: number; code: string; height_mm: number }>(
        'SELECT id, code, height_mm FROM tanks WHERE id = ?', tankId,
      );
      const history = await deviationSamples(tankId);
      if (ignore || !row) return;
      setTank({ id: row.id, code: row.code, heightMm: row.height_mm });
      setSamples(history);
    })();
    return () => { ignore = true; };
  }, [tankId]);

  if (!tank) return <Screen><Loading /></Screen>;

  const dcsValue = dcsUnknown ? null : Number(dcsText);
  // null, not 0. A zero DCS makes the suggestion come out at nearly the height
  // of the tank and the operator lowers the bob to the floor.
  const suggestion = suggestTapeLength(tank.heightMm, dcsValue, samples);

  /* ------------------------------------------------------------- step: DCS */

  if (step === 'dcs') {
    const manualTape = Number(manualTapeText);
    const manualValid = manualTapeText !== ''
      && Number.isFinite(manualTape)
      && manualTape > 0
      && manualTape < tank.heightMm;

    // Cannot continue without a tape length from somewhere: a derived one, or
    // the operator's own.
    const valid = dcsUnknown
      ? (suggestion.suggestionMm !== null || manualValid)
      : (dcsText !== '' && Number.isFinite(Number(dcsText)));
    return (
      <Screen>
        <StepHeader step={1} total={3} title={`${tank.code} — level DCS`} />

        <Field label="Level di layar DCS" hint="Angka yang terbaca sebelum mengukur.">
          <NumericInput
            value={dcsText}
            onChangeText={(t) => { setDcsText(t); setDcsUnknown(false); }}
            placeholder="5000"
            editable={!dcsUnknown}
            autoFocus
            unit="mm"
          />
        </Field>

        {/* Doc 02 §2.3 allows a skipped DCS reading. Forcing a number would
            invite a guess, and a guessed DCS corrupts the deviation average
            that every later suggestion depends on. */}
        <Button
          title="DCS tidak terbaca"
          icon={dcsUnknown ? ICON.check : undefined}
          variant={dcsUnknown ? 'primary' : 'secondary'}
          onPress={() => { setDcsUnknown(!dcsUnknown); setDcsText(''); }}
        />

        {!dcsUnknown && dcsText !== '' && (
          <Card style={{ marginTop: space.lg }}>
            <Text style={styles.cardLabel}>Perkiraan dari riwayat</Text>
            {suggestion.isFallback ? (
              <Text style={styles.muted}>
                Belum ada data deviasi untuk {tank.code} — saran memakai DCS apa adanya.
              </Text>
            ) : (
              <>
                <Text style={styles.muted}>
                  Deviasi rata² {suggestion.samples.length} pengukuran terakhir:{' '}
                  <Text style={styles.emphasis}>{fmtDeviation(suggestion.averageDeviationMm)}</Text>
                </Text>
                <Text style={styles.muted}>
                  Estimasi level: <Text style={styles.emphasis}>{mm(suggestion.estimatedLevelMm)}</Text>
                </Text>
              </>
            )}
          </Card>
        )}

        {/* No DCS reading, but this tank has been measured before: the recent
            actual levels are a real starting point. Coarser than the DCS path
            and said so plainly, because the operator is the one who decides
            whether to trust it. */}
        {dcsUnknown && suggestion.basis === 'HISTORY' && (
          <Card style={{ marginTop: space.lg }}>
            <Text style={styles.cardLabel}>Perkiraan dari pengukuran terakhir</Text>
            <Text style={styles.muted}>
              Tanpa DCS, saran dihitung dari rata-rata level {suggestion.samples.length}{' '}
              pengukuran terakhir: <Text style={styles.emphasis}>{mm(suggestion.estimatedLevelMm)}</Text>
            </Text>
            <Text style={styles.muted}>Lebih kasar daripada memakai DCS — bandul tetap hakim akhir.</Text>
          </Card>
        )}

        {/* Nothing to derive a number from. Asking is the honest move: a
            fabricated suggestion here is what sent the bob to the bottom. */}
        {dcsUnknown && suggestion.basis === 'NONE' && (
          <View style={{ marginTop: space.lg }}>
            <Field
              label="Perkiraan panjang meteran"
              hint={`Tanpa DCS dan belum ada riwayat ${tank.code}, app tidak bisa menyarankan angka. Isi perkiraan sendiri — bisa disesuaikan ±50/±100 nanti.`}
            >
              <NumericInput
                value={manualTapeText}
                onChangeText={setManualTapeText}
                placeholder="2900"
                unit="mm"
              />
            </Field>
          </View>
        )}

        <View style={{ marginTop: space.lg }}>
          <Button
            title="Lanjut"
            variant="primary"
            size="big"
            disabled={!valid}
            onPress={() => {
              setPlannedTape(suggestion.suggestionMm ?? adjustTape(manualTape, 0, tank.heightMm));
              setAttempts(1);
              setStep('lower');
            }}
          />
        </View>
      </Screen>
    );
  }

  /* ---------------------------------------------------- step: lower the tape */

  if (step === 'lower') {
    return (
      <Screen>
        <StepHeader step={2} total={3} title="Turunkan meteran" />

        <Card>
          <Text style={styles.bigLabel}>Turunkan meteran ±</Text>
          <Text style={styles.bigNumber}>{mm(plannedTape)}</Text>

          {/* Transparency is required (doc 10 §4): an operator who cannot see
              why it says this number will not trust it. Every basis explains
              itself — the DCS-unknown paths used to render either nothing at
              all or "tinggi tangki − DCS", which was untrue when there was no
              DCS to subtract. */}
          {suggestion.basis === 'DCS' && !suggestion.isFallback && (
            <Text style={styles.reasoning}>
              DCS {mm(Number(dcsText))} · deviasi rata² {fmtDeviation(suggestion.averageDeviationMm)}
              {' '}dari {suggestion.samples.length} ukur → estimasi {mm(suggestion.estimatedLevelMm)}
            </Text>
          )}
          {suggestion.basis === 'DCS' && suggestion.isFallback && (
            <Text style={styles.reasoning}>
              Tanpa riwayat deviasi: tinggi tangki − DCS.
            </Text>
          )}
          {suggestion.basis === 'HISTORY' && (
            <Text style={styles.reasoning}>
              Tanpa DCS · rata-rata level {suggestion.samples.length} ukur terakhir{' '}
              {mm(suggestion.estimatedLevelMm)} → tinggi tangki − estimasi
            </Text>
          )}
          {suggestion.basis === 'NONE' && (
            <Text style={styles.reasoning}>
              Perkiraan Anda sendiri — app belum punya DCS maupun riwayat {tank.code}.
            </Text>
          )}

          {attempts > 1 && (
            <Text style={styles.attempt}>Percobaan ke-{attempts}</Text>
          )}
        </Card>

        <Text style={styles.question}>Sudah diturunkan & ditarik lagi?</Text>
        <Text style={styles.questionSub}>Ada tempelan sulfur di bandul?</Text>

        <View style={{ gap: space.sm }}>
          <Button
            title="Ya — ada tempelan"
            variant="primary"
            size="big"
            onPress={() => { setTapeText(String(plannedTape)); setStep('read'); }}
          />
          {/* An empty bob means the tape was too short, so this goes deeper by
              default and counts the attempt. Doing nothing visible here would
              leave the operator tapping a dead button on what is the expected
              first outcome, not the exception. */}
          <Button
            title="Tidak — bandul kosong"
            size="big"
            onPress={() => {
              setPlannedTape(adjustTape(plannedTape, 50, tank.heightMm));
              setAttempts((n) => n + 1);
            }}
          />
        </View>

        {attempts > 1 && (
          <Text style={styles.emptyHint}>
            Bandul kosong berarti meteran belum cukup dalam — panjangnya sudah ditambah 50 mm.
            Ubah sendiri di bawah bila perlu.
          </Text>
        )}

        {/* Manual adjustment. The shorter options are for the opposite problem:
            a bob buried past the 99 mm its gauge can read. */}
        <Text style={styles.adjustLabel}>Ulangi dengan panjang lain:</Text>
        <View style={styles.adjustRow}>
          {[-100, -50, 50, 100].map((delta) => (
            <View key={delta} style={styles.adjustCell}>
              <Button
                title={`${delta > 0 ? '+' : ''}${delta}`}
                onPress={() => {
                  setPlannedTape(adjustTape(plannedTape, delta, tank.heightMm));
                  setAttempts((n) => n + 1);
                }}
              />
            </View>
          ))}
        </View>

        <View style={{ marginTop: space.lg }}>
          <Button title="Kembali" onPress={() => setStep('dcs')} />
        </View>
      </Screen>
    );
  }

  /* ------------------------------------------------- step: read the measurement */

  if (step === 'read') {
    const tapeNum = Number(tapeText);
    const bandulNum = Number(bandulText);
    const ready = tapeText !== '' && bandulText !== ''
      && Number.isFinite(tapeNum) && Number.isFinite(bandulNum);

    const check = ready
      ? evaluateReading({
        heightMm: tank.heightMm, tapeLengthMm: tapeNum,
        bandulSulfurMm: bandulNum, dcsLevelMm: dcsValue,
      })
      : null;

    return (
      <Screen>
        <StepHeader step={3} total={3} title="Hasil pengukuran" />

        <Field
          label="Panjang meteran yang masuk"
          hint="Boleh berbeda dari saran — isi yang benar-benar terbaca pada pita."
        >
          <NumericInput value={tapeText} onChangeText={setTapeText} placeholder="2901" unit="mm" autoFocus />
        </Field>

        <Field label="Tinggi sulfur di bandul" hint={`Antara 0 dan ${BANDUL_MAX_MM} mm.`}>
          <NumericInput value={bandulText} onChangeText={setBandulText} placeholder="35" unit="mm" />
        </Field>

        {check && !check.ok && <Alert error={check.error.message} />}

        <View style={{ marginTop: space.md }}>
          <Button
            title="Lihat hasil"
            variant="primary"
            size="big"
            disabled={!ready || (check !== null && !check.ok)}
            onPress={() => setStep('result')}
          />
          <View style={{ marginTop: space.sm }}>
            <Button title="Kembali" onPress={() => setStep('lower')} />
          </View>
        </View>
      </Screen>
    );
  }

  /* ------------------------------------------------------------ step: result */

  const result = evaluateReading({
    heightMm: tank.heightMm,
    tapeLengthMm: Number(tapeText),
    bandulSulfurMm: Number(bandulText),
    dcsLevelMm: dcsValue,
  });

  async function save() {
    if (!result.ok || !tank) return;
    setSaving(true);
    setError('');
    try {
      const session = await getSession();
      await enqueueReading({
        tankId: tank.id,
        dcsLevelMm: dcsValue,
        tapeLengthMm: Number(tapeText),
        bandulSulfurMm: Number(bandulText),
        levelMm: result.levelMm,
        deviationMm: result.deviationMm,
        attempts,
        operatorName: session?.operatorName ?? '',
        shiftGroup: session?.shiftName ?? '',
        shiftTime: session?.shiftTime ?? '',
        note,
        readingAt: new Date().toISOString(),
      });

      // The confirmation is handed to the destination rather than shown here:
      // this screen unmounts on navigation, so a toast rendered on it would
      // flash for a few hundred milliseconds and be missed. Saved-locally and
      // not-yet-sent are different facts, and the message states both.
      router.replace({
        pathname: '/(tabs)/tanks',
        params: { saved: `${tank.code} · ${mm(result.levelMm)} tersimpan · ⬆ belum terkirim` },
      });
    } catch {
      setError('Gagal menyimpan di HP. Coba lagi.');
      setSaving(false);
    }
  }

  return (
    <>
      <Screen>
        <StepHeader step={3} total={3} title={tank.code} />

        {!result.ok ? (
          <Alert error={result.error.message} />
        ) : (
          <Card>
            <Text style={styles.cardLabel}>Level aktual</Text>
            <Text style={styles.bigNumber}>{mm(result.levelMm)}</Text>
            <Text style={styles.reasoning}>
              {mm(tank.heightMm)} − {mm(Number(tapeText))} + {mm(Number(bandulText))}
            </Text>

            <View style={styles.divider} />

            <Text style={styles.cardLabel}>Selisih DCS</Text>
            <Text style={styles.deviation}>
              {dcsValue === null ? 'DCS tidak terbaca' : fmtDeviation(result.deviationMm)}
            </Text>
            {attempts > 1 && <Text style={styles.muted}>{attempts}× percobaan</Text>}
          </Card>
        )}

        <Alert error={error} />

        <Field label="Catatan (opsional)">
          <NumericInput
            value={note}
            onChangeText={setNote}
            placeholder="mis. cuaca hujan"
            keyboardType="default"
            style={{ fontSize: 16, fontWeight: '400', minHeight: 44 }}
          />
        </Field>

        <Button
          title="Simpan"
          variant="primary"
          size="big"
          busy={saving}
          disabled={!result.ok}
          onPress={save}
        />
        <View style={{ marginTop: space.sm }}>
          <Button title="Ubah angka" onPress={() => setStep('read')} disabled={saving} />
        </View>
      </Screen>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  cardLabel: { ...type.body, color: colors.muted },
  bigLabel: { ...type.body, color: colors.muted },
  bigNumber: { ...type.display, color: colors.text, marginVertical: 2 },
  deviation: { ...type.title, color: colors.accent },
  reasoning: { ...type.body, color: colors.muted, marginTop: space.xs },
  attempt: { ...type.bodyStrong, color: colors.warn, marginTop: space.sm },
  muted: { ...type.body, color: colors.muted },
  emphasis: { ...type.bodyStrong, color: colors.text },
  question: { ...type.heading, color: colors.text, marginTop: space.lg },
  questionSub: { ...type.body, color: colors.muted, marginBottom: space.md },
  emptyHint: { ...type.body, color: colors.warn, marginTop: space.md },
  adjustLabel: { ...type.body, color: colors.muted, marginTop: space.lg, marginBottom: space.sm },
  adjustRow: { flexDirection: 'row', marginHorizontal: -space.xs },
  adjustCell: { flex: 1, paddingHorizontal: space.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
});
