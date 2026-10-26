// @vitest-environment node
// Reason: it spawns a node CLI and renders nothing, so it needs no DOM.
//
// Phase 88.6.2-07 (SPEC R3 Target a, as amended A19) — the anchor-cite rule on EVERY pull request.
// A source cite in the anchor form names a file and a double-quoted snippet in parentheses, and the
// snippet must occur exactly once in that file. The checker that enforces it is the CLI
// scripts/anchor-cite-check.mjs (plan 03); this file only spawns it, twice: its built-in self-test
// first, so a broken checker never vouches for the tree, then the real walk of src and e2e.
//
// A red here names the citing file and line in the PR log (each VIOLATION line the checker prints).
// To fix it, make the snippet occur exactly once in its target: quote a longer, unique stretch, or
// re-point the cite at the file that really holds the text.
//
// This file holds no cite of either form, so neither the checker nor the line-cite ratchet counts it.
//
// DECISION Phase 88.6.2-07 (V2-a): a vitest wrapper that SPAWNS the checker CLI, chosen OVER importing
// its functions (plan 03's checker is a CLI, never imported as a library) and OVER a second
// unconditional quality step (a deleted step leaves quality green, per ruling 5 of the 88-32 decision
// on the drift-gate-registry job, while this file is a gates row with a floor in
// scripts/drift-gate-registry.manifest.mjs, so deleting it reds a REQUIRED check). Owner ruling 2026-10-23, plan review round 1, owner-items V2-a: permanent. The
// phase-branch proofs step still runs the same two commands; the duplication is deliberate: the step
// is phase-only, this file is not. no-retry-bump stays phase-only on purpose: it has no escape hatch
// and would red a legitimate retries change, including a lowering.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CHECKER = fileURLToPath(new URL('../../scripts/anchor-cite-check.mjs', import.meta.url));

function runChecker(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: FE_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const err = r.error ? `\nspawn error: ${r.error.message}` : '';
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${err}` };
}

describe('anchor cites resolve exactly once (Phase 88.6.2, SPEC R3 Target a, amended A19)', () => {
  it('self-test: every built-in case passes before the tree is judged', () => {
    const { status, out } = runChecker('--self-test');
    expect(out, out).toMatch(/^self-test: PASS (\d+) of \1$/m);
    expect(out, out).not.toMatch(/FAIL/);
    expect(status, out).toBe(0);
  }, 60_000);

  it('tree: every anchor cite under src and e2e resolves to exactly one occurrence', () => {
    const { status, out } = runChecker();
    const violations = out.split('\n').filter((l) => l.startsWith('VIOLATION '));
    expect(violations, `anchor-cite violations:\n${violations.join('\n')}\n\n${out}`).toEqual([]);
    expect(out, out).toMatch(/^RESULT: PASS$/m);
    expect(status, out).toBe(0);
  }, 60_000);
});
