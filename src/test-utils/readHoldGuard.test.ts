// @vitest-environment node
//
// Pins e2e/support/readHoldGuard.ts, the runtime half of the read-only network release in
// e2e/support/inFlight.ts: releaseToNetwork calls assertReadMethod on a hold's method before
// anything reaches the network, because a write handed to the network would reach the shared CI
// fixture. The type overload hides releaseToNetwork on a write hold, so no e2e spec ever calls it
// with one; this suite is the only standing proof that the runtime throw still fires (the Phase
// 88.6.2-11 node probe was a one-off scratchpad run; code review C-ML3). Line comments only (CF-9).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertReadMethod } from '../../e2e/support/readHoldGuard';

const REFUSAL = /^releaseToNetwork refused a (\S*) hold: only a GET or HEAD hold may be released to the network/;

describe('readHoldGuard — releaseToNetwork never hands a write to the network (Phase 88.6.2-11, code review C-ML3)', () => {
  it('assertReadMethod throws the releaseToNetwork refusal for every write method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      let caught: unknown = null;
      try {
        assertReadMethod(method);
      } catch (err) {
        caught = err;
      }
      expect(caught, `assertReadMethod('${method}') did not throw`).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message, `the ${method} refusal changed its wording`).toMatch(REFUSAL);
      expect(message.match(REFUSAL)?.[1], 'the refusal must name the refused method').toBe(method);
    }
  });

  it('assertReadMethod lets GET and HEAD through, and nothing else (a lower-case get is not a read)', () => {
    expect(() => assertReadMethod('GET')).not.toThrow();
    expect(() => assertReadMethod('HEAD')).not.toThrow();
    // Playwright reports methods upper-case; anything else is refused rather than guessed at.
    expect(() => assertReadMethod('get')).toThrow(REFUSAL);
    expect(() => assertReadMethod('')).toThrow(REFUSAL);
  });

  it('releaseToNetwork still calls the guard before it continues a held request', () => {
    // The guard only protects what calls it: inFlight.ts must import it and call it on the
    // hold's own method.
    const inFlight = readFileSync(resolve(__dirname, '../../e2e/support/inFlight.ts'), 'utf8');
    expect(inFlight).toContain("import { assertReadMethod } from './readHoldGuard';");
    expect(inFlight, 'releaseToNetwork no longer calls assertReadMethod').toMatch(/assertReadMethod\(\s*[A-Za-z_.]*method/);
  });
});
