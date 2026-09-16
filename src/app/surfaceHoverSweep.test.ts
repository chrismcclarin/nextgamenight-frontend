/**
 * Phase 88.3 Gate B — the hover/sunken surface sweep (Req 1 / D-02, D-03).
 *
 * WHAT THIS PINS
 * --------------
 * Plan 88.3-03 re-keyed `--color-bg-card-hover` to warm-200 [AMENDED 88.6-02 (D-15): that property
 * is now named `--color-bg-muted` and its class is `bg-surface-muted`, at byte-equal values — the
 * old spelling is kept quoted here because it is what the 88.3 records were written against]
 * [AMENDED 88.3-18: the token is the
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
 * [the class in that recorded command is spelled `bg-surface-muted` since 88.6-02 (D-15); the
 * command and its count are left verbatim because they are the measurement taken THEN]
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
/**
 * The token being retired from PREFIXED positions only. Bare uses stay (D-01).
 *
 * AMENDED Phase 88.6-02 (D-15): the spelling moved from `-card-hover` to `-muted` at byte-equal
 * token values. The constant keeps the name `LEGACY` because what it means here is unchanged —
 * "the surface whose PREFIXED uses 88.3 retired" — and every assertion below turns on that
 * meaning, not on the spelling. Exactly ONE of the five constants in this block takes the new
 * spelling; `SURFACE`, `NEW_HOVER`, `HEADER_HOVER` and `SUNKEN` name other live surfaces and are
 * byte-unchanged on purpose.
 */
const LEGACY = `${SURFACE}-muted`;
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
 * A BARE `bg-surface-muted` (spelled `bg-surface-card-hover` until 88.6-02 (D-15); value
 * byte-equal) is deliberately NOT a hit: it is the static-surface token
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
    //
    // 36 -> 32, plan 88.6-18 (wave 7, 2026-09-16), WITH ALL FOUR DEPARTING SITES NAMED, which
    // is the only form in which this number may be lowered. Every one of them was in
    // `app/gameDetail/page.js` and NONE of them lost the wash:
    //
    //  1. the GuestInviteButton idle branch — migrated to `<Button variant="ghost">`, whose
    //     cva variant already supplies the byte-equal `enabled-hover:bg-surface-hover`
    //     (`Button.tsx:209`). The bare form could NOT be kept: under the D8 amendment that
    //     control is `aria-disabled` while sending, and a bare `hover:` re-lights a gated
    //     control — the exact defect `enabled-hover` exists to prevent
    //     (`Button.tsx`'s `DECISION Phase 88.6-06 (D10)`).
    //  2-4. the hand-rolled event-actions kebab's trigger and its two destructive items —
    //     RETIRED onto the shared `KebabMenu`, whose own trigger and items carry the wash and
    //     are already counted in this set (`KebabMenu.js:429`, `:549`, `:550`).
    //
    // 32 -> 31, plan 88.6-21 task 2 (wave 7, 2026-09-16), WITH ITS ONE DEPARTING SITE NAMED:
    // `app/groupHomePage/page.js`'s "Manage Members" header CTA, migrated to
    // `<Button variant="ghost">`, whose cva variant already supplies the byte-equal
    // `enabled-hover:bg-surface-hover`. The bare form could not be kept for the same reason
    // plan 18's GuestInviteButton could not keep it — and here there is a second, sharper
    // reason: this control ALSO carries a dark-arm hover (`dark:bg-white/20`), and
    // `enabled-hover` is (0,4,0) against the dark variant's (0,2,0), so the dark arm had to be
    // re-spelled `dark:enabled-hover:` in the same edit or the ghost variant's light-theme
    // surface token would have silently won in dark mode.
    //
    // 31 -> 30, plan 88.6-25 task 3 (wave 7, 2026-09-16), WITH ITS ONE DEPARTING SITE NAMED:
    // `app/components/AvailabilityGrid.js`'s "Clear All" toolbar button, migrated to
    // `<Button variant="ghost">`, whose cva variant already supplies the byte-equal
    // `enabled-hover:bg-surface-hover`. The bare form could not be kept for the same reason
    // plans 18 and 21 could not keep theirs: this control is natively `disabled` while the
    // grid is disabled, and a bare `hover:` re-lights a gated control. It carries no dark-arm
    // hover, so plan 21's second, sharper reason does not apply here. The site's sibling in
    // the same toolbar — the paint-mode toggle — was migrated in the same commit and is NOT a
    // departure from this set: it never carried `bg-surface-hover` at all, it pins its own
    // raw-palette `enabled-hover:bg-*` per mode.
    //
    // So the property this floor protects — the wash is really adopted — is intact; what
    // changed is the SPELLING (bare `hover:` -> the gated `enabled-hover:` on the primitive)
    // and the OWNER (a per-site string -> a shared component). This scanner deliberately
    // counts only the bare `hover:` token, so the primitive's gated form is invisible to it by
    // construction, and every remaining `.btn` migration in this phase will cross this floor
    // the same way. A future lowering must likewise name every site that left; lowering it
    // bare is forbidden.
    const sites = sitesOf(files, `${HOVER_PREFIX}${NEW_HOVER}`);
    expect(sites.length, `adopted at: ${sites.join(', ')}`).toBeGreaterThanOrEqual(30);
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

