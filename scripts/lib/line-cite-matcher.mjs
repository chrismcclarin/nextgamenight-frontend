/**
 * LINE-CITE MATCHER — Phase 88.6.2, plan 04 (SPEC R3 Target b, CONTEXT D-01..D-06, SPEC A2, A7).
 *
 * One module for the line-cite census (scripts/line-cite-census.mjs) and the ratchet test
 * (src/app/citeRatchet.test.ts). SPEC A2 binds them to ONE matcher: neither re-implements the
 * regex, the walker, the comparison, the digest or the self-test cases, so the script and the
 * test cannot disagree about what a cite is or which files are read.
 *
 * WHAT IS COUNTED
 * ---------------
 * A line cite is a run of path characters, a dot, one CITE_EXTS extension, a colon and digits:
 * the shape name.ext:N (no real digits are written here, so this docblock is not an example of
 * what it describes). A range name.ext:N-M counts once. Two cites on one line count twice.
 *
 * NAMED BLIND SPOT (CONTEXT D-05): a bare follow-on such as ":N" or "and :N" with no path in
 * front of it is NOT counted. It is not a cite by this grammar, and a regex that counted every
 * colon-number would count clock times and host:port pairs. Reviewers read for it; the
 * self-test case match-bare-followon pins that it stays uncounted.
 *
 * CITE_RE is GLOBAL. Callers use text.match(CITE_RE) or text.matchAll(CITE_RE), never .test()
 * or .exec(), whose shared lastIndex would skip matches on the next call.
 * (String.prototype.match resets lastIndex on a global regex, so countCites is reentrant.)
 *
 * DECISION Phase 88.6.2-04 (D-03): an own walker over src and e2e, chosen OVER the shared
 * sourceFiles helper at src/test-utils/sourceScan.ts ("DECISION Phase 88.6-44"). That walker
 * skips test files, the test-utils directory and CSS, which together hold most cites (916 of
 * the 1,669 non-md cites sit in test and spec files, measured 2026-10-24 on the phase branch,
 * equal to the planning count at FE 995023d); a ratchet blind to them would let the bulk of the
 * debt grow unseen. And a .ts module that leans on __dirname cannot be imported by a plain-node
 * .mjs on CI's Node 20 at all. Changing the walk set is a decision, not a cleanup.
 *
 * DECISION Phase 88.6.2-04 (A7): md is in CITE_EXTS, chosen OVER leaving the 104 cites of the
 * form name.md:N (54 living-source files at planning) to grow unseen. CONTEXT D-03's ".md out
 * of scope by construction" is about walked FILES (WALK_EXTS has no md, and no .md file is
 * tracked under src or e2e), not about cite TARGETS (SPEC A7, RESEARCH PC-10).
 *
 * DECISION Phase 88.6.2-04 (digest): the baseline carries a sha256 of its counts, which the
 * ratchet test checks, chosen OVER a do-not-edit note alone. A hand edit, raise or lower, reds
 * until the census rewrites the file. Tamper-evident, not tamper-proof: like every house gate
 * it guards against forgetting, not against intent.
 *
 * DECISION Phase 88.6.2-04 (lib): this file lives in a scripts/lib subdirectory, chosen OVER a
 * flat scripts file. The flat rule at scripts/tw4-hazard-grep.sh ("DECISION Phase 87.7 (R4):
 * this gate lives at flat") governs runnable gates; this module is imported by a script and a
 * test and is never run on its own, and scripts/baselines is already a subdirectory.
 *
 * Imports node builtins only (fs, path, os, crypto). No work happens at import time.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Cite-target extensions (A7 adds md). */
export const CITE_EXTS = Object.freeze(['js', 'jsx', 'ts', 'tsx', 'css', 'mjs', 'cjs', 'md']);

/** The census regex. GLOBAL: use text.match / text.matchAll only (see the module docblock). */
export const CITE_RE = new RegExp(`[A-Za-z0-9_.-]+\\.(?:${CITE_EXTS.join('|')}):[0-9]+`, 'g');

/** Directories walked, relative to the FE root. A missing one throws. */
export const WALK_DIRS = Object.freeze(['src', 'e2e']);

/** Extensions of the walked FILES (no .md: A7). */
export const WALK_EXTS = Object.freeze(['.js', '.jsx', '.ts', '.tsx', '.css', '.mjs', '.cjs']);

/** The note written into the baseline file. */
export const BASELINE_NOTE =
  'Written only by node scripts/line-cite-census.mjs --write-baseline, which only lowers counts; a hand edit fails src/app/citeRatchet.test.ts.';

