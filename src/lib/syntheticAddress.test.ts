// src/lib/syntheticAddress.test.ts
//
// The ONLY thing pinning the BROAD `@auth0` test against a later narrowing to
// `@auth0.local` (DECISION Phase 88.2 NIX-AUTH0). Registered in the ci.yml
// drift-gate registry AND named in the lockstep fixture
// (src/lib/ci-grep-gate.fixture.test.ts) on the owner's 2026-09-04 ruling, for
// the same reason Amendment Z registered colourDistance.test.ts: unregistered,
// this suite is deletable with a fully green build, and with it goes the only
// mechanical guard on a written-but-unenforced decision.
//
// NO `grep`-based gate is added on the helper's implementation, deliberately:
// `'@auth0.local'` CONTAINS `'@auth0'`, so a substring grep is satisfied by the
// narrow form it would be meant to forbid. The bare-suffix case below IS the
// gate — it is the one row a narrow implementation fails.
import { describe, expect, it } from 'vitest';

import { isSyntheticAddress } from './syntheticAddress';

describe('isSyntheticAddress — the broad @auth0 test (DECISION Phase 88.2 NIX-AUTH0)', () => {
  it('is true for the canonical provisioning sentinel', () => {
    expect(isSyntheticAddress('google-oauth2-105551212@auth0.local')).toBe(true);
  });

  it('is true for a sentinel built from a sub containing a pipe', () => {
    expect(isSyntheticAddress('google-oauth2-1|xyz@auth0.local')).toBe(true);
  });

  it('IS TRUE FOR A BARE `@auth0` WITH NO `.local` SUFFIX — the row a narrow implementation fails', () => {
    // THIS is the gate. `'@auth0.local'.includes('@auth0')` is true, so every
    // other row in this file passes against the narrow `.local`-only form the
    // house rule forbids. Only this one discriminates.
    expect(isSyntheticAddress('auth0-6a2984bc@auth0')).toBe(true);
  });

  it('is true for a legacy placeholder shape that is neither bare nor `.local`', () => {
    expect(isSyntheticAddress('someone@auth0.example')).toBe(true);
  });

  it('is true regardless of case — an uppercased sentinel is still a sentinel', () => {
    expect(isSyntheticAddress('GOOGLE-OAUTH2-1@AUTH0.LOCAL')).toBe(true);
  });

  it('is FALSE for a real address (the anti-vacuity half — the guard must not be "always true")', () => {
    expect(isSyntheticAddress('someone@example.com')).toBe(false);
  });

  it('is FALSE for a real address whose local part merely mentions auth0', () => {
    // The test is on the whole value, so this legitimately returns true for a
    // local part carrying `@auth0` — but a plain word cannot, and pinning it
    // stops someone "simplifying" the test to a bare `auth0` substring, which
    // would eat `auth0fan@example.com`.
    expect(isSyntheticAddress('auth0fan@example.com')).toBe(false);
  });

  it('is FALSE for the empty string, null and undefined — those are "no address", not a sentinel', () => {
    // DELIBERATE DIVERGENCE from the backend helper
    // (services/provisioningService.js:138-143), which returns TRUE for an
    // empty/absent value because its callers ask "may I mail this?". The three
    // frontend call sites ask "is this string a sentinel I must not print?" and
    // already handle absence separately (a falsy address renders the same
    // no-address copy without consulting this predicate). Harmonising the two
    // is a decision, not a cleanup — see the docblock.
    expect(isSyntheticAddress('')).toBe(false);
    expect(isSyntheticAddress('   ')).toBe(false);
    expect(isSyntheticAddress(null)).toBe(false);
    expect(isSyntheticAddress(undefined)).toBe(false);
  });
});
