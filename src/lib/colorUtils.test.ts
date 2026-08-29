import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  getBrightness,
  getContrastColor,
  getEventTileTextColor,
  getTextStyle,
  getSubtitleStyle,
  isDarkBackground,
  isUnsetBackgroundColor,
  lightTintGroupBackgroundColor,
  resolveGroupBackgroundColor,
  resolveGroupGround,
  groupInkVars,
  storedGroupColour,
  SUBTEXT_MUTED_ON_DARK,
  SUBTEXT_MUTED_ON_LIGHT,
} from './colorUtils';
import { GROUP_COLOUR_PRESETS } from './groupColourPresets';
import { logger } from './logger';
import { contrastRatio, lStar } from './wcag';

/**
 * Phase 88-22 / D-28. The defect these lock down: a group with no background
 * colour resolved to literal white and got it applied as an INLINE background,
 * which beats the themed `bg-surface-*` class — so the card rendered white
 * inside the dark UI and its muted secondary line became nearly invisible.
 *
 * The contract is therefore two-sided:
 *   1. no group colour  -> no inline background at all (theme wins), and text
 *      comes from `var(--color-content-*)` tokens;
 *   2. a real group colour -> the brightness algorithm is untouched, including
 *      the two tiers that are unreachable with today's all-dark presets (D-29).
 */

const UNSET_VALUES = [null, undefined, '', '#ffffff', '#FFFFFF', '#fff', '#FFF', '  #ffffff  '];

describe('isUnsetBackgroundColor', () => {
  it.each(UNSET_VALUES)('treats %p as unset', (value) => {
    expect(isUnsetBackgroundColor(value)).toBe(true);
  });

  it.each(['#1e1e2e', '#172554', '#14332a', '#fffffe'])('treats %p as a real colour', (value) => {
    expect(isUnsetBackgroundColor(value)).toBe(false);
  });

  it('does not throw on a non-string', () => {
    // The cast is the point: the contract says string, the guard exists anyway
    // because this value comes off an API response.
    expect(isUnsetBackgroundColor(42 as unknown as string)).toBe(true);
  });
});

describe('resolveGroupBackgroundColor', () => {
  it.each(UNSET_VALUES)('returns null for %p so the themed class wins', (value) => {
    expect(resolveGroupBackgroundColor(value)).toBeNull();
  });

  it('passes a real group colour through untouched', () => {
    expect(resolveGroupBackgroundColor('#3b1030')).toBe('#3b1030');
  });
});

describe('getTextStyle — no group colour (D-28)', () => {
  it.each(UNSET_VALUES)('returns a content token, never literal white, for %p', (value) => {
    const style = getTextStyle(false, value);
    expect(style.color).toBe('var(--color-content-primary)');
    expect(style.textShadow).toBe('none');
    expect(style.WebkitTextStroke).toBeUndefined();
  });

  it('still uses the outlined white treatment behind a background image', () => {
    const style = getTextStyle(true, null);
    expect(style.color).toBe('#ffffff');
    expect(style.WebkitTextStroke).toBeTruthy();
  });
});

describe('getSubtitleStyle — no group colour (D-28, the half that was missed)', () => {
  it.each(UNSET_VALUES)('returns the secondary content token for %p', (value) => {
    const style = getSubtitleStyle(false, value);
    expect(style.color).toBe('var(--color-content-secondary)');
    expect(style.textShadow).toBe('none');
  });
});

describe('getEventTileTextColor — no group colour', () => {
  it.each(UNSET_VALUES)('returns the primary content token for %p', (value) => {
    expect(getEventTileTextColor(value)).toBe('var(--color-content-primary)');
  });

  it('still returns tile blue on a light colour and white on a dark one', () => {
    expect(getEventTileTextColor('#e5e7eb')).toBe('#1e40af');
    expect(getEventTileTextColor('#1e1e2e')).toBe('#ffffff');
  });
});

