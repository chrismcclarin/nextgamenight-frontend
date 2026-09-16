// @vitest-environment node
// This suite is a pure source-TEXT scan: it renders nothing, never touches the DOM, and the
// node environment is materially faster than the global jsdom one.
//
// DECISION Phase 88.6-10 (#121+#123): the node environment is taken PER FILE via this pragma,
// chosen OVER (a) leaving the suite on the global jsdom environment — rejected, the DOM is
// never used here and every run would pay for a document nothing reads — and OVER (b) changing
// `environment` in `vitest.config.mts:56` (`environment: 'jsdom'`, re-verified 2026-09-15) —
// rejected, that moves EVERY suite, including the many that genuinely render. This plan's text
// called it the repo's FIRST such pragma; re-measured at execution that is FALSE and the
// correction is recorded rather than quietly dropped: `src/app/errorEnvelopeReads.test.ts:2`
// (plan 88.6-14) took it first and `src/app/groundInk.test.ts:1` (plan 88.6-09) second, both
// after this plan's 2026-09-14 census. This is the THIRD, and it follows their idiom instead of
// inventing a fourth. The three shipped source-scan suites (`nativeDialogs.test.ts`,
// `fetchErrorTreatment.test.ts`, `typeScaleTouchedSurfaces.test.ts`) were deliberately NOT
// converted — converting a shipped, negative-checked gate is a sweep this plan does not declare,
// and `fetchErrorTreatment.test.ts` is explicitly out of scope and stays on jsdom.
// Moving this file back onto jsdom is a decision, not a cleanup.
//
// =====================================================================================
// D-07 / SPEC-88.6 R2 / AC-2 — what "zero remaining" MEANS for the Button migration.
// =====================================================================================
//
// Two things, and they are asserted here together because either one alone is a half-truth:
//
//   1. ZERO raw `.btn*` class usage on any JSX element, outside `Button.tsx`'s cva base.
//   2. ZERO button CONTROL — `<button>` the element OR `<Button>` the primitive — carrying a
//      raw palette fill (task 2, below).
//
// WHY THIS IS A WHOLE-OPENING-TAG SCAN AND NOT A GREP
// ---------------------------------------------------
// The SPEC's own "337 raw `.btn*` occurrences" is a LINE-grep number and it gates nothing (P5).
// Two shapes defeat any line- or literal-based read, and both are live in this tree:
//
//   - `className` sits on a DIFFERENT LINE from its opening tag in essentially every control
//     here. Measured in 88-21: a `[^>]*` regex matched 0 of 14 real controls.
//   - `cn('btn', ACTION_CLASS[variant], className)` is an EXPRESSION, not a literal (W19). Until
//     plan 88.6-08 landed, `Modal.tsx` emitted exactly that shape; a literal-only scan is blind
//     to it.
//
// So the scanner reads the FULL opening tag with the brace-balanced `readOpeningTag` and takes
// its `stringChunks`. No `grep`, no `execSync`, no regex applied to un-tag-scoped raw source —
// the Phase 88 ledger records twelve gates that died of exactly those (see
// `src/lib/ci-grep-gate.fixture.test.ts` for the shipped demonstration).
//
// EXCLUSION IS NOT EXEMPTION
// --------------------------
// `Button.tsx`'s cva base is a scanner EXCLUSION, never a roster entry (D-19). An exclusion says
// "this is the DEFINITION of the thing being scanned for"; an exemption says "this is a DEBT".
// And here the exclusion is FREE rather than a special case: the base's `'btn'` lives inside a
// `cva([...])` array at `src/components/ui/Button.tsx:74`, which is not inside a JSX opening tag,
// so this scanner never sees it. There is no `if (file === 'Button.tsx') continue` anywhere
// below, and the assertion at the bottom of the census describe pins that.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type ExemptionRoster,
} from '../../test-utils/exemption';
import {
  lineAt,
  readOpeningTag,
  sourceFiles,
  stringChunks,
  withoutComments,
} from '../../test-utils/sourceScan';

// `readOpeningTag` is IMPORTED, not copied. This plan's text said to copy it verbatim from
// `controlSizeFloor.test.tsx:88-108`; Phase 88.6-09 RELOCATED it into the shared lexer before
// this plan ran (`sourceScan.ts:246`, and `controlSizeFloor.test.tsx:89-92` records the move),
// so copying it now would create the second copy that module exists to prevent — the exact drift
// `DECISION Phase 88-29` names. The imported function is the same brace-balanced reader plus a
// measured 16000-byte bound.

const SRC = path.resolve(__dirname, '../..');

// Named-tag anchor with a lookahead, never a bare `<`: a TypeScript generic or an `a < b`
// comparison must not start a tag scan. This is `sourceScan.ts:344`'s own `OPEN_TAG` shape,
// which is slightly stricter than the RESEARCH census script's `/<([A-Za-z][A-Za-z0-9.]*)/g`.
// Measured 2026-09-15: both forms report the identical 115 sites / 36 files, so the stricter
// one costs nothing and matches the shipped lexer.
const OPEN_TAG = /<([A-Za-z][\w.-]*)(?=[\s>/])/g;

