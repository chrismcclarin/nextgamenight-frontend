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

export const rows: SurfaceRow[] = [
  { id: 'D23', census: 'D23', kind: 'dialog', owner: '89.6-18', status: 'enforced', reach: reachBrowseGames, answers: answerSuggestions, extras: browseToolbarExtras },
  { id: 'D28', census: 'D28', kind: 'dialog', owner: '89.6-18', status: 'pending' },
  { id: 'R07-suggestions', census: 'R07', kind: 'route', owner: '89.6-18', status: 'pending' },
  { id: 'R08-suggestions', census: 'R08', kind: 'route', owner: '89.6-18', status: 'pending' },
];
