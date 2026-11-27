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
    // AMENDED Phase 88.9-65 (X47, 88.9-63 hand-off b): 12 -> 15. The past-session chip joins the
    // family on its rebuilt card ground: Guest (amber), New Player (neutral) and the faction
    // (violet). Measured on the card with src/lib/wcag.ts, word on fill / fill against the card:
    // amber 5.6360 / 1.2580 light and 5.6471 / 1.9692 dark; violet 5.9744 / 1.4596 and
    // 7.7691 / 1.5107; neutral 7.3453 / 1.4261 and 6.9642 / 1.5231.
    // AMENDED Phase 89.6-30 (N04): 15 -> 6. Owner pick N04 = B moves every tag onto the Pill block
    // (src/components/ui/Pill.tsx ("export const PILL_BOX")), which owns the pairs. Gone from this
    // file in the plan's first step, nine: the RSVP map's three (green, amber, neutral), No reply
    // (neutral), and the See-all row's Friend (emerald), You (blue), Owner (violet), Admin (blue) and
    // Guest (amber). Left until the plan's second step, six: the strip chip's Owner (violet), Admin
    // (blue) and Guest (amber), and the session chip's Guest (amber), New Player (neutral) and the
    // faction (violet).
    families: { neutral: 1, violet: 2, blue: 1, amber: 2 },
    // AMENDED Phase 88.9-65 (X47): the two raw palette strings 88.9-63 left on the past-session
    // chip by name (its orange Guest and its purple faction) are gone with that chip's rebuild, so
    // nothing is exempt here: any raw palette fill or ink in this file is a failure.
    exemptLiterals: {},
    why: 'the game page: RSVP, role, You, Friend and Guest pills on the Participants chip and the See-all row, and the Guest, New Player and faction pills on the past-session chip',
  },
  'app/components/ClickableMemberName.js': {
    // The name popover's two informational pills: Friend (one helper, used by the accepted
    // return and by the success region) and You.
    families: { emerald: 1, blue: 1 },
    exemptLiterals: {},
    why: 'the member-name popover: the Friend pill and the You pill',
  },
  'components/ui/Pill.tsx': {
    // Phase 89.6-30 (owner pick N04 = B): the one block every tag beside a name renders through.
    // It holds each family's pair once, as a whole literal, fill class then ink class.
    families: { green: 1, neutral: 1, violet: 1, blue: 1, amber: 1, emerald: 1 },
    exemptLiterals: {},
    why: 'the shared tag block: one fill-and-ink pair per tone',
  },
  'app/components/GuestPill.tsx': {
    // The one Guest pill the Calendar rows, the upcoming card and the sheet render. The guest
    // EDGE in the same file is a border, which this scan does not count.
    families: { amber: 1 },
    exemptLiterals: {},
    why: 'the shared Guest pill',
  },
};

