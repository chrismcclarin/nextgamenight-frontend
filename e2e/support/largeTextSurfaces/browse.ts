// Surface rows: Browse games, Games to Bring and the suggestion rows of the group and planning pages. Owner: plan 89.6-18.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE STAGING. The suggestions read is answered in the browser with five games, no pictures, the
// long and the emoji names among them, so the chips and the Browse games cards carry the long-text
// cases whatever the seed holds. Nothing is pressed that writes: the rows open dialogs and read;
// no row ticks, saves or presses Try again, and the sweep's guard holds every write all the same.
import type { Locator, Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';
import { stageNight } from './night';
import { rows as planningRows } from './planning';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id, as in e2e/support/largeTextSurfaces/members.ts ("No fallback id").
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the browse rows open that group');
  return id;
};

const suggestion = (n: number, name: string, min: number, max: number) => ({
  id: `89618000-0000-4000-8000-00000000000${n}`,
  name,
  thumbnail_url: null,
  min_players: min,
  max_players: max,
  playing_time: 45,
  weight: 2.2,
  owners: [] as string[],
  avg_group_rating: null,
  review_count: 0,
});
// UI-SPEC E3 long-text: a two-word name, a long name with a colon, the 30-letter word, an emoji name.
export const BROWSE_GAMES = [
  suggestion(1, 'Ticket to Ride', 2, 5),
  suggestion(2, 'Twilight Imperium: Fourth Edition', 3, 6),
  suggestion(3, 'Grandmasterboardgamecollective', 1, 4),
  suggestion(4, 'Weekend Warriors 🎲', 2, 4),
  suggestion(5, 'Azul', 2, 4),
];

// The group suggestions read (src/lib/api.ts ("getGroupSuggestions: (groupId: string")), matched on the path as
// e2e/browse-games-modal.spec.ts ("url.pathname.startsWith('/api/suggestions/group/')") matches it.
const isSuggestionsRead = (url: URL): boolean => url.pathname.startsWith('/api/suggestions/group/');

/** The suggestions read answered with the five games; undefined for every other read. */
export const answerSuggestions = (url: URL): unknown => (isSuggestionsRead(url) ? { suggestions: BROWSE_GAMES } : undefined);

const browseDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Browse games' });

