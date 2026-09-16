// @vitest-environment node
// Reason: this suite is a pure source-TEXT scan — it renders nothing, it needs no DOM, and the
// node environment is materially faster than jsdom for a 194-file walk.
//
// DECISION Phase 88.6 (D-14b / D49-b): the pragma above is PER-FILE, chosen over two alternatives.
//   REJECTED (a) leaving this suite on the global jsdom environment — the DOM is never used here,
//   so the whole jsdom setup cost is paid for nothing on every run.
//   REJECTED (b) changing `environment` in `vitest.config.mts:56` from `'jsdom'` to `'node'` — that
//   would move EVERY suite in the repo, including the many that do render.
// Owner ruling #121 + #123, 2026-09-14, option (b) of that pair (per-file pragma).
//
// CORRECTED AT EXECUTION, and the correction matters because the original claim was a COUNT:
// `88.6-12-PLAN.md` instructed this marker to record that "this is the FIRST `@vitest-environment`
// pragma in the repo". It is not, and was not by the time this file was written. Re-measured
// 2026-09-15 — `grep -rln "@vitest-environment" src` returns THREE files, all landed earlier in
// this same phase: `src/app/groundInk.test.ts` (plan 09), `src/app/errorEnvelopeReads.test.ts`
// (which carries the full rejected-alternatives reasoning at its own `:8-19`), and
// `src/app/components/btnCensus.test.tsx` (plan 10). This file is the FOURTH. The plan's sentence
// was written against a 2026-09-14 census and went stale inside one day; recording the stale number
// would have made this marker the kind of unverifiable claim the project's Evidence Rule exists to
// stop. `vitest.config.mts` is still `environment: 'jsdom'` at `:56` and is byte-unmodified here,
// and `fetchErrorTreatment.test.ts` gains no pragma — the three SHIPPED scan suites that predate
// this phase were deliberately NOT converted.
/**
 * D-14b / D49-b — the THREE-TIER shadow rule, machine-checked.
 *
 * ======================================================================================
 * WHAT "THREE TIERS ONLY" MEANS, AND THE TWO WAYS A SITE LEAVES THE LADDER
 * ======================================================================================
 * The shipped ladder is `--shadow-theme-sm` / `-md` / `-lg` (`globals.css:514-516`), whose
 * values live in plain `:root` (`globals.css:1361-1363` light, `:1765-1767` dark, including
 * the dark `-sm` / `-md` / `-lg` ring re-expression). A site can fall off that ladder in two
 * structurally different ways, and this suite flags both:
 *
 * (a) **THE FOUR UNDECLARED TOKENS — `shadow-xs`, `shadow-xl`, `shadow-2xl`, `shadow-inner`.**
 *     None of `--shadow-xs`, `--shadow-xl`, `--shadow-2xl`, `--shadow-inner` is declared
 *     anywhere in `globals.css` — re-derived 2026-09-15,
 *     `grep -cE '\-\-shadow-(xs|xl|2xl|inner)\s*:' src/app/globals.css` returns **0**. A utility
 *     using one therefore falls through to Tailwind's own default value and lands off the
 *     shipped ladder entirely. This is the genuine FOURTH tier the reference forbids.
 *
 * (b) **THE ALIAS SPELLING — `shadow-sm`, `shadow-md`, `shadow-lg` in every variant form.**
 *
 * ======================================================================================
 * THE ALIAS FAMILY IS *NOT* EQUIVALENT TO `shadow-theme-*`. THIS IS THE LOAD-BEARING FACT.
 * ======================================================================================
 * An earlier draft of this plan carried the opposite claim — that the two spellings resolve to
 * the same bytes — reasoning from the alias declarations alone. That claim is FALSE, and it is
 * NOT encoded anywhere in this suite. The measured fact:
 *
 *   `--shadow-theme-sm|md|lg` reach `--shadow-sm|md|lg` through `var()`, but Tailwind v4
 *   **INLINES the literal values of its own built-in scale into the built-in utilities**
 *   instead of reading the theme property.
 *
 * That sentence is not this file's invention: it is what `DECISION Phase 87.7 (Plan 06,
 * RESEARCH Pitfall 2)` at `globals.css:1281-1295` documents and actively RELIES on — it is the
 * whole reason the three project properties are allowed to sit in plain `:root` wearing v4's
 * built-in names without hijacking the built-in scale. So:
 *
 *   - compiled `.shadow-lg`       = Tailwind's own default (cold black), in BOTH themes;
 *   - compiled `.shadow-theme-lg` = the project's re-tinted warm light value, and in dark the
 *                                   purple hairline + glow.
 *
 * A third, independent confirmation sits in shipped source at `src/components/ui/Switch.tsx:90-102`,
 * which spells out the same asymmetry ("the CUSTOM PROPERTY `--shadow-sm` IS `none` … the UTILITY
 * `.shadow-sm` is NOT `none`. It is Tailwind v4's built-in default") and concludes that the alias
 * spelling "would silently reintroduce a black drop shadow in both".
 *
 * **COUNT SENTENCE, verbatim from the plan and RE-MEASURED at execution 2026-09-15 with this
 * suite's own scanner: 17 utility occurrences across 14 files, plus two comment-prose hits in
 * `Switch.tsx` whose class is already on the tier.** Those two prose hits are corrected in plan 02
 * and are NOT roster entries here — this scanner reads comment-stripped source, so it never sees
 * them, which is exactly why the census and the gate agree. (The retired 19/15 figure counted them.)
 *
 * ======================================================================================
 * RULED — D49-b, owner ruling 2026-09-09, option (i)
 * ======================================================================================
 * The alias family IS off-tier and every one of its occurrences snaps to `shadow-theme-*` inside
 * Phase 88.6, so this scan flags it.
 *
 * RECORDED REJECTED ALTERNATIVE, same date: option (ii), flag only the sites a `Button` migration
 * already touches and schedule the remainder as a follow-up — rejected because it would leave a
 * measured tier violation with no owner. The analysis behind both arms is kept above, not deleted.
 *
 * ======================================================================================
 * WHY THE RULE SHIPS WITH A ROSTER RATHER THAN A SOFTENED PREDICATE
 * ======================================================================================
 * This suite is authored at WAVE 5 and the 17 snaps land across waves 2-9, so a bare "the alias
 * spelling is off-tier" assertion would red on live sites the moment it was written. The rule is
 * therefore full-strength and gated ONLY by a shrinking per-file roster, seeded from a LIVE
 * re-measurement taken at execution, one entry per file, each naming the plan that snaps it.
 * `assertExactCounts` runs in BOTH directions, so:
 *
 *   - a snap that lands WITHOUT deleting its entry reds (fossil permission), and
 *   - a new offender in an unrostered file reds (unowned debt).
 *
 * Because the count is exact both ways, **the roster is its own anti-vacuity companion**.
 *
 * **THE ROSTER MUST BE EMPTY AT PHASE CLOSE.** Plan 46's task 3 verifies that. An entry surviving
 * the phase is a residual needing a disposition, not a pass.
 *
 * ======================================================================================
 * THE SNAP SPELLING — ONE FORM, so every consumer plan follows the same one
 * ======================================================================================
 *   `shadow-sm|md|lg`  ->  `shadow-theme-sm|md|lg`
 *
 *   - a HOVER pin on a `.btn` / `<Button>` element takes plan 05's `enabled-hover:` custom
 *     variant (`globals.css:177-183`): `enabled-hover:shadow-theme-lg`;
 *   - a hover shadow on a NON-button surface (a card `div`) keeps plain `hover:shadow-theme-md`.
 *
 * TWO VISIBLE CONSEQUENCES EVERY CONSUMER PLAN MUST DISCLOSE:
 *   1. `--shadow-sm` renders NOTHING (light `none` since 88.3 Req 3; re-expressed by 88.6-05's N1
 *      as the valid transparent `0 0 #0000`). So a `shadow-sm` -> `shadow-theme-sm` snap REMOVES
 *      Tailwind's black xs shadow. That is a visible change, not a no-op.
 *   2. Every `-lg` / `-md` snap CHANGES HUE: a warm tint in light, a purple hairline + glow in
 *      dark. Also not a no-op.
 *
 * ======================================================================================
 * AC-11 (owner ruling 2026-09-09) and AC-12
 * ======================================================================================
 * The tree is enumerated, read and comment-stripped EXACTLY ONCE, at module scope
 * (`ELEMENTS` below), and every assertion here — both family rules, the hover-pin rule, all three
 * rosters and the anti-vacuity floor — consumes that one result. This is a brand-new full-tree
 * scan with no inherited idiom, so the rule is stated here rather than copied; the shipped
 * reference is `src/app/components/controlSizeFloor.test.tsx`, whose single walk is hoisted to
 * module scope as `SOURCES`. Adding a cache to `src/test-utils/sourceScan.ts` to get the same
 * effect is FORBIDDEN — AC-12, "no shared-module cache this phase".
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type ExemptionRoster,
} from '../test-utils/exemption';
import { readOpeningTag, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/**
 * Strip Tailwind variant prefixes and the `!` important marker.
 *
 * A LOCAL copy of `src/app/surfaceHoverSweep.test.ts:101`, and a constraint rather than a choice:
 * `DECISION Phase 88-29` (quoted in `sourceScan.ts`'s docblock) rejects exporting a lexer from a
 * test file, because a test module's body registers its `describe` blocks on import, and AC-12
 * forbids adding to the shared module this phase. `.planning/WINDOWS.md` entry 12 owns the
 * convergence. It is what makes `hover:shadow-xl` and `hover:shadow-md` both visible to the rules
 * below — a scan that only saw the bare spelling would miss the two live `hover:shadow-xl` sites.
 */