/**
 * The number of line cites in a text.
 * @param {string} text
 * @returns {number}
 */
export function countCites(text) {
  return (text.match(CITE_RE) || []).length;
}

/** @param {string} a @param {string} b @returns {number} */
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sorted, FE-root-relative, forward-slash paths of the regular files under WALK_DIRS whose
 * extension is in WALK_EXTS. Skips node_modules, every entry starting with a dot, and symlinks.
 * @param {string} root the FE root
 * @returns {string[]}
 */
export function walkCiteFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} abs @param {string} rel */
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile() && WALK_EXTS.includes(path.extname(entry.name))) out.push(childRel);
    }
  };
  for (const dir of WALK_DIRS) {
    const abs = path.join(root, dir);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      throw new Error(`walk dir missing: ${dir} (under ${root})`);
    }
    if (!st.isDirectory()) throw new Error(`walk dir is not a directory: ${dir} (under ${root})`);
    walk(abs, dir);
  }
  return out.sort(byCodeUnit);
}

/**
 * Walk and count. `counts` keeps only paths whose count is above zero, keys sorted.
 * @param {string} root the FE root
 * @returns {{ walked: string[], counts: Record<string, number>, total: number }}
 */
export function measureTree(root) {
  const walked = walkCiteFiles(root);
  /** @type {Record<string, number>} */
  const counts = {};
  let total = 0;
  for (const rel of walked) {
    const n = countCites(fs.readFileSync(path.join(root, rel), 'utf8'));
    if (n > 0) {
      counts[rel] = n;
      total += n;
    }
  }
  return { walked, counts, total };
}

/**
 * @param {Record<string, number>} counts
 * @param {string} p
 * @returns {number}
 */
function countOf(counts, p) {
  return Object.prototype.hasOwnProperty.call(counts, p) ? counts[p] : 0;
}

/**
 * Every path whose measured count exceeds ITS OWN baseline (absent = 0), sorted by path.
 * Per file, never a total: a rise in one file is reported even when another falls by more.
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} baselineCounts
 * @returns {{ path: string, baseline: number, measured: number }[]}
 */
export function findRises(counts, baselineCounts) {
  return Object.keys(counts)
    .sort(byCodeUnit)
    .filter((p) => countOf(counts, p) > countOf(baselineCounts, p))
    .map((p) => ({ path: p, baseline: countOf(baselineCounts, p), measured: countOf(counts, p) }));
}

/**
 * @param {Record<string, number>} counts
 * @returns {Record<string, number>}
 */
function sortedCounts(counts) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of Object.keys(counts).sort(byCodeUnit)) out[k] = counts[k];
  return out;
}

/**
 * sha256 over the JSON of the sorted [path, count] pairs, key order independent.
 * @param {Record<string, number>} counts
 * @returns {string}
 */
export function digestCounts(counts) {
  const pairs = Object.keys(counts)
    .sort(byCodeUnit)
    .map((k) => [k, counts[k]]);
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex')}`;
}

/**
 * The baseline file's text: schema, note, digest, counts (keys sorted), 2-space JSON, trailing newline.
 * @param {Record<string, number>} counts
 * @returns {string}
 */