/** Group page, Create Event, then Browse more in the suggestion slot; read from the dialog's top. */
async function reachBrowseGames(page: Page): Promise<{ root: Locator; dialog: Locator }> {
  await page.goto(`/groupHomePage?id=${groupId()}`);
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
  const browseMore = page.getByTestId('quick-suggestions-slot').getByRole('button', { name: 'Browse more' });
  await browseMore.waitFor({ state: 'visible', timeout: 15_000 });
  await browseMore.click();
  const dialog = browseDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByRole('button', { name: BROWSE_GAMES[0].name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
}

// D23 extras (register R5-01a, X-02). In every cell: the toolbar scrolls sideways by at most 1px and
// every control in it lies inside its box; its position is static when the dialog's content box is
// narrower than 12 times the root font size (the 12rem dialog switch on the dialog container,
// src/app/components/Modal.tsx ("@container/dialog")), sticky otherwise (the size-lg dialog is
// about 730px wide at 768, above the switch). At the 320 / 200% cell only: at 320 x 700 the sort drop-down can be scrolled into
// view, inside the window and inside the dialog; the cell's size is restored after. One joined
// line is thrown, so a failure fails the cell.
const browseToolbarExtras = async (page: Page, cell: SweepCell): Promise<void> => {
  const read = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="browse-more-controls"]') as HTMLElement | null;
    if (!bar) return null;
    let shell: HTMLElement | null = bar.parentElement;
    while (shell && !getComputedStyle(shell).containerName.split(' ').includes('dialog')) shell = shell.parentElement;
    if (!shell) return null;
    const box = bar.getBoundingClientRect();
    const outside: string[] = [];
    for (const el of Array.from(bar.querySelectorAll('button, input, select, label'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 30);
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) outside.push(`"${name}" ${r.left.toFixed(1)}-${r.right.toFixed(1)} outside the toolbar ${box.left.toFixed(1)}-${box.right.toFixed(1)}`);
    }
    const shellStyle = getComputedStyle(shell);
    const content = shell.clientWidth - Number.parseFloat(shellStyle.paddingLeft) - Number.parseFloat(shellStyle.paddingRight);
    return {
      sideways: bar.scrollWidth - bar.clientWidth,
      outside,
      position: getComputedStyle(bar).position,
      content,
      rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
  if (read === null) throw new Error('D23: no Browse games toolbar inside a dialog container in this cell');
  const problems: string[] = [];
  if (read.sideways > 1) problems.push(`the toolbar scrolls sideways by ${read.sideways}px`);
  problems.push(...read.outside);
  const expected = read.content < 12 * read.rem ? 'static' : 'sticky';
  if (read.position !== expected) problems.push(`the toolbar is ${read.position}, expected ${expected} (dialog content ${read.content.toFixed(1)}px, switch ${12 * read.rem}px)`);
  if (cell.width === 320 && cell.mode === '200') {
    await page.setViewportSize({ width: 320, height: 700 });
    const select = browseDialog(page).locator('#bm-sort');
    await select.scrollIntoViewIfNeeded();
    const x02 = await select.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const d = (el.closest('[role="dialog"]') as HTMLElement).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, dTop: d.top, dBottom: d.bottom, dLeft: d.left, dRight: d.right, vw: document.documentElement.clientWidth, vh: window.innerHeight };
    });
    const line = JSON.stringify(x02);
    if (x02.top < -0.5 || x02.bottom > x02.vh + 0.5 || x02.left < -0.5 || x02.right > x02.vw + 0.5) problems.push(`X-02: the sort drop-down is not inside the window at 320 x 700 (${line})`);
    if (x02.top < x02.dTop - 0.5 || x02.bottom > x02.dBottom + 0.5 || x02.left < x02.dLeft - 0.5 || x02.right > x02.dRight + 0.5) problems.push(`X-02: the sort drop-down is not inside the dialog at 320 x 700 (${line})`);
    await page.setViewportSize({ width: cell.width, height: cell.height });
    await toDialogTop(browseDialog(page));
  }
  if (problems.length > 0) throw new Error(`D23: ${problems.join('; ')}`);
};

// GAMES TO BRING (census D28). The night page is staged by night.ts's stageNight (every member's
// RSVP reads yes, so the Bringing control shows), and the picker's two reads, at
// src/app/components/BringGamePicker.js ("const [gamesRes, bringsRes] = await Promise.all(["),
// are answered by one route registered after it, so it wins
// over the staged brings: three owned games with no pictures, and one bring of the viewer's own for
// Weekend Warriors so a ticked row shows its stand-in. The viewer's id is read from the self read's
// response as it passes (a listener, no route: the guard still strips its timezone parameter).
const BRING_GAMES = [
  { id: '89618000-0000-4000-8000-0000000000b1', name: 'E2E Bring Game', thumbnail_url: null },
  { id: '89618000-0000-4000-8000-0000000000b2', name: 'Weekend Warriors', thumbnail_url: null },
  { id: '89618000-0000-4000-8000-0000000000b3', name: 'Grandmasterboardgamecollective', thumbnail_url: null },
];
const eventPath = (): string => {
  const path = process.env.E2E_EVENT_DETAIL_PATH ?? '';
  if (path === '') throw new Error('E2E_EVENT_DETAIL_PATH must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the Games to Bring rows open that night');
  return path;
};
let viewerId: string | null = null;
type BringMode = 'listed' | 'empty' | 'load-failed';

/** The owned-games and event-brings reads answered for the mode; undefined for every other read. */
export const answerBringReads = (url: URL, mode: BringMode = 'listed'): unknown => {
  if (url.pathname.startsWith('/api/user-games/user/')) return mode === 'empty' ? [] : BRING_GAMES;
  if (url.pathname.startsWith('/api/event-brings/event/')) {
    if (viewerId === null) return [];
    const game = BRING_GAMES[1];
    return [{ id: '89618000-0000-4000-8000-0000000000c1', user_id: viewerId, game_id: game.id, Game: { id: game.id, name: game.name }, User: { id: viewerId, username: 'E2E viewer' } }];
  }
  return undefined;
};