const STRIP_VARIANTS = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/** The genuine fourth tier: four base spellings whose custom properties are undeclared. */
const OFF_TIER = /^shadow-(xs|xl|2xl|inner)$/;
/** The alias spelling: v4's own built-in scale, NOT the project's ladder. See the docblock. */
const ALIAS = /^shadow-(sm|md|lg)$/;

/** The pin the hover-pin rule accepts, and the bare spelling it must NOT accept. */
const PINNED_TIER = 'shadow-theme-lg';
const SATISFYING_HOVER_PIN = 'enabled-hover:shadow-theme-lg';
const BARE_HOVER_PIN = 'hover:shadow-theme-lg';

interface Element {
  rel: string;
  line: number;
  tag: string;
  /** Every whitespace-separated token in the opening tag, raw and variant-stripped. */
  tokens: { raw: string; base: string }[];
}

/**
 * AC-11: the ONE enumeration. 194 non-test files / 3298 readable opening tags, measured
 * 2026-09-15.
 */
const ELEMENTS: Element[] = (() => {
  const out: Element[] = [];
  for (const file of sourceFiles(SRC)) {
    const raw = fs.readFileSync(file, 'utf8');
    const scannable = withoutComments(raw);
    const rel = path.relative(SRC, file);
    // Both DOM tags and components: `<Button`, `<Link`, `<Modal.Action` all matter here.
    const opener = /<[A-Za-z][A-Za-z0-9.]*(?=[\s/>])/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(scannable)) !== null) {
      const tag = readOpeningTag(scannable, match.index);
      if (!tag) continue;
      const tokens = tag
        .split(/[\s"'`{}()]+/)
        .filter(Boolean)
        .map((rawToken) => ({ raw: rawToken, base: rawToken.replace(STRIP_VARIANTS, '') }));
      out.push({ rel, line: raw.slice(0, match.index).split('\n').length, tag, tokens });
    }
  }
  return out;
})();

