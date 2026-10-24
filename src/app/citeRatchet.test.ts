// @vitest-environment node
// Reason: a pure source-TEXT scan; it renders nothing, needs no DOM, and node is materially faster than jsdom for a 478-file walk.
//
// Phase 88.6.2-04 (SPEC R3 Target b) — the line-cite ratchet. No walked file under src or e2e may
// hold more line cites than its own entry in scripts/baselines/line-cites.json, and that file is
// written only by node scripts/line-cite-census.mjs --write-baseline, which only lowers counts.
// The regex, the walker, the comparison, the digest and the self-test cases all live in the one
// shared module, scripts/lib/line-cite-matcher.mjs (SPEC A2); this file re-implements none of them.
//
// A rise fails here naming the file. To fix it, convert the new cite to the anchor form (see the
// CLAUDE.md subsection "Source cites — anchors, never line numbers"). A renamed file shows up as a
// new path: the renaming commit runs --write-baseline, which accepts a true rename pair.
//
// This file holds no string the matcher counts (CONTEXT D-06): every demo cite below is built by
// concatenation, so the file has no baseline entry of its own.
//
// DECISION Phase 88.6.2-04 (D-02): one direction only; never assert measured < baseline; a lower count passes with no baseline edit.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SELF_TEST_CASE_COUNT,
  WALK_DIRS,
  countCites,
  digestCounts,
  findRises,
  measureTree,
  parseBaseline,
  runSelfTest,
} from '../../scripts/lib/line-cite-matcher.mjs';

const FE_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(FE_ROOT, 'scripts', 'baselines', 'line-cites.json');

describe('line-cite ratchet (Phase 88.6.2-04, SPEC R3 Target b)', () => {
  // One walk of the tree and one parse of the baseline for every assertion below. A missing or
  // malformed baseline throws here, which fails the file.
  const measured = measureTree(FE_ROOT);
  const baseline = parseBaseline(fs.readFileSync(BASELINE_PATH, 'utf8'));

  it('no walked file holds more line cites than its baseline', () => {
    const rises = findRises(measured.counts, baseline.counts).map(
      (r) => `${r.path}: baseline ${r.baseline}, measured ${r.measured}`,
    );
    expect(rises).toEqual([]);
  });

  it('is not vacuous: both walk dirs exist, files were walked, cites were counted, the baseline has entries', () => {
    for (const dir of WALK_DIRS) expect(fs.statSync(path.join(FE_ROOT, dir)).isDirectory()).toBe(true);
    expect(measured.walked.length).toBeGreaterThan(0);
    expect(measured.total).toBeGreaterThan(0);
    expect(Object.keys(baseline.counts).length).toBeGreaterThan(0);
  });

  it('the baseline digest matches its counts (a hand edit, up or down, fails here)', () => {
    expect(baseline.schema).toBe(1);
    expect(digestCounts(baseline.counts)).toBe(baseline.digest);
  });

  it('is sensitive per file: an added cite rises, a removed one does not, a new path rises, a fall elsewhere hides nothing', () => {
    const demo = '// see ' + 'Foo' + '.tsx:' + '12';
    expect(countCites(demo)).toBe(1);
    const base = baseline.counts;
    const [first, second] = Object.keys(base);
    const added = { ...base, [first]: base[first] + countCites(demo) };
    expect(findRises(added, base).map((r) => r.path)).toEqual([first]);
    const removed = { ...base, [first]: base[first] - 1 };
    expect(findRises(removed, base)).toEqual([]);
    const fresh = 'src/app/zz-new-path.ts';
    expect(findRises({ ...base, [fresh]: countCites(demo) }, base).map((r) => r.path)).toEqual([fresh]);
    const masked = { ...base, [first]: base[first] + 1, [second]: Math.max(0, base[second] - 5) };
    expect(findRises(masked, base).map((r) => r.path)).toEqual([first]);
  });

  it('the shared matcher passes its own self-test case table', () => {
    const result = runSelfTest();
    expect(result.failed).toEqual([]);
    expect(SELF_TEST_CASE_COUNT).toBeGreaterThan(0);
    expect(result.ran).toBe(SELF_TEST_CASE_COUNT);
  });
});
