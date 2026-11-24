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
import type { Locator } from '@playwright/test';

import { readLargeTextCell, type LargeTextCellRead } from './wordLines';

export interface LargeTextException {
  id: string;
  what: string;
  /** Who owns the text until it is rebuilt or removed. */
  owner: string;
  /** The site the selector was read from: the snippet occurs exactly once in the file. */
  source: { file: string; snippet: string; alsoOnce?: readonly string[]; folder?: string };
  /** Matches the excepted element only: an existing attribute or role first, then its class chain. */
  selector: string;
  /** cut: only the cut check skips the text. surface: split and held words inside it are cleared too. */
  clears: 'cut' | 'surface';
}

export const EXCEPTIONS: readonly LargeTextException[] = [
  {
    id: 'A3-1',
    what: 'header site name',
    owner: 'SPEC A3 (1), owner pick R21',
    source: { file: 'src/app/Header.js', snippet: 'leading-7 whitespace-nowrap @max-[calc(186px_+_3.375rem)]:sr-only' },
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
  },
];

/** Every entry's selector: the cut check skips text in or under them. */
export const EXCEPTION_SELECTORS: readonly string[] = EXCEPTIONS.map((entry) => entry.selector);

/** The selectors of the three surfaces another phase owns. */
export const SURFACE_EXCEPTION_SELECTORS: readonly string[] = EXCEPTIONS.filter((entry) => entry.clears === 'surface').map((entry) => entry.selector);

export interface ClearedBySurface {
  split: string[];
  held: string[];
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
 * Read one cell under the exceptions list. The cut check skips all five texts; the split and held
 * lists are those of the page with the three owned surfaces' text hidden. cleared holds what the
 * surfaces accounted for.
 */
export async function readCellUnderExceptions(root: Locator, options: { dialog?: Locator } = {}): Promise<{ read: LargeTextCellRead; cleared: ClearedBySurface }> {
  const readOptions = { dialog: options.dialog, exceptions: EXCEPTION_SELECTORS };
  const read = await readLargeTextCell(root, readOptions);
  const none = { read, cleared: { split: [], held: [] } };
  if (read.split.length === 0 && read.held.length === 0) return none;
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
  return {
    read: { ...read, split: without.split, held: without.held },
    cleared: { split: minus(read.split, without.split), held: minus(read.held, without.held) },
  };
}
