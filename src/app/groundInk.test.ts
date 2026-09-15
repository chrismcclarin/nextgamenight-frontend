// @vitest-environment node
// This suite is a pure source-TEXT scan: it renders nothing, never touches the DOM, and the
// node environment is materially faster than the global jsdom one.
//
// DECISION Phase 88.6-09 (#121+#123): the node environment is taken PER FILE via this pragma,
// chosen OVER (a) leaving the suite on the global jsdom environment — rejected, the DOM is
// never used here and every run pays for a document that is never read — and OVER (b) changing
// `environment` in `vitest.config.mts:56` — rejected, that would move EVERY suite, including
// the ones that genuinely render. This is the FIRST `@vitest-environment` pragma in the repo
// (`grep -rn "vitest-environment" src` returned 0 before this file, 2026-09-15); the three
// shipped source-scan suites were deliberately NOT converted, because converting a shipped,
// negative-checked suite is a behaviour change this plan does not declare. Moving this back
// onto jsdom is a decision, not a cleanup.
//
// ===================================================================================
// D-16 / SPEC-88.6 R4 — no `text-content-muted` and no `text-content-link` may resolve
// onto a `bg-surface-muted` ground.
// ===================================================================================
//
// WHY THIS SUITE EXISTS AT ALL
// ----------------------------
// Measured on the muted fill `warm-250 #dbd1c7` (via `src/lib/wcag.ts`, the same `resolve` /
// `expectRatio` machinery `tokenContrast.test.ts` uses):
//
//   text-content-secondary (warm-700)  6.9620  clears AA          <- the prescribed ink
//   text-content-muted     (warm-600)  4.3725  FAILS WCAG 1.4.3
//   text-content-link      (purple-650) 3.9909 FAILS WCAG 1.4.3
//
// Until this file existed, the evidence for that rule was a SENTENCE inside a test comment
// (`tokenContrast.test.ts` test 49's REACH prose) — hand-verified once, never re-checked. It
// could not be a per-line gate, because the ink and the ground sit on DIFFERENT elements: the
// ink is on a child, the ground on an ancestor, and no line-based read can see the pair. That
// is the gap this suite closes, using the ancestor-stack walk 88.6-09 added to the shared lexer.
//
// THE TOKEN IS NOT THE FIX. `--color-text-link` keeps its dL* 7.03 step to its hover, and no
// point on the purple-650 -> purple-700 ramp clears 4.5 on the muted fill while holding
// dL* >= 4. Measured. The fix is at the SITES, which is why this file is a roster that shrinks.
//
// DECLARED LIMITATIONS — what a green run here does NOT prove
// -----------------------------------------------------------
//  * FUNCTION-RETURNED GROUND IS INVISIBLE. `inkGroundPairs` cannot resolve a ground returned
//    from a function body (`${getScoreColor()}`), so `SuggestionCard.js`'s roster UNDERCOUNTS
//    by THREE live AA failures at TWO ratios: `:92` and `:116` are `text-content-muted`
//    (4.3725) and `:122` is `text-content-link` (3.9909). A single ratio for three sites would
//    be wrong on its face. They are carried on the UNRESOLVABLE roster below and MEASURED by
//    their own `it`, not asserted from a hand-written number.
//  * COMPONENT-SET GROUND IS INVISIBLE. A ground applied by a component (`<Card>`) is not a
//    class in any opening tag this walk reads.
//  * ALPHA IS INVISIBLE. The walk resolves TOKENS. An `opacity-*` utility, or a `text-*`/`bg-*`
//    alpha modifier written with a slash, on the ink element OR ON ANY ANCESTOR composites the
//    rendered colour — so a PASS here is NOT a WCAG 1.4.3 pass. Live specimen:
//    `CalendarMonthView.js:246` (`isAdjacent ? 'opacity-60 ' : ''`) over the ink at `:259`
//    (`isAdjacent ? 'text-content-muted' :`), the SAME condition, so genuinely co-live.
//  * RAW-PALETTE INK IS INVISIBLE. Ink written `text-<hue>-<n>` (87 non-test occurrences) is
//    not a semantic token and is `rawColorValues.test.ts`'s and plan 10's territory.
//  * VARIANT-PREFIXED INK IS OUT OF SCOPE, as a declared exclusion and not a silent filter.
//    D-16 is a rule about the RESTING state, so `hover:` / `focus:` / `active:` / `disabled:` /
//    `aria-disabled:` / `group-hover:` / `data-[...]:` ink emits no row at all — exactly as a
//    variant-prefixed GROUND is not a resting ground. Measured 2026-09-15: 31 variant-prefixed
//    occurrences of the forbidden set across non-test `src/`, of 73 variant-prefixed
//    `text-content-*` overall. Test 8 is the twin that keeps this claim from being untested.
//  * CONDITIONAL GROUND FANS OUT. A multi-branch `className` yields several ground candidates
//    and branch liveness is NOT knowable from source, so the class rule hard-fails on
//    `possible` pairings as well as `certain` ones, and pairings that are STRUCTURALLY
//    impossible are excluded BY NAME on the `kind: 'false-positive'` roster below — a DECLARED
//    exclusion, asserted to an exact length and asserted disjoint from the offender roster, so
//    it cannot become a place to hide real debt.
//
// This suite starts RED-SHAPED-AS-EXEMPTIONS and shrinks to an EMPTY roster. Each sweep plan
// flips its own site from "present as an offender" to "absent" and updates BOTH test 1's count
// and test 3's by-name list in the SAME commit.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type Exemption,
  type ExemptionRoster,
} from '../test-utils/exemption';
import {
  FORBIDDEN_INK_CLASSES,
  MUTED_GROUND_CLASS,
  PRESCRIBED_INK_ON_MUTED,
} from '../test-utils/inkRules';
import { inkGroundPairs, sourceFiles } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

