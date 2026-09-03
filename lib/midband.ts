/**
 * Midband tape measurement (doc 02 §2).
 *
 * Two halves live here, and they are not the same kind of thing:
 *
 *   The arithmetic — level and deviation. The server recomputes both on sync
 *   and its answer is authoritative (doc 04 §4). What is here exists so the
 *   operator sees a number the instant they finish measuring, standing at the
 *   tank, instead of whenever signal returns.
 *
 *   The tape suggestion — this is the phone's own work. The server never
 *   computes it, deliberately: it has to work with no signal, which is most of
 *   the time (doc 04 §4). This is the feature the SOP is built around.
 *
 * The arithmetic mirrors sru-field-api/lib/midband.js and the suggestion is
 * ported from sru-field-api/tools/operator-sim.js, where it was exercised
 * against a live server before this app existed. Neither is invented here.
 */

export const BANDUL_MIN_MM = 0;

/**
 * The bob's gauge cannot physically read past 99 mm. A larger figure does not
 * mean "a lot of sulfur" — it means the tape went too deep and the measurement
 * is void, so the operator retries shorter (doc 02 §2.1).
 */
export const BANDUL_MAX_MM = 99;

/** How many past readings feed the deviation average (doc 02 §2.2). */
export const DEVIATION_SAMPLE_SIZE = 5;

export type MidbandErrorCode = 'BANDUL_OUT_OF_RANGE' | 'TAPE_TOO_LONG' | 'LEVEL_NEGATIVE';

export type MidbandError = { code: MidbandErrorCode; message: string };

export type ReadingInput = {
  heightMm: number;
  tapeLengthMm: number;
  bandulSulfurMm: number;
  dcsLevelMm?: number | null;
};

const mmText = (value: number) => `${Number(value).toLocaleString('id-ID')} mm`;

function assertFinite(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    // Reaching this is our own bug, not bad operator input — the form only
    // yields parsed numbers. Fail loudly rather than compute a wrong level.
    throw new TypeError(`${name} must be a finite number, received ${JSON.stringify(value)}`);
  }
}

/**
 * Removes IEEE-754 noise (7953 − 2900.1 + 0.2 landing on 5053.099999999999)
 * without discarding real precision: 0.01 mm is far finer than a steel tape and
 * a bob can resolve. Matches the server so the phone's preview and the server's
 * stored value agree to the digit.
 */
function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeLevelMm({ heightMm, tapeLengthMm, bandulSulfurMm }: ReadingInput): number {
  assertFinite('heightMm', heightMm);
  assertFinite('tapeLengthMm', tapeLengthMm);
  assertFinite('bandulSulfurMm', bandulSulfurMm);
  return roundMm(heightMm - tapeLengthMm + bandulSulfurMm);
}

/**
 * How far the real level sits from what DCS claimed. Positive means the tank is
 * fuller than DCS reported.
 *
 * A missing DCS reading yields null, never 0 — the operator is allowed to skip
 * it when the screen is unreadable (doc 02 §2.3), and a zero would be
 * indistinguishable from "DCS was exactly right", quietly poisoning the
 * suggestion average that every later measurement depends on.
 */
export function computeDeviationMm(levelMm: number, dcsLevelMm?: number | null): number | null {
  if (dcsLevelMm === null || dcsLevelMm === undefined) return null;
  assertFinite('levelMm', levelMm);
  assertFinite('dcsLevelMm', dcsLevelMm);
  return roundMm(levelMm - dcsLevelMm);
}

/**
 * Domain validation (doc 04 §4). Returns null when acceptable, otherwise a code
 * and an Indonesian message safe to show an operator.
 *
 * The client checks these so the operator hears about it while still standing
 * at the tank, but the server remains the authority — it revalidates on sync.
 */