// One set of routes per page: the sweep runs a reach again on the same page for the light cell, and
// a page's routes outlive its navigations. failing is set only after the night page has loaded
// (D28-load-failed: airplane mode once the page is up, SPEC A4, no seed change) and cleared before
// each navigation, so the page's own Bringing read is never the one aborted.
const bringStaged = new WeakMap<Page, { failing: boolean }>();
async function stageBring(page: Page, mode: BringMode): Promise<{ failing: boolean }> {
  const known = bringStaged.get(page);
  if (known) {
    known.failing = false;
    return known;
  }
  const state = { failing: false };
  bringStaged.set(page, state);
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (response.request().method() !== 'GET' || !/^\/api\/users\/[^/]+$/.test(url.pathname) || !response.ok()) return;
    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body?.id === 'string') viewerId = body.id;
    } catch {
      // Not JSON: the brings answer then holds no row of the viewer's.
    }
  });
  await stageNight(page);
  await page.route(
    (url) => url.pathname.startsWith('/api/user-games/user/') || url.pathname.startsWith('/api/event-brings/event/'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (state.failing) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, json: answerBringReads(new URL(route.request().url()), mode) });
    },
  );
  return state;
}

const bringDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Games to Bring', exact: true });

/** The staged night, the Bringing section's control, the picker open and settled; read from its top. */
async function openGamesToBring(page: Page, mode: BringMode): Promise<{ root: Locator; dialog: Locator }> {
  const state = await stageBring(page, mode);
  await page.goto(eventPath());
  const heading = page.getByRole('heading', { name: 'Bringing', exact: true });
  await heading.waitFor({ state: 'visible', timeout: 15_000 });
  const control = heading.locator('xpath=..').getByRole('button', { name: /^(Add games|Edit)$/ });
  await control.waitFor({ state: 'visible', timeout: 15_000 });
  if (mode === 'load-failed') state.failing = true;
  await control.click();
  const dialog = bringDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  if (mode === 'listed') await dialog.getByRole('checkbox', { name: 'Weekend Warriors', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  // The visible line, not the polite region's copy of the same sentence (CI run 45774653092: two matches).
  if (mode === 'empty') await dialog.locator('p.text-content-muted', { hasText: "You haven't added any games to your collection yet." }).waitFor({ state: 'visible', timeout: 15_000 });
  if (mode === 'load-failed') await dialog.locator('p.text-content-status-error').first().waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
}
const reachGamesToBring: SurfaceRow['reach'] = (page) => openGamesToBring(page, 'listed');
const reachBringEmpty: SurfaceRow['reach'] = (page) => openGamesToBring(page, 'empty');
const reachBringFailed: SurfaceRow['reach'] = (page) => openGamesToBring(page, 'load-failed');

// D28 extras: Save can be reached (scrolled into view, inside the dialog box). Read-only: the
// button is never pressed. The dialog is put back at its top for the next cell.
const saveReachable = async (page: Page): Promise<void> => {
  const dialog = bringDialog(page);
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await save.scrollIntoViewIfNeeded();
  const read = await save.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const d = (el.closest('[role="dialog"]') as HTMLElement).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, dTop: d.top, dBottom: d.bottom, dLeft: d.left, dRight: d.right, vh: window.innerHeight };
  });
  await toDialogTop(dialog);
  const line = JSON.stringify(read);
  if (read.top < read.dTop - 0.5 || read.bottom > read.dBottom + 0.5 || read.left < read.dLeft - 0.5 || read.right > read.dRight + 0.5) throw new Error(`D28: Save is not inside the dialog once scrolled to (${line})`);
  if (read.top < -0.5 || read.bottom > read.vh + 0.5) throw new Error(`D28: Save cannot be scrolled into the window (${line})`);
};
// D28-load-failed extras: the failure line is visible and Save is disabled (A03's branch, staged).
const failedBranchHolds = async (page: Page): Promise<void> => {
  const dialog = bringDialog(page);
  const problems: string[] = [];
  if (!(await dialog.locator('p.text-content-status-error').first().isVisible())) problems.push('the load-failure line is not visible');
  if (!(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled())) problems.push('Save is not disabled after a failed load');
  if (problems.length > 0) throw new Error(`D28-load-failed: ${problems.join('; ')}`);
};

