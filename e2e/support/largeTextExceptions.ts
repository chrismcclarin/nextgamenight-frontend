// The exceptions list of the large-text checks (Phase 89.6-08; SPEC R4 as amended by A3 and A10).
//
// DECISION Phase 89.6-08 (exceptions): the cut check skips exactly five texts, each owned (SPEC A3
// (1) to (4) and A10), chosen OVER a per-spec skip (it would grow unseen) and OVER zero exceptions
// (the owner kept each on purpose). Each entry binds a selector to a source snippet that must
// occur once, so a moved site reds the manifest test instead of silently widening the skip. A
// sixth entry needs a SPEC amendment. Changing this is a decision, not a cleanup.
//
// DECISION Phase 89.6-08 (exceptions, surfaces): inside the THREE surfaces another phase owns
// (the month grid A3-2, the calendar list-row titles A3-3, the tutorial screens A3-4: SPEC A3,
// "kept as built until then") the split and held entries are cleared too, not only the cut check,
// chosen OVER cut-only for all five (the group page then reports 21 month-grid day numbers as
// split words that no plan of this phase may fix). The header site name (A3-1) and the game
// description clamp (A10) stay cut-only: they name one text, not a surface. This is the
// orchestrator's reading of A3, ruling R7: planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/HANDOFFS.md ("Orchestrator rulings during the build");
// the owner can overrule it, and then clears: 'surface' becomes 'cut' on those three entries.
// HOW: the page read is not changed. The cell is read once as it is; when it reports a split or a
// held word and one of the three surfaces is on the page, it is read a second time with the text
// of those surfaces set to visibility hidden (every box keeps its place, and the read skips text
// that draws nothing), and the split and held lists of the second read are the cell's. What the
// second read no longer reports is written into the cell's record as cleared, never dropped.
//
// DECISION Phase 89.6-16 (exceptions, spill): inside the same three surfaces a SPILL entry (a word
// painting outside its filled box) is cleared too, and a spill alone also starts the second read,
// chosen OVER leaving spill uncleared there (Home at 768 / 200% stacks its columns by GR, the month
// grid leaves its compact mode, and full month tiles show game names that spill: Phase 88.9.2's
// defect, whose own pick R22 = List replaces the grid at large text) and OVER narrowing the Home
// row's root (the calendar column's header and legend would go unswept). Orchestrator ruling D12:
// planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/DECISIONS.md ("D12. Plan 16")
// The split and held lists are taken from the second read exactly when they were before (the first
// read reported a split or a held word), so nothing about how cut, split or held clear changes; the
// cut-only entries (A3-1, A10) clear no spill. Undo: drop spill here and the Home 768 cell reds.
// Changing this is a decision, not a cleanup.
//
// DECISION Phase 89.6 R16 (2026-11-26; the independent narrow check's findings 5-C, 6-A and 6-B):
// (5-C) a cut-only entry (A3-1, A10) excuses its OWN clamp and nothing else: text under it that a
// box cuts sideways is still read as cut, chosen OVER skipping every cut kind there (a word wider
// than the description's card, cut by the clamp's own overflow, was read by no check).
// (6-B) at the page-zoom widths only an entry marked ownClamp (A3-3: its selector names the clamped
// titles themselves) can clear a clip, chosen OVER all three surface selectors: the other two name
// CONTAINERS, and whatever the tutorial overlay's box or the month grid's box itself cut was cleared.
// (6-A) and only when the clamp is the nearest clipper and no box above it cuts the title further:
// e2e/support/wordLines.ts ("AMENDED R16 (2026-11-26, narrow-check findings 6-A and 6-B)").
// Changing this is a decision, not a cleanup.
import type { Locator } from '@playwright/test';

import { readLargeTextCell, readPageZoomCell, type LargeTextCellRead, type PageZoomRead } from './wordLines';

export interface LargeTextException {
  id: string;
  what: string;
  /** Who owns the text until it is rebuilt or removed. */
  owner: string;
  /** The site the selector was read from: the snippet occurs exactly once in the file. */
  source: { file: string; snippet: string; alsoOnce?: readonly string[]; folder?: string };
  /** Matches the excepted element only: an existing attribute or role first, then its class chain. */
  selector: string;
  /** cut: only the cut check skips the text, and only its own clamp (a sideways cut is still read). surface: split, held and spilling words inside it are cleared too. */
  clears: 'cut' | 'surface';
  /** The selector names the clamped texts themselves, not a container: at a page-zoom width a text cut by this, its own clamp, alone is cleared. */
  ownClamp?: true;
}