export function validateReading({ heightMm, tapeLengthMm, bandulSulfurMm }: ReadingInput): MidbandError | null {
  assertFinite('heightMm', heightMm);
  assertFinite('tapeLengthMm', tapeLengthMm);
  assertFinite('bandulSulfurMm', bandulSulfurMm);

  if (bandulSulfurMm < BANDUL_MIN_MM || bandulSulfurMm > BANDUL_MAX_MM) {
    return {
      code: 'BANDUL_OUT_OF_RANGE',
      message: `Tinggi sulfur bandul ${BANDUL_MIN_MM}–${BANDUL_MAX_MM} mm (terbaca ${mmText(bandulSulfurMm)})`,
    };
  }

  // Strictly less than: a tape equal to the tank height reached the floor, so
  // there is nothing to measure (doc 10 §2.1 pins this boundary).
  if (tapeLengthMm >= heightMm) {
    return {
      code: 'TAPE_TOO_LONG',
      message: `Panjang meteran (${mmText(tapeLengthMm)}) harus lebih pendek dari tinggi tangki (${mmText(heightMm)})`,
    };
  }

  // Unreachable while the two checks above hold — tape < height gives
  // height − tape > 0, and bandul is non-negative. Kept because doc 04 §4
  // specifies it, and it is what would catch corrupt master data if the tape
  // rule were ever loosened.
  const levelMm = computeLevelMm({ heightMm, tapeLengthMm, bandulSulfurMm });
  if (levelMm < 0) {
    return {
      code: 'LEVEL_NEGATIVE',
      message: `Level hasil hitung negatif (${mmText(levelMm)}) — periksa panjang meteran`,
    };
  }

  return null;
}

export type Evaluation =
  | { ok: true; levelMm: number; deviationMm: number | null }
  | { ok: false; error: MidbandError };

/** Validate and compute together — what the measurement screen calls. */
export function evaluateReading(input: ReadingInput): Evaluation {
  const error = validateReading(input);
  if (error) return { ok: false, error };

  const levelMm = computeLevelMm(input);
  return { ok: true, levelMm, deviationMm: computeDeviationMm(levelMm, input.dcsLevelMm ?? null) };
}

/* ------------------------------------------------------- the tape suggestion */

export type DeviationSample = { levelMm: number; dcsLevelMm: number };

export type TapeSuggestion = {
  /** How far to lower the tape, in mm. */
  suggestionMm: number;
  /** Level the phone expects, DCS corrected by recent drift. */
  estimatedLevelMm: number;
  /** Mean of the samples used; 0 when there is no history. */
  averageDeviationMm: number;
  /** Deviations actually used, newest first — shown so the number is auditable. */
  samples: number[];
  /** True when falling back to raw DCS with no history. */
  isFallback: boolean;
};

/**
 * Suggests how far to lower the tape (doc 02 §2.2).
 *
 * DCS drifts from reality by an amount that is consistent *per tank*, so the
 * naive `height − DCS` guess is reliably wrong by that drift. Correcting for it
 * is what turns three pulls into one — an empty bob or a bob buried past 99 mm
 * both mean hauling the tape back up and starting again, in the heat, next to a
 * sulfur tank.
 *
 * Samples must come from one tank only. 93T-401 and 93T-402 drift differently
 * and pooling them corrupts the suggestion for both.
 *
 * With no history it falls back to raw DCS, which is exactly the guess an
 * operator would make unaided — never worse than not having the feature.
 */
export function suggestTapeLength(
  heightMm: number,
  dcsLevelMm: number,
  samples: DeviationSample[],
): TapeSuggestion {
  assertFinite('heightMm', heightMm);
  assertFinite('dcsLevelMm', dcsLevelMm);

  const deviations = samples
    .slice(0, DEVIATION_SAMPLE_SIZE)
    .map((s) => s.levelMm - s.dcsLevelMm);

  const averageDeviationMm = deviations.length
    ? roundMm(deviations.reduce((a, b) => a + b, 0) / deviations.length)
    : 0;

  const estimatedLevelMm = roundMm(dcsLevelMm + averageDeviationMm);

  return {
    suggestionMm: roundMm(heightMm - estimatedLevelMm),
    estimatedLevelMm,
    averageDeviationMm,
    samples: deviations.map(roundMm),
    isFallback: deviations.length === 0,
  };
}

/**
 * Adjusts a suggestion after an empty bob (doc 03 §3.2, step 2).
 *
 * The empty-bob retry is the SOP's normal path, not an error path: the tape was
 * too short, so it goes deeper. Clamped to stay inside the tank, because an
 * operator tapping +100 four times should not end up being told to run the tape
 * through the floor.
 */
export function adjustTape(currentMm: number, deltaMm: number, heightMm: number): number {
  const next = currentMm + deltaMm;
  const max = heightMm - 1; // must stay strictly under the tank height
  return roundMm(Math.min(Math.max(next, 0), max));
}