// The ink pattern is deliberately WIDER than the forbidden set: test 7's negative control needs
// `text-content-secondary` in the output to prove the rule does not flag its own prescribed
// answer. RESTING ink only — a variant-prefixed class emits no row (see the limitation above
// and mechanism step 4 in `inkGroundPairs`); that skip is what keeps 31 measured
// `hover:`/`disabled:` occurrences out of a roster no sweep plan could ever close.
const INK = /text-content-(muted|link|secondary|accent|primary)/;
const GROUND = /bg-surface-[a-z-]+/;
const MUTED = MUTED_GROUND_CLASS;

// The forbidden set lives in `src/test-utils/inkRules.ts` — ONE list, imported by this suite
// and by `tokenContrast.test.ts` test 49, so the gate and the measurement cannot describe
// different sets. A literal copy here was rejected; see that module's docblock.
const FORBIDDEN = FORBIDDEN_INK_CLASSES;

// DECISION Phase 88.6-09 (AC-11, owner ruling 2026-09-09): the tree is enumerated, read and
// comment-stripped exactly ONCE, here at module scope, and EVERY assertion below consumes this
// constant. This deliberately diverges from the shipped un-hoisted idiom
// (`surfaceHoverSweep.test.ts:133`, `controlSizeFloor.test.tsx:145`, which re-read the tree
// inside a per-assertion helper). REJECTED arm, recorded on the same date: match the shipped
// idiom for consistency — rejected because one full pass measures ~430 ms over the real tree
// (193 non-test files) and this file carries eight assertions, paid again on every `npm test`.
// The divergence is confined to this NEW file; no shipped suite was touched.
//
// THE HOIST IS INTRA-FILE ONLY. `vitest.config.mts` sets `environment: 'jsdom'` at `:56` and
// carries no `isolate` key, so vitest's default per-file isolation stands: no other scan suite
// can reuse this constant, each pays its own full pass, and the phase total is the SUM over
// them — never this file's figure.
interface Row {
  file: string;
  line: number;
  inkToken: string;
  inkChunk: number;
  grounds: { token: string; chunk: number; frameLine: number; copresence: string }[];
}

