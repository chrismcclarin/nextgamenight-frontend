/**
 * Phase 88.3 plan 09 — the status text sweep (Req 6 / OI-1).
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * `text-status-{success,error,warning}` resolves, via the `@theme inline` keys at
 * `globals.css:410-412`, to the status BORDER values. Four of the six status pairs failed the
 * 4.5:1 text floor before this phase — MEASURED against `src/lib/wcag.ts`: light success 3.30 on
 * the plain card / 2.78 on its own tint, light warning 3.19 / 2.72, light error 4.83 / 3.81, dark
 * error 3.68 / 3.23.
 *
 * Plan 88.3-04 minted six `--color-status-{x}-text` values that clear 4.5:1 on BOTH the plain card
 * and the matching tint in BOTH themes, and bridged them into `@theme inline` as
 * `--color-content-status-{success,error,warning}` (`globals.css:362-364`). This plan moves every
 * call site onto them. This suite is what stops them drifting back.
 *
 * DECISION Phase 88.3 (OI-1): the 132-site CLASS SWEEP, chosen OVER two cheaper alternatives that
 * are both measured and both wrong. Reinstating either is a decision, not a cleanup.
 *
 *   (A) RE-POINT THE SHARED THEME KEY. `--color-status-error: var(--color-status-error-text)` is
 *       three lines and zero sweeps. REJECTED, and the reason is structural: in Tailwind v4 ONE
 *       `@theme inline` key generates the `text-`, `bg-` AND `border-` utilities
 *       (`globals.css:384-386`, verified). Re-pointing it therefore drags the 47 `border-status-*`
 *       sites and the 4 solid `bg-status-*` glyphs with it, and visibly LIGHTENS the dark error
 *       border from `#ef4444` to `#fca5a5`. Plan 04 already split the families at the token layer
 *       precisely so this would not be necessary; collapsing them again re-opens OI-4.
 *
 *   (D) AN `@utility text-status-success` OVERRIDE. DISPROVEN, not merely rejected — compiled
 *       against this project's own tailwindcss@4.3.3, the `@utility` declaration MERGES into the
 *       same rule as the theme-generated `color:`, which lands LAST, so the theme value wins and
 *       the override does nothing. An UNLAYERED `.text-status-success` rule does win the cascade,
 *       but then it also beats every `hover:` / `dark:` / responsive variant of a text colour on
 *       the same element — and four sites in this sweep carry `hover:text-status-error`
 *       (`BallotOptionsEditor.js:38`, `FeedbackForm.js:231`, `ParticipantRow.js:271`,
 *       `createGroup.js:176`), which would go dead.
 *
 * THE GATE CANNOT SEE ALTERNATIVE (A) — SAY SO RATHER THAN IMPLY OTHERWISE
 * -----------------------------------------------------------------------
 * A future re-point of the shared key would leave every class token below exactly as it is, so
 * tests 1 and 4 stay green while the app regresses. The marker above, not this suite, is the
 * defence against that one; `tokenContrast.test.ts` (Gate A, plan 05) is the mechanical half,
 * because it pins the twelve status text cells at the TOKEN layer.
 *
 * WHY A SOURCE SCAN AND NOT A GREP
 * --------------------------------
 * The token lives in shapes a `className=`-anchored rewrite misses and a naive `sed` corrupts:
 * a `closeClassName=` prop (`createGroup.js:176`), object-literal config values
 * (`RsvpSection.js:121,130`), a lookup table (`gameDetail/page.js:45-46`) and template-literal
 * ternary branches (`KebabMenu.js:158`, `ScheduleList.js:144-145`, `FriendInvitePanel.js:414-417`).
 * The lexer crosses newlines, recurses into `${...}`, and DROPS COMMENTS — the last one matters
 * here because a raw grep reads 134 occurrences where the class-string population is 132; the two
 * extra are marker prose at `gameDetail/page.js:1903` and `FormField.tsx:9`.
 *
 * THE PRESERVATION TESTS MATTER MORE THAN THE NEGATIVE
 * ---------------------------------------------------
 * SPEC Req 6 keeps the border tokens. A loose rewrite (`s/status-error/content-status-error/`)
 * would silently drag 47 borders and 76 backgrounds. Test 5's floors are taken from the CURRENT
 * tree and pass BEFORE the sweep, which is what makes them real numbers rather than aspirations.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, sourceFiles, stringChunks } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

const rel = (file: string): string => path.relative(SRC, file);

/** The three hues Req 6 moves. `info` is deliberately absent — see test 2. */
const HUES = ['success', 'error', 'warning'] as const;

