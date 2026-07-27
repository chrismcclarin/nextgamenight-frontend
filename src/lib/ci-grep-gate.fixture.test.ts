// src/lib/ci-grep-gate.fixture.test.ts
//
// REQ 3 GREP-GATE SELF-TEST (phase 87.3, plan 08).
//
// This is NOT an app test — it asserts that the inverted-grep idiom used by the
// "no sub-vs-API compare" gate in `.github/workflows/ci.yml` (quality job) is
// CORRECT and stays honest:
//   - a string that SHOULD match  -> pipeline emits output (non-empty) -> CI `exit 1` (FAIL)
//   - an allowlisted string       -> pipeline emits nothing (empty)    -> CI passes
//
// It runs the EXACT workflow pipeline (pattern grep + comment filter) against
// in-test fixture strings ONLY. No forbidden pattern is written into real
// `src/app` source — the fixtures live entirely inside this file (which is
// under src/lib, NOT src/app, so the live gate never scans it).
//
// LOCKSTEP BY PARSING, not by copy: the match pattern, its grep FLAGS, the
// scanned scope and the comment filter are all extracted from
// .github/workflows/ci.yml at test time, so any edit to a gate is exercised here
// automatically — drift is structurally impossible (the old byte-for-byte
// duplicate could drift silently).
//
// Phase 88.2 (plan 09, MED #8): this file now covers TWO gates, and each is
// located by its step NAME. It previously took "the FIRST HITS=$(grep -rnE line
// in the file", which made ci.yml step ORDER load-bearing in a way nothing
// declared: adding a second gate ABOVE the sub-compare one would have silently
// repointed this whole suite at the new gate — every test still green, the gate
// it was written to protect completely unverified. Do NOT go back to a
// positional lookup. Renaming a step in ci.yml without updating the name here
// throws loudly at import, which is the intended failure mode.

import { describe, test, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CI_YML = readFileSync(
  resolve(__dirname, '../../.github/workflows/ci.yml'),
  'utf8',
);

interface Gate {
  /** The regex the gate matches with. */
  pattern: string;
  /** grep's flags as written in ci.yml, e.g. `rnE` or `rniE`. */
  flags: string;
  /** The path(s) the gate scans. */
  scope: string;
  /** The comment-line filter applied to the hits. */
  filter: string;
}

/**
 * Locate a gate by its ci.yml step NAME and parse it. The search window is
 * bounded to that step (it stops at the next `- name:`), so a step that has lost
 * its HITS line fails here instead of silently borrowing the next step's.
 *
 * Shape parsed:
 *   HITS=$(grep -<FLAGS> '<PATTERN>' <SCOPE> | grep -vE '<FILTER>' || true)
 */
function parseGate(stepName: string): Gate {
  const lines = CI_YML.split('\n');
  const start = lines.findIndex((l) => l.includes(stepName));
  if (start === -1) {
    throw new Error(`ci.yml step "${stepName}" not found — was the gate renamed or removed?`);
  }
  const rest = lines.slice(start + 1);
  const nextStep = rest.findIndex((l) => /^\s*- name:/.test(l));
  const window = nextStep === -1 ? rest : rest.slice(0, nextStep);
  // ANCHORED to the start of the shell line, not a substring search: the step's
  // own comment block explains the idiom, and a loose `includes` would match the
  // prose before the code (that exact trap fired while this was being written).
  const line = window.find((l) => /^\s*HITS=\$\(grep -/.test(l));
  if (!line) {
    throw new Error(
      `ci.yml step "${stepName}" has no grep-gate assignment line — keep the HITS=... | grep -vE ... || true shape.`,
    );
  }
  const patternMatch = line.match(/grep -([A-Za-z]+) '([^']+)' (\S+)/);
  const filterMatch = line.match(/grep -vE '([^']+)'/);
  if (!patternMatch || !filterMatch) {
    throw new Error(
      `ci.yml step "${stepName}" did not parse into flags + pattern + scope + comment filter.`,
    );
  }
  return {
    flags: patternMatch[1],
    pattern: patternMatch[2],
    scope: patternMatch[3],
    filter: filterMatch[1],
  };
}

const SUB_COMPARE_GATE = parseGate('no user.sub compared against an API data field');
const PERMANENCE_GATE = parseGate('group-delete copy must not claim permanence');

// Retained names so the original suite below reads unchanged.
const PATTERN = SUB_COMPARE_GATE.pattern;
const FILTER = SUB_COMPARE_GATE.filter;