describe('the brightness algorithm is untouched (D-29)', () => {
  it('computes the W3C weighted brightness', () => {
    expect(getBrightness('#000000')).toBe(0);
    expect(getBrightness('#ffffff')).toBe(255);
    // (255*299 + 0 + 0) / 1000
    expect(getBrightness('#ff0000')).toBeCloseTo(76.245, 3);
  });

  it('returns the light default for unusable input', () => {
    expect(getBrightness('nope')).toBe(255);
    expect(getBrightness(null)).toBe(255);
  });

  it('keeps both currently-unreachable light tiers alive', () => {
    // brightness > 180 tier: subtle light outline
    expect(getSubtitleStyle(false, '#f3f4f6').color).toBe('#374151');
    // 128 < brightness <= 180 tier: the softer medium-light shade
    expect(getSubtitleStyle(false, '#9ca3af').color).toBe('#4b5563');
    // dark tier
    expect(getSubtitleStyle(false, '#1e1e2e').color).toBe('rgba(255, 255, 255, 0.95)');
  });

  it('keeps the three title tiers distinct', () => {
    expect(getTextStyle(false, '#f3f4f6').textShadow).toContain('-1px -1px 2px rgba(255, 255, 255, 0.8)');
    expect(getTextStyle(false, '#9ca3af').textShadow).toBe('1px 1px 3px rgba(255, 255, 255, 0.9)');
    expect(getTextStyle(false, '#1e1e2e').color).toBe('#ffffff');
  });

  it('getContrastColor is unchanged for real colours', () => {
    expect(getContrastColor('#f3f4f6')).toBe('#1f2937');
    expect(getContrastColor('#1e1e2e')).toBe('#ffffff');
  });
});


/* ---------------------------------------------------------------------------
 * Phase 88.3 (D-08/D-09, Req 9) — RE-POINTED by Phase 88.3.1 (SPEC Req 4).
 *
 * The presets are read OUT OF the shipped module by PARSING ITS SOURCE rather
 * than restated here, and that mechanism survives the re-point unchanged — only
 * the path, the block regex and the entry regex moved. A restated copy drifts
 * silently: the whole point of the `isDarkBackground(p.dark) === true` pin at
 * the bottom of this file is that a future palette edit must red THIS file, and
 * it can only do that if this file reads the shipped table.
 *
 * (The `import { GROUP_COLOUR_PRESETS }` above is a convenience for the
 * `groupInkVars` cases and is NOT a substitute for this parse: the parse is
 * what fails loudly if the array is renamed, removed, or reshaped, which an
 * import would simply fail to compile on without saying why.)
 *
 * WHAT CHANGED IN 88.3.1. A group's stored value is now a PRESET ID, and an id
 * resolves to a hand-tuned two-value row — nothing is computed for it. So the
 * tint assertions below re-scope onto the eight LEGACY hexes (the compatibility
 * path, UI-SPEC 3.2) and a NEW set of preset-table assertions sits beside them.
 * Neither replaces the other; both are live coverage.
 * ------------------------------------------------------------------------- */

const PRESET_SOURCE = fs.readFileSync(
  path.resolve(__dirname, './groupColourPresets.ts'),
  'utf8',
);

type ParsedPreset = {
  name: string;
  label: string;
  dark: string;
  light: string;
  inkDark: string;
  inkLight: string;
  mutedDark: string;
  mutedLight: string;
};

const PRESETS: ParsedPreset[] = (() => {
  const block = PRESET_SOURCE.match(
    /const GROUP_COLOUR_PRESETS = \[([\s\S]*?)\] as const;/,
  );
  if (!block) throw new Error('GROUP_COLOUR_PRESETS not found in groupColourPresets.ts');
  const hex = String.raw`(#[0-9a-fA-F]{6})`;
  const rowRe = new RegExp(
    String.raw`\{\s*name:\s*'([^']+)',` +
      String.raw`\s*label:\s*'([^']+)',` +
      String.raw`\s*dark:\s*'${hex}',` +
      String.raw`\s*light:\s*'${hex}',` +
      String.raw`\s*inkDark:\s*'${hex}',` +
      String.raw`\s*inkLight:\s*'${hex}',` +
      String.raw`\s*mutedDark:\s*'${hex}',` +
      String.raw`\s*mutedLight:\s*'${hex}',` +
      String.raw`\s*\}`,
    'g',
  );
  return [...block[1].matchAll(rowRe)].map((m) => ({
    name: m[1],
    label: m[2],
    dark: m[3],
    light: m[4],
    inkDark: m[5],
    inkLight: m[6],
    mutedDark: m[7],
    mutedLight: m[8],
  }));
})();