/**
 * The tokens, assembled from parts so this file's own prose cannot be scanned into a hit and so
 * the raw repo census never counts the gate itself.
 */
const LEGACY = HUES.map((h) => `text-status-${h}`);
const DESTINATION = HUES.map((h) => `text-content-status-${h}`);
const BORDER = HUES.map((h) => `border-status-${h}`);
const SUBTLE = HUES.map((h) => `bg-status-${h}-subtle`);
const SOLID = HUES.map((h) => `bg-status-${h}`);

/** The richer variant strip from `tintTreatment.test.ts:113` — four sites carry `hover:`. */
const VARIANT_PREFIX = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/** The base token of a class, with every variant prefix, a leading `!` and any `/alpha` removed. */
const base = (token: string): string => token.replace(VARIANT_PREFIX, '').replace(/\/\d+$/, '');

/**
 * Every use of a class whose BASE is EXACTLY one of `tokens`, anywhere in a string literal or a
 * template-literal chunk (comments already dropped by the lexer).
 *
 * The exact-token compare is load-bearing in both directions. A substring test would read the
 * sweep's own destination `text-content-status-error` as an offender, making test 1 unsatisfiable;
 * and it would read `bg-status-error-subtle` as a solid `bg-status-error`, making test 5(c) lie.
 */
