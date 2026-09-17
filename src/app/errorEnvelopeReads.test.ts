/**
 * @vitest-environment node
 * Pure source-text scan: this suite renders nothing, needs no DOM, and the node
 * environment is materially faster than spinning up jsdom for a filesystem walk.
 */

// DECISION Phase 88.6-14 (R9 / AC-9, owner rulings #121 + #123, 2026-09-14): this file
// carries a per-file `@vitest-environment node` pragma, chosen OVER two alternatives.
//
//   REJECTED (a) leaving the suite on the global jsdom environment. The DOM is entirely
//   unused here — the suite reads files off disk and matches text. Paying for a jsdom
//   window on every run buys nothing.
//
//   REJECTED (b) changing the global `environment` in `vitest.config.mts` (currently
//   `environment: 'jsdom'` at :56). That would move EVERY suite, including the many that
//   genuinely render (`useFetchErrorState.test.tsx`, `controlSizeFloor.test.tsx`, …), which
//   is a repo-wide behaviour change dressed up as a speed tweak.
//
// This is the FIRST `@vitest-environment` pragma in the repo — measured 2026-09-14 and
// re-measured 2026-09-15: zero pragmas anywhere under `src/`. The three shipped scan
// suites (`nativeDialogs.test.ts`, `fetchErrorTreatment.test.ts`,
// `typeScaleTouchedSurfaces.test.ts`) were deliberately NOT converted in this plan — a
// one-file pragma is a local decision, converting three shipped negative-checked gates is
// a sweep, and plan 14 is not that sweep. Adding the pragma to
// `fetchErrorTreatment.test.ts` is explicitly out of scope; that suite stays jsdom.
// Changing either of those is a decision, not a cleanup.