/**
 * The eight LEGACY preset hexes — the values the `GroupSettings.js` swatch
 * array shipped from Phase 88-22 until this phase, and the values still sitting
 * in the `background_color` column of every coloured group in production.
 *
 * They are a FROZEN LITERAL here rather than read from source, and that is the
 * one place in this file where a restated copy is right: they are history, not
 * a live table. They cannot drift, because nothing may edit them — the picker
 * no longer offers them and plan 88.3.1-05's remap converts them. The only
 * thing that can change is that a row STOPS existing in production, which is a
 * migration event, not a source edit.
 */
const LEGACY_HEXES: { name: string; value: string }[] = [
  { name: 'Charcoal', value: '#1e1e2e' },
  { name: 'Slate', value: '#1e293b' },
  { name: 'Navy', value: '#172554' },
  { name: 'Indigo', value: '#1e1b4b' },
  { name: 'Forest', value: '#14332a' },
  { name: 'Wine', value: '#3b1030' },
  { name: 'Espresso', value: '#2c1f14' },
  { name: 'Storm', value: '#27272a' },
];

/**
 * The owner-ruled tint strength (2026-08-25, plan adversarial review round 2 —
 * amended from 0.87 because at 0.87 the eight presets had converged to pairwise
 * 1.01:1 and were no longer told apart). SPEC Req 9's acceptance floor moved
 * with it, from `L* >= 85` to `L* >= 75`.
 */
const T = 0.7;
const L_STAR_FLOOR = 75;