// A pill fill with an opacity modifier, in any rostered file.
const PILL_FILL_ALPHA = /bg-surface-pill-[a-z]+\/\d/;

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

      expect(
        got.chunkTexts.filter((t) => PILL_FILL_ALPHA.test(t)),
        `${rel}: a pill fill carries no opacity modifier`,
      ).toEqual([]);
    }

    // The Guest pill's ground is OPAQUE in both themes, asserted. Since 88.9-60 (X23a) a picture
    // row has no wash under its text, and 88.9-60 passes this pill no className (owner Q3 A), so
    // on a guest's picture row the pill's own fill is the only thing between its word and the
    // photo. The class has no opacity modifier (above), and the runtime fill is a 6-digit hex in
    // the light block and in the dark block. The same holds for every family, so it is asserted
    // for all six: an alpha fill on any of them lets whatever is behind the pill through its word.
    expect(PILL_FILL_ALPHA.test('ml-2 bg-surface-pill-amber/80 text-content-pill-amber'), 'an opacity modifier is seen').toBe(true);
    const css = withoutComments(GLOBALS_CSS);
    for (const family of FAMILIES) {
      const fillDecls = [...css.matchAll(new RegExp(`--color-pill-${family}-bg\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
      expect(fillDecls, `--color-pill-${family}-bg is declared once per theme`).toHaveLength(2);
      for (const value of fillDecls) {
        expect(value, `--color-pill-${family}-bg is an opaque 6-digit hex in both themes (the Guest pill sits on unwashed photo rows)`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }

    // Owner ruling Q1 A1 (2026-11-14): the game page's Maybe pill is the amber pair, exactly, and
    // has no token of its own. Putting it back on the warning family is a decision, not a cleanup.
    // AMENDED Phase 89.6-30 (N04): the reply map names a TONE and the Pill block holds the pair, so
    // the ruling is read in two places: the three tone literals in the page (each exactly once) and
    // the amber pair behind the amber tone in the block.
    const stripped = withoutComments(fs.readFileSync(path.join(SRC, 'app/gameDetail/page.js'), 'utf8'));
    for (const literal of ["yes: { label: 'Going', tone: 'green' }", "maybe: { label: 'Maybe', tone: 'amber' }", "no: { label: 'No', tone: 'neutral' }"]) {
      expect(stripped.split(literal).length - 1, `RsvpStatusPill holds the lookup value ${literal} exactly once: Maybe on amber, Going on green, No on neutral`).toBe(1);
    }
    const block = withoutComments(fs.readFileSync(path.join(SRC, 'components/ui/Pill.tsx'), 'utf8'));
    expect(
      block.split("amber: 'bg-surface-pill-amber text-content-pill-amber',").length - 1,
      'the amber tone (the maybe arm, and Guest) reads the amber pill pair',
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
    // Participants chip's name and the See-all row's name. Both wrap in full: the chip's name was
    // cut to one line until 88.9-52 R4 D2 (owner 2026-11-18), the marker is at
    // src/app/gameDetail/page.js ("AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the chip's name wraps").
    const gamePage = scan('app/gameDetail/page.js', PILL_FILES['app/gameDetail/page.js']);
    expect(
      gamePage.chunkTexts.filter((t) => t === 'text-content-primary max-w-full wrap-break-word font-semibold'),
      'the Participants chip name is 600, wraps by whole words and is capped at its chip',
    ).toHaveLength(1);
    expect(
      gamePage.chunkTexts.filter((t) => /(^|\s)truncate(\s|$)/.test(t) && /(^|\s)font-semibold(\s|$)/.test(t)),
      'no 600 name on the game page is cut to one line',
    ).toEqual([]);
    expect(
      gamePage.chunkTexts.filter((t) => t === 'text-content-primary font-semibold'),
      'the See-all row name is 600',
    ).toHaveLength(1);
  });

  // 88.9-65 (owner fix row 52-X47). The past-session chip was a one-line flex row on the muted
  // ground: a squeezed piece wrapped inside itself and kept its width, which is the gap the owner
  // saw between a name and its score. It is now a WRAPPING row on the card ground (the strip
  // chip's look, where the pill pairs keep their measured numbers), the Score and placement
  // pieces never break, New Player keeps its no-break, and the name is 600. The browser half (no
  // piece breaks inside itself at 375) is the phone spec e2e/session-chip-wrap.spec.ts.
  it('X47 (88.9-65): the session chip is a wrapping row on the card ground and its score never breaks', () => {
    const stripped = withoutComments(fs.readFileSync(path.join(SRC, 'app/gameDetail/page.js'), 'utf8'));
    const chunks = [...stringChunks(stripped)].map((chunk) => chunk.text);
    const tokensOf = (text: string) => text.split(/\s+/).filter((token) => token.length > 0);

    // The chip itself, exactly once: flex, wrapping, on the card, with the line border.
    const CHIP = 'flex flex-wrap items-center gap-x-2 gap-y-1 max-w-full px-3 py-1 rounded-sm border border-line bg-surface-card text-content-primary';
    expect(chunks.filter((text) => text === CHIP), 'the past-session chip is a wrapping row on the card ground').toHaveLength(1);
    // The retired shape is gone: no class string pairs the muted ground with the line border.
    expect(
      chunks.filter((text) => tokensOf(text).includes('bg-surface-muted') && tokensOf(text).includes('border-line')),
      'no chip is left on the muted ground',
    ).toEqual([]);

    // The Score piece and the placement piece carry the no-break class.
    const scoreClass = /className="([^"]*)">\s*Score: \{formatScore\(participation\.score\)\}/.exec(stripped);
    expect(scoreClass, 'LOCATOR: the Score piece and its className').not.toBeNull();
    expect(tokensOf(scoreClass![1]), 'Score never breaks between its word and its number').toContain('whitespace-nowrap');
    const placementClass = /className="([^"]*)">\s*#\{participation\.placement\}/.exec(stripped);
    expect(placementClass, 'LOCATOR: the placement piece and its className').not.toBeNull();
    expect(tokensOf(placementClass![1]), 'the placement never breaks').toContain('whitespace-nowrap');

    // New Player is the neutral pill and keeps its no-break; the chip name is 600 and may wrap.
    // (No reply on the Participants chip is a neutral no-break pill too, so this one is read whole.)
    const NEW_PLAYER = 'text-xs whitespace-nowrap bg-surface-pill-neutral text-content-pill-neutral px-1.5 py-0.5 rounded-sm font-bold';
    expect(chunks.filter((text) => text === NEW_PLAYER), 'New Player is one neutral pill that never breaks').toHaveLength(1);
    // Phase 89.6-29: the name piece also wraps its own items, holds each to the chip and gives the name a 0px basis
    // (src/app/gameDetail/page.js ("AMENDED Phase 89.6-29 (game-rows): the name piece is a small house row")).
    expect(
      chunks.filter((text) => text === 'inline-flex flex-wrap items-center gap-1 min-w-0 font-semibold break-words [&>*]:max-w-full [&>:first-child]:flex-[1_1_0px]'),
      'the past-session chip name is 600 and wraps instead of being cut',
    ).toHaveLength(1);
  });
});