const FILES = sourceFiles(SRC);
const ROWS: Row[] = FILES.flatMap((file) => {
  const rel = path.relative(SRC, file);
  return inkGroundPairs(fs.readFileSync(file, 'utf8'), { ink: INK, ground: GROUND }).map((r) => ({
    file: rel,
    line: r.line,
    inkToken: r.inkToken,
    inkChunk: r.inkChunk,
    grounds: r.grounds,
  }));
});

/** A SITE is `file:line`, never a row: candidate fan-out must not inflate any count below. */
const siteOf = (r: Row): string => `${r.file}:${r.line}`;
const onMuted = (r: Row): boolean => r.grounds.some((g) => g.token === MUTED);

/** Every forbidden RESTING ink site the walk resolved onto a muted ground, before exclusions. */
const FORBIDDEN_ON_MUTED = ROWS.filter((r) => FORBIDDEN.has(r.inkToken) && onMuted(r));

// ===================================================================================
// The four rosters. They fail INDEPENDENTLY, which is the whole point: test 1 goes green when
// the sites are fixed, test 2 goes red if the walk breaks, test 3 goes red if the walk stops
// seeing a resolvable site that still exists, and test 6 goes red if a declared false positive
// stops being reported or starts being real.
// ===================================================================================

const D16 = { kind: 'spec', id: 'SPEC-88.6 R4 / D-16' } as const;
const D15 = { kind: 'spec', id: 'SPEC-88.6 R4 / D-15' } as const;

/**
 * Seeded from the MEASUREMENT, not from CONTEXT's cites, and taken on the post-88.6-02 tree
 * (the grounds are spelled `bg-surface-muted`; before that rename this scan read falsely clean).
 * Counts are DISTINCT INK SITES per file. `assertExactCounts` reds in BOTH directions, so a
 * sweep that fixes one of two sites in a file must decrement rather than leave a fossil.
 */
const OFFENDERS: ExemptionRoster = {
  'app/components/BringGamePicker.js': {
    sites: 2,
    why: 'text-content-muted (4.3725) at :195 on the certain thumbnail ground at :194, and at :204 under the selected-row ground at :180. NEWLY MEASURED by this scan — NOT one of D-16\'s six censused sites, and no sweep plan declares this file together with this roster. Routed to the owner in 88.6-09-SUMMARY.md.',
    owner: D16,
  },
  'app/components/CalendarMonthView.js': {
    sites: 1,
    why: 'text-content-link (3.9909) at :788, the "+N more" row, under the day-cell ground candidate at :249 inside the five-arm className ternary at :245-253. D-16 census site. Closed by plan 27, which must decrement this entry in the same commit.',
    owner: D16,
  },
  'app/components/GroupSettings.js': {
    sites: 1,
    why: 'text-content-muted (4.3725) at :645, the "No picture" fallback label, on the certain avatar-disc ground at :630. NEWLY MEASURED by this scan — NOT one of D-16\'s six censused sites, and no sweep plan declares this file together with this roster. Routed to the owner in 88.6-09-SUMMARY.md.',
    owner: D16,
  },
  'app/components/NotificationBell.js': {
    sites: 1,
    why: 'text-content-muted (4.3725) at :281 under the muted confirmation-banner ground at :278. The two arms share the SAME condition (confirmation.tone === "success"), so the pairing is genuinely co-live even though the scan can only classify it "possible". NEWLY MEASURED — not a D-16 census site and no sweep plan owns it with this roster. Routed to the owner in 88.6-09-SUMMARY.md.',
    owner: D16,
  },
  'app/components/SuggestionCard.js': {
    sites: 1,
    why: 'text-content-muted (4.3725) at :141, the disabled Create-Event button, a SAME-CHUNK ground+ink pairing inside one JSX opening tag. This is the D-15 site, deliberately NOT folded into the UNRESOLVABLE entry below: the walk resolves it. Closed by plan 42.',
    owner: D15,
  },
  'app/friends/page.js': {
    sites: 1,
    why: 'text-content-link (3.9909) at :748, the known-live pairing tokenContrast.test.ts test 49 names in its REACH prose. D-16 census site. Closed by plan 19, which must decrement this entry in the same commit.',
    owner: D16,
  },
  'app/gameDetail/page.js': {
    sites: 5,
    why: 'Five distinct ink sites on a muted ground: :1330 and :2753 are the two D-16 census sites (text-content-link, 3.9909); :51 is the D-15 same-chunk "No reply" badge (text-content-muted, 4.3725); :1311 and :1345 are NEWLY MEASURED by this scan (text-content-muted under the certain participation-chip ground at :1308) and are in no census. All five are owned by plan 18, which must shrink this entry as it closes them.',
    owner: D16,
  },
  'app/userProfile/page.js': {
    sites: 1,
    why: 'text-content-link (3.9909) at :2539 under a muted ground in the same chunk. D-16 census site. Closed by plan 17, which must decrement this entry in the same commit.',
    owner: D16,
  },
};

