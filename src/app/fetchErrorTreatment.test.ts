/**
 * Req 14 (DES-04/DES-05) guard for the surfaces plan 88-25 adopted the shared
 * fetch-error treatment on: no hand-rolled failure copy, and no raw upstream
 * message interpolated into user-facing text.
 *
 * WHY THIS EXISTS INSTEAD OF THE PLAN'S GREP
 * -----------------------------------------
 * 88-25's own verify gate is
 *
 *     ! grep -rniE "failed to load" <the eight files>
 *
 * and it is defective in BOTH directions — measured this session, not reasoned:
 *
 *   FALSE NEGATIVES. Run against the PRE-88-25 tree it matched 5 real code sites
 *   out of a population of ~34. It cannot see `Failed to X` for any verb other
 *   than "load" (`Failed to cancel event.`, `Failed to update username: …`,
 *   `Failed to remove participant.`), and it cannot see the sharper half at all:
 *   19 sites interpolating a raw `error.message` into a toast or an inline field
 *   error. DEF-88-19-01 predicted exactly this — "not one of these fifteen
 *   contains the phrase 'failed to load', so that gate goes fully green with the
 *   whole list standing" — and the plan's own `read_first` census used a WIDER
 *   pattern than its gate, so the two disagreed inside one task.
 *
 *   FALSE POSITIVES. `grep` cannot tell code from a comment. On the fully
 *   converged tree the gate is still RED, on two DECISION markers that exist to
 *   record this very work: `GroupLibrary.js` ("The library FAILED to load — a
 *   different fact from an empty library") and `userProfile/page.js` ("Deliberately
 *   NOT worded 'failed to load' — plan 88-25 arms a negative gate on that phrase").
 *   A gate that is red before the work and red after it distinguishes nothing —
 *   the same shape DEF-88-24-04 recorded for 88-24's Task 2 gate.
 *
 * That is the SEVENTH defective grep-shaped gate recorded in this phase
 * (DEF-88-16-01, DEF-88-19-01, DEF-88-21-01, DEF-88-24-04 x2, 88-25's Task 1
 * bare-border grep which also matched a comment, and this one). The scanner below
 * strips comments and strings-in-comments before matching, so neither failure mode
 * applies.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST
 * ---------------------------------------
 * Same reasoning as `components/controlSizeFloor.test.tsx` and
 * `cardPaddingIdiom.test.ts`: the property is "no site on these surfaces does X",
 * and the sites live behind role gates, tab conditionals, modal state and fetch
 * states that no single render reaches. A per-node render pin also goes green
 * forever the moment a new handler is added, which is the failure mode 88-19 named.
 * The branch-ORDERING half (error checked before empty) is a behaviour and IS
 * render-tested — see `GroupGamesList.emptyState.test.tsx` and
 * `components/emptyStates.split.test.tsx`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type ExemptionRoster,
} from '../test-utils/exemption';
import { sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/**
 * The tree walk, done ONCE at module level and reused by every assertion below.
 *
 * Plan 88.6-13 task 2 replaces the nine-entry `SURFACES` scope with the whole `src/` tree
 * for the raw-message and `Failed to X` assertions — measured 194 files — across roughly
 * five independent walks. Walking per assertion buys nothing: the suite reads a static
 * tree in a single process.
 *
 * `sourceFiles` returns ABSOLUTE paths. `ALL_REL` is the `src/`-relative mapping every
 * assertion and every allow-list keys on; an unmapped set silently matches no allow-list
 * entry, which is a gate that cannot fail.
 */
const ALL_FILES = sourceFiles(SRC);
const ALL_REL = ALL_FILES.map((f) => path.relative(SRC, f));

// The surfaces plan 88-25 declared.
//
// PHASE 88.6-13 (D-31, as amended by D54/D45/D29): this list is now the scope of the
// `alert(` assertion ONLY. The raw-message and `Failed to X` assertions scan the WHOLE
// `src/` tree (`ALL_REL`), because a named-surface list is green forever the moment
// surface N+1 lands — the vacuity mode `nativeDialogs.test.ts:31-38` names explicitly and
// SPEC AC-8 already demands full-tree coverage for. Measured at the widening: not ONE of
// the 19 files that actually carry a raw `error.message` read is on this list, so the two
// widened assertions were green because they were not looking.
//
// The `alert(` assertion KEEPS these nine deliberately — see its own comment below.
// `SURFACES.length === 9` is pinned as an assertion there, so a later plan cannot quietly
// add or remove an entry and change that assertion's reach unnoticed.
const SURFACES = [
  'app/groupPlanning/page.js',
  'app/groupHomePage/page.js',
  'app/gameDetail/page.js',
  'app/userProfile/page.js',
  'app/friends/page.js',
  'app/components/GroupLibrary.js',
  'app/components/OpenPollsList.js',
  'app/components/ScheduleList.js',
  // Adopted by 88-25 as the receiving half of DEF-88-18-01.
  'app/components/GroupGamesList.js',
];

// ONE comment stripper: `withoutComments` from `src/test-utils/sourceScan.ts`.
//
// This block is written with `//` and NOT as a `/* */` docblock ON PURPOSE: it has to quote
// both comment delimiters literally, and plan 88.6-11 measured that a `*/` inside a block
// comment silently truncates the file under vite:oxc — the suite then collects ZERO tests
// and reports green. Making it a docblock is a decision, not a cleanup.
//
// WHY THE LOCAL COPY IS GONE (plan 88.6-13 task 1, MEASURED — not assumed)
// -----------------------------------------------------------------------
// The local `stripComments` that lived here carried this reasoning, which is preserved
// because it is the record of what this file cares about:
//
//   "Strip `//` and block comments, preserving line count so reported line numbers stay
//    usable. String literals are NOT parsed out — a `//` inside a string is rare in this
//    codebase and erring toward stripping would create false negatives, which is the
//    failure mode this file exists to avoid."
//
// That last clause is the whole point, and the shipped implementation did not honour it.
// Both strippers were run over the set task 2 scans — all 194 files of `src/` — and their
// outputs diffed line by line (2026-09-15). Ignoring trailing whitespace (the local one
// DELETED a `//` comment to end-of-line, this one BLANKS it to spaces; neither affects a
// line-based regex) they differ on exactly TWO files and 31 lines, and in BOTH cases the
// LOCAL one blanks REAL CODE:
//
//   - `app/components/FeedbackForm.js:386-403` — the string `accept="image/*"` opens a block
//     comment the local stripper never knew was inside a string, which then runs to the `*/`
//     of the next real comment. 18 lines of live JSX vanish, `className` strings included.
//   - `app/components/Modal.tsx:265-281` — the same, from `src/**` written inside a `//` line
//     comment: the local block-comment pass runs FIRST, so that `/*` is seen before the `//`
//     that contains it, and everything to the next `*/` (line 281) is blanked.
//
// Blanked code is a FALSE NEGATIVE — precisely the failure mode the docblock named. So the
// correct stripper for THIS suite's question ("does a raw `error.message` read reach a
// user-facing sink") is the one that parses string literals. `withoutComments` blanks rather
// than deletes, so line numbers still survive.
//
// The suite's own offender set is UNCHANGED by the swap: over the nine `SURFACES` both
// strippers report the identical 3 raw-message hits, 0 `Failed to X` hits and 0 `alert(`
// hits (measured before and after). Neither divergent file is a `SURFACES` entry — which is
// exactly why nobody noticed, and exactly why task 2's widening had to fix this first.
//
// `src/test-utils/sourceScan.ts` is NOT edited by this plan, so none of its eleven consumer
// suites can shift.

/**
 * Read + strip a file at most ONCE per run, keyed on its `src/`-relative path.
 *
 * Task 2 widens two assertions from 9 files to 194 across ~5 walks; the un-memoized form
 * re-read and re-stripped on every call. File-local and behaviour-preserving — the offender
 * set is identical before and after, which is what this task's gate asserts.
 */
const strippedCache = new Map<string, { lines: string[]; raw: string }>();

function readStripped(rel: string): { lines: string[]; raw: string } {
  const cached = strippedCache.get(rel);
  if (cached) return cached;
  const raw = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const entry = { lines: withoutComments(raw).split('\n'), raw };
  strippedCache.set(rel, entry);
  return entry;
}