describe('lightTintGroupBackgroundColor — Phase 88.3 D-09, re-scoped to the LEGACY path', () => {
  it('reads all eight shipped presets out of groupColourPresets.ts', () => {
    // anti-vacuity: every per-preset assertion below is an it.each over a list
    expect(PRESETS).toHaveLength(8);
  });

  it('still covers all eight legacy hexes, which are the LIVE fallback in production', () => {
    // Until plan 88.3.1-05's remap runs, every coloured group in production is
    // one of these — and a custom hex can reach this path at any time after.
    expect(LEGACY_HEXES).toHaveLength(8);
  });

  it.each(UNSET_VALUES)('returns null for %p so the themed surface still wins (D-28)', (value) => {
    expect(lightTintGroupBackgroundColor(value)).toBeNull();
  });

  it.each([
    42 as unknown as string,
    {} as unknown as string,
    [] as unknown as string,
    'not-a-colour',
    '#12',
    '#12345',
    '#1234567',
    '#gggggg',
    'rgb(1,2,3)',
  ])('returns null and does not throw for malformed input %p', (value) => {
    expect(() => lightTintGroupBackgroundColor(value)).not.toThrow();
    expect(lightTintGroupBackgroundColor(value)).toBeNull();
  });

  it.each(LEGACY_HEXES)('$name tints to a well-formed 6-digit hex', ({ value }) => {
    // Re-scoped by 88.3.1: this is the COMPATIBILITY path now, not the preset
    // path. A preset id never reaches this function.
    expect(lightTintGroupBackgroundColor(value)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(LEGACY_HEXES)(`$name clears the amended SPEC Req 9 floor (L* >= ${L_STAR_FLOOR})`, ({ value }) => {
    const tinted = lightTintGroupBackgroundColor(value);
    expect(lStar(tinted)).toBeGreaterThanOrEqual(L_STAR_FLOOR);
  });

  it.each(LEGACY_HEXES)('$name keeps the muted pole above 4.5:1 on its own tint (R2-6)', ({ value }) => {
    // KEPT, not re-pointed. This is the only contrast guard on the LIVE fallback
    // ink path: groupInkVars returns {} for a legacy hex on a card, so the
    // consumer's plain poles are what get drawn on exactly this tinted ground,
    // for every coloured group in production until BE PR-2 lands and permanently
    // for any non-preset hex. The new light-surface cases below are a SECOND
    // coverage set, not a replacement — deleting this one is a decision
    // requiring its own `DECISION Phase 88.3.1` marker, not a cleanup.
    // (#6b7280, the pre-repoint pole, measures 2.5-2.65 here and FAILS.)
    const tinted = lightTintGroupBackgroundColor(value);
    expect(contrastRatio(SUBTEXT_MUTED_ON_LIGHT, tinted)).toBeGreaterThanOrEqual(4.5);
  });

  it('re-points the muted-on-light pole to the darker slate (R2-6)', () => {
    expect(SUBTEXT_MUTED_ON_LIGHT).toBe('#374151');
  });

  it('reproduces the owner-ruled t = 0.70 measurement table exactly', () => {
    // KEPT and re-scoped, not deleted. The table now pins the tints of the eight
    // LEGACY hexes as the shipped compatibility path — those hexes are still in
    // production until plan 88.3.1-05's migration runs, and a custom hex can
    // reappear at any time. Deleting it would remove the only guard on the
    // fallback arithmetic.
    const measured = Object.fromEntries(
      LEGACY_HEXES.map(({ name, value }) => [name, lightTintGroupBackgroundColor(value)]),
    );
    expect(measured).toEqual({
      Charcoal: '#bcbcc0',
      Slate: '#bcbfc4',
      Navy: '#b9becc',
      Indigo: '#bcbbc9',
      Forest: '#b9c2bf',
      Wine: '#c4b7c1',
      Espresso: '#c0bcb9',
      Storm: '#bebebf',
    });
  });

  it('asks isUnsetBackgroundColor about the STORED value, never the rendered one (Pitfall 8)', () => {
    // A legacy #fefefe is a REAL colour that happens to tint to exactly white.
    // Re-checking "is unset?" on the rendered ground would strip that group's
    // background entirely — hence the JSDoc rule and this test.
    expect(isUnsetBackgroundColor('#fefefe')).toBe(false);
    expect(lightTintGroupBackgroundColor('#fefefe')).toBe('#ffffff');
    expect(isUnsetBackgroundColor(lightTintGroupBackgroundColor('#fefefe'))).toBe(true);
  });

  it('clamps t into [0, 1] and defaults to the owner-ruled 0.70', () => {
    expect(lightTintGroupBackgroundColor('#000000', -5)).toBe('#000000');
    expect(lightTintGroupBackgroundColor('#000000', 5)).toBe('#ffffff');
    expect(lightTintGroupBackgroundColor('#000000', 0)).toBe('#000000');
    expect(lightTintGroupBackgroundColor('#000000', 1)).toBe('#ffffff');
    expect(lightTintGroupBackgroundColor('#1e1e2e')).toBe(
      lightTintGroupBackgroundColor('#1e1e2e', T),
    );
  });

  it('accepts a hex with or without the leading # and either case', () => {
    expect(lightTintGroupBackgroundColor('1e1e2e')).toBe('#bcbcc0');
    expect(lightTintGroupBackgroundColor('#1E1E2E')).toBe('#bcbcc0');
    expect(lightTintGroupBackgroundColor('  #1e1e2e  ')).toBe('#bcbcc0');
  });
});

describe('the two-value preset table renders through the right brightness tiers (UI-SPEC 10.1 test 11)', () => {
  it.each(PRESETS)('$name — light surface $light is in the > 180 tier', ({ light }) => {
    // Replaces the 88.3 assertion that the computed TINT cleared 180. The
    // margin is no longer thin: the light surfaces measure 211-227, i.e. 31-47
    // points of headroom, where 88.3's tints cleared by only 8-11.
    expect(getBrightness(light)).toBeGreaterThan(180);
    expect(getTextStyle(false, light).color).toBe('#1f2937');
  });

  it.each(PRESETS)('$name — dark band $dark is in the <= 128 tier', ({ dark }) => {
    // 32-47 measured, i.e. 81-96 points of margin below the threshold.
    expect(getBrightness(dark)).toBeLessThanOrEqual(128);
    expect(getTextStyle(false, dark).color).toBe('#ffffff');
  });

  it.each(PRESETS)('$name — the muted pole clears 4.5:1 on the LIGHT SURFACE', ({ light }) => {
    // The phase's real target, added as NEW cases beside the legacy-tint set
    // above rather than replacing it. Measured 7.61-7.68:1 across the eight.
    expect(contrastRatio(SUBTEXT_MUTED_ON_LIGHT, light)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('every shipped preset’s DARK BAND is dark (pins groupHomePage’s light arm)', () => {
  // `groupHomePage/page.js:661-670` builds a dark-ground text arm for the header
  // on the assumption that every preset's rendered DARK-mode ground is dark, and
  // names THIS test as its only guard. If a future palette edit ever ships a
  // genuinely light `dark` band, that assumption becomes wrong silently — the
  // header would paint white-on-light. This is the tripwire: it must go red
  // HERE, in the shared colour module, before that code inherits the wrong
  // premise.
  //
  // Re-pinned by 88.3.1 from the single stored hex to the table's `dark` band.
  // Deleting it removes groupHomePage's only guard: a decision, not a cleanup.
  it.each(PRESETS)('$name ($dark) is dark, so the dark-ground text arm applies', ({ dark }) => {
    expect(isDarkBackground(dark)).toBe(true);
  });
});



/* ---------------------------------------------------------------------------
 * Phase 88.3.1 (SPEC Req 4, CONTEXT D-04) — the ONE resolver, and the one
 * accessor that feeds it.
 *
 * Six render sites plus the settings seed used to each do their own
 * `resolveGroupBackgroundColor` + `lightTintGroupBackgroundColor` pair. Project
 * tenet: "writing a function 6 times is adding tech debt". These two functions
 * are the single implementation those seven sites move onto in plans
 * 88.3.1-07/08/09.
 * ------------------------------------------------------------------------- */

describe('storedGroupColour — the one accessor for a group’s stored colour', () => {
  it('prefers the new color_preset id over the legacy background_color', () => {
    expect(storedGroupColour({ color_preset: 'blue', background_color: '#1e1e2e' })).toBe('blue');
  });

  it('falls back to background_color when color_preset is absent or null', () => {
    expect(storedGroupColour({ background_color: '#1e1e2e' })).toBe('#1e1e2e');
    expect(storedGroupColour({ color_preset: null, background_color: '#1e1e2e' })).toBe('#1e1e2e');
  });

  it('uses ?? not || — an EMPTY color_preset must NOT fall through to background_color', () => {
    // plan 88.3.1-02's validator still accepts '' and whitespace, so `||` here
    // would mask exactly the bad data AMENDMENT T is fixing: the row would
    // silently render its legacy hex and nobody would ever see the empty id.
    expect(storedGroupColour({ color_preset: '', background_color: '#1e1e2e' })).toBeNull();
    expect(storedGroupColour({ color_preset: '   ', background_color: '#1e1e2e' })).toBeNull();
  });

  it('trims, and normalises a trimmed-empty result to null so the unset-first rule fires', () => {
    expect(storedGroupColour({ color_preset: '  blue  ' })).toBe('blue');
    expect(storedGroupColour({ background_color: '   ' })).toBeNull();
  });

  it('returns null for a group with neither, and does not throw on a missing group', () => {
    expect(storedGroupColour({})).toBeNull();
    expect(storedGroupColour(null)).toBeNull();
    expect(storedGroupColour(undefined)).toBeNull();
  });
});

describe('resolveGroupGround — Phase 88.3.1 SPEC Req 4 / D-04', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a preset id to its dark band, light surface and BOTH inks', () => {
    expect(resolveGroupGround('blue')).toEqual({
      preset: 'blue',
      dark: '#00274d',
      light: '#c4e1ff',
      inkDark: '#8ac2fb',
      inkLight: '#033f6f',
    });
  });

  it.each(UNSET_VALUES)('returns null for %p so the themed surface still wins (D-28)', (value) => {
    expect(resolveGroupGround(value)).toBeNull();
  });

  it('returns null for a whitespace-only stored value', () => {
    expect(resolveGroupGround('  ')).toBeNull();
  });

  it('asks isUnsetBackgroundColor of the STORED value, so #fefefe still gets a ground (Pitfall 8)', () => {
    // #fefefe is a real colour that tints to exactly #ffffff. Asking "is unset?"
    // of the RENDERED value would strip this group's ground entirely.
    const ground = resolveGroupGround('#fefefe');
    expect(ground).not.toBeNull();
    expect(ground!.dark).toBe('#fefefe');
    expect(ground!.light).toBe('#ffffff');
  });

  it('falls a non-preset hex back to the t = 0.70 tint, with NO ink', () => {
    expect(resolveGroupGround('#123456')).toEqual({
      preset: null,
      dark: '#123456',
      light: '#b8c2cc',
      inkDark: null,
      inkLight: null,
    });
    expect(resolveGroupGround('#123456')!.light).toBe(lightTintGroupBackgroundColor('#123456', 0.70));
  });

  it('normalises the legacy arm’s dark ground to #rrggbb, so it is never half-rendered', () => {
    // lightTintGroupBackgroundColor deliberately tolerates a missing '#' and
    // upper case. Echoing the raw stored value would hand the cascade `1e1e2e`
    // for --group-ground while --group-ground-light got a valid `#bcbcc0` —
    // coloured in light mode, uncoloured in dark. That is the half-rendered
    // outcome the "both grounds or neither" return type exists to prevent.
    expect(resolveGroupGround('1e1e2e')!.dark).toBe('#1e1e2e');
    expect(resolveGroupGround('#1E1E2E')!.dark).toBe('#1e1e2e');
    expect(resolveGroupGround('  #1e1e2e  ')!.dark).toBe('#1e1e2e');
  });

  it('matches the stored id trimmed and case-insensitively — it round-trips through a database', () => {
    expect(resolveGroupGround('BLUE')).toEqual(resolveGroupGround('blue'));
    expect(resolveGroupGround('  blue  ')).toEqual(resolveGroupGround('blue'));
  });

  it('takes exactly ONE argument — no theme, ever (88.3 D-09 REJECTED (2), still binding)', () => {
    expect(resolveGroupGround.length).toBe(1);
  });

  it('returns BOTH grounds or null — never a half-populated object (T-88.3-43)', () => {
    for (const value of ['blue', '#123456', '#fefefe', 'sunset', null, '#ffffff']) {
      const ground = resolveGroupGround(value);
      if (ground === null) continue;
      expect(ground.dark).toBeTruthy();
      expect(ground.light).toBeTruthy();
    }
  });

  it('warns exactly once and returns null for a stored value that is neither preset nor hex (M23)', () => {
    // The realistic trigger is poly-repo deploy skew: BE ships a ninth preset
    // first, accepts and stores it, and the older FE renders every group using
    // it uncoloured with no error, no log and no telemetry. This is the SECOND
    // layer; plan 88.3.1-02's cross-repo id contract test is the first.
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(resolveGroupGround('sunset')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('unrecognised stored group colour');
    expect(warn.mock.calls[0][1]).toEqual({ stored: 'sunset' });
  });

  it('truncates the warned value, so an oversized stored string cannot bloat the payload', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    resolveGroupGround('x'.repeat(200));
    expect(warn.mock.calls[0][1]!.stored).toHaveLength(32);
  });

  it('does NOT warn on the legacy-hex arm — that arm is valid, supported and LIVE in production', () => {
    // Every coloured group in production renders through the legacy arm for the
    // entire window between the FE PR and BE PR-2. Wiring the warn to it would
    // flood Sentry for that whole window and train everyone to ignore it.
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    resolveGroupGround('#123456');
    resolveGroupGround('blue');
    resolveGroupGround(null);
    resolveGroupGround('#ffffff');
    expect(warn).not.toHaveBeenCalled();
  });
});


/* ---------------------------------------------------------------------------
 * Phase 88.3.1 (D-04, UI-SPEC 3.3/3.4) — the ONE ink function.
 *
 * Card versus tile is an ARGUMENT, never a second copy. The four properties are
 * newly minted (`--group-ink*`) rather than reusing `themedTextStyleVars`'s
 * `--t-*` channel: 5 of that channel's 7 existing emissions sit on a DESCENDANT
 * of where these land, and a descendant redeclaration wins (AMENDMENT 1).
 * ------------------------------------------------------------------------- */

describe('groupInkVars — Phase 88.3.1 D-04 / UI-SPEC 3.4', () => {
  const CARD = { surface: 'card', hasBackgroundImage: false } as const;
  const TILE = { surface: 'tile', hasBackgroundImage: false } as const;

  it('takes exactly TWO parameters — the ground and the options (never two copies)', () => {
    expect(groupInkVars.length).toBe(2);
  });

  it('returns the four tinted values for blue on a CARD, read from the table', () => {
    expect(groupInkVars(resolveGroupGround('blue'), CARD)).toEqual({
      '--group-ink': '#8ac2fb',
      '--group-ink-l': '#033f6f',
      '--group-ink-muted': '#75abe1',
      '--group-ink-muted-l': '#205785',
    });
  });

  it.each(GROUP_COLOUR_PRESETS)(
    '$name — the CARD values are the table values, never recomputed',
    (preset) => {
      expect(groupInkVars(resolveGroupGround(preset.name), CARD)).toEqual({
        '--group-ink': preset.inkDark,
        '--group-ink-l': preset.inkLight,
        '--group-ink-muted': preset.mutedDark,
        '--group-ink-muted-l': preset.mutedLight,
      });
    },
  );

  it.each(GROUP_COLOUR_PRESETS)(
    '$name — the muted rung the FUNCTION returns clears 4.5:1 on its own ground (UI-SPEC 10.1 test 10)',
    (preset) => {
      // Asserted on the function's OUTPUT, not just on the table: plan 88.3.1-03
      // pins the table, this pins that groupInkVars actually hands those values
      // to the cascade on the right side of the theme fork.
      const vars = groupInkVars(resolveGroupGround(preset.name), CARD);
      expect(contrastRatio(vars['--group-ink-muted'], preset.dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(vars['--group-ink-muted-l'], preset.light)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('emits NO --t-* property of any name — the collision is impossible by construction', () => {
    const emitted = [
      ...Object.keys(groupInkVars(resolveGroupGround('blue'), CARD)),
      ...Object.keys(groupInkVars(resolveGroupGround('blue'), TILE)),
    ];
    expect(emitted.filter((key) => key.startsWith('--t-'))).toEqual([]);
    expect(new Set(emitted)).toEqual(
      new Set(['--group-ink', '--group-ink-l', '--group-ink-muted', '--group-ink-muted-l']),
    );
  });

  it('ignores the ink fields entirely on a TILE and returns the plain poles (owner ruling)', () => {
    // "when it's small like that, you need the text to be more distinct."
    const ground = resolveGroupGround('blue');
    expect(groupInkVars(ground, TILE)).toEqual({
      '--group-ink': '#ffffff',
      '--group-ink-l': '#1e40af',
      '--group-ink-muted': SUBTEXT_MUTED_ON_DARK,
      '--group-ink-muted-l': SUBTEXT_MUTED_ON_LIGHT,
    });
    // and the tinted ink is genuinely NOT what comes back
    expect(groupInkVars(ground, TILE)['--group-ink']).not.toBe(ground!.inkDark);
  });

  it.each(GROUP_COLOUR_PRESETS)('$name — the TILE arm is the plain pole on both bands', (preset) => {
    expect(groupInkVars(resolveGroupGround(preset.name), TILE)).toEqual({
      '--group-ink': '#ffffff',
      '--group-ink-l': '#1e40af',
      '--group-ink-muted': SUBTEXT_MUTED_ON_DARK,
      '--group-ink-muted-l': SUBTEXT_MUTED_ON_LIGHT,
    });
  });

  it('returns {} for a legacy hex on a CARD — it must NOT re-derive (AMENDMENT 3)', () => {
    // grouplist.js:311-314 and groupHomePage/page.js:409-415 have ALREADY computed
    // getTextStyle/getSubtitleStyle against these same grounds in the same render.
    // Re-deriving produces byte-identical values at extra cost, and is the second
    // half of the AMENDMENT 1 collision. {} leaves their themedTextStyleVars
    // output standing — which is the cheaper AND the correct behaviour.
    //
    // This is the LIVE path for the whole FE-deployed window: BE PR-2 merges
    // last, so until the remap runs every production group is a legacy hex.
    expect(groupInkVars(resolveGroupGround('#123456'), CARD)).toEqual({});
    expect(
      groupInkVars(resolveGroupGround('#1e1e2e'), { surface: 'card', hasBackgroundImage: false }),
    ).toEqual({});
  });

  it('still returns the plain poles for a legacy hex on a TILE', () => {
    // The tile arm never reads the ink fields, so their absence changes nothing.
    expect(groupInkVars(resolveGroupGround('#1e1e2e'), TILE)).toEqual({
      '--group-ink': '#ffffff',
      '--group-ink-l': '#1e40af',
      '--group-ink-muted': SUBTEXT_MUTED_ON_DARK,
      '--group-ink-muted-l': SUBTEXT_MUTED_ON_LIGHT,
    });
  });

  it('returns {} with a background image, so the white/stroke treatment stands (AMENDMENT 7)', () => {
    // A group can carry a color_preset AND an uploaded background_image_url at
    // once. getTextStyle(hasBgImage, …) already answers that correctly with
    // white + dark stroke + heavy shadow, because a user's photo is an
    // unmeasurable ground. Emitting blue's #033f6f over an arbitrary photograph
    // is the defect this closes — and it only became reachable once Fork A
    // minted a separate channel, so the two treatments coexist and the consumer
    // must choose.
    expect(
      groupInkVars(resolveGroupGround('blue'), { surface: 'card', hasBackgroundImage: true }),
    ).toEqual({});
    expect(
      groupInkVars(resolveGroupGround('blue'), { surface: 'tile', hasBackgroundImage: true }),
    ).toEqual({});
    // the false case still tints — so the flag is doing the work, not the arm
    expect(
      groupInkVars(resolveGroupGround('blue'), { surface: 'card', hasBackgroundImage: false }),
    ).toEqual({
      '--group-ink': '#8ac2fb',
      '--group-ink-l': '#033f6f',
      '--group-ink-muted': '#75abe1',
      '--group-ink-muted-l': '#205785',
    });
  });

  it('returns {} for no ground at all, so a spread into style emits nothing (D-28)', () => {
    expect(groupInkVars(null, CARD)).toEqual({});
    expect(groupInkVars(resolveGroupGround(null), CARD)).toEqual({});
    expect(groupInkVars(resolveGroupGround('#ffffff'), TILE)).toEqual({});
  });

  it('returns {} for an unrecognised surface rather than guessing an ink', () => {
    expect(
      groupInkVars(resolveGroupGround('blue'), {
        // the cast is the point: the union is a compile-time guard, and this
        // pins the RUNTIME behaviour for a value that gets past it (a `.js`
        // consumer, `checkJs` is false)
        surface: 'swatch' as unknown as 'card',
        hasBackgroundImage: false,
      }),
    ).toEqual({});
  });
});
