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
//
// Phase 88 plan 29: this file now covers FOUR ci.yml steps, and the two new ones
// are NOT grep gates, so `parseGate` cannot read them. They get their own reader,
// `stepWindow`, keyed by STEP NAME for the same reason the 88.2 note above gives.
// Since Phase 88.6.2-26 the registry's rows are not in ci.yml at all: they are read
// from scripts/drift-gate-registry.manifest.mjs, the same file the required
// drift-gate-registry job's runner reads, and ci.yml is read only to pin that job's lines.
//
// The two new steps exist because 88-29's gate-hygiene pass concluded that ZERO
// new grep gates should ship. All seven drift classes the plan proposed to grep
// were measured against this tree first and every pattern was defective — red on
// a correct tree, blind to the defect, or both. They are armed as source-scan
// tests instead, in the house shape the phase has used since 88-21. That moved
// the gates into vitest and opened a new hole: a test file can be DELETED and
// `npx vitest run` stays green. The registry step closes it, and this file is
// what keeps the registry honest about its own contents.
import { describe, test, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { gates, helperOnly, helpers, notGates } from '../../scripts/drift-gate-registry.manifest.mjs';
import { floors } from '../../scripts/gate-c-floors.manifest.mjs';
import { withoutComments } from '../test-utils/sourceScan';

const CI_YML = readFileSync(
  resolve(__dirname, '../../.github/workflows/ci.yml'),
  'utf8',
);

/**
 * DECISION Phase 88-29 (Req 19): the CSS-bundle guard's NEGATIVE-CONTROL SENTINEL lives here,
 * and this file was chosen deliberately over any other home for it.
 *
 * `src/app/globals.css` scopes Tailwind v4 with `@import 'tailwindcss' source(none)`, three
 * `@source` globs (one of which is `../lib/**`), and two `@source not` exclusions — one of
 * which is `../lib/**\/*.test.{js,ts,jsx,tsx}`, i.e. THIS FILE. So the sentinel sits inside a
 * directory Tailwind is told to scan, kept out of the bundle by the exclusion and nothing else.
 * That is the whole point: `scripts/css-bundle-guard.mjs` asserts it is ABSENT from the built
 * CSS, and deleting either `source(none)` or the exclusion makes it appear. A sentinel planted
 * somewhere never scanned in the first place would stay absent no matter what broke, which is a
 * gate that cannot red.
 *
 * `mt-[88291px]` is an arbitrary-value utility, so v4 emits a real rule for it the moment this
 * file is scanned, and the value cannot collide with anything a designer would write.
 *
 * Deleting this constant, or moving it out of a `src/lib/*.test.*` file, silently disarms
 * direction A of that guard. That is a decision, not a cleanup — the constant is referenced by
 * a lockstep assertion at the bottom of this file, so a delete reds rather than passing.
 */
export const CSS_BUNDLE_SENTINEL_CLASS = 'mt-[88291px]';

interface Gate {
  /** The regex the gate matches with. */
  pattern: string;
  /** grep's flags as written in ci.yml, e.g. `rnE` or `rniE`. */
  flags: string;
  /** The FULL scope as written in ci.yml (may be several paths, some quoted). */
  scope: string;
  /** The scope split into individual paths, quotes stripped (M-8). */
  scopeFiles: string[];
  /** The comment-line filter applied to the hits. */
  filter: string;
}

/**
 * M-8: split a gate's scope string into its individual paths, honouring shell
 * single-quoting (the restore page's path is quoted for its brackets). The old
 * parser captured only the FIRST path, so a second scoped file's coverage was
 * structurally unpinnable — every scope assertion ran against path one.
 */
function parseScopeFiles(scope: string): string[] {
  const files: string[] = [];
  const piece = /'([^']+)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = piece.exec(scope)) !== null) files.push(m[1] ?? m[2]);
  return files;
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
  // M-8: the scope capture runs to the pipe into the comment filter, NOT to the
  // first whitespace — a gate scoping several files (the permanence gate scopes
  // two) must surface ALL of them, or the later entries are unpinnable here.
  const patternMatch = line.match(/grep -([A-Za-z]+) '([^']+)' (.+?) \| grep -vE/);
  const filterMatch = line.match(/grep -vE '([^']+)'/);
  if (!patternMatch || !filterMatch) {
    throw new Error(
      `ci.yml step "${stepName}" did not parse into flags + pattern + scope + comment filter.`,
    );
  }
  const scope = patternMatch[3].trim();
  return {
    flags: patternMatch[1],
    pattern: patternMatch[2],
    scope,
    scopeFiles: parseScopeFiles(scope),
    filter: filterMatch[1],
  };
}

/**
 * R-9: parse the L-12 existence-guard's `for f in ...; do` file list out of a
 * gate's step window. That list is by necessity a second copy of the gate's
 * grep scope (shell can't share them), and a scope edit that skips the guard
 * re-opens the silent-shrink L-12 closed: the guard keeps passing while the
 * gate scans fewer files. The lockstep assertion below makes that divergence
 * red instead of silent.
 */