export const EXCEPTIONS: readonly LargeTextException[] = [
  {
    id: 'A3-1',
    what: 'header site name',
    owner: 'SPEC A3 (1), owner pick R21',
    source: { file: 'src/app/Header.js', snippet: 'leading-7 whitespace-nowrap @max-[calc(230px_+_0.625rem)]:sr-only' },
    selector: 'nav a[href="/"] > span.whitespace-nowrap',
    clears: 'cut',
  },
  {
    id: 'A3-2',
    what: 'month-grid cells: the weekday row and the day cells (day numbers, counts, compact tiles, +N more)',
    owner: 'SPEC A3 (2), Phase 88.9.2',
    source: { file: 'src/app/components/CalendarMonthView.js', snippet: '<div className="@container grid grid-cols-7 gap-1">' },
    selector: 'div.grid.grid-cols-7',
    clears: 'surface',
  },
  {
    id: 'A3-3',
    what: 'calendar list-row titles: the title and the game line of a row, in the list and in the sheet',
    owner: 'SPEC A3 (3), Phase 88.9.2',
    source: {
      file: 'src/app/components/CalendarListView.js',
      snippet: "'font-bold text-base truncate'",
      alsoOnce: ["'font-bold text-base min-w-0 line-clamp-2'", "'block text-base line-clamp-2 mt-0.5'", "'hidden sm:block text-sm truncate mt-0.5'"],
    },
    selector: '[role="button"] :is(.font-bold.text-base.truncate, .font-bold.text-base.line-clamp-2, p.text-sm.truncate.mt-0\\.5, p.text-base.line-clamp-2.mt-0\\.5)',
    clears: 'surface',
    ownClamp: true,
  },
  {
    id: 'A3-4',
    what: 'tutorial screens',
    owner: 'SPEC A3 (4), the v2.1 Tutorial rewrite',
    source: { file: 'src/app/components/tutorial/TutorialOverlay.js', snippet: 'fixed inset-0 z-60 bg-[var(--color-bg-overlay)]', folder: 'src/app/components/tutorial' },
    selector: 'div.fixed.inset-0.z-60',
    clears: 'surface',
  },
  {
    id: 'A10',
    what: 'game page description clamp (three lines with Show More)',
    owner: 'SPEC A10, owner pick OW-1 = A',
    source: { file: 'src/app/gameDetail/page.js', snippet: 'line-clamp-3 md:line-clamp-none' },
    selector: '#game-description',
    clears: 'cut',
    // DECISION Phase 89.6-29 (D42, owner ruling 2026-11-26, his words "D42) yes."): A10 is its own
    // clamp at the page-zoom widths too, the treatment D27 gave the list-row titles (A3-3), chosen
    // OVER removing the clamp (it is his pick OW-1 = A) and OVER leaving the game page failing or
    // pending at 215 and 187 wide. It clears ONE thing: the description text when the box that
    // clips it is the description's own three-line clamp and nothing cuts it further (Show More is
    // drawn there and one press shows the whole text). It does NOT clear the same text cut by a
    // parent box; the entry stays cut-only everywhere else. KNOWN LIMIT: a control inside the
    // clamped lines would be cleared with them, as under A3-3 (the description is plain text, so
    // the app draws none; recorded for Phase 89.7). The read is otherwise frozen (orchestrator
    // decision D40): this flag is the whole change. Pinned by
    // e2e/large-text-sweep.spec.ts ("The description clamp (owner ruling D42"). Removing the flag
    // is a decision, not a cleanup.
    ownClamp: true,
  },
];

/** Every entry's selector: the cut check skips text in or under them. */
export const EXCEPTION_SELECTORS: readonly string[] = EXCEPTIONS.map((entry) => entry.selector);

