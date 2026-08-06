#!/usr/bin/env node
/**
 * scripts/css-bundle-guard.mjs
 *
 * Phase 88 plan 29 (Req 19). The durable replacement for 87.7's one-shot migration tools.
 *
 * WHAT IT GUARDS
 * --------------
 * `src/app/globals.css` opens with `@import 'tailwindcss' source(none)` and then names three
 * explicit `@source` globs plus two `@source not` exclusions. That arrangement is load-bearing
 * and silently reversible:
 *
 *   - deleting `source(none)` re-enables v4's automatic WHOLE-REPO source detection (the
 *     `@source` lines are purely additive, so the diff shows nothing suspicious), and
 *   - deleting `@source not '../lib/**\/*.test.*'` re-admits test-file class literals.
 *
 * Either one re-ships fixture CSS into the production bundle. Both were negative-control-proven
 * live during 87.7's review, and NOTHING has consumed that proof since:
 * `.planning/deferred/phase-88.md` § "Durable CSS-bundle guard" records the tools as "wired into
 * nothing", and says the migration-time scripts cannot serve as the gate because their baseline
 * is v3 and Phase 88 deliberately changes the design system.
 *
 * WHY IT ASSERTS IN BOTH DIRECTIONS
 * ---------------------------------
 * Direction A alone (the sentinel is absent) is satisfied by a build that emits NOTHING AT ALL —
 * an empty bundle has no fixture CSS in it either. That is the "gate that cannot red" failure
 * this phase recorded fourteen times, and it would be especially cruel here: a build that stops
 * emitting utilities is a totally unstyled site, i.e. the loudest possible defect, waved through
 * by its own guard. Direction B is what makes direction A mean something.
 *
 * WHY NOT `tw4-css-diff.mjs`
 * --------------------------
 * Its own header says it: *"This is a REVIEW TOOL, not a gate: it always exits 0 and the human
 * reading it is the gate."* It is still the right tool for reading a diff; it is structurally
 * incapable of failing a build. This script exits non-zero.
 *
 * USAGE
 *   node scripts/css-bundle-guard.mjs                  # assert (this is the CI gate)
 *   node scripts/css-bundle-guard.mjs --write-baseline # refresh scripts/baselines/post-88.css
 *
 * Run it AFTER `next build`; it reads `.next/static/css/*.css`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = path.join(ROOT, '.next', 'static', 'css');
const BASELINE = path.join(ROOT, 'scripts', 'baselines', 'post-88.css');

/**
 * DIRECTION A — the fixture-only sentinel.
 *
 * The literal lives in `src/lib/ci-grep-gate.fixture.test.ts`, which is covered by
 * `@source not '../lib/**\/*.test.{js,ts,jsx,tsx}'`. That file is the deliberate choice: it is
 * inside a directory the `@source` globs DO name (`../lib/**`), so the exclusion is the only
 * thing keeping it out. A sentinel planted somewhere never scanned in the first place would
 * prove nothing — the gate would pass with every exclusion deleted.
 *
 * `mt-[88291px]` is an arbitrary-value utility, so Tailwind generates a real rule for it the
 * instant the file is scanned. It cannot collide with anything a designer would write.
 */
const SENTINEL = 'mt-\\[88291px\\]';
const SENTINEL_SOURCE = 'src/lib/ci-grep-gate.fixture.test.ts';

