import {
  BANDUL_MAX_MM,
  DEVIATION_SAMPLE_SIZE,
  adjustTape,
  computeDeviationMm,
  computeLevelMm,
  evaluateReading,
  suggestTapeLength,
  validateReading,
} from '../midband';

/** The only two tanks that exist (doc 02 §1.1). */
const T401 = 7953;
const T402 = 7974;

describe('worked example from doc 02 §2.1', () => {
  it('7953 − 2901 + 35 = 5087, deviation +87 against DCS 5000', () => {
    const result = evaluateReading({
      heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm: 35, dcsLevelMm: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levelMm).toBe(5087);
    expect(result.deviationMm).toBe(87);
  });

  it('agrees with the server, which recomputes the same figure on sync', () => {
    // If these ever diverge the operator sees one number and the record stores
    // another, and nobody would know which to believe.
    expect(computeLevelMm({ heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm: 35 })).toBe(5087);
  });
});

describe('computeLevelMm', () => {
  it('reduces to height − tape when the bob comes back bare', () => {
    expect(computeLevelMm({ heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm: 0 })).toBe(5052);
  });

  it('uses each tank’s own height', () => {
    expect(computeLevelMm({ heightMm: T402, tapeLengthMm: 2901, bandulSulfurMm: 35 })).toBe(5108);
  });

  it('absorbs floating-point noise from decimal readings', () => {
    // Raw IEEE arithmetic gives 5053.099999999999 here — the guard fails if
    // rounding is removed.
    expect(T401 - 2900.1 + 0.2).not.toBe(5053.1);
    expect(computeLevelMm({ heightMm: T401, tapeLengthMm: 2900.1, bandulSulfurMm: 0.2 })).toBe(5053.1);
  });

  it('throws on non-finite input rather than producing a wrong level', () => {
    expect(() => computeLevelMm({ heightMm: T401, tapeLengthMm: NaN, bandulSulfurMm: 35 })).toThrow(TypeError);
  });
});

describe('computeDeviationMm', () => {
  it('is positive when the tank is fuller than DCS claimed', () => {
    expect(computeDeviationMm(5087, 5000)).toBe(87);
  });

  it('is negative when DCS overstates the level', () => {
    expect(computeDeviationMm(4950, 5000)).toBe(-50);
  });

  it('absorbs float noise', () => {
    expect(5087 - 5000.1).not.toBe(86.9);
    expect(computeDeviationMm(5087, 5000.1)).toBe(86.9);
  });

  it('is null when DCS was unreadable — never zero', () => {
    // Zero would be indistinguishable from "DCS was exactly right" and would
    // skew every later tape suggestion.
    expect(computeDeviationMm(5087, null)).toBeNull();
    expect(computeDeviationMm(5087, undefined)).toBeNull();
  });
});

describe('validation (doc 10 §2.1)', () => {
  it('accepts the 0 and 99 boundaries', () => {
    for (const bandulSulfurMm of [0, BANDUL_MAX_MM]) {
      expect(validateReading({ heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm })).toBeNull();
    }
  });

  it('rejects 100 — past what the bob gauge can read', () => {
    const error = validateReading({ heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm: 100 });
    expect(error?.code).toBe('BANDUL_OUT_OF_RANGE');
    expect(error?.message).toMatch(/0–99 mm/);
  });

  it('rejects negative sulfur height', () => {
    expect(validateReading({ heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm: -1 })?.code)
      .toBe('BANDUL_OUT_OF_RANGE');
  });

  it('rejects a tape equal to tank height — it hit the floor', () => {
    expect(validateReading({ heightMm: T401, tapeLengthMm: T401, bandulSulfurMm: 35 })?.code)
      .toBe('TAPE_TOO_LONG');
  });

  it('rejects a tape longer than the tank', () => {
    expect(validateReading({ heightMm: T401, tapeLengthMm: T401 + 1, bandulSulfurMm: 35 })?.code)
      .toBe('TAPE_TOO_LONG');
  });

  it('accepts one millimetre short of the floor', () => {
    expect(validateReading({ heightMm: T401, tapeLengthMm: T401 - 1, bandulSulfurMm: 0 })).toBeNull();
  });

  it('reports the bandul problem first when both are wrong', () => {
    // The operator gets one message; the bob reading is the one they can act on.
    expect(validateReading({ heightMm: T401, tapeLengthMm: T401 + 500, bandulSulfurMm: 150 })?.code)
      .toBe('BANDUL_OUT_OF_RANGE');
  });

  it('never yields a negative level once bandul and tape pass', () => {
    for (const tapeLengthMm of [0, 1, 2901, T401 - 1]) {
      for (const bandulSulfurMm of [0, 50, BANDUL_MAX_MM]) {
        const result = evaluateReading({ heightMm: T401, tapeLengthMm, bandulSulfurMm });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.levelMm).toBeGreaterThan(0);
      }
    }
  });

  it('returns a rejection rather than throwing, so the form can show it', () => {
    const result = evaluateReading({ heightMm: T401, tapeLengthMm: 2901, bandulSulfurMm: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BANDUL_OUT_OF_RANGE');
  });
});

/* ------------------------------------------------------------- suggestion */

describe('tape suggestion (doc 02 §2.2)', () => {
  it('falls back to height − DCS with no history', () => {
    const s = suggestTapeLength(T401, 5000, []);
    expect(s.isFallback).toBe(true);
    expect(s.averageDeviationMm).toBe(0);
    expect(s.estimatedLevelMm).toBe(5000);
    expect(s.suggestionMm).toBe(2953); // 7953 − 5000, the unaided guess
  });

  it('corrects for the tank’s drift once a reading exists', () => {
    // This is the whole feature: one reading at +87 shortens the tape by 87mm,
    // which is the difference between one pull and three.
    const s = suggestTapeLength(T401, 5000, [{ levelMm: 5087, dcsLevelMm: 5000 }]);
    expect(s.isFallback).toBe(false);
    expect(s.averageDeviationMm).toBe(87);
    expect(s.estimatedLevelMm).toBe(5087);
    expect(s.suggestionMm).toBe(2866);
  });

  it('averages across samples', () => {
    const s = suggestTapeLength(T401, 5000, [
      { levelMm: 5100, dcsLevelMm: 5000 },  // +100
      { levelMm: 5050, dcsLevelMm: 5000 },  // +50
    ]);
    expect(s.averageDeviationMm).toBe(75);
    expect(s.suggestionMm).toBe(2878);      // 7953 − 5075
  });

  it('lengthens the tape when DCS overstates the level', () => {
    const s = suggestTapeLength(T401, 5000, [{ levelMm: 4900, dcsLevelMm: 5000 }]);
    expect(s.averageDeviationMm).toBe(-100);
    expect(s.suggestionMm).toBe(3053);      // deeper than the naive 2953
  });

  it(`uses at most ${DEVIATION_SAMPLE_SIZE} samples, newest first`, () => {
    // Seven samples: the five newest are +10, the two oldest +1000. If the cap
    // failed, the average would be dragged wildly off.
    const samples = [
      ...Array.from({ length: 5 }, () => ({ levelMm: 5010, dcsLevelMm: 5000 })),
      { levelMm: 6000, dcsLevelMm: 5000 },
      { levelMm: 6000, dcsLevelMm: 5000 },
    ];
    const s = suggestTapeLength(T401, 5000, samples);
    expect(s.samples).toHaveLength(DEVIATION_SAMPLE_SIZE);
    expect(s.averageDeviationMm).toBe(10);
  });

  it('exposes the samples it used so the operator can see why', () => {
    // Doc 10 §4 requires the suggestion be transparent: DCS, sample count,
    // average, estimate. An operator who cannot see the reasoning will not
    // trust the number, and the feature dies unused.
    const s = suggestTapeLength(T401, 5000, [
      { levelMm: 5087, dcsLevelMm: 5000 },
      { levelMm: 5050, dcsLevelMm: 5000 },
    ]);
    expect(s.samples).toEqual([87, 50]);
  });

  it('keeps each tank separate — 93T-402 uses its own height', () => {
    const s = suggestTapeLength(T402, 5000, [{ levelMm: 5087, dcsLevelMm: 5000 }]);
    expect(s.suggestionMm).toBe(2887); // 7974 − 5087
  });
});

describe('adjustTape after an empty bob (doc 03 §3.2)', () => {
  it('goes deeper by the chosen step', () => {
    expect(adjustTape(2866, 50, T401)).toBe(2916);
    expect(adjustTape(2866, 100, T401)).toBe(2966);
  });

  it('goes shallower for a bob buried past the gauge', () => {
    expect(adjustTape(2866, -100, T401)).toBe(2766);
  });

  it('never suggests running the tape through the floor', () => {
    // Four taps of +100 from near the bottom must not exceed the tank.
    let tape = T401 - 50;
    for (let i = 0; i < 4; i += 1) tape = adjustTape(tape, 100, T401);
    expect(tape).toBe(T401 - 1);
    expect(validateReading({ heightMm: T401, tapeLengthMm: tape, bandulSulfurMm: 0 })).toBeNull();
  });

  it('never goes negative', () => {
    expect(adjustTape(30, -100, T401)).toBe(0);
  });
});
