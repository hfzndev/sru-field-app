import {
  BIG_TOUCH_TARGET,
  RAIL_WIDTH,
  ROW_HEIGHT,
  SHIFT_TIME_LABEL,
  STATUS_LABEL,
  TOUCH_TARGET,
  colors,
  radius,
  space,
  statusColor,
  type,
} from '../theme';

/**
 * The floors in doc 03 §1 are the reason this app is usable in a plant. They
 * were previously enforced by review; here they are enforced by the build.
 */

/** sRGB relative luminance, WCAG 2.1 §1.4.3. */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.substr(i, 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every surface an operator reads text against. */
const SURFACES = [colors.surface, colors.bg, colors.surfaceAlt];

describe('type scale', () => {
  it('never drops below the 16pt floor', () => {
    for (const [name, style] of Object.entries(type)) {
      expect({ name, size: style.fontSize }).toEqual({ name, size: expect.any(Number) });
      expect(style.fontSize).toBeGreaterThanOrEqual(16);
    }
  });

  it('never sets leading tighter than the glyph size', () => {
    for (const [name, style] of Object.entries(type)) {
      expect(`${name}:${style.lineHeight}`).toBe(`${name}:${style.lineHeight}`);
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize);
    }
  });

  it('uses tabular figures everywhere a number is read', () => {
    for (const name of ['display', 'metric', 'numeric', 'numericLarge'] as const) {
      expect(type[name].fontVariant).toEqual(['tabular-nums']);
    }
  });

  it('avoids fontWeight 600, which collapses to regular below API 28', () => {
    for (const [name, style] of Object.entries(type)) {
      expect(`${name}=${style.fontWeight}`).not.toBe(`${name}=600`);
    }
  });

  it('gives eyebrow real tracking, since that is what replaces small caps text', () => {
    expect(type.eyebrow.letterSpacing).toBeGreaterThanOrEqual(0.5);
    expect(type.eyebrow.fontWeight).toBe('700');
  });
});

describe('touch and layout floors', () => {
  it('holds the 44pt and 56pt targets from doc 03 §1', () => {
    expect(TOUCH_TARGET).toBe(44);
    expect(BIG_TOUCH_TARGET).toBe(56);
  });

  it('keeps a list row above the touch floor', () => {
    expect(ROW_HEIGHT).toBeGreaterThanOrEqual(TOUCH_TARGET);
  });

  it('keeps the status rail wide enough to read at arm’s length', () => {
    expect(RAIL_WIDTH).toBeGreaterThanOrEqual(4);
  });

  it('keeps the spacing scale on the 4pt grid', () => {
    for (const value of Object.values(space)) {
      expect(value % 4).toBe(0);
    }
  });

  it('exposes the radii the primitives rely on', () => {
    expect(radius.pill).toBeGreaterThan(100);
  });
});

describe('sunlight contrast', () => {
  it('gives primary text AAA on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrast(colors.text, surface)).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps secondary text well clear of AA', () => {
    for (const surface of SURFACES) {
      expect(contrast(colors.muted, surface)).toBeGreaterThanOrEqual(5);
    }
  });

  /** The regression this catches by name: faint used to be #8a939e, at 3.1:1. */
  it('keeps the quietest ink above AA on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrast(colors.faint, surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#8a939e', colors.surface)).toBeLessThan(4.5);
  });

  it('preserves the ordering of the ink ramp', () => {
    const onSurface = (c: string) => contrast(c, colors.surface);
    expect(onSurface(colors.text)).toBeGreaterThan(onSurface(colors.textSecondary));
    expect(onSurface(colors.textSecondary)).toBeGreaterThan(onSurface(colors.muted));
    expect(onSurface(colors.muted)).toBeGreaterThan(onSurface(colors.faint));
  });

  it('keeps text on a coloured fill readable', () => {
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.inkInverse, colors.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every status badge readable on its own soft background', () => {
    for (const [name, pair] of Object.entries(statusColor)) {
      expect(`${name}:pass`).toBe(
        contrast(pair.fg, pair.bg) >= 4.5 ? `${name}:pass` : `${name}:FAIL`,
      );
    }
  });

  it('keeps every status rail visible against the row surface', () => {
    for (const [name, pair] of Object.entries(statusColor)) {
      expect(`${name}:pass`).toBe(
        contrast(pair.fg, colors.surface) >= 3 ? `${name}:pass` : `${name}:FAIL`,
      );
    }
  });
});

describe('status vocabulary', () => {
  it('gives every label a colour', () => {
    for (const code of Object.keys(STATUS_LABEL)) {
      expect(statusColor[code as keyof typeof statusColor]).toBeDefined();
    }
  });

  it('keeps the plant’s spoken English vocabulary for equipment (doc 02 §1.2)', () => {
    expect(STATUS_LABEL.NORMAL).toBe('Normal');
    expect(STATUS_LABEL.STANDBY).toBe('Stand By');
    expect(STATUS_LABEL.ON_REPAIR).toBe('On Repair');
    expect(STATUS_LABEL.NEED_REPAIR).toBe('Need Repair');
  });

  it('keeps task vocabulary Indonesian', () => {
    expect(STATUS_LABEL.IN_PROGRESS).toBe('Dikerjakan');
    expect(STATUS_LABEL.DONE).toBe('Selesai');
    expect(STATUS_LABEL.CANCELLED).toBe('Dibatalkan');
  });

  it('keeps the three shift slots (doc 02 §1.3)', () => {
    expect(SHIFT_TIME_LABEL).toEqual({ pagi: 'Pagi', sore: 'Sore', malam: 'Malam' });
  });
});
