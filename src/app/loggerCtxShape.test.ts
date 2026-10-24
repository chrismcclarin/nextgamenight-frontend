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
 * logger, and src/lib/logger.ts ("Sentry.addBreadcrumb({ message: msg, level: 'info', data: ctx })") puts the second argument into a breadcrumb's data field
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
 *   Since plan 88.6.2-14 the arm also splits by method: info and warn context is default-deny
 *   (errCtx(...) or a spread-free object literal of non-response values), and the logger.error
 *   argument passes only as a bare non-response identifier or one plain call. The reason is the
 *   three sinks: info context lands in breadcrumb data, warn context in extra, and the error
 *   argument goes to captureException, which serializes a non-Error object whole.
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
 * src/test-utils/sourceScan.ts, the shared lexer.
 * planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-13-PLAN.md ("Widening it is the moment to converge it onto the shared lexer")
 * already records the local
 * copy that used to live in fetchErrorTreatment.test.ts as a divergence being converged, and
 * that copy is GONE -- the plan-text cites to its readStripped / scan helpers are stale, and
 * the shared lexer is what the surviving code actually uses. fetchErrorTreatment.test.ts is
 * byte-unchanged by this plan: plan 13 is its sole declarer under D41.
 *
 * THE FILENAME IS LOAD-BEARING. src/test-utils/sourceScan.ts ("!/\.(test|spec)\./.test(entry.name)") filters entries on a literal dot after
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

// The common local names for a raw response or its parsed body. They join the response names
// INSIDE ctxShapeViolation only (W044); the owner-ruled set above and test 2 are unchanged.
const RESPONSE_ALIASES = new Set(['json', 'res', 'resp']);

function isResponseName(name: string): boolean {
  return BARE_RESPONSE_NAMES.has(name) || SUFFIXED_RESPONSE_NAME.test(name) || RESPONSE_ALIASES.has(name);
}

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
// The per-method shape rule (W044, PC-6)
// ============================================================================================

/** Index of the bracket that closes the one opened at text[open], via topLevelArgs; or null. */
function closeIndex(text: string, open: number): number | null {
  const parts = topLevelArgs(text, open);
  if (!parts) return null;
  // topLevelArgs keeps every character it walks except the depth-1 commas and the closer.
  return open + 1 + parts.reduce((n, p) => n + p.length, 0) + (parts.length - 1);
}

/** The text with balanced OUTER parens removed: (a ?? b) reads as a ?? b. */
function stripOuterParens(expr: string): string {
  let t = expr.trim();
  while (t.startsWith('(') && closeIndex(t, 0) === t.length - 1) t = t.slice(1, -1).trim();
  return t;
}

/** True when the whole text is one balanced bracket opened at text[0]. */
function isWhole(text: string, opener: string): boolean {
  return text.startsWith(opener) && closeIndex(text, 0) === text.length - 1;
}

/**
 * The operands of a ternary or logical expression at depth 0: the text split on ?, :, ||, ??
 * and &&, skipping strings, templates and brackets. One operand means no such operator.
 */
function depthZeroOperands(text: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (top === "'" || top === '"' || top === '`') {
      if (c === '\\') {
        cur += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (top === '`' && c === '$' && text[i + 1] === '{') {
        stack.push('{');
        cur += '${';
        i += 2;
        continue;
      }
      if (c === top) stack.pop();
      cur += c;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '(' || c === '[' || c === '{') {
      stack.push(c);
    } else if (c === ')' || c === ']' || c === '}') {
      stack.pop();
    } else if (stack.length === 0) {
      const two = text.slice(i, i + 2);
      if (two === '||' || two === '??' || two === '&&') {
        out.push(cur);
        cur = '';
        i += 2;
        continue;
      }
      // A ternary ? but never the ?. of optional chaining.
      if ((c === '?' && text[i + 1] !== '.') || c === ':') {
        out.push(cur);
        cur = '';
        i += 1;
        continue;
      }
    }
    cur += c;
    i += 1;
  }
  out.push(cur);
  return out;
}

