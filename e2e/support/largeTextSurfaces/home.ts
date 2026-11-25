// Surface rows: Home, the Create a new Group dialog and the Calendar sheet. Owner: plan 89.6-16;
// the Calendar sheet rows (D04, D04-empty): plan 89.6-40.
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
import { settleAnimations } from '../inFlight';
import { scrubbedFetch } from '../scrubbedFetch';
import { EMOJI_NAME, THIRTY_LETTER_WORD } from '../wordLines';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';

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

// D01: Create a new Group, opened from Home's first "+ Create New Group" (its name is "Create new
// group"). The dialog is its own root (a tall dialog scrolls as one below the 12rem dialog
// container), returned as the dialog so the sweep settles its box before each cell.
const createDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Create a new Group', exact: true });
async function openCreateGroup(page: Page): Promise<Locator> {
  await openHome(page);
  await page.getByRole('button', { name: 'Create new group' }).first().click();
  const dialog = createDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}
const reachCreateGroup: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCreateGroup(page);
  return { root: dialog, dialog };
};

// The create POST, the matcher of e2e/home-loading-and-create-group.spec.ts ("const isCreateGroupPath = (url: URL) => url.pathname === '/api/groups';").
// Each route below is registered inside the reach, after the sweep's write guard, so it runs first:
// the write never leaves the browser and never reaches the guard's hold. A held write is released
// to the network if interception is switched off while it is held (CI 41396760316, see
// e2e/lane-a-tap-floors-desktop.spec.ts ("A held write is released")), so nothing may unroute this
// page while D01-busy holds its POST; the sweep test unroutes nothing before its pages close.
const isCreateGroup = (url: URL): boolean => url.pathname === '/api/groups';
const createRouted = new WeakSet<Page>();

/** Type the emoji name and press Create Group. */
async function submitCreate(dialog: Locator): Promise<void> {
  await dialog.getByRole('textbox', { name: 'Group Name' }).fill(EMOJI_NAME);
  await dialog.getByRole('button', { name: 'Create Group', exact: true }).click();
}

// D01-error: the create POST answered 500 in the browser; the dialog shows its alert line.
const reachCreateError: SurfaceRow['reach'] = async (page) => {
  if (!createRouted.has(page)) {
    createRouted.add(page);
    await page.route(isCreateGroup, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { error: 'large-text sweep: the create failed' } });
    });
  }
  const dialog = await openCreateGroup(page);
  await submitCreate(dialog);
  await dialog.locator('#create-group-error[role="alert"]').waitFor({ state: 'visible', timeout: 15_000 });
  return { root: dialog, dialog };
};

// D01-busy: the create POST held in the browser until the page closes, then ANSWERED 500 (never
// handed on: no fallback, no continue), so the button stays busy for every cell.
const reachCreateBusy: SurfaceRow['reach'] = async (page) => {
  if (!createRouted.has(page)) {
    createRouted.add(page);
    const release = new Promise<void>((resolve) => page.once('close', () => resolve()));
    await page.route(isCreateGroup, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await release;
      await route.fulfill({ status: 500 }).catch(() => undefined);
    });
  }
  const dialog = await openCreateGroup(page);
  await submitCreate(dialog);
  // Busy keeps the label and an sr-only suffix adds ", creating" (Chromium puts a space before the comma).
  await dialog.getByRole('button', { name: /^create group ?, creating$/i }).and(dialog.locator('[aria-disabled="true"]')).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: dialog, dialog };
};

