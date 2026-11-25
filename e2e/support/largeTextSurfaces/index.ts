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
//   1. set the status to enforced and add reach, which opens the surface on the page it is given and
//      returns the root to read (and the dialog's content box when the surface is a dialog);
//   2. where needed add answers (reads answered in the browser), reachAt (the viewport the surface
//      is reached at, when it exists only at some widths), extras (the row's own assertions per
//      cell), clock: 'held' (a reach that leaves the page clock paused; plan 89.6-25), or one more
//      row with the same census id and a state;
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
import { rows as browseRows } from './browse';
import { rows as chromeRows } from './chrome';
import { rows as dialogsRows } from './dialogs';
import { rows as dialogShellRows } from './dialogShell';
import { rows as eventRows } from './event';
import { rows as friendsRows } from './friends';
import { rows as gameRows } from './game';
import { rows as groupRows } from './group';
import { rows as homeRows } from './home';
import { rows as linksRows } from './links';
import { rows as membersRows } from './members';
import { rows as nightRows } from './night';
import { rows as planningRows } from './planning';
import { rows as profileARows } from './profileA';
import { rows as profileBRows } from './profileB';
import { rows as qrRows } from './qr';

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
  /**
   * 'held': the row's reach leaves the page clock paused (page.clock.pauseAt), so each cell's settle
   * advances the paused clock instead of waiting on animation frames, which a paused clock never
   * fires (e2e/large-text-sweep.spec.ts ("DECISION Phase 89.6-25 (held-clock)")). The clock is the
   * context's, shared by the font32 page, so such a reach resumes it before it navigates again.
   * Absent: the frame settle, unchanged. Added by plan 89.6-25 (orchestrator ruling D10).
   */
  clock?: 'held';
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

// The full lane (plan 89.6-34's close run, by the large-text-full dispatch input): the two page-zoom
// widths, then 320, 375 and 768 at normal text and at 200%, each in both themes, and the
// default-font-32 cell at 768 in both themes. 18 cells; the PR lane is a subset of it.
const BOTH_THEMES = ['dark', 'light'] as const;
const MATRIX_SIZES = [
  [320, 568],
  [375, 667],
  [768, 1024],
] as const;
export const FULL_CELLS: readonly SweepCell[] = [
  ...BOTH_THEMES.flatMap((theme) => [cell(215, 466, theme, '100', true), cell(187, 333, theme, '100', true)]),
  ...BOTH_THEMES.flatMap((theme) => MATRIX_SIZES.map(([width, height]) => cell(width, height, theme, '100'))),
  ...BOTH_THEMES.flatMap((theme) => MATRIX_SIZES.map(([width, height]) => cell(width, height, theme, '200'))),
  ...BOTH_THEMES.map((theme) => cell(768, 1024, theme, 'font32')),
];

/** The cells a run reads: the full lane when the mode is full, else the PR lane. */
export const laneOf = (mode: 'pr' | 'full'): readonly SweepCell[] => (mode === 'full' ? FULL_CELLS : PR_CELLS);

// The GETs that write, as path patterns: the two invite-token reads lazily mint a token, the
// RSVP link records an answer, and the prompt-settings read persists a clean-up. The self read is
// NOT here: it is sent on without its timezone parameter.
export const WRITE_GETS: readonly RegExp[] = [
  /\/invite-token$/,
  /\/rsvp\/respond$/,
  /\/prompt-settings$/,
];

