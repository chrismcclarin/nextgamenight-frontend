// The surface rows of the large-text sweep (Phase 89.6-08, SPEC R4), read by
// e2e/large-text-sweep.spec.ts ("DECISION Phase 89.6-08 (sweep)").
//
// WHAT A ROW IS. One surface the census names, in one state: a route, a dialog or an overlay. The
// sweep declares one test per row. A row carries its own id (unique), the census id it stands for
// (several rows may share one: a state, or a part of a long page), the plan that owns it, and a
// status. A pending row is listed and skipped; an enforced row is reached and read in every cell
// of the lane.
//
// HOW A SWEEP PLAN TURNS A ROW ON (plans 89.6-10, -11, -16 to -29). In its OWN module only:
//   1. set status: 'enforced' and add reach, which opens the surface on the page it is given and
//      returns the root to read (and the dialog's content box when the surface is a dialog);
//   2. where needed add answers (reads answered in the browser), reachAt (the viewport the surface
//      is reached at, when it exists only at some widths), extras (the row's own assertions per
//      cell), or one more row with the same census id and a state;
//   3. push that commit BEFORE the fix, so the row is shown red in CI, then the fix commit green.
// No floor, registry row or ci.yml line is edited to turn a row on: the coverage script
// (scripts/large-text-sweep-coverage.mjs) expects every cell of every enforced row from the
// results the spec writes. A row is never deleted or given to another plan without the
// orchestrator. Rows are never removed: a surface a written removal owns (census D14, D15 and D36
// to D42, decision D-07) simply has no row, and tools/census-check.cjs in the phase folder fails
// when one appears.
//
// THE ROOT. Pass a root that holds the rows of the surface: the page's main, or the dialog's
// content box (a Radix dialog is a portal outside main). The split check stacks side-by-side
// containers up to the nearest [data-room] mark, else up to the root.
//
// answers ALWAYS REPLIES 200. It is called for every GET the page sends (documents and scripts
// too), so it returns undefined for everything it does not mean to answer; a value is sent back
// as JSON with status 200 (holdWrites' answerGet and the WRITE_GETS route both fulfil 200). A
// state that needs a backend error status (a 403 used link, a 500) registers its own page.route
// inside its reach, after the guard and before the navigation that triggers the read: Playwright
// runs the newest matching route first, so it wins over the guard's answer.
//
// THE WRITE GUARD (phase rule 12). sweepWriteGuard is registered on EVERY page a sweep test opens,
// before that page's first navigation. It holds every non-GET on every URL (the backend on :4000
// and the BFF proxy on :3000/api alike), sends the self read on without its timezone parameter
// (the backend backfills a missing time zone from it), and keeps the GETs that write (WRITE_GETS)
// in the browser: answered when the row answers them, otherwise held and listed in writeGets,
// which fails the test by name (a surface read while one of its reads hangs is not the surface).
import type { Locator, Page } from '@playwright/test';

import { holdWrites, type WriteHold } from '../inFlight';
import { rows as linksRows } from './links';

export type RowKind = 'route' | 'dialog' | 'overlay';

export interface SweepCell {
  /** e.g. 320x568-dark-200, 768x1024-dark-font32, 215x466-dark-100-zoom. */
  id: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  mode: '100' | '200' | 'font32';
  /** A page-zoom width (SPEC A8): normal text, the lighter check. */
  zoom: boolean;
}

export interface SurfaceRow {
  /** Unique among all rows. */
  id: string;
  /** The census id this row stands for (89.6-census.json: R01 to R17, the in-sweep dialogs, O01 to O09). */
  census: string;
  kind: RowKind;
  /** The plan that turns the row on: 89.6-NN. */
  owner: string;
  status: 'pending' | 'enforced';
  /** The state the row holds, when the census id has more than one row. */
  state?: string;
  /** The viewport the surface is reached at, when it exists only at some widths (FL-17c). */
  reachAt?: { width: number; height: number };
  /** Opens the surface on the page it is given; required on an enforced row. */
  reach?: (page: Page) => Promise<{ root: Locator; dialog?: Locator }>;
  /** Reads answered in the browser, always with status 200; undefined lets the request through. */
  answers?: (url: URL) => unknown;
  /** The row's own assertions, run after each cell's read. */
  extras?: (page: Page, cell: SweepCell) => Promise<void>;
}

const cell = (width: number, height: number, theme: 'light' | 'dark', mode: '100' | '200' | 'font32', zoom = false): SweepCell => ({
  id: `${width}x${height}-${theme}-${mode}${zoom ? '-zoom' : ''}`,
  width,
  height,
  theme,
  mode,
  zoom,
});

// The PR lane, one per line: two page-zoom cells at normal text (SPEC A8), three 200% cells in
// dark (the journeys scheme), ONE light cell, and the default-font-32 cell.
export const PR_CELLS: readonly SweepCell[] = [
  cell(215, 466, 'dark', '100', true),
  cell(187, 333, 'dark', '100', true),
  cell(320, 568, 'dark', '200'),
  cell(375, 667, 'dark', '200'),
  cell(768, 1024, 'dark', '200'),
  cell(375, 667, 'light', '200'),
  cell(768, 1024, 'dark', 'font32'),
];

// The GETs that write, as path patterns: the two invite-token reads lazily mint a token, the
// RSVP link records an answer, and the prompt-settings read persists a clean-up. The self read is
// NOT here: it is sent on without its timezone parameter.
export const WRITE_GETS: readonly RegExp[] = [
  /\/invite-token$/,
  /\/rsvp\/respond$/,
  /\/prompt-settings$/,
];

export const isWriteGet = (url: URL): boolean => WRITE_GETS.some((pattern) => pattern.test(url.pathname));

const isSelfReadWithTimezone = (url: URL): boolean => /\/users\/[^/]+$/.test(url.pathname) && url.searchParams.has('timezone');

export interface SweepHold extends WriteHold {
  /** The pathname of every GET that writes which the row did not answer: held, never sent. */
  writeGets: string[];
}

/**
 * The sweep's write guard for ONE page. Call it before that page's first navigation, on every
 * page a sweep test opens (holdWrites routes one page only).
 */
export async function sweepWriteGuard(page: Page, row: Pick<SurfaceRow, 'answers'>): Promise<SweepHold> {
  // First, so it runs last: every non-GET on every URL is held, and the row's answers are served.
  const hold = await holdWrites(page, { answerGet: row.answers });
  const writeGets: string[] = [];
  // Registered after the hold, so it runs before it: the self read goes on without timezone, and
  // falls back to the hold, which may still answer it for the row.
  await page.route(isSelfReadWithTimezone, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }
    const url = new URL(request.url());
    url.searchParams.delete('timezone');
    await route.fallback({ url: url.toString() });
  });
  await page.route(isWriteGet, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      await route.fallback();
      return;
    }
    const url = new URL(request.url());
    const answer = row.answers?.(url);
    if (answer !== undefined) {
      await route.fulfill({ status: 200, json: answer });
      return;
    }
    // Held: never answered, never handed on.
    writeGets.push(url.pathname);
  });
  return { ...hold, writeGets };
}

// Every module's rows, in the order the sweep lists them.
export const ALL_ROWS: readonly SurfaceRow[] = [...linksRows];