/**
 * The DECLARED-UNRESOLVABLE list. Its ground comes from a function body, which limitation 2 of
 * `inkGroundPairs` says the walk cannot see, so these sites can never appear in `OFFENDERS`.
 * Test 5 MEASURES the count rather than trusting it: a hand-written number in a blind spot goes
 * stale silently, which is the "prose instead of a gate" failure D-16 exists to end.
 */
const UNRESOLVABLE: ExemptionRoster = {
  'app/components/SuggestionCard.js': {
    sites: 3,
    why: 'The ground is returned by getScoreColor() — declared :66, returning "bg-surface-muted border-line" at :67, applied at :75 — i.e. from a function body outside any JSX opening tag, which is limitation 2 of inkGroundPairs. THREE forbidden resting-ink sites sit under that one ground, at TWO ratios: :92 and :116 are text-content-muted (4.3725) and :122 is text-content-link (3.9909). All three close together when plan 42 lands, because they share one ground. :141 is NOT folded in here — that one is a same-chunk pairing the walk resolves, and it is on the OFFENDERS roster above.',
    owner: D16,
  },
};

/**
 * A FALSE POSITIVE is NOT an exemption. An exemption says "this is DEBT that survived"; this
 * says "this pairing cannot exist at render". Hard-failing on `possible` pairings (test 1) is
 * what makes the rule cover the ~60% of the ground surface that is conditional, and the price
 * is candidate pairings whose ink arm and ground arm are mutually exclusive branches.
 *
 * It carries `kind: 'false-positive'`, NEVER `kind: 'spec'`: a spec-owned entry reads to plans
 * 17/18/19/27/42 as re-inking debt, and a sweep executor would then re-ink the deliberately
 * dimmed adjacent-month and past-date day numbers — a P6 look change nobody asked for.
 *
 * DECISION Phase 88.6-09 (D-16): `false-positive` is declared HERE as a local shape derived
 * from plan 04's `Exemption`, chosen OVER adding a fourth arm to `exemption.ts`'s `Owner`
 * union. An `Owner` arm would be assignable in EVERY debt roster in this phase — i.e. a new
 * place to hide real debt behind the words "false positive", which is precisely what test 6's
 * disjointness assertion exists to prevent. Keeping the shared provenance union closed is the
 * point of D-19. Widening it is a decision, not a cleanup.
 */
type FalsePositive = Omit<Exemption, 'owner'> & {
  owner: {
    kind: 'false-positive';
    inkLine: string;
    groundLine: string;
    /** The two conditions that make the ink arm and the ground arm mutually exclusive. */
    conditions: [string, string];
  };
};

