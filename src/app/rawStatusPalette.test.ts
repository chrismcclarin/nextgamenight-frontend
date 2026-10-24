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

import { assertExactCounts, assertRosterShape, type Exemption } from '../test-utils/exemption';
import { lineAt, sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const RAW_STATUS_RED = /(?:^|[\s"'`:])(?:hover:|dark:)?(?:text|bg|border)-red-(?:50|200|600|700|800)(?=$|[\s"'`/])/;

// Recorded exceptions — each is a DECISION, not an oversight, and is matched on the literal's
// text so a line shift cannot silently drop it from the roster. The provenance lives in each
// entry's why and owner, which assertRosterShape checks, not in a comment nothing reads. The
// literal is bounded by the scanner's own boundary set, with no slash in the trailing
// lookahead, so an opacity variant of the class is not exempted with it (R5-M2).
// DECISION Phase 88.6.2-17 (R5-M4): the shared exemption schema, keyed by file and checked per entry by assertRosterShape + assertExactCounts, over the hand-rolled file+literal array with a total-count check — a total lets one entry's surplus hide another's fossil, and a provenance written only in a comment cannot be checked (R5-M4; 88.6 D-19).
const RECORDED_EXCEPTIONS: Record<string, Exemption & { literal: RegExp }> = {
  'app/components/GroupSettings.js': {
    literal: /(?:^|[\s"'`:])border-t border-red-200(?=$|[\s"'`])/,
    sites: 1,
    why: 'the Danger Zone 1px decorative divider: outside WCAG 1.4.11, kept as a look call by plan 88.6-20',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-20 (§4.4 + P6)' },
  },
};

// The exemption is scoped to the excepted CLASS, not to the string it sits in: strip each
// recorded literal out of the chunk first (counting it), then test what is left. Skipping
// the whole chunk instead let a new raw red class added to the same className pass silently
// (code review round 4, M1 — demonstrated at c6d0e50 with `text-red-600` on the divider).
function chunkVerdict(rel: string, text: string): { hit: boolean; seen: number } {
  let residual = text;
  let seen = 0;
  const e = RECORDED_EXCEPTIONS[rel];
  if (e && e.literal.test(residual)) {
    seen = 1;
    residual = residual.replace(e.literal, ' ');
  }
  return { hit: RAW_STATUS_RED.test(residual), seen };
}

function rawStatusRedSites(): { hits: string[]; exceptionsSeen: Record<string, number> } {
  const hits: string[] = [];
  const exceptionsSeen: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const chunk of stringChunks(src)) {
      const { hit, seen } = chunkVerdict(rel, chunk.text);
      if (hit) hits.push(`${rel}:${lineAt(src, chunk.offset)}`);
      if (seen > 0) exceptionsSeen[rel] = (exceptionsSeen[rel] ?? 0) + seen;
    }
  }
  return { hits: hits.sort(), exceptionsSeen };
}

describe('raw red palette on status ink (UI review 2026-09-30, Top Fix 1)', () => {
  // One walk of the tree for both assertions (code review round 4, M3): each `it` used to lex
  // every file the walk visits on its own: 202 non-test source files at FE 1ef0f4d, because
  // `sourceFiles` skips tests and src/test-utils; R5-M5 corrected the round-4 figure, which
  // counted tests too.
  const scan = rawStatusRedSites();

  it('no non-test source file carries a raw red status class in a string literal', () => {
    // Was, at FE 3751aeb: app/components/FeedbackButton.js:476, app/components/FeedbackForm.js:576
    // and :637, app/components/QRCodeModal.js:136, app/components/createGroup.js:282,
    // app/userProfile/page.js:1945 — six sites, all converged in the same commit as this file.
    expect(scan.hits).toEqual([]);
  });

  it('every recorded exception is on the D-19 schema and is seen at exactly its counted sites', () => {
    expect(assertRosterShape(RECORDED_EXCEPTIONS)).toEqual([]);
    expect(assertExactCounts(RECORDED_EXCEPTIONS, scan.exceptionsSeen)).toEqual([]);
  });

  it('chunkVerdict strips only the recorded literal, only in its file, and tests what is left (R5-M1/M3, R5-M2)', () => {
    const exempt = 'app/components/GroupSettings.js';
    const divider = 'mb-6 pt-6 border-t border-red-200';
    // (a) a new raw red class added beside the excepted divider is still a hit (R5-M1).
    expect(chunkVerdict(exempt, `${divider} text-red-600`)).toEqual({ hit: true, seen: 1 });
    // (b) the bare divider is the one accepted shape.
    expect(chunkVerdict(exempt, divider)).toEqual({ hit: false, seen: 1 });
    // (c) the exemption is scoped to its file: the same divider anywhere else is a hit.
    expect(chunkVerdict('app/components/Other.js', divider)).toEqual({ hit: true, seen: 0 });
    // (d) one strip per chunk: a second copy of the literal is left behind and caught.
    expect(chunkVerdict(exempt, 'border-t border-red-200 border-t border-red-200')).toEqual({
      hit: true,
      seen: 1,
    });
    // (e) an opacity variant is a different class, which the scanner's own lookahead catches,
    // so the literal is bounded by the scanner's boundary set and does not exempt it (R5-M2).
    expect(chunkVerdict(exempt, `${divider}/60`)).toEqual({ hit: true, seen: 0 });
    // No roster literal carries the g flag: test() would carry lastIndex across chunks, and
    // replace() would strip every copy while seen counts one.
    expect(Object.values(RECORDED_EXCEPTIONS).every((e) => !e.literal.global)).toBe(true);
  });
});
