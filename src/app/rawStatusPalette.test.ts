/**
 * Phase 88.6 close-out (UI review 2026-09-30, Top Fix 1) — no raw red palette on error ink.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * `text-red-600`, `bg-red-50`, `border-red-200`, `text-red-800` and `hover:text-red-700` are
 * light-only literals: red-600 measures about 2.9:1 on the dark card (plan 88.6-20's
 * measurement, the reason `GroupSettings.js` moved to `text-content-status-error` — see the
 * DECISION marker there), and the pink box (`bg-red-50 border-red-200 text-red-800`) does not
 * flip with the theme at all. The theme-aware pair is `text-content-status-error` for ink and
 * `bg-status-error-subtle text-content-status-error border border-status-error` for a box
 * (`FriendInvitePanel.js` result block, `friends/page.js` bulk-invite block — shipped
 * precedent). Five sites the phase EDITED kept the raw classes (createGroup, FeedbackForm x2,
 * FeedbackButton, QRCodeModal) and one hover survived on `userProfile/page.js`; this suite is
 * the pin that they were converged and that nothing brings the literals back.
 *
 * SCOPE: status shades only (50 / 200 / 600 / 700 / 800). The `bg-red-500` unread badge on the
 * header bell (`Header.js`, `NotificationBell.js`) is a filled dot, not text on a ground, and is
 * deliberately NOT in this roster — widening the shade list to include it is a decision, not a
 * cleanup. Comment text is stripped first, so DECISION markers that NAME the old classes do not
 * count.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const RAW_STATUS_RED = /(?:^|[\s"'`:])(?:hover:|dark:)?(?:text|bg|border)-red-(?:50|200|600|700|800)(?=$|[\s"'`/])/;

/**
 * Recorded exceptions — each is a DECISION, not an oversight, and is matched on the literal's
 * text so a line shift cannot silently drop it from the roster.
 *   - GroupSettings Danger Zone divider: `border-t border-red-200` KEPT by plan 88.6-20 (its
 *     marker: "a 1px decorative divider is outside 1.4.11 and its treatment is a look call with
 *     no floor to breach — routed to `.planning/deferred/phase-88.6.md`").
 */
const RECORDED_EXCEPTIONS: { file: string; literal: RegExp }[] = [
  { file: 'app/components/GroupSettings.js', literal: /\bborder-t border-red-200\b/ },
];

function rawStatusRedSites(): { hits: string[]; exceptionsSeen: number } {
  const hits: string[] = [];
  let exceptionsSeen = 0;
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const chunk of stringChunks(src)) {
      // The exemption is scoped to the excepted CLASS, not to the string it sits in: strip each
      // recorded literal out of the chunk first (counting it), then test what is left. Skipping
      // the whole chunk instead let a new raw red class added to the same className pass silently
      // (code review round 4, M1 — demonstrated at c6d0e50 with `text-red-600` on the divider).
      let residual = chunk.text;
      for (const e of RECORDED_EXCEPTIONS) {
        if (e.file !== rel || !e.literal.test(residual)) continue;
        exceptionsSeen += 1;
        residual = residual.replace(e.literal, ' ');
      }
      if (RAW_STATUS_RED.test(residual)) hits.push(`${rel}:${lineAt(src, chunk.offset)}`);
    }
  }
  return { hits: hits.sort(), exceptionsSeen };
}

describe('raw red palette on status ink (UI review 2026-09-30, Top Fix 1)', () => {
  // One walk of the tree for both assertions (code review round 4, M3: each `it` used to lex all
  // ~357 source files on its own).
  const scan = rawStatusRedSites();

  it('no non-test source file carries a raw red status class in a string literal', () => {
    // Was, at FE 3751aeb: app/components/FeedbackButton.js:476, app/components/FeedbackForm.js:576
    // and :637, app/components/QRCodeModal.js:136, app/components/createGroup.js:282,
    // app/userProfile/page.js:1945 — six sites, all converged in the same commit as this file.
    expect(scan.hits).toEqual([]);
  });

  it('every recorded exception is still present (the roster does not go stale)', () => {
    expect(scan.exceptionsSeen).toBe(RECORDED_EXCEPTIONS.length);
  });
});
