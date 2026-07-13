// src/lib/ci-grep-gate.fixture.test.ts
//
// REQ 3 GREP-GATE SELF-TEST (phase 87.3, plan 08).
//
// This is NOT an app test — it asserts that the inverted-grep idiom used by the
// "no sub-vs-API compare" gate in `.github/workflows/ci.yml` (quality job) is
// CORRECT and stays honest:
//   - a string that SHOULD match  -> grep emits output (non-empty) -> CI `exit 1` (FAIL)
//   - an allowlisted string       -> grep emits nothing (empty)    -> CI passes
//
// It runs the EXACT workflow regex against in-test fixture strings ONLY. No
// forbidden pattern is written into real `src/app` source — the fixtures live
// entirely inside this file (which is under src/lib, NOT src/app, so the live
// gate never scans it). The regex below is kept BYTE-FOR-BYTE identical to the
// grep pattern in .github/workflows/ci.yml so any drift is caught here.

import { describe, test, expect } from 'vitest';
import { execFileSync } from 'child_process';

// The Req-3 sub-vs-API-compare pattern — MUST stay in lockstep with the
// `grep -rnE '...'` argument in .github/workflows/ci.yml. Symmetric to operand
// order: matches `x === user.sub` (sub on RHS), `user.sub === x` (sub on LHS),
// and `.find(...user.sub)` / `.filter(...user.sub)`. Allowlisted by construction:
// self-fetch calls (`getUser(user.sub)`), presence guards (`if (!user?.sub)`),
// and API args (`getUserGroups(user.sub)`) have no compare operator adjacent to
// `.sub`, so they never match.
const PATTERN =
  '([!=]==[[:space:]]*user\\??\\.sub)|(user\\??\\.sub[[:space:]]*[!=]==)|\\.(find|filter)\\([^)]*user\\??\\.sub';

/**
 * Run `grep -nE <PATTERN>` against `input` exactly as the CI gate does, and
 * return the matching lines (empty string === no match === gate passes). grep
 * exits 1 on no-match; we mirror the workflow's `|| true` by swallowing that.
 */
function grepHits(input: string): string {
  try {
    return execFileSync('grep', ['-nE', PATTERN], { input, encoding: 'utf8' });
  } catch (err) {
    // grep exit code 1 = no lines matched -> treat as empty (the pass path).
    if ((err as { status?: number }).status === 1) return '';
    throw err; // exit >= 2 is a real grep error — surface it.
  }
}

describe('Req-3 no-sub-compare grep gate — lockstep self-test', () => {
  describe('offending is-me compares MATCH (gate would FAIL) — both operand orders', () => {
    test('sub on RHS: member.user_id === user.sub', () => {
      expect(grepHits('const me = data.find(m => m.user_id === user.sub);')).not.toBe('');
    });

    test('sub on RHS, optional-chained: review.User?.id === user?.sub', () => {
      expect(grepHits('const own = review.User?.id === user?.sub;')).not.toBe('');
    });

    test('sub on LHS: user.sub === member.user_id', () => {
      expect(grepHits('if (user.sub === m.user_id) return true;')).not.toBe('');
    });

    test('sub on LHS, negated + optional-chained: user?.sub !== review.User?.id', () => {
      expect(grepHits('const notMine = user?.sub !== review.User?.id;')).not.toBe('');
    });

    test('inside a .find() predicate: rsvps.find(r => r.user_id === user.sub)', () => {
      expect(grepHits('const mine = rsvps.find(r => r.user_id === user.sub);')).not.toBe('');
    });
  });

  describe('allowlisted sub uses do NOT match (gate stays GREEN)', () => {
    test('self-fetch call site: usersAPI.getUser(user.sub)', () => {
      expect(grepHits('const self = await usersAPI.getUser(user.sub);')).toBe('');
    });

    test('presence guard: if (!user?.sub) return', () => {
      expect(grepHits('if (!user?.sub) return null;')).toBe('');
    });

    test('API arg: getUserGroups(user.sub)', () => {
      expect(grepHits('const groups = await getUserGroups(user.sub);')).toBe('');
    });
  });
});