const FILE_COUNT = new Set(ELEMENTS.map((e) => e.rel)).size;

/** Every element whose opening tag carries a token matching `family`. */
function sitesMatching(family: RegExp): { rel: string; line: number; token: string }[] {
  const out: { rel: string; line: number; token: string }[] = [];
  for (const element of ELEMENTS) {
    for (const { raw, base } of element.tokens) {
      if (family.test(base)) out.push({ rel: element.rel, line: element.line, token: raw });
    }
  }
  return out;
}

/** Per-file occurrence counts, keyed the way `ExemptionRoster` is keyed. */
function countByFile(sites: { rel: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const site of sites) counts[site.rel] = (counts[site.rel] ?? 0) + 1;
  return counts;
}

const D49B: { kind: 'owner'; date: string; ruling: string } = {
  kind: 'owner',
  date: '2026-09-09',
  ruling: 'D49-b (i)',
};

/**
 * Family (b) — the alias roster. Seeded at 17 occurrences across 14 files, LIVE-MEASURED
 * 2026-09-15 with the scanner in this file; **16 across 13 as of plan 88.6-16** (wave 6), which
 * snapped `KebabMenu.js` and deleted its entry in the same commit. `Switch.tsx` is deliberately
 * absent: its two hits are comment prose and its own class is already `shadow-theme-sm`
 * (corrected in plan 02).
 *
 * Every `why` names the plan that SNAPS the file. Deleting an entry without snapping its sites
 * reds (unowned offender); snapping without deleting reds too (fossil permission).
 */