// THE SUGGESTION SLOT (register R5-03), in Create Event on the group page (census R07) and on the
// planning page (census R08). The root is the slot itself; the rest of the Create Event body is plan
// 89.6-24's row (D21), so no dialog is handed back. The planning page opens Create Event from its
// email-link parameters (src/app/groupPlanning/page.js ("Auto-open the createEvent modal when the URL carries prefill params OR")),
// and its own reads are answered as planning.ts's R08 row answers them (the prompt-settings read
// writes), imported, never copied.
const planningAnswers = planningRows.find((row) => row.id === 'R08')?.answers;
if (!planningAnswers) throw new Error('browse.ts: planning.ts has no R08 row with answers for R08-suggestions');
const tomorrow = (): string => {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
type SlotState = 'chips' | 'empty' | 'failed';
const failRouted = new WeakSet<Page>();
async function reachSuggestionSlot(page: Page, path: string, state: SlotState = 'chips'): Promise<{ root: Locator }> {
  if (state === 'failed' && !failRouted.has(page)) {
    failRouted.add(page);
    await page.route(
      (url) => isSuggestionsRead(url),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.abort('failed');
      },
    );
  }
  await page.goto(path);
  if (path.startsWith('/groupHomePage')) await page.getByRole('button', { name: 'Create Event', exact: true }).click();
  const slot = page.getByTestId('quick-suggestions-slot');
  await slot.waitFor({ state: 'visible', timeout: 15_000 });
  if (state === 'chips') await slot.getByRole('button', { name: 'Browse more' }).waitFor({ state: 'visible', timeout: 15_000 });
  if (state === 'empty') await page.getByTestId('quick-suggestions-empty').waitFor({ state: 'visible', timeout: 15_000 });
  if (state === 'failed') await page.getByTestId('quick-suggestions-failed').waitFor({ state: 'visible', timeout: 15_000 });
  // Read with the Create Event dialog at its top, as every dialog row is read: a slot scrolled into
  // view at the reach width sat above the page at 187 x 333 (CI run 45774653092, R08-suggestions).
  await toDialogTop(page.getByRole('dialog').filter({ has: slot }));
  await settleAnimations(slot);
  return { root: slot };
}

// R5-03 extras: every chip shows its whole name, each word on one line unless that word alone is
// wider than its chip. One compact line per chip is thrown, with the boxes, so a red names the cause.
const chipsWhole = async (page: Page): Promise<void> => {
  const problems = await page.evaluate(() => {
    const slot = document.querySelector('[data-testid="quick-suggestions-slot"]');
    if (!slot) return ['no quick-suggestions slot'];
    const width = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().width) : -1);
    const out: string[] = [];
    for (const chip of Array.from(slot.querySelectorAll('button[title]'))) {
      const name = chip.querySelector('span.text-sm');
      const text = name?.firstChild;
      if (!name || !text || text.nodeType !== Node.TEXT_NODE) continue;
      const value = text.textContent ?? '';
      for (const match of value.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, match.index ?? 0);
        range.setEnd(text, (match.index ?? 0) + match[0].length);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        const lines = new Set(rects.map((r) => Math.round(r.top))).size;
        const wordWidth = rects.reduce((sum, r) => sum + r.width, 0);
        if (lines > 1 && wordWidth <= width(chip)) out.push(`"${match[0]}" ${lines} lines (word ${Math.round(wordWidth)}, slot ${width(slot)}, strip ${width(chip.parentElement)}, chip ${width(chip)}, name ${width(name)})`);
      }
    }
    return out;
  });
  if (problems.length > 0) throw new Error(`R5-03: ${problems.join('; ')}`);
};
const groupPath = (): string => `/groupHomePage?id=${groupId()}`;
const planningPath = (): string => `/groupPlanning?group_id=${groupId()}&prefillDate=${tomorrow()}&prefillTime=19:00`;
const answerNoSuggestions = (url: URL): unknown => (isSuggestionsRead(url) ? { suggestions: [] } : undefined);
const answerPlanningSuggestions = (url: URL): unknown => answerSuggestions(url) ?? planningAnswers(url);

