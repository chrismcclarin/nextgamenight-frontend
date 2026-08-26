/**
 * Phase 88.3 plan 08 — the text-safe accent sweep (Req 4 / Req 5).
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * `text-accent` resolves to `--color-accent` (amber-500 `#f59e0b`), which is a fine colour on
 * the app's dark chrome and a failing one on every light ground this phase introduced.
 * Measured 2026-08-26 against `src/lib/wcag.ts`: **2.15:1** on the white card, **1.90:1** on the
 * warm-100 page, **1.72:1** on the amber-200 today tint, **1.93:1** on the amber-100 glyph circle
 * and **1.65:1** on a warm-200 pill — against a 4.5:1 text floor and a 3:1 graphical floor.
 *
 * Plan 88.3-04 minted `--color-accent-text` with the design reference's meaning (amber-800 light /
 * amber-500 dark) and bridged it into `@theme inline` as `--color-content-accent`
 * (`globals.css:355-356`). This plan moves the 27 failing call sites onto it. This suite is what
 * stops them drifting back.
 *
 * DECISION Phase 88.3 (Req 4): the zero-offenders test is scoped to an explicit `MIGRATE_FILES`
 * list, chosen OVER a repo-wide `sourceFiles(SRC)` zero-offenders test. A repo-wide gate would
 * demand a WRONG edit: `Header.js`'s five `hover:text-accent` sites sit on `bg-surface-header`
 * (warm-800 `#2d2520` in light, warm-900 in dark) where amber-500 measures **7.00:1** in light and
 * higher in dark. They are correct as shipped in BOTH themes. `88.3-UI-SPEC.md` §5.6.4 states the
 * failure mode in as many words — "write the gate against the migrate list, not against `src`, or
 * it will demand a wrong edit" — so test 5 below asserts the preserved set POSITIVELY: Header.js
 * keeps exactly five and gains none. Widening this scan to `src/` is a decision, not a cleanup.
 *
 * These are SOURCE SCANS, not greps, for the three reasons the rest of the Phase 88 gate ledger
 * records: the lexer crosses newlines (every className in this repo sits on a different line from
 * its opening tag), it recurses into `${...}` interpolations (three of this sweep's sites live in
 * a ternary branch inside a template literal), and it DROPS COMMENTS. The last one is not
 * theoretical: `EventScheduler.tsx:245`, `:248` and `SchedulerWeekStrip.tsx:159` are marker prose
 * quoting `text-accent`, and a grep census reads 35 lines where the class-string population is 32.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, stringChunks } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/**
 * The 17 files this plan edits — the whole population of the sweep, and the whole scope of
 * test 1. Paths are relative to `src/`.
 *
 * NOTE ON THE COUNT: `88.3-08-PLAN.md` says "18 file paths" and its own `files_modified` list
 * yields 17 once the two shipped test files, `ci.yml`, `ci-grep-gate.fixture.test.ts` and this
 * gate are excluded. Re-censused at execution time: 27 sites across **17** files (6 links / 4
 * files, 7 glyphs / 5 files, 14 text+badge sites / 8 files). The floor in test 0 is 17.
 */
const MIGRATE_FILES = [
  // Static-page links (6 sites) — `text-accent underline hover:text-accent-hover` on a white card.
  'app/privacy/page.js',
  'app/terms/page.js',
  'app/about/page.js',
  'app/goodbye/page.tsx',
  // Glyphs on amber-100 circles (7 sites) — 1.93:1 against a 3:1 graphical floor.
  'app/invite/accept/page.js',
  'app/invite/group/[token]/page.js',
  'app/invite/game/[token]/page.js',
  'app/restore/group/[token]/page.tsx',
  'components/ui/EmptyState.tsx',
  // Text on light surfaces (14 sites, incl. the Req 5 today number and the "Owner" badge).
  'app/components/BallotSection.js',
  'app/components/FriendInvitePanel.js',
  'app/components/EventScheduler.tsx',
  'app/components/SchedulerWeekStrip.tsx',
  'app/components/GroupGamesList.js',
  'app/components/ManageMembers.js',
  'app/components/CalendarMonthView.js',
  'app/components/PromptScheduleManager.js',
];

/** `app/Header.js` is deliberately ABSENT from `MIGRATE_FILES` — see the marker above. */
const HEADER = 'app/Header.js';

/** The richer variant strip from `tintTreatment.test.ts:113` — six sites carry `hover:`. */
const VARIANT_PREFIX = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** The base token of a class, with every variant prefix and a leading `!` removed. */
const base = (token: string): string => token.replace(VARIANT_PREFIX, '');

/**
 * Every use of a class whose BASE is exactly one of `tokens`, anywhere in a string literal or a
 * template-literal chunk (comments already dropped by the lexer).
 *
 * The exact-token compare is load-bearing. A substring or `startsWith` test would match
 * `text-accent-text`-shaped names and, worse, would read the migrated `text-content-accent` as a
 * hit under a naive `includes('text-accent')` — test 2 proves it does not.
 */