// ---------------------------------------------------------------------------------------
// WHAT THIS GATE IS FOR (R9 / SPEC-88.6 AC-9, ROADMAP :1338, REQUIREMENTS BAPI-03 / X-008)
// ---------------------------------------------------------------------------------------
// Phase 93 DELETES the `body.error` alias and the top-level `errors[]` mirror from every
// backend response. ROADMAP :1338 makes this phase's completion the hard precondition for
// that deletion. The precondition is the claim "the frontend reads `body.code`,
// `body.message` and `body.details` and nothing else" — and a claim is not a fact until a
// machine re-checks it on every run. This project has deleted an alias against an unswept
// consumer three times on the record; this suite is the sweep.
//
// CROSS-REPO NOTE — R9 IS NOT A FRONTEND-ONLY REQUIREMENT. The FE is the CONSUMER of an
// envelope the BACKEND authors, and several rostered reads consume bodies the backend
// emits today with NO `code` and NO `message` at all:
//
//   - the two rsvp 410 discriminants (`{ error: 'event_passed' | 'event_cancelled' }`);
//   - the availability-submit rejection (`{ error: 'This link is no longer valid.' }`).
//
// Phase 93 cannot remove the aliases until the backend half of those lands. That residual
// belongs in `.planning/deferred/phase-93.md`; under the D62 branch-B owner ruling
// (2026-09-09) plan 42 writes that amendment. Recording it here and nowhere durable is how
// a cross-repo dependency evaporates.
//
// WHY A SOURCE SCAN AND NOT A GREP (P5). A grep over `body.error` matches this file's own
// DECISION prose, the roster `why` strings below, and every phase marker that quotes the
// token it forbids. The shared lexer in `src/test-utils/sourceScan.ts` blanks comments
// while preserving byte offsets, so a reported line number is the real one.
//
// RE-SEEDING OWNERSHIP. Plans 24 and 42 own re-seeding this roster after seed. Any sweep
// plan that edits a rostered file MUST NOT add or remove a `.error` read without updating
// the roster in the SAME commit — the counts below are exact in both directions, so a
// silent addition and a silent fix both red. The D62 branch-B owner ruling (2026-09-09) is
// the RECORDED OUTCOME for the rsvp and availability-submit sites: those reads STAY,
// FE-side, and Phase 93 owns adding the backend `code`. A later plan may not "convert" a
// rostered read on its own authority. Those re-seeds delete or decrement roster ENTRIES
// only — the `@vitest-environment` pragma and the DECISION marker at this file's head are
// byte-invariant for every plan that later edits this suite, so the two edits cannot
// collide.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type ExemptionRoster,
} from '../test-utils/exemption';
import { lineAt, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const rel = (file: string): string => path.relative(SRC, file);

// ---------------------------------------------------------------------------------------
// THE DETECTOR — DEFAULT-DENY ON READ SHAPE, NOT ON A LIST OF RECEIVER NAMES
// ---------------------------------------------------------------------------------------
// The previous census for this requirement used a CLOSED list of receiver names
// (`body?.error`, `err.error`, `result.error`, `errorData.error`, `data.error`). It missed
// TWO WHOLE FILES — `AvailabilityForm.js` (`response.error`) and
// `availability-form/[token]/page.js` (`validation.error`, `existing.error`) — because
// nobody thought to add those two names to it. A closed list cannot be complete against
// code that has not been written yet, so inversion is the only default that stays correct:
// flag EVERY `<identifier>.error` / `<identifier>?.error` property read, whatever the
// receiver is called, then subtract named STRUCTURAL exclusions.

type Prop = 'error' | 'errors';

interface Hit {
  file: string;
  line: number;
  receiver: string;
  prop: Prop;
}

// `errors` first so the longer property wins the alternation; `\b` already prevents
// `error` from matching the `error` prefix of `errors`, and the ordering makes that
// independent of the boundary assertion rather than dependent on it.
const PROPERTY_READ = /([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\?\.|\.)\s*(errors|error)\b/g;

// EXCLUSION (a) — CALL FORMS, `X.error(`.
// ONE generic rule, deliberately not one rule per logger name. `console.error(`,
// `logger.error(`, `toast.error(` and anything shaped like them are all calls, and a rule
// per name is the same closed-list mistake at a smaller scale. A call is not a read of an
// error envelope; it is a sink.
const CALL_FORM = /^\s*\(/;

// EXCLUSION (b) — CHAINED FORMS, `X.error.<prop>`, and ONLY for `.error`.
// A Zod `safeParse` result's `.error` is a ZodError OBJECT that then gets dereferenced —
// `EmailAddressSection.tsx:321` (`parsed.error.issues`) and `lib/schemas/prompts.ts:206`
// (`result.error.issues`). An envelope `error` is a STRING and is never dereferenced, so
// the chain is a structural tell rather than a name.
//
// This is a SCANNER EXCLUSION with its reason written here, NEVER a roster entry — an
// exclusion says "this is not the thing being scanned for", an exemption says "this is a
// debt that survived" (see `test-utils/exemption.ts`, "EXCLUSION IS NOT EXEMPTION").
//
// It is deliberately NOT implemented as an exemption keyed on the identifier `result`:
// that would also un-flag `SuggestionCard.js:53` and BOTH `rsvp/[token]/page.js` sites,
// silently gutting the gate. And it is deliberately NOT applied to `.errors`, where
// `body.errors.length` is a real top-level read that must stay visible.
const CHAIN_FORM = /^\s*(?:\?\.|\.)\s*[A-Za-z_$]/;

// EXCLUSION for the `errors` half — `details.errors` is the SANCTIONED Phase 85/86 envelope
// shape and MUST be permitted. Getting this one distinction wrong breaks the gate in either
// direction: too broad and it demands deleting the CORRECT read at `lib/api.ts:316`'s first
// arm; too narrow and it misses that same line's second arm (`?? body?.errors`), which is
// exactly the legacy mirror Phase 93 removes.
const SANCTIONED_ERRORS_RECEIVER = 'details';

// EXCLUSION (c) — PROVEN-LOCAL RECEIVERS, as an ENUMERATED list.
// These receivers are COMPONENT STATE, not a response body: each entry cites the `useState`
// declaration that proves it. Each is staleness-checked below — if the cited declaration no
// longer sits at the cited line, the entry REDS rather than silently keeping a read hidden.
// A sweep plan that moves one of these declarations updates the line here in the same
// commit (plans 23 and 25 rewrite both availability files in wave 7; that is the deal the
// re-seed note above states).
interface LocalReceiver {
  file: string;
  receiver: string;
  declaredAt: number;
  declaration: string;
  why: string;
}

const PROVEN_LOCAL: readonly LocalReceiver[] = [
  {
    file: 'app/components/AvailabilityForm.js',
    receiver: 'prefillStatus',
    // RE-DERIVED by plan 88.6-25 (2026-09-16): 60 -> 87, and TWICE within that one plan — the
    // declaration never moved on its own, it was pushed down first by three added imports and then
    // again by the DECISION marker plan 25 wrote at the submit latch. Assertion 4 red on BOTH
    // occasions and is the only reason either was noticed, which is exactly what it is for. Do not
    // 'stabilise' this by anchoring on text alone: the line number is what makes a MOVE visible.
    // RE-DERIVED AGAIN by plan 88.6-42 (2026-09-17): 87 -> 96. Third move, third catch, and
    // the declaration still has not moved on its own — this time plan 42 amended the
    // `DECISION Phase 88.6-25` marker directly above it (recording that the aria-disabled
    // conversion plan 25 routed IS now taken) and that comment pushed it down nine lines. The
    // FULL `npm test` run is what surfaced it: the task-level verify lists did not name this
    // suite, and every targeted run had happened before the AvailabilityForm edit. Do not
    // "stabilise" this by anchoring on text alone — the line number is what makes a MOVE visible.
    declaredAt: 96,
    declaration: 'const [prefillStatus, setPrefillStatus] = useState(',
    why:
      'Local pre-fill banner state shaped { source, count, failed? } — set only by this ' +
      "component's own perform* callbacks, never assigned from a response body. The shape's " +
      "third key was `error?`, holding `err.message`, until plan 88.6-25 replaced it with the " +
      "boolean `failed?` discriminant; the receiver is local either way, which is what this " +
      'exclusion turns on.',
  },
  {
    file: 'app/userProfile/page.js',
    receiver: 'phoneValidation',
    declaredAt: 228,
    declaration: 'const [phoneValidation, setPhoneValidation] = useState(',
    why:
      'Local client-side phone-format validation state { valid, error } produced by ' +
      'validatePhoneInput, never assigned from a response body.',
  },
];

const isProvenLocal = (file: string, receiver: string): boolean =>
  PROVEN_LOCAL.some((e) => e.file === file && e.receiver === receiver);

/**
 * Every envelope-shaped `.error` / top-level `.errors` read in one file's source text.
 *
 * COUNTING UNIT — one occurrence per distinct read EXPRESSION, which is implemented as a
 * dedupe on `file:line:receiver.prop`. `lib/api.ts:300`'s
 * `body?.errors && Array.isArray(body.errors)` is ONE read of one field on one line, not
 * two. Two reads of the SAME field on the same line are the same logical read; two reads on
 * DIFFERENT lines (`AvailabilityForm.js:130` and `:131`) or off DIFFERENT receivers on the
 * same line (`lib/api.ts:316`'s `details.errors` and `body.errors`) stay distinct.
 */
export function envelopeReads(file: string, src: string): Hit[] {
  const code = withoutComments(src);
  const seen = new Set<string>();
  const hits: Hit[] = [];

  PROPERTY_READ.lastIndex = 0;
  for (const m of code.matchAll(PROPERTY_READ)) {
    const receiver = m[1];
    const prop = m[2] as Prop;
    const after = code.slice(m.index + m[0].length);

    if (CALL_FORM.test(after)) continue; // (a)
    if (prop === 'error' && CHAIN_FORM.test(after)) continue; // (b)
    if (prop === 'error' && isProvenLocal(file, receiver)) continue; // (c)
    if (prop === 'errors' && receiver === SANCTIONED_ERRORS_RECEIVER) continue;

    const line = lineAt(code, m.index);
    const key = `${line}:${receiver}.${prop}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ file, line, receiver, prop });
  }

  return hits;
}

// ---------------------------------------------------------------------------------------
// THE ROSTER — every surviving read, its owner, and WHY it is still here
// ---------------------------------------------------------------------------------------
// Keyed by repo-relative path (relative to `src/`, the `app/components/Foo.js` form
// `nativeDialogs.test.ts` already uses). The `sites` number is EXACT in both directions via
// plan 04's `assertExactCounts`: a new unrostered read fails by file and line, and a FIXED
// read fails too rather than fossilising as a stale standing permission.
//
// LINE NUMBERS INSIDE `why` ARE ADVISORY. Plans 23 and 25 rewrite both availability files in
// wave 7, so the load-bearing keys are the PATH and the COUNT, never the line.
//
// Measured 2026-09-15 by this scanner: 13 read occurrences across 6 files.
const ENVELOPE_READ_ROSTER: ExemptionRoster = {
  // RE-SEEDED 5 -> 3 by plan 88.6-42 task 1 (wave 8, 2026-09-17). THREE survivors, and the
  // FIRST of them is the phase's ONE BY-NAME arm-A exemption:
  //
  //  (1) `extractUpstreamMessage` — the AC-4 arm-A construction site, RULED by the owner on
  //      2026-09-09 (a). The legacy key is read ONCE, into a NON-RENDERED `ApiError`
  //      field (`upstreamMessage`), which nothing reads but `queryCacheOnError`'s Sentry
  //      `extra` forward. `ApiError.message` is the display contract and does NOT read it.
  //      Assertion 6 below pins that site BY NAME and pins that the field renders nowhere,
  //      so AC-9's "literal zero `body.error` reads" is answered by ONE named exemption and
  //      a NEW `.error` read anywhere else still fails assertion 1. Arm B (a clean delete)
  //      was REJECTED: the backend's own error string would have been GONE from the Sentry
  //      event entirely for the ~455 unconverted raw-`{ error }` routes until Phase 93.
  //  (2)(3) `prefillFromGcal` and `prefillFromSaved` — RAW `fetch` calls that BYPASS
  //      apiFetch, reading availabilityPrefill bodies that are `{ error: string }` with no
  //      `code` and no `message`. Re-opened at source 2026-09-17: routes/availabilityPrefill.js
  //      emits `{ error }` at :187, :190, :194, :197, :203-206 (+ `action: 'request_new'`),
  //      :213, :216 and :241 — NOT ONE carries a `code` or a `message`. Under D62 branch B
  //      these reads STAY and Phase 93 owns the backend `code`. Plan 42 hardened their
  //      TRANSPORT (guarded success parse + mapped timeout) without touching the reads.
  //
  // GONE, and not coming back: the three apiFetch-path alias arms the SPEC called :300, :309
  // and :316. `extractErrorMessage` is now `body?.message ?? "HTTP error! status: N"`,
  // `mapErrorToCode`'s validation hint reads `body.details.errors`, and `extractFieldErrors`
  // has one arm. Both self-constructed non-JSON bodies were reshaped onto `message` in the
  // same commit.
  'lib/api.ts': {
    sites: 3,
    why:
      'The envelope seam itself, down to THREE. (1) extractUpstreamMessage is AC-4 arm A: ' +
      "the ONE by-name exemption, populating a NON-RENDERED ApiError field forwarded to " +
      "Sentry extra by queryClient.ts:162 and read by nothing else (owner ruling " +
      "2026-09-09 a; assertion 6 pins the site and the no-render property). (2) and (3) are " +
      'the raw-fetch prefill helpers, whose availabilityPrefill bodies carry no code and no ' +
      'message at any of their eight emit sites (re-opened at source 2026-09-17) — RETAINED ' +
      'under D62 branch B with Phase 93 owning the backend code. The three apiFetch alias ' +
      'arms the SPEC cited as :300/:309/:316 are DONE: dropped by plan 88.6-42.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling:
        'AC-4 arm (a) — the backend error string is retained on a NON-RENDERED ApiError ' +
        'field and forwarded to Sentry extra, behind exactly ONE by-name exemption here; ' +
        'and D62 branch B — FE-only, Phase 93 owns adding code to the availabilityPrefill ' +
        'error branches as the precondition for removing the error alias',
    },
  },
  // DELETED by plan 88.6-42 task 3 (wave 8, 2026-09-17). RESEARCH assumption A3 is ANSWERED by opening the
  // route, and the answer is a THIRD outcome the plan text did not offer: `:53` was a DEAD
  // read. `suggestionAPI.convert` goes through `apiFetch`, which THROWS on any non-ok
  // response, and the route`s 201 body is `{ success, event_id, message, event }`
  // (Sonnet/routes/availabilitySuggestion.js:110-115) — no body that could reach that line
  // ever carried an `error` field, so the read could never be truthy. The READ is gone; the
  // ELSE ARM it lived in STAYS, because it is the live guard for an unparseable 2xx that
  // `apiFetch` returns as raw text, and a `DECISION Phase 88.6-42 (A3)` marker now sits there
  // saying so. Entry DELETED, not zeroed. FOR THE RECORD: this makes `88.6-RESEARCH.md:1291`
  // R9 inventory wrong by one — it counted this as a convertible alias read.
  'app/rsvp/[token]/page.js': {
    sites: 2,
    why:
      'A DOMAIN DISCRIMINANT, not a legacy alias. The backend branches VERBATIM, re-read at ' +
      'source 2026-09-16 — Sonnet/routes/rsvp.js:293-296 is ' +
      'res.status(410).json({ error: [event_cancelled], group_id: event.Group?.id || ' +
      'event.group_id }) and :302-306 is res.status(410).json({ error: [event_passed], ' +
      'event_name: event.Game?.name || [Game Session], group_id: event.Group?.id || ' +
      'event.group_id }), with the string literals bracketed here only to keep this roster ' +
      'quote-safe. ' +
      'Neither carries a `code` and neither carries a `message`. THE REGRESSION a mechanical ' +
      'read-`body.code` edit would cause: both `else if` branches become unreachable, so an ' +
      'already-passed and a cancelled event both fall through to the generic ' +
      'PAGE_STATES.ERROR ("Something went wrong … This link may be invalid or expired") ' +
      'instead of the named "This event has already happened" screen WITH its Go-to-Group ' +
      'link — silent, user-visible, on the magic-link RSVP flow, one of the two primary entry ' +
      'points into this app. REMOVAL CONDITION for this entry: Phase 93 lands the BE `code` ' +
      'on those two branches (BACKEND FIRST — `formatEnvelope` keeps the `error` alias until ' +
      'then, so a converted backend still serves an un-deployed frontend and the reverse is ' +
      'not true). Until that lands this entry STAYS; nothing in 88.6 converts it, and plan ' +
      '88.6-24 added a `DECISION Phase 88.6-24` marker at the branch saying so.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling:
        'D62 branch B — FE-only; Phase 93 owns adding code to Sonnet/routes/rsvp.js:292-306 ' +
        'and Sonnet/routes/availabilityResponse.js:77-80,:119-122 as the precondition for ' +
        'removing the error alias',
    },
  },
  // DELETED by plan 88.6-42 task 2 (wave 8, 2026-09-17). This file carried `sites: 1` for
  // `:53`'s `errorData.error` read inside the body returned to the browser. Under T-88.6-117
  // that body now returns a FIXED string — the consumer is a NAVIGATION, so the user RENDERS
  // it as a page — and the upstream envelope is no longer read as a property anywhere in the
  // file. NOTE, because it differs from the plan's expected survivor set and the difference is
  // an improvement, not a miss: the diagnostic is NOT lost. The unchanged `console.error
  // ('Backend error:', errorData)` line one above it still puts the WHOLE upstream body into
  // the Vercel function log, which on this server runtime is the only working channel there
  // is (Sentry is never initialised here). So the route keeps its diagnosis without a `.error`
  // read, and this roster entry is DELETED rather than re-worded. Assertion 7 below is what
  // holds the redaction and the four-body census in place from here on.
  'app/components/AvailabilityForm.js': {
    sites: 2,
    why:
      'THE ONE LIVE PHASE-93 BLOCKER this seed adds. :130 guards on `response.error` and ' +
      ':131 throws it. `availabilityFormAPI.submitResponse` (lib/api.ts:1086-1091) does ' +
      '`.then(res => res.json())` with NO `res.ok` check, so a REJECTED submit is ' +
      'distinguished from a successful one SOLELY by this read. The backend returns HTTP ' +
      '400 `{ error: "This link is no longer valid.", action: "request_new" }` ' +
      '(Sonnet/routes/availabilityResponse.js:77-80, re-derived 2026-09-15; the plan cites ' +
      ':75-80). Drop the alias and that read is `undefined`, the guard falls through, and ' +
      '`onSuccess?.()` at :134 fires on a FAILED magic-link availability submit — the user ' +
      'is told their availability saved when it did not, on the phone-primary flow. RULED ' +
      'RESIDUAL: under D62 branch B this read STAYS and the expired-link case renders the ' +
      "register's generic copy until Phase 93 lands the `code`. Plan 42 is the FE owner of " +
      'the conversion when that happens. ' +
      // AMENDED IN PLACE by plan 88.6-24 task 1 (2026-09-16). NOT a second row: this file's
      // PATH and COUNT are the load-bearing keys (see the roster docblock above), so a
      // duplicate would either collide on the key or double the declared count. `sites` stays
      // at plan 14's measured 2; what follows is provenance and consequence only.
      'SPLIT BY MECHANISM — the POST handler fails in TWO ways and they break at DIFFERENT ' +
      'times, so recording only the two `action: request_new` bodies understates it. ' +
      '(a) ALIAS-DEPENDENT: three `sendError` envelopes — ' +
      'Sonnet/routes/availabilityResponse.js:99 and :103 (`prompt_closed`) and :109 ' +
      '(`prompt_deadline_expired`) — carry `error` ONLY via the legacy alias `formatEnvelope` ' +
      'writes (Sonnet/utils/errors.js:161, `body.error = message`), so they break the INSTANT ' +
      'Phase 93 removes it. (b) NOT alias-dependent: seven raw `res.status(400).json({ error ' +
      '… })` sites (:38, :44, :51, :60, :65, :77, :119) plus a raw 500 (:197) never pass ' +
      'through `formatEnvelope` and SURVIVE alias removal — until something converts one onto ' +
      '`sendError`, which MOVES it into set (a). All counts re-measured at source 2026-09-16. ' +
      'THE FE HALF OF THE PRECONDITION, AND ITS ORDER (a CONSEQUENCE constraint, not a ' +
      'suggestion): `submitResponse` performs no `res.ok` check and AvailabilityForm.js:130 ' +
      'branches on the mere PRESENCE of `body.error`, so removing the alias — or converting ' +
      'any raw 400 onto `sendError` — flips that guard false and renders "Availability ' +
      'Submitted!" (availability-form/[token]/page.js:207) for a submit that recorded ' +
      'nothing. The submit path must first adopt the `res.ok` + envelope contract ' +
      '`publicFetch` already implements (api.ts:355-367) and branch on `!res.ok` / `code`. ' +
      'That FE change lands BEFORE or WITH the alias removal, NEVER after. The code to adopt ' +
      'for the two token-rejection 400s is the shipped `token_invalid` registry entry, already ' +
      'emitted for exactly this failure class at Sonnet/routes/magicAuth.js:115. NO TEST is ' +
      'added in 88.6 for this path: plan 25 pins AvailabilityForm.js:130-132 byte-unchanged, ' +
      'and a test pinning the presence-of-`error` behaviour would have to be deleted by Phase ' +
      '93 anyway. ' +
      // APPENDED by plan 88.6-25 task 2 (2026-09-16), per this file's append-don't-rewrite
      // convention. Line cites in this `why` are ADVISORY (the roster is count-keyed and the
      // count is unchanged at 2), but plan 25 moved them and leaving them wrong is the drift
      // this project's Evidence Rule exists to stop.
      'LINE CITES RE-DERIVED 2026-09-16 at the END of plan 88.6-25, after its last commit to this ' +
      'file: the guard and the throw are now AvailabilityForm.js:159 and :160 (was :130/:131) and ' +
      'the `onSuccess?.()` call is :163 (was :134). Both reads are BYTE-UNCHANGED — plan 25 ' +
      'pinned them so — and the movement is entirely imports and comment blocks that plan added ' +
      'above them.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling:
        'D62 branch B — FE-only; Phase 93 owns adding code to Sonnet/routes/rsvp.js:292-306 ' +
        'and Sonnet/routes/availabilityResponse.js:77-80,:119-122 as the precondition for ' +
        'removing the error alias',
    },
  },
  // DELETED by plan 88.6-42 task 2 (wave 8, 2026-09-17), exactly as this entry's own `why`
  // said it would be: both reads were CLEANUP, not conversions, and branch-independent.
  // `validation.error` was INERT (magicAuth.js assigns `valid: true` only on the success path,
  // so the sibling `!validation.valid` arm already caught every failure) and `existing.error`
  // was DEAD (`getExistingResponse` returns `null` on a non-2xx, so the truthy guard could
  // never be entered with an error body). Both deleted with the entry, in one commit.
};

// ---------------------------------------------------------------------------------------
// AC-11 — THE TREE IS ENUMERATED, READ AND COMMENT-STRIPPED EXACTLY ONCE
// ---------------------------------------------------------------------------------------
// Owner ruling 2026-09-09. This is the phase's FOURTH new full-tree scan suite and the only
// one with no inherited idiom, so the rule is stated here rather than copied. The shipped
// references are `controlSizeFloor.test.tsx:173` (`const controls = textEntryControls();`
// at describe scope, the walk itself inside `textEntryControls()`), `nativeDialogs.test.ts`
// (`const files = sourceFiles(SRC);` plus its `byFile` map at describe scope) and
// `typeScaleTouchedSurfaces.test.ts:458` (`const ALL = FILES.flatMap(...)` at module scope
// — plan 11 renamed that file's `SURFACES` to `NAMED_SURFACES`, so the plan's cite to a
// `SURFACES.flatMap(headings)` at :142 is stale; the idiom is intact, the identifier and
// the line moved).
//
// Adding a cache to `src/test-utils/sourceScan.ts` to get the same effect is FORBIDDEN by
// AC-12 (`RULINGS.md:16`, "no shared-module cache this phase"), so the module-scope hoist
// below is the only sanctioned mechanism. Every assertion in this file consumes FILES /
// BY_FILE / MEASURED — none of them re-walks.
const FILES = sourceFiles(SRC);
const BY_FILE = new Map<string, Hit[]>(
  FILES.map((f) => {
    const key = rel(f);
    return [key, envelopeReads(key, fs.readFileSync(f, 'utf8'))];
  }),
);
const MEASURED: Record<string, number> = Object.fromEntries(
  [...BY_FILE].filter(([, hits]) => hits.length > 0).map(([file, hits]) => [file, hits.length]),
);

describe('R9 / AC-9 — the FE reads the Phase 85 envelope and nothing else', () => {
  it('0. the sweep walks a representative tree and the detector is not dead', () => {
    // The enumeration floor. A scan that walks nothing is the quiet way this gate goes
    // vacuous — every `expect([]).toEqual([])` below passes trivially against zero files.
    expect(FILES.length).toBeGreaterThanOrEqual(150);

    // …and it still finds the KNOWN survivors. Without this, "zero offenders" and "the
    // matcher went blind" look identical, which is the one thing this gate must tell apart.
    // Deliberately a floor, not an exact count: exactness is the roster test's job below,
    // and duplicating it here would make one planted defect fail two assertions.
    expect(BY_FILE.get('lib/api.ts')?.length).toBeGreaterThan(0);
    expect(BY_FILE.get('app/components/AvailabilityForm.js')?.length).toBeGreaterThan(0);
  });

  it('1. every `.error` / top-level `errors[]` read is rostered — EXACT counts, both directions', () => {
    // `assertExactCounts` (plan 04) returns NAMED violations with three distinct messages,
    // because the fix for each is different: measured ABOVE the entry is a new offender in
    // an exempt file; measured BELOW is a fossil permission covering sites that no longer
    // exist; measured non-zero with NO entry is an unowned offender. A lower-bound floor
    // would catch only the first.
    expect(assertExactCounts(ENVELOPE_READ_ROSTER, MEASURED)).toEqual([]);
  });

  it('2. the roster satisfies the shared D-19 provenance schema', () => {
    // Every entry carries an exact positive count, a real reason, and provenance a machine
    // can tell apart from a sentence — a cited SPEC id, a greppable DECISION marker, or a
    // DATED owner ruling. An undated disposition cannot be re-tested against a later
    // milestone, which is the mechanism CLAUDE.md's "nothing exits scope into thin air"
    // rule depends on.
    expect(assertRosterShape(ENVELOPE_READ_ROSTER)).toEqual([]);
  });

  it('3. the roster covers exactly the measured files, with the measured per-file counts', () => {
    // Stated positively as well as by difference, so the census this plan asserts is
    // readable straight off a failure rather than reconstructed from a violations list.
    expect(MEASURED).toEqual({
      'lib/api.ts': 3,
      'app/rsvp/[token]/page.js': 2,
      'app/components/AvailabilityForm.js': 2,
    });
    const total = Object.values(MEASURED).reduce((a, b) => a + b, 0);
    expect(total).toBe(7);
    expect(Object.keys(ENVELOPE_READ_ROSTER).sort()).toEqual(Object.keys(MEASURED).sort());
  });

  it('4. every proven-local exclusion still cites a live `useState` declaration', () => {
    // Exclusion (c) is the one that hides real reads from the gate, so it is the one that
    // must red when it goes stale. If a cited declaration moves or disappears, the receiver
    // may no longer be component state — and silently keeping its reads hidden is exactly
    // the failure mode the closed receiver list produced.
    const stale: string[] = [];
    for (const entry of PROVEN_LOCAL) {
      const full = path.join(SRC, entry.file);
      if (!fs.existsSync(full)) {
        stale.push(`${entry.file} — cited for local receiver \`${entry.receiver}\` but MISSING`);
        continue;
      }
      const line = fs.readFileSync(full, 'utf8').split('\n')[entry.declaredAt - 1] ?? '';
      if (!line.includes(entry.declaration)) {
        stale.push(
          `${entry.file}:${entry.declaredAt} no longer declares \`${entry.receiver}\` ` +
            `(expected to contain "${entry.declaration}"); re-derive the line or drop the exclusion`,
        );
      }
    }
    expect(stale).toEqual([]);
  });

  it('5. the two D62 branch-B survivors are rostered, ruled and dated — one entry each', () => {
    // Added by plan 88.6-24 task 3 (2026-09-16). Assertions 1-3 above pin the COUNTS; this one
    // pins the RULING, which is the thing a later phase can lose without any count moving.
    //
    // Under the owner's D62 branch-B ruling (2026-09-09) these two reads deliberately SURVIVE
    // Phase 88.6 and Phase 93 owns the backend `code` that unblocks them. Two ways that record
    // could rot with every other assertion still green: the entry's owner block could be
    // downgraded to a SPEC citation (losing the date, which is what makes a disposition
    // re-testable against a later milestone), or a second row could be added for the
    // availabilityResponse submit path — plan 14's note makes the PATH and the COUNT the
    // load-bearing keys, so a duplicate row either collides or doubles the declared count.
    for (const file of ['app/rsvp/[token]/page.js', 'app/components/AvailabilityForm.js']) {
      const entry = ENVELOPE_READ_ROSTER[file];
      expect(entry, `${file} must KEEP its roster entry — the reads survive branch B`).toBeDefined();
      expect(entry.owner.kind, `${file}'s disposition is an OWNER RULING, not a SPEC citation`).toBe(
        'owner',
      );
      expect(entry.owner).toMatchObject({ date: '2026-09-09' });
      expect(
        'ruling' in entry.owner ? entry.owner.ruling : '',
        `${file}'s ruling must name D62 branch B and Phase 93's removal condition`,
      ).toMatch(/D62 branch B/);
    }

    // ONE entry for the submit path, never two.
    expect(
      Object.keys(ENVELOPE_READ_ROSTER).filter((k) => k.includes('AvailabilityForm')),
    ).toEqual(['app/components/AvailabilityForm.js']);

    // Both rulings name Phase 93's BE cutover as the removal condition, so the entries cannot
    // be read as open FE work.
    for (const file of ['app/rsvp/[token]/page.js', 'app/components/AvailabilityForm.js']) {
      const owner = ENVELOPE_READ_ROSTER[file].owner;
      expect('ruling' in owner ? owner.ruling : '').toMatch(/Phase 93/);
    }
  });

  it('6. AC-4 arm A — ONE by-name construction site, and the field it fills renders nowhere', () => {
    // Added by plan 88.6-42 task 1 (2026-09-17). Assertions 1-3 pin the COUNT; this one pins
    // WHICH read the count permits and what the value it produces is allowed to do. Without
    // it, "lib/api.ts: 3" would permit a THIRD apiFetch-path alias read to be reintroduced
    // under the same number, which is precisely the exemption-as-cover failure this suite
    // exists to prevent.
    const apiSrc = withoutComments(fs.readFileSync(path.join(SRC, 'lib/api.ts'), 'utf8'));

    // (a) THE NAMED SITE. The one sanctioned legacy read on the apiFetch path lives in
    // `extractUpstreamMessage` and is spelled exactly this way — a STRING or undefined,
    // never `errorData`, never the parsed body (R8 §10).
    expect(apiSrc).toMatch(
      /function extractUpstreamMessage\(body: any\): string \| undefined \{\s*return typeof body\?\.error === 'string' \? body\.error : undefined;\s*\}/,
    );

    // (b) …and the three rostered reads in this file are that one plus the two raw-fetch
    // prefill helpers, and nothing else. Stated by RECEIVER so a new `body.error` anywhere
    // in the module reds here as well as on the count.
    const apiHits = BY_FILE.get('lib/api.ts') ?? [];
    expect(apiHits.map((hit) => `${hit.receiver}.${hit.prop}`).sort()).toEqual([
      'body.error',
      'err.error',
      'err.error',
    ]);

    // (c) THE DISPLAY CONTRACT. `ApiError.message` must not read the field, and no surface
    // may render it. Tree-wide (test files are excluded from `sourceFiles`), the identifier
    // appears in exactly TWO modules: the one that defines and fills it, and the Sentry
    // forward that consumes it.
    const carriers = FILES.map((f) => rel(f)).filter((r) =>
      withoutComments(fs.readFileSync(path.join(SRC, r), 'utf8')).includes('upstreamMessage'),
    );
    expect(carriers.sort()).toEqual(['lib/api.ts', 'lib/queryClient.ts']);
    expect(apiSrc).toMatch(/return body\?\.message \?\? `HTTP error! status: \$\{status\}`;/);
  });

  it('7. T-88.6-117 — google-connect returns FIXED bodies, and exactly FOUR of them', () => {
    // Added by plan 88.6-42 task 2 (2026-09-17). T-88.6-117 is severity HIGH and until this
    // assertion its ONLY proof was that an executor read four bodies correctly: the route has
    // no test file at all, and the first future edit reaching for `errorData.error` in a body
    // would have re-opened it silently. This is the machine behind the prose criterion.
    //
    // It also enforces the `authUrl` arm's "no fifth body" constraint (R8 §8 / ACCEPT §12):
    // the redirect-rejection branch reuses the SAME fixed 500 body the truthiness arm always
    // returned, so the census stays at four. A fifth body reds here.
    const file = 'app/api/auth/google-connect/route.js';
    const src = withoutComments(fs.readFileSync(path.join(SRC, file), 'utf8'));

    // Balanced read of every `NextResponse.json(` argument list, so a `{ ... }` containing a
    // nested object or a template literal is captured whole rather than truncated at a comma.
    const bodies: string[] = [];
    const NEEDLE = 'NextResponse.json(';
    for (let at = src.indexOf(NEEDLE); at !== -1; at = src.indexOf(NEEDLE, at + 1)) {
      let depth = 0;
      let end = at + NEEDLE.length - 1;
      for (let i = at + NEEDLE.length - 1; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      bodies.push(src.slice(at + NEEDLE.length, end));
    }

    // (b) THE CENSUS. Four client-visible bodies: the 401 no-token, the 4xx upstream-failure
    // proxy, the 500 no/rejected auth URL, and the 500 catch-all.
    expect(bodies.length, 'the client-visible body census for this route is FOUR').toBe(4);

    // (a) NONE of them interpolates, reads the upstream envelope, or reads an exception.
    for (const body of bodies) {
      expect(body, 'a client-visible body must not interpolate — the user RENDERS it').not.toMatch(
        /\$\{/,
      );
      expect(body, 'a client-visible body must not echo the upstream envelope').not.toContain(
        'errorData.',
      );
      expect(body, 'a client-visible body must not carry a raw exception message').not.toMatch(
        /\berror\.message\b/,
      );
    }

    // …and the route is still DIAGNOSABLE: the console channel is this server runtime's only
    // working one (Sentry is never initialised here), so a ZERO is a FAILURE, not a success.
    expect(src.match(/console\.[a-zA-Z]+\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src, 'this route is OUT of AC-2 conversion set on the runtime rule').not.toContain(
      '@/lib/logger',
    );

    // R8 §8 — the redirect SINK is guarded, and its rejection arm is the SAME fixed body.
    expect(src).toContain('const GOOGLE_CONSENT_ORIGIN = ');
    expect(src).toMatch(/if \(!isGoogleConsentUrl\(authUrl\)\) \{/);
    expect(src).toMatch(/parsed\.protocol === 'https:' && parsed\.origin === GOOGLE_CONSENT_ORIGIN/);
    // The ONLY redirect in the file sits AFTER that guard.
    expect(src.match(/NextResponse\.redirect\(/g)?.length).toBe(1);
    expect(src.indexOf('NextResponse.redirect(')).toBeGreaterThan(
      src.indexOf('if (!isGoogleConsentUrl(authUrl)) {'),
    );
  });
});

// ---------------------------------------------------------------------------------------
// R8 §6 — THE FE `ApiErrorCode` UNION IS PINNED TO THE BE `ERROR_REGISTRY`
// ---------------------------------------------------------------------------------------
// Added by plan 88.6-42 task 1 (2026-09-17). After the `body.error` alias drop the `code` is
// the SOLE channel for specific copy: a backend code with no FE mirror degrades silently to
// the generic line — no type error, no test failure, no runtime signal. Nothing gated that
// before this assertion. `ERROR_REGISTRY` appears in FE source only inside prose comments and
// no BE test references `ApiErrorCode`, so the two registries were in sync by discipline alone.
//
// NON-VACUITY IS THE WHOLE DESIGN CONSTRAINT. FE and BE are separate repos and FE CI checks out
// the frontend alone, so a guarded `if (backendExists)` skip would be a silent pass on exactly
// the machine that matters. The BE key set is therefore MIRRORED as checked-in data below and
// the parity assertion runs against that mirror UNCONDITIONALLY; the LIVE registry is compared
// ADDITIONALLY, and only when the sibling checkout happens to be present.
const BE_ERROR_REGISTRY_KEYS_MIRROR: readonly string[] = [
  'validation',
  'rate_limited',
  'unauthorized',
  'token_invalid',
  'not_found',
  'forbidden',
  'prompt_deadline_expired',
  'prompt_closed',
  'reminder_cooldown',
  'owner_of_active_groups',
  'account_deleted',
  'already_restored',
  'already_member',
  'invite_pending',
  'invalid_token',
  'already_used',
  'window_expired',
  'not_provisioned',
  'unsupported_address',
  'internal',
];

/** The `| 'code'` members of the FE `ApiErrorCode` union, read off disk. */
function apiErrorCodeUnion(): string[] {
  const src = withoutComments(fs.readFileSync(path.join(SRC, 'lib/api.ts'), 'utf8'));
  const start = src.indexOf('export type ApiErrorCode =');
  expect(start, 'ApiErrorCode union not found in lib/api.ts').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf(';', start));
  return [...body.matchAll(/\|\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The keys of `MESSAGE_BY_CODE`, read off disk. */
function messageByCodeKeys(): string[] {
  const src = withoutComments(
    fs.readFileSync(path.join(SRC, 'components/ui/useFetchErrorState.ts'), 'utf8'),
  );
  const start = src.indexOf('const MESSAGE_BY_CODE: Record<FetchErrorCode, string> = {');
  expect(start, 'MESSAGE_BY_CODE not found in useFetchErrorState.ts').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}

/** The LIVE BE registry keys, or null when the sibling backend checkout is absent. */
function liveBackendRegistryKeys(): string[] | null {
  const errorsJs = path.resolve(
    SRC,
    '..',
    '..',
    'periodictabletopbackend_v2',
    'Sonnet',
    'utils',
    'errors.js',
  );
  if (!fs.existsSync(errorsJs)) return null;
  const src = withoutComments(fs.readFileSync(errorsJs, 'utf8'));
  const start = src.indexOf('const ERROR_REGISTRY = Object.freeze({');
  if (start < 0) return null;
  const body = src.slice(start, src.indexOf('\n});', start));
  return [...body.matchAll(/^ {2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
}

describe('R8 §6 — every BE ERROR_REGISTRY code has an FE home', () => {
  it('the mirrored BE key set is a subset of ApiErrorCode AND of MESSAGE_BY_CODE', () => {
    const union = apiErrorCodeUnion();
    const copy = messageByCodeKeys();

    // Anti-vacuity: both readers must actually have read something, or "no missing codes"
    // and "the parser went blind" look identical.
    expect(BE_ERROR_REGISTRY_KEYS_MIRROR.length).toBe(20);
    expect(union.length).toBeGreaterThanOrEqual(20);
    expect(copy.length).toBeGreaterThanOrEqual(20);

    // …and it FAILS NAMING THE MISSING CODES, never with a bare boolean: the whole value of
    // this gate is telling whoever added a BE code which FE table to extend.
    expect(
      BE_ERROR_REGISTRY_KEYS_MIRROR.filter((k) => !union.includes(k)),
      'BE codes with NO member in the FE ApiErrorCode union (lib/api.ts) — add them, or ' +
        'mapErrorToCode passes them through verbatim and every Record keyed on the union misses',
    ).toEqual([]);
    expect(
      BE_ERROR_REGISTRY_KEYS_MIRROR.filter((k) => !copy.includes(k)),
      'BE codes with NO MESSAGE_BY_CODE entry (useFetchErrorState.ts) — add them, or the ' +
        'outcome degrades silently to the generic line, which after the 88.6 alias drop is ' +
        'the only thing left to degrade to',
    ).toEqual([]);
  });

  it('the checked-in mirror still matches the LIVE backend registry when it is checked out', () => {
    const live = liveBackendRegistryKeys();
    if (live === null) {
      // NOT a skip of the assertion above — that one ran unconditionally against the mirror.
      // This arm only tells the mirror and the source apart, which needs the source present.
      expect(BE_ERROR_REGISTRY_KEYS_MIRROR.length).toBe(20);
      return;
    }
    expect(live.length).toBeGreaterThanOrEqual(20);
    expect(
      live.filter((k) => !BE_ERROR_REGISTRY_KEYS_MIRROR.includes(k)),
      'the LIVE BE ERROR_REGISTRY has codes the checked-in mirror above does not — update ' +
        'the mirror in the same commit as the backend change, then re-run the parity test',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// BOUNDARY FIXTURES — the exclusions are PINNED, in both directions, not assumed
// ---------------------------------------------------------------------------------------
// Each pair exists because getting that one boundary wrong is a way this gate fails
// silently. They run against `envelopeReads` directly, so they exercise the same detector
// the tree walk above uses.
const F = 'fixture.ts';
const props = (src: string): string[] =>
  envelopeReads(F, src).map((h) => `${h.receiver}.${h.prop}`);

describe('R9 detector — boundary fixtures', () => {
  it('permits the sanctioned `details.errors` envelope shape and flags the top-level mirror', () => {
    // The one distinction the whole `errors` half turns on. Too broad and the gate demands
    // deleting the CORRECT read; too narrow and it misses the legacy mirror Phase 93 drops.
    expect(props('const a = body?.details?.errors;')).toEqual([]);
    expect(props('const b = body?.errors;')).toEqual(['body.errors']);
    // Both arms of the real `lib/api.ts:316` expression, on one line: the sanctioned arm is
    // excluded and the legacy arm is still seen.
    expect(props('const c = body?.details?.errors ?? body?.errors;')).toEqual(['body.errors']);
  });

  it('flags the two shapes the old closed receiver list missed', () => {
    // `response.error` — `AvailabilityForm.js:130`, the live Phase-93 blocker.
    expect(props('if (response.error) { throw new Error(response.error); }')).toEqual([
      'response.error',
    ]);
    // A comparison form — `rsvp/[token]/page.js:87`, the domain discriminant.
    expect(props("if (result.error === 'event_passed') { pass(); }")).toEqual(['result.error']);
    // …and `validation.error`, the other name that was not on the old list.
    expect(props('if (!validation || validation.error) { bail(); }')).toEqual([
      'validation.error',
    ]);
  });

  it('does NOT flag a dereferenced Zod `error` object or any call form', () => {
    // Exclusion (b): a ZodError is an OBJECT that gets walked, never an envelope string.
    expect(props('const issues = parsed.error.issues.map((i) => i.path);')).toEqual([]);
    expect(props('const first = result.error?.issues[0];')).toEqual([]);
    // Exclusion (a): one generic call rule, so no logger name ever needs adding to a list.
    expect(props("console.error('boom', err);")).toEqual([]);
    expect(props("toast.error('Could not save');")).toEqual([]);
    expect(props("logger.error('x');")).toEqual([]);
  });

  it('does not match `error.message`, which is R1 territory', () => {
    // R1 owns the `error.message || "Failed to X"` idiom. Two gates fighting over one
    // population is how a fix lands in the wrong plan.
    expect(props('setError(err.message || fallbackCopy);')).toEqual([]);
  });

  it('counts one occurrence per distinct read expression, not per token', () => {
    // The counting unit, pinned. `lib/api.ts:300`'s real expression: two tokens, one read.
    expect(props("if (body?.errors && Array.isArray(body.errors)) return 'validation';")).toEqual([
      'body.errors',
    ]);
    // Different LINES are still distinct — `AvailabilityForm.js:130` and `:131`.
    expect(props('if (response.error) {\n  throw new Error(response.error);\n}')).toEqual([
      'response.error',
      'response.error',
    ]);
  });

  it('ignores reads that live only inside comments', () => {
    // This file, and every DECISION marker in the repo, necessarily quotes the token it
    // forbids. A grep gate cannot survive that; the shared lexer can.
    expect(props('// body.error is the legacy alias\n/* result.errors too */\nconst x = 1;')).toEqual(
      [],
    );
  });
});