/**
 * DIRECTION B — utilities that MUST be emitted, one per SOURCE ORIGIN.
 *
 * The origins matter more than the count, and this was corrected after being probed rather
 * than reasoned about. The first draft listed four utilities picked for variety; deleting the
 * `@source './**'` (app) glob and rebuilding reddened only ONE of them, because the other three
 * are also reachable from `../components/**` or from `globals.css` itself. A gate that reds on
 * 1-of-4 still reds, but it cannot tell you WHICH glob broke, and a list weighted differently
 * could have gone green on a real regression.
 *
 * So each entry is pinned to the glob that is the ONLY thing keeping it in the bundle:
 *
 *   `bg-status-error-subtle`  `@source './**'`            — used only under `src/app`
 *   `border-input`            `@source '../components/**'` — used only under `src/components`
 *   `btn`                     `globals.css` itself         — a component class, not a generated
 *                                                            utility, so it survives any
 *                                                            `@source` change and only vanishes
 *                                                            if the stylesheet stops compiling
 *   `text-sm`                 stock Tailwind, used everywhere — the broad backstop
 *
 * `../lib/**` deliberately has no entry: its whole non-test surface is data and helpers, so
 * there is no utility it uniquely sources. Saying so is better than pinning a class that
 * happens to appear there today and silently stops.
 */
const REQUIRED = [
  'bg-status-error-subtle',
  'border-input',
  'btn',
  'text-sm',
];

function chunkFiles() {
  if (!fs.existsSync(CSS_DIR)) {
    console.error(
      `::error::css-bundle-guard: ${path.relative(ROOT, CSS_DIR)} does not exist. Run \`next build\` first.`,
    );
    process.exit(1);
  }
  // Sorted, per DI-87.7-22's standing rule (all chunks concatenated, sorted) — so the
  // concatenation is deterministic and a baseline diff reflects CSS changes, not chunk order.
  const files = fs
    .readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css'))
    .sort();
  if (files.length === 0) {
    console.error('::error::css-bundle-guard: no .css chunks were emitted at all.');
    process.exit(1);
  }
  return files.map((f) => path.join(CSS_DIR, f));
}

const files = chunkFiles();
const css = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

if (process.argv.includes('--write-baseline')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, css);
  console.log(
    `css-bundle-guard: baseline written to ${path.relative(ROOT, BASELINE)} ` +
      `(${files.length} chunk(s), ${css.length} bytes).`,
  );
  process.exit(0);
}

const failures = [];

// ---- Direction A: fixture CSS must NOT ship -------------------------------------------
if (css.includes(SENTINEL)) {
  failures.push(
    `DIRECTION A FAILED — the fixture-only sentinel \`${SENTINEL}\` (declared in ` +
      `${SENTINEL_SOURCE}) is in the shipped bundle. Test-file class literals are being ` +
      `scanned. Check that \`src/app/globals.css\` still has BOTH \`source(none)\` on its ` +
      `\`@import 'tailwindcss'\` line AND the \`@source not\` exclusions — deleting either ` +
      `re-widens the bundle with no build error.`,
  );
}

// ---- Direction B: real utilities MUST ship --------------------------------------------
// 88-CODE-REVIEW MED#4: rule-boundary-aware match, not a bare substring. `css.includes('.btn')`
// was satisfied by `.btn-primary`/`.btn-compact` even with the `.btn` rule itself deleted —
// the lookalike-token defect class (DEF-88-28-01) reintroduced in the replacement tool. A
// selector token ends at `{ , : . [ >` + whitespace or a pseudo (`:hover`); `-` continuing
// the name must NOT match. Minified output has no spaces, so the char class is the boundary.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const missing = REQUIRED.filter(
  (u) => !new RegExp(`\\.${escapeRegExp(u)}[,{:.\\s[>)~+]`).test(css),
);
if (missing.length > 0) {
  failures.push(
    `DIRECTION B FAILED — the build emitted no rule for: ${missing.join(', ')}. Either the ` +
      `\`@source\` globs no longer reach the app, or these classes are genuinely gone. A ` +
      `one-sided guard would have passed this: an EMPTY bundle satisfies direction A.`,
  );
}

if (failures.length > 0) {
  for (const f of failures) console.error(`::error::css-bundle-guard: ${f}`);
  process.exit(1);
}

console.log(
  `BUNDLE-GUARD-OK — ${files.length} chunk(s), ${css.length} bytes; sentinel absent, ` +
    `${REQUIRED.length}/${REQUIRED.length} required utilities present.`,
);