/** Sinks that put text in front of a person. */
const USER_FACING_SINK =
  /(toast\.(?:error|success|warning|info|message)\s*\(|\balert\s*\(|set[A-Za-z]*Error\s*\(|message:\s)/;

// A raw upstream message being read for display.
//
// 88.6-13 task 2 TIGHTENED the second arm, from the bare `\berrorMessage\b` to the same
// member-read shape as the first. This is the one amendment to task 1's "the three
// classifier regexes are byte-unchanged", and it is taken on a measurement:
//
//   - The bare arm matched TEN sites across three files that are all a LOCAL named
//     `errorMessage` — its `useState` declaration and its JSX render, never an upstream
//     read: `availability-form/[token]/page.js:33,:186`, `NextGameNightCard.tsx:108,:463`,
//     `createGroup.js:16,:53,:195,:196,:211,:212`.
//   - It matched ZERO real offenders. Every genuine site in those files is caught by the
//     `.message` arm instead, on the ASSIGNMENT line where the upstream value enters —
//     `createGroup.js:90` (`const errorMsg = error.message || 'Failed to create group…'`)
//     is the live example, and fixing it fixes the renders downstream of it.
//
// The alternative the plan offered was ten allow-list entries carrying the measurement.
// Ten entries for a regex arm that catches nothing is ten fossil permissions; the arm is
// the defect, so the arm is what moves. Widening it back is a decision, not a cleanup.
const RAW_MESSAGE_READ =
  /\b(?:err|error|e)\??\.message\b|\b(?:err|error|e)\??\.errorMessage\b/;

/** The hand-rolled failure idiom, any verb — not just "load". */
const AD_HOC_FAILURE_COPY = /['"`][^'"`]*\bFailed to \w+/i;

// A developer log. `console.error('Failed to get game invite token:', err)` is NOT the
// defect — the defect is that string reaching a person. Excluded only when the line
// carries no user-facing sink, so a line doing both is still caught. Sending the raw
// error to the console is the DESIGNED destination for it (88-19's ErrorFallback marker
// says so explicitly).
//
// 88.6-13 (D8/D11/D16) — TWO changes, both in the widening commit:
//
//  1. IT RECOGNISES THE HOUSE LOGGER CHANNEL, not just the browser console. AC-2 moves
//     ~100 call sites off `console.*` onto `logger.*` across waves 6-8; a call that
//     CHANGES CHANNEL must not change its exemption status, or a correct conversion reds
//     a gate it never touched. Three sites are known to cross while this gate is live:
//     `grouplist.js:91` (plan 21, wave 7) and `gameDetail/page.js:720`, `:756` (plan 18,
//     wave 7). This is test-local and has no runtime reach — measured 2026-09-15,
//     `grep -rn DEVELOPER_LOG src/` returns 5 hits, ALL in this file, zero production
//     consumers.
//  2. `:173`'s FILTER CAME ONTO `:205`'s RULE. The raw-message assertion used to exempt a
//     developer-log line OUTRIGHT while the `Failed to X` assertion exempted it only when
//     the line carried no user-facing sink — and the sink-guarded form is what the
//     docblock above has always promised. `:173` was the outlier. That is a SHIPPED
//     DEFECT, independent of anything 88.6 does: a line that both logged and displayed
//     was invisible to the raw-message assertion. Both assertions now apply
//     `isExemptDeveloperLog` and nothing else.
//
// The `[^.\w$]` guard keeps `foo.logger.x(` / `this.console.y(` out, the same discrimination
// `nativeDialogs.test.ts`'s bare-global detector makes.
const DEVELOPER_LOG = /(^|[^.\w$])(?:console|logger)\.\w+\s*\(/;

/**
 * The ONE developer-log exemption rule, shared by both widened assertions.
 *
 * A line that logs AND displays is NOT exempt — that is the whole content of the
 * `DEVELOPER_LOG` docblock's "so a line doing both is still caught".
 */
const isExemptDeveloperLog = (line: string): boolean =>
  DEVELOPER_LOG.test(line) && !USER_FACING_SINK.test(line);

/** A raw upstream message read on a line that is not an exempt developer log. */
const isRawMessageOffender = (line: string): boolean =>
  RAW_MESSAGE_READ.test(line) && !isExemptDeveloperLog(line);

/** Hand-rolled `Failed to X` copy on a line that is not an exempt developer log. */
const isFailedCopyOffender = (line: string): boolean =>
  AD_HOC_FAILURE_COPY.test(line) && !isExemptDeveloperLog(line);

interface Hit {
  file: string;
  line: number;
  text: string;
}

interface Source {
  rel: string;
  lines: string[];
}

/**
 * The whole comment-stripped tree, read through the ONE hoisted walk and the ONE memoized
 * reader, keyed on `src/`-relative paths.
 *
 * Relative mapping is load-bearing, not cosmetic: `sourceFiles` returns ABSOLUTE paths and
 * every allow-list and roster key below is `src/`-relative, so an unmapped set would match
 * no entry and the gate would report every exempt site as an offender — or, with the filter
 * inverted, none of them.
 */
const TREE: Source[] = ALL_REL.map((rel) => ({ rel, lines: readStripped(rel).lines }));

/** The nine `SURFACES`, in the same shape, for the `alert(` assertion. */
const SURFACE_TREE: Source[] = SURFACES.map((rel) => ({
  rel,
  lines: readStripped(rel).lines,
}));

const fmt = (hits: Hit[]) =>
  hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

// ALLOW-LIST, NOT SINK-MATCHING. The obvious formulation — "flag a line that has both a
// display sink and a `.message` read" — is the DEF-88-21-01 defect in miniature: `grep`
// and a line-based scan cannot cross a newline, and the idiom is routinely written over
// four lines:
//
//     toast.error(
//       getFetchErrorMessage(err, {
//         fallback: err.message,      <- no sink token on this line
//       })
//     );
//
// That exact reintroduction was PLANTED during 88-25's negative check and the
// sink-matching version passed it. So the property is inverted: every surviving read is
// enumerated, and anything not on the list fails by default.
//
// 88.6-13 AMENDMENT, one sentence: NARROWING an EXEMPTION with a not-a-sink condition is
// permitted, and is a different thing from sink-matching as the POSITIVE test, which stays
// forbidden. `isExemptDeveloperLog` is such a narrowing — it can only make the scan
// stricter (a line that logs AND displays stops being exempt), so it cannot reintroduce
// the newline blindness above, which is a false-NEGATIVE mode.
//
// TWO CLASSES LIVE IN THIS ONE LIST, and each entry's `why` says which it is:
//   - CONTROL FLOW: the read is branched on and never rendered.
//   - MEASURED-EMPTY: the read IS rendered, but the value is provably always `''`.
// They share a list because §2 below DERIVES the anti-vacuity array from it, and two
// hand-maintained literals cannot be kept in step by discipline. See the standing rule.
//
// STANDING RULE (88.6-13, stated once so it covers the next case as well as these):
//   (1) No entry may outlive the code it matches. The anti-vacuity assertion below is the
//       enforcement, and it is derived from THIS array so the two cannot drift.
//   (2) An entry whose matched code is scheduled for removal inside 88.6 names, in its
//       `why`, the plan that removes it, and states that the entry dies in that same
//       commit. A reader four waves later then sees a scheduled retirement, not a
//       permanent sanction.
//   (3) PLAN 13 DOES NOT EXECUTE THOSE REMOVALS. It is wave 3; the code still carries
//       every read below, so deleting a row here would make the scan FLAG it and red a
//       wave-3 gate. Plan 13 owns the `why` and this rule; the later-wave owner deletes
//       the row alongside its own edit.
//
// DELETED by 88.6-13: the `app/gameDetail/page.js` entry
// (`const message = String(err?.message || '').toLowerCase();`, 88-33 Task 2 Fork F). Its
// matched code is GONE — `grep -c 'String(err?.message' src/app/gameDetail/page.js` → 0,
// measured 2026-09-15. It survived because the anti-vacuity array below was a SECOND hand
// literal that listed 3 of the 4 entries and omitted exactly the dead one.
const CONTROL_FLOW_ALLOWED: Array<{ file: string; contains: string; why: string }> = [
  {
    file: 'app/groupHomePage/page.js',
    contains: "const msg = (error?.message || '').toLowerCase();",
    why: 'isRemovedFromGroupError — routes a removal 403 to a redirect. Never displayed.',
  },
  {
    file: 'app/friends/page.js',
    contains: "if (err.message && err.message.includes('404'))",
    why:
      'CONTROL FLOW. "no user found" is a search OUTCOME with no ApiError code. Never ' +
      'displayed. SCHEDULED FOR REMOVAL INSIDE 88.6: plan 88.6-42 (wave 8) re-keys both ' +
      'arms onto a status-based 404 test and DELETES this entry in that same commit. ' +
      'Confirmed 2026-09-15 from 88.6-42-PLAN.md — it declares src/app/friends/page.js in ' +
      'files_modified and its R8 §2 note withdraws the earlier "plan 19 owns this file, do ' +
      'not edit it from here" instruction in terms. Plan 88.6-13 does NOT edit ' +
      'friends/page.js and does NOT delete this entry: at wave 3 the code still carries the ' +
      'read, so an early deletion would make the scan flag it.',
  },
  {
    file: 'app/friends/page.js',
    contains: "} else if (err.message && err.message.includes('No user found'))",
    why:
      'CONTROL FLOW. Same search outcome, prose variant. Never displayed. SCHEDULED FOR ' +
      'REMOVAL INSIDE 88.6 by the same plan 88.6-42 (wave 8) commit as its sibling above — ' +
      'this arm can never match again once 42 drops the legacy `error` alias, because the ' +
      'string it matches is a raw backend 404 with no `code` and no `message`. The entry ' +
      'dies with the re-key. Plan 88.6-13 does not perform it.',
  },
  {
    file: 'app/components/FriendshipStatusProvider.js',
    contains: "if (err?.message?.includes('409') || err?.status === 409) {",
    why:
      'CONTROL FLOW. Status-FIRST duplicate-request branch — the message test is the ' +
      'legacy half of an `||` whose right arm already reads `err.status`. Never displayed. ' +
      'No 88.6 plan declares this file (measured 2026-09-15 across all 46 files_modified ' +
      'blocks), so no removal is scheduled inside this phase.',
  },
  {
    file: 'app/components/FriendshipStatusProvider.js',
    contains: "const is404 = err?.message?.includes('404') || err?.status === 404;",
    why:
      'CONTROL FLOW. Two sites (:180, :198), same line text: a not-found probe that ' +
      'resolves to a boolean and picks a UI state. Status-first, same shape as the 409 ' +
      'entry above. Never displayed. No 88.6 plan declares this file.',
  },
  {
    file: 'app/invite/game/[token]/page.js',
    contains: "const msg = err?.message || '';",
    why:
      'CONTROL FLOW. `classifyError`\'s local — a classifier over fetch-`TypeError` text ' +
      'that picks transient-vs-permanent. AMENDED by plan 88.6-23 (wave 7, 2026-09-16), ' +
      'which executed the removal the previous wording predicted: the FIVE backend-prose ' +
      'arms of `isPermanent` are GONE and that half now reads `httpStatus === 404 || ' +
      'httpStatus === 410`. What this local still feeds is the `isTransient` half, whose ' +
      'arms match text the CLIENT produces (fetch / `TypeError`), so plan 88.6-42\'s ' +
      'alias drop cannot reach them and this read is not on a path to zero. Never ' +
      'displayed: the copy the classifier selects is ratified register copy.',
  },
  {
    file: 'app/invite/game/[token]/page.js',
    contains: "lowerMsg.includes('failed to fetch') ||",
    why:
      'CONTROL FLOW, and it is on the "Failed to X" assertion, not the raw-message one: ' +
      "the lower-cased literal 'failed to fetch' is the browser's own TypeError text being " +
      'MATCHED, not copy being authored. AMENDED by plan 88.6-23 (wave 7, 2026-09-16): the ' +
      'previous wording said "Removed with the classifier by 88.6-23", which was WRONG in ' +
      'both halves — the classifier survives and this arm was deliberately left untouched. ' +
      'Only the prose arms of `isPermanent` were removed. This entry is PERMANENT unless the ' +
      'transient classification itself is redesigned.',
  },
  // DELETED by plan 88.6-23 task 1 (wave 7, 2026-09-16): the third
  // `app/invite/game/[token]/page.js` entry, which allow-listed the prose-matched 410 guard
  // `if (err.message && (err.message.includes('expired') || …))`. That line no longer exists —
  // the branch is selected by `err?.status === 410` now (D-45 / D-59), ahead of plan 88.6-42's
  // `body.error` alias drop in wave 8, which would otherwise have turned every one of those
  // strings into `HTTP error! status: 410` and silently killed the expired screen on the public
  // QR/SMS entry surface. The old entry routed the durable fix to Phase 93 on the ground that
  // "the durable fix needs the backend envelope"; that is no longer true for THIS site, because
  // `GET /events/invite-preview/:token` emits 410 at exactly one place (`routes/events.js:1306`),
  // so the status alone is unambiguous here. Entry DELETED, not left as a fossil permission —
  // the anti-vacuity assertion below reds on a stale one.
  {
    file: 'lib/logger.ts',
    contains: "const message = typeof e?.message === 'string' ? e.message : String(err);",
    why:
      'SANCTIONED DIAGNOSTIC READ — a third class, and it is the only one. This is ' +
      "`errCtx(err)`'s body: the helper that exists so AC-2's ~100 conversions never spell " +
      'the `message:` key at a call site. Its output goes to a `logger.*` ctx and never to ' +
      'a user-facing sink — the developer log is the DESIGNED destination for the raw ' +
      'error text (88-19\'s ErrorFallback marker). It is allow-listed HERE, visibly and ' +
      'countably, rather than dodged by naming the local something this scanner does not ' +
      'match. No removal is scheduled: the helper is permanent.',
  },
  {
    file: 'app/Header.js',
    contains: 'if (error) return <div>{error.message}</div>;',
    why:
      'MEASURED-EMPTY, not control flow. This RENDERS the message, but the message is ' +
      "Auth0's `useUser()` error, whose `RequestError` calls `super()` with no argument, so " +
      "`.message` is always ''. `layout.js:27` passes no fetcher, so no other value can " +
      'reach it. Nothing upstream is disclosed. The BLANK-RENDER defect this produces — the ' +
      'failure renders as nothing at all, the 2026-08-28 AUTH0_BASE_URL incident shape — is ' +
      'RECORDED AND ROUTED, not fixed here: see .planning/deferred/phase-88.6.md, proposed ' +
      'home plan 88.6-34. Plan 88.6-13 does not touch this file.',
  },
  {
    file: 'app/page.js',
    contains: '<div className="text-content-status-error">Error: {error.message}</div>',
    why:
      'MEASURED-EMPTY, not control flow. Same Auth0 `useUser()` error as Header.js:55 and ' +
      'the same always-empty `.message`. Listed EXPLICITLY rather than excluding the file, ' +
      'because `app/page.js:40` is a developer log in the same file and any file-level rule ' +
      'would hide this live render behind it. Routed with its sibling to ' +
      '.planning/deferred/phase-88.6.md (proposed home plan 88.6-34).',
  },
];

const isAllowed = (hit: Hit): boolean =>
  CONTROL_FLOW_ALLOWED.some((a) => a.file === hit.file && hit.text.includes(a.contains));

/**
 * The ASSERTION PATH, as one function: predicate, then the allow-list filter.
 *
 * Fixtures below drive synthetic `Source`s through THIS function rather than re-asserting
 * a regex conjunction the way the shipped self-test at the bottom of this file does. A
 * fixture that only re-asserts the conjunction passes whether or not the filter was fixed,
 * which is exactly how the `:173` outlier survived.
 */
function offenders(predicate: (line: string) => boolean, source: Source[]): Hit[] {
  const hits: Hit[] = [];
  for (const { rel, lines } of source) {
    lines.forEach((line, i) => {
      if (predicate(line)) hits.push({ file: rel, line: i + 1, text: line.trim() });
    });
  }
  return hits.filter((h) => !isAllowed(h));
}

/** Per-file offender counts, in the shape `assertExactCounts` compares against. */
const countByFile = (hits: Hit[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const h of hits) out[h.file] = (out[h.file] ?? 0) + 1;
  return out;
};

// The RESEARCH §B.5 hand census — 25 SITES across 16 FILES. It is a LEAD, never the seed:
// both rosters below are seeded from the scan RE-DERIVED at execution. It is kept here as
// an anti-vacuity subject (every one of its files must be in the scanned set) and as the
// record of what a hand census misses — `StartPollModal.js:151` is a live raw render it
// does not contain at all.
const CENSUS_SITES = [
  'app/invite/accept/page.js:59',
  'app/invite/group/[token]/page.js:109',
  'app/invite/game/[token]/page.js:90',
  'app/invite/game/[token]/page.js:143',
  'app/components/createGroup.js:90',
  'app/components/ScheduleForm.js:177',
  'app/components/FriendInvitePanel.js:268',
  'app/components/AvailabilityForm.js:142',
  'app/components/BrowseMoreModal.js:120',
  'app/components/ResponseDashboard.js:49',
  'app/components/ResponseDashboard.js:99',
  'app/components/SuggestionCard.js:56',
  'app/components/GameComboInput.js:131',
  'app/components/GroupSettings.js:481',
  'app/components/GroupSettings.js:532',
  'app/components/ManageMembers.js:138',
  'app/components/ManageMembers.js:208',
  'app/components/ManageMembers.js:239',
  'app/components/ManageMembers.js:251',
  'app/components/ManageMembers.js:296',
  'app/components/ManageMembers.js:333',
  'app/components/ManageMembers.js:761',
  'app/components/FeedbackButton.js:208',
  'app/components/FeedbackForm.js:241',
  'app/components/createEvent.js:838',
];

// The survivors of the raw-message assertion, seeded from the MEASURED tree scan
// (2026-09-15): 33 sites / 19 files after the allow-list filter. Every entry names the
// plan that closes it, and `assertExactCounts` is checked in BOTH directions — so a
// partial fix must DECREMENT the entry and the last fix must DELETE it.
const RAW_MESSAGE_EXEMPT: ExemptionRoster = {
  'app/api/auth/google-connect/route.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :72 interpolates `error.message` into a route-handler JSON ' +
      'error body. NO 88.6 sweep plan owns these copy sites — plan 88.6-42 task 2 (#82) ' +
      'declares and edits this file for the envelope work, but not for this. Routed under ' +
      'the AC-22 rule to .planning/deferred/phase-88.6.md with Phase 93 named as the ' +
      'proposed owning phase, so plan 88.6-46 AC-11 forces a dated disposition at phase ' +
      'close rather than letting the residual evaporate.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling:
        'AC-22 routing: an unowned raw-backend-envelope read takes a roster entry AND a ' +
        'durable deferred entry naming Phase 93 as the proposed owner — a bare "recorded" ' +
        'disposition is what lets a residual evaporate.',
    },
  },
  // DELETED by plan 88.6-25 task 2 (wave 7, 2026-09-16): `app/components/AvailabilityForm.js`
  // carried `sites: 3` and ALL THREE closed in one commit, which is what the entry's own `why`
  // required — deleting it after :142 alone would have retired the only receipt that catches the
  // two prefill renders.
  //   :142  the submit-path read -> `getFetchErrorMessage(error)`, no fallback (D62 branch B, so
  //         the register's generic line is what lands, by design and recorded as a residual).
  //   :174, :203  the two prefill catches, which STORED `err.message` into `prefillStatus` and
  //         interpolated it verbatim into a rendered sentence on the ANONYMOUS magic-link page.
  //         They now store `failed: true` and carry NO message at all, and the render says
  //         "Couldn't import from Google Calendar." / "Couldn't use saved availability." as
  //         complete sentences. NO EXEMPTION was written for either: they are displayed to a
  //         user, not developer logs, and the entry's own text forbids one.
  // Entry DELETED rather than zeroed.
  'app/components/BrowseMoreModal.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :120 `setError(err.message || …)`. Closed by plan 88.6-32 ' +
      '(wave 7), which declares this file; the entry is deleted in that commit.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/FeedbackButton.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :211 (the census says :208 — the file has moved; the ' +
      'disagreement is recorded in 88.6-13-SUMMARY.md). D-21: its sibling FeedbackForm.js ' +
      'has a Sentry capture on this path and this file does not. Closed by plan 88.6-31 ' +
      '(wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-31' },
  },
  'app/components/FeedbackForm.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :241 `setError(err.message || …)`. D-21 names this file and ' +
      'FeedbackButton.js as a pair; both are in the scanned set. Closed by plan 88.6-31 ' +
      '(wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-31' },
  },
  // DELETED by plan 88.6-22 task 1 (wave 7, 2026-09-16): `app/components/FriendInvitePanel.js`
  // carried `sites: 1` here — `:268` pre-edit, `toast.error(err.message || 'Failed to reset
  // invite link. Please try again.')`. It now routes through `getFetchErrorMessage(err)` with no
  // fallback, keeping its INTENT (the reset action still reports its own failure) per UI-SPEC
  // §6.4. Entry DELETED rather than zeroed — the roster is exact in both directions. This file's
  // FAILED_COPY_EXEMPT entry (3, one of them the same line) closed in the same commit.
  'app/components/GameComboInput.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :131 is a T-88-25-01 site AND a Req 11 native-dialog site — ' +
      "it is the SAME line nativeDialogs.test.ts holds as an exact-count `alert(` " +
      'exemption. Both rosters shrink together. Closed by plan 88.6-32 (wave 7).',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/GroupSettings.js': {
    sites: 2,
    why:
      'RAW-MESSAGE assertion. :481 and :532 — a leave-group field error and a delete-group ' +
      'toast, both `x.message || "Failed to …"`. Closed by plan 88.6-20 (wave 7), which ' +
      'declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-20' },
  },
  // DELETED by plan 88.6-19 task 1 (wave 7, 2026-09-16): `app/components/ManageMembers.js`
  // carried `sites: 7` here (:138, :208, :239, :251, :296, :333, :761 pre-edit) — the largest
  // single concentration in the tree. All seven now route through
  // `getFetchErrorMessage(err)` on the ratified register: six as `toast.error` (the mutation
  // arm) and `:333` as the in-modal leave failure, which keeps its message in place and gained
  // an announcing `StatusRegion`. Entry DELETED rather than zeroed — the roster is exact in
  // both directions, so a zeroed entry would red as a fossil permission. This file's
  // FAILED_COPY_EXEMPT entry (8, one more than this one) closed in the same commit.
  'app/components/ResponseDashboard.js': {
    sites: 2,
    why:
      'RAW-MESSAGE assertion. :49 and :99 — a load error and a reminder-send error, both ' +
      '`setX(err.message || "Failed to …")`. Closed by plan 88.6-32 (wave 7), which ' +
      'declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/ScheduleForm.js': {
    sites: 2,
    why:
      'RAW-MESSAGE assertion. :177 is the census site; :178 is a SECOND read the census ' +
      "missed — `setError('root', { message: error.message })` puts the raw message into a " +
      'react-hook-form root error, which renders. Closed by plan 88.6-32 (wave 7), which ' +
      'declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  // DELETED by plan 88.6-22 task 2 (wave 7, 2026-09-16): `app/components/StartPollModal.js`
  // carried `sites: 1` — `:151` pre-edit, `const msg = (err && err.message) || …`, rendered raw
  // by the else arm at `:157`. The whole catch is re-keyed onto the HTTP STATUS through
  // `getFetchErrorMessage(err, { byCode: { conflict, forbidden } })` with no fallback; both prose
  // regexes are gone and a `DECISION Phase 88.6-22` marker sits where the D-ADAPT-02
  // keep-in-sync comment was. This entry was the proof that a hand census cannot be the seed —
  // RESEARCH §B.5 does not contain this file at all. Entry DELETED rather than zeroed.
  'app/components/SuggestionCard.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :56 `setError(err.message || "Failed to create event")`. Its ' +
      'sibling :53 reads `result.error`, not a message, so it is on the "Failed to X" ' +
      'roster only. Closed by plan 88.6-33 (wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-33' },
  },
  // DELETED by plan 88.6-25 task 1 (wave 7, 2026-09-16): `app/components/createEvent.js` carried
  // `sites: 1` — :838 pre-edit,
  // `toast.error(\`Failed to ${…} event. ${error.message || 'Please try again.'}\`)`. It now reads
  // `toast.error(getFetchErrorMessage(error))` with NO fallback: this is a mutation inside an open
  // modal whose context must not move (UI-SPEC §6.2 row 3), and the register's own generic line
  // answers a code-less failure, so no copy was authored (P1, the §6.2 W16 precedent). The FILE's
  // OTHER `.message` read is gone too — `grep -nE '\\.message' createEvent.js` returns nothing.
  // Entry DELETED rather than zeroed.
  'app/components/createGroup.js': {
    sites: 1,
    why:
      'RAW-MESSAGE assertion. :90 is the ASSIGNMENT where the upstream value enters ' +
      '(`const errorMsg = error.message || "Failed to create group…"`); the six downstream ' +
      '`errorMessage` local reads in this file are not offenders and are no longer matched ' +
      'after the regex tightening. Fixing :90 fixes the renders. Closed by plan 88.6-33 ' +
      '(wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-33' },
  },
  // DELETED by plan 88.6-23 task 2 (wave 7, 2026-09-16): `app/invite/accept/page.js` carried
  // `sites: 1` (:59 `const msg = err.message || "Something went wrong"`, then displayed). The
  // read is gone and the three outcomes it fed are keyed on `err.code` instead — `not_found`,
  // a GATED `forbidden`, and `getFetchErrorMessage(err)` for everything else. The gate matters:
  // TWO sources put a code-less 403 on this call (the backend's wrong-email refusal at
  // `routes/invites.js:757-758` and the BFF proxy's CSRF rejection), so the override is
  // discriminated on a structural `csrf_rejected` marker rather than on `code` alone.
  // This file's OTHER `.message` read — the `console.error` at :83, now
  // `logger.info('Failed to fetch invite info:', errCtx(err))` — was never a roster site: it is
  // developer-log exempt, and after the conversion `errCtx` keeps the `message:` key off the
  // call line entirely. Entry DELETED, not zeroed.
  // DELETED by plan 88.6-23 task 1 (wave 7, 2026-09-16). `app/invite/game/[token]/page.js`
  // carried `sites: 2` (:90 and :143, both `setError(err.message || …)`) and
  // `app/invite/group/[token]/page.js` carried `sites: 1` (:109). All three now read
  // `setError(getFetchErrorMessage(err))` — the ratified register, no fallback string authored:
  // a real network failure already arrives as `ApiError(…, 'network', 0)` (api.ts:348-352), so
  // the register's own `network` line covers the case the hand-rolled fallbacks were written for.
  // Of the THREE allow-list entries the old `why` named for the game page, one is GONE with the
  // code it described (:79, the prose-matched 410 guard, re-keyed to `err?.status === 410`) and
  // two SURVIVE (:28 and :36, both inside `classifyError`'s fetch-`TypeError` arms, which the
  // re-key deliberately left alone). Entries DELETED, not zeroed.
  'lib/api.ts': {
    sites: 3,
    why:
      'RAW-MESSAGE assertion. :346 and :452 are `error instanceof Error ? error.message : ' +
      '"Unknown error"` at the fetch boundary; :434 maps a validation-errors array through ' +
      '`err.message`. None carries a `console.` token, so none is developer-log exempt ' +
      "today — this file's five console.error lines are separate and are plan 88.6-42's " +
      'AC-2 conversions. Closed by plan 88.6-42 (wave 8), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-42' },
  },
};

