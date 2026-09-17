/**
 * The phase's ONE logger-context scanner (ACCEPT 14 / #73, owner ruling 2026-09-14).
 *
 * T-84-01 forbids forwarding a response body into telemetry. Until this file, that contract
 * rested on four soft things: executor care, a prose acceptance criterion repeated per
 * conversion plan, a summary note, and sentry.scrub.js's PATTERN scrub -- which redacts
 * emails, JWTs, Bearer tokens, secret key-values and phone numbers and has NO coverage for
 * display names, group or game names, or member UUIDs. Nothing mechanical stood between a
 * converted call and Sentry.
 *
 * WHY IT MATTERS NOW. Phase 88.6's AC-2 moved roughly 100 raw console calls onto the house
 * logger, and src/lib/logger.ts:34-35 puts the second argument into a breadcrumb's data field
 * FULLY STRUCTURED -- it egresses whenever the session later files any event. tsconfig has
 * checkJs: false, so typecheck sees none of it in the .js files where most of those calls
 * live, and the parameter's own type is Record<string, unknown>, which a response object
 * satisfies. A source scan is the only thing that can see this.
 *
 * WHAT IT ASSERTS -- two arms, deliberately in ONE file:
 *
 *   ARM 1 (T-88.6-167). No logger.* call anywhere in src/ passes a BARE RESPONSE VARIABLE as
 *   its context argument. The sanctioned shape AC-2 mandates -- an object literal of scalars,
 *   or a helper call such as errCtx(err) -- passes untouched. It is the BARE IDENTIFIER that
 *   is forbidden, because that is the shape that forwards a whole body.
 *
 *   ARM 2 (plan 88.6-15 Arm A, #67). Every reportContext value in the tree is a plain string
 *   literal: no expression container, no template interpolation. Same idiom, narrower target.
 *   Both plans name THIS file as the host. ONE scanner, not two -- 15 and 43 agree on that in
 *   their own plan text.
 *
 * WHY THE TWO ARMS SHARE A FILE. They are the same question asked of two sinks: what shape of
 * value is allowed to reach a reporting channel. Splitting them would duplicate the walk, the
 * lexer import, the roster machinery and the docblock rule below, and would give a future
 * reader two places to look for one contract.
 *
 * NO THIRD COMMENT-STRIPPER. This file imports withoutComments and sourceFiles from
 * src/test-utils/sourceScan.ts, the shared lexer. 88.6-13-PLAN.md:45 already records the local
 * copy that used to live in fetchErrorTreatment.test.ts as a divergence being converged, and
 * that copy is GONE -- the plan-text cites to its readStripped / scan helpers are stale, and
 * the shared lexer is what the surviving code actually uses. fetchErrorTreatment.test.ts is
 * byte-unchanged by this plan: plan 13 is its sole declarer under D41.
 *
 * THE FILENAME IS LOAD-BEARING. sourceScan.ts:209 filters entries on a literal dot after
 * "test", so a name like loggerCtxShape-helpers.ts would NOT be excluded and the scanner would
 * scan itself -- including the planted counter-examples below. Any rename must keep a literal
 * dot after "test" and must be recorded.
 *
 * ONE STYLE RULE FOR THIS FILE: no backtick inside a block comment. Plan 88.6-11 measured that
 * a backtick (or a comment terminator) inside a block comment makes vite:oxc collect ZERO
 * tests and report green. Every comment below that needs to quote a token uses line comments.
 */
