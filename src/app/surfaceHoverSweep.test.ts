/**
 * Phase 88.3 Gate B — the hover/sunken surface sweep (Req 1 / D-02, D-03).
 *
 * WHAT THIS PINS
 * --------------
 * Plan 88.3-03 re-keyed `--color-bg-card-hover` to warm-200 [AMENDED 88.3-18: the token is the
 * minted **warm-250** since owner ruling 1c, 2026-08-28 — warm-200 became the page, so the re-key's
 * own REASON, that the old value had become the page colour, is now true TWICE OVER and the
 * conclusion is unchanged] because it serves ~49 STATIC
 * surfaces (pills, badges, chips, skeletons, selected/disabled states) whose old value had
 * become the page colour. That re-key left every *hovered* card jumping to a ΔL* 10.4 slab
 * [now ΔL* 15.63 at warm-250 — a heavier slab, same rejection]
 * where the owner picked a faint ΔL* 2.3 press. This plan moved every PREFIXED use of the
 * legacy token onto `bg-surface-hover`, sent the three dark-chrome menu rows to the HEADER
 * family instead (UI-SPEC §10.1), and adopted `bg-surface-sunken` at the five censused
 * nested blocks (D-03). This suite is what stops any of that silently reverting.
 *
 * THE ASYMMETRY THAT MAKES THIS GATE NON-TRIVIAL
 * ----------------------------------------------
 * A PREFIXED `hover:` / `data-[state=open]:` use of the legacy token is an offender.
 * A BARE one is CORRECT and must survive: those ~49 static surfaces are exactly what the
 * token was re-keyed FOR (D-01). A detector that flagged them would demand a wrong edit,
 * and a "replace all" sweep that obeyed it would destroy the static ladder. Test 4e is the
 * assertion that catches that mistake, and it is the one a naive sweep fails.
 *
 * DECISION Phase 88.3 (D-02): this is a `stringChunks` SOURCE SCAN, chosen OVER the grep
 * the plan first specified. Grep is measurably wrong for this token family, in both
 * directions. MISSES: the token lives in `closeClassName=` (`createGroup.js:176`), in
 * object-literal config maps (`RsvpSection.js:121`), in `cls:` lookup tables
 * (`gameDetail/page.js:45-46`) and in template-literal ternary branches
 * (`KebabMenu.js:158`, `ScheduleList.js:144-145`, `FriendInvitePanel.js:414-417`) — a
 * `className`-anchored rewrite reaches none of the first three, and grep is line-based
 * while every className in this repo sits on a different line from its opening tag.
 * FALSE POSITIVES: it also lives in comments that must NOT be swept — measured at
 * execution time, `grep -rEn 'hover:bg-surface-card-hover' src` returned 42 lines of which
 * `NotificationBell.js:168` is a DECISION-marker COMMENT line, so the grep census was
 * inflated by exactly one; the lexer's count is 41. A naive `sed` would have corrupted a
 * prior phase's evidence. `sourceScan.ts:41-58` records four shipped grep gates killed by
 * these same three properties. Re-writing this as a grep is a decision, not a cleanup.
 *
 * WHAT THIS DOES NOT CLAIM
 * ------------------------
 * It sees the CLASS TOKEN, not a rendered pixel. Every `hover:` utility is emitted inside
 * `@media (hover: hover)`, and `playwright.config.ts`'s own marker records that the `phone`
 * project measures `matchMedia('(hover: hover)')` as FALSE — so a rendered hover pin under
 * the one Playwright project D-07 pins would be a gate that can never go red. Gate A
 * (`tokenContrast.test.ts`, the declared value) plus this gate (the class token) are the
 * honest acceptance for the hover half. The SUNKEN half IS rendered-pinnable and plan 12
 * probes it.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, sourceFiles, stringChunks } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

const rel = (file: string): string => path.relative(SRC, file);

/**
 * The tokens, built from parts so this file's own prose cannot be scanned into a hit.
 * (`sourceFiles` already excludes `.test.` files — `sourceScan.ts:209` — so this is belt
 * and braces, and it is the idiom `legacyOverlayClass.test.ts:54` established.)
 */