const ALIAS_ROSTER: ExemptionRoster = {
  'app/Header.js': {
    sites: 1,
    why: '`shadow-lg` on the header chrome (:248). Plan 34 snaps it to `shadow-theme-lg`; the -lg snap changes hue in both themes.',
    owner: D49B,
  },
  'app/not-found.tsx': {
    sites: 1,
    why: '`shadow-lg` on the not-found card (:32). Plan 36 snaps it to `shadow-theme-lg` alongside the other two ui/ surfaces it owns.',
    owner: D49B,
  },
  'components/ui/dialog.tsx': {
    sites: 1,
    why: '`shadow-lg` on the dialog content surface (:60). Plan 36 snaps it to `shadow-theme-lg`; it is a non-button surface, so a hover pin here stays plain `hover:`.',
    owner: D49B,
  },
  'components/ui/ErrorFallback.tsx': {
    sites: 1,
    why: '`shadow-lg` on the error-fallback card (:76). Plan 36 snaps it to `shadow-theme-lg` in the same pass as dialog.tsx and not-found.tsx.',
    owner: D49B,
  },
  'app/components/createGroup.js': {
    sites: 3,
    why: 'Three occurrences: `shadow-sm` (:184), and `shadow-sm` + `hover:shadow-lg` on one element (:228). Plan 33 snaps all three. The `shadow-sm` pair is the visible-consequence case — `--shadow-sm` paints nothing, so the snap REMOVES a black xs shadow.',
    owner: D49B,
  },
  'app/components/EventDayModal.js': {
    sites: 1,
    why: '`hover:shadow-md` on a non-button surface (:279), so it keeps the plain `hover:` spelling and becomes `hover:shadow-theme-md`. Plan 27 snaps it. Kept distinct from this file\'s OFF-TIER entry, which is a different class on a different element.',
    owner: D49B,
  },
  'app/components/CalendarListView.js': {
    sites: 1,
    why: '`hover:shadow-md` on a list-row surface (:1057) — non-button, so plain `hover:shadow-theme-md`. Plan 27 snaps it in the same calendar pass as EventDayModal.',
    owner: D49B,
  },
  'app/components/FeedbackButton.js': {
    sites: 1,
    why: '`shadow-lg` on the floating feedback FAB (:258), which IS a `.btn` element — so if plan 31 adds a hover pin it must use `enabled-hover:`, never bare `hover:`.',
    owner: D49B,
  },
  'app/components/tutorial/simulated/AvailabilityPromptDemo.js': {
    sites: 1,
    why: '`shadow-md` on the simulated prompt card (:84). Plan 35 snaps it to `shadow-theme-md`; hue change in both themes, and this is a TUTORIAL surface so the change is user-visible in the walkthrough.',
    owner: D49B,
  },
  // `app/components/grouplist.js` CLOSED by plan 88.6-21 task 1 (wave 7, 2026-09-16): the
  // per-card "Invite Member" CTA's `shadow-md hover:shadow-lg` is now
  // `shadow-theme-md enabled-hover:shadow-theme-lg`. TWO corrections to this entry's own text,
  // recorded rather than absorbed: the element is at `:684`, not `:683` (`:683` is its opening
  // `<button` tag and `:684` was the className), and it IS a `.btn` element — it wears
  // `btn btn-primary` — so the hover half takes plan 05's `enabled-hover:` variant, NOT the
  // "plain `hover:` spelling" this entry prescribed. A bare `hover:` pin here would re-lift a
  // gated control and would not de-dupe against the primitive's `enabled-hover:` base token.
  // Entry DELETED rather than zeroed; the roster is exact in both directions.
  // `app/components/KebabMenu.js` CLOSED by plan 88.6-16 (wave 6, 2026-09-15): the dropdown
  // panel's `shadow-lg` is now `shadow-theme-lg`. Entry DELETED rather than zeroed — the roster
  // is exact in both directions, so a zeroed entry would red as a fossil permission.
  // `app/userProfile/page.js` CLOSED by plan 88.6-17 (wave 7, 2026-09-16): the owned-game card's
  // `hover:shadow-md` is now `hover:shadow-theme-md` — plain `hover:`, because the site is a card
  // `div` and not a `.btn`. Entry DELETED rather than zeroed; the roster is exact in both
  // directions, so a zeroed entry would red as a fossil permission.
  'components/ui/BottomSheet.tsx': {
    sites: 1,
    why: '`shadow-lg` on the bottom-sheet panel (:199). Plan 37 snaps it to `shadow-theme-lg`; non-button surface.',
    owner: D49B,
  },
  // `app/gameDetail/page.js` CLOSED by plan 88.6-18 task 2 (wave 7, 2026-09-16), with
  // `why` = REMOVED WITH THE HAND-ROLLED MENU. Its one alias site was the dropdown panel of
  // the second, hand-rolled kebab; that element no longer exists, and the converged
  // `KebabMenu` carries its own `shadow-theme-lg` (snapped by plan 88.6-16). So the
  // phase-close count plan 46 verifies reads 16 SNAPPED + 1 REMOVED, never 17 snapped.
  // Entry DELETED rather than zeroed; the roster is exact in both directions.
};