/** Keyed by `file:line` — the ink site, because one file can hold both real debt and a FP. */
const FALSE_POSITIVES: Record<string, FalsePositive> = {
  'app/components/CalendarMonthView.js:259': {
    sites: 1,
    why: 'The ink ternary at :258-261 tests isCurrentDay FIRST (:258 -> text-content-accent), so the isAdjacent arm at :259 can only be reached when isCurrentDay is false — while the muted ground candidate at :249 requires isCurrentDay. Structurally impossible, not debt.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/CalendarMonthView.js:259',
      groundLine: 'app/components/CalendarMonthView.js:249',
      conditions: ['ink requires !isCurrentDay && isAdjacent', 'ground requires isCurrentDay'],
    },
  },
  'app/components/CalendarMonthView.js:260': {
    sites: 1,
    why: 'Same ink ternary: the "variant === full && isPastDate" arm at :260 is reached only when isCurrentDay and isAdjacent are both false, while the muted ground candidate at :249 requires isCurrentDay. Structurally impossible, not debt.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/CalendarMonthView.js:260',
      groundLine: 'app/components/CalendarMonthView.js:249',
      conditions: [
        'ink requires !isCurrentDay && !isAdjacent && variant === "full" && isPastDate',
        'ground requires isCurrentDay',
      ],
    },
  },
  'app/components/FriendInvitePanel.js:364': {
    sites: 1,
    why: 'The muted ground arm at :350 requires !isInGroup && selectedFriends.has(friend.id); the ink at :364 is the isInGroup arm of its own ternary. The two conditions are negations of each other, so the pairing cannot render. FriendInvitePanel.js is in NO sweep plan and is not a D-16 census site, so a spec entry here would also name a closing plan that does not exist.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/FriendInvitePanel.js:364',
      groundLine: 'app/components/FriendInvitePanel.js:350',
      conditions: ['ink requires isInGroup', 'ground requires !isInGroup && selectedFriends.has(friend.id)'],
    },
  },
  'app/components/FriendInvitePanel.js:370': {
    sites: 1,
    why: 'Same ground arm at :350 (!isInGroup && selected); the "In group" label at :370 renders only inside an isInGroup guard. Mutually exclusive, so not debt. Same no-sweep-plan reasoning as :364.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/FriendInvitePanel.js:370',
      groundLine: 'app/components/FriendInvitePanel.js:350',
      conditions: ['ink requires isInGroup', 'ground requires !isInGroup && selectedFriends.has(friend.id)'],
    },
  },
};

/** Real, structurally-possible offenders: everything the false-positive list does not name. */
const REAL = FORBIDDEN_ON_MUTED.filter((r) => !(siteOf(r) in FALSE_POSITIVES));

/** DISTINCT INK SITES per file — the shape `assertExactCounts` compares against the roster. */
const MEASURED: Record<string, number> = (() => {
  const seen = new Map<string, Set<string>>();
  for (const r of REAL) {
    if (!seen.has(r.file)) seen.set(r.file, new Set());
    seen.get(r.file)!.add(siteOf(r));
  }
  return Object.fromEntries([...seen].map(([file, sites]) => [file, sites.size]));
})();