export function serializeBaseline(counts) {
  const sorted = sortedCounts(counts);
  const doc = { schema: 1, note: BASELINE_NOTE, digest: digestCounts(sorted), counts: sorted };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * The lower-only write plan (CONTEXT D-02, SPEC edge rename row). Returns `ok` (no REFUSED
 * line), `next` (the counts a write would record) and `lines` (sorted). Rules:
 *   - a baseline path measured lower → LOWERED (REMOVED at 0); measured equal → kept, no line;
 *   - a baseline path measured higher → REFUSED raise, unless `allow` names it → RAISE ALLOWED;
 *   - a new path (no baseline entry, measured > 0) pairs with a rename candidate, a baseline path
 *     that is no longer a WALKED file (not merely one whose count fell to 0, so moving cites out
 *     of a file that still exists into a new file is not a rename). Pairing is greedy: new paths
 *     by count descending then path, candidates by count descending then path, and a candidate
 *     pairs only when its baseline is >= the new count → RENAMED. Unpaired → REFUSED new path,
 *     unless allowed → RAISE ALLOWED;
 *   - a vanished baseline path not consumed by a pair → REMOVED;
 *   - an `allow` entry that names neither a raise nor an unpaired new path → REFUSED stale allow.
 * @param {{ walked: string[], counts: Record<string, number> }} measured
 * @param {Record<string, number>} baselineCounts
 * @param {string[]} allow
 * @returns {{ ok: boolean, next: Record<string, number>, lines: string[] }}
 */
export function planBaselineWrite({ walked, counts }, baselineCounts, allow) {
  const walkedSet = new Set(walked);
  const allowSet = new Set(allow);
  /** @type {Set<string>} allow entries that were used for a real raise */
  const allowUsed = new Set();
  /** @type {Record<string, number>} */
  const next = {};
  /** @type {string[]} */
  const lines = [];
  /** @param {string} p @param {number} b @param {number} m @param {string} reason */
  const refuse = (p, b, m, reason) => lines.push(`REFUSED ${p} ${b} -> ${m}: ${reason}`);
  /** @param {string} p @param {number} b @param {number} m */
  const allowRaise = (p, b, m) => {
    allowUsed.add(p);
    next[p] = m;
    lines.push(`!!! RAISE ALLOWED (--allow): ${p} ${b} -> ${m} !!!`);
  };

  /** @type {string[]} */
  const candidates = [];
  for (const p of Object.keys(baselineCounts).sort(byCodeUnit)) {
    const b = baselineCounts[p];
    if (!walkedSet.has(p)) {
      candidates.push(p);
      continue;
    }
    const m = countOf(counts, p);
    if (m === b) next[p] = b;
    else if (m === 0) lines.push(`REMOVED ${p} ${b} -> 0`);
    else if (m < b) {
      next[p] = m;
      lines.push(`LOWERED ${p} ${b} -> ${m}`);
    } else if (allowSet.has(p)) allowRaise(p, b, m);
    else {
      next[p] = b;
      refuse(p, b, m, 'raise (only --allow <path> raises a count)');
    }
  }

  /** @param {Record<string, number>} src @returns {(x: string, y: string) => number} */
  const byCountDescThenPath = (src) => (x, y) => src[y] - src[x] || byCodeUnit(x, y);
  const newPaths = Object.keys(counts)
    .filter((p) => !Object.prototype.hasOwnProperty.call(baselineCounts, p) && counts[p] > 0)
    .sort(byCountDescThenPath(counts));
  const freeCandidates = candidates.slice().sort(byCountDescThenPath(baselineCounts));
  for (const p of newPaths) {
    const m = counts[p];
    const i = freeCandidates.findIndex((c) => baselineCounts[c] >= m);
    if (i >= 0) {
      const [old] = freeCandidates.splice(i, 1);
      next[p] = m;
      lines.push(`RENAMED ${old} -> ${p} ${baselineCounts[old]} -> ${m}`);
    } else if (allowSet.has(p)) allowRaise(p, 0, m);
    else refuse(p, 0, m, 'new path, no rename pair');
  }
  for (const old of freeCandidates) lines.push(`REMOVED ${old} ${baselineCounts[old]} -> 0`);

  for (const p of [...allowSet].sort(byCodeUnit)) {
    if (!allowUsed.has(p)) refuse(p, countOf(baselineCounts, p), countOf(counts, p), '--allow names no raise');
  }

  lines.sort(byCodeUnit);
  return { ok: !lines.some((l) => l.startsWith('REFUSED ')), next: sortedCounts(next), lines };
}

/**
 * Parse and shape-check a baseline. Throws unless schema is 1, digest is a string and counts
 * maps strings to positive integers. Does NOT check the digest (the test does, by name).
 * @param {string} text
 * @returns {{ schema: number, note: string, digest: string, counts: Record<string, number> }}
 */
export function parseBaseline(text) {
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('baseline is not a JSON object');
  if (doc.schema !== 1) throw new Error(`baseline schema is ${JSON.stringify(doc.schema)}, expected 1`);
  if (typeof doc.digest !== 'string') throw new Error('baseline digest is not a string');
  const counts = doc.counts;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new Error('baseline counts is not an object');
  for (const [k, v] of Object.entries(counts)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new Error(`baseline count for ${k} is ${JSON.stringify(v)}, expected a positive integer`);
    }
  }
  return { schema: doc.schema, note: String(doc.note ?? ''), digest: doc.digest, counts };
}

// ---- self-test ------------------------------------------------------------------------------
// Each case returns true, or a detail string. A throw is a FAIL carrying its message. The demo
// cites are built by concatenation so this file's own text stays free of the counted shape.

const DOT = '.';
/** @param {string} name @param {string} ext @param {string} line */
const cite = (name, ext, line) => name + DOT + ext + ':' + line;

/**
 * @param {string} text
 * @param {number} want
 * @returns {true | string}
 */