// The `.btn` family. The leading `(?<![\w:-])` is load-bearing and NOT decoration: plan 88.6-09
// measured that a plain `\bbtn\b` sweeps in `rounded-btn` and drags `Input.tsx` / `SelectField.tsx`
// into the census. `bg-btn-*` and `text-btn-*` semantic tokens are excluded by the same lookbehind.
const BTN = /(?<![\w:-])btn(-[a-z]+)?(?![\w-])/;

// `surfaceHoverSweep.test.ts:82`'s richer form — it strips a bracketed variant
// (`data-[state=open]:`) which the simpler `/^[a-z-]+:/` cannot.
const VARIANT_PREFIX = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/** One JSX opening tag, with everything every rule in this file needs already extracted. */
interface TagSite {
  /** Repo-relative to `src/`, the `app/components/Foo.js` form the rosters are keyed by. */
  file: string;
  /** 1-based line of the opening `<`. */
  line: number;
  /** The tag name as written: `button`, `Button`, `div`, `Modal.Action`. */
  name: string;
  /** Every string-literal / template-static chunk inside the opening tag. */
  chunks: string[];
  /** Every whitespace-separated token from those chunks, variant prefixes stripped. */
  classes: string[];
}

/**
 * The ONE scanner. Every rule and every fixture in this file goes through it, so a fixture
 * assertion is an assertion about the real census and not about a parallel toy.
 */