/**
 * Family (a) — the off-tier roster, kept SEPARATE from the alias roster above because
 * `EventDayModal.js` appears in both for different classes on different elements. Merging them
 * would make one file's two independent debts share a single count.
 */
const OFF_TIER_ROSTER: ExemptionRoster = {
  'app/components/LandingPage.js': {
    sites: 1,
    why: '`hover:shadow-xl` on the logged-out hero CTA (:23, className at :25) — named by D-14b. `--shadow-xl` is undeclared, so this falls through to Tailwind\'s default. Plan 35 closes it; the element is a `.btn`, so its replacement hover pin takes `enabled-hover:`.',
    owner: { kind: 'spec', id: 'SPEC-88.6 D-14b / UI-SPEC §3.4 rule 1' },
  },
  'app/groupHomePage/page.js': {
    sites: 1,
    why: '`hover:shadow-xl` on the "Plan Game Session" CTA (:894, className at :905) — named by D-14b, same undeclared-token mechanism as LandingPage. Plan 21 closes it; the element is a `.btn`, so `enabled-hover:` is the pin spelling.',
    owner: { kind: 'spec', id: 'SPEC-88.6 D-14b / UI-SPEC §3.4 rule 1' },
  },
  'app/components/EventDayModal.js': {
    sites: 1,
    why: '`shadow-xs` on a 40px group-avatar disc (:327). UNNAMED BY D-14b and MARKERLESS — RESEARCH §C.2 Open Question 6. It may well be a deliberate hairline on a small round avatar rather than an oversight, and it is NOT pre-decided here: plan 27 decides it at the site under the tier rule and records the outcome with a DECISION marker either way. This gate\'s job is to make it visible.',
    owner: { kind: 'spec', id: 'SPEC-88.6 D-14b / RESEARCH Open Question 6' },
  },
};