// D04: the phone Calendar sheet (src/app/userHome/UserHomePage.js ("Req 11b (UI-SPEC S4): the phone calendar sheet")), opened
// from the phone button named Calendar. The button is hidden from md up (DECISION Phase 88.6-27
// (W72)), so the row is reached at 375 x 667 (reachAt); the sheet carries no md:hidden of its own
// (the Req 11b note in UserHomePage.js: an open dialog is never hidden by width), so it stays open
// in the 768 cells, where it is read as a wider sheet. The list is loaded when its Upcoming events
// header (a button, absent from the loading skeleton) shows.
const calendarSheet = (page: Page): Locator => page.getByRole('dialog', { name: 'Calendar', exact: true });
async function openCalendarSheet(page: Page): Promise<Locator> {
  await openHome(page);
  await page.getByRole('button', { name: /^Calendar(, .*)?$/ }).click();
  const dialog = calendarSheet(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}
const reachCalendarSheet: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCalendarSheet(page);
  await dialog.getByRole('button', { name: 'Upcoming events', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: dialog, dialog };
};

// D04-empty (EMPTY_STATES, census D04): every upcoming-events read answered with an empty list (the
// page's read and the calendar's; GETs answered in the browser), so the list shows its one empty
// line and no Next game night card is mounted.
const reachCalendarSheetEmpty: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCalendarSheet(page);
  await dialog.getByText('No events', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await expect(dialog.getByText('Next game night', { exact: true }), 'D04-empty: a Next game night card is shown with no nights').toHaveCount(0);
  return { root: dialog, dialog };
};

// An event row of the list is a button that holds a heading, inside one of the list's sections
// (the two section headers sit inside a heading and hold none; the Next game night card is not in
// a section), the selector of e2e/calendar-list-sections.spec.ts ("An event row is the role=button element that contains a heading").
const calendarRows = (dialog: Locator): Locator => dialog.locator('section').getByRole('button').filter({ has: dialog.page().getByRole('heading') });

// The sheet's close (x), read FIRST, before anything is scrolled (the panel is overflow-hidden, which
// is still a scroll container: scrolling the x into view would bring an x pushed past the edge back
// on screen before it is measured). The panel has not scrolled sideways; the x lies inside the
// viewport and the panel (0.5px); its box is plan 89.6-06's held size icon box, 52 x 44 at every
// text size (pick O-M4 Fixed+), and its icon follows the text: 20px at normal text, 32px at 200%
// and font32.
async function sheetCloseProblems(dialog: Locator, cell: SweepCell, tag: string): Promise<string[]> {
  const read = await dialog.evaluate((panel) => {
    const close = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Close') ?? null;
    if (!close) return null;
    const box = close.getBoundingClientRect();
    const svg = close.querySelector('svg')?.getBoundingClientRect() ?? null;
    const at = panel.getBoundingClientRect();
    return {
      scrollLeft: panel.scrollLeft,
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      panel: { left: at.left, right: at.right, top: at.top, bottom: at.bottom },
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
      icon: svg ? { width: svg.width, height: svg.height } : null,
    };
  });
  if (!read) return [`${tag}: the sheet has no Close button`];
  const problems: string[] = [];
  const { box, panel, viewport } = read;
  if (read.scrollLeft !== 0) problems.push(`${tag}: the sheet panel is scrolled sideways by ${read.scrollLeft}px`);
  if (box.left < -0.5 || box.right > viewport.width + 0.5 || box.top < -0.5 || box.bottom > viewport.height + 0.5) {
    problems.push(`${tag}: the close is not inside the viewport (close ${box.left} to ${box.right} by ${box.top} to ${box.bottom}; viewport ${viewport.width} x ${viewport.height})`);
  }
  if (box.left < panel.left - 0.5 || box.right > panel.right + 0.5 || box.top < panel.top - 0.5 || box.bottom > panel.bottom + 0.5) {
    problems.push(`${tag}: the close is not inside the sheet panel (close ${box.left} to ${box.right}; panel ${panel.left} to ${panel.right})`);
  }
  if (Math.abs(box.width - 52) > 0.5 || Math.abs(box.height - 44) > 0.5) problems.push(`${tag}: the close box is ${box.width} x ${box.height}, not 52 x 44`);
  const iconPx = cell.mode === '100' ? 20 : 32;
  if (!read.icon) problems.push(`${tag}: the close has no icon`);
  else if (Math.abs(read.icon.width - iconPx) > 0.5 || Math.abs(read.icon.height - iconPx) > 0.5) problems.push(`${tag}: the close icon is ${read.icon.width} x ${read.icon.height}, not ${iconPx}`);
  return problems;
}

interface ListReach {
  rows: number;
  firstRow: number;
  scroller: string | null;
  scrollerHeight: number;
  last: { top: number; bottom: number; left: number; right: number } | null;
  visible: { top: number; bottom: number; left: number; right: number } | null;
  viewport: { width: number; height: number };
}

// Every night can be reached (pick CAL S2): the element that scrolls the list (the nearest ancestor
// of the last row, the row included, whose overflow-y is auto or scroll) is at least one row tall,
// and the last row, scrolled into view, lies inside that scroller's visible box and the viewport
// (0.5px). A row inside a 0px region still reports a box after scrolling, hence both checks. The row
// is scrolled to the scroller's END, as a finger scrolls a list to its last row: block nearest
// honours the region's 5.75rem scroll padding (W17, a keyboard-focus margin), which at 200% text is
// 184px of a 227px region at 768 x 1024 and put the row's top at the padding's edge, below the
// visible box (evidence run 45718098297); that is a focus read, not a reach read.
async function readListReach(dialog: Locator): Promise<ListReach> {
  return calendarRows(dialog).evaluateAll((found) => {
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    if (found.length === 0) return { rows: 0, firstRow: 0, scroller: null, scrollerHeight: 0, last: null, visible: null, viewport };
    const last = found[found.length - 1] as HTMLElement;
    let scroller: HTMLElement | null = last;
    while (scroller) {
      const overflow = getComputedStyle(scroller).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') break;
      scroller = scroller.parentElement;
    }
    const firstRow = found[0].getBoundingClientRect().height;
    last.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
    const box = last.getBoundingClientRect();
    const rect = scroller?.getBoundingClientRect() ?? null;
    return {
      rows: found.length,
      firstRow,
      scroller: scroller ? `${scroller.tagName.toLowerCase()}.${String(scroller.className).split(/\s+/).filter(Boolean).slice(0, 4).join('.')}` : null,
      scrollerHeight: scroller?.clientHeight ?? 0,
      last: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
      visible: scroller && rect ? { top: rect.top + scroller.clientTop, bottom: rect.top + scroller.clientTop + scroller.clientHeight, left: rect.left, right: rect.right } : null,
      viewport,
    };
  });
}

function listReachProblems(read: ListReach, tag: string): string[] {
  if (read.rows === 0 || !read.last) return [`${tag}: the Calendar sheet shows no event row`];
  if (!read.scroller || !read.visible) return [`${tag}: no element scrolls the list`];
  const problems: string[] = [];
  if (read.scrollerHeight < read.firstRow - 0.5) problems.push(`${tag}: the list's scroller (${read.scroller}) is ${read.scrollerHeight}px tall, under one row (${read.firstRow}px)`);
  const { last, visible, viewport } = read;
  if (last.top < visible.top - 0.5 || last.bottom > visible.bottom + 0.5) {
    problems.push(`${tag}: the last row, scrolled into view, is outside its scroller (row ${last.top} to ${last.bottom}; scroller ${visible.top} to ${visible.bottom})`);
  }
  if (last.left < -0.5 || last.right > viewport.width + 0.5 || last.top < -0.5 || last.bottom > viewport.height + 0.5) {
    problems.push(`${tag}: the last row, scrolled into view, is outside the viewport (row ${last.left} to ${last.right} by ${last.top} to ${last.bottom})`);
  }
  return problems;
}

// The owner's phone width, where the 12rem switch does not engage (430px is about 13.4rem at 200%).
const OWNER_PHONE = { width: 430, height: 932 };

// D04 extras, in every cell: the close first, then the list can be reached. In the 375 x 667 dark
// 200% cell only, the same list read at 430 x 932 (no sweep cell is 430 wide), printed as one
// 89.6-40 line (CI keeps nothing from a passing test), then 375 x 667 is set back. The dialog is
// put back at its top so the next cell reads it as reached. Every problem throws as one line.
const calendarSheetExtras: SurfaceRow['extras'] = async (page, cell) => {
  const dialog = calendarSheet(page);
  const tag = `D04 ${cell.id}`;
  const problems = await sheetCloseProblems(dialog, cell, tag);
  problems.push(...listReachProblems(await readListReach(dialog), tag));
  if (cell.id === '375x667-dark-200') {
    await page.setViewportSize(OWNER_PHONE);
    await settleAnimations(dialog);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const wide = await readListReach(dialog);
    process.stdout.write(`89.6-40 D04 430x932-dark-200: list scroller ${wide.scroller ?? 'none'} ${wide.scrollerHeight}px tall, first row ${wide.firstRow}px, ${wide.rows} rows\n`);
    problems.push(...listReachProblems(wide, `${tag} at 430 x 932`));
    await page.setViewportSize({ width: cell.width, height: cell.height });
    await settleAnimations(dialog);
  }
  await toDialogTop(dialog);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D04-empty extras: the close alone (the list has no row to reach).
const calendarSheetEmptyExtras: SurfaceRow['extras'] = async (page, cell) => {
  const problems = await sheetCloseProblems(calendarSheet(page), cell, `D04-empty ${cell.id}`);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'R01', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', reach: reachHome, extras: homeExtras },
  { id: 'R01-one', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'one group', reach: reachWithGroups(oneGroup), extras: oneCardNotStretched },
  { id: 'R01-long', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'a thirty-letter group name', reach: reachWithGroups(longFirstName) },
  { id: 'R01-empty', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'no groups', reach: reachNoGroups, answers: (url) => (isGroupsRead(url) ? [] : undefined) },
  { id: 'R01-upcoming-empty', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'nothing on the calendar', reach: reachNothingUpcoming, answers: (url) => (isEventsRead(url) ? [] : undefined), extras: upcomingEmptyShown },
  { id: 'R01-error', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'the groups read failed', reach: reachGroupsError },
  { id: 'R01-loading', census: 'R01', kind: 'route', owner: '89.6-16', status: 'enforced', state: 'the groups read in flight', reach: reachGroupsLoading },
  { id: 'D01', census: 'D01', kind: 'dialog', owner: '89.6-16', status: 'enforced', reach: reachCreateGroup },
  { id: 'D01-error', census: 'D01', kind: 'dialog', owner: '89.6-16', status: 'enforced', state: 'the create failed', reach: reachCreateError },
  { id: 'D01-busy', census: 'D01', kind: 'dialog', owner: '89.6-16', status: 'enforced', state: 'the create in flight', reach: reachCreateBusy },
  // The Calendar sheet is the second half of the 89.6-16 block (orchestrator split, 2026-11-23).
  { id: 'D04', census: 'D04', kind: 'dialog', owner: '89.6-40', status: 'enforced', reachAt: { width: 375, height: 667 }, reach: reachCalendarSheet, extras: calendarSheetExtras },
  { id: 'D04-empty', census: 'D04', kind: 'dialog', owner: '89.6-40', status: 'enforced', state: 'empty', reachAt: { width: 375, height: 667 }, reach: reachCalendarSheetEmpty, answers: (url) => (isEventsRead(url) ? [] : undefined), extras: calendarSheetEmptyExtras },
];