// Every backend GET handler that writes, one per line, measured with the scan of the sweep's
// row-list test (backend 6c31542: eight handlers). held: the request never leaves the browser
// unless the row answers it, and its path end is in WRITE_GETS. allowed: it is let through, with
// the reason. An entry is added only with its reason, and a new held entry also extends
// WRITE_GETS. The row-list test fails when the backend gains a writing GET this list does not name.
export interface WriteGetHandler {
  /** The route file under the backend's Sonnet/routes. */
  file: string;
  /** The router path of the handler. */
  path: string;
  guard: 'held' | 'allowed';
  why: string;
}
export const WRITE_GET_HANDLERS: readonly WriteGetHandler[] = [
  { file: 'groups.js', path: '/:group_id/invite-token', guard: 'held', why: 'lazily mints and saves the group invite token' },
  { file: 'events.js', path: '/:event_id/invite-token', guard: 'held', why: 'lazily mints and saves the game-night invite token' },
  { file: 'rsvp.js', path: '/respond', guard: 'held', why: 'the email RSVP link: records the answer and spends the token' },
  { file: 'groupPromptSettings.js', path: '/:group_id/prompt-settings', guard: 'held', why: 'persists a clean-up of stale settings while reading them' },
  { file: 'users.js', path: '/:user_id', guard: 'allowed', why: 'the self read: sent on without timezone so its backfill cannot run; its provisioning repair rewrites only the signed-in user own row from the token claims, a no-op on the seeded user' },
  { file: 'groups.js', path: '/user/:user_id', guard: 'allowed', why: 'the same provisioning repair of the signed-in user own row, a no-op on the seeded user' },
  { file: 'events.js', path: '/user/:user_id', guard: 'allowed', why: 'the same provisioning repair of the signed-in user own row, a no-op on the seeded user' },
  { file: 'googleAuth.js', path: '/google/callback', guard: 'allowed', why: 'the Google OAuth redirect target; no page in the sweep fetches it' },
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

// The census ids of the sweep, one per line: the 17 routes, the 33 in-sweep dialogs and the 9
// overlays of 89.6-census.json. D14, D15 and D36 to D42 are owned by a written removal (decision
// D-07) and must NEVER appear here or on a row. The row-list test holds the rows to this list, and
// tools/census-check.cjs in the phase folder holds this list to the census.
export const CENSUS_IDS: readonly string[] = [
  'R01',
  'R02',
  'R03',
  'R04',
  'R05',
  'R06',
  'R07',
  'R08',
  'R09',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
  'R16',
  'R17',
  'D01',
  'D02',
  'D03',
  'D04',
  'D05',
  'D06',
  'D07',
  'D08',
  'D09',
  'D10',
  'D11',
  'D12',
  'D13',
  'D16',
  'D17',
  'D18',
  'D19',
  'D20',
  'D21',
  'D22',
  'D23',
  'D24',
  'D25',
  'D26',
  'D27',
  'D28',
  'D29',
  'D30',
  'D31',
  'D32',
  'D33',
  'D34',
  'D35',
  'O01',
  'O02',
  'O03',
  'O04',
  'O05',
  'O06',
  'O07',
  'O08',
  'O09',
];

// The empty states the census names for in-sweep surfaces (SPEC AC-4: "empty states included"),
// one per line, read from 89.6-census.json at planning. row is the row expected to hold the state
// and owner the plan that owns it. An entry is never removed. It is held only by an ENFORCED row:
// its row, or a shownBy row, which only the owning plan sets, with a comment line beside it saying
// how that enforced row's reach shows the state. The coverage script prints every entry no
// enforced row holds, and with --close fails on any.
export interface EmptyState {
  census: string;
  state: string;
  row: string;
  owner: string;
  shownBy?: string;
}
export const EMPTY_STATES: readonly EmptyState[] = [
  { census: 'R01', state: 'No groups yet', row: 'R01-empty', owner: '89.6-16' },
  { census: 'R01', state: 'Nothing on the calendar (the Upcoming Events card)', row: 'R01-upcoming-empty', owner: '89.6-16' },
  { census: 'R04', state: 'No friends yet', row: 'R04-empty', owner: '89.6-21' },
  { census: 'R05', state: 'No game sessions yet', row: 'R05-game-sessions-empty', owner: '89.6-29' },
  { census: 'R05', state: 'No reviews yet', row: 'R05-game-reviews-empty', owner: '89.6-29' },
  // R07-games holds this state once its reach answers the play-history games read with an empty list.
  { census: 'R07', state: 'No game nights logged yet', row: 'R07-games', owner: '89.6-17' },
  { census: 'R07', state: 'This library is empty', row: 'R07-library-empty', owner: '89.6-42' },
  // Plan 89.6-20 enforces the row and may hand it to 89.6-41; the enforced row id decides, only this label changes then.
  { census: 'R08', state: 'No check-ins running', row: 'R08-empty', owner: '89.6-20' },
  { census: 'R08', state: 'No schedules yet', row: 'R08-noschedules', owner: '89.6-41' },
  { census: 'D02', state: 'No friends yet.', row: 'D02-empty', owner: '89.6-21' },
  { census: 'D04', state: 'the list view with no night: its empty lines and no Next game night hero', row: 'D04-empty', owner: '89.6-40' },
  { census: 'D28', state: 'the empty-collection line', row: 'D28-empty', owner: '89.6-18' },
];

// Every module's rows, in the order the sweep lists them.
export const ALL_ROWS: readonly SurfaceRow[] = [
  ...linksRows,
  ...homeRows,
  ...groupRows,
  ...browseRows,
  ...nightRows,
  ...planningRows,
  ...friendsRows,
  ...profileARows,
  ...eventRows,
  ...dialogsRows,
  ...chromeRows,
  ...profileBRows,
  ...qrRows,
  ...gameRows,
  ...membersRows,
  ...dialogShellRows,
];