const SURFACE = ['bg', 'surface'].join('-');
/** The token being retired from PREFIXED positions only. Bare uses stay (D-01). */
const LEGACY = `${SURFACE}-card-hover`;
/** The faint press wash the owner picked (warm-50 in light, ΔL* 2.3 from the card). */
const NEW_HOVER = `${SURFACE}-hover`;
/** The dark-chrome family: warm-700, 10.48:1 under `text-white` (UI-SPEC §10.1). */
const HEADER_HOVER = `${SURFACE}-header-hover`;
/** The fourth pinnable surface Req 11 measures (D-03). */
const SUNKEN = `${SURFACE}-sunken`;

const HOVER_PREFIX = `${'hover'}:`;
const OPEN_PREFIX = `data-[state=${'open'}]:`;

/**
 * Strip Tailwind variant prefixes and the `!` important marker.
 *
 * This is `tintTreatment.test.ts:113`'s richer form, NOT `legacyOverlayClass.test.ts:69`'s
 * `/^[a-z-]+:/` — the simpler one cannot strip `data-[state=open]:`, and this sweep touches
 * exactly such a site (`dialog.tsx:75`).
 */
const STRIP_VARIANTS = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/**
 * Every PREFIXED reach for the legacy hover token — `hover:` or `data-[state=open]:`.
 *
 * A BARE `bg-surface-card-hover` is deliberately NOT a hit: it is the static-surface token
 * this phase re-keyed on purpose (D-01), and ~44 shipped surfaces depend on it.
 */