// The survivors of the "Failed to X" assertion, seeded from the MEASURED tree scan
// (2026-09-15): 35 sites / 19 files after the allow-list filter. The zero-tolerance
// assertion has ~28 hits inside the census files alone, so it cannot be widened without
// this roster.
const FAILED_COPY_EXEMPT: ExemptionRoster = {
  'app/api/auth/google-connect/route.js': {
    sites: 2,
    why:
      '"FAILED TO X" assertion. :53 and :72 author failure copy in a route handler. Same ' +
      'AC-22 routing as this file\'s raw-message entry: NO 88.6 sweep plan owns these copy ' +
      'sites, so they also take a durable entry in .planning/deferred/phase-88.6.md with ' +
      'Phase 93 named as the proposed owning phase. Plan 88.6-42 task 2 (#82) edits this ' +
      'file for the envelope work — cited so the two records do not diverge.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling:
        'AC-22 routing: an unowned site takes a roster entry AND a durable deferred entry ' +
        'naming Phase 93 as the proposed owner, so plan 88.6-46 AC-11 forces a dated ' +
        'disposition at phase close.',
    },
  },
  // DELETED by plan 88.6-25 task 2 (wave 7, 2026-09-16): `app/components/AvailabilityForm.js`
  // carried `sites: 1` — :142's 'Failed to submit availability. Please try again.' fallback,
  // the authored half of the same line its raw-message entry covered. It is GONE rather than
  // reworded: `getFetchErrorMessage(error)` is called with NO fallback, so the ratified register
  // answers and no copy was authored (P1; the §6.2 W16 precedent). Entry DELETED, not zeroed.
  'app/components/BrowseMoreModal.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :120 "Failed to load suggestions" — the fallback half of ' +
      'the same line its raw-message entry covers. Closed by plan 88.6-32 (wave 7).',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/FeedbackButton.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :211 "Failed to submit feedback. Please try again." Closed ' +
      'by plan 88.6-31 (wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-31' },
  },
  'app/components/FeedbackForm.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :241 "Failed to submit feedback. Please try again." Closed ' +
      'by plan 88.6-31 (wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-31' },
  },
  // DELETED by plan 88.6-22 task 1 (wave 7, 2026-09-16): `app/components/FriendInvitePanel.js`
  // carried `sites: 3` — `:223` "Failed to send invite" (the email-invite catch's else arm),
  // `:268` the reset toast (also its raw-message entry above), and `:427` "Failed to send
  // invites. Please try again." (the bulk-invite all-failed branch). All three route through
  // `getFetchErrorMessage` now. `:427` was NOT named by the plan's task text and had no error
  // object in scope, so `handleBulkInvite` now keeps the FIRST non-terminal failure and the
  // branch renders the register line from it — see the marker at that site. The file's two
  // `logger.info('Failed to …', errCtx(err))` developer logs (:251, :267 pre-edit) are exempt
  // per-line under `isExemptDeveloperLog`, whose channel widening plan 88.6-13 landed at wave 3;
  // re-measured here and a no-op. Entry DELETED, not zeroed.
  'app/components/GameComboInput.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :131 — the same line as its raw-message entry and the same ' +
      "line as nativeDialogs.test.ts's `alert(` exemption. Three rosters, one site, all " +
      'shrinking together. Closed by plan 88.6-32 (wave 7).',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/GroupSettings.js': {
    sites: 3,
    why:
      '"FAILED TO X" assertion. :406, :481, :532 — one more than the raw-message count, ' +
      'because :406 authors copy without reading a message. Closed by plan 88.6-20 ' +
      '(wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-20' },
  },
  // DELETED by plan 88.6-19 task 1 (wave 7, 2026-09-16): `app/components/ManageMembers.js`
  // carried `sites: 8` here — the seven raw-message lines plus :112 "Failed to load members",
  // which read no message. The seven took `getFetchErrorMessage(err)` with NO fallback (the
  // register has no entry for any of them, so the ratified `unknown` string answers and no
  // copy is authored), and :112's load failure moved onto the §6.2 arm-1 treatment: it now
  // holds the ERROR OBJECT and renders through `useFetchErrorState` + `<FetchErrorBanner>`.
  // Zero "Failed to X" sites remain, so the entry is deleted rather than zeroed. Its
  // RAW_MESSAGE_EXEMPT sibling closed in the same commit, as that entry's `why` said it would.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleManager.js` carried
  // `sites: 2` here (`:100`, `:111`) — the same two lines `nativeDialogs.test.ts` carried as
  // its `alert(` exemption. Both are now `toast.error(getFetchErrorMessage(err, { fallback }))`
  // on the UI-SPEC §6.3 ratified strings, so the file holds ZERO "Failed to X" sites and the
  // entry is deleted rather than zeroed (exact in both directions). Both rosters shrank in the
  // same commit, as this entry's `why` said they would.
  'app/components/ResponseDashboard.js': {
    sites: 2,
    why:
      '"FAILED TO X" assertion. :49 "Failed to load respondents" and :99 "Failed to send ' +
      'reminder" — the fallback halves of the same two lines its raw-message entry covers. ' +
      'Closed by plan 88.6-32 (wave 7).',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/ScheduleForm.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :177 only — :178 puts the raw message in a form root error ' +
      'but authors no copy. Closed by plan 88.6-32 (wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-32' },
  },
  'app/components/SuggestionCard.js': {
    sites: 2,
    why:
      '"FAILED TO X" assertion. :53 and :56 both author "Failed to create event"; only :56 ' +
      'reads a message, which is why the raw-message count for this file is 1. Closed by ' +
      'plan 88.6-33 (wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-33' },
  },
  'app/components/TimezoneProvider.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :103 "Failed to save your timezone — please try again." ' +
      'toast. NO 88.6 plan declares this file — measured 2026-09-15 across all 46 ' +
      'files_modified blocks — so under the AC-22 rule it takes this entry AND a durable ' +
      'entry in .planning/deferred/phase-88.6.md with Phase 93 named as the proposed owning ' +
      'phase, and plan 88.6-46 AC-11 forces a dated disposition at phase close. Note the ' +
      'correction to the plan text: this site is "Failed to X" copy only, NOT a raw-message ' +
      'read — it appears on this roster and not on the other.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling:
        'AC-22 routing: an unowned site takes a roster entry AND a durable deferred entry ' +
        'naming Phase 93 as the proposed owner — a bare "recorded" disposition is what ' +
        'lets a residual evaporate.',
    },
  },
  // DELETED by plan 88.6-25 task 1 (wave 7, 2026-09-16): `app/components/createEvent.js` carried
  // `sites: 1` — :709 "Failed to create custom game. Please try again.", a DIFFERENT line from the
  // :838 its raw-message entry covered. The plan's task text names only :838; :709 is this
  // roster's site and closing it was required to delete the entry, so it was swept in the same
  // pass and recorded as a deviation. Both now read `getFetchErrorMessage(err)` with no fallback.
  // Entry DELETED rather than zeroed.
  'app/components/createGroup.js': {
    sites: 1,
    why:
      '"FAILED TO X" assertion. :90 — the same assignment line its raw-message entry ' +
      'covers. Closed by plan 88.6-33 (wave 7), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-33' },
  },
  // DELETED by plan 88.6-23 task 1 (wave 7, 2026-09-16). `app/invite/game/[token]/page.js`
  // carried `sites: 1` (:143 "Failed to join game night.") and
  // `app/invite/group/[token]/page.js` carried `sites: 1` (:109 "Failed to join group.") —
  // the same lines their raw-message entries covered. Both hand-rolled strings went with the
  // `getFetchErrorMessage(err)` re-key. The game page's `:36` `'failed to fetch'` is NOT
  // affected: it is the browser's own TypeError text being MATCHED, it stays an allow-list
  // entry, and `classifyError`'s transient arms were deliberately left untouched by the re-key.
  // Entries DELETED, not zeroed.
  'lib/api.ts': {
    sites: 2,
    why:
      '"FAILED TO X" assertion. :1126 and :1159 throw `new Error(err.error || "Failed to ' +
      '…")` — authored copy on the throw path, distinct from the three raw-message reads ' +
      'in the same file. Closed by plan 88.6-42 (wave 8), which declares this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R1 / DEF-88-25-01 — closed by plan 88.6-42' },
  },
};

