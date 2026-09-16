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
    declaredAt: 60,
    declaration: 'const [prefillStatus, setPrefillStatus] = useState(',
    why:
      'Local pre-fill banner state shaped { source, count, error? } — set only by this ' +
      "component's own perform* callbacks, never assigned from a response body.",
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
  'lib/api.ts': {
    sites: 5,
    why:
      'The envelope seam itself. :309 is the `body?.message ?? body?.error ?? "HTTP error!"` ' +
      'fallback chain (the SPEC cites ":280" — stale, re-derived 2026-09-15). :300 is the ' +
      'top-level `body.errors[]` legacy-validation mirror and :316 is its second arm ' +
      '(`body?.details?.errors ?? body?.errors`) — the first arm is the SANCTIONED Phase ' +
      '85/86 shape and is a scanner exclusion, not a roster site. :1126 and :1159 are RAW ' +
      '`fetch` calls that BYPASS apiFetch entirely, reading availabilityPrefill bodies that ' +
      'are `{ error: string }` with no `code` and no `message` — so converting those two ' +
      'needs the backend shape confirmed first, not a mechanical edit. Plan 42 owns the ' +
      'conversion of this file.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R9 / AC-9' },
  },
  'app/components/SuggestionCard.js': {
    sites: 1,
    why:
      ':53 reads `result.error` off a 2xx body in the suggestion-to-event convert path. ' +
      'RESEARCH Assumptions Log A3 marks the backend shape behind it UNVERIFIED — the ' +
      'suggestions route was NOT opened, so whether this is a legacy alias or a domain ' +
      'field is unknown. Plan 42 opens the backend route FIRST and owns the outcome, which ' +
      'may be a deletion rather than a conversion. Converting it blind would silently break ' +
      'event-creation error copy.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R9 / AC-9 — pending RESEARCH assumption A3' },
  },
  'app/rsvp/[token]/page.js': {
    sites: 2,
    why:
      'A DOMAIN DISCRIMINANT, not a legacy alias. The backend returns HTTP 410 with ' +
      '`{ error: "event_passed" | "event_cancelled", group_id, event_name }` and NO `code` ' +
      'and NO `message` (periodictabletopbackend_v2/Sonnet/routes/rsvp.js:292-306, ' +
      're-derived 2026-09-15: cancelled at :293-296, passed at :302-306). A mechanical ' +
      'read-`body.code` edit makes BOTH branches unreachable and drops the page to its ' +
      'generic PAGE_STATES.ERROR — a silent, user-visible regression on the magic-link RSVP ' +
      'flow, one of the two primary entry points into this app. Phase 93 owns adding the ' +
      'backend `code`; nothing in 88.6 converts this.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling: 'D62 branch B — FE-only in Phase 88.6; Phase 93 owns adding the BE `code`',
    },
  },
  'app/api/auth/google-connect/route.js': {
    sites: 1,
    why:
      ':53 reads `errorData.error` inside a Next route handler that proxies an upstream ' +
      'backend failure back to the browser. It lives under `src/`, so AC-9 scope includes ' +
      'it — a route handler is not exempt just because it runs server-side. Plan 42 owns ' +
      'the conversion once the upstream shape is confirmed.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R9 / AC-9' },
  },
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
      'the conversion when that happens.',
    owner: {
      kind: 'owner',
      date: '2026-09-09',
      ruling: 'D62 branch B — FE-only in Phase 88.6; Phase 93 owns adding the BE `code`',
    },
  },
  'app/availability-form/[token]/page.js': {
    sites: 2,
    why:
      'Rostered, but NEITHER is a Phase-93 blocker, and recording an inert read as a live ' +
      'one is its own defect. :68 (`validation.error`) is INERT: magicAuth.js emits ' +
      '`valid: true` ONLY on the success path (:208-209, the sole `valid:` assignment in ' +
      'that route) and never on any failure branch, so the sibling `!validation.valid` arm ' +
      'already catches every failure identically. :109 (`existing.error`) is DEAD: ' +
      '`getExistingResponse` returns `null` on a non-2xx (api.ts:1095-1097, ' +
      '`res.ok ? res.json() : null`), so the truthy-`existing` guard is never entered with ' +
      'an error body at all. Plan 42 DELETES both as cleanup — this is not a conversion.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R9 / AC-9 — plan 42 owns the deletion' },
  },
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

  it('3. the roster covers exactly the six measured files, with the measured per-file counts', () => {
    // Stated positively as well as by difference, so the census this plan asserts is
    // readable straight off a failure rather than reconstructed from a violations list.
    expect(MEASURED).toEqual({
      'lib/api.ts': 5,
      'app/components/SuggestionCard.js': 1,
      'app/rsvp/[token]/page.js': 2,
      'app/api/auth/google-connect/route.js': 1,
      'app/components/AvailabilityForm.js': 2,
      'app/availability-form/[token]/page.js': 2,
    });
    const total = Object.values(MEASURED).reduce((a, b) => a + b, 0);
    expect(total).toBe(13);
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