export function legacyHoverUses(src: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const base = token.replace(STRIP_VARIANTS, '');
      if (base !== LEGACY) continue;
      const prefix = token.slice(0, token.length - base.length);
      if (prefix.startsWith(HOVER_PREFIX) || prefix.startsWith(OPEN_PREFIX)) {
        hits.push({ line: lineAt(src, offset), text: text.trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

/** Every EXACT-token occurrence of `token` in `src`, as 1-based line numbers. */
function exactTokenLines(src: string, token: string): number[] {
  const lines: number[] = [];
  for (const { offset, text } of stringChunks(src)) {
    for (const t of text.split(/\s+/).filter(Boolean)) {
      if (t === token) lines.push(lineAt(src, offset));
    }
  }
  return lines;
}

/** `file:line` for every exact-token occurrence across the whole source tree. */
function sitesOf(files: string[], token: string): string[] {
  const out: string[] = [];
  for (const file of files) {
    for (const line of exactTokenLines(fs.readFileSync(file, 'utf8'), token)) {
      out.push(`${rel(file)}:${line}`);
    }
  }
  return out;
}

describe('Phase 88.3 Gate B — the hover/sunken surface sweep (Req 1 / D-02, D-03)', () => {
  const files = sourceFiles(SRC);

  it('0. the sweep is scanning a representative app, not an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('1. no source file still uses the legacy token in a hover or open-state position', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of legacyHoverUses(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel(file)}:${hit.line} ${hit.text}`);
      }
    }
    expect(
      offenders,
      `D-02: a hovered surface must use \`${NEW_HOVER}\` (the ΔL* 2.3 press), or ` +
        `\`${HEADER_HOVER}\` on the dark header panel — never the static \`${LEGACY}\``,
    ).toEqual([]);
  });

  it('2. the detector really matches the prefixed token — it is not a dead regex', () => {
    // Bare string constant, the `availabilityColor.ts:248` shape.
    expect(legacyHoverUses(`const c = "${HOVER_PREFIX}${LEGACY}";`)).toHaveLength(1);
    // A className with siblings around it — the shipped JSX shape.
    expect(
      legacyHoverUses(`<div className="${HOVER_PREFIX}${LEGACY} p-4">`),
    ).toHaveLength(1);
    // A template-literal ternary branch — reachable by grep only by accident, and the
    // shape `KebabMenu.js:158` and `FriendInvitePanel.js:414-417` actually ship.
    expect(
      legacyHoverUses(
        `const c = \`rounded \${on ? "${HOVER_PREFIX}${LEGACY}" : "border-line"}\`;`,
      ),
    ).toHaveLength(1);
    // The open-state variant, which `legacyOverlayClass.test.ts`'s simpler strip cannot
    // reach — this is `dialog.tsx:75`.
    expect(
      legacyHoverUses(`<X className="opacity-70 ${OPEN_PREFIX}${LEGACY}" />`),
    ).toHaveLength(1);
    // THE NEGATIVE THAT DEFINES THIS GATE: a BARE occurrence is not an offender. Those
    // ~44 static surfaces are what the token was re-keyed for (D-01).
    expect(legacyHoverUses(`<span className="${LEGACY} rounded-full">`)).toEqual([]);
  });

  it('3. a DECISION marker discussing the token does NOT trip the gate', () => {
    // This phase's own markers necessarily quote the token they retire — including the
    // AMENDED 87.8 marker at `NotificationBell.js`, which sits four lines above the very
    // className it describes. A comment-blind gate would force those markers reworded,
    // which is normalising a prior phase's evidence to satisfy a defective detector.
    expect(
      legacyHoverUses(`// Phase 88.3 moved this off ${HOVER_PREFIX}${LEGACY}`),
    ).toEqual([]);
    expect(
      legacyHoverUses(
        `/* the press wash was \`${HOVER_PREFIX}${LEGACY}\`, plus\n   a continuation line starting with neither slash nor star\n*/\nconst x = 1;`,
      ),
    ).toEqual([]);
    expect(
      legacyHoverUses(`{/* replaces the ${HOVER_PREFIX}${LEGACY} wash */}`),
    ).toEqual([]);
  });

  it('4a. the new hover wash is really adopted — the zero above is not zero-by-emptiness', () => {
    // Floor set BELOW the measured 38 on purpose: this pins that the sweep happened, not
    // the exact roster, so adding a hoverable surface is never a test edit. Removing
    // several IS.
    const sites = sitesOf(files, `${HOVER_PREFIX}${NEW_HOVER}`);
    expect(sites.length, `adopted at: ${sites.join(', ')}`).toBeGreaterThanOrEqual(36);
  });

  it('4b. the three dark-chrome menu rows are on the HEADER family, not the card one', () => {
    // UI-SPEC §10.1: these rows sit on `bg-surface-header` (`Header.js:192`). A warm-50
    // wash under `text-white` measures 1.06:1; warm-700 measures 10.48:1. Pinned BY NAME
    // so a future re-sweep that "converges" them onto the other 38 goes red here.
    const sites = sitesOf(files, `${HOVER_PREFIX}${HEADER_HOVER}`);
    for (const required of [
      'app/components/NotificationBell.js',
      'app/components/ThemeToggle.js',
      'app/components/FeedbackButton.js',
    ]) {
      expect(
        sites.some((s) => s.startsWith(`${required}:`)),
        `${required} must hover to \`${HEADER_HOVER}\` — it renders on the dark header panel`,
      ).toBe(true);
    }
    // Plus the two nav links at `Header.js:204,212`, which were already correct and are
    // the model these three should have followed. Untouched by this phase.
    expect(sites.filter((s) => s.startsWith('app/Header.js:')).length).toBeGreaterThanOrEqual(2);
  });

  it('4c. the sunken surface is really adopted', () => {
    // Floor below the measured 5, same reason as 4a. Req 11's fourth pinnable surface.
    const sites = sitesOf(files, SUNKEN);
    expect(sites.length, `adopted at: ${sites.join(', ')}`).toBeGreaterThanOrEqual(4);
  });

  it('4d. each of the five censused nested blocks carries the sunken surface', () => {
    // Named individually, not by count: a count of 5 is satisfiable by any five sites,
    // and the five that matter are the nested blocks D-03 censused line by line.
    const sites = sitesOf(files, SUNKEN);
    for (const required of [
      'app/components/PromptScheduleManager.js',
      'app/components/FriendInvitePanel.js',
      'app/components/EventScheduler.tsx',
      'app/userProfile/page.js',
      'app/components/ManageMembers.js',
    ]) {
      expect(
        sites.some((s) => s.startsWith(`${required}:`)),
        `${required}'s nested block must be \`${SUNKEN}\` (D-03)`,
      ).toBe(true);
    }
  });

  it('4e. the ~44 STATIC surfaces survived — the sweep was not a replace-all', () => {
    // THE assertion a naive "replace all" fails. The bare token is not legacy: plan 03
    // re-keyed it to warm-200 [AMENDED 88.3-18: warm-250 since owner ruling 1c, 2026-08-28 —
    // warm-200 became the page; counts and assertions here are untouched] precisely to serve
    // pills, badges, chips, skeletons and
    // selected/disabled states (D-01), plus `GroupSettings.js:361`'s avatar disc, which
    // is excluded from the sunken adoption on purpose (OI-5). Measured 44 after the
    // sweep (49 before, minus the five nested blocks that became sunken).
    const sites = sitesOf(files, LEGACY);
    expect(sites.length, `static surfaces remaining: ${sites.length}`).toBeGreaterThanOrEqual(40);
  });
});
