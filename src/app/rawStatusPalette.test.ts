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
 * SCOPE: status shades only (50 / 200 / 600 / 700 / 800). The red-500 left in src is the Header.js
 * 10px unread DOT, a filled dot with no text, and it is deliberately NOT in this roster (widening
 * the shade list to include it is a decision, not a cleanup).
 * AMENDED Phase 88.9-01 (M3b): the two NotificationBell.js count badges carry a digit, so they
 * were text on a ground (white on red-500, 3.76:1); they now fill with the declared badge token
 * (#b91c1c both themes, 6.47:1) and carry no raw red class, pinned by
 * src/app/miniPicks.test.ts ("1. 88.9 M3").
 * Comment text is stripped first, so DECISION markers that NAME the old classes do not
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
// AMENDED Phase 88.9-34 (owner pick O14a, 88.9-PICKS-B8B.json, 2026-11-07): the roster's only entry, the Danger Zone divider, moved onto border-status-error, so the record is empty; the R5-M4 schema is kept OVER deleting it, so a future owner-approved exception needs no new machinery.
const RECORDED_EXCEPTIONS: Record<string, Exemption & { literal: RegExp }> = {};

// The exemption is scoped to the excepted CLASS, not to the string it sits in: strip each
// recorded literal out of the chunk first (counting it), then test what is left. Skipping
// the whole chunk instead let a new raw red class added to the same className pass silently
// (code review round 4, M1 — demonstrated at c6d0e50 with `text-red-600` on the divider).
// The roster is a parameter so test 3 can prove the strip mechanism on a fixture roster now
// that the real one is empty; the scan calls it with two arguments and reads the real roster.
function chunkVerdict(
  rel: string,
  text: string,
  roster: Record<string, Exemption & { literal: RegExp }> = RECORDED_EXCEPTIONS,
): { hit: boolean; seen: number } {
  let residual = text;
  let seen = 0;
  const e = roster[rel];
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
    // Was, at FE 3751aeb: src/app/components/FeedbackButton.js, src/app/components/FeedbackForm.js
    // (two sites), src/app/components/QRCodeModal.js, src/app/components/createGroup.js,
    // src/app/userProfile/page.js — six sites, all converged in the same commit as this file.
    expect(scan.hits).toEqual([]);
  });

  it('every recorded exception is on the D-19 schema and is seen at exactly its counted sites', () => {
    expect(assertRosterShape(RECORDED_EXCEPTIONS)).toEqual([]);
    expect(assertExactCounts(RECORDED_EXCEPTIONS, scan.exceptionsSeen)).toEqual([]);
  });

  it('O14a (88.9): the Danger Zone divider is no longer an exception — the raw red step is a hit in GroupSettings.js like everywhere else', () => {
    // AMENDED Phase 88.9-34 (owner pick O14a): this test used to prove the strip mechanism on the
    // real divider entry. That entry is retired, so the mechanism is proven on a one-entry fixture
    // roster below, and the real divider is asserted to be an ordinary hit.
    const groupSettings = 'app/components/GroupSettings.js';
    const divider = 'mb-6 pt-6 border-t border-red-200';
    const fixtureKey = 'app/components/__FixtureExempt.js';
    const FIXTURE_ROSTER: Record<string, Exemption & { literal: RegExp }> = {
      [fixtureKey]: {
        literal: /(?:^|[\s"'`:])border-t border-red-200(?=$|[\s"'`])/,
        sites: 1,
        why: 'synthetic fixture entry: proves the strip mechanism now that the real roster is empty',
        owner: { kind: 'decision', marker: 'DECISION fixture (rawStatusPalette test 3, 88.9-34)' },
      },
    };
    expect(assertRosterShape(FIXTURE_ROSTER)).toEqual([]);

    // The strip mechanism, on the fixture roster (R5-M1/M3, R5-M2).
    // (a) a new raw red class added beside the excepted literal is still a hit (R5-M1).
    expect(chunkVerdict(fixtureKey, `${divider} text-red-600`, FIXTURE_ROSTER)).toEqual({ hit: true, seen: 1 });
    // (b) the bare literal is the one accepted shape.
    expect(chunkVerdict(fixtureKey, divider, FIXTURE_ROSTER)).toEqual({ hit: false, seen: 1 });
    // (c) the exemption is scoped to its file: the same literal anywhere else is a hit.
    expect(chunkVerdict('app/components/Other.js', divider, FIXTURE_ROSTER)).toEqual({ hit: true, seen: 0 });
    // (d) one strip per chunk: a second copy of the literal is left behind and caught.
    expect(
      chunkVerdict(fixtureKey, 'border-t border-red-200 border-t border-red-200', FIXTURE_ROSTER),
    ).toEqual({ hit: true, seen: 1 });
    // (e) an opacity variant is a different class, which the scanner's own lookahead catches,
    // so the literal is bounded by the scanner's boundary set and does not exempt it (R5-M2).
    expect(chunkVerdict(fixtureKey, `${divider}/60`, FIXTURE_ROSTER)).toEqual({ hit: true, seen: 0 });
    // No roster literal carries the g flag: test() would carry lastIndex across chunks, and
    // replace() would strip every copy while seen counts one.
    expect(
      [...Object.values(RECORDED_EXCEPTIONS), ...Object.values(FIXTURE_ROSTER)].every((e) => !e.literal.global),
    ).toBe(true);

    // O14a, against the real (empty) roster: the shipped divider is now an ordinary hit in
    // GroupSettings.js, and the new divider on the status-error border is not.
    expect(RECORDED_EXCEPTIONS).toEqual({});
    expect(chunkVerdict(groupSettings, divider)).toEqual({ hit: true, seen: 0 });
    expect(chunkVerdict(groupSettings, 'mb-6 pt-6 border-t border-status-error')).toEqual({ hit: false, seen: 0 });
    expect(chunkVerdict('app/components/Other.js', divider)).toEqual({ hit: true, seen: 0 });
    expect(chunkVerdict(groupSettings, `${divider}/60`)).toEqual({ hit: true, seen: 0 });
  });
});
