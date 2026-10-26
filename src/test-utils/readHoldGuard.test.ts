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

// The releaseToNetwork IMPLEMENTATION (the property whose value is an async arrow, not the
// interface line), up to the next property: its first code statement must be the guard, on a
// code line of its own, and settleAll must come after it (code review C-IN-03).
function guardRunsFirst(inFlight: string): boolean {
  const start = inFlight.search(/releaseToNetwork:\s*async\s*\(/);
  if (start === -1) return false;
  const end = inFlight.indexOf('abortAll:', start);
  const body = inFlight.slice(start, end === -1 ? undefined : end);
  const guard = body.search(/^\s*assertReadMethod\(\s*options\.method\s*\);/m);
  const settle = body.search(/^\s*await settleAll\(/m);
  return guard !== -1 && settle !== -1 && guard < settle;
}

const REFUSAL =/^releaseToNetwork refused a (\S*) hold: only a GET or HEAD hold may be released to the network/;

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
    expect(guardRunsFirst(inFlight), 'releaseToNetwork no longer calls assertReadMethod on a code line before settleAll').toBe(true);
    // Code review C-IN-03: the pin reads the releaseToNetwork implementation only, so each of
    // these mutants of the live file fails it (a whole-file match passed all three).
    const live = '      assertReadMethod(options.method);\n      await settleAll((route) => route.fallback());';
    expect(inFlight.split(live).length - 1, 'the live releaseToNetwork body moved; re-anchor the mutants').toBe(1);
    const mutants = {
      'the call after settleAll': inFlight.replace(live, '      await settleAll((route) => route.fallback());\n      assertReadMethod(options.method);'),
      'the call commented out': inFlight.replace(live, '      // assertReadMethod(options.method);\n      await settleAll((route) => route.fallback());'),
      'the call moved into release': inFlight
        .replace(live, '      await settleAll((route) => route.fallback());')
        .replace('release: (json: unknown, status = 200) => settleAll(', 'release: (json: unknown, status = 200) => assertReadMethod(options.method) ?? settleAll('),
    };
    for (const [name, text] of Object.entries(mutants)) {
      expect(text, `mutant "${name}" did not change the file`).not.toBe(inFlight);
      expect(guardRunsFirst(text), `mutant "${name}" passed the pin`).toBe(false);
    }
  });
});
