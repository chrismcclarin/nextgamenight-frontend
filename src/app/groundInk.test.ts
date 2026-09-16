// @vitest-environment node
// This suite is a pure source-TEXT scan: it renders nothing, never touches the DOM, and the
// node environment is materially faster than the global jsdom one.
//
// DECISION Phase 88.6-09 (#121+#123): the node environment is taken PER FILE via this pragma,
// chosen OVER (a) leaving the suite on the global jsdom environment — rejected, the DOM is
// never used here and every run pays for a document that is never read — and OVER (b) changing
// `environment` in `vitest.config.mts:56` — rejected, that would move EVERY suite, including
// the ones that genuinely render. This plan's text called it the repo's FIRST such pragma;
// re-measured at execution that is FALSE and the correction is recorded rather than quietly
// dropped — `src/app/errorEnvelopeReads.test.ts:2` took the same pragma first, in plan 88.6-14
// (wave 3), after this plan's 2026-09-14 census was taken. This is the SECOND, and it follows
// that file's idiom deliberately instead of inventing a second one. The three shipped
// source-scan suites were NOT converted, because converting a shipped, negative-checked suite
// is a behaviour change this plan does not declare. Moving this back onto jsdom is a decision,
// not a cleanup.
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
//    variant-prefixed GROUND is not a resting ground. Measured 2026-09-15 (this plan's text
//    said 31 of 73, taken 2026-09-14; re-run at execution it is 30 of 72): 30 variant-prefixed
//    occurrences of the forbidden set across non-test `src/`, of 72 variant-prefixed
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
// and mechanism step 4 in `inkGroundPairs`); that skip is what keeps 30 measured
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
// idiom for consistency — rejected because one full pass measures ~353 ms over the real tree
// (194 non-test files, 2.46 MB; the read+strip component of that is 204 ms) and this file
// carries eight assertions, paid again on every `npm test`.
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
    // 2 -> 1, plan 88.6-27 task 3 (wave 7, 2026-09-16). The D-16 CENSUS site is CLOSED: the
    // "+N more" row was `text-content-link` (3.9909) on the day-cell muted ground and is now
    // `text-content-secondary` (6.9620), with a `DECISION Phase 88.6-27 (D-16)` marker at the
    // site. It leaves this roster with its fix rather than being renumbered — a fixed site is
    // no longer debt. The entry SURVIVES at 1 for the site below, which this plan did NOT close
    // and does not own.
    why: 'The empty-day "+" hint is text-content-muted (4.3725) under the day-cell ground candidate inside the five-arm className ternary, and it is NOT in any census. It is rostered rather than excluded because the pairing is structurally POSSIBLE (an empty day can be today), but it is not renderable TODAY: the `group` marker that arms its `group-hover:opacity-40` sits on the cellClickable arm, which is mutually exclusive with the isCurrentDay ground, so the hint stays opacity-0 on a current day. PLAN 40 HOISTS THAT `group`, at which point this becomes a live AA failure — which is exactly why it is recorded here instead of dropped, and why plan 88.6-27 left it standing rather than closing a site whose element plan 40 owns. Line cites are deliberately NOT written into this `why`: plan 88.6-27 moved this file by ~50 lines and the previous text carried four stale ones. No sweep plan owns it; routed to the owner in 88.6-09-SUMMARY.md.',
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
  // `app/friends/page.js` CLOSED by plan 88.6-19 task 3 (wave 7, 2026-09-16): the tab-count pill
  // at :748 pre-edit carried `text-content-link` (3.9909) on `bg-surface-muted`. It took
  // `text-content-secondary` (6.9620) — it is a COUNT in a pill, not a link, and zero of the 61
  // `text-content-link` sites on this ground is one, so the TOKEN was wrong rather than the
  // ground. This was `tokenContrast.test.ts` test 49's named hand-verified example; that test's
  // REACH prose is appended to in the same commit. The by-name roster in test 3 shrank 2 -> 1 in
  // this same commit, as this entry's `why` required. Entry DELETED rather than zeroed.
  // `app/gameDetail/page.js` CLOSED by plan 88.6-18 task 3 (wave 7, 2026-09-16). All FIVE
  // closed in one commit:
  //   - the two D-16 census BADGES ("New Player", "You") took `text-content-accent` (4.7121),
  //     not `text-content-secondary` — D-16 distinguishes badges from its four other sites on
  //     exactly that basis;
  //   - the D-15 "No reply" badge and the two sites this scan NEWLY MEASURED (the "(Guest)"
  //     suffix and the `#placement` counter, both `text-content-muted` under the
  //     participation-chip ground) took `text-content-secondary` (6.9620).
  // The two newly-measured sites were in NO census — they existed only because this walk
  // reported them, which is the whole argument for a measuring gate over a prose list.
  // Entry DELETED rather than zeroed; the roster is exact in both directions.
  // `app/userProfile/page.js` CLOSED by plan 88.6-17 task 3 (wave 7, 2026-09-16): the
  // import-progress banner's `text-content-link` on `bg-surface-muted` (3.9909, below AA) is now
  // `text-content-secondary` (6.9620). It was never a link — zero of the 61 `text-content-link`
  // sites on this ground is — so the TOKEN was wrong, not the ground. Entry DELETED rather than
  // zeroed; the roster is exact in both directions.
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
  // RE-POINTED by plan 88.6-27 task 3 (wave 7, 2026-09-16): ink 259 -> 280 and 260 -> 281,
  // ground 249 -> 263. The MECHANISM is unchanged and still holds — the ink ternary still tests
  // isCurrentDay first and the muted ground candidate still requires isCurrentDay. Only the line
  // numbers moved, because this plan's markers and its Button/Heading migrations sit above them.
  // These keys are LINE-keyed, so a stale key silently reclassifies a declared false positive as
  // a REAL offender: test 1 reported 3 CalendarMonthView sites against a 2-site roster before
  // this re-point, which is the shape that failure takes.
  'app/components/CalendarMonthView.js:280': {
    sites: 1,
    why: 'The ink ternary tests isCurrentDay FIRST (-> text-content-accent), so the isAdjacent arm can only be reached when isCurrentDay is false — while the muted ground candidate requires isCurrentDay. Structurally impossible, not debt.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/CalendarMonthView.js:280',
      groundLine: 'app/components/CalendarMonthView.js:263',
      conditions: ['ink requires !isCurrentDay && isAdjacent', 'ground requires isCurrentDay'],
    },
  },
  'app/components/CalendarMonthView.js:281': {
    sites: 1,
    why: 'Same ink ternary: the "variant === full && isPastDate" arm is reached only when isCurrentDay and isAdjacent are both false, while the muted ground candidate requires isCurrentDay. Structurally impossible, not debt.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/CalendarMonthView.js:281',
      groundLine: 'app/components/CalendarMonthView.js:263',
      conditions: [
        'ink requires !isCurrentDay && !isAdjacent && variant === "full" && isPastDate',
        'ground requires isCurrentDay',
      ],
    },
  },
  // RE-POINTED by plan 88.6-22 task 1 (wave 7, 2026-09-16): 364 -> 484, 370 -> 490, ground
  // 350 -> 467. The MECHANISM is unchanged and still holds — only the line numbers moved, because
  // the sweep added a comment above the friend-name `<p>`. Two corrections to the old `why` while
  // it is open, both measured at this commit:
  //   (a) "FriendInvitePanel.js is in NO sweep plan" was TRUE when this entry was written and is
  //       FALSE now — plan 88.6-22 is its sweep owner and declares it in `files_modified`. That
  //       clause was load-bearing (it argued against a spec entry), so it is corrected rather
  //       than deleted.
  //   (b) These keys are LINE PINS inside a phase whose sweeps rewrite every line number they
  //       touch (the same shape `shadowTier.test.ts` test 8 hit at plan 88.6-21). ANY future edit
  //       to this component must re-point all three. A content-anchored keying would be the
  //       durable fix; no 88.6 plan declares this file, so plan 22 re-points rather than
  //       re-engineers a gate it does not own, and routes the structural change instead.
  'app/components/FriendInvitePanel.js:484': {
    sites: 1,
    why: 'The muted ground arm at :467 requires !isInGroup && selectedFriends.has(friend.id); the ink at :484 is the isInGroup arm of its own ternary. The two conditions are negations of each other, so the pairing cannot render. Plan 88.6-22 is this file\'s sweep owner and confirmed the mechanism at execution; it is a false positive, not debt that plan should have closed.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/FriendInvitePanel.js:484',
      groundLine: 'app/components/FriendInvitePanel.js:467',
      conditions: ['ink requires isInGroup', 'ground requires !isInGroup && selectedFriends.has(friend.id)'],
    },
  },
  'app/components/FriendInvitePanel.js:490': {
    sites: 1,
    why: 'Same ground arm at :467 (!isInGroup && selected); the "In group" label at :490 renders only inside an isInGroup guard. Mutually exclusive, so not debt. Same sweep-owner confirmation as :484.',
    owner: {
      kind: 'false-positive',
      inkLine: 'app/components/FriendInvitePanel.js:490',
      groundLine: 'app/components/FriendInvitePanel.js:467',
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
    // unconditional grounds was REJECTED with its cost measured: of the muted ground's 56
    // non-test non-CSS lines only 21 sit on a static `className="` line (re-derived
    // 2026-09-15; this plan's text said 53, taken 2026-09-14), so an
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
    // MEASURED 2026-09-15: 194 non-test files, 838 distinct resting-ink sites, of which 383
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

  it('3. the by-name roster: every OPEN resolvable D-16 site is actually visible to the walk', () => {
    // Fails INDEPENDENTLY of test 1. Test 1 goes green when the sites are fixed; this one goes
    // red if the walk stops SEEING a site that still exists — the failure a count cannot catch.
    //
    // AMENDED Phase 88.6-17 (2026-09-16): the title said FIVE and the list now holds FOUR,
    // because `app/userProfile/page.js` was fixed and its row left with it. A fixed site MUST
    // leave this list — leaving it behind would red the moment the fix lands, which is the
    // opposite of what this assertion is for. The title is now written in terms of the OPEN set
    // so it does not go stale again with the next closure. The count is held below rather than
    // in prose, so shrinking the list is a visible, deliberate edit.
    // AMENDED AGAIN Phase 88.6-18 (2026-09-16): 4 -> 2. Both `app/gameDetail/page.js` rows left
    // with their fix — the two badges now carry `text-content-accent`. The entries are keyed by
    // `file:line` and that file moved several hundred lines in the same plan, which is a second
    // reason a fixed row must LEAVE rather than be re-numbered.
    // AMENDED AGAIN Phase 88.6-19 (2026-09-16): 2 -> 1. `app/friends/page.js:748` was fixed (the
    // tab-count pill took `text-content-secondary`) and its row left with the fix, in the same
    // commit that deleted its class-rule roster entry — a partial update reds, which is what
    // keeps the two halves together.
    // AMENDED AGAIN Phase 88.6-27 task 3 (2026-09-16): 1 -> 0. `CalendarMonthView.js`'s
    // "+N more" row was the LAST open D-16 CENSUS site; it took `text-content-secondary`
    // (6.9620, from 3.9909) and its row left this set with the fix, in the same commit that
    // shrank its class-rule roster entry. An empty by-name set is a real END STATE here, not a
    // broken scan — see the fan-out assertion below, which was RE-POINTED rather than deleted
    // precisely so this test keeps proving the walk can still SEE a multi-arm ground.
    const byName: [string, string][] = [];
    expect(
      byName.length,
      'the open D-16 by-name set: 5 at plan 88.6-09, 4 since plan 88.6-17 closed userProfile, ' +
        '2 since plan 88.6-18 closed both gameDetail badges, ' +
        '1 since plan 88.6-19 closed the friends tab-count pill, ' +
        '0 since plan 88.6-27 closed the CalendarMonthView "+N more" row. ' +
        'Shrink this number in the SAME commit that closes a site, and never grow it without a ' +
        'roster entry to match',
    ).toBe(0);
    const missing = byName.filter(
      ([site, ink]) => !FORBIDDEN_ON_MUTED.some((r) => siteOf(r) === site && r.inkToken === ink),
    );
    expect(missing.map(([s]) => s)).toEqual([]);

    // The CalendarMonthView day cell is asserted by MEMBERSHIP, never by index. Its ground is
    // one of FIVE arms in the template ternary, and asserting on grounds[0] / first / last is
    // exactly how the arbitrary single-ground pick this contract removes gets reinstated.
    //
    // RE-POINTED by plan 88.6-27 task 3 (2026-09-16), NOT deleted: the subject moves from the
    // now-fixed "+N more" row (:788) to the file's SURVIVING rostered site, the empty-day "+"
    // hint (:858), whose ground is the SAME five-arm ternary at the SAME muted arm (:263, was
    // :249). Deleting this block with the fixed site would have quietly retired the only thing
    // proving the walk still produces candidate fan-out at all — and the by-name set above is
    // empty now, so nothing else in this test would notice.
    const cell = FORBIDDEN_ON_MUTED.find((r) => siteOf(r) === 'app/components/CalendarMonthView.js:858');
    expect(cell, 'the day cell\'s rostered ink site must still be reported by the walk').toBeDefined();
    expect(
      cell!.grounds.length,
      'the five-arm ternary must produce candidate fan-out, otherwise the membership assertion below is trivially satisfied',
    ).toBeGreaterThan(1);
    expect(
      cell!.grounds.some((g) => g.token === MUTED && g.frameLine === 263),
      `:858 must CONTAIN a ${MUTED} candidate whose frame line is 263; got ${JSON.stringify(cell!.grounds.map((g) => `${g.token}@${g.frameLine}`))}`,
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
      // RE-POINTED by plan 88.6-27 task 3 (2026-09-16), 259/260 -> 280/281. This literal is the
      // SECOND place the line pin is written; both must move together.
      'app/components/CalendarMonthView.js:280',
      'app/components/CalendarMonthView.js:281',
      // RE-POINTED by plan 88.6-22 task 1 (2026-09-16), 364/370 -> 484/490. This literal is the
      // SECOND place the line pin is written; both must move together. See the re-point note on
      // the entries themselves.
      'app/components/FriendInvitePanel.js:484',
      'app/components/FriendInvitePanel.js:490',
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
      // The two `app/gameDetail/page.js` rows left this set with their fix (plan 88.6-18), and
      // `app/friends/page.js:748` left it with its fix (plan 88.6-19). A fixed site must LEAVE
      // this set: it is no longer debt, and the disjointness check below is about what IS.
      // RE-POINTED by plan 88.6-27 task 3 (2026-09-16): :788 was FIXED and left the debt set
      // with its fix (the rule this list's own comment states); the file's surviving debt is
      // the empty-day "+" hint, now at :858.
      'app/components/CalendarMonthView.js:858',
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
    // The twin of test 7, and it is load-bearing: without the variant skip, 30 measured
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