describe('D-16 — no forbidden ink resolves onto the muted ground', () => {
  it('1. the class rule: every forbidden ink site on a muted ground is owned and exactly counted', () => {
    // Hard-fails on BOTH `certain` and `possible` pairings, deliberately. Narrowing this to
    // unconditional grounds was REJECTED with its cost measured: of the muted ground's 53
    // non-test non-CSS sites only 21 sit on a static `className="` line, so an
    // unconditional-only rule would leave roughly 60% of the ground surface with no hard arm —
    // on the one rule this suite is the only machine evidence for (SPEC AC-4). The anti-vacuity
    // floor cannot cover that gap either: a conditionally-muted site DOES resolve a ground,
    // just not the one the rule keys on.
    expect(assertRosterShape(OFFENDERS)).toEqual([]);
    const mismatches = assertExactCounts(OFFENDERS, MEASURED);
    expect(
      mismatches,
      `measured: ${JSON.stringify(MEASURED)}\nsites: ${[...new Set(REAL.map(siteOf))].sort().join(', ')}`,
    ).toEqual([]);
  });

  it('2. anti-vacuity: the walk really resolved grounds — it is not reporting zero by seeing nothing', () => {
    // T-88.6-18. A resolver that silently degrades reports zero offenders by seeing NOTHING,
    // and every assertion above it goes green. This is the row that catches it.
    // MEASURED 2026-09-15: 193 non-test files, 837 distinct resting-ink sites, of which 381
    // resolved at least one ground candidate. The floor is set at 40 — far below the measured
    // value on purpose, because the failure mode being caught is a walk that resolves NOTHING
    // (or a handful), not a walk that drifts by a few sites; a floor near 381 would red on
    // ordinary deletions and get lowered by the next executor, which is how a floor dies.
    // Counted in DISTINCT INK SITES, not rows, so candidate fan-out can neither inflate it nor
    // red it.
    expect(FILES.length).toBeGreaterThan(100);
    const resolved = new Set(ROWS.filter((r) => r.grounds.length > 0).map(siteOf));
    expect(resolved.size, `only ${resolved.size} ink sites resolved a ground`).toBeGreaterThanOrEqual(40);
  });

  it('3. the by-name roster: all FIVE resolvable D-16 sites are actually visible to the walk', () => {
    // Fails INDEPENDENTLY of test 1. Test 1 goes green when the sites are fixed; this one goes
    // red if the walk stops SEEING a site that still exists — the failure a count cannot catch.
    const byName: [string, string][] = [
      ['app/friends/page.js:748', 'text-content-link'],
      ['app/gameDetail/page.js:1330', 'text-content-link'],
      ['app/gameDetail/page.js:2753', 'text-content-link'],
      ['app/userProfile/page.js:2539', 'text-content-link'],
      ['app/components/CalendarMonthView.js:788', 'text-content-link'],
    ];
    const missing = byName.filter(
      ([site, ink]) => !FORBIDDEN_ON_MUTED.some((r) => siteOf(r) === site && r.inkToken === ink),
    );
    expect(missing.map(([s]) => s)).toEqual([]);

    // CalendarMonthView.js:788 is asserted by MEMBERSHIP, never by index. Its ground is one of
    // FIVE arms in the template ternary at :245-253, and asserting on grounds[0] / first / last
    // is exactly how the arbitrary single-ground pick this contract removes gets reinstated.
    const cell = FORBIDDEN_ON_MUTED.find((r) => siteOf(r) === 'app/components/CalendarMonthView.js:788');
    expect(cell).toBeDefined();
    expect(
      cell!.grounds.length,
      'the five-arm ternary must produce candidate fan-out, otherwise the membership assertion below is trivially satisfied',
    ).toBeGreaterThan(1);
    expect(
      cell!.grounds.some((g) => g.token === MUTED && g.frameLine === 249),
      `:788 must CONTAIN a ${MUTED} candidate whose frame line is 249; got ${JSON.stringify(cell!.grounds.map((g) => `${g.token}@${g.frameLine}`))}`,
    ).toBe(true);
  });

  it('4. the unresolvable list is exactly ONE entry — a new blind spot cannot join it silently', () => {
    // Dropping an invisible site from the roster without recording it is the failure the
    // resolvable/unresolvable split exists to prevent, so the length is pinned.
    expect(assertRosterShape(UNRESOLVABLE)).toEqual([]);
    expect(Object.keys(UNRESOLVABLE)).toEqual(['app/components/SuggestionCard.js']);
  });

  it('5. the SuggestionCard blind spot is MEASURED, not asserted from a hand-written number', () => {
    const rel = 'app/components/SuggestionCard.js';
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');

    // First pin the MECHANISM, so this row measures the blind spot rather than any three sites:
    // the root element's ground really does come from a function body.
    expect(src).toContain("if (!suggestion.meets_minimum) return 'bg-surface-muted border-line';");
    expect(src).toMatch(/className=\{`rounded-card border-2 p-4 \$\{getScoreColor\(\)\}`\}/);

    // Then count the forbidden RESTING ink in this file that the walk did NOT resolve onto a
    // muted ground. Those are exactly the descendants of the getScoreColor() ground.
    const blind = [...new Set(
      ROWS.filter((r) => r.file === rel && FORBIDDEN.has(r.inkToken) && !onMuted(r)).map((r) => r.line),
    )].sort((a, b) => a - b);
    expect(blind).toEqual([92, 116, 122]);
    expect(blind.length).toBe(UNRESOLVABLE[rel].sites);
  });

  it('6. the false-positive list is exact, live, and disjoint from the offender roster', () => {
    // Three checks, because three different things can go wrong.
    // (a) EXACT LENGTH — a fifth entry cannot be added quietly.
    expect(Object.keys(FALSE_POSITIVES).sort()).toEqual([
      'app/components/CalendarMonthView.js:259',
      'app/components/CalendarMonthView.js:260',
      'app/components/FriendInvitePanel.js:364',
      'app/components/FriendInvitePanel.js:370',
    ]);
    // (b) NOT A FOSSIL — every entry must still be a pairing the walk actually reports. An
    //     entry whose site was deleted or re-inked would otherwise sit here forever.
    const reported = new Set(FORBIDDEN_ON_MUTED.map(siteOf));
    const stale = Object.keys(FALSE_POSITIVES).filter((s) => !reported.has(s));
    expect(stale, 'these false-positive entries are no longer reported; delete them').toEqual([]);
    // (c) DISJOINT by `file:line` from everything owned as real debt. This is what stops the
    //     false-positive list becoming a place to hide debt: an entry cannot be both.
    const debt = new Set([
      ...REAL.map(siteOf),
      'app/friends/page.js:748',
      'app/gameDetail/page.js:1330',
      'app/gameDetail/page.js:2753',
      'app/userProfile/page.js:2539',
      'app/components/CalendarMonthView.js:788',
      'app/components/SuggestionCard.js:92',
      'app/components/SuggestionCard.js:116',
      'app/components/SuggestionCard.js:122',
    ]);
    const both = Object.keys(FALSE_POSITIVES).filter((s) => debt.has(s));
    expect(both, 'a site cannot be both real debt and a declared false positive').toEqual([]);
    // And every entry names both halves of the exclusion, so the claim is checkable by a reader.
    for (const [site, entry] of Object.entries(FALSE_POSITIVES)) {
      expect(entry.owner.kind, `${site} must never be spec-owned`).toBe('false-positive');
      expect(entry.owner.conditions).toHaveLength(2);
      expect(entry.owner.inkLine).toBe(site);
      expect(entry.owner.groundLine).not.toBe(site);
    }
  });

  it('7. negative control, GROUND side: the prescribed ink on the muted ground is NOT an offender', () => {
    // A rule that flags its own prescribed answer is a broken rule. `text-content-secondary`
    // measures 6.9620 on the muted fill and is what every fix in plans 17/18/19/27/42 moves to.
    const permitted = ROWS.filter((r) => r.inkToken === PRESCRIBED_INK_ON_MUTED.utility && onMuted(r));
    expect(
      permitted.length,
      'the prescribed pairing must actually be present in the scan output, or this control proves nothing',
    ).toBeGreaterThan(0);
    const flagged = permitted.filter((r) => REAL.some((x) => siteOf(x) === siteOf(r) && x.inkToken === r.inkToken));
    expect(flagged.map(siteOf)).toEqual([]);
  });

  it('8. negative control, INK side: variant-prefixed ink on a muted ground emits no row', () => {
    // The twin of test 7, and it is load-bearing: without the variant skip, 31 measured
    // `hover:`/`disabled:`/`aria-disabled:` occurrences of the forbidden set would seed a roster
    // no sweep plan could close. Asserted against a FIXTURE pair rather than the tree, so the
    // control cannot go vacuously green the day the tree happens to hold no such site.
    const resting = '<div className="bg-surface-muted"><a className="text-content-link">x</a></div>';
    const variant = '<div className="bg-surface-muted"><a className="hover:text-content-link">x</a></div>';
    const scan = (s: string) =>
      inkGroundPairs(s, { ink: INK, ground: GROUND }).filter(
        (r) => FORBIDDEN.has(r.inkToken) && r.grounds.some((g) => g.token === MUTED),
      );
    // The positive half proves the fixture is one the walk CAN see...
    expect(scan(resting)).toHaveLength(1);
    // ...so the zero below is a skip, not a blind spot.
    expect(scan(variant)).toHaveLength(0);
  });
});