/**
 * Run a gate's full pipeline against `input` exactly as CI does: the same grep
 * flags and pattern (minus `-r`, since we feed stdin rather than a tree), then
 * `grep -vE <FILTER>`. Returns the surviving lines (empty string === gate
 * passes). grep exits 1 on no-match; we mirror the workflow's `|| true` by
 * swallowing that.
 *
 * Flags are taken from ci.yml rather than hard-coded, so dropping the `i` from
 * the permanence gate (which would let `Cannot Be Undone` through) reds here.
 */
function gateHitsFor(gate: Gate, input: string): string {
  const run = (args: string[], stdin: string): string => {
    try {
      return execFileSync('grep', args, { input: stdin, encoding: 'utf8' });
    } catch (err) {
      // grep exit code 1 = no lines matched -> empty (the pass path).
      if ((err as { status?: number }).status === 1) return '';
      throw err; // exit >= 2 is a real grep error — surface it.
    }
  };
  // `-r` is meaningless on stdin; drop it and keep everything else verbatim.
  const stdinFlags = gate.flags.replace('r', '');
  // The prefixed pass already carries a `line:` of its own, so drop `n` too.
  const prefixedFlags = stdinFlags.replace('n', '');
  // Prefix a fake `path:line:` so the anchored comment filter sees the same
  // shape it sees in CI (grep -rn output).
  const prefixed = input
    .split('\n')
    .map((l, i) => `src/app/fixture.js:${i + 1}:${l}`)
    .join('\n');
  const hits = run([`-${stdinFlags}`, gate.pattern], input);
  if (hits === '') return '';
  // Re-run against the prefixed form to apply the filter exactly as CI does.
  const prefixedHits = run([`-${prefixedFlags}`, gate.pattern], prefixed);
  return run(['-vE', gate.filter], prefixedHits);
}

const gateHits = (input: string): string => gateHitsFor(SUB_COMPARE_GATE, input);

