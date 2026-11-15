// Phase 88.9-63 (X16 / X17a): one pill family for person, role and RSVP pills.
//
// WHY THIS GATE EXISTS
// --------------------
// The owner's two complaints at the 88.9-51 glance: the OWNER and NO REPLY pills "seem larger
// than the names next to them" (X16), and the pills did not read as one set (X17): Owner was a
// light-only violet that glared on the dark card, No reply melted into the dark card, and Guest
// carried its own edge. The rulings: X16 option D (sentence case, no letter-spacing, 12px, and
// 600 names) and X17a (pick page 10a, 2026-11-14: one fill-and-ink pair per hue, from theme
// tokens, no edges). Maybe on the game page takes the amber pair it shares with Guest (owner
// ruling Q1 A1, 2026-11-14).
//
// The pairs and their WCAG floors are pinned at the token layer by
// src/app/tokenContrast.test.ts ("X17a (88.9): six pill families resolve to the picked pairs"). This suite pins the
// CLASS layer: that every pill in the rostered files paints from the family, that each class
// names a theme key Tailwind really emits, that no raw palette step is left on a pill, that no
// pill carries capitals or letter-spacing, and that the two participant names are 600.
//
// Everything is read from COMMENT-STRIPPED source through stringChunks, so the DECISION and
// AMENDED markers that name the retired classes are never counted.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { declaredColorKeys, lineAt, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const GLOBALS_CSS = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

const FAMILIES = ['green', 'neutral', 'violet', 'blue', 'amber', 'emerald'] as const;
type Family = (typeof FAMILIES)[number];