function classUses(src: string, tokens: string[]): { line: number; text: string }[] {
  const wanted = new Set(tokens);
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    for (const token of text.split(/\s+/).filter(Boolean)) {
      if (wanted.has(base(token))) {
        hits.push({ line: lineAt(src, offset), text: text.trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

/** The offenders: the legacy accent tokens this plan migrates away from. */
export function legacyAccentUses(src: string): { line: number; text: string }[] {
  return classUses(src, ['text-accent', 'text-accent-hover']);
}

/** Count of class tokens written VERBATIM as `token` (variants included), in string chunks. */
function verbatimTokenCount(src: string, token: string): number {
  let n = 0;
  for (const { text } of stringChunks(src)) {
    for (const t of text.split(/\s+/).filter(Boolean)) if (t === token) n += 1;
  }
  return n;
}

describe('Req 4/5 accent sweep — every failing light-surface accent site reads the text-safe amber', () => {
  it('0. the migrate list has not rotted — every path exists, and the roster is whole', () => {
    // A gate whose file list has rotted is a gate that passes on nothing. Both halves matter:
    // a renamed file would make test 1 vacuously green, and a truncated list would shrink the
    // scope silently.
    const missing = MIGRATE_FILES.filter((f) => !fs.existsSync(path.join(SRC, f)));
    expect(missing).toEqual([]);
    expect(MIGRATE_FILES.length).toBeGreaterThanOrEqual(17);
  });

  it('1. no file on the migrate list still reaches for the legacy accent token', () => {
    const offenders: string[] = [];
    for (const file of MIGRATE_FILES) {
      for (const hit of legacyAccentUses(read(file))) {
        offenders.push(`${file}:${hit.line} ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. the detector really matches the token — and is EXACT, not a substring test', () => {
    expect(legacyAccentUses(`const c = "text-accent";`)).toHaveLength(1);
    expect(legacyAccentUses(`<span className="text-xs text-accent font-medium">`)).toHaveLength(1);
    // A ternary branch inside a template interpolation — where three of this sweep's sites live,
    // and a shape an attribute-anchored grep cannot reach (DEF-88-27-01).
    expect(
      legacyAccentUses("const c = `text-[10px] ${today ? 'text-accent' : 'text-content-muted'}`;"),
    ).toHaveLength(1);
    // The hover half of the six static-page links.
    expect(legacyAccentUses(`<a className="text-accent underline hover:text-accent-hover">`))
      .toHaveLength(2);
    // THE EXACT-TOKEN PROOF: the migrated token must yield ZERO. `'text-content-accent'.includes
    // ('text-accent')` is false, but `startsWith`/prefix detectors and a `text-accent(-hover)?`
    // regex without a word boundary both get this wrong, and either would make test 1
    // unsatisfiable — the sweep's own destination would read as an offender.
    expect(legacyAccentUses(`<a className="text-content-accent hover:text-content-accent-hover">`))
      .toEqual([]);
  });

  it('3. marker prose quoting the token does NOT trip the gate', () => {
    // The three real comment shapes on the migrate list: `EventScheduler.tsx:245`/`:248` (block
    // continuation lines starting with a backtick or a word — ci.yml's anchored comment filter
    // drops neither) and `SchedulerWeekStrip.tsx:159`.
    expect(
      legacyAccentUses(
        '/* CONTRAST: the day-number `text-accent` over the light arm measures 1.72:1,\n   against the 4.5:1 AA floor. Phase 88.3 owns the light `text-accent` census.\n*/\nconst x = 1;',
      ),
    ).toEqual([]);
    expect(legacyAccentUses('// a static colour would outrank `text-accent` on today\'s cell'))
      .toEqual([]);
    expect(legacyAccentUses('{/* the glyph moves off text-accent in light mode */}')).toEqual([]);
  });

  it('4. the migration really happened — the positive floor on the destination token', () => {
    // Without this, DELETING the 27 sites would make test 1 pass. Floors sit below the real
    // 27 / 6 on purpose: adding an accent-text site is not a test edit, removing several is.
    let resting = 0;
    let hover = 0;
    for (const file of MIGRATE_FILES) {
      const src = read(file);
      resting += classUses(src, ['text-content-accent']).length;
      hover += classUses(src, ['text-content-accent-hover']).length;
    }
    expect(resting).toBeGreaterThanOrEqual(24);
    expect(hover).toBeGreaterThanOrEqual(5);
  });

  it('5. the PRESERVED set — Header.js keeps its five correct sites and gains none', () => {
    // The assertion that catches an over-broad sweep, and the one a `grep -r src` gate would
    // have got backwards. amber-500 on warm-800 is 7.00:1 in light and higher in dark; these
    // five are correct in BOTH themes. Migrating them would be a regression dressed as
    // consistency.
    const header = read(HEADER);
    expect(verbatimTokenCount(header, 'hover:text-accent')).toBe(5);
    expect(classUses(header, ['text-content-accent', 'text-content-accent-hover'])).toEqual([]);
  });

  it('6. Req 5 — the today ternary moved its TOKEN, not its SHAPE', () => {
    // `DECISION 88-27 D-32` is literal: "token VALUE only, never the ternary shape". Pinned at
    // the production site (`EventScheduler.tsx:998`), paired-ternary and mutually exclusive —
    // NOT a static surface with an appended tint. `tintTreatment.test.ts:269` pins the same
    // shape independently, one layer up.
    const scheduler = read('app/components/EventScheduler.tsx');
    expect(scheduler).toMatch(/today \? 'text-content-accent' : 'text-content-primary'/);
  });
});