/**
 * UI-SPEC §3.4 rule 2 — the hover-pin roster.
 *
 * WHY THIS BELONGS IN THIS SUITE. After plan 06, `Button`'s cva base emits the PAIR
 * `shadow-theme-sm enabled-hover:shadow-theme-md`. A call site carrying `shadow-theme-lg` with no
 * hover rule keeps `lg` on hover TODAY; after migration the base's `md` would apply on hover and
 * SHRINK it — an inverted elevation nobody would look for.
 *
 * THE PIN'S SPELLING IS `enabled-hover:shadow-theme-lg`, NOT `hover:shadow-theme-lg`. Plan 05's
 * variant is what keeps a gated control from lifting, so a bare `hover:` pin is itself a defect —
 * and `tailwind-merge` does not see a bare `hover:` token as conflicting with the base's
 * `enabled-hover:` one, so BOTH would survive the merge and the control would still shrink.
 */
const HOVER_PIN_ROSTER: ExemptionRoster = {
  'app/components/LandingPage.js': {
    sites: 1,
    why: 'The hero CTA (:23) carries `shadow-theme-lg` with `hover:shadow-xl` — a bare `hover:` pin AND an off-tier value, so it fails this rule on both counts. Plan 35 replaces it with `enabled-hover:shadow-theme-lg` in the same edit that closes the off-tier entry.',
    owner: { kind: 'spec', id: 'SPEC-88.6 / UI-SPEC §3.4 rule 2' },
  },
  'app/groupHomePage/page.js': {
    sites: 2,
    why: 'Two subjects. `:894` ("Plan Game Session", className `:905`) carries `shadow-theme-lg hover:shadow-xl` — bare `hover:` and off-tier. `:914` (the Add-New-Game-Event `.btn`, className `:921`) carries `shadow-theme-lg` with NO hover rule at all, which is the certain inverted-elevation case RESEARCH §B.1 names. Plan 21 pins both with `enabled-hover:shadow-theme-lg`.',
    owner: { kind: 'spec', id: 'SPEC-88.6 / UI-SPEC §3.4 rule 2' },
  },
};

/** Is this element a `.btn` / `<Button>`, i.e. does the cva base's hover token reach it? */
function isButtonFamily(element: Element): boolean {
  if (/^<Button(?=[\s/>])/.test(element.tag)) return true;
  return element.tokens.some(({ base }) => base === 'btn');
}

/**
 * Does this element carry a satisfying hover pin for its own `shadow-theme-lg`?
 *
 * THE SUBSTRING TRAP, IN BOTH DIRECTIONS — this is why the comparison is an EXACT token match and
 * never `tag.includes('hover:shadow-theme-lg')`:
 *   - `enabled-hover:shadow-theme-lg` CONTAINS `hover:shadow-theme-lg`, so a naive substring check
 *     would report the CORRECT spelling as the defective one... no: worse, it would ACCEPT the bare
 *     spelling and also accept the correct one, making the rule unable to tell them apart at all.
 *   - A boundary-aware exact match on the whole token separates them cleanly.
 * `hoverPinPredicateIsBoundaryAware` below asserts both directions on synthetic strings, so the
 * predicate itself is tested rather than trusted.
 */
function hasSatisfyingHoverPin(tokens: { raw: string }[]): boolean {
  return tokens.some(({ raw }) => raw === SATISFYING_HOVER_PIN);
}

function carriesPinnedTier(tokens: { base: string }[]): boolean {
  return tokens.some(({ base }) => base === PINNED_TIER);
}