// One pill = one fill class and one ink class of the SAME family, written adjacent in that order.
const PILL_FILL = /(?:^|[\s"'\x60:])bg-surface-pill-([a-z]+)(?=$|[\s"'\x60/])/g;
const PILL_INK = /(?:^|[\s"'\x60:])text-content-pill-([a-z]+)(?=$|[\s"'\x60/])/g;
const PILL_PAIR = /(?:^|[\s"'\x60:])bg-surface-pill-([a-z]+) text-content-pill-([a-z]+)(?=$|[\s"'\x60/])/g;

// A raw palette fill or ink on one of the five hues the pills used before X17a, with any variant
// prefix (dark:, hover:) and any opacity modifier. Borders are not counted: the guest edge is a
// border on purpose (X27), and a border paints no pill.
const RAW_PALETTE = /(?:^|[\s"'\x60:])(?:bg|text)-(?:purple|blue|emerald|amber|orange)-\d{2,3}(?:\/\d+)?(?=$|[\s"'\x60])/g;

interface PillFile {
  // Uses per family: each is one fill + one ink.
  families: Partial<Record<Family, number>>;
  // Raw palette class strings left in the file ON PURPOSE, each counted exactly.
  exemptLiterals: Record<string, number>;
  why: string;
}

// The roster. A new pill surface is added here by name, with its count: the scan does not walk
// the tree, because a raw palette step elsewhere (the star rating, a group colour swatch) is not
// a pill and is other suites' business.
const PILL_FILES: Record<string, PillFile> = {
  'app/gameDetail/page.js': {
    // 12 pills: RsvpStatusPill's Going (green), Maybe (amber), No and No reply (neutral); the
    // Participants chip's Owner (violet), Admin (blue) and Guest (amber); the See-all row's You
    // (blue), Friend (emerald), Owner (violet), Admin (blue) and Guest (amber).
    families: { green: 1, neutral: 2, violet: 2, blue: 3, amber: 3, emerald: 1 },
    // The past-session chip is OUT of this plan (88.9-65 X47 rebuilds it): its Guest and faction
    // badges sit on a muted chip, not on the card the X17a fills were measured against, so they
    // keep their shipped raw classes until 65 measures fills on the rebuilt chip. Exempt BY NAME
    // and counted: a third raw palette string in this file is a failure, not a rebase.
    exemptLiterals: {
      'bg-orange-100 text-orange-800': 1,
      'bg-purple-100 text-purple-700': 1,
    },
    why: 'the game page: RSVP, role, You, Friend and Guest pills on the Participants chip and the See-all row',
  },
};

interface Scan {
  fills: Record<string, number>;
  inks: Record<string, number>;
  pairs: Record<string, number>;
  mismatched: string[];
  raw: string[];
  exemptSeen: Record<string, number>;
  capitals: string[];
  chunkTexts: string[];
}

function countInto(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function scan(rel: string, entry: PillFile): Scan {
  const stripped = withoutComments(fs.readFileSync(path.join(SRC, rel), 'utf8'));
  const out: Scan = { fills: {}, inks: {}, pairs: {}, mismatched: [], raw: [], exemptSeen: {}, capitals: [], chunkTexts: [] };
  for (const chunk of stringChunks(stripped)) {
    out.chunkTexts.push(chunk.text);
    const where = `${rel}:${lineAt(stripped, chunk.offset)}`;
    for (const m of chunk.text.matchAll(PILL_FILL)) countInto(out.fills, m[1]);
    for (const m of chunk.text.matchAll(PILL_INK)) countInto(out.inks, m[1]);
    for (const m of chunk.text.matchAll(PILL_PAIR)) {
      if (m[1] === m[2]) countInto(out.pairs, m[1]);
      else out.mismatched.push(`${where} pairs a ${m[1]} fill with a ${m[2]} ink`);
    }

    // Strip each exempt literal out of the chunk (counting it), then judge what is left, so a
    // new raw class added beside an exempt one in the same className still fails.
    let residual = chunk.text;
    for (const literal of Object.keys(entry.exemptLiterals)) {
      while (residual.includes(literal)) {
        countInto(out.exemptSeen, literal);
        residual = residual.replace(literal, ' ');
      }
    }
    for (const m of residual.matchAll(RAW_PALETTE)) out.raw.push(`${where} ${m[0].trim()}`);

    if (isCapitalsOrTracking(chunk.text)) out.capitals.push(`${where} ${chunk.text.slice(0, 80)}`);
  }
  return out;
}

const UPPERCASE_TOKEN = /(?:^|[\s:])uppercase(?=\s|$)/;
const TRACKING_TOKEN = /(?:^|[\s:])tracking-[^\s'"\x60]+/;

function isCapitalsOrTracking(text: string): boolean {
  return UPPERCASE_TOKEN.test(text) || TRACKING_TOKEN.test(text);
}

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((n, v) => n + v, 0);
}

describe('Phase 88.9-63 (X16 / X17a): one pill family, sentence case, names 600', () => {
  it('X17a (88.9): every person, role and RSVP pill paints from the pill family, each class names a declared theme key, and no raw palette fill or ink is left on a pill', () => {
    // Controls first, so a scan that has gone blind fails here and not only on a count.
    expect('px-1 bg-surface-pill-violet text-content-pill-violet rounded-sm'.match(PILL_PAIR), 'a pair is seen').toHaveLength(1);
    expect('text-xs bg-purple-100 text-purple-700 dark:bg-blue-900/30'.match(RAW_PALETTE), 'raw fills and inks are seen, with a variant and an opacity').toHaveLength(3);
    expect('border border-dashed border-amber-700 dark:border-amber-500/70'.match(RAW_PALETTE), 'a border is not a pill fill').toBeNull();

    const declared = declaredColorKeys(GLOBALS_CSS);
    for (const [rel, entry] of Object.entries(PILL_FILES)) {
      const got = scan(rel, entry);
      const expected = total(entry.families as Record<string, number>);

      expect(got.mismatched, `${rel}: a pill's fill and ink are one family`).toEqual([]);
      expect(
        got.pairs,
        `${rel} (${entry.why}): pills per family, each written as its fill class then its ink class`,
      ).toEqual(entry.families);
      // Every fill and every ink in the file sits in one of those adjacent pairs: no lone fill
      // (a pill with a raw ink) and no lone ink.
      expect(total(got.fills), `${rel}: ${expected} bg-surface-pill uses`).toBe(expected);
      expect(total(got.inks), `${rel}: ${expected} text-content-pill uses`).toBe(expected);

      for (const family of Object.keys(got.fills)) {
        expect(declared.has(`surface-pill-${family}`), `${rel}: bg-surface-pill-${family} names a colour key globals.css does not declare, so Tailwind emits nothing for it`).toBe(true);
      }
      for (const family of Object.keys(got.inks)) {
        expect(declared.has(`content-pill-${family}`), `${rel}: text-content-pill-${family} names a colour key globals.css does not declare, so Tailwind emits nothing for it`).toBe(true);
      }

      expect(
        got.raw,
        `${rel}: a raw palette fill or ink on a pill is light-only or off the family (X17a). Left on purpose: ${JSON.stringify(entry.exemptLiterals)}`,
      ).toEqual([]);
      expect(got.exemptSeen, `${rel}: the raw palette strings left on purpose, counted exactly`).toEqual(entry.exemptLiterals);
    }

    // Owner ruling Q1 A1 (2026-11-14): the game page's Maybe pill is the amber pair, exactly, and
    // has no token of its own. Putting it back on the warning family is a decision, not a cleanup.
    const gamePage = scan('app/gameDetail/page.js', PILL_FILES['app/gameDetail/page.js']);
    const pillPairChunks = gamePage.chunkTexts.filter((t) => /^bg-surface-pill-[a-z]+ text-content-pill-[a-z]+$/.test(t));
    expect(
      pillPairChunks.sort(),
      'RsvpStatusPill holds three lookup values that are a bare pill pair: Maybe on amber, Going on green, No on neutral',
    ).toEqual([
      'bg-surface-pill-amber text-content-pill-amber',
      'bg-surface-pill-green text-content-pill-green',
      'bg-surface-pill-neutral text-content-pill-neutral',
    ]);
    const stripped = withoutComments(fs.readFileSync(path.join(SRC, 'app/gameDetail/page.js'), 'utf8'));
    expect(
      stripped.split("maybe: { label: 'Maybe', cls: 'bg-surface-pill-amber text-content-pill-amber' }").length - 1,
      'the maybe arm reads the amber pill pair',
    ).toBe(1);
  });

  it('X16 (88.9): no pill carries capitals or letter-spacing, and the roster and participant names are 600', () => {
    expect(isCapitalsOrTracking('text-xs uppercase px-1'), 'capitals are seen').toBe(true);
    expect(isCapitalsOrTracking('text-xs tracking-wider px-1'), 'letter-spacing is seen').toBe(true);
    expect(isCapitalsOrTracking('text-xs px-1.5 py-0.5 rounded-sm font-bold'), 'a sentence-case pill passes').toBe(false);

    for (const [rel, entry] of Object.entries(PILL_FILES)) {
      const got = scan(rel, entry);
      expect(
        got.capitals,
        `${rel}: a pill reads sentence case with no letter-spacing (X16, owner pick D); a class string here still carries the capitals class or a tracking utility`,
      ).toEqual([]);
    }

    // The two participant names take 600 so the name outweighs the 12px pill beside it: the
    // Participants chip's name (it truncates) and the See-all row's name (it wraps in full).
    const gamePage = scan('app/gameDetail/page.js', PILL_FILES['app/gameDetail/page.js']);
    expect(
      gamePage.chunkTexts.filter((t) => t === 'text-content-primary truncate font-semibold'),
      'the Participants chip name is 600',
    ).toHaveLength(1);
    expect(
      gamePage.chunkTexts.filter((t) => t === 'text-content-primary font-semibold'),
      'the See-all row name is 600',
    ).toHaveLength(1);
  });
});