/** A member or bracket chain (a.b, a?.b, a['b']); its LAST segment, or null when not a chain. */
const MEMBER_CHAIN =
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\??\.\s*[A-Za-z_$][A-Za-z0-9_$]*|\s*(?:\?\.)?\[\s*(?:'[^']*'|"[^"]*")\s*\])+$/;
function lastChainSegment(expr: string): string | null {
  if (!MEMBER_CHAIN.test(expr)) return null;
  const m = /(?:\.\s*([A-Za-z_$][A-Za-z0-9_$]*)|\[\s*['"]([^'"]*)['"]\s*\])$/.exec(expr);
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * A response VALUE: a response name, a chain whose last segment is one, or a ternary / logical
 * expression with such an operand at depth 0. A scalar read off a response (response.status)
 * is not one: the rule reads the last segment, never the root.
 */
function isResponseValue(expr: string): boolean {
  const t = stripOuterParens(expr);
  if (BARE_IDENTIFIER.test(t)) return isResponseName(t);
  const last = lastChainSegment(t);
  if (last !== null) return isResponseName(last);
  const operands = depthZeroOperands(t);
  return operands.length > 1 && operands.some((o) => isResponseValue(o));
}

/**
 * The colon of one object-literal property, or -1 for a shorthand. A key (plain, quoted or
 * computed in brackets) holds no depth-0 operator, so the first depth-0 split is the key's
 * colon or there is none.
 */
function depthZeroColon(prop: string): number {
  const [key, ...rest] = depthZeroOperands(prop);
  return rest.length > 0 && prop[key.length] === ':' ? key.length : -1;
}

/** Why an object-literal context is denied, or null when every property is allowed. */
function literalViolation(literal: string): string | null {
  const props = topLevelArgs(literal, 0);
  if (!props) return 'an unbalanced object literal';
  for (const raw of props) {
    const prop = raw.trim();
    if (!prop) continue;
    if (prop.startsWith('...')) return `a spread (${prop})`;
    const colon = depthZeroColon(prop);
    if (colon === -1) {
      if (!BARE_IDENTIFIER.test(prop)) return `a property that is not key: value (${prop})`;
      if (isResponseName(prop)) return `a response-named shorthand property (${prop})`;
      continue;
    }
    const value = stripOuterParens(prop.slice(colon + 1));
    if (isWhole(value, '{')) {
      const nested = literalViolation(value);
      if (nested) return `a nested literal holding ${nested}`;
      continue;
    }
    if (isResponseValue(value)) return `a response value (${prop})`;
  }
  return null;
}

/** A short name for a denied shape, for the failure message. */
function shapeName(t: string): string {
  if (t.startsWith('...')) return 'a spread';
  if (BARE_IDENTIFIER.test(t)) return isResponseName(t) ? 'a response-named identifier' : 'a bare identifier';
  if (lastChainSegment(t) !== null) return 'a member or bracket chain';
  if (isWhole(t, '{')) return 'an object literal';
  if (isWhole(t, '[')) return 'an array';
  if (t.startsWith('`')) return 'a template literal';
  if (depthZeroOperands(t).length > 1) return 'a ternary or logical expression';
  if (/\)$/.test(t)) return 'a call';
  return 'an expression';
}

const PLAIN_CALL = /^(?:new\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(/;

// DECISION Phase 88.6.2-14 (PC-6): a per-method shape rule — logger.info / logger.warn context is default-deny (errCtx(...) or a spread-free literal of non-response values), and logger.error passes only a bare non-response identifier or a plain call because its second argument IS the error by contract (src/lib/logger.ts ("Sentry.captureException(err ?? new Error(msg)")) — over a method-agnostic default-deny, which reds the 15 logger.error(msg, err) sites and could only be cleared by source edits (R11) or entries in the owner-ruled empty roster, and over a blanket error exemption, which lets an object literal reach captureException, where Sentry serializes it whole into extra. Residual a text scan cannot type, accepted as T-88.6.2-68: a call or other expression as a literal value, a bare identifier value outside the response names, and a chain off a response whose last segment is not a response name.
function ctxShapeViolation(method: string, ctx: string): string | null {
  const t = ctx.trim();
  if (method === 'error') {
    if (BARE_IDENTIFIER.test(t)) return isResponseName(t) ? 'a response-named identifier' : null;
    const call = PLAIN_CALL.exec(t);
    if (call && closeIndex(t, call[0].length - 1) === t.length - 1) return null;
    return `the argument must be the error itself (a bare identifier or a plain call), not ${shapeName(t)}`;
  }
  const errCtxCall = /^errCtx\s*\(/.exec(t);
  if (errCtxCall && closeIndex(t, errCtxCall[0].length - 1) === t.length - 1) return null;
  if (isWhole(t, '{')) return literalViolation(t);
  return `context must be errCtx(...) or an object literal, not ${shapeName(t)}`;
}

/**
 * The denied hits no roster entry owns. A hit is dropped ONLY when its file is a roster key AND
 * test 2 counted a bare-identifier hit at the same file and line, so the roster's exact sites
 * count stays the only permission: one owner-ruled roster, no second roster, and no file-wide
 * grant for a shape test 2 does not see.
 */
function unownedDenied(denied: Hit[], bare: Hit[], roster: ExemptionRoster): Hit[] {
  return denied.filter(
    (d) => !(d.file in roster && bare.some((b) => b.file === d.file && b.line === d.line)),
  );
}

// ============================================================================================
// The scans
// ============================================================================================

// Group 1 is the method name (W044); m.index and m[0] keep their meaning.
const LOGGER_CALL = /\blogger\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const REPORT_CONTEXT = /\breportContext\s*=\s*/g;

interface Hit {
  file: string;
  line: number;
  detail: string;
}

function scanTree(): {
  loggerCalls: number;
  bareCtx: Hit[];
  deniedCtx: Hit[];
  splitChecked: number;
  errorExempt: number;
  reportContexts: number;
  badReportContext: Hit[];
} {
  let loggerCalls = 0;
  let reportContexts = 0;
  let splitChecked = 0;
  let errorExempt = 0;
  const bareCtx: Hit[] = [];
  const deniedCtx: Hit[] = [];
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
      // W044: the per-method shape rule, a separate tally beside the untouched bareCtx push.
      const method = m[1];
      const reason = ctxShapeViolation(method, ctx);
      if (method === 'error') {
        if (reason === null) errorExempt += 1;
      } else {
        splitChecked += 1;
      }
      if (reason !== null) {
        deniedCtx.push({
          file: rel,
          line: lineAt(stripped, m.index),
          detail: `${method}: ${reason} — ${ctx.trim().replace(/\s+/g, ' ')}`,
        });
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

  return { loggerCalls, bareCtx, deniedCtx, splitChecked, errorExempt, reportContexts, badReportContext };
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

  it('10. logger.* context is default-deny by method — info/warn only errCtx(...) or a spread-free literal of non-response values; error only a bare non-response identifier or a plain call (W044)', () => {
    // Anti-vacuity, same below-the-measurement idiom as test 1: 101 info/warn calls with a
    // context and 15 logger.error calls with an argument were measured at plan 88.6.2-14.
    expect(SCAN.splitChecked, 'info/warn calls with a context, each through ctxShapeViolation').toBeGreaterThanOrEqual(80);
    expect(SCAN.errorExempt, 'logger.error calls whose argument the error rule passed').toBeGreaterThanOrEqual(10);

    const offenders = unownedDenied(SCAN.deniedCtx, SCAN.bareCtx, BARE_CTX_EXEMPT).map(
      (h) => `${h.file}:${h.line} — logger.${h.detail}`,
    );
    expect(
      offenders,
      'src/lib/logger.ts sends info context to a breadcrumb, warn context to extra, and the error argument to captureException, where a non-Error object is serialized whole (T-84-01). Pass errCtx(err) or an object literal of scalars to info/warn, and the caught error itself to error',
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

  it('9. the method split, pinned against fixtures (W044, PC-6)', () => {
    // Each list is checked whole and the misses are collected, so a red names every row the
    // rule got wrong rather than stopping at the first.
    const infoWarnDenied = [
      'err',
      'json',
      'res.data',
      'cond ? a : b',
      '{ ...body }',
      '{ a: 1, ...rest }',
      '{ data }',
      '{ body: data }',
      '{ items: res.data }',
      '{ nested: { ...body } }',
      '{ json }',
      '{ res }',
      '{ response: resp }',
      '{ x: cond ? data : null }',
      '{ x: data ?? {} }',
      "{ x: res['data'] }",
    ];
    const infoWarnPassed = [
      'errCtx(err)',
      '{ status, code }',
      '{ name: err.name, message: err.message }',
      '{ stored: key }',
      '{ url }',
      // A scalar read off a response passes: the rule checks the LAST segment, never the root.
      '{ status: response.status }',
      "{ received: data === null ? 'null' : typeof data }",
      '{ group_id: group.id, stored_colour: String(x).slice(0, 32) }',
    ];
    const errorDenied = [
      '{ ...body }',
      '{ data }',
      '{ e: err }',
      '[err]',
      'res.data',
      'err.cause',
      'response.body',
      'res.json()',
      'JSON.parse(body)',
      'cond ? err : data',
      'err ?? fallback',
      '`failed: ${msg}`',
      'data',
      'json',
    ];
    const errorPassed = ['err', 'error', 'reducedSuggestionsFetchError(err)', 'new Error(msg)'];

    const wrong: string[] = [];
    for (const method of ['info', 'warn']) {
      for (const ctx of infoWarnDenied) {
        if (ctxShapeViolation(method, ctx) === null) wrong.push(`${method} must deny ${ctx}`);
      }
      for (const ctx of infoWarnPassed) {
        const r = ctxShapeViolation(method, ctx);
        if (r !== null) wrong.push(`${method} must pass ${ctx} (got: ${r})`);
      }
    }
    for (const ctx of errorDenied) {
      if (ctxShapeViolation('error', ctx) === null) wrong.push(`error must deny ${ctx}`);
    }
    for (const ctx of errorPassed) {
      const r = ctxShapeViolation('error', ctx);
      if (r !== null) wrong.push(`error must pass ${ctx} (got: ${r})`);
    }
    expect(wrong).toEqual([]);

    // The owner-ruled named set and test 2's predicate are untouched by the split.
    expect(isBareResponseIdentifier('data')).toBe(true);

    // The roster filter (M63): a roster key grants ONLY the denied hits test 2 also counted at
    // the same file and line. A denied shape test 2 cannot see is never exempted by a file key.
    const roster: ExemptionRoster = {
      'x.js': {
        sites: 1,
        why: 'synthetic fixture entry for the roster-filter pin; the file never exists on disk',
        owner: { kind: 'owner', date: '2026-10-24', ruling: 'fixture only' },
      },
    };
    const bare: Hit[] = [{ file: 'x.js', line: 3, detail: 'data' }];
    const denied: Hit[] = [
      { file: 'x.js', line: 3, detail: 'info: a response-named identifier — data' },
      { file: 'x.js', line: 9, detail: 'warn: a spread — { ...body }' },
    ];
    expect(unownedDenied(denied, bare, roster)).toEqual([denied[1]]);
  });
});