describe('D-14b / D49-b: the three-tier shadow rule', () => {
  const offTierSites = sitesMatching(OFF_TIER);
  const aliasSites = sitesMatching(ALIAS);

  it('1. enumerated the tree (anti-vacuity floor for every rule below)', () => {
    // Measured 2026-09-15: 194 non-test files, 3298 readable opening tags. The floor is slack —
    // the shape it must catch is a scan that stopped walking, not a file count that moved.
    expect(
      FILE_COUNT,
      'the scan enumerated only ' +
        FILE_COUNT +
        ' files — every rule below would be silently empty. Check sourceFiles(SRC) and SRC itself.',
    ).toBeGreaterThanOrEqual(150);
    expect(
      ELEMENTS.length,
      `the scan read only ${ELEMENTS.length} opening tags across ${FILE_COUNT} files — the element ` +
        'lexer is not matching. `readOpeningTag` returns null past its length bound; see its own ' +
        'docblock for the measured 16000 default.',
    ).toBeGreaterThan(1000);
  });

  it('2. located shadow-family sites (anti-vacuity companion for family (a))', () => {
    // A rule that matches nothing passes forever. Measured 2026-09-15: 3 off-tier sites
    // (LandingPage.js, groupHomePage/page.js, EventDayModal.js) and 17 alias occurrences.
    expect(
      offTierSites.map((s) => `${s.rel}:${s.line} ${s.token}`),
      'the off-tier scan located fewer than 3 sites. Either the three known live subjects were ' +
        'all closed (in which case delete their roster entries and lower this floor in the same ' +
        'commit, recording why) or the token match broke.',
    ).toHaveLength(3);
    expect(aliasSites.length, 'the alias scan located nothing').toBeGreaterThan(0);
  });

  it('3. flags `shadow-(xs|xl|2xl|inner)` in every variant form (family (a), unconditional rule)', () => {
    // UNCONDITIONAL: no theme property exists for any of these four, so there is no reading under
    // which a site using one is on the ladder. Only the roster absorbs them, and only until its
    // named plan closes each one.
    const measured = countByFile(offTierSites);
    expect(assertRosterShape(OFF_TIER_ROSTER)).toEqual([]);
    expect(
      assertExactCounts(OFF_TIER_ROSTER, measured),
      `off-tier sites found: ${offTierSites.map((s) => `${s.rel}:${s.line} ${s.token}`).join(' | ') || '(none)'}`,
    ).toEqual([]);
  });

  it('4. flags `shadow-(sm|md|lg)` in every variant form (family (b), D49-b option (i))', () => {
    // The rule is FULL STRENGTH. Only the roster shrinks. See the docblock for why the alias
    // spelling is off-tier despite the `var()` chain, and for the count sentence.
    const measured = countByFile(aliasSites);
    expect(assertRosterShape(ALIAS_ROSTER)).toEqual([]);
    expect(
      assertExactCounts(ALIAS_ROSTER, measured),
      `alias-spelled sites found: ${aliasSites.map((s) => `${s.rel}:${s.line} ${s.token}`).join(' | ') || '(none)'}`,
    ).toEqual([]);
  });

  it('5. asserts NO equivalence between `shadow-*` and `shadow-theme-*`, in either direction', () => {
    // A GUARD ON THIS SUITE'S OWN PREMISE. If a later reader "simplifies" the two families into
    // one rule on the grounds that the aliases resolve to the same values, this reds: the two
    // patterns must stay disjoint and neither may match the themed spelling.
    for (const themed of ['shadow-theme-sm', 'shadow-theme-md', 'shadow-theme-lg']) {
      expect(
        ALIAS.test(themed),
        `${themed} matched the ALIAS pattern — the themed spelling is the CORRECT one and must ` +
          'never be flagged. The two spellings are not equivalent (globals.css:1281-1295: v4 ' +
          'inlines its built-in scale into its built-in utilities), and collapsing them is a ' +
          'decision, not a cleanup.',
      ).toBe(false);
      expect(OFF_TIER.test(themed), `${themed} matched the OFF_TIER pattern`).toBe(false);
    }
    for (const alias of ['shadow-sm', 'shadow-md', 'shadow-lg']) {
      expect(ALIAS.test(alias), `${alias} should be flagged as off-tier under D49-b (i)`).toBe(true);
      expect(
        OFF_TIER.test(alias),
        `${alias} matched BOTH families — the two rosters would double-count it`,
      ).toBe(false);
    }
    for (const undeclared of ['shadow-xs', 'shadow-xl', 'shadow-2xl', 'shadow-inner']) {
      expect(OFF_TIER.test(undeclared), `${undeclared} should be flagged`).toBe(true);
      expect(ALIAS.test(undeclared), `${undeclared} matched BOTH families`).toBe(false);
    }
  });

  it('6. the hover-pin predicate is boundary-aware in BOTH directions (the substring trap)', () => {
    // `enabled-hover:` CONTAINS `hover:`. A substring check cannot tell the correct pin from the
    // defective one; an exact token match can. Tested on synthetic strings so the predicate is
    // demonstrated rather than trusted.
    expect(
      hasSatisfyingHoverPin([{ raw: SATISFYING_HOVER_PIN }]),
      `\`${SATISFYING_HOVER_PIN}\` must SATISFY the hover-pin rule`,
    ).toBe(true);
    expect(
      hasSatisfyingHoverPin([{ raw: BARE_HOVER_PIN }]),
      `\`${BARE_HOVER_PIN}\` must NOT satisfy the hover-pin rule — a bare \`hover:\` pin re-lifts a ` +
        'gated control and does not de-dupe against the base\'s `enabled-hover:` token, so BOTH ' +
        'survive the twMerge and the control still shrinks on hover',
    ).toBe(false);
    // And the trap in the other direction: a substring check would accept the bare spelling.
    expect(
      SATISFYING_HOVER_PIN.includes(BARE_HOVER_PIN),
      'the two spellings no longer overlap as substrings — the trap this assertion documents is ' +
        'gone, and the exact-match requirement can be re-examined',
    ).toBe(true);
  });

  it('7. flags a `.btn`/`Button` element carrying `shadow-theme-lg` with no `enabled-hover:` pin (UI-SPEC §3.4 rule 2)', () => {
    const offenders: { rel: string; line: number }[] = [];
    for (const element of ELEMENTS) {
      if (!isButtonFamily(element)) continue;
      if (!carriesPinnedTier(element.tokens)) continue;
      if (hasSatisfyingHoverPin(element.tokens)) continue;
      offenders.push({ rel: element.rel, line: element.line });
    }
    const measured = countByFile(offenders);
    expect(assertRosterShape(HOVER_PIN_ROSTER)).toEqual([]);
    expect(
      assertExactCounts(HOVER_PIN_ROSTER, measured),
      'unpinned shadow-theme-lg buttons found: ' +
        (offenders.map((o) => `${o.rel}:${o.line}`).join(' | ') || '(none)'),
    ).toEqual([]);
  });

  it('8. NEGATIVE CONTROL: a `.btn` carrying `shadow-theme-md` with no hover rule is SAFE and is not flagged', () => {
    // `groupHomePage/page.js:872` ("Manage Members", className `:877`) carries `shadow-theme-md`
    // and no hover shadow. That is SAFE by construction: after migration the cva base gives it
    // `enabled-hover:shadow-theme-md`, i.e. hover resolves to the SAME tier it rests at — no
    // change, no inversion. Only a `-lg` pin can be shrunk by an `-md` base. A rule that flagged
    // this would send plans 21 and 34 chasing a non-defect.
    const mdSites = ELEMENTS.filter(
      (element) =>
        isButtonFamily(element) &&
        element.tokens.some(({ base }) => base === 'shadow-theme-md') &&
        !element.tokens.some(({ base }) => base === PINNED_TIER),
    );
    expect(
      mdSites.map((s) => `${s.rel}:${s.line}`),
      'the `shadow-theme-md` negative-control subject was not located, so rule 7 has no ' +
        'demonstrated lower boundary. Re-find it before changing rule 7 — the shipped subject is ' +
        'the "Manage Members" button in app/groupHomePage/page.js.',
    ).toContain('app/groupHomePage/page.js:872');
    // And it must be absent from rule 7's roster, in BOTH files it could have been filed under.
    for (const [file, entry] of Object.entries(HOVER_PIN_ROSTER)) {
      if (file !== 'app/groupHomePage/page.js') continue;
      expect(
        entry.sites,
        'the groupHomePage hover-pin entry covers 3 sites, which would mean the ' +
          '`shadow-theme-md` control was filed as debt. It carries no `-lg` pin and is safe.',
      ).toBe(2);
    }
  });
});