describe('Req-3 no-sub-compare grep gate — lockstep self-test (pattern parsed from ci.yml)', () => {
  test('the gate line parses out of ci.yml (pattern + filter both present)', () => {
    expect(PATTERN.length).toBeGreaterThan(0);
    expect(FILTER.length).toBeGreaterThan(0);
  });

  describe('offending is-me compares MATCH (gate would FAIL) — both operand orders', () => {
    test('sub on RHS: member.user_id === user.sub', () => {
      expect(gateHits('const me = data.find(m => m.user_id === user.sub);')).not.toBe('');
    });

    test('sub on RHS, optional-chained: review.User?.id === user?.sub', () => {
      expect(gateHits('const own = review.User?.id === user?.sub;')).not.toBe('');
    });

    test('sub on LHS: user.sub === member.user_id', () => {
      expect(gateHits('if (user.sub === m.user_id) return true;')).not.toBe('');
    });

    test('sub on LHS, negated + optional-chained: user?.sub !== review.User?.id', () => {
      expect(gateHits('const notMine = user?.sub !== review.User?.id;')).not.toBe('');
    });

    test('inside a .find() predicate: rsvps.find(r => r.user_id === user.sub)', () => {
      expect(gateHits('const mine = rsvps.find(r => r.user_id === user.sub);')).not.toBe('');
    });

    test('LOOSE equality both orders: x == user.sub / user.sub != x', () => {
      expect(gateHits('const own = m.user_id == user.sub;')).not.toBe('');
      expect(gateHits('if (user.sub != m.user_id) return;')).not.toBe('');
    });

    test('membership: ids.includes(user.sub)', () => {
      expect(gateHits('const mine = memberIds.includes(user.sub);')).not.toBe('');
    });

    test('membership: subSet.has(user.sub)', () => {
      expect(gateHits('if (attendeeSubs.has(user.sub)) return true;')).not.toBe('');
    });

    test('membership: rows.some(r => r.user_id === user.sub)', () => {
      expect(gateHits('const joined = rows.some(r => r.user_id === user.sub);')).not.toBe('');
    });

    test('object bracket-lookup keyed by the sub: rolesById[user.sub]', () => {
      expect(gateHits('const role = rolesById[user.sub];')).not.toBe('');
    });

    test('a genuine hit on a line ALSO containing :// is NOT dropped by the comment filter', () => {
      expect(
        gateHits("const own = m.user_id === user.sub; // see https://example.com/docs")
      ).not.toBe('');
    });
  });

  describe('allowlisted sub uses do NOT match (gate stays GREEN)', () => {
    test('self-fetch call site: usersAPI.getUser(user.sub)', () => {
      expect(gateHits('const self = await usersAPI.getUser(user.sub);')).toBe('');
    });

    test('presence guard: if (!user?.sub) return', () => {
      expect(gateHits('if (!user?.sub) return null;')).toBe('');
    });

    test('API arg: getUserGroups(user.sub)', () => {
      expect(gateHits('const groups = await getUserGroups(user.sub);')).toBe('');
    });

    test('assignment (single =): const currentUserSub = user?.sub || null', () => {
      expect(gateHits('const currentUserSub = user?.sub || null;')).toBe('');
    });

    test('useEffect dependency array: }, [user.sub]) is not a bracket-lookup', () => {
      expect(gateHits('    }, [user.sub]);')).toBe('');
    });

    test('a full-line comment quoting the forbidden pattern is filtered out', () => {
      expect(gateHits('// old bug: m.user_id === user.sub (fixed in 87.3)')).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 88.2 / SPEC-REQ-7 — the permanence-copy gate's own self-test.
//
// The group delete is a SOFT delete recoverable for 30 days, so copy in that
// flow claiming the action is final is factually wrong. The gate greps the
// group-delete flow ONLY; the same phrases are correct (and left alone) in
// account deletion, a Modal test fixture, role promotion and event delete.
// ---------------------------------------------------------------------------

// A file that legitimately contains one of the forbidden phrases and is
// deliberately NOT gated: account deletion really is final. It is the fixture
// for "the scope, not the pattern, is what keeps those hits green".
const OUT_OF_SCOPE_FILE = 'src/app/components/DangerZoneDeleteAccount.tsx';

const permanenceHits = (input: string): string => gateHitsFor(PERMANENCE_GATE, input);

describe('SPEC-REQ-7 permanence-copy grep gate — lockstep self-test (parsed from ci.yml by step name)', () => {
  test('the gate parses out of ci.yml (pattern, flags, scope and filter all present)', () => {
    expect(PERMANENCE_GATE.pattern.length).toBeGreaterThan(0);
    expect(PERMANENCE_GATE.filter.length).toBeGreaterThan(0);
    expect(PERMANENCE_GATE.flags).toContain('i'); // case-insensitive, or `Cannot Be Undone` slips through
    expect(PERMANENCE_GATE.scope.length).toBeGreaterThan(0);
  });

  test('the two gates are located independently — neither borrows the other\'s line', () => {
    expect(PERMANENCE_GATE.pattern).not.toBe(SUB_COMPARE_GATE.pattern);
    expect(PERMANENCE_GATE.scope).not.toBe(SUB_COMPARE_GATE.scope);
  });

  describe('permanence claims MATCH (gate would FAIL)', () => {
    test('the retired copy: This action cannot be undone.', () => {
      expect(permanenceHits('This action cannot be undone.')).not.toBe('');
    });

    test('permanently remove', () => {
      expect(
        permanenceHits('Deleting a group will permanently remove all events and members.')
      ).not.toBe('');
    });

    test('permanently delete', () => {
      expect(permanenceHits('This will permanently delete the group.')).not.toBe('');
    });

    test('case-insensitively: Cannot Be Undone', () => {
      expect(permanenceHits('Warning: This Cannot Be Undone!')).not.toBe('');
    });
  });

  describe('non-claims do NOT match (gate stays GREEN)', () => {
    test('a full-line comment quoting the retired copy is filtered out', () => {
      expect(
        permanenceHits('// Phase 88.2 replaced "This action cannot be undone." with the real window')
      ).toBe('');
    });

    test('a JSDoc continuation line quoting it is filtered out', () => {
      expect(permanenceHits(' * was: cannot be undone — now recoverable for 30 days')).toBe('');
    });

    test('the shipped replacement copy is clean', () => {
      expect(
        permanenceHits(
          'You have 30 days to change your mind. Every other member is emailed a link to take over the group.'
        )
      ).toBe('');
    });
  });

  describe('scope is what keeps the legitimate hits green — not a toothless pattern', () => {
    test('the gate scans the group-delete flow, never all of src/', () => {
      expect(PERMANENCE_GATE.scope).toContain('GroupSettings.js');
      expect(PERMANENCE_GATE.scope).not.toBe('src/');
      expect(PERMANENCE_GATE.scope).not.toBe('src');
      expect(PERMANENCE_GATE.scope).not.toBe('src/app');
    });

    test('an out-of-scope file is outside the scanned path', () => {
      const scope = PERMANENCE_GATE.scope.replace(/\/$/, '');
      const covered = OUT_OF_SCOPE_FILE === scope || OUT_OF_SCOPE_FILE.startsWith(`${scope}/`);
      expect(covered).toBe(false);
    });

    test('...and it is excluded by SCOPE alone — the pattern does match its copy', () => {
      // The account-deletion copy WOULD trip this gate if the scope were widened.
      // That is the whole reason the scope is a file list rather than `src/`.
      expect(permanenceHits('This action cannot be undone.')).not.toBe('');
    });
  });
});