// D23-loading: Browse games on its first load. The slot's reads are answered (its chips bring Browse
// more: the button renders only with chips, src/app/components/QuickSuggestions.js ("Browse more")
// sits inside the chips branch, so the slot always reads before the dialog), and every suggestions
// read after Browse more is pressed is held, never answered, so the dialog shows its loading line.
const loadingHeld = new WeakMap<Page, { holding: boolean }>();
const reachBrowseLoading: SurfaceRow['reach'] = async (page) => {
  let gate = loadingHeld.get(page);
  if (!gate) {
    const fresh = { holding: false };
    gate = fresh;
    loadingHeld.set(page, fresh);
    await page.route(
      (url) => isSuggestionsRead(url),
      async (route) => {
        if (route.request().method() !== 'GET' || !fresh.holding) {
          await route.fallback();
          return;
        }
        // Held: never answered, never handed on.
      },
    );
  }
  gate.holding = false;
  await page.goto(groupPath());
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
  const browseMore = page.getByTestId('quick-suggestions-slot').getByRole('button', { name: 'Browse more' });
  await browseMore.waitFor({ state: 'visible', timeout: 15_000 });
  gate.holding = true;
  await browseMore.click();
  const dialog = browseDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByText('Loading suggestions...', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

export const rows: SurfaceRow[] = [
  { id: 'D23', census: 'D23', kind: 'dialog', owner: '89.6-18', status: 'enforced', reach: reachBrowseGames, answers: answerSuggestions, extras: browseToolbarExtras },
  { id: 'D28', census: 'D28', kind: 'dialog', owner: '89.6-18', status: 'enforced', state: 'three owned games, one ticked (the no-picture stand-in)', reach: reachGamesToBring, answers: (url) => answerBringReads(url, 'listed'), extras: saveReachable },
  { id: 'D28-load-failed', census: 'D28', kind: 'dialog', owner: '89.6-18', state: 'load-failed', status: 'enforced', reach: reachBringFailed, extras: failedBranchHolds },
  { id: 'D28-empty', census: 'D28', kind: 'dialog', owner: '89.6-18', state: 'empty', status: 'enforced', reach: reachBringEmpty, answers: (url) => answerBringReads(url, 'empty') },
  { id: 'D23-loading', census: 'D23', kind: 'dialog', owner: '89.6-18', state: 'loading', status: 'enforced', reach: reachBrowseLoading, answers: answerSuggestions },
  { id: 'R07-suggestions', census: 'R07', kind: 'route', owner: '89.6-18', status: 'enforced', state: 'five chips in Create Event', reach: (page) => reachSuggestionSlot(page, groupPath()), answers: answerSuggestions, extras: chipsWhole },
  { id: 'R07-suggestions-empty', census: 'R07', kind: 'route', owner: '89.6-18', state: 'suggestions empty', status: 'enforced', reach: (page) => reachSuggestionSlot(page, groupPath(), 'empty'), answers: answerNoSuggestions },
  { id: 'R07-suggestions-failed', census: 'R07', kind: 'route', owner: '89.6-18', state: 'suggestions failed', status: 'enforced', reach: (page) => reachSuggestionSlot(page, groupPath(), 'failed') },
  { id: 'R08-suggestions', census: 'R08', kind: 'route', owner: '89.6-18', status: 'enforced', state: 'five chips in Create Event on the planning page', reach: (page) => reachSuggestionSlot(page, planningPath()), answers: answerPlanningSuggestions, extras: chipsWhole },
];