// =====================================================================================
// Phase 88.6-02 (D-15) — legs (a) and (c) of the old-name completeness census.
// Leg (b) (the declaration layer) lives in `tokenContrast.test.ts`, which is the only
// suite that parses `globals.css`.
// =====================================================================================

/**
 * The RETIRED class spelling, built from parts for the same reason the constants above are:
 * so this file's own prose can never be scanned into a hit by leg (a) or by any future census.
 */
const RETIRED_CLASS = `${SURFACE}-card${'-'}hover`;
/** The retired custom-property spellings, likewise built rather than written. */
const RETIRED_PROPS = [`--color-bg-card${'-'}hover`, `--color-surface-card${'-'}hover`];

describe('Phase 88.6-02 (D-15) — the retired card-hover CLASS token has zero live sites', () => {
  const files = sourceFiles(SRC);

  it('(a) the comment-blind source scan over `src/` finds zero live uses of the old class token', () => {
    // WHY A LEXER AND NOT A GREP. Task 2 of this plan deliberately PRESERVES ~26 comment lines
    // that name the old spelling, because each records a measurement or ruling taken under that
    // name — rewriting them would turn true historical statements into false ones. A byte-presence
    // grep over the tree is therefore UNSATISFIABLE BY CONSTRUCTION: it can only be made green by
    // falsifying history. `stringChunks` sees only string-literal content, so comment prose is
    // excluded by the lexer rather than by a fragile pattern — the same idiom `darkChromeLegibility
    // .test.ts:43` uses, and the one `sourceScan.ts:41-58` records four shipped grep gates dying
    // without.
    //
    // WHAT IT DOES NOT SEE, stated rather than implied: `sourceFiles()` excludes `.test.`/`.spec.`
    // files (`sourceScan.ts:209`) and never reaches `.css` or `e2e/`. Leg (b) covers the
    // declaration layer, leg (c) covers `e2e/`, and the test-file layer is covered by the suites
    // themselves running green.
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const { offset, text } of stringChunks(src)) {
        for (const token of text.split(/\s+/).filter(Boolean)) {
          if (token.replace(STRIP_VARIANTS, '') === RETIRED_CLASS) {
            offenders.push(`${rel(file)}:${lineAt(src, offset)}`);
          }
        }
      }
    }
    expect(
      offenders,
      `88.6-02 (D-15) — the retired class token survives at a LIVE site: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('(a-control) the scan is looking at a real app and the NEW spelling is actually adopted', () => {
    // The zero above must not be zero-by-emptiness. Same control shape as test 0 and test 4a.
    expect(files.length).toBeGreaterThan(50);
    expect(sitesOf(files, LEGACY).length, 'the renamed static surfaces').toBeGreaterThanOrEqual(40);
  });

  it('(c) `e2e/` has no live use — no old token in a locator/selector, no old custom-property reference', () => {
    // `e2e/` is outside `sourceFiles()`' reach, so this leg reads it directly.
    //
    // IT IS DELIBERATELY NOT A STRING-CHUNK SCAN. Three `card-hover` strings survive in
    // `e2e/contrast.spec.ts` — a `test.step` TITLE, a comment, and an assertion LABEL — and two of
    // the three are string literals, so a non-comment string census would red on descriptive prose.
    // What matters for e2e is whether the token is used to FIND an element or to READ a custom
    // property; both of those are syntactically distinctive, so they are what is asserted.
    const e2eDir = path.resolve(SRC, '..', 'e2e');
    const e2eFiles = fs
      .readdirSync(e2eDir, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|js)$/.test(d.name))
      .map((d) => path.join(e2eDir, d.name));
    expect(e2eFiles.length, 'LOCATOR failure: no e2e spec files found').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of e2eFiles) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        const where = `${path.basename(file)}:${i + 1}`;
        // A selector reach: the token inside locator()/querySelector()/getBy*()/$()/$$().
        if (
          new RegExp(
            `(locator|querySelectorAll|querySelector|getByTestId|getByRole|\\$\\$|\\$)\\s*\\([^)]*${RETIRED_CLASS}`,
          ).test(line)
        ) {
          offenders.push(`${where} (selector)`);
        }
        // A custom-property read, in any of the forms e2e uses.
        for (const prop of RETIRED_PROPS) {
          if (line.includes(`var(${prop})`) || line.includes(`getPropertyValue('${prop}')`)) {
            offenders.push(`${where} (custom property ${prop})`);
          }
        }
      });
    }
    expect(
      offenders,
      `88.6-02 (D-15) — an e2e spec still reaches for the retired token: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