describe('Req 14 — the shared fetch-error treatment, scanned tree-wide', () => {
  const rawHits = offenders(isRawMessageOffender, TREE);
  const failedHits = offenders(isFailedCopyOffender, TREE);

  it('a raw upstream error message is only ever logged or branched on, never displayed (T-88-25-01, ASVS V7)', () => {
    // `ApiError.message` is `body.message ?? body.error ?? \`HTTP error! status: N\``
    // (api.ts extractErrorMessage), so displaying it paints whatever the backend
    // sent — or a raw status line — at the user. Derived copy replaces it; see
    // the DECISION marker on getFetchErrorMessage.
    //
    // Scope is the whole mapped `src/` tree. The residue is the ROSTER, not a shorter
    // scope — so a fix shrinks an entry and surface N+1 cannot land green.
    const unowned = rawHits.filter((h) => !(h.file in RAW_MESSAGE_EXEMPT));
    expect(fmt(unowned)).toBe('');
  });

  it('no hand-rolled "Failed to X" copy survives, for ANY verb', () => {
    // Deliberately wider than the plan's `failed to load`: the real population
    // was mostly other verbs (cancel/update/remove/submit/import/create).
    const unowned = failedHits.filter((h) => !(h.file in FAILED_COPY_EXEMPT));
    expect(fmt(unowned)).toBe('');
  });

  it('both rosters are EXACT in both directions — a fix must shrink its entry', () => {
    // The shrink direction is what stops a fossil permission; the grow direction is what
    // stops an exempt file absorbing a new offender. `assertExactCounts` also reports an
    // offender in a file with no entry at all, which is the same population the two
    // assertions above check — asserted here as well, because a roster that silently
    // tolerated one would make those assertions the only guard.
    expect(assertExactCounts(RAW_MESSAGE_EXEMPT, countByFile(rawHits))).toEqual([]);
    expect(assertExactCounts(FAILED_COPY_EXEMPT, countByFile(failedHits))).toEqual([]);
  });

  it('both rosters satisfy the shared D-19 exemption schema', () => {
    expect(assertRosterShape(RAW_MESSAGE_EXEMPT)).toEqual([]);
    expect(assertRosterShape(FAILED_COPY_EXEMPT)).toEqual([]);
  });

  it('the allow-list is not stale — every entry still matches real code (anti-vacuity)', () => {
    // An allow-list entry that no longer matches anything is dead weight that would
    // silently permit a future read of the same shape.
    //
    // 88.6-13 §2: this array is now DERIVED from `CONTROL_FLOW_ALLOWED` instead of being a
    // second hand-maintained literal. The two had already drifted — the literal listed 3
    // of the 4 shipped entries and omitted exactly the dead `app/gameDetail/page.js` one,
    // which is why this very assertion did not catch it. Two literals cannot be kept in
    // step by discipline; one derivation cannot drift at all, and closing an entry is now
    // ONE deletion instead of two.
    for (const a of CONTROL_FLOW_ALLOWED) {
      const { lines } = readStripped(a.file);
      expect(
        lines.some((l) => l.trim().includes(a.contains)),
        `stale allow-list entry: ${a.file} no longer contains "${a.contains}"`
      ).toBe(true);
    }
  });

  it('no native alert() survives on these surfaces (DEF-88-16-01)', () => {
    // Req 11's shipped gate matches `confirm(` only, so every `alert(` was
    // invisible to it. Two of the six DEF-88-16-01 censused were on files this
    // plan owns; this pins those two closed. The other four are tracked there.
    //
    // 88.6-13: this assertion KEEPS the nine `SURFACES` while the two above went
    // tree-wide, and that asymmetry is deliberate (CONSEQUENCE, not an oversight).
    // `nativeDialogs.test.ts:31-38` owns the repo-wide `alert(` property by an explicit
    // written decision and holds `GameComboInput.js` as an exact-count `sites: 1`
    // exemption. Widening this scan repo-wide would red on that site and create a SECOND
    // answer to a question that suite already answers.
    //
    // The exact-count scope pin below is the mechanical half: `SURFACES` survives this
    // phase ONLY as this assertion's scope, so a later plan adding or removing an entry
    // must come through this number rather than silently changing the reach.
    expect(SURFACES.length).toBe(9);
    const hits = offenders((l) => /(^|[^.\w$])alert\s*\(/.test(l), SURFACE_TREE);
    expect(fmt(hits)).toBe('');
  });

  it('the scanned set is the TREE, and everything that must be in it is (anti-vacuity)', () => {
    // Three guards, all ADDITIONS. There was no `SURFACES.length` floor of any width to
    // drop — measured 2026-09-15, `grep -c 'length' src/app/fetchErrorTreatment.test.ts`
    // returned 0 before this plan and `SURFACES` holds 9 entries, not 24.
    //
    // (a) A file floor, so a bad glob or a moved root cannot make the two widened
    //     assertions vacuously green.
    expect(TREE.length).toBeGreaterThanOrEqual(150);

    // (b) Every census file, every shipped SURFACES entry, and every allow-listed file is
    //     actually in the scanned set. A rename would otherwise silently drop it.
    const scanned = new Set(ALL_REL);
    const censusFiles = [...new Set(CENSUS_SITES.map((s) => s.replace(/:\d+$/, '')))];
    for (const f of censusFiles) {
      expect(scanned.has(f), `census path ${f} is not in the scanned set`).toBe(true);
    }
    for (const f of SURFACES) {
      expect(scanned.has(f), `SURFACES entry ${f} is not in the scanned set`).toBe(true);
    }

    // (c) Every CONTROL_FLOW_ALLOWED file is a scanned file. This is the guard that
    //     survives a rename or a bad glob: an allow-list keyed on a path nothing scans is
    //     an allow-list that permits nothing and hides that it permits nothing. REMOVING
    //     THIS IS A DELIBERATE LOOSENING under SPEC P2 and needs an owner ruling.
    for (const a of CONTROL_FLOW_ALLOWED) {
      expect(scanned.has(a.file), `allow-listed ${a.file} is not in the scanned set`).toBe(
        true
      );
    }
  });

  it('the developer-log exemption follows a call onto the house logger, and STILL catches a line that displays', () => {
    // ANTI-VACUITY FOR THE EXEMPTION CHANGE ITSELF. The shipped self-test at the bottom of
    // this file asserts on the regex CONJUNCTION and never calls the scanner, so a fixture
    // placed beside it passes whether or not the `:173` filter was fixed. These fixtures go
    // through `offenders()` — the same function both real assertions call.
    const run = (line: string) => ({
      raw: offenders(isRawMessageOffender, [{ rel: 'fixture.js', lines: [line] }]).length,
      failed: offenders(isFailedCopyOffender, [{ rel: 'fixture.js', lines: [line] }]).length,
    });

    // 1. A logger-only line is EXEMPT on both assertions — this is what stops AC-2's ~100
    //    conversions from falsely redding a gate they never touched. The first reads a raw
    //    message and is still exempt because it carries no sink; the second authors
    //    "Failed to X" copy and is exempt for the same reason.
    expect(run(`logger.error('load failed: ' + err.message, err);`)).toEqual({
      raw: 0,
      failed: 0,
    });
    expect(run(`logger.error('Failed to widget:', errCtx(err));`)).toEqual({
      raw: 0,
      failed: 0,
    });

    // 1b. THE HAZARD `errCtx` EXISTS FOR (D8/D11/D16), pinned rather than asserted in
    //     prose. `USER_FACING_SINK` ends in a bare `message:` arm, so the most NATURAL
    //     spelling of AC-2's "put the error's name and message in the ctx object" matches
    //     BOTH patterns on one line and DEFEATS the exemption — a correct conversion reds
    //     the gate. With `errCtx(err)` that key never appears at a call site (fixture
    //     above). This is not hypothetical: it is why `src/lib/logger.ts` exports the
    //     helper, and it is why the fix is NOT "drop the message from the ctx".
    expect(run(`logger.info('load failed', { name: err.name, message: err.message });`)).toEqual(
      { raw: 1, failed: 0 }
    );

    // 2. A console-only line is still exempt — the browser channel did not lose anything.
    expect(run(`console.error('Failed to widget:', err);`)).toEqual({ raw: 0, failed: 0 });

    // 3. A line that BOTH logs and displays is REPORTED on both assertions. Before this
    //    plan the raw-message filter exempted it outright and only the "Failed to X"
    //    filter caught it; that was a shipped defect, and this is the fixture that pins it.
    expect(run(`logger.error('x', err); toast.error(err.message);`)).toEqual({
      raw: 1,
      failed: 0,
    });
    expect(run(`console.error('x', err); toast.error('Failed to widget.');`)).toEqual({
      raw: 0,
      failed: 1,
    });
    expect(run(`logger.warn('x', err); setThingError(err.message || 'Failed to widget.');`)).toEqual(
      { raw: 1, failed: 1 }
    );

    // 4. The three sites that CHANGE CHANNEL mid-phase, asserted against what they BECOME.
    //    Each is exempt today as a `console.*` line and must stay exempt after its AC-2
    //    conversion; their `toast.error(getFetchErrorMessage(...))` sinks sit on the
    //    FOLLOWING line, which is why the sink guard is line-based and why `errCtx` exists.
    //    Verbatim from the live tree (grouplist.js:91, gameDetail/page.js:720, :756), then
    //    the converted form.
    const channelChangers: Array<[string, string]> = [
      [
        `console.error('Error fetching groups:', error.message || 'Unknown error');`,
        // Deliberately keeps the raw message ON the converted line: without the channel
        // widening this exact line is an offender, so it is the fixture that proves the
        // widening rather than one that would pass either way.
        `logger.info('Error fetching groups: ' + (error.message || 'Unknown error'));`,
      ],
      [
        `console.error('Failed to get game invite token:', err);`,
        `logger.info('Failed to get game invite token', errCtx(err));`,
      ],
      [
        `console.error('Failed to remove participant:', err);`,
        `logger.info('Failed to remove participant', errCtx(err));`,
      ],
    ];
    for (const [before, after] of channelChangers) {
      expect(run(before), `before: ${before}`).toEqual({ raw: 0, failed: 0 });
      expect(run(after), `after: ${after}`).toEqual({ raw: 0, failed: 0 });
    }
  });

  it('every declared surface is actually scanned (anti-vacuity: the file list resolves)', () => {
    // Without this, a rename turns all three assertions above into no-ops that
    // pass forever. This is the guard 88-21 and 88-24 both found necessary.
    for (const rel of SURFACES) {
      expect(fs.existsSync(path.join(SRC, rel)), `${rel} is missing`).toBe(true);
      // …and it is in the ONE hoisted tree walk, so the memoized reads and the
      // widened assertions below are looking at the same population this list names.
      expect(ALL_REL.includes(rel), `${rel} is not in sourceFiles(SRC)`).toBe(true);
    }
  });

  it('the scanner still SEES the idioms it forbids (anti-vacuity: patterns match)', () => {
    // Proves the three patterns above are live rather than silently non-matching
    // — the exact failure mode DEF-88-21-01 recorded, where a gate printed
    // CENSUS-ZERO against 14 real violations.
    const planted = [
      `      toast.error(err.message || 'Failed to widget.');`,
      `      alert('nope');`,
      `      setThingError(error.message);`,
      // 88.6-13: a JSX RENDER arm. Every planted negative above goes through a call
      // expression, so the whole set would still pass with the scan blind to the shape
      // `Header.js:55` and `app/page.js:103` actually ship — a bare interpolation into
      // markup, with no sink token anywhere on the line.
      `      <div>{error.message}</div>`,
    ];
    expect(USER_FACING_SINK.test(planted[0]) && RAW_MESSAGE_READ.test(planted[0])).toBe(true);
    expect(AD_HOC_FAILURE_COPY.test(planted[0])).toBe(true);
    expect(/(^|[^.\w$])alert\s*\(/.test(planted[1])).toBe(true);
    expect(USER_FACING_SINK.test(planted[2]) && RAW_MESSAGE_READ.test(planted[2])).toBe(true);

    // The JSX arm is asserted through the ASSERTION PATH, not the regex conjunction: it
    // has no sink token, so a conjunction test would be the wrong question entirely.
    expect(
      offenders(isRawMessageOffender, [{ rel: 'fixture.js', lines: [planted[3]] }]).length
    ).toBe(1);

    // …and the developer-log carve-out must be narrow: a console line is exempt,
    // but a line that ALSO shows the string to a person is not.
    const consoleOnly = `      console.error('Failed to widget:', err);`;
    const consoleAndToast = `      console.error('x', err); toast.error('Failed to widget.');`;
    expect(DEVELOPER_LOG.test(consoleOnly) && !USER_FACING_SINK.test(consoleOnly)).toBe(true);
    expect(DEVELOPER_LOG.test(consoleAndToast) && !USER_FACING_SINK.test(consoleAndToast)).toBe(
      false
    );
  });

  it('comment stripping does not blind the scanner to real code', () => {
    // The complement of the false-positive fix: stripping comments must not also
    // strip code. If it did, every assertion above would go vacuously green.
    //
    // THREE DECISION-MARKER FALSE POSITIVES a raw grep would report and this suite does
    // not, named so nobody "fixes" them: `app/friends/page.js:268`,
    // `app/gameDetail/page.js:649` and `components/ui/useFetchErrorState.ts:128` are PROSE
    // inside markers that exist to record this very work. (`gameDetail/page.js:1005` is a
    // fourth.) This is exactly why SPEC P5 forbids gating the R1 property with a grep, and
    // why the two widened assertions above could go tree-wide at all — they read stripped
    // source, so a marker can say plainly what it forbids.
    const stripped = withoutComments(
      [
        `// toast.error(err.message || 'Failed to nothing.');`,
        `/* alert('also a comment') */`,
        `toast.error(err.message || 'Failed to something.');`,
      ].join('\n')
    ).split('\n');

    expect(AD_HOC_FAILURE_COPY.test(stripped[0])).toBe(false);
    expect(/(^|[^.\w$])alert\s*\(/.test(stripped[1])).toBe(false);
    expect(AD_HOC_FAILURE_COPY.test(stripped[2])).toBe(true);
  });

  it('the `/test-sentry` route stays deleted (D3, owner ruling 2026-09-09)', () => {
    // WHY HERE: this file's `SURFACES` roster is a census of `src/` route and component
    // files, so an absence pin about a route removed in this phase sits with the census.
    // `nativeDialogs.test.ts` was the alternative and is a worse fit — it scans for native
    // dialog CALLS, and a route's existence is not one.
    //
    // THE RULING: `https://www.nextgamenight.app/test-sentry` returned 200 with four
    // unauthenticated error-injection buttons, under `replaysOnErrorSampleRate: 1.0`, with
    // no auth guard and no nav reference, orphaned since the initial commit. The owner
    // ruled DELETE on 2026-09-09. The rejected alternative — a
    // `NODE_ENV === 'production' -> notFound()` gate — would have kept the surface in the
    // tree and 404'd on Preview as well.
    //
    // THIS PIN IS PATH-SPECIFIC. It asserts the absence of exactly `src/app/test-sentry/`
    // and does NOT generalise to a differently-named error-injection route. It is the
    // receipt for D3's delete, nothing more — do not read it as coverage that
    // error-injection routes are gated as a CLASS.
    //
    // THE CLASS-SHAPED ALTERNATIVE IS REJECTED, WITH ITS MEASURED COST, so it is not
    // re-proposed as a hardening cleanup. Measured 2026-09-15:
    // `grep -rln '@sentry/nextjs' src/app` -> 19 files, of which 16 are non-test, and 12
    // of those are LEGITIMATE `error.tsx` / `global-error.tsx` boundaries (the root pair
    // plus availability-form/[token], invite/group/[token], invite/accept,
    // invite/game/[token], rsvp/[token], friends, gameDetail, groupHomePage,
    // groupPlanning, userProfile). A rule shaped "imports Sentry AND contains
    // `throw new Error(`" would therefore need its own roster of legitimate boundaries —
    // a new default-deny surface this plan does not own and did not price.
    expect(fs.existsSync(path.join(SRC, 'app/test-sentry'))).toBe(false);
    // Non-vacuous by construction: the same call on a directory that DOES exist is true,
    // so this assertion cannot pass because `existsSync` went blind.
    expect(fs.existsSync(path.join(SRC, 'app/components'))).toBe(true);
  });

  it('no HTML-INJECTION SINK appears anywhere in the comment-stripped src/ tree (T-88.6-145)', () => {
    // The companion to the markup-payload render arm in
    // `src/components/ui/useFetchErrorState.test.tsx`. That arm proves React escapes a
    // `<b>` payload; this one proves nobody opts OUT of that escaping, anywhere, by any
    // spelling.
    //
    // THE SCAN IS OVER THE SINK **SET**, NOT ONE MEMBER OF IT. `dangerouslySetInnerHTML`
    // is React's spelling of ONE sink. The threat in T-88.6-145 is an error `message`
    // containing markup reaching a person, and that same message arrives through
    // `el.innerHTML =`, `el.outerHTML =`, `el.insertAdjacentHTML(...)` or
    // `document.write(...)` with a `dangerouslySetInnerHTML`-only tripwire byte-for-byte
    // GREEN — a clean bill while the defect it exists to catch ships.
    //
    // ASSIGNMENT-SHAPED for the two `*HTML` properties, so a READ (`expect(el.innerHTML)`)
    // is not flagged. That shape is what makes the widening free.
    //
    // SCOPE IS THE TREE, not the three error-path modules. Scoping it to
    // `FetchErrorBanner.tsx` / `Banner.tsx` / `useFetchErrorState.ts` would guard the
    // three files LEAST likely to grow one — two of them already carry a written
    // no-`dangerouslySetInnerHTML` contract in their own docblocks — while the ~25 files
    // whose error paths plans 15 and 17-39 rewrite went unwatched.
    //
    // `dangerouslySetInnerHTML` IS MATCHED AS A USE, NOT AS A MENTION — and that is a
    // MEASURED correction to the pattern 88.6-13-PLAN.md states, not a loosening.
    //
    // The plan specifies the BARE token for this one member while requiring the other two
    // properties be assignment-shaped "so a READ is not flagged". Run against the live
    // tree on 2026-09-15 the bare token is RED on THREE lines of `components/ui/Heading.tsx`
    // (`:129`, `:156`, `:158`) — and every one of them is plan 88.6-03's T-88.6-05
    // MITIGATION: a type-level `Omit<HTMLAttributes, 'dangerouslySetInnerHTML'>` and the
    // destructure that DROPS the prop before `{...rest}` reaches the element. That file
    // landed on this branch AFTER the plan's 2026-09-09/14 measurement, which is why the
    // plan records a day-one zero that is no longer true of the bare token.
    //
    // Exempting those three lines was the alternative and it was REJECTED: the roster's own
    // docblock makes an entry a security decision needing an owner ruling, and the entry
    // would be FALSE — Heading.tsx does not carry a surviving sink, it removes one. A
    // register that records a mitigation as a tolerated sink is worse than no register.
    //
    // So the plan's own stated principle is applied to all five members consistently: match
    // the USE. A JSX prop is always `dangerouslySetInnerHTML=`; an object-literal sink is
    // `dangerouslySetInnerHTML: {`. A string inside an `Omit`, a `?: unknown` declaration
    // and a `: _ident` destructuring rename are mentions and are not flagged — pinned by
    // the negative controls at the bottom of this test.
    //
    // MEASURED DAY-ONE ZERO, 2026-09-15, over `periodictabletop/src`, recorded HERE with
    // its date so a future reader can tell a green tripwire from a dead one:
    //   dangerouslySetInnerHTML  11 occurrences in non-test source. ZERO as a USE:
    //                            4 in prose comments (FriendInvitePanel.js:299,
    //                            Modal.tsx:20, Banner.tsx:15, FetchErrorBanner.tsx:18),
    //                            4 more in Heading.tsx's own mitigation + its comment.
    //   .innerHTML =             0      .outerHTML =        0
    //   insertAdjacentHTML(      0      document.write(     0
    // The only `innerHTML` occurrences in the tree at all are 7 READS, in
    // `app/components/EventScheduler.test.tsx` (6) and `components/ui/RouteFallback.test.tsx`
    // (1) — both already excluded by `sourceFiles`. So the widened set is green on day one
    // and changes no count.
    const HTML_INJECTION_SINK =
      /dangerouslySetInnerHTML\s*=|dangerouslySetInnerHTML\s*:\s*\{|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/;

    // SEEDED EMPTY, and it stays empty. ADDING AN ENTRY HERE IS A SECURITY DECISION AND
    // REQUIRES AN OWNER RULING — it is not an executor's call, and it is not the fix for a
    // red. A red here means a sink landed; remove the sink.
    const HTML_SINK_EXEMPT: ExemptionRoster = {};

    const hits = offenders((l) => HTML_INJECTION_SINK.test(l), TREE);
    const unowned = hits.filter((h) => !(h.file in HTML_SINK_EXEMPT));
    expect(
      fmt(unowned),
      'An HTML-injection sink reached src/. React escapes by default and this gate exists ' +
        'so nobody opts out. Most likely at fault: components/ui/FetchErrorBanner.tsx, ' +
        'components/ui/Banner.tsx, components/ui/useFetchErrorState.ts.'
    ).toBe('');

    // The seed is still empty AFTER the widening, measured — not asserted in prose.
    expect(Object.keys(HTML_SINK_EXEMPT)).toEqual([]);
    expect(assertRosterShape(HTML_SINK_EXEMPT)).toEqual([]);
    expect(assertExactCounts(HTML_SINK_EXEMPT, countByFile(hits))).toEqual([]);

    // The detector is not dead: every member of the set matches its own shape, and a READ
    // of the two `*HTML` properties does NOT.
    for (const planted of [
      `        <div dangerouslySetInnerHTML={{ __html: err.message }} />`,
      `        el.innerHTML = err.message;`,
      `        el.outerHTML = err.message;`,
      `        el.insertAdjacentHTML('beforeend', err.message);`,
      `        document.write(err.message);`,
    ]) {
      expect(HTML_INJECTION_SINK.test(planted), `blind to: ${planted.trim()}`).toBe(true);
    }
    // Two more sink SHAPES the bare-token form would have caught and the assignment form
    // must also catch — a prop whose value is a variable rather than an inline object, and
    // the `createElement` props-object spelling.
    expect(
      HTML_INJECTION_SINK.test(`        <div dangerouslySetInnerHTML={htmlFromServer} />`)
    ).toBe(true);
    expect(
      HTML_INJECTION_SINK.test(
        `  React.createElement('div', { dangerouslySetInnerHTML: { __html: x } })`
      )
    ).toBe(true);

    // NEGATIVE CONTROLS — a READ of the two `*HTML` properties, and the three MENTION
    // shapes that make up plan 88.6-03's T-88.6-05 mitigation in `components/ui/Heading.tsx`
    // (`:129`, `:156`, `:158`, transcribed). Flagging these would force a FALSE roster entry
    // recording a mitigation as a tolerated sink, which is the outcome this shape prevents.
    expect(HTML_INJECTION_SINK.test(`    expect(el.innerHTML).toContain('x');`)).toBe(false);
    expect(HTML_INJECTION_SINK.test(`    const html = node.outerHTML;`)).toBe(false);
    for (const mention of [
      `  extends Omit<React.HTMLAttributes<HTMLHeadingElement>, 'dangerouslySetInnerHTML'>,`,
      `    dangerouslySetInnerHTML: _droppedHtmlSink,`,
      `  } = allProps as HeadingProps & { dangerouslySetInnerHTML?: unknown };`,
    ]) {
      expect(HTML_INJECTION_SINK.test(mention), `mention flagged as a sink: ${mention.trim()}`).toBe(
        false
      );
    }
  });

  it('the surfaces are on the shared primitives, not a second error look', () => {
    // The positive half. Without it, all of the above could be satisfied by
    // deleting the error handling entirely.
    const adopters = [
      'app/groupPlanning/page.js',
      'app/groupHomePage/page.js',
      'app/gameDetail/page.js',
      'app/userProfile/page.js',
      'app/friends/page.js',
      'app/components/GroupLibrary.js',
      'app/components/OpenPollsList.js',
      'app/components/GroupGamesList.js',
    ];
    for (const rel of adopters) {
      const { raw } = readStripped(rel);
      expect(
        /useFetchErrorState|FetchErrorBanner/.test(raw),
        `${rel} renders no shared fetch-error treatment`
      ).toBe(true);
    }
  });
});
