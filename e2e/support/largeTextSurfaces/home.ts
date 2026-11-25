// Surface rows: Home, the Create a new Group dialog and the Calendar sheet. Owner: plan 89.6-16.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE STATES OF HOME (UI-SPEC E6). R01 is the page as the seeded login sees it; the state rows
// answer one read in the browser to show the others: one group with an emoji name and icon, a
// thirty-letter group name beside the icon, no groups, nothing on the calendar, a failed groups
// read and a groups read that never settles. Every answered read is a GET answered in the
// browser: nothing is written, and the sweep's write guard holds every write all the same.
import { expect, type Locator, type Page, type Route } from '@playwright/test';

import { focusRingMeasurement } from '../contrast';
import { scrubbedFetch } from '../scrubbedFetch';
import { EMOJI_NAME, THIRTY_LETTER_WORD } from '../wordLines';
import type { SurfaceRow } from './index';

// The browser calls the same-origin BFF, so the reads are /api/groups/user/<uuid> (the list's own
// read and the page's parallel one) and /api/events/user/<uuid> (the upcoming card's read and the
// calendar's), the matchers of e2e/home-group-list-refresh.spec.ts ("url.pathname.includes('/events/user/')").
const isGroupsRead = (url: URL): boolean => url.pathname.includes('/groups/user/');
const isEventsRead = (url: URL): boolean => url.pathname.includes('/events/user/');
const DIE = '\u{1F3B2}';

/** Open Home and wait for the Your Groups heading. */
async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('heading', { level: 2, name: 'Your Groups' }).waitFor({ state: 'visible', timeout: 15_000 });
}