/** The selectors of the three surfaces another phase owns. */
export const SURFACE_EXCEPTION_SELECTORS: readonly string[] = EXCEPTIONS.filter((entry) => entry.clears === 'surface').map((entry) => entry.selector);

/** The selectors of the cut-only entries: each excuses its own clamp, never a sideways cut. */
export const CUT_ONLY_EXCEPTION_SELECTORS: readonly string[] = EXCEPTIONS.filter((entry) => entry.clears === 'cut').map((entry) => entry.selector);

/** The selectors that name clamped texts (not containers): the only clips a page-zoom read may clear. */
export const OWN_CLAMP_SELECTORS: readonly string[] = EXCEPTIONS.filter((entry) => entry.ownClamp === true).map((entry) => entry.selector);

export interface ClearedBySurface {
  split: string[];
  held: string[];
  /** Words that spill out of their box inside one of the three surfaces (ruling D12, plan 89.6-16). */
  spill: string[];
  /** Page-zoom losses that are a surface's own clamp (orchestrator ruling D27, plan 89.6-40). */
  lost?: string[];
}

/** a minus b as lists: each entry of b takes away one equal entry of a. */
function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = [...b];
  return a.filter((entry) => {
    const at = left.indexOf(entry);
    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
}

/**
 * Read one cell under the exceptions list. The cut check skips all five texts; the split, held and
 * spill lists are those of the page with the three owned surfaces' text hidden. cleared holds what
 * the surfaces accounted for.
 */
export async function readCellUnderExceptions(root: Locator, options: { dialog?: Locator } = {}): Promise<{ read: LargeTextCellRead; cleared: ClearedBySurface }> {
  const readOptions = { dialog: options.dialog, exceptions: EXCEPTION_SELECTORS, cutOnlyExceptions: CUT_ONLY_EXCEPTION_SELECTORS };
  const read = await readLargeTextCell(root, readOptions);
  const none = { read, cleared: { split: [], held: [], spill: [] } };
  const splitOrHeld = read.split.length > 0 || read.held.length > 0;
  const spills = read.spill.length > 0;
  if (!splitOrHeld && !spills) return none;
  const page = root.page();
  const present = await page.evaluate((selectors) => selectors.some((selector) => document.querySelector(selector) !== null), [...SURFACE_EXCEPTION_SELECTORS]);
  if (!present) return none;

  // Visibility only: no box moves, so every word outside the surfaces is read exactly as before.
  const hide = SURFACE_EXCEPTION_SELECTORS.map((selector) => `:is(${selector}), :is(${selector}) *`).join(', ');
  const style = await page.addStyleTag({ content: `${hide} { visibility: hidden !important; }` });
  let without: LargeTextCellRead;
  try {
    without = await readLargeTextCell(root, readOptions);
  } finally {
    await style.evaluate((element) => (element as Element).remove());
  }
  // Each list comes from the second read only when the first read reported something in it, so a
  // read started by a spill alone leaves split and held exactly as the first read gave them.
  const split = splitOrHeld ? without.split : read.split;
  const held = splitOrHeld ? without.held : read.held;
  const spill = spills ? without.spill : read.spill;
  return {
    read: { ...read, split, held, spill },
    cleared: { split: minus(read.split, split), held: minus(read.held, held), spill: minus(read.spill, spill) },
  };
}

/**
 * Read one page-zoom cell under the exceptions list: the cut check skips all five texts, and a
 * text clipped by its own clamp and nothing further (the clipper is the element an ownClamp
 * selector matches for that text) is cleared, not lost (orchestrator ruling D27, plan 89.6-40:
 * SPEC A3 (3) puts the list-row titles' clamp under Phase 88.9.2; at page zoom that same clamp
 * read as a clip; narrowed by R16). cleared holds the losses a surface accounted for.
 */
export async function readPageZoomCellUnderExceptions(root: Locator, options: { dialog?: Locator } = {}): Promise<{ read: PageZoomRead; cleared: string[] }> {
  const read = await readPageZoomCell(root, { dialog: options.dialog, exceptions: EXCEPTION_SELECTORS, cutOnlyExceptions: CUT_ONLY_EXCEPTION_SELECTORS, surfaceClamps: OWN_CLAMP_SELECTORS });
  return { read, cleared: read.ownClamp ?? [] };
}