export function scanSource(file: string, raw: string): TagSite[] {
  const stripped = withoutComments(raw);
  const out: TagSite[] = [];
  for (const m of stripped.matchAll(OPEN_TAG)) {
    const at = m.index ?? 0;
    const tag = readOpeningTag(stripped, at);
    if (!tag) continue;
    const chunks = stringChunks(tag).map((c) => c.text);
    const classes: string[] = [];
    for (const text of chunks) {
      for (const rawToken of text.split(/\s+/)) {
        if (!rawToken) continue;
        const base = rawToken.replace(VARIANT_PREFIX, '');
        if (base) classes.push(base);
      }
    }
    out.push({ file, line: lineAt(stripped, at), name: m[1], chunks, classes });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// THE TREE IS ENUMERATED, READ AND COMMENT-STRIPPED EXACTLY ONCE, AT MODULE SCOPE.
//
// DECISION Phase 88.6-10 (AC-11, owner ruling 2026-09-09): hoisted, chosen OVER the shipped
// un-hoisted idiom (`surfaceHoverSweep.test.ts:133`, `controlSizeFloor.test.tsx:145`, both of
// which call `sourceFiles(SRC)` + `readFileSync` inside a per-assertion helper). One full pass
// over the real tree measures ~250 ms, and this phase stacks roughly a dozen new assertions on
// top of every plan's `npm test`. The divergence is CONFINED to this new file: the shipped
// suites stay byte-unchanged and `sourceScan.ts` gains no cache (ruled out separately as AC-12).
// Re-scanning per assertion here is a decision, not a cleanup.
// ---------------------------------------------------------------------------------------
const FILES = sourceFiles(SRC);
const TAGS: TagSite[] = FILES.flatMap((f) =>
  scanSource(path.relative(SRC, f), fs.readFileSync(f, 'utf8')),
);

/** Every element site whose opening tag carries a `.btn*` class, anywhere in its expression. */
const BTN_SITES = TAGS.filter((t) => t.chunks.some((c) => BTN.test(c)));

function countByFile(sites: TagSite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sites) out[s.file] = (out[s.file] ?? 0) + 1;
  return out;
}

const BTN_COUNTS = countByFile(BTN_SITES);

// ---------------------------------------------------------------------------------------
// THE ROSTER. Seeded from the LIVE measurement taken at execution on 2026-09-15:
// 194 source files enumerated, 115 `.btn` element sites across 36 files.
//
// RESEARCH B.1 measured 120 sites / 38 files at FE `701fc74`. The two deltas are both accounted
// for and neither is a scanner change:
//   - `app/test-sentry/page.js` (4 sites) was DELETED outright by plan 88.6-13 (wave 3) under the
//     owner's D3 ruling of 2026-09-09. `git ls-files src/app/test-sentry | wc -l` is 0, checked
//     before this roster was written. A row for it here would be a defect; so would "restoring"
//     it because the census came up a file short.
//   - `app/components/Modal.tsx` (1 site) was retired by plan 88.6-08, which replaced
//     `Modal.Action`'s `cn('btn', ACTION_CLASS[variant], className)` emitter with a `<Button>`.
//     08 and 10 are SAME-WAVE siblings with no `depends_on` edge between them (see this plan's
//     "no `depends_on` edge to plan 08" decision), so the roster was seeded state-tolerantly and
//     the live scan settled it: 08 landed FIRST, `Modal.tsx` measures 0, and it is therefore NOT
//     rostered. Had it still measured 1, the entry would have been seeded naming 08 as its closer.
// Every other per-file count matches RESEARCH B.1 exactly.
//
// `owner` is `spec` for all of these: SPEC-88.6 R2 / AC-2 is the requirement that makes them
// debts with a deadline. `why` names the plan that closes each one, so a reader can navigate
// from the roster to the work.
// ---------------------------------------------------------------------------------------
const BTN_EXEMPT: ExemptionRoster = {
  'app/userProfile/page.js': {
    sites: 13,
    why: 'the userProfile sweep migrates all 13 to `Button`; plan 88.6-17 owns the file end-to-end',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/GroupSettings.js': {
    sites: 8,
    why: 'plan 88.6-20 sweeps GroupSettings.js and lands the swatch a11y items alongside the Button migration',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  // PERMANENT AT 2 — the one entry in this roster that never reaches zero.
  // Seven sites measure here today. Plan 88.6-32 migrates FIVE of them and leaves the two
  // 32x32 stepper controls (`BrowseMoreModal.js:226` and `:266` — the ELEMENT lines; CONTEXT's
  // `:232`/`:270` are the className lines, both reading
  // `btn btn-compact btn-secondary w-8 h-8 ...`) raw. So this entry shrinks 7 -> 2 and then
  // STAYS at 2 forever, and its `owner` flips from AC-2 to D-10 when that happens.
  'app/components/BrowseMoreModal.js': {
    sites: 7,
    why: 'five sites migrate under plan 88.6-32; the remaining TWO are PERMANENT — the 32x32 player-count steppers are not primary actions, 32px clears WCAG 2.2 2.5.8 24px floor, and a `compact` rung on Button was REJECTED because it would convert a closed two-site exemption into an open sub-44 API affordance and silently add `shadow-theme-sm hover:shadow-theme-md` to two 32px squares (D-10)',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / D-10' },
  },
  'app/gameDetail/page.js': {
    sites: 7,
    why: 'plan 88.6-18 sweeps gameDetail/page.js (151 sites across 2939 lines) including these seven',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/restore/group/[token]/page.tsx': {
    sites: 7,
    why: 'plan 88.6-23 sweeps the five token-and-invite entry pages, this file among them',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/ManageMembers.js': {
    sites: 6,
    why: 'plan 88.6-19 sweeps ManageMembers.js together with friends/page.js',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/friends/page.js': {
    sites: 6,
    why: 'plan 88.6-19 sweeps friends/page.js together with ManageMembers.js',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/invite/game/[token]/page.js': {
    sites: 6,
    why: 'plan 88.6-23 sweeps the invite and restore token entry pages, this file among them',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/FriendInvitePanel.js': {
    sites: 5,
    why: 'plan 88.6-22 sweeps the invite-and-ballot cluster, FriendInvitePanel.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/NotificationBell.js': {
    sites: 4,
    why: 'plan 88.6-31 sweeps the feedback and notification cluster, NotificationBell.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/ScheduleList.js': {
    sites: 4,
    why: 'plan 88.6-32 sweeps the group-library and scheduling cluster, ScheduleList.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/invite/accept/page.js': {
    sites: 4,
    why: 'plan 88.6-23 sweeps the invite and restore token entry pages, this file among them',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/createEvent.js': {
    sites: 3,
    why: 'plan 88.6-25 sweeps the event-creation and availability cluster (markup and classes only)',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/grouplist.js': {
    sites: 3,
    why: 'plan 88.6-21 sweeps grouplist.js alongside groupHomePage/page.js',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  // One of these three is `groupHomePage/page.js:872`, the Manage Members header CTA, which
  // ALSO carries a raw palette fill and is therefore in task 2's roster as well. The two rules
  // see the same element for different reasons and neither subsumes the other: the `.btn` here
  // CLOSES under plan 88.6-21, while the `bg-white/80` wash SURVIVES it (88.3-16, owner ruling 2).
  'app/groupHomePage/page.js': {
    sites: 3,
    why: 'plan 88.6-21 sweeps groupHomePage/page.js and converges the Create-Event amber CTA onto `variant="accent"`',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/CalendarMonthView.js': {
    sites: 2,
    why: 'plan 88.6-27 sweeps the calendar cluster, CalendarMonthView.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/EventDayModal.js': {
    sites: 2,
    why: 'plan 88.6-27 sweeps the calendar cluster, EventDayModal.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/FeedbackButton.js': {
    sites: 2,
    why: 'plan 88.6-31 sweeps the feedback and notification cluster, FeedbackButton.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/FeedbackForm.js': {
    sites: 2,
    why: 'plan 88.6-31 sweeps the feedback and notification cluster, FeedbackForm.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/QRCodeModal.js': {
    sites: 2,
    why: 'plan 88.6-33 sweeps eight small modal-and-card components, QRCodeModal.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/ScheduleForm.js': {
    sites: 2,
    why: 'plan 88.6-32 sweeps the group-library and scheduling cluster, ScheduleForm.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/invite/group/[token]/page.js': {
    sites: 2,
    why: 'plan 88.6-23 sweeps the invite and restore token entry pages, this file among them',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/rsvp/[token]/page.js': {
    sites: 2,
    why: 'plan 88.6-24 sweeps rsvp/[token]/page.js and resolves R9 cross-repo read points there',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/AvailabilityForm.js': {
    sites: 1,
    why: 'plan 88.6-25 sweeps the event-creation and availability cluster, AvailabilityForm.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/BallotOptionsEditor.js': {
    sites: 1,
    why: 'plan 88.6-22 sweeps the invite-and-ballot cluster, BallotOptionsEditor.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/BringGamePicker.js': {
    sites: 1,
    why: 'plan 88.6-33 sweeps eight small modal-and-card components, BringGamePicker.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/ClickableMemberName.js': {
    sites: 1,
    why: 'plan 88.6-34 sweeps nine small shared components, ClickableMemberName.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/createGroup.js': {
    sites: 1,
    why: 'plan 88.6-33 sweeps eight small modal-and-card components and routes createGroup.js raw error read',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/DangerZoneDeleteAccount.tsx': {
    sites: 1,
    why: 'plan 88.6-30 hardens the deletion modal and sweeps DangerZoneDeleteAccount.tsx alongside it',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/EventCalendar.js': {
    sites: 1,
    why: 'plan 88.6-27 sweeps the calendar cluster, EventCalendar.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/LandingPage.js': {
    sites: 1,
    why: 'plan 88.6-35 sweeps the marketing, legal and tutorial surfaces, LandingPage.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/OpenPollsList.js': {
    sites: 1,
    why: 'plan 88.6-32 sweeps the group-library and scheduling cluster, OpenPollsList.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/PromptScheduleManager.js': {
    sites: 1,
    why: 'plan 88.6-15 is the phase tracer and takes the prompt-schedule trio through every layer first',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/RsvpSection.js': {
    sites: 1,
    why: 'plan 88.6-29 sweeps the RSVP cluster and closes its four recorded residuals',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/tutorial/TutorialOverlay.js': {
    sites: 1,
    why: 'plan 88.6-35 sweeps the marketing, legal and tutorial surfaces, TutorialOverlay.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
  'app/components/tutorial/WelcomeSlide.js': {
    sites: 1,
    why: 'plan 88.6-35 sweeps the marketing, legal and tutorial surfaces, WelcomeSlide.js included',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-2' },
  },
};

describe('D-07 / AC-2: the `.btn` element census', () => {
  // ANTI-VACUITY FLOOR, half 1 of 2. A scanner that walks nothing passes every assertion below
  // it. 150 is the floor; 194 is the live measurement (this plan's text said 192, re-measured
  // 2026-09-15 as 194 — the sweeps rewrite files rather than remove them, so this quantity is
  // stable across the phase and does NOT fall as the migration succeeds).
  it('enumerated the source tree (a scanner that walked nothing must red)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(150);
  });

  // ANTI-VACUITY FLOOR, half 2 of 2 — AND ITS PLANNED FLIP.
  //
  // Today this asserts the scanner FOUND something, which is what catches a lexer regression
  // while the roster is still full. It is deliberately written as `>= 1` and not as a count:
  // the whole point of this phase is to drain the population, so once BTN_EXEMPT holds only the
  // two permanent BrowseMoreModal steppers this assertion becomes a floor of 2, and when even
  // those are the last thing standing the RIGHT assertion is the file-count floor above.
  //
  // THE FLIP: when `BTN_EXEMPT` reaches its permanent floor, replace the body of this test with
  // the file-enumeration assertion (or delete it and keep the one above). Do NOT delete it and
  // leave nothing — a scanner that finds nothing because it walked nothing must still red, and
  // that is exactly what the test above is for.
  it('found `.btn` sites to census (guards a lexer regression while the roster is non-empty)', () => {
    expect(BTN_SITES.length).toBeGreaterThanOrEqual(1);
  });

  it('has a well-formed roster (every entry counted, reasoned and owned)', () => {
    expect(assertRosterShape(BTN_EXEMPT)).toEqual([]);
  });

  // Exact in BOTH directions: a new `.btn` in an exempt file reds, and FIXING one without
  // shrinking the entry reds too. That is what stops an exemption becoming a fossil permission.
  it('has zero `.btn` element sites outside the roster, at exactly the rostered counts', () => {
    expect(assertExactCounts(BTN_EXEMPT, BTN_COUNTS)).toEqual([]);
  });

  // THE EXCLUSION, pinned. `Button.tsx` composes `'btn'` in its cva base — that is the
  // DEFINITION of the family, not a debt — and it contributes zero rows here WITHOUT any
  // special case in the scanner, because the base is a string inside a `cva([...])` call and
  // not inside a JSX opening tag. If this ever reds, someone moved the base onto an element and
  // the right answer is to move it back, not to add an exemption entry (D-19: an exclusion may
  // never be filed as an exemption).
  it('treats `Button.tsx` cva base as an exclusion — it contributes zero rows for free', () => {
    const fromButton = BTN_SITES.filter((s) => s.file === 'components/ui/Button.tsx');
    expect(fromButton.map((s) => `${s.file}:${s.line} <${s.name}>`)).toEqual([]);
    expect('components/ui/Button.tsx' in BTN_EXEMPT).toBe(false);
  });
});

// =====================================================================================
// D-07 / D-11 — the RAW-PALETTE BUTTON-CONTROL rule: the second half of "zero remaining".
// =====================================================================================
//
// THE PREDICATE IS TWO TAGS — `<button>` AND `<Button>` — AND THAT IS DELIBERATE.
//
// REJECTED ARM: `<button>`-only. It reads like the natural narrowing (scan the element, the
// component is the fix), and a future reader will be tempted to "tighten" it back. It is wrong
// for a structural reason, not a stylistic one: the defect this rule exists to stop is A CONTROL
// WEARING A RAW PALETTE FILL, and after plans 15-39 that control is a `<Button>` carrying the
// same className it carried as a `<button>` — every sweep converts the tag and brings the class
// list along. So a `<button>`-only predicate measures EXACTLY THE POPULATION THIS PHASE DRAINS
// and would go green BY THE MIGRATION SUCCEEDING, while the identical defect on the identical
// control became invisible to it. Widening the tag set is what makes the rule survive its own
// phase. Narrowing it back is a decision, not a cleanup.
//
// The component-name EXCLUSIONS are unchanged and still deliberate: `<Link>`, `<a>` and every
// other tag are out of scope here because they are not buttons. A `<div className="bg-indigo-600">`
// is a surface, not a control, and the negative control below pins that.
//
// WHY THIS RULE EXISTS SEPARATELY FROM `rawColorValues.test.ts`. That suite scans hex literals
// and inline `boxShadow` properties only (`rawColorValues.test.ts:1-44`), which is precisely why
// `bg-indigo-600` survived it — a Tailwind palette step is neither a hex nor a boxShadow.
//
// REJECTED ARM: an any-`bg-*` rule. Measured: 28 semantic-token false positives. `bg-surface-*`,
// `bg-status-*` and `bg-btn-*` are the theme working as intended and are NOT flagged.
//
// REJECTED ARM: an element-level census of all ~118 non-`.btn` `<button>`s. 81 of them are
// legitimate non-Buttons and inventorying them is Phase 92's work, not an 88.6 gate.
//
// THE REPO'S OWN PALETTE NAMES COLLIDE WITH TAILWIND'S, and this is the non-obvious call here.
// `globals.css` mints `--purple-*`, `--warm-*` and `--amber-*` custom properties, and its
// `@theme` block exposes only a subset as utilities (`globals.css:256-260` exposes
// `--color-purple-100/300/700/800/900`). So `bg-purple-900` on a button is ambiguous BY NAME
// ALONE — it may resolve to the repo's token or to Tailwind's default step. It is treated as a
// RAW palette fill either way, the way D-17 resolves the same ambiguity: whichever it resolves
// to, a button should be wearing a `btn-*` variant or a semantic token, not a palette STEP.
// Flagging it is therefore correct under both readings, and the entry it lands in names the plan
// that decides which token it becomes.

/**
 * Tailwind's default palette hue names, PINNED AS DATA exactly like `HEX_EXEMPT`
 * (`rawColorValues.test.ts:65`) rather than spelled as an inline regex alternation. Adding a hue
 * is then an explicit, reviewable edit to a list, not a silent widening buried in a pattern.
 */
const TAILWIND_HUES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose',
];

/**
 * A raw palette FILL, tested against a class token whose variant prefixes are already stripped
 * (so `dark:bg-white/10` and `hover:bg-indigo-700` are both seen). Three shapes:
 *   - `bg-<hue>-<number>` drawn from the pinned list above;
 *   - `bg-white` / `bg-black`, WITH OR WITHOUT an opacity suffix — `bg-white/10` must match, and
 *     the fixture harness pins that the suffix does not evade the rule;
 *   - `bg-[#...]` arbitrary hex.
 */
const PALETTE_FILL = new RegExp(
  `^bg-(?:(?:${TAILWIND_HUES.join('|')})-\\d{2,3}|white|black)(?:\\/.+)?$|^bg-\\[#`,
);

/** `<button>` the element and `<Button>` the primitive. Nothing else — see the docblock above. */
const BUTTON_CONTROL = /^(?:button|Button)$/;

/** Every button-control opening tag in the tree, from the SAME module-scope walk task 1 built. */
const BUTTON_CONTROLS = TAGS.filter((t) => BUTTON_CONTROL.test(t.name));

/** Button controls carrying at least one raw palette fill. */
const PALETTE_BUTTONS = BUTTON_CONTROLS.filter((t) => t.classes.some((c) => PALETTE_FILL.test(c)));

const PALETTE_COUNTS = countByFile(PALETTE_BUTTONS);

// THE MEASURED HEAD SPLIT, taken with THIS suite's own scanner on 2026-09-15 (not relayed):
//   `<button>` element tags ............ 213
//     of those, wearing a `btn*` class ...  95
//   `<Button>` component tags ........... 21
//   COMBINED button-control tags ....... 234
// It is recorded here so a future reader can tell a SCANNER FAILURE apart from the migration's
// own effect: as plans 15-39 land, the first number falls and the third rises while the fourth
// holds. Two figures were available at plan time and are deliberately NOT transcribed as
// measured-by-this-suite — a plain `grep -rno` over non-test `src/` (239 `<button`, 20 `<Button`)
// and round 2's relayed scanner figures (218 tags / 130 wearing `btn`), neither of which was
// re-run. The 95-vs-130 gap is the reason relayed counts are not trusted here.

// ---------------------------------------------------------------------------------------
// THE ROSTER. Seeded from the LIVE scan at execution, 2026-09-15: EIGHT raw-palette button
// sites across FOUR files — the same eight verified on 2026-09-14, re-derived rather than
// restated. Eight is a measurement, not a quota: a ninth would be rostered with a named owner
// and reported, because a raw-palette button with NO owner is the exact defect this rule exists
// to surface.
//
// No SECOND roster is introduced for the arbitrary-value or inline-`style` shapes. Measured on
// real button opening tags there are zero non-hex arbitrary-value fills, and the one inline-
// `style` fill (`groupHomePage/page.js:914`, the amber Create-Event CTA) is already owned under
// D-09 by plan 88.6-21, which deletes the inline `style` when it converts the control. A roster
// with no population is a gate that cannot red.
// ---------------------------------------------------------------------------------------
const PALETTE_BUTTON_EXEMPT: ExemptionRoster = {
  // Five sites: three `bg-indigo-600` buttons in the `sms_enabled`-gated phone block
  // (`:1631`, `:1650`, `:1675`) and the two theme toggles (`:1857` `bg-amber-50`,
  // `:1871` `bg-purple-900`).
  'app/userProfile/page.js': {
    sites: 5,
    why: 'D-11 -> plan 88.6-17: the three bg-indigo-600 phone-block buttons become `Button variant="primary"` with the Resend link as `variant="ghost"`; the two theme toggles become `Button` with the variant chosen from their current fill semantics',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / D-07 / D-11' },
  },
  // One site, `AvailabilityGrid.js:621` — the paint-mode toggle, carrying `bg-green-100` and
  // `bg-yellow-100` across its two arms. One ELEMENT, so one site.
  'app/components/AvailabilityGrid.js': {
    sites: 1,
    why: 'D-11 -> plan 88.6-25 re-derives: either `Button`, or a semantic token fill plus an exemption carrying its own provenance if the planner finds it is grid chrome rather than a control',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / D-07 / D-11' },
  },
  // One site, `ThemeToggle.js:49` — `bg-white/10`, icon chrome in the header.
  'app/components/ThemeToggle.js': {
    sites: 1,
    why: 'D-11 -> plan 88.6-34 re-derives: this is icon chrome rather than a primary action, so either `Button` or a semantic token fill with provenance, settled with the rest of D-11 there',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / D-07 / D-11' },
  },
  // THE EIGHTH SITE, and the one entry here whose `why` records a SURVIVING fill rather than a
  // fix. `groupHomePage/page.js:872` (`<button`, the Manage Members header CTA) carries
  // `bg-white/80` at `:876`, which this rule's `bg-white`-with-opacity clause matches. The
  // 80% white wash plus 1px ring is an OWNER RULING — `DECISION Phase 88.3-16` at
  // `groupHomePage/page.js:795`, ruling 2 of 2026-08-27 — re-affirmed 2026-09-14 as surviving
  // this phase. Plan 88.6-21 HOLDS it; it does not close it, and this entry must NOT be
  // rewritten as a pending fill change nor deleted when 21 lands.
  //
  // Note this same element ALSO wears `btn` (`:875`) and is therefore counted in task 1's `.btn`
  // census too. The two rules see one element for different reasons and neither subsumes the
  // other: the `.btn` there CLOSES under plan 21, the wash SURVIVES it.
  //
  // This is also the site that breaks round 2's framing of the census as "7 of the 88 buttons
  // that do NOT wear `btn`" — it wears both, so that framing structurally could not see it, and
  // it is why the palette rule runs over EVERY button control rather than only the non-`btn` ones.
  'app/groupHomePage/page.js': {
    sites: 1,
    why: 'SURVIVING, not pending: the 80% white wash plus 1px ring is owner ruling 2 of 2026-08-27, recorded as `DECISION Phase 88.3-16` at groupHomePage/page.js:795 and re-affirmed 2026-09-14; plan 88.6-21 HOLDS this exemption rather than closing it, and the element also wears `btn` at :875 so it appears in the .btn census too',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / D-07 / 88.3-16' },
  },
};

describe('D-07 / D-11: no button control on a raw palette fill', () => {
  // MIGRATION-INVARIANT FLOOR 1 — enumerated source files. The same quantity task 1 floors on,
  // stable across the phase because the sweeps REWRITE files rather than remove them.
  it('enumerated the source tree', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(150);
  });

  // MIGRATION-INVARIANT FLOOR 2 — the COMBINED `<button>` + `<Button>` tag count.
  //
  // A floor on the `<button>` population ALONE would be a floor on a quantity this phase exists
  // to CONSUME: it falls as the phase succeeds and eventually reds inside some later plan's
  // `npm test`, in a file that plan does not own, looking exactly like a scanner failure. The
  // SUM is invariant under the migration, because every conversion moves one tag from the first
  // population into the second; only an outright deletion can lower it. Floor 150, measured 234.
  it('found button controls to check, on a floor the migration cannot lower', () => {
    expect(BUTTON_CONTROLS.length).toBeGreaterThanOrEqual(150);
  });

  it('has a well-formed roster (every entry counted, reasoned and owned)', () => {
    expect(assertRosterShape(PALETTE_BUTTON_EXEMPT)).toEqual([]);
  });

  it('has zero raw-palette button controls outside the roster, at exactly the rostered counts', () => {
    expect(assertExactCounts(PALETTE_BUTTON_EXEMPT, PALETTE_COUNTS)).toEqual([]);
  });
});

// =====================================================================================
// THE SCANNER FIXTURE HARNESS — proving both rules CAN fail.
// =====================================================================================
//
// A gate that has never failed is a gate that cannot fail. This project's ledger records
// TWELVE defective gates (`src/app/decisionMarkers.test.ts:1-40` carries the tally and the
// taxonomy), and they fall into four SHAPES, every one of which is a way to look green while
// measuring nothing:
//
//   1. FILE-COUNT-WITH-SLACK — assert a threshold on a SUPERSET of the population you care
//      about. 88-28's `grep -rl 'DECISION Phase 87.8' | wc -l -ge 6` stayed green after
//      deleting all eight markers it existed to protect, because twelve files matched.
//   2. COMMENT-BLINDNESS — the gate matches its own DECISION markers, which necessarily quote
//      the tokens they forbid. DEF-88-25-02 (twice), DEF-88-27-01, DEF-88-28-01.
//   3. LINE-BASED MATCHING — `grep` and `[^>]*` cannot cross a newline, and every className in
//      this repo sits on a different line from its opening tag. DEF-88-21-01's control gate
//      matched 0 of 14 real controls.
//   4. SUBSTRING-MATCH-ANYWHERE — `grep -q "88-28"` proves a string exists somewhere in a
//      350-line file, not that the edit was made.
//
// The assertions below are the antidote, in the shape `src/lib/ci-grep-gate.fixture.test.ts`
// shipped: they run the REAL scanner (`scanSource`, the same function the module-scope walk
// uses) against in-file fixture STRINGS. Nothing on disk is perturbed, and they run on every CI
// pass rather than once by hand — which is what makes the demonstration durable instead of a
// probe someone did in a terminal and wrote a sentence about.
//
// The fixtures live inside a `.test.tsx` file, which `sourceFiles` excludes by construction, so
// the live census can never see them.

/** Run the `.btn` rule over a fixture string, exactly as the tree walk does. */
function btnHits(fixture: string): string[] {
  return scanSource('fixture.tsx', fixture)
    .filter((t) => t.chunks.some((c) => BTN.test(c)))
    .map((t) => `<${t.name}>`);
}

/** Run the raw-palette button-control rule over a fixture string, exactly as the tree walk does. */
function paletteHits(fixture: string): string[] {
  return scanSource('fixture.tsx', fixture)
    .filter((t) => BUTTON_CONTROL.test(t.name) && t.classes.some((c) => PALETTE_FILL.test(c)))
    .map((t) => `<${t.name}>`);
}

describe('the census scanner can actually fail (fixture harness)', () => {
  it('DETECTS `cn(...)` expression usage — the W19 shape a literal-only scan misses', () => {
    // This is the exact shape `Modal.tsx:346` carried until plan 88.6-08 retired it.
    expect(btnHits('<button className={cn(\'btn\', \'btn-primary\')}>Go</button>')).toEqual([
      '<button>',
    ]);
  });

  it('DETECTS a className on its own line — the multiline shape a `[^>]*` regex misses', () => {
    const fixture = ['<button', '  type="button"', '  className="btn btn-secondary"', '>', 'Go', '</button>'].join('\n');
    expect(btnHits(fixture)).toEqual(['<button>']);
  });

  it('does NOT detect a `.btn` written inside a comment (comment-blindness, shape 2)', () => {
    const fixture = ['// <button className="btn"> in a comment', 'const x = 1;'].join('\n');
    expect(btnHits(fixture)).toEqual([]);
  });

  it('does NOT detect `rounded-btn` — the lookbehind keeps Input/SelectField out of the census', () => {
    // Plan 88.6-09 measured that a plain `\bbtn\b` sweeps `rounded-btn` in and drags
    // `Input.tsx` and `SelectField.tsx` into any naive census. This pins the fix.
    expect(btnHits('<input className="rounded-btn border border-line" />')).toEqual([]);
  });

  it('DETECTS a raw palette fill on a `<button>`', () => {
    expect(paletteHits('<button className="bg-indigo-600">Save</button>')).toEqual(['<button>']);
  });

  it('does NOT flag a semantic token fill on a `<button>` (the any-`bg-*` rule was rejected)', () => {
    expect(paletteHits('<button className="bg-surface-card">Save</button>')).toEqual([]);
  });

  it('does NOT flag a non-button element — the rule is scoped to button CONTROLS', () => {
    expect(paletteHits('<div className="bg-indigo-600">panel</div>')).toEqual([]);
  });

  // THE POSITIVE CONTROL FOR THE WIDENED PREDICATE. Without this, the `<Button>` half of the
  // rule is unproven — and it is the half that keeps the rule alive after the migration, since
  // every sweep converts a `<button>` into a `<Button>` and carries its className along.
  it('DETECTS a raw palette fill on a `<Button>` — the half that survives the migration', () => {
    expect(paletteHits('<Button className="bg-indigo-600">Save</Button>')).toEqual(['<Button>']);
  });

  it('matches `bg-white/10` — an opacity suffix does not evade the palette rule', () => {
    expect(paletteHits('<button className="bg-white/10">x</button>')).toEqual(['<button>']);
  });
});

// =====================================================================================
// SPEC AC-3's SIBLING — no text-size utility on a `<Button>`.
// =====================================================================================
//
// `Button`'s cva base owns the control's type rung. A `text-sm` handed in from a call site
// wins through `cn()` / `twMerge` and silently re-tiers the control, which is the same
// last-wins hazard `controlSizeFloor.test.tsx:24-32` records for `<Input>`.
//
// DELIBERATELY NARROW, and it does NOT duplicate plan 88.6-11. That plan WIDENED
// `src/app/typeScaleTouchedSurfaces.test.ts`, which carries the TREE-WIDE type-rung rule over
// every surface. This assertion is the `Button`-scoped one, and it belongs beside the button
// census rather than in the type scanner because its population is defined by the tag, not by
// the surface. Folding it into the tree-wide scanner is a decision, not a cleanup.
//
// RESEARCH B.1 measured 59 dead `text-*` sites across the `.btn` census, but those sit on raw
// `.btn` ELEMENTS; they only become this rule's population after the sweeps convert them. At
// this wave the live measurement on `<Button>` tags is small, and the roster is what the
// scanner reported rather than what the plan predicted.

/** Text-size utilities, plus the arbitrary `text-[13px]` form. */
const TEXT_SIZE = /^text-(?:xs|sm|base|lg|xl|2xl|3xl)$|^text-\[[^\]]*px\]$/;

const BUTTON_COMPONENTS = TAGS.filter((t) => t.name === 'Button');
const TYPED_BUTTONS = BUTTON_COMPONENTS.filter((t) => t.classes.some((c) => TEXT_SIZE.test(c)));
const TYPED_BUTTON_COUNTS = countByFile(TYPED_BUTTONS);

// Seeded from the live scan, 2026-09-15: TWO sites, both in `gameDetail/page.js`
// (`:1282` and `:1290`, the desktop Edit/Delete ghost pair, each `className="px-3 py-1 text-sm"`).
const TYPED_BUTTON_EXEMPT: ExemptionRoster = {
  'app/gameDetail/page.js': {
    sites: 2,
    why: 'the two desktop ghost session actions carry `px-3 py-1 text-sm`; plan 88.6-18 sweeps gameDetail/page.js and re-tiers them onto a Button rung rather than a call-site text size',
    owner: { kind: 'spec', id: 'SPEC-88.6 R2 / AC-3' },
  },
};

describe('AC-3 sibling: no text-size utility on a `<Button>`', () => {
  // ANTI-VACUITY. Unlike the `<button>` population, the `<Button>` one only GROWS as the phase
  // lands, so a floor here can never fall by the migration succeeding. 10 is the floor; 21 is
  // the live measurement. Without it this whole describe passes vacuously if the scanner stops
  // resolving component tags — and the combined floor above cannot catch that, because 213 raw
  // `<button>` tags would carry it on their own.
  it('found `<Button>` call sites to check', () => {
    expect(BUTTON_COMPONENTS.length).toBeGreaterThanOrEqual(10);
  });

  it('has a well-formed roster', () => {
    expect(assertRosterShape(TYPED_BUTTON_EXEMPT)).toEqual([]);
  });

  it('has zero text-size utilities on `<Button>` outside the roster', () => {
    expect(assertExactCounts(TYPED_BUTTON_EXEMPT, TYPED_BUTTON_COUNTS)).toEqual([]);
  });
});