// R01 is the signed-in Home page (src/app/userHome/UserHomePage.js). The root is the page's main:
// the header strip and the footer around it are rows of their own (the chrome module). The seeded
// login has groups, so the list is loaded when its first card shows.
const reachHome: SurfaceRow['reach'] = async (page) => {
  await openHome(page);
  await page.getByTestId('group-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

type Group = { name?: string; profile_picture_url?: string | null };
type GroupsTransform = (groups: Group[]) => Group[];

// One groups route per page: the sweep runs a reach again on the same page for the light cell, and
// a page's routes outlive its navigations.
const routedGroups = new WeakSet<Page>();

/**
 * Answer every groups read with the real list as transform returns it. A GET answered in the
 * browser, nothing written; the real read goes through scrubbedFetch, never a bare route.fetch, so
 * no session header reaches a public log (DECISION Phase 88.6.2-20). Registered after the guard,
 * so it runs first.
 */
async function routeGroups(page: Page, transform: GroupsTransform): Promise<void> {
  if (routedGroups.has(page)) return;
  routedGroups.add(page);
  await page.route(isGroupsRead, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await scrubbedFetch(route);
    const json: unknown = await response.json();
    const groups = Array.isArray(json) ? (json as Group[]) : [];
    await route.fulfill({ response, json: transform(groups) });
  });
}

/** A reach that opens Home with the groups read rewritten, and waits for the first card. */
const reachWithGroups =
  (transform: GroupsTransform): SurfaceRow['reach'] =>
  async (page) => {
    await routeGroups(page, transform);
    return reachHome(page);
  };

// R01-one: one group, named with an emoji and wearing the die as its icon.
const oneGroup: GroupsTransform = (groups) => groups.slice(0, 1).map((group) => ({ ...group, name: EMOJI_NAME, profile_picture_url: DIE }));
// R01-long: every group, the first named with the thirty-letter word beside the die icon.
const longFirstName: GroupsTransform = (groups) =>
  groups.map((group, index) => (index === 0 ? { ...group, name: THIRTY_LETTER_WORD, profile_picture_url: DIE } : group));

// R01-empty: the groups read answered with no groups (answers, status 200); the events read stays real.
const reachNoGroups: SurfaceRow['reach'] = async (page) => {
  await openHome(page);
  await page.getByText('No groups yet', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R01-upcoming-empty: every events read answered with no events (answers, status 200; a GET
// answered in the browser), so the Upcoming Events card shows Nothing on the calendar. Its column
// is hidden below md (DECISION Phase 88.6-27 (W72)), so the heading is waited for as attached
// (it is in the DOM at every width); the phone cells and the font32 cell, where md does not match,
// measure the page without it.
const reachNothingUpcoming: SurfaceRow['reach'] = async (page) => {
  await reachHome(page);
  await page.getByRole('heading', { name: 'Nothing on the calendar', includeHidden: true }).waitFor({ state: 'attached', timeout: 15_000 });
  return { root: page.locator('main') };
};

// The two states a status only a route can give (answers always replies 200), one route per page.
const routedStatus = new WeakSet<Page>();

// R01-error: the groups read fails with a 500 (a GET answered in the browser, nothing written).
const reachGroupsError: SurfaceRow['reach'] = async (page) => {
  if (!routedStatus.has(page)) {
    routedStatus.add(page);
    await page.route(isGroupsRead, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { error: 'large-text sweep: the groups read failed' } });
    });
  }
  await openHome(page);
  await page.getByText("Couldn't load your groups", { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R01-loading: the groups read never settles (a GET held in the browser until the page closes,
// then dropped; nothing is sent, nothing written), so the list shows its loading line.
const reachGroupsLoading: SurfaceRow['reach'] = async (page) => {
  if (!routedStatus.has(page)) {
    routedStatus.add(page);
    const closed = new Promise<void>((resolve) => page.once('close', () => resolve()));
    await page.route(isGroupsRead, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await closed;
    });
  }
  // The loading return renders no Your Groups heading (only the loading line), so the reach waits for
  // the line itself (flip run 45612916541: the heading wait timed out).
  await page.goto('/');
  await page.getByText('Loading groups...', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// R01-one extras (UI-SPEC E6, a single card does not stretch): in the 768 cells. Where md matches
// (200% text is a style tag the media query does not see) the groups column has its 600px floor,
// so the scroll area has room: the card must be shorter than the area's content box (its height
// less its padding) by more than 1px, unless it is taller than the box and the area scrolls. Where
// md does not match (the font32 cell) the area is as tall as what it holds, so the card's height
// is its own unless it grows: its flex-grow must be 0.
const oneCardNotStretched: SurfaceRow['extras'] = async (page, cell) => {
  if (cell.width !== 768) return;
  const card = page.getByTestId('group-card');
  await expect(card, 'R01-one: not exactly one group card').toHaveCount(1);
  const read = await card.evaluate((element) => {
    const scroller = element.closest('.overflow-y-auto');
    if (!scroller) return null;
    const style = getComputedStyle(scroller);
    return {
      md: window.matchMedia('(min-width: 48rem)').matches,
      card: element.getBoundingClientRect().height,
      content: scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      scrolls: scroller.scrollHeight > scroller.clientHeight + 1,
      grow: getComputedStyle(element).flexGrow,
    };
  });
  if (!read) throw new Error('R01-one: the card sits in no scroll area');
  if (read.grow !== '0') throw new Error(`R01-one: the single card grows (flex-grow ${read.grow})`);
  if (read.md && !read.scrolls && !(read.card < read.content - 1)) {
    throw new Error(`R01-one: the single card is stretched to its scroll area (card ${read.card}px, content box ${read.content}px)`);
  }
};

// R01-upcoming-empty extras: where md matches (the 768 x 1024 cells at 200%, a style tag on the
// root, which a 48rem media query does not see), the empty state is on screen, so the row cannot
// pass while measuring nothing.
const upcomingEmptyShown: SurfaceRow['extras'] = async (page, cell) => {
  if (cell.width !== 768 || cell.mode !== '200') return;
  const visible = await page.getByRole('heading', { name: 'Nothing on the calendar' }).isVisible();
  if (!visible) throw new Error('R01-upcoming-empty: Nothing on the calendar is not on screen at 768 with 200% text');
};

/**
 * The focus ring of locator is drawn whole: focused by keyboard, its ring reaches reach px past the
 * border box (focusRingMeasurement, plan 89.6-14), and no ancestor up to html whose overflow is not
 * visible has a padding box that cuts that grown box (0.5px). The page and body clip only sideways
 * (their vertical overflow is the page's own scroll). Used by e2e/home-large-text.spec.ts and by
 * R01's extras (one helper, never a copy).
 */
export async function expectRingWhole(page: Page, locator: Locator, label: string): Promise<void> {
  const { reach } = await focusRingMeasurement(page, locator, label);
  const clipped = await locator.evaluate((element, grow) => {
    const box = element.getBoundingClientRect();
    const ring = { left: box.left - grow, right: box.right + grow, top: box.top - grow, bottom: box.bottom + grow };
    const found: string[] = [];
    const doc = document.documentElement;
    for (let a = element.parentElement; a; a = a.parentElement) {
      const style = getComputedStyle(a);
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const page = a === doc || a === document.body;
      const rect = a.getBoundingClientRect();
      const left = page ? 0 : rect.left + a.clientLeft;
      const right = page ? doc.clientWidth : left + a.clientWidth;
      const top = rect.top + a.clientTop;
      const bottom = top + a.clientHeight;
      const cuts: string[] = [];
      if (clipsX && ring.left < left - 0.5) cuts.push(`left by ${(left - ring.left).toFixed(2)}px`);
      if (clipsX && ring.right > right + 0.5) cuts.push(`right by ${(ring.right - right).toFixed(2)}px`);
      if (!page && clipsY && ring.top < top - 0.5) cuts.push(`top by ${(top - ring.top).toFixed(2)}px`);
      if (!page && clipsY && ring.bottom > bottom + 0.5) cuts.push(`bottom by ${(ring.bottom - bottom).toFixed(2)}px`);
      if (cuts.length > 0) found.push(`${a.tagName.toLowerCase()}.${String(a.className).split(/\s+/).filter(Boolean).join('.')} cuts it ${cuts.join(', ')}`);
    }
    return found;
  }, reach);
  expect(clipped, `${label}: its focus ring (reach ${reach}px) is cut by an ancestor that clips`).toEqual([]);
}

// R01 extras (owner pick O-M4 = Fixed+, 2026-11-22: 'The box stays 44px, and the icon inside grows
// with the text up to 32px'; outline rule 10 at the Create button): in every cell the first card's
// gear box is 46 x 44 (0.5px) and its icon 20px at normal text (the page-zoom cells), 32px at 200%
// and font32; and the Create button's ring is drawn whole. No gear fails the cell, never passes it.
const homeExtras: SurfaceRow['extras'] = async (page, cell) => {
  const gears = page.getByRole('button', { name: /^Customize / });
  const count = await gears.count();
  if (count < 1) throw new Error('R01: no group card gear (Customize <group>) on Home');
  const read = await gears.first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    const svg = element.querySelector('svg')?.getBoundingClientRect() ?? null;
    return { width: box.width, height: box.height, icon: svg ? { width: svg.width, height: svg.height } : null };
  });
  const problems: string[] = [];
  if (Math.abs(read.width - 46) > 0.5 || Math.abs(read.height - 44) > 0.5) problems.push(`the gear box is ${read.width} x ${read.height}, not 46 x 44`);
  const iconPx = cell.mode === '100' ? 20 : 32;
  if (!read.icon) problems.push('the gear has no icon');
  else if (Math.abs(read.icon.width - iconPx) > 0.5 || Math.abs(read.icon.height - iconPx) > 0.5) problems.push(`the gear icon is ${read.icon.width} x ${read.icon.height}, not ${iconPx}`);
  if (problems.length > 0) throw new Error(`R01: ${problems.join('; ')}`);
  await expectRingWhole(page, page.getByRole('button', { name: 'Create new group' }).first(), 'R01: the Create button');
};

export const rows: SurfaceRow[] = [
  { id: 'R01', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', reach: reachHome, extras: homeExtras },
  { id: 'R01-one', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'one group', reach: reachWithGroups(oneGroup), extras: oneCardNotStretched },
  { id: 'R01-long', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'a thirty-letter group name', reach: reachWithGroups(longFirstName) },
  { id: 'R01-empty', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'no groups', reach: reachNoGroups, answers: (url) => (isGroupsRead(url) ? [] : undefined) },
  { id: 'R01-upcoming-empty', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'nothing on the calendar', reach: reachNothingUpcoming, answers: (url) => (isEventsRead(url) ? [] : undefined), extras: upcomingEmptyShown },
  { id: 'R01-error', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'the groups read failed', reach: reachGroupsError },
  { id: 'R01-loading', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'the groups read in flight', reach: reachGroupsLoading },
  { id: 'D01', census: 'D01', kind: 'dialog', owner: '89.6-16', status: 'pending' },
  // The Calendar sheet is the second half of the 89.6-16 block (orchestrator split, 2026-11-23).
  { id: 'D04', census: 'D04', kind: 'dialog', owner: '89.6-40', status: 'pending' },
];
