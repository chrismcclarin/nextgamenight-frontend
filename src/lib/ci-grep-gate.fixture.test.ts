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
// LOCKSTEP BY PARSING, not by copy: both the match pattern and the comment
// filter are extracted from .github/workflows/ci.yml at test time, so any edit
// to the gate is exercised here automatically — drift is structurally
// impossible (the old byte-for-byte duplicate could drift silently).

import { describe, test, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CI_YML = readFileSync(
  resolve(__dirname, '../../.github/workflows/ci.yml'),
  'utf8',
);

// The gate line has the shape:
//   HITS=$(grep -rnE '<PATTERN>' src/app | grep -vE '<FILTER>' || true)
const GATE_LINE = CI_YML.split('\n').find((l) => l.includes('HITS=$(grep -rnE'));
if (!GATE_LINE) throw new Error('ci.yml no-sub-compare gate line not found — was the gate renamed/removed?');

const PATTERN_MATCH = GATE_LINE.match(/grep -rnE '([^']+)' src\/app/);
const FILTER_MATCH = GATE_LINE.match(/grep -vE '([^']+)'/);
if (!PATTERN_MATCH || !FILTER_MATCH) {
  throw new Error('ci.yml gate line did not parse into a pattern + comment filter — keep the HITS=$(grep -rnE ... | grep -vE ...) shape.');
}
const PATTERN = PATTERN_MATCH[1];
const FILTER = FILTER_MATCH[1];

/**
 * Run the gate's full pipeline against `input` exactly as CI does: `grep -nE
 * <PATTERN>` (so hits carry the `line:` prefix the filter anchors on, matching
 * `grep -rn`'s `path:line:` shape), then `grep -vE <FILTER>`. Returns the
 * surviving lines (empty string === gate passes). grep exits 1 on no-match; we
 * mirror the workflow's `|| true` by swallowing that.
 */
function gateHits(input: string): string {
  const run = (args: string[], stdin: string): string => {
    try {
      return execFileSync('grep', args, { input: stdin, encoding: 'utf8' });
    } catch (err) {
      // grep exit code 1 = no lines matched -> empty (the pass path).
      if ((err as { status?: number }).status === 1) return '';
      throw err; // exit >= 2 is a real grep error — surface it.
    }
  };
  // Prefix a fake `path:line:` so the anchored comment filter sees the same
  // shape it sees in CI (grep -rn output).
  const prefixed = input
    .split('\n')
    .map((l, i) => `src/app/fixture.js:${i + 1}:${l}`)
    .join('\n');
  const hits = run(['-nE', PATTERN], input);
  if (hits === '') return '';
  // Re-run against the prefixed form to apply the filter exactly as CI does.
  const prefixedHits = run(['-E', PATTERN], prefixed);
  return run(['-vE', FILTER], prefixedHits);
}

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