function expectCount(text, want) {
  const got = countCites(text);
  return got === want ? true : `countCites(${JSON.stringify(text)}) = ${got}, expected ${want}`;
}

/**
 * @param {unknown} got
 * @param {unknown} want
 * @param {string} label
 * @returns {true | string}
 */
function expectJson(got, want, label) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return g === w ? true : `${label}: got ${g}, expected ${w}`;
}

/** @type {{ id: string, run: () => true | string }[]} */
export const SELF_TEST_CASES = [
  { id: 'match-cite', run: () => expectCount(`// see ${cite('Foo', 'tsx', '12')} for the rule`, 1) },
  { id: 'match-range-once', run: () => expectCount(`// ${cite('Foo', 'ts', '12')}-18`, 1) },
  { id: 'match-bare-followon', run: () => expectCount('// and the follow-on at :131 here', 0) },
  { id: 'match-md', run: () => expectCount(`// ${cite('Foo', 'md', '4')}`, 1) },
  { id: 'match-unlisted-ext', run: () => expectCount(`// ${cite('Foo', 'mts', '3')}`, 0) },
  { id: 'match-no-path', run: () => expectCount('// at 10:30, on localhost:3000', 0) },
  {
    id: 'match-two-on-a-line',
    run: () => expectCount(`// ${cite('Foo', 'js', '1')} and ${cite('Bar', 'css', '2')}`, 2),
  },
  {
    id: 'walk-scope',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-cite-selftest-'));
      try {
        /** @param {string} rel @param {string} body */
        const put = (rel, body) => {
          const abs = path.join(tmp, rel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, body);
        };
        // A missing walk dir throws (fails closed, T-88.6.2-19).
        put('src/a.ts', `// ${cite('Foo', 'tsx', '1')}\n`);
        let threw = false;
        try {
          walkCiteFiles(tmp);
        } catch {
          threw = true;
        }
        if (!threw) return 'a root without e2e did not throw';
        put('e2e/b.spec.ts', `// ${cite('Bar', 'js', '2')}\n`);
        put('src/c.ts', `// ${cite('Foo', 'md', '4')}\n`);
        put('src/z.css', '/* no cite here */\n');
        put('src/node_modules/d.ts', `// ${cite('Foo', 'ts', '3')}\n`);
        put('src/.hidden/e.ts', `// ${cite('Foo', 'ts', '4')}\n`);
        put('src/README.md', `${cite('Foo', 'ts', '5')}\n`);
        put('outside/f.ts', `// ${cite('Foo', 'ts', '6')}\n`);
        let linked = true;
        try {
          fs.symlinkSync(path.join(tmp, 'outside', 'f.ts'), path.join(tmp, 'src', 'link.ts'));
        } catch {
          linked = false; // a platform without symlinks: the rest of the case still runs
        }
        const m = measureTree(tmp);
        const walkedOk = expectJson(m.walked, ['e2e/b.spec.ts', 'src/a.ts', 'src/c.ts', 'src/z.css'], 'walked');
        if (walkedOk !== true) return walkedOk + (linked ? '' : ' (no symlink made)');
        const countsOk = expectJson(m.counts, { 'e2e/b.spec.ts': 1, 'src/a.ts': 1, 'src/c.ts': 1 }, 'counts');
        if (countsOk !== true) return countsOk;
        return m.total === 3 ? true : `total ${m.total}, expected 3`;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    id: 'digest-stable',
    run: () => {
      const a = digestCounts({ 'src/a.ts': 2, 'e2e/b.ts': 1 });
      const b = digestCounts({ 'e2e/b.ts': 1, 'src/a.ts': 2 });
      const c = digestCounts({ 'e2e/b.ts': 1, 'src/a.ts': 3 });
      if (!a.startsWith('sha256:')) return `digest ${a} lacks the sha256: prefix`;
      if (a !== b) return 'digest depends on key order';
      return a !== c ? true : 'digest did not change when a count changed';
    },
  },
  // ---- the lower-only write guard (D-02): planBaselineWrite({ walked, counts }, baseline, allow)
  {
    id: 'guard-lower',
    run: () => expectPlan(planBaselineWrite({ walked: ['a'], counts: { a: 2 } }, { a: 3 }, []), true, { a: 2 }, ['LOWERED a 3 -> 2']),
  },
  {
    id: 'guard-equal',
    run: () => expectPlan(planBaselineWrite({ walked: ['a'], counts: { a: 3 } }, { a: 3 }, []), true, { a: 3 }, []),
  },
  {
    id: 'guard-zero-removed',
    run: () => expectPlan(planBaselineWrite({ walked: ['a'], counts: {} }, { a: 3 }, []), true, {}, ['REMOVED a 3 -> 0']),
  },
  {
    id: 'guard-raise-refused',
    run: () => expectRefused(planBaselineWrite({ walked: ['a'], counts: { a: 4 } }, { a: 3 }, []), 'REFUSED a 3 -> 4: raise'),
  },
  {
    id: 'guard-raise-allowed',
    run: () =>
      expectPlan(planBaselineWrite({ walked: ['a'], counts: { a: 4 } }, { a: 3 }, ['a']), true, { a: 4 }, [
        '!!! RAISE ALLOWED (--allow): a 3 -> 4 !!!',
      ]),
  },
  {
    id: 'guard-new-refused',
    run: () =>
      expectRefused(
        planBaselineWrite({ walked: ['a', 'b'], counts: { a: 3, b: 1 } }, { a: 3 }, []),
        'REFUSED b 0 -> 1: new path, no rename pair',
      ),
  },
  {
    id: 'guard-rename-pair',
    run: () => expectPlan(planBaselineWrite({ walked: ['b'], counts: { b: 3 } }, { a: 3 }, []), true, { b: 3 }, ['RENAMED a -> b 3 -> 3']),
  },
  {
    id: 'guard-rename-higher-refused',
    run: () =>
      expectRefused(planBaselineWrite({ walked: ['b'], counts: { b: 4 } }, { a: 3 }, []), 'REFUSED b 0 -> 4: new path, no rename pair'),
  },
  {
    id: 'guard-two-new-one-gone',
    run: () => {
      const plan = planBaselineWrite({ walked: ['b', 'c'], counts: { b: 3, c: 1 } }, { a: 3 }, []);
      const refused = expectRefused(plan, 'REFUSED c 0 -> 1: new path, no rename pair');
      if (refused !== true) return refused;
      return plan.lines.includes('RENAMED a -> b 3 -> 3') ? true : `b did not pair with a: ${JSON.stringify(plan.lines)}`;
    },
  },
  {
    id: 'guard-allow-stale-refused',
    run: () =>
      expectRefused(planBaselineWrite({ walked: ['a'], counts: { a: 2 } }, { a: 3 }, ['a']), 'REFUSED a 3 -> 2: --allow names no raise'),
  },
  {
    id: 'guard-new-allowed',
    run: () =>
      expectPlan(planBaselineWrite({ walked: ['a', 'b'], counts: { a: 3, b: 1 } }, { a: 3 }, ['b']), true, { a: 3, b: 1 }, [
        '!!! RAISE ALLOWED (--allow): b 0 -> 1 !!!',
      ]),
  },
];

/**
 * @param {{ ok: boolean, next: Record<string, number>, lines: string[] }} plan
 * @param {boolean} ok
 * @param {Record<string, number>} next
 * @param {string[]} lines
 * @returns {true | string}
 */
function expectPlan(plan, ok, next, lines) {
  return expectJson({ ok: plan.ok, next: sortedCounts(plan.next), lines: plan.lines }, { ok, next: sortedCounts(next), lines }, 'plan');
}

/**
 * Not ok, nothing to write, and the named REFUSED line present.
 * @param {{ ok: boolean, next: Record<string, number> | null, lines: string[] }} plan
 * @param {string} refusedPrefix
 * @returns {true | string}
 */
function expectRefused(plan, refusedPrefix) {
  if (plan.ok) return `ok is true; lines ${JSON.stringify(plan.lines)}`;
  return plan.lines.some((l) => l.startsWith(refusedPrefix))
    ? true
    : `no line starting ${JSON.stringify(refusedPrefix)} in ${JSON.stringify(plan.lines)}`;
}

/** The declared case count; a run of any other number of cases fails. */
export const SELF_TEST_CASE_COUNT = 20;

/** @returns {{ ran: number, passed: number, failed: string[], lines: string[] }} */
export function runSelfTest() {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const failed = [];
  let passed = 0;
  for (const c of SELF_TEST_CASES) {
    let result;
    try {
      result = c.run();
    } catch (err) {
      result = `threw ${err instanceof Error ? err.message : String(err)}`;
    }
    if (result === true) {
      passed += 1;
      lines.push(`PASS ${c.id}`);
    } else {
      failed.push(`${c.id}: ${result}`);
      lines.push(`FAIL ${c.id}: ${result}`);
    }
  }
  return { ran: SELF_TEST_CASES.length, passed, failed, lines };
}