function parseExistenceGuardFiles(stepName: string): string[] {
  const lines = CI_YML.split('\n');
  const start = lines.findIndex((l) => l.includes(stepName));
  if (start === -1) {
    throw new Error(`ci.yml step "${stepName}" not found — was the gate renamed or removed?`);
  }
  const rest = lines.slice(start + 1);
  const nextStep = rest.findIndex((l) => /^\s*- name:/.test(l));
  const window = nextStep === -1 ? rest : rest.slice(0, nextStep);
  const forLine = window.find((l) => /^\s*for f in /.test(l));
  if (!forLine) {
    throw new Error(
      `ci.yml step "${stepName}" has no existence-guard for-loop — keep the L-12 \`for f in <scope files>; do\` guard ahead of the grep.`,
    );
  }
  const listMatch = forLine.match(/^\s*for f in (.+?); do\s*$/);
  if (!listMatch) {
    throw new Error(
      `ci.yml step "${stepName}" existence guard did not parse — keep the single-line \`for f in ...; do\` shape.`,
    );
  }
  return parseScopeFiles(listMatch[1].trim());
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

    test('the shipped replacement copy is clean (M-5 wording, both branches)', () => {
      expect(
        permanenceHits(
          'Every other member is emailed a link to take over the group and bring it all back — they have 30 days before it is erased.'
        )
      ).toBe('');
      // The sole-member branch says "final" — true for that group, and not one
      // of the three banned phrasings.
      expect(
        permanenceHits(
          "You're the only member, so there is no one to email a recovery link to — deleting this group is final."
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

    test('M-8: BOTH scoped files are pinned — the Danger Zone AND the restore page', () => {
      // The old single-path parse left the restore page's coverage unpinnable:
      // dropping it from the gate's scope kept every test here green.
      expect(PERMANENCE_GATE.scopeFiles).toContain('src/app/components/GroupSettings.js');
      expect(PERMANENCE_GATE.scopeFiles).toContain('src/app/restore/group/[token]/page.tsx');
      expect(PERMANENCE_GATE.scopeFiles).toHaveLength(2);
    });

    test('R-9: the existence-guard file list IS the grep scope — lockstep, never a drifted hand copy', () => {
      // The L-12 guard's for-loop and the gate's grep scope are two shell
      // copies of the same list. If they diverge — a file added to the scope
      // but not the guard, or vice versa — the guard silently stops covering
      // what the gate scans. Deep-equal, order included, so the fix is always
      // "edit both lines together".
      expect(
        parseExistenceGuardFiles('group-delete copy must not claim permanence')
      ).toEqual(PERMANENCE_GATE.scopeFiles);
    });

    test('an out-of-scope file is outside every scanned path', () => {
      const covered = PERMANENCE_GATE.scopeFiles.some((scoped) => {
        const clean = scoped.replace(/\/$/, '');
        return OUT_OF_SCOPE_FILE === clean || OUT_OF_SCOPE_FILE.startsWith(`${clean}/`);
      });
      expect(covered).toBe(false);
    });

    test('...and it is excluded by SCOPE alone — the pattern does match its copy', () => {
      // The account-deletion copy WOULD trip this gate if the scope were widened.
      // That is the whole reason the scope is a file list rather than `src/`.
      expect(permanenceHits('This action cannot be undone.')).not.toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 88 plan 29 — the two NON-grep ci.yml steps this plan added.
//
// Both are located by STEP NAME, for the reason the 88.2 header note gives: a
// positional lookup already shipped once here and made step ORDER load-bearing
// with nothing declaring it.
// ---------------------------------------------------------------------------

/** The window of ci.yml lines belonging to one step, located by its name. */
function stepWindow(stepName: string): string[] {
  const lines = CI_YML.split('\n');
  const start = lines.findIndex((l) => l.includes(stepName));
  if (start === -1) {
    throw new Error(`ci.yml step "${stepName}" not found — was it renamed or removed?`);
  }
  const rest = lines.slice(start + 1);
  const nextStep = rest.findIndex((l) => /^\s*- name:/.test(l));
  return nextStep === -1 ? rest : rest.slice(0, nextStep);
}

const REGISTRY_STEP = "Drift-gate registry — Phase 88's source-scan guards must exist and stay armed";
const BUNDLE_STEP = 'CSS bundle guard — two-sided emitted-CSS assertion';

// DECISION Phase 88.6.2-26 (D-12): REGISTRY is read from the shared manifest, the one list the
// required job's runner also reads, so this lockstep and CI cannot disagree about the rows. The gates
// rows keep their floors; each helper is carried at min 0 so the exists test below still covers it.
// The named list further down stays a deliberate SECOND must-contain list (PC-5): a count or a
// generated list is satisfiable by any N rows, a named file is not.
const REGISTRY: { file: string; min: number }[] = [
  ...gates.map((g) => ({ file: g.file, min: g.min })),
  ...helpers.map((h) => ({ file: h, min: 0 })),
];
const RUNNER = resolve(__dirname, '../../scripts/drift-gate-registry.mjs');
const PROOFS_STEP = 'Phase 88.6.2 proofs (phase PR only)';

describe('Req 19 / gate-hygiene — the drift-gate registry (rows read from scripts/drift-gate-registry.manifest.mjs)', () => {
  test('the registry parses, and covers the whole Phase 88 guard set', () => {
    // A floor, not an exact count, so a future phase adding a guard is not a red build
    // here. Thirteen suites plus the shared scanner at the time of writing.
    expect(REGISTRY.length).toBeGreaterThanOrEqual(14);
  });

  test('every registered guard EXISTS on disk', () => {
    // This is the assertion that would catch the registry being pointed at a path that
    // was renamed — the exact silent-shrink L-12 closed for the permanence gate's scope.
    const missing = REGISTRY.filter(
      (e) => !existsSync(resolve(__dirname, '../..', e.file)),
    ).map((e) => e.file);
    expect(missing).toEqual([]);
  });

  test('every registered guard really carries at least its stated assertion count', () => {
    // Lockstep in the OTHER direction: the runner reads these numbers from the manifest,
    // and a number set to 0 would turn its floor off (the runner's own shape check reds that too).
    // Here a floor written below reality is not caught — a floor written ABOVE it is,
    // and so is a suite that has been gutted since the number was set.
    const short: string[] = [];
    for (const { file, min } of REGISTRY) {
      const full = resolve(__dirname, '../..', file);
      if (!existsSync(full)) continue; // already reported by the test above
      const n = (readFileSync(full, 'utf8').match(/^[ \t]*(it|test)\(/gm) ?? []).length;
      if (n < min) short.push(`${file}: ${n} assertions, registry expects >= ${min}`);
    }
    expect(short).toEqual([]);
  });

  test('the registry names the guards for every drift class this phase closed', () => {
    // Named individually rather than by count, because a count is satisfiable by any
    // fourteen rows — DEF-88-28-01's threshold-on-a-superset defect. Dropping the tint
    // guard and adding an unrelated one must not pass.
    const files = REGISTRY.map((e) => e.file);
    for (const required of [
      'src/app/components/controlSizeFloor.test.tsx', // Req 1  — 16px control floor
      'src/app/cardPaddingIdiom.test.ts', //             Req 2  — card padding idiom
      'src/app/typeScaleTouchedSurfaces.test.ts', //     CD-006 — heading type scale
      'src/app/rawColorValues.test.ts', //               Req 2  — raw hex / black shadows
      'src/app/tokenContrast.test.ts', //                Phase 88.3 Req 1-8 — token-layer WCAG floors
      'src/app/surfaceHoverSweep.test.ts', //            Phase 88.3 Req 1 / D-02 — the hover + sunken sweep
      'src/app/darkChromeLegibility.test.ts', //         Phase 88.3 Req 7/8 — dark-chrome ring + muted-label corrections + mobile-panel inert guard
      'src/app/accentSweep.test.ts', //                  Phase 88.3 Req 4/5 — the text-safe accent sweep, incl. the Req 5 today number
      'src/app/statusTextSweep.test.ts', //              Phase 88.3 Req 6 / OI-1 — the 132-site status text sweep
      'src/app/legacyOverlayClass.test.ts', //           Req 9  — the legacy overlay class
      'src/app/nativeDialogs.test.ts', //                Req 11 — native browser dialogs
      'src/app/groupColourRendering.test.ts', //         Phase 88.3 Req 9 / D-09 — group-colour rendering; the tint must never reach the save path
      'src/app/fetchErrorTreatment.test.ts', //          Req 14 — fetch-error treatment
      'src/app/borderExplicitness.test.ts', //           Req 16 — explicit border colours
      'src/app/tintTreatment.test.ts', //                Req 17 — opaque tints
      'src/app/focusAndMotionTreatment.test.ts', //      Req 4  — focus + reduced motion
      // Phase 88.8 plan 13 (owner ruling 2026-09-04). NAMED here, not merely present
      // as a registry row, for the same reason every other file on this list is: a
      // count is satisfiable by any N rows, so a row that gets dropped while another
      // is added would pass the count test above. This suite is the ONLY thing in
      // either repo pinning the BROAD `@auth0` test (DECISION Phase 88.2 NIX-AUTH0)
      // against a narrowing to `@auth0.local`, and a narrowed helper silently puts
      // the provisioning sentinel into the profile header, into the Email section
      // and into the admin mail's Reply-To. `colourDistance.test.ts` carries the same
      // cross-repo-guard argument (Amendment Z) and is NOT named here; that is a gap
      // in the earlier amendment rather than a precedent to copy.
      'src/lib/syntheticAddress.test.ts', //             Phase 88.8 R12 — the broad @auth0 guard
      // Phase 88.6 plan 55 (owner-ruled 2026-09-28, NEW OWNER ITEM 4): the five gates 88.6
      // minted itself, each deletable with a green build until registered.
      'src/app/groundInk.test.ts', //                    Phase 88.6-09 D-16 — ground-aware ink
      'src/app/errorEnvelopeReads.test.ts', //           Phase 88.6-14 R9 — default-deny error-envelope reads
      'src/app/components/btnCensus.test.tsx', //        Phase 88.6-10 — the legacy .btn element census
      'src/app/shadowTier.test.ts', //                   Phase 88.6-12 — off-tier shadow families
      'src/app/interpolatedClassCensus.test.ts', //      Phase 88.6-47 — interpolated Tailwind classes that emit no CSS
      // Phase 88.6-61 (review round 2 #18 / R-7 + H-1, owner-ruled 2026-09-29 R2-FIXNOW-SET-RULING):
      // the ONLY durable guards on the magic-link Sentry egress fixes — the replay gate + tracing
      // wiring (R-7, H-1) and the scrub functions (H-1). Unregistered, each was deletable with a
      // green build.
      'src/lib/sentryClientReplayGate.test.ts', //       Phase 88.6 R-7 + 88.6-61 H-1 — Sentry init is handed the gates
      'src/lib/sentry.scrub.test.ts', //                 Phase 84 T-84-01 + 88.6-61 H-1 — the scrub functions
      'src/test-utils/sourceScan.ts', //                 the scanner all of them share
      // Phase 88.6.2-26 (SPEC R6, D-06, A19): named so a dropped row reds here as well as in the
      // required job. Each guards by a tree scan or a walk, so a deleted file left CI green before.
      'src/app/rawStatusPalette.test.ts', //             Phase 88.6 Top Fix 1 — no raw red palette on error ink (SPEC R6)
      'src/app/breadcrumbNavOverflow.test.ts', //        Phase 88.6 UAT3-D1 — breadcrumb pills cap at their container (SPEC R6)
      'src/app/citeRatchet.test.ts', //                  Phase 88.6.2-04 D-06 — the line-cite ratchet
      'src/app/anchorCites.test.ts', //                  Phase 88.6.2-07 A19 — the permanent anchor-cite check on every PR
      'src/test-utils/sourceScan.parity.test.ts', //     Phase 88.6.2-08 — the scanner lexer parity, tree-wide
      'src/test-utils/scrubSessionHeaders.test.ts', //   Phase 88.6.2-20 R8 — the e2e fetch-error session scrub
      'src/test-utils/readHoldGuard.test.ts', //         Phase 88.6.2-11 / code review C-ML3 — the read-only network release guard
    ]) {
      expect(files, `registry lost ${required}`).toContain(required);
    }
  });

  test('the required drift-gate-registry job runs the runner on Node 20, self-test first, with no install', () => {
    // The job window, comments dropped first, so a word in a comment can neither satisfy nor
    // trip a check. The runner uses builtins only, so the job needs no npm ci and no cache.
    const a = CI_YML.indexOf('\n  drift-gate-registry:\n');
    const b = CI_YML.indexOf('\n  e2e:\n');
    expect(a, 'drift-gate-registry job not found').toBeGreaterThan(0);
    expect(b, 'e2e job not found after drift-gate-registry').toBeGreaterThan(a);
    const raw = CI_YML.slice(a, b);
    const code = raw
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code).toContain('uses: actions/setup-node@v4');
    expect(code).toMatch(/node-version: 20\n/);
    expect(code).toContain('shell: bash');
    expect(code, 'the registry step was renamed').toContain(REGISTRY_STEP);
    const selfTest = code.indexOf('node scripts/drift-gate-registry.mjs --self-test\n');
    const tree = code.indexOf('node scripts/drift-gate-registry.mjs\n');
    expect(selfTest, 'the --self-test line is missing').toBeGreaterThan(0);
    expect(tree, 'the tree run must come after --self-test').toBeGreaterThan(selfTest);
    for (const banned of ['npm ci', 'cache:', 'for entry in', 'continue-on-error', '||']) {
      expect(code, `the job must not contain ${banned}`).not.toContain(banned);
    }
    expect(code, 'no if: key may gate the job or a step').not.toMatch(/^\s+if:/m);
    expect(raw).toContain('DECISION Phase 88.6.2-26 (D-12)');
  });

  test('the runner self-test passes all 28 cases', () => {
    // stdin is ignored so the spawn can never wait on vitest's own stdin.
    const out = execFileSync(process.execPath, [RUNNER, '--self-test'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out.trimEnd().split('\n').pop()).toBe('self-test: PASS 28 of 28');
  });

  test('every manifest row says why, no file is in two lists, and ResponseDashboard is recorded as not a gate', () => {
    const rows = [...gates, ...helperOnly, ...notGates];
    const short = rows.filter((r) => typeof r.why !== 'string' || r.why.trim().length < 20).map((r) => r.file);
    expect(short).toEqual([]);
    const all = [...rows.map((r) => r.file), ...helpers];
    const twice = all.filter((f, i) => all.indexOf(f) !== i);
    expect(twice).toEqual([]);
    expect(notGates.map((n) => n.file)).toContain('src/app/components/ResponseDashboard.test.tsx');
  });
});

describe('Phase 88.6.2-07 — the phase-proofs step (parsed from ci.yml by step name)', () => {
  test('runs its seven checker lines in order, only on this phase branch', () => {
    // Plan 07's order: each self-test before its real run, so a broken checker never vouches
    // for the tree. The if: keeps the comment-only proof off every other PR.
    const window = stepWindow(PROOFS_STEP);
    const nodeLines = window.map((l) => l.trim()).filter((l) => l.startsWith('node ') && l.includes('scripts/'));
    expect(nodeLines).toEqual([
      'node scripts/comment-only-diff.mjs --self-test',
      'node scripts/comment-only-diff.mjs "$BASE_SHA"',
      'node scripts/anchor-cite-check.mjs --self-test',
      'node scripts/anchor-cite-check.mjs',
      'node scripts/line-cite-census.mjs --self-test',
      'node scripts/line-cite-census.mjs',
      'node --test-reporter=tap scripts/no-retry-bump.test.mjs "$BASE_SHA"',
    ]);
    const ifLines = window.filter((l) => /^\s+if:/.test(l));
    expect(ifLines.length).toBe(1);
    expect(ifLines[0]).toContain('feat/phase-88.6.2-');
  });
});

// ---------------------------------------------------------------------------
// Phase 88 plan 31 — the e2e typecheck step (DEF-88-30-02).
//
// `tsconfig.json` excludes `e2e/`, so the ordinary typecheck step is structurally
// incapable of failing on a Playwright spec. 88-31 added a second step pointed at
// `tsconfig.e2e.json`. Pinned here for the same reason the registry step is: without
// it, deleting one line of ci.yml silently re-opens the gap, and nothing reds.
// ---------------------------------------------------------------------------

const E2E_TSC_STEP = 'Typecheck e2e specs (DEF-88-30-02';

describe('DEF-88-30-02 — the e2e typecheck step (parsed from ci.yml by step name)', () => {
  test('the step exists and points at the e2e-scoped config, not the app one', () => {
    const window = stepWindow(E2E_TSC_STEP).join('\n');
    expect(window).toMatch(/run:\s*npx tsc --noEmit -p tsconfig\.e2e\.json\s*$/m);
  });

  test('tsconfig.e2e.json exists, includes e2e/, and EXTENDS the app config', () => {
    const cfgPath = resolve(__dirname, '../../tsconfig.e2e.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = readFileSync(cfgPath, 'utf8');
    // Extending rather than restating is what stops the two lanes drifting into
    // different compiler options — a strictness change in one place only.
    expect(cfg).toMatch(/"extends"\s*:\s*"\.\/tsconfig\.json"/);
    expect(cfg).toMatch(/"include"[\s\S]*e2e\/\*\*\/\*\.ts/);
  });

  test('the app config still EXCLUDES e2e/ — this step is load-bearing, not redundant', () => {
    // The anti-vacuity guard. If someone "simplifies" by deleting the exclude, the two
    // steps become duplicates and this one looks droppable — but that change also pulls
    // @playwright/test's globals into the app program alongside vitest/globals, which is
    // the collision tsconfig.e2e.json's own comment explains. Either outcome should be a
    // deliberate edit here, not a silent one there.
    const app = readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf8');
    expect(app).toMatch(/"exclude"[\s\S]*"e2e"/);
  });
});

describe('Req 19 — the two-sided CSS bundle guard step (parsed from ci.yml by step name)', () => {
  const window = stepWindow(BUNDLE_STEP).join('\n');

  test('the step runs the guard SCRIPT, not an inline one-liner that can drift', () => {
    expect(window).toMatch(/run:\s*node scripts\/css-bundle-guard\.mjs\s*$/m);
  });

  test('the guard script exists and asserts in BOTH directions', () => {
    const script = resolve(__dirname, '../../scripts/css-bundle-guard.mjs');
    expect(existsSync(script)).toBe(true);
    const src = readFileSync(script, 'utf8');
    // Direction A: the sentinel must be ABSENT. Direction B: real utilities PRESENT.
    // Both are asserted here because a one-sided guard is the failure mode the step
    // exists to prevent — an empty bundle satisfies direction A on its own.
    expect(src).toMatch(/DIRECTION A FAILED/);
    expect(src).toMatch(/DIRECTION B FAILED/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  test('the sentinel the guard looks for is the one declared in THIS file', () => {
    // The load-bearing lockstep. The guard hard-codes an escaped CSS form of the
    // sentinel; this file declares the Tailwind class. If they drift, the guard looks
    // for something no build can ever emit and direction A goes permanently, silently
    // green — which is precisely the class of defect this whole plan is about.
    const src = readFileSync(
      resolve(__dirname, '../../scripts/css-bundle-guard.mjs'),
      'utf8',
    );
    const escaped = CSS_BUNDLE_SENTINEL_CLASS.replace(/[[\]]/g, (c) => `\\\\${c}`);
    expect(src).toContain(escaped);
    // ...and the guard must still name THIS file as where the sentinel lives, so the
    // pointer a future reader follows cannot rot.
    expect(src).toContain('src/lib/ci-grep-gate.fixture.test.ts');
  });

  test('the sentinel is a real Tailwind arbitrary-value utility, not inert text', () => {
    // If the sentinel were not a class Tailwind can compile, direction A could never
    // red no matter which `@source` line was deleted. Shape check: `<utility>-[<value>]`.
    expect(CSS_BUNDLE_SENTINEL_CLASS).toMatch(/^[a-z-]+-\[[^\]]+\]$/);
  });

  test('the post-88 baseline exists where the step says it does', () => {
    // DI-87.7-22's standing rule: all chunks concatenated, sorted. Deliberately not
    // asserted for CONTENT — see the step comment — but it must exist, or the pointer
    // recorded for the next phase points at nothing.
    expect(existsSync(resolve(__dirname, '../../scripts/baselines/post-88.css'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.3 plan 12 — GATE C's anti-disarm mechanism.
//
// Gate C (`e2e/contrast.spec.ts`, SPEC Req 11) is a PLAYWRIGHT spec, so it does
// NOT get a row in the drift-gate registry above: that registry counts `it(`/
// `test(` inside vitest `.test.ts` files under `src/`, and a Playwright spec is
// neither. Its arming mechanism is instead the `--project=phone` pin on ci.yml's
// Playwright run line, plus the do-not-remove marker above it — the `phone`
// project's `testMatch` collects every `e2e/*.spec.ts` automatically, so dropping
// that one flag silently stops Gate C running while every check stays green.
//
// That marker (armed by Phase 87.8 plan 12, after a green combined run and a
// negative control) already says removing `--project=phone` DISARMS the
// phone-forward gate MOB-03. As of this plan it disarms a SECOND dependant, and
// this test is what makes the pin mechanical rather than a comment: MOB-03's
// touch/padding budgets AND Phase 88.3's rendered contrast pins both live in
// that project.
//
// Located by STEP NAME, like every reader above it, for the reason the 88.2
// header note gives.
// ---------------------------------------------------------------------------

const PLAYWRIGHT_STEP = 'Run Playwright journeys';

describe('Phase 88.3 Req 11 — Gate C is armed by the --project pin (parsed from ci.yml by step name)', () => {
  const window = stepWindow(PLAYWRIGHT_STEP).join('\n');

  test('the run line still names --project=phone', () => {
    expect(
      window,
      'ci.yml\'s Playwright run line no longer carries `--project=phone`. That single flag is the ' +
        'ONLY thing keeping the phone project on the PR lane, and TWO gates depend on it: MOB-03 ' +
        "(touch targets + padding budget) and Phase 88.3's Gate C rendered contrast pins " +
        '(e2e/contrast.spec.ts). Neither has a drift-gate registry row, because the registry counts ' +
        'vitest assertions and both are Playwright specs. Removing the flag is a DECISION, not a ' +
        'cleanup — see the marker above the step in ci.yml.',
    ).toContain('--project=phone');
  });

  test('the run line still names the setup and journeys projects too', () => {
    // `--project` is a positive ALLOWLIST (ci.yml's own marker says so): `setup` produces the
    // storageState both other projects reuse, so losing it takes the whole lane down, and
    // `journeys` is the desktop half. Asserting all three together stops a "simplification"
    // that keeps phone and drops its dependency.
    expect(window).toContain('--project=setup');
    expect(window).toContain('--project=journeys');
  });

  test('Gate C\'s spec file exists and is collected by that project', () => {
    // The pin is worthless if the file it protects is gone. `testMatch: /.*\.spec\.ts/` on the
    // phone project (playwright.config.ts) is what collects it, so existence + the `.spec.ts`
    // suffix is the whole collection contract.
    const spec = resolve(process.cwd(), 'e2e/contrast.spec.ts');
    expect(
      existsSync(spec),
      'e2e/contrast.spec.ts is missing. Gate C (SPEC Req 11) is the only place this phase measures ' +
        'contrast from COMPUTED STYLES in a real browser at 375x667 — Gate A pins declared token ' +
        'values and cannot see a cascade problem, an inline override or a composited ground.',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.3-cr, CR-09 — GATE C's EXECUTED-COUNT FLOOR.
//
// The three tests above prove the `--project=phone` FLAG is on the run line and
// the spec FILE exists. Neither can tell you a single test ran. Every Gate C test
// is behind `test.skip(({ isMobile }) => !isMobile)`, Playwright exits 0 on a run
// that skipped all of them, and nothing consumed the skipped count (run
// 33138624128: "85 passed, 72 skipped"). Removing `isMobile: true` from the phone
// project, or inverting that predicate, was pinned by NOTHING.
//
// `scripts/gate-c-executed-floor.mjs` is the consumer; this block is its lockstep,
// and the load-bearing assertion is the last one: the floor in the script may
// never exceed the number of tests the spec actually declares, or the gate goes
// permanently red and gets deleted rather than fixed.
// ---------------------------------------------------------------------------

const GATE_C_FLOOR_STEP =
  'Gate C executed-count floor — contrast.spec.ts must actually run in the phone project';

describe('Phase 88.3-cr CR-09 — Gate C\'s executed-count floor (parsed from ci.yml by step name)', () => {
  const window = stepWindow(GATE_C_FLOOR_STEP).join('\n');
  const scriptPath = resolve(__dirname, '../../scripts/gate-c-executed-floor.mjs');

  test('the step runs the floor SCRIPT, not an inline one-liner that can drift', () => {
    expect(window).toMatch(/run:\s*node scripts\/gate-c-executed-floor\.mjs\s+\S+\s*$/m);
  });

  test('the step carries no `if:` — it must run on the workflow_dispatch lane too', () => {
    // The cross-repo merge-order proof for this phase runs via workflow_dispatch with a
    // backend-ref. A condition here would exempt exactly the lane that matters most.
    expect(window, 'the Gate C floor step gained an `if:` condition').not.toMatch(/^\s*if:/m);
  });

  test('the floor script exists and fails the job rather than warning', () => {
    expect(existsSync(scriptPath)).toBe(true);
    const src = readFileSync(scriptPath, 'utf8');
    expect(src).toMatch(/Gate C DISARMED/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  test('playwright.config.ts still emits the machine-readable report the script reads', () => {
    // The floor is unreadable without it, and the script's outputFile argument in ci.yml
    // must name the same path the config writes. Drift here makes the gate fail-closed
    // (missing report -> exit 1), which is the right direction but a confusing red; this
    // test names the real cause instead.
    const cfg = readFileSync(resolve(__dirname, '../../playwright.config.ts'), 'utf8');
    const outputFile = cfg.match(/outputFile:\s*'([^']+)'/)?.[1];
    expect(outputFile, "playwright.config.ts no longer configures a 'json' reporter outputFile").toBeTruthy();
    expect(cfg).toContain("['json'");
    expect(window, `the step does not pass ${outputFile} to the floor script`).toContain(outputFile!);
  });

  test('the floor never exceeds the number of tests the spec actually declares', () => {
    // THE LOCKSTEP. A floor above the real count is a permanently red gate, and a
    // permanently red gate gets deleted. Measured, not quoted: `npx playwright test
    // --list --project=phone` reported 13 when this was written and 17 on 2026-10-24, when
    // Phase 88.6.2-26 raised FLOOR to 17. (The code review that raised CR-09 said 16 — it
    // was wrong, and this assertion is why that cannot ship.)
    const src = readFileSync(scriptPath, 'utf8');
    const floor = Number(src.match(/^const FLOOR = (\d+);$/m)?.[1]);
    expect(Number.isInteger(floor), 'the FLOOR constant was renamed or made dynamic').toBe(true);

    const spec = readFileSync(resolve(process.cwd(), 'e2e/contrast.spec.ts'), 'utf8');
    const declared = (spec.match(/^\s*test\(/gm) ?? []).length;
    expect(
      floor,
      `gate-c-executed-floor.mjs's FLOOR is ${floor} but e2e/contrast.spec.ts declares only ` +
        `${declared} tests — the gate would be permanently red. Lower the floor, or add the tests.`,
    ).toBeLessThanOrEqual(declared);
    // ...and it must not be vacuous either. A floor of 0 passes every run.
    expect(floor, 'the Gate C floor was zeroed, which passes a run that skipped everything').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6 plan 55 (owner-ruled 2026-09-28, NEW OWNER ITEM 4) — the D10 arm's
// EXECUTED-COUNT FLOOR, Gate C's hole mirrored.
//
// touch-targets.spec.ts's D10 describe (gated hover, focus ring, hover pin) skips
// when `isMobile`, so it runs ONLY in the desktop `journeys` project, and Playwright
// exits 0 on a run that skipped all three. The ci.yml step reuses the Gate C script
// through its optional flags rather than a second copy of it. This block is its
// lockstep, and as with Gate C the load-bearing assertion is the last one: the floor
// may never exceed the `test('D10` declarations the spec actually carries.
// Closes WINDOWS 20 / ledger row R104 (88.6-46-SUMMARY.md).
// ---------------------------------------------------------------------------

const D10_FLOOR_STEP =
  "D10 executed-count floor — touch-targets.spec.ts's D10 arm must actually run in the journeys project";

describe('Phase 88.6-55 — the D10 journeys executed-count floor (parsed from ci.yml by step name)', () => {
  const window = stepWindow(D10_FLOOR_STEP).join('\n');
  const runLine = window.match(/^\s*run:\s*(.+?)\s*$/m)?.[1] ?? '';
  const scriptPath = resolve(__dirname, '../../scripts/gate-c-executed-floor.mjs');

  test('the step runs the SHARED floor script on the json report, with all four flags', () => {
    expect(runLine, 'the D10 floor step no longer runs the shared floor script').toMatch(
      /^node scripts\/gate-c-executed-floor\.mjs playwright-results\.json\s/,
    );
    expect(runLine).toContain('--spec e2e/touch-targets.spec.ts');
    expect(runLine).toContain('--project journeys');
    expect(runLine).toContain('--title-prefix D10');
    expect(runLine).toMatch(/--floor \d+(\s|$)/);
  });

  test('the step carries no `if:` — it must run on the workflow_dispatch lane too', () => {
    expect(window, 'the D10 floor step gained an `if:` condition').not.toMatch(/^\s*if:/m);
  });

  test('the shared script still accepts the flags this step passes, and still fails the job', () => {
    const src = readFileSync(scriptPath, 'utf8');
    for (const flag of ['--spec', '--project', '--floor', '--title-prefix']) {
      expect(src, `gate-c-executed-floor.mjs no longer parses ${flag}`).toContain(`'${flag}'`);
    }
    expect(src).toMatch(/Executed-count floor DISARMED/);
  });

  test("the floor is > 0 and never exceeds the spec's `test('D10` declarations", () => {
    // Measured, not quoted: `npx playwright test --list --project=journeys
    // e2e/touch-targets.spec.ts -g "D10"` lists 3 on 2026-09-28. A floor above the real
    // count is a permanently red `main`; a floor of 0 passes a run that skipped everything.
    const floor = Number(runLine.match(/--floor (\d+)/)?.[1]);
    const spec = readFileSync(resolve(__dirname, '../../e2e/touch-targets.spec.ts'), 'utf8');
    const declared = (spec.match(/^\s*test\(\s*'D10/gm) ?? []).length;
    expect(declared, "e2e/touch-targets.spec.ts declares no `test('D10` tests at all").toBeGreaterThan(0);
    expect(
      floor,
      `the D10 floor is ${floor} but e2e/touch-targets.spec.ts declares only ${declared} ` +
        "`test('D10` tests — the gate would be permanently red. Lower the floor, or add the tests.",
    ).toBeLessThanOrEqual(declared);
    expect(floor, 'the D10 floor was zeroed, which passes a run that skipped everything').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.2-26 (SPEC R8, register row 64, the gate-c half): every e2e spec with a conditional
// skip has an executed floor, read by the shared floor script's --config mode from
// scripts/gate-c-floors.manifest.mjs. Gate C (contrast.spec.ts) keeps its own step and FLOOR.
// These four tests pin the step, the entry shape, the population, and the script's RED/GREEN on
// synthetic reports. The floor-above-listed bound is checked by the script against the run's own
// report (ABOVE LISTED), because a static test( count is wrong for loop-generated specs.
// ---------------------------------------------------------------------------

const EXEC_FLOORS_STEP =
  'Executed-count floors — every e2e spec with a conditional skip must actually run in its project';
const FE_ROOT = resolve(__dirname, '../..');
const FLOOR_SCRIPT = resolve(FE_ROOT, 'scripts/gate-c-executed-floor.mjs');
const CONDITIONAL_SKIP = /\b(?:test|describe)\.(?:skip|fixme)\(/;

/** Run the floor script with stdin ignored; never throws, returns the exit code and output. */
function runFloorScript(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [FLOOR_SCRIPT, ...args], {
      cwd: FE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

type FakeTest = { file: string; project: string; status: string };
/** A Playwright JSON report holding exactly these tests, one spec object per test. */
function fakeReport(tests: FakeTest[]): string {
  return JSON.stringify({
    suites: [
      {
        specs: tests.map((t, i) => ({
          file: t.file,
          title: `synthetic ${i}`,
          tests: [{ projectName: t.project, status: t.status }],
        })),
      },
    ],
  });
}

describe('Phase 88.6.2-26 — executed floors for every conditional-skip e2e spec (--config)', () => {
  test('the step runs the shared floor script in --config mode on the json report, with no if:', () => {
    const window = stepWindow(EXEC_FLOORS_STEP).join('\n');
    const runLine = window.match(/^\s*run:\s*(.+?)\s*$/m)?.[1] ?? '';
    expect(runLine).toBe(
      'node scripts/gate-c-executed-floor.mjs playwright-results.json --config scripts/gate-c-floors.manifest.mjs',
    );
    expect(window, 'the executed-floors step gained an if: condition').not.toMatch(/^\s*if:/m);
  });

  test('every entry names a real spec, a project on the Playwright run line, a positive floor and a reason', () => {
    const runLines = stepWindow(PLAYWRIGHT_STEP).filter((l) => l.includes('npx playwright test') && l.includes('--no-deps'));
    expect(runLines.length, 'the --no-deps Playwright run line is missing').toBe(1);
    const projects = [...runLines[0].matchAll(/--project=(\S+)/g)].map((m) => m[1]);
    expect(projects.length).toBeGreaterThan(0);
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const e of floors as Array<Record<string, unknown>>) {
      const id = `${String(e.spec)} ${String(e.project)}`;
      const extra = Object.keys(e).filter((k) => !['spec', 'project', 'floor', 'titlePrefix', 'why'].includes(k));
      if (extra.length) bad.push(`${id}: unknown key(s) ${extra.join(', ')}`);
      if (typeof e.spec !== 'string' || !/^e2e\/[^/]+\.spec\.ts$/.test(e.spec) || !existsSync(resolve(FE_ROOT, e.spec))) {
        bad.push(`${id}: spec is not an existing e2e/*.spec.ts`);
      }
      if (typeof e.project !== 'string' || !projects.includes(e.project)) bad.push(`${id}: project not on the run line`);
      if (!Number.isInteger(e.floor) || (e.floor as number) < 1) bad.push(`${id}: floor is not a positive integer`);
      if (typeof e.why !== 'string' || e.why.trim().length < 20) bad.push(`${id}: why is under 20 characters`);
      if (seen.has(id)) bad.push(`${id}: duplicate`);
      seen.add(id);
    }
    expect(bad).toEqual([]);
  });

  test('every spec with a conditional skip has an entry (contrast.spec.ts keeps Gate C)', () => {
    // The population is read from the tree, comments stripped by the shared lexer, so a skip
    // mentioned in a comment does not count and a new conditional spec cannot ship unfloored.
    const e2eDir = resolve(FE_ROOT, 'e2e');
    const population = readdirSync(e2eDir)
      .filter((f) => f.endsWith('.spec.ts'))
      .filter((f) => CONDITIONAL_SKIP.test(withoutComments(readFileSync(join(e2eDir, f), 'utf8'))))
      .map((f) => `e2e/${f}`);
    expect(population.length, 'the population scan found too few specs; the regex or the lexer broke').toBeGreaterThanOrEqual(45);
    const floored = new Set((floors as Array<{ spec: string }>).map((e) => e.spec));
    const missing = population.filter((f) => f !== 'e2e/contrast.spec.ts' && !floored.has(f));
    expect(missing, 'a spec with a conditional skip has no executed floor in scripts/gate-c-floors.manifest.mjs').toEqual([]);
    expect(floored.has('e2e/contrast.spec.ts'), 'contrast.spec.ts is floored by Gate C, not by the config').toBe(false);
  });

  test('config mode passes at floor, reds DISARMED below it, and matches specs on a path boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-c-floors-'));
    try {
      const all = floors as Array<{ spec: string; project: string; floor: number }>;
      const atFloor: FakeTest[] = all.flatMap((e) =>
        Array.from({ length: e.floor }, () => ({ file: e.spec.slice('e2e/'.length), project: e.project, status: 'expected' })),
      );
      const green = join(dir, 'green.json');
      writeFileSync(green, fakeReport(atFloor));
      const ok = runFloorScript([green, '--config', 'scripts/gate-c-floors.manifest.mjs']);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain(`Executed-count floors passed — ${all.length} entries`);

      const first = all[0];
      const red = join(dir, 'red.json');
      writeFileSync(
        red,
        fakeReport(
          atFloor.map((t) =>
            t.file === first.spec.slice('e2e/'.length) && t.project === first.project ? { ...t, status: 'skipped' } : t,
          ),
        ),
      );
      const bad = runFloorScript([red, '--config', 'scripts/gate-c-floors.manifest.mjs']);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('DISARMED');
      expect(bad.stderr).toContain(first.spec);

      // The collision: home-loading-and-create-group.spec.ts ends with create-group.spec.ts.
      const probe = join(dir, 'collision.mjs');
      writeFileSync(
        probe,
        "export const floors = [{ spec: 'e2e/create-group.spec.ts', project: 'phone', floor: 1, why: 'collision probe: basename suffix must not match' }];\n",
      );
      const collision = join(dir, 'collision.json');
      writeFileSync(collision, fakeReport([{ file: 'home-loading-and-create-group.spec.ts', project: 'phone', status: 'expected' }]));
      const c1 = runFloorScript([collision, '--config', probe]);
      expect(c1.status, 'config mode counted the longer spec as create-group.spec.ts').toBe(1);
      expect(c1.stderr).toContain('NOT COLLECTED');
      expect(c1.stderr).toContain('e2e/create-group.spec.ts');
      const twin = join(dir, 'twin.json');
      writeFileSync(twin, fakeReport([{ file: 'create-group.spec.ts', project: 'phone', status: 'expected' }]));
      const c2 = runFloorScript([twin, '--config', probe]);
      expect(c2.status, c2.stderr).toBe(0);
      const c3 = runFloorScript([collision, '--spec', 'e2e/create-group.spec.ts', '--project', 'phone', '--floor', '1']);
      expect(c3.status, 'flag mode counted the longer spec as create-group.spec.ts').toBe(1);
      expect(c3.stderr).toContain('DISARMED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6 plan 55 (NEW OWNER ITEM 4, ledger R140; gap-lap ML-18) — the
// month-tile PNG always-upload, and T-82-12 for EVERY upload step.
//
// The FE repo is PUBLIC, so every artifact is downloadable by any signed-in GitHub
// user. `.auth/user.json` is the appSession storageState (a live session) and
// `playwright-results.json` carries every test title and error message; neither may
// ever be uploaded. That was a comment until now — these tests make it mechanical.
//
// The upload step is located by `- name: ` + its name, not by the bare name: the
// permissions docblock at the top of ci.yml quotes the same step name in prose, and
// `stepWindow` takes the FIRST line that contains the string it is given.
// ---------------------------------------------------------------------------

const MONTH_TILE_UPLOAD_STEP = '- name: Upload desktop month-tile screenshots';

/** Every `actions/upload-artifact` step in ci.yml, with its `path:` entries and its `with:` artifact name. */
function uploadArtifactSteps(): { name: string; artifact: string | undefined; paths: string[] }[] {
  const lines = CI_YML.split('\n');
  const indentOf = (l: string) => (l.match(/^\s*/)?.[0].length ?? 0);
  const out: { name: string; artifact: string | undefined; paths: string[] }[] = [];
  lines.forEach((line, i) => {
    if (!/^\s*uses:\s*actions\/upload-artifact@/.test(line)) return;
    // Walk back to the step's `- ` opener, then forward to the next step at that indent.
    let start = i;
    while (start > 0 && !(/^\s*- /.test(lines[start]) && indentOf(lines[start]) < indentOf(line))) start -= 1;
    const stepIndent = indentOf(lines[start]);
    let end = i + 1;
    while (
      end < lines.length &&
      !(/^\s*- /.test(lines[end]) && indentOf(lines[end]) === stepIndent) &&
      !(lines[end].trim() !== '' && indentOf(lines[end]) < stepIndent)
    ) {
      end += 1;
    }
    const step = lines.slice(start, end);
    const name = step[0].match(/- name:\s*(.+?)\s*$/)?.[1] ?? '(unnamed upload step)';
    const pathAt = step.findIndex((l) => /^\s*path:/.test(l));
    const paths: string[] = [];
    if (pathAt !== -1) {
      const inline = step[pathAt].replace(/^\s*path:\s*/, '').trim();
      if (inline !== '' && inline !== '|' && inline !== '>') {
        paths.push(inline);
      } else {
        for (const l of step.slice(pathAt + 1)) {
          if (l.trim() === '') continue;
          if (indentOf(l) <= indentOf(step[pathAt])) break;
          paths.push(l.trim());
        }
      }
    }
    // The artifact name is the `with:` block's `name:` key (a bare `name:`, never the `- name:` opener).
    const artifact = step.find((l) => /^\s*name:/.test(l))?.replace(/^\s*name:\s*/, '').trim();
    out.push({ name, artifact, paths });
  });
  return out;
}

// Phase 88.6.2-27 (R7, T-88.6-G34): both uploads now ship only enc/<artifact>/, written by an
// encrypt step directly before each upload that runs scripts/encrypt-evidence.sh, so the
// readers below parse the steps, the script's arguments and the script itself. Line-based on
// purpose: yaml is not a direct dependency of this repo.
const FAILURE_UPLOAD_STEP = '- name: Upload Playwright failure evidence';
const ENCRYPT_FAILURE_STEP = '- name: Encrypt Playwright failure evidence';
const ENCRYPT_MONTH_TILE_STEP = '- name: Encrypt desktop month-tile screenshots';
const INSTALL_AGE_STEP = 'Install age (evidence encryption — T-88.6-G34)';
const SELF_TEST_AGE_STEP = 'Self-test the evidence encryption (encrypt-evidence.sh --self-test and its P3 test)';
const ENCRYPT_SCRIPT = resolve(__dirname, '../../scripts/encrypt-evidence.sh');
const RECIPIENT_FILE = '.github/evidence-recipient.txt';
// An age identity line, classic or post-quantum, matched case-insensitively by git grep.
const AGE_IDENTITY_RE = 'AGE-SECRET-KEY-(PQ-)?1[02-9AC-HJ-NP-Z]{58}';
// The script with its comment lines removed: the exclusion literals are counted in code only.
const ENCRYPT_SCRIPT_CODE = readFileSync(ENCRYPT_SCRIPT, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

const isYamlComment = (l: string) => l.trim().startsWith('#');
const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

interface CiStep {
  /** Index of the step's `- ` opener in ci.yml. */
  start: number;
  /** Index one past the step's last line (the next step's opener, or the end of its steps list). */
  end: number;
  name: string;
  lines: string[];
}

/** Every step of every job, in file order; comment lines before a step belong to the step above. */
function ciSteps(): CiStep[] {
  const lines = CI_YML.split('\n');
  const indentOf = (l: string) => (l.match(/^\s*/)?.[0].length ?? 0);
  const steps: CiStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)steps:\s*$/);
    if (!m) continue;
    const base = m[1].length;
    let itemIndent = -1;
    let cur: CiStep | null = null;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() !== '' && !isYamlComment(l) && indentOf(l) <= base) break;
      const isItem = /^\s*- /.test(l) && (itemIndent === -1 ? indentOf(l) > base : indentOf(l) === itemIndent);
      if (!isItem) continue;
      if (itemIndent === -1) itemIndent = indentOf(l);
      if (cur) {
        cur.end = j;
        steps.push(cur);
      }
      cur = { start: j, end: j, name: l.match(/- name:\s*(.+?)\s*$/)?.[1] ?? '(unnamed step)', lines: [] };
    }
    if (cur) {
      cur.end = j;
      steps.push(cur);
    }
    i = j - 1;
  }
  for (const s of steps) s.lines = lines.slice(s.start, s.end);
  return steps;
}

/** A step-level key's inline value (`if`, `shell`, `uses`, `run`), or undefined when absent. */
function stepKey(step: CiStep, key: string): string | undefined {
  const indentOf = (l: string) => (l.match(/^\s*/)?.[0].length ?? 0);
  const keyIndent = indentOf(step.lines[0]) + 2;
  const first = step.lines[0].match(new RegExp(`^\\s*- ${key}:\\s*(.*?)\\s*$`));
  if (first) return first[1];
  for (const l of step.lines.slice(1)) {
    if (isYamlComment(l) || indentOf(l) !== keyIndent) continue;
    const m = l.match(new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`));
    if (m) return m[1];
  }
  return undefined;
}

/** The step's non-comment, non-blank `run:` lines, trimmed (a block scalar or one inline line). */
function runLines(step: CiStep): string[] {
  const indentOf = (l: string) => (l.match(/^\s*/)?.[0].length ?? 0);
  const keyIndent = indentOf(step.lines[0]) + 2;
  const at = step.lines.findIndex((l, k) => k > 0 && indentOf(l) === keyIndent && /^\s*run:/.test(l));
  if (at === -1) return [];
  const inline = step.lines[at].replace(/^\s*run:\s*/, '').trim();
  if (inline !== '' && !/^[|>][-+]?$/.test(inline)) return [inline];
  const out: string[] = [];
  for (const l of step.lines.slice(at + 1)) {
    if (l.trim() === '') continue;
    if (indentOf(l) <= keyIndent) break;
    if (isYamlComment(l)) continue;
    out.push(l.trim());
  }
  return out;
}

interface EncryptInvocation {
  step: string;
  ifCond: string | undefined;
  name: string | undefined;
  recipients: string | undefined;
  match: string | undefined;
  inputs: string[];
  line: string;
}

/** Every non-comment ci.yml line that runs the encrypt script, with its step and arguments. */
function encryptInvocations(): EncryptInvocation[] {
  const steps = ciSteps();
  const out: EncryptInvocation[] = [];
  CI_YML.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (isYamlComment(l) || !t.startsWith('bash scripts/encrypt-evidence.sh ')) return;
    const step = steps.find((s) => i >= s.start && i < s.end);
    const tokens = (t.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((tok) => tok.replace(/^(['"])(.*)\1$/, '$2'));
    const dd = tokens.indexOf('--');
    const opt = (flag: string) => {
      const k = tokens.indexOf(flag);
      return k !== -1 && (dd === -1 || k < dd) ? tokens[k + 1] : undefined;
    };
    out.push({
      step: step?.name ?? '(outside any step)',
      ifCond: step ? stepKey(step, 'if') : undefined,
      name: opt('--name'),
      recipients: opt('--recipients'),
      match: opt('--match'),
      inputs: dd === -1 ? [] : tokens.slice(dd + 1),
      line: t,
    });
  });
  return out;
}

describe('Phase 88.6-55 — the month-tile PNG always-upload, and T-82-12 on every upload step', () => {
  // These pins were re-pointed by Phase 88.6.2-27 from the upload path: block to the encrypt steps and the script's arguments, where the exclusions now live (D-17).
  test("the month-tile upload is PNG-only by the encrypt step's --match, runs always(), and its upload warns when it finds nothing", () => {
    const window = stepWindow(MONTH_TILE_UPLOAD_STEP).join('\n');
    const path = window.match(/^\s*path:\s*(.+?)\s*$/m)?.[1];
    expect(path, 'the month-tile upload must ship only its encrypt step output').toBe('enc/month-tile-desktop-screenshots/');
    expect(window).toMatch(/^\s*if:\s*always\(\)\s*$/m);
    expect(window).toMatch(/^\s*uses:\s*actions\/upload-artifact@v4\s*$/m);
    expect(window).toMatch(/^\s*if-no-files-found:\s*warn\s*$/m);
    const inv = encryptInvocations().filter((i) => i.name === 'month-tile-desktop-screenshots');
    expect(inv, 'exactly one encrypt invocation must write the month-tile artifact').toHaveLength(1);
    expect(inv[0].match, 'the month-tile --match widened or moved').toBe('month-tile-desktop-*.png');
    expect(inv[0].inputs, 'the month-tile encrypt step reads test-results/ only').toEqual(['test-results/']);
    expect(inv[0].ifCond, 'the month-tile encrypt step must run always()').toBe('always()');
  });

  test('no upload step, of any name, uploads .auth/ or playwright-results.json, and every upload ships only enc/ ciphertext', () => {
    const uploads = uploadArtifactSteps();
    // Non-vacuity: the reader must actually find both steps the permissions census names.
    expect(uploads.length, 'uploadArtifactSteps() found fewer upload steps than ci.yml has').toBeGreaterThanOrEqual(2);
    for (const { name, artifact, paths } of uploads) {
      expect(paths, `upload step "${name}" must upload exactly enc/<its artifact name>/ (T-88.6-G34)`).toEqual([`enc/${artifact}/`]);
      for (const p of paths) {
        expect(p, `upload step "${name}" uploads a path under .auth/ (T-82-12)`).not.toContain('.auth');
        expect(p, `upload step "${name}" uploads the json report`).not.toContain('playwright-results.json');
      }
    }
    const invocations = encryptInvocations();
    expect(invocations.length, 'encryptInvocations() found fewer encrypt steps than ci.yml has').toBeGreaterThanOrEqual(2);
    for (const { step, inputs } of invocations) {
      expect(inputs.length, `encrypt step "${step}" names no input`).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(input, `encrypt step "${step}" reads a path under .auth/ (T-82-12)`).not.toContain('.auth');
        expect(input, `encrypt step "${step}" reads the json report`).not.toContain('playwright-results.json');
      }
    }
  });

  test('88.6 CR-01: the login journey records no trace, and no upload ships a zip from a directory it uploads', () => {
    // The chain this pins shut (built-in review 2026-09-29, CR-01): the shared `use` block
    // sets `trace: 'on-first-retry'` and CI sets `retries: 1`, so a login journey that fails
    // once RE-RUNS WITH TRACING ON, and that journey does `fill(E2E_AUTH0_PASS)` — the real
    // Auth0 password, kept in plain text in the trace's Call tab. The `if: failure()` upload
    // then publishes `test-results/` whole from a PUBLIC repo for 7 days; GitHub's secret
    // masking covers logs, not artifacts. Two independent arms, each sufficient alone, both
    // pinned so neither reads as a cleanup:
    //   (1) the `setup` project overrides trace to 'off' — the credential is never recorded;
    //   (2) the encrypt script drops every `*.zip` from every input before it packs anything —
    //       no trace archive (Playwright's `trace.zip`, or the html reporter's `data/*.zip`) can
    //       leave CI, even as ciphertext (an upload-path exclusion until Phase 88.6.2-27).
    const cfg = readFileSync(resolve(__dirname, '../../playwright.config.ts'), 'utf8');
    const setup = cfg.match(/name:\s*'setup'([\s\S]*?)name:\s*'journeys'/)?.[1];
    expect(setup, "playwright.config.ts no longer declares the 'setup' project ahead of 'journeys'").toBeDefined();
    expect(setup, "the setup project must override the shared trace setting with trace: 'off' (CR-01)").toMatch(
      /trace:\s*'off'/,
    );

    // Arm (2) since Phase 88.6.2-27: the exclusion is in scripts/encrypt-evidence.sh ("DECISION Phase 88.6.2-27 (D-17)"),
    // once as a tar --exclude argument and once as a find predicate, applied to every input of every encrypt step.
    expect(occurrences(ENCRYPT_SCRIPT_CODE, "--exclude='*.zip'"), 'the encrypt script must pass tar the *.zip exclusion exactly once (CR-01)').toBe(1);
    expect(occurrences(ENCRYPT_SCRIPT_CODE, "! -name '*.zip'"), 'the encrypt script must hold the *.zip find predicate exactly once (CR-01)').toBe(1);
    let dirsCounted = 0;
    for (const { inputs } of encryptInvocations()) dirsCounted += inputs.length;
    expect(dirsCounted, 'non-vacuity: no encrypt input directory was found to check').toBeGreaterThan(0);
  });

  test('88.6 R2-H5: the login step takes no page capture, and no upload ships an error-context.md', () => {
    // The channel CR-01 missed (review round 2 H-5, owner ruling R2-H5-RULING "source-level",
    // 2026-09-29 — "why are we recording passwords?"). On ANY failed test Playwright 1.60 writes
    // `test-results/<test>/error-context.md` with an aria snapshot of the page, and the aria
    // snapshot serialises every text/password INPUT's value — so a login that fails after
    // `fill(E2E_AUTH0_PASS)` wrote the real password there, and the `if: failure()` upload
    // published it from a PUBLIC repo. Trace settings never reached it. Five arms, all pinned:
    //   (a) the setup project takes NO capture of any kind: screenshot 'off' beside trace 'off';
    //   (b) CI runs setup as its OWN invocation, first, with the copy prompt disabled and no json
    //       report; then journeys + phone with `--no-deps` (without it Playwright re-runs setup as
    //       a dependency, env-free, and the login happens twice);
    //   (c) `PLAYWRIGHT_NO_COPY_PROMPT` is on the setup COMMAND only — never a step `env:` key;
    //   (d) the encrypt script drops every `error-context.md` from every input (the structural
    //       arm: the env var is an undocumented internal and survives no rename; an upload-path
    //       exclusion until Phase 88.6.2-27);
    //   (e) auth.setup.ts has no page-level matcher — a failing `expect(page)` matcher attaches
    //       its OWN whole-body aria snapshot, which the env var never reaches.
    // `expect.soft` on every arm: one run reports EVERY broken arm, not just the first.
    const isComment = (l: string) => l.trim().startsWith('#');
    const stepLines = stepWindow(PLAYWRIGHT_STEP).filter((l) => !isComment(l));

    // (a)
    const cfg = readFileSync(resolve(__dirname, '../../playwright.config.ts'), 'utf8');
    const setup = cfg.match(/name:\s*'setup'([\s\S]*?)name:\s*'journeys'/)?.[1];
    expect(setup, "playwright.config.ts no longer declares the 'setup' project ahead of 'journeys'").toBeDefined();
    expect.soft(setup, "(a) the setup project must take no screenshot: screenshot: 'off' (R2-H5)").toMatch(/screenshot:\s*'off'/);
    expect.soft(setup, "(a) the setup project must record no trace: trace: 'off' (CR-01)").toMatch(/trace:\s*'off'/);

    // (b)
    const invocations = stepLines.filter((l) => l.includes('npx playwright test')).map((l) => l.trim());
    expect.soft(invocations, '(b) the e2e step must run EXACTLY two playwright invocations: setup, then journeys + phone').toHaveLength(2);
    const setupCmd = invocations[0] ?? '';
    const journeysCmd = invocations[1] ?? '';
    expect.soft(setupCmd.startsWith('PLAYWRIGHT_NO_COPY_PROMPT=1 npx playwright test'), `(b) first invocation must be the copy-prompt-free setup run: ${setupCmd}`).toBe(true);
    expect.soft(setupCmd).toContain('--project=setup');
    expect.soft(setupCmd, '(b) the setup invocation must write NO json report (Gate C / D10 read journeys + phone only)').toContain('--reporter=github');
    expect.soft(setupCmd).not.toContain('--project=journeys');
    expect.soft(setupCmd).not.toContain('--project=phone');
    expect.soft(journeysCmd).toContain('--project=journeys');
    expect.soft(journeysCmd).toContain('--project=phone');
    expect.soft(journeysCmd, '(b) without --no-deps Playwright re-runs setup as a dependency, WITHOUT the env var').toContain('--no-deps');
    expect.soft(journeysCmd).not.toContain('--project=setup');
    expect.soft(journeysCmd).not.toContain('PLAYWRIGHT_NO_COPY_PROMPT');

    // (c)
    const envVarLines = stepLines.filter((l) => l.includes('PLAYWRIGHT_NO_COPY_PROMPT')).map((l) => l.trim());
    expect.soft(envVarLines, '(c) PLAYWRIGHT_NO_COPY_PROMPT must appear on exactly one non-comment line — the setup command').toEqual([setupCmd]);
    expect.soft(stepLines.some((l) => /^\s*PLAYWRIGHT_NO_COPY_PROMPT\s*:/.test(l)), '(c) the env var must never be a step env: key (process-wide)').toBe(false);

    // (d) since Phase 88.6.2-27: the exclusion is in the encrypt script, as a tar --exclude argument and a find predicate.
    expect.soft(occurrences(ENCRYPT_SCRIPT_CODE, "--exclude='error-context.md'"), '(d) the encrypt script must pass tar the error-context.md exclusion exactly once (R2-H5)').toBe(1);
    expect.soft(occurrences(ENCRYPT_SCRIPT_CODE, "! -name 'error-context.md'"), '(d) the encrypt script must hold the error-context.md find predicate exactly once (R2-H5)').toBe(1);
    expect.soft(occurrences(ENCRYPT_SCRIPT_CODE, 'tar -c'), '(d) the encrypt script must build exactly one tar (the one the exclusions apply to)').toBe(1);
    let dirsChecked = 0;
    for (const { inputs } of encryptInvocations()) dirsChecked += inputs.length;
    expect.soft(dirsChecked, '(d) non-vacuity: no encrypt input directory was found to check').toBeGreaterThan(0);

    // (e)
    const authSetup = readFileSync(resolve(__dirname, '../../e2e/auth.setup.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect.soft(authSetup, '(e) auth.setup.ts must not use a page-level matcher (its failure attaches a whole-body aria snapshot)').not.toMatch(/expect\(\s*page\b/);
  });

  test('the storageState and the json report both live OUTSIDE test-results/, where the uploads read', () => {
    // The glob's safety rests on where these two files are written. playwright.config.ts
    // writes the json report at the repo root and the storageState under .auth/; if either
    // moved INTO test-results/, a test-results/ upload could reach it.
    const cfg = readFileSync(resolve(__dirname, '../../playwright.config.ts'), 'utf8');
    const stateFiles = [...cfg.matchAll(/storageState:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(stateFiles.length, 'playwright.config.ts no longer declares a storageState path').toBeGreaterThan(0);
    for (const f of stateFiles) {
      expect(f.startsWith('.auth/'), `storageState ${f} is no longer under .auth/`).toBe(true);
    }
    const report = cfg.match(/outputFile:\s*'([^']+)'/)?.[1] ?? '';
    expect(report).toBe('playwright-results.json');
    expect(cfg, 'playwright.config.ts now sets an outputDir — re-check what test-results/ uploads can reach').not.toMatch(
      /^\s*outputDir:/m,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.2-27 (SPEC R7, register row T-88.6-G34): failure evidence leaves CI only as age
// ciphertext. The FE repo is PUBLIC and the phone project is authenticated, so a failure
// screenshot is a logged-in page. BOTH uploads are encrypted (SPEC edge 159: a second plaintext
// channel would defeat the first), and an encryption failure fails the step (SPEC edge 160).
// The choice and the rejected alternatives are in scripts/encrypt-evidence.sh ("DECISION Phase 88.6.2-27 (D-16)")
// and in its D-17 marker; the install placement is ci.yml's D-19 marker.
// ---------------------------------------------------------------------------

describe('Phase 88.6.2-27 — failure evidence leaves CI only as age ciphertext (R7, T-88.6-G34)', () => {
  test('every upload is directly preceded by its encrypt step, under the same if:, failing closed; age is installed once, before the tests', () => {
    const steps = ciSteps();
    const uploads = steps.filter((s) => (stepKey(s, 'uses') ?? '').startsWith('actions/upload-artifact@'));
    // The two readers must agree: uploadArtifactSteps() also finds an upload step with no name.
    expect(uploads.length, 'ciSteps() and uploadArtifactSteps() disagree on the upload count').toBe(uploadArtifactSteps().length);
    expect(uploads.length, 'non-vacuity: fewer upload steps than ci.yml has').toBeGreaterThanOrEqual(2);
    const invocations = encryptInvocations();
    expect(invocations.length, 'every upload needs exactly one encrypt invocation, and no other exists').toBe(uploads.length);

    for (const up of uploads) {
      const at = steps.indexOf(up);
      const enc = steps[at - 1];
      const artifact = uploadArtifactSteps().find((u) => u.name === up.name)?.artifact;
      expect(enc, `upload step "${up.name}" has no step before it`).toBeDefined();
      expect.soft(enc.name.startsWith('Encrypt '), `the step before "${up.name}" is "${enc.name}", not its encrypt step`).toBe(true);
      expect.soft(enc.end, `"${enc.name}" and "${up.name}" are not adjacent steps of one job`).toBe(up.start);
      expect.soft(stepKey(up, 'if'), `upload step "${up.name}" has no if:`).toBeDefined();
      expect.soft(stepKey(enc, 'if'), `"${enc.name}" must run under the same if: as "${up.name}"`).toBe(stepKey(up, 'if'));
      expect.soft(stepKey(enc, 'shell'), `"${enc.name}" must set shell: bash`).toBe('bash');
      const run = runLines(enc);
      expect.soft(run.length, `"${enc.name}" must run exactly two lines`).toBe(2);
      expect.soft(run[0], `"${enc.name}" must start with set -euo pipefail`).toBe('set -euo pipefail');
      expect.soft((run[1] ?? '').startsWith('bash scripts/encrypt-evidence.sh '), `"${enc.name}" must run only the encrypt script`).toBe(true);
      const inv = invocations.find((i) => i.line === run[1]);
      expect.soft(inv?.name, `"${enc.name}" must encrypt the artifact "${up.name}" uploads`).toBe(artifact);
      // The pair is only closed if the upload ships exactly what its encrypt step wrote.
      const upPaths = uploadArtifactSteps().find((u) => u.name === up.name)?.paths;
      expect.soft(upPaths, `"${up.name}" must ship only enc/${inv?.name}/, the output of "${enc.name}"`).toEqual([`enc/${inv?.name}/`]);
      expect.soft(up.lines.some((l) => /^\s*retention-days:\s*7\s*$/.test(l)), `"${up.name}" must keep retention-days: 7`).toBe(true);
      const body = enc.lines.filter((l) => !isYamlComment(l)).join('\n');
      for (const bad of ['apt-get', '||', 'continue-on-error', '${{']) {
        expect.soft(body.includes(bad), `"${enc.name}" holds ${bad}: an encrypt step runs only the script and fails closed`).toBe(false);
      }
    }

    const byOpener = (opener: string) => steps.filter((s) => s.lines[0].includes(opener));
    const encFailure = byOpener(ENCRYPT_FAILURE_STEP);
    const upFailure = byOpener(FAILURE_UPLOAD_STEP);
    const encMonth = byOpener(ENCRYPT_MONTH_TILE_STEP);
    const upMonth = byOpener(MONTH_TILE_UPLOAD_STEP);
    for (const [label, found] of [['failure encrypt', encFailure], ['failure upload', upFailure], ['month-tile encrypt', encMonth], ['month-tile upload', upMonth]] as const) {
      expect(found, `exactly one ${label} step`).toHaveLength(1);
    }
    expect(steps.indexOf(upFailure[0]), 'the failure upload must follow its encrypt step').toBe(steps.indexOf(encFailure[0]) + 1);
    expect(steps.indexOf(upMonth[0]), 'the month-tile upload must follow its encrypt step').toBe(steps.indexOf(encMonth[0]) + 1);
    expect(stepKey(encFailure[0], 'if')).toBe('failure()');
    expect(stepKey(encMonth[0], 'if')).toBe('always()');

    // D-19: age installed ONCE, after the browsers and before the tests, unconditionally.
    expect(CI_YML.split('\n').filter((l) => l.includes(`- name: ${INSTALL_AGE_STEP}`)), 'exactly one Install age step').toHaveLength(1);
    const installs = steps.filter((s) => s.name === INSTALL_AGE_STEP);
    expect(installs, 'the Install age step must exist under its exact name').toHaveLength(1);
    const install = installs[0];
    const ia = steps.indexOf(install);
    expect(steps[ia - 1]?.name.startsWith('Install Playwright browsers'), 'Install age must sit directly after Install Playwright browsers').toBe(true);
    // Code review B-ML1/B-ML3: the encrypt self-test step sits between Install age and the tests.
    expect(steps[ia + 1]?.name, 'Install age must sit directly before the encrypt self-test step').toBe(SELF_TEST_AGE_STEP);
    expect(steps[ia - 1].end, 'Install age and Install Playwright browsers are not adjacent steps of one job').toBe(install.start);
    expect(install.end, 'Install age and the encrypt self-test step are not adjacent steps of one job').toBe(steps[ia + 1].start);
    expect(stepKey(install, 'if'), 'Install age must carry no if:').toBeUndefined();
    expect(stepKey(install, 'shell')).toBe('bash');
    expect(runLines(install)).toEqual(['set -euo pipefail', 'sudo apt-get update', 'sudo apt-get install -y age']);
    const installBody = install.lines.filter((l) => !isYamlComment(l)).join('\n');
    expect(installBody.includes('||'), 'Install age must not swallow a failure with ||').toBe(false);
    expect(installBody.includes('continue-on-error'), 'Install age must not be continue-on-error').toBe(false);
  });

  test('code review B-ML1/B-ML3: the encrypt self-test and its P3 test run in CI, after Install age and directly before the tests', () => {
    const steps = ciSteps();
    const found = steps.filter((s) => s.name === SELF_TEST_AGE_STEP);
    expect(found, 'exactly one encrypt self-test step, under its exact name').toHaveLength(1);
    const st = found[0];
    const at = steps.indexOf(st);
    expect(steps[at - 1]?.name, 'the encrypt self-test step must sit directly after Install age').toBe(INSTALL_AGE_STEP);
    expect(steps[at - 1].end, 'Install age and the encrypt self-test step are not adjacent steps of one job').toBe(st.start);
    expect(steps[at + 1]?.name.startsWith('Run Playwright journeys'), 'the encrypt self-test step must sit directly before Run Playwright journeys').toBe(true);
    expect(st.end, 'the encrypt self-test step and Run Playwright journeys are not adjacent steps of one job').toBe(steps[at + 1].start);
    expect(stepKey(st, 'if'), 'the encrypt self-test step must carry no if:').toBeUndefined();
    expect(stepKey(st, 'shell')).toBe('bash');
    expect(runLines(st)).toEqual([
      'set -euo pipefail',
      'AGE_BIN=age AGE_KEYGEN_BIN=age-keygen bash scripts/encrypt-evidence.sh --self-test',
      'node --test --test-reporter=tap scripts/encrypt-evidence.test.mjs',
    ]);
    const body = st.lines.filter((l) => !isYamlComment(l)).join('\n');
    expect(body.includes('||'), 'the encrypt self-test step must not swallow a failure with ||').toBe(false);
    expect(body.includes('continue-on-error'), 'the encrypt self-test step must not be continue-on-error').toBe(false);
    // The self-test line is not a real encrypt run, so the upload pairing above never counts it.
    expect(encryptInvocations().some((i) => i.step === SELF_TEST_AGE_STEP), 'the self-test line was read as an encrypt invocation').toBe(false);
    // What the step runs still exists, and the script still declares its thirteen cases.
    expect(ENCRYPT_SCRIPT_CODE).toContain('self-test: PASS $ST_PASS of 13');
    expect(existsSync(resolve(FE_ROOT, 'scripts/encrypt-evidence.test.mjs')), 'scripts/encrypt-evidence.test.mjs is gone').toBe(true);
  });

  test('P3: the committed recipient is one age1 public key and no private key material', () => {
    const ok = spawnSync('bash', [ENCRYPT_SCRIPT, '--check-recipients', resolve(FE_ROOT, RECIPIENT_FILE)], { encoding: 'utf8' });
    expect(ok.status, `${RECIPIENT_FILE} failed the recipients check:\n${ok.stdout}${ok.stderr}`).toBe(0);
    expect(ok.stdout.trim().split('\n').pop()).toBe('recipients: OK');

    // Planted: the real age1 line plus a line carrying the identity prefix. The prefix is built at
    // runtime so no file in the repo holds it whole.
    const dir = mkdtempSync(join(tmpdir(), 'p3-'));
    try {
      const age1 = readFileSync(resolve(FE_ROOT, RECIPIENT_FILE), 'utf8').split('\n').find((l) => l.startsWith('age1'));
      const plant = join(dir, 'recipient.txt');
      writeFileSync(plant, `${age1}\n${'AGE-SECRET-' + 'KEY-1 plant'}\n`);
      const bad = spawnSync('bash', [ENCRYPT_SCRIPT, '--check-recipients', plant], { encoding: 'utf8' });
      const out = `${bad.stdout}${bad.stderr}`;
      expect(bad.status, 'a recipients file holding private key material must be refused').toBe(1);
      expect(out).toContain('PROBLEM private-key');
      expect(out, 'the recipients check must never echo the line it refuses').not.toContain('KEY-1 plant');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const invocations = encryptInvocations();
    expect(invocations.length, 'non-vacuity: no encrypt invocation found').toBeGreaterThanOrEqual(2);
    for (const { step, recipients } of invocations) {
      expect(recipients, `encrypt step "${step}" must encrypt to ${RECIPIENT_FILE}`).toBe(RECIPIENT_FILE);
    }

    // Every PR's quality job sweeps the tracked FE files: exit 1 (no match) and nothing printed.
    const sweep = spawnSync('git', ['grep', '-IiEl', AGE_IDENTITY_RE], { cwd: FE_ROOT, encoding: 'utf8' });
    expect(sweep.status, `git grep exited ${sweep.status} (0 = a tracked file holds an age identity, other = git failed):\n${sweep.stdout}${sweep.stderr}`).toBe(1);
    expect(sweep.stdout).toBe('');
  });
});