import path from 'node:path';
import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assertExactCounts, assertRosterShape, type ExemptionRoster } from '../test-utils/exemption';
import { lineAt, sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const FILES = sourceFiles(SRC);
const REL = (abs: string) => path.relative(SRC, abs);

// ============================================================================================
// THE ROSTERS -- BOTH SEEDED EMPTY, AND THAT IS A CONTRACT, NOT A STARTING POINT.
// ============================================================================================
//
// An entry in either roster is a SECURITY DECISION and requires an OWNER RULING with a date.
// It is not an executor's call, not a planner's, and not a reviewer's. The reason is the
// asymmetry: a false red here costs one conversation, and a false green ships a user's display
// name, group name, game name or member UUID to a third-party telemetry vendor where
// `sentry.scrub.js`'s pattern scrub cannot see it and nothing downstream will ever notice.
//
// The roster machinery is `src/test-utils/exemption.ts`, so any entry added must carry an
// exact `sites` count, a substantive `why`, and an `owner` of kind `owner` with an ISO date --
// the same both-directions shape the rest of the phase uses, which means an entry also has to
// SHRINK when a site is fixed and be DELETED at zero. A fossil permission reds here.
//
// If you are reading this because the gate went red: the fix is to change the call, not the
// roster. Replace the bare identifier with an object literal of scalars, or with `errCtx(err)`
// where the value is a caught error.
const BARE_CTX_EXEMPT: ExemptionRoster = {};
const REPORT_CONTEXT_EXEMPT: ExemptionRoster = {};

// ============================================================================================
// The forbidden ctx shapes
// ============================================================================================

// The named set, from the owner ruling. These are the identifiers this codebase actually uses
// to hold a parsed response or a fetched collection.
const BARE_RESPONSE_NAMES = new Set(['data', 'body', 'payload', 'result', 'response']);

// Plus any identifier whose name ENDS in Data or List -- `errorData`, `groupData`,
// `memberList`, `eventsList`. Same hazard, different spelling.
const SUFFIXED_RESPONSE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(?:Data|List)$/;

/** A bare identifier and nothing else -- no call, no member access, no literal, no spread. */
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isBareResponseIdentifier(arg: string): boolean {
  const t = arg.trim();
  if (!BARE_IDENTIFIER.test(t)) return false;
  return BARE_RESPONSE_NAMES.has(t) || SUFFIXED_RESPONSE_NAME.test(t);
}

// ============================================================================================
// A top-level argument splitter
// ============================================================================================
//
// A line-based regex cannot answer "what is the SECOND argument", because every multi-argument
// logger call in this repo wraps, and because an object literal, a ternary and a template
// literal all contain commas that are not argument separators. This walks from the opening
// paren balancing brackets and skipping string and template bodies, and splits only on commas
// at depth 1. It is the same reason `stringChunks` exists rather than a grep.
function topLevelArgs(src: string, openParen: number): string[] | null {
  const stack: string[] = ['('];
  const args: string[] = [];
  let cur = '';
  let i = openParen + 1;

  while (i < src.length && stack.length > 0) {
    const c = src[i];
    const top = stack[stack.length - 1];

    if (top === "'" || top === '"') {
      if (c === '\\') {
        cur += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      // An unterminated quote before a newline is not a string in this language; bail out of
      // it rather than swallowing the rest of the file.
      if (c === top || c === '\n') stack.pop();
      cur += c;
      i += 1;
      continue;
    }

    if (top === '`') {
      if (c === '\\') {
        cur += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') {
        stack.pop();
        cur += c;
        i += 1;
        continue;
      }
      if (c === '$' && src[i + 1] === '{') {
        stack.push('{');
        cur += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`' || c === '(' || c === '[' || c === '{') {
      stack.push(c);
      cur += c;
      i += 1;
      continue;
    }

    if (c === ')' || c === ']' || c === '}') {
      stack.pop();
      if (stack.length === 0) {
        args.push(cur);
        return args;
      }
      cur += c;
      i += 1;
      continue;
    }

    if (c === ',' && stack.length === 1) {
      args.push(cur);
      cur = '';
      i += 1;
      continue;
    }

    cur += c;
    i += 1;
  }

  return null;
}

/** Byte ranges of every string / template body, so a token quoted in one is never a hit. */
function stringRanges(src: string): [number, number][] {
  return stringChunks(src).map(({ offset, text }) => [offset, offset + text.length + 2]);
}

function insideString(ranges: [number, number][], at: number): boolean {
  return ranges.some(([lo, hi]) => at >= lo && at < hi);
}

// ============================================================================================
// The scans
// ============================================================================================

const LOGGER_CALL = /\blogger\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\(/g;
const REPORT_CONTEXT = /\breportContext\s*=\s*/g;

interface Hit {
  file: string;
  line: number;
  detail: string;
}

function scanTree(): { loggerCalls: number; bareCtx: Hit[]; reportContexts: number; badReportContext: Hit[] } {
  let loggerCalls = 0;
  let reportContexts = 0;
  const bareCtx: Hit[] = [];
  const badReportContext: Hit[] = [];

  for (const abs of FILES) {
    const stripped = withoutComments(fs.readFileSync(abs, 'utf8'));
    const ranges = stringRanges(stripped);
    const rel = REL(abs);

    LOGGER_CALL.lastIndex = 0;
    for (let m = LOGGER_CALL.exec(stripped); m; m = LOGGER_CALL.exec(stripped)) {
      if (insideString(ranges, m.index)) continue;
      loggerCalls += 1;
      const args = topLevelArgs(stripped, m.index + m[0].length - 1);
      if (!args || args.length < 2) continue;
      const ctx = args[1];
      if (isBareResponseIdentifier(ctx)) {
        bareCtx.push({ file: rel, line: lineAt(stripped, m.index), detail: ctx.trim() });
      }
    }

    REPORT_CONTEXT.lastIndex = 0;
    for (let m = REPORT_CONTEXT.exec(stripped); m; m = REPORT_CONTEXT.exec(stripped)) {
      if (insideString(ranges, m.index)) continue;
      reportContexts += 1;
      const next = stripped[m.index + m[0].length];
      if (next === '"' || next === "'") continue;
      badReportContext.push({
        file: rel,
        line: lineAt(stripped, m.index),
        detail:
          next === '{'
            ? 'expression container'
            : next === '`'
              ? 'template literal'
              : `unexpected value opening with ${JSON.stringify(next ?? 'EOF')}`,
      });
    }
  }

  return { loggerCalls, bareCtx, reportContexts, badReportContext };
}

const SCAN = scanTree();

describe('88.6-43 / T-88.6-167 — no bare response variable reaches a logger context argument', () => {
  it('1. the scan is not vacuous — it really found the logger call sites it claims to police', () => {
    // The failure mode this pins: a regex that stops matching (a rename, a wrapper, a lexer
    // change) turns the two assertions below into "no offenders found" forever. The floor is
    // deliberately BELOW the measured total, same idiom as surfaceHoverSweep 4a and 4c, so
    // converting one more call is never a test edit and REMOVING many is.
    expect(FILES.length, 'source files walked').toBeGreaterThanOrEqual(150);
    expect(SCAN.loggerCalls, 'logger.* call sites found').toBeGreaterThanOrEqual(80);
  });

  it('2. no logger.* call passes a bare response variable as its context argument', () => {
    const offenders = SCAN.bareCtx.map((h) => `${h.file}:${h.line} — logger ctx is the bare identifier "${h.detail}"`);
    const measured: Record<string, number> = {};
    for (const h of SCAN.bareCtx) measured[h.file] = (measured[h.file] ?? 0) + 1;

    const unowned = offenders.filter((line) => !(line.split(':')[0] in BARE_CTX_EXEMPT));
    expect(
      unowned,
      'src/lib/logger.ts places this object into a Sentry breadcrumb data field fully structured (T-84-01). Pass an object literal of scalars, or errCtx(err)',
    ).toEqual([]);

    // Both-directions roster arithmetic, so an entry can never outlive its sites.
    expect(assertExactCounts(BARE_CTX_EXEMPT, measured)).toEqual([]);
  });

  it('3. the bare-ctx roster is EMPTY, and any future entry is an owner-ruled security decision', () => {
    expect(assertRosterShape(BARE_CTX_EXEMPT)).toEqual([]);
    expect(
      Object.keys(BARE_CTX_EXEMPT),
      'seeded EMPTY by owner ruling 2026-09-14 (ACCEPT 14 / #73). An entry here permits a response body to egress to Sentry; it requires an owner ruling with a date, never an executor or planner decision',
    ).toEqual([]);
  });
});

describe('88.6-15 Arm A / #67 — every reportContext value is a plain string literal', () => {
  it('4. the reportContext scan is not vacuous', () => {
    // Measured 22 attribute sites at plan 43 (2026-09-17). Floor below it, same idiom as above.
    expect(SCAN.reportContexts, 'reportContext assignments found').toBeGreaterThanOrEqual(18);
  });

  it('5. no reportContext value is an expression container or an interpolated template', () => {
    const offenders = SCAN.badReportContext.map((h) => `${h.file}:${h.line} — ${h.detail}`);
    const measured: Record<string, number> = {};
    for (const h of SCAN.badReportContext) measured[h.file] = (measured[h.file] ?? 0) + 1;

    const unowned = offenders.filter((line) => !(line.split(':')[0] in REPORT_CONTEXT_EXEMPT));
    expect(
      unowned,
      'reportContext is pasted into a user-visible report body (FetchErrorBanner.tsx:162). A plain string literal is code-derived copy; an interpolated value is runtime data of unknown provenance',
    ).toEqual([]);

    expect(assertExactCounts(REPORT_CONTEXT_EXEMPT, measured)).toEqual([]);
  });

  it('6. the reportContext roster is EMPTY, under the same owner-ruling rule', () => {
    expect(assertRosterShape(REPORT_CONTEXT_EXEMPT)).toEqual([]);
    expect(
      Object.keys(REPORT_CONTEXT_EXEMPT),
      'seeded EMPTY. An entry permits runtime data into a report body and is an owner-ruled decision with a date',
    ).toEqual([]);
  });
});

describe('88.6-43 — the shape rules themselves, pinned against fixtures', () => {
  // These are the NEGATIVE CONTROLS. Without them the two gates above could pass because the
  // predicate stopped recognising anything, which is indistinguishable from a clean tree. They
  // are fixtures, not tree scans, so they cost nothing and can never go stale with the code.
  it('7. the sanctioned ctx shapes pass and the forbidden ones fail', () => {
    for (const forbidden of ['data', 'body', 'payload', 'result', 'response', 'errorData', 'memberList']) {
      expect(isBareResponseIdentifier(forbidden), `${forbidden} must be rejected`).toBe(true);
    }
    for (const sanctioned of [
      '{ name: err.name, message: err.message }',
      'errCtx(err)',
      'err',
      'data.status',
      '{ status, code }',
      '{ ...base }',
      'String(data)',
    ]) {
      expect(isBareResponseIdentifier(sanctioned), `${sanctioned} must be accepted`).toBe(false);
    }
  });

  it('8. the argument splitter finds the SECOND argument across commas that are not separators', () => {
    const args = (s: string) => topLevelArgs(s, s.indexOf('('))?.map((a) => a.trim());
    expect(args('f("a, b", data)')).toEqual(['"a, b"', 'data']);
    expect(args('f(msg, { a: 1, b: 2 })')).toEqual(['msg', '{ a: 1, b: 2 }']);
    expect(args('f(msg,\n  errCtx(err, other))')).toEqual(['msg', 'errCtx(err, other)']);
    expect(args('f(msg, cond ? data : body)')).toEqual(['msg', 'cond ? data : body']);
  });
});
