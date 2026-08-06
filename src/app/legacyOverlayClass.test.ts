/**
 * Req 9 (PRIM-02 / D-09) repo-wide guard: no component reaches for the legacy
 * `.modal-overlay` class. Every dialog in the app composes the shared `<Modal>` primitive,
 * which is what gives it a focus trap, an accessible name, Esc-to-dismiss and the 12px
 * phone gutter (88-16, DEF-88-17-01).
 *
 * WHY THIS IS A SOURCE SCAN AND NOT THE GREP THE PLAN SPECIFIED
 * ------------------------------------------------------------
 * `88-29-PLAN.md` Task 2(a) asks for a grep on class-attribute usage with comment and
 * `.test.` filters, and states that the `HeatmapTooltip`/`layout.js` references are
 * comment-only so no allowlist entry is needed. Run against this tree before being
 * trusted, that gate is RED on a correct tree. MEASURED: `grep -rn 'modal-overlay' src`
 * returns 24 lines and **zero** are a class-attribute usage. Nine are comment lines in
 * shipped components — `FeedbackButton.js:168`, `FeedbackModalProvider.tsx:24`,
 * `FriendInvitePanel.js:533/538/545/549`, `BringGamePicker.js:127`,
 * `TutorialOverlay.js:182` — and SIX OF THOSE NINE are block-comment CONTINUATION lines
 * beginning with a backtick or a word, not with `//` or `*`. ci.yml's anchored comment
 * filter drops neither. The remaining lines are `globals.css`'s own rule, and test files.
 *
 * That is the comment-blindness recorded in DEF-88-25-02, DEF-88-27-01 and DEF-88-28-01,
 * and it bites here in its worst form: the comments a grep gate would red on are precisely
 * the DECISION markers 88-15/88-16/88-17 wrote to record this migration. The only way to
 * make that grep green would be to reword the markers — normalising prior phases' evidence
 * to satisfy a defective detector, which DEF-88-25-02 explicitly refused to do.
 *
 * COMPATIBLE WITH 88-31 BY CONSTRUCTION
 * ------------------------------------
 * 88-31 deletes the `.modal-overlay` block from `globals.css`. This scan reads only
 * `.js/.jsx/.ts/.tsx`, and asserts nothing about the stylesheet, so it neither depends on
 * that CSS existing nor breaks when it goes. Test 4's positive pin is on the PRIMITIVE's
 * adoption, which survives the deletion.
 *
 * WHAT THIS DOES NOT CLAIM
 * ------------------------
 * It sees the legacy CLASS. It cannot see a NEW hand-rolled backdrop written from scratch
 * (`fixed inset-0 bg-black/50` with no class name), which is the shape `FriendInvitePanel`
 * shipped before 88-15 and which its own file comment says the class census "structurally
 * CANNOT see". Test 4's adoption floor is the partial answer — a new hand-rolled dialog
 * does not raise it — but a genuine detector for that shape is a11y-render work, not a
 * source scan, and belongs with the per-surface composed axe audits (DEF-88-12-04).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, sourceFiles, stringChunks } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

const rel = (file: string): string => path.relative(SRC, file);

/** The legacy class, written so this file's own prose cannot be scanned into a hit. */
const LEGACY = ['modal', 'overlay'].join('-');

/**
 * Every reach for the legacy overlay class in real code: as a className token, or as a
 * CSS selector inside a query string.
 *
 * Both forms matter and they fail differently. A className token re-creates the old
 * hand-rolled dialog. A `querySelector('.<class>')` means some code is still reasoning
 * about the legacy DOM shape, which goes silently null the moment 88-31 deletes the rule —
 * so it would not throw, it would just stop working.
 */
export function legacyOverlayUses(src: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const asClass = tokens.some((t) => t.replace(/^[a-z-]+:/, '') === LEGACY);
    const asSelector = text.includes(`.${LEGACY}`);
    if (asClass || asSelector) {
      hits.push({ line: lineAt(src, offset), text: text.trim().slice(0, 120) });
    }
  }
  return hits;
}

/** Files that compose the shared `<Modal>` primitive. */
function modalAdopters(files: string[]): string[] {
  return files
    .filter((f) => /from '(\.{1,2}\/)+([a-zA-Z/]*\/)?Modal'/.test(fs.readFileSync(f, 'utf8')))
    .map(rel);
}

describe('Req 9 legacy overlay class — the modal fleet is on the shared primitive', () => {
  const files = sourceFiles(SRC);

  it('0. the sweep is scanning a representative app, not an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('1. no source file uses the legacy overlay class', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of legacyOverlayUses(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel(file)}:${hit.line} ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. the detector really matches the class — it is not a dead regex', () => {
    // Bare, and with other classes around it (the shipped pre-migration shape).
    expect(legacyOverlayUses(`const c = "${LEGACY}";`)).toHaveLength(1);
    expect(legacyOverlayUses(`<div className="${LEGACY} p-4">`)).toHaveLength(1);
    // Inside a template interpolation — a branch a line-based grep can reach but an
    // attribute-shaped one cannot (DEF-88-21-01 / DEF-88-27-01).
    expect(
      legacyOverlayUses(`const c = \`fixed \${open ? "${LEGACY}" : "hidden"}\`;`),
    ).toHaveLength(1);
    // As a selector, the form that goes silently null once 88-31 deletes the rule.
    expect(legacyOverlayUses(`document.querySelector('.${LEGACY}')`)).toHaveLength(1);
  });

  it('3. a DECISION marker discussing the class does NOT trip the gate', () => {
    // This is the assertion a future author will break, and the exact reason the plan's
    // grep is red on this tree: six shipped block-comment CONTINUATION lines mention the
    // class, in markers written to record the migration away from it.
    expect(legacyOverlayUses(`// Phase 88-17 moved this off the hand-rolled .${LEGACY}`)).toEqual([]);
    expect(
      legacyOverlayUses(
        `/* the backdrop sits one step above .${LEGACY}, plus\n   a note continuing on a line that starts with neither slash nor star\n*/\nconst x = 1;`,
      ),
    ).toEqual([]);
    // ...and a JSX comment, the shape `{/* ... */}` used inside render bodies.
    expect(legacyOverlayUses(`{/* replaces the .${LEGACY} backdrop */}`)).toEqual([]);
  });

  it('4. the fleet really is on `<Modal>` — the negative above is not zero-by-emptiness', () => {
    // Without this, deleting every dialog in the app would make test 1 pass. The floor is
    // set BELOW the current count on purpose: this pins that the migration happened, not
    // the exact roster, so adding a dialog is not a test edit. Removing several IS.
    const adopters = modalAdopters(files);
    expect(adopters.length).toBeGreaterThanOrEqual(15);
    // Four named surfaces spanning the waves, so the floor cannot be met by one cluster.
    expect(adopters).toContain('app/components/QRCodeModal.js');
    expect(adopters).toContain('app/components/ManageMembers.js');
    expect(adopters).toContain('app/components/FriendInvitePanel.js');
    expect(adopters).toContain('app/components/createGroup.js');
  });
});