function classUses(src: string, tokens: readonly string[]): { line: number; text: string }[] {
  const wanted = new Set(tokens);
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    for (const token of text.split(/\s+/).filter(Boolean)) {
      if (wanted.has(base(token))) {
        hits.push({ line: lineAt(src, offset), text: text.trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

/** The offenders: the legacy status text tokens this plan migrates away from. */
export function legacyStatusTextUses(src: string): { line: number; text: string }[] {
  return classUses(src, LEGACY);
}

/** Total hits for `tokens` across every non-test source file under `src/`. */
function totalAcrossSrc(files: string[], tokens: readonly string[]): number {
  let n = 0;
  for (const file of files) n += classUses(fs.readFileSync(file, 'utf8'), tokens).length;
  return n;
}

describe('Req 6 status text sweep — every status text site reads the text-safe token', () => {
  const files = sourceFiles(SRC);

  it('0. the sweep is scanning a representative app, not an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('1. no source file still reaches for a legacy status text token', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of legacyStatusTextUses(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel(file)}:${hit.line} ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. the detector matches all SEVEN shipped shapes — and is EXACT, not a substring test', () => {
    // Each of these is a MEASURED shape from this sweep's own population, and every one after the
    // second is a site a `className=`-anchored rewrite would have missed.
    // (i) a plain string literal.
    expect(legacyStatusTextUses(`const c = "${LEGACY[1]}";`)).toHaveLength(1);
    // (ii) a JSX className — the ordinary shape.
    expect(legacyStatusTextUses(`<p className="text-sm ${LEGACY[1]}">{error}</p>`)).toHaveLength(1);
    // (iii) a `closeClassName=` PROP value (`createGroup.js:176`) — one element carrying the token
    // twice, once variant-prefixed.
    expect(
      legacyStatusTextUses(`<Modal closeClassName="${LEGACY[1]} hover:${LEGACY[1]}" />`),
    ).toHaveLength(2);
    // (iv) an object-literal config value (`RsvpSection.js:121`).
    expect(legacyStatusTextUses(`const cfg = { textColor: '${LEGACY[0]}' };`)).toHaveLength(1);
    // (v) a lookup-table `cls:` value (`gameDetail/page.js:45`).
    expect(
      legacyStatusTextUses(
        `const m = { yes: { label: 'Going', cls: 'bg-status-success-subtle ${LEGACY[0]}' } };`,
      ),
    ).toHaveLength(1);
    // (vi) a ternary branch inside a template literal (`KebabMenu.js:158`) — the shape
    // DEF-88-27-01 records as unreachable for an attribute-anchored gate.
    expect(
      legacyStatusTextUses(
        `const c = \`px-3 \${danger ? '${LEGACY[1]}' : 'text-content-primary'}\`;`,
      ),
    ).toHaveLength(1);
    // (vii) a `hover:`-prefixed occurrence standing alone.
    expect(legacyStatusTextUses(`<button className="hover:${LEGACY[1]}">`)).toHaveLength(1);

    // THE EXACT-TOKEN PROOF, both directions. The sweep's own destination must yield ZERO, or
    // test 1 is unsatisfiable...
    expect(
      legacyStatusTextUses(`<p className="${DESTINATION[1]} hover:${DESTINATION[1]}">`),
    ).toEqual([]);
    // ...and `text-status-info` must yield ZERO. It exists in this repo ONLY in comments and test
    // titles, Req 6 does not move it, and a hue-agnostic `text-status-` prefix detector would
    // demand an edit this plan has no token for.
    expect(legacyStatusTextUses(`<span className="text-status-info">`)).toEqual([]);
  });

  it('3. marker prose quoting the token does NOT trip the gate', () => {
    // The four real comment shapes in this tree, each of which stays as prose after the sweep.
    // `ParticipantRow.js:240` — a block-comment CONTINUATION line starting with a word, which
    // ci.yml's anchored comment filter would not drop.
    expect(
      legacyStatusTextUses(
        `/* visual change and this phase forbids those. The \`text-status-*\` tokens survive and carry\n   the treatment.\n*/\nconst x = 1;`,
      ),
    ).toEqual([]);
    // `gameDetail/page.js:1903` — a `//` line naming the token for visual continuity.
    expect(
      legacyStatusTextUses(`// ${LEGACY[0]} used by that mobile inline indicator for continuity`),
    ).toEqual([]);
    // `FormField.tsx:9` — a JSDoc continuation carrying BOTH the token and a quoted attribute;
    // the quoted `role="alert"` is exactly what a comment-blind lexer would mis-read as a string.
    expect(
      legacyStatusTextUses(
        `/**\n *   - Error: 12px/400 (\`text-xs\`), \`--color-error\` (\`${LEGACY[1]}\`), \`role="alert"\`,\n */\nconst x = 1;`,
      ),
    ).toEqual([]);
    // `AutoPromptBehaviorBanner.js:72` — prose about `text-status-info`, a token this plan does
    // not own; it must be inert for the detector twice over (comment AND wrong hue).
    expect(
      legacyStatusTextUses(`// the "Got it" button carried \`text-status-info\` — a token that`),
    ).toEqual([]);
    // ...and a JSX comment, the `{/* ... */}` shape used inside render bodies.
    expect(legacyStatusTextUses(`{/* the copy moves off ${LEGACY[2]} in light mode */}`)).toEqual(
      [],
    );
  });

  it('4. the migration really happened — the positive floor on the destination tokens', () => {
    // Without this, DELETING the swept sites would make test 1 pass. MEASURED at execution time:
    // 132 across 40 files (71 error + 41 success + 20 warning, 4 of them `hover:`-prefixed). The
    // floor sits below that on purpose: adding a status text site is not a test edit, removing a
    // dozen is.
    expect(totalAcrossSrc(files, DESTINATION)).toBeGreaterThanOrEqual(120);
  });

  it('5. THE PRESERVATION FLOORS — the border and background families are untouched', () => {
    // These matter MORE than test 1. SPEC Req 6 keeps the border tokens, and plan 04 already gave
    // them their own per-theme `--color-status-{x}-border` values, so they are handled at the token
    // layer and must not be edited at the call sites. Every floor below was measured on the tree
    // BEFORE the sweep and passed there — that is what makes them real numbers.

    // (a) MEASURED 47 across 20 files. This is the assertion that catches a loose rename like
    //     `s/status-error/content-status-error/`, which would drag every one of them.
    expect(totalAcrossSrc(files, BORDER)).toBeGreaterThanOrEqual(45);

    // (b) MEASURED 71 (plus 5 `-subtle-hover`, which `base()` does not fold in).
    expect(totalAcrossSrc(files, SUBTLE)).toBeGreaterThanOrEqual(68);

    // (c) The four SOLID `bg-status-*` glyph fills, pinned by file so the floor cannot be met by
    //     one cluster. A substring detector would read the 71 `-subtle` tokens as solids and make
    //     this test vacuous; `base()` compares the whole token.
    const solidIn = (r: string): number =>
      classUses(fs.readFileSync(path.join(SRC, r), 'utf8'), SOLID).length;
    expect(solidIn('app/components/PromptScheduleReadOnly.js')).toBeGreaterThanOrEqual(1);
    expect(solidIn('app/components/SuggestionCard.js')).toBeGreaterThanOrEqual(2);
    expect(solidIn('app/components/AvailabilityForm.js')).toBeGreaterThanOrEqual(1);
    expect(totalAcrossSrc(files, SOLID)).toBeGreaterThanOrEqual(4);
  });
});
