// Surface rows: the phone menu, its dim layer, Notifications, the action menu and the toaster. Owner: plan 89.6-26.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE MENU ROWS (O01, O02, O03). Each reach goes to the home page with one pending invite answered in
// the browser (its group name is the 30-letter word), so the unread dot is drawn on the menu button
// and the Notifications panel holds one invite row, then presses Toggle menu. Accept and Decline are
// never pressed. The font32 cell reaches on a fresh page at 768 wide, where at normal text the
// stylesheet does not draw the menu button (md, and the strip is 48rem); the reach then sets that
// page's one-way font32 mode itself before pressing, which the cell's own setTextMode call repeats as
// a no-op (e2e/support/wordLines.ts ("export async function setTextMode")). Only that page reaches at
// 768: the style-tag pages reach at their first cell, 215 and 375 wide, where the button is drawn.
//
// O04 reaches the planning page as plan 89.6-20's R08-expanded row does (its reach and answers,
// looked up by id when the reach runs) and opens the first Check-in actions menu. O08 raises the
// Customize Group save-failure toast: the save is answered 500 in the browser by a route registered
// after the sweep's guard, the page clock is paused once the toast is up (clock: 'held', the pattern
// of e2e/support/largeTextSurfaces/dialogs.ts ("DECISION Phase 89.6-25 (D11-hold)")) and the pointer
// rests on the toaster, which Sonner reads as a pause too.
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { answerPendingInvites, pendingInvite } from '../pendingInvite';
import { setTextMode, THIRTY_LETTER_WORD } from '../wordLines';
import { answerPromptSettings, openCustomizeGroup } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';
import { rows as planningRows } from './planning';

const PX = 0.5;

const answerInvite = answerPendingInvites([pendingInvite('e2e-chrome-invite', THIRTY_LETTER_WORD)]);

// includeHidden: at 768 with normal text the stylesheet does not draw the button, and the reach must
// still find it there to see that (CI run 45786993394: the role query waited for it for ever).
const menuButton = (page: Page): Locator => page.getByRole('button', { name: 'Toggle menu', exact: true, includeHidden: true });
const menuPanel = (page: Page): Locator => page.locator('[data-slot="header-menu-panel"]');
const menuDim = (page: Page): Locator => page.locator('[data-slot="header-menu-dim"]');

async function openMenu(page: Page): Promise<void> {
  await page.goto('/');
  const button = menuButton(page);
  await button.waitFor({ state: 'attached', timeout: 15_000 });
  if (!(await button.isVisible())) {
    await setTextMode(page, 'font32', 'chrome reach at 768: the menu button is drawn only at enlarged text');
  }
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
  await expect(button, 'the menu did not open').toHaveAttribute('aria-expanded', 'true');
  await expect(menuPanel(page), 'the open menu panel is not drawn').toHaveCSS('opacity', '1');
}

/** The menu button holds 44 x 44 and the unread dot scales with its icon, inside the box. */
async function menuButtonHolds(page: Page, cell: SweepCell): Promise<void> {
  const read = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Toggle menu"]') as HTMLElement | null;
    if (!button) return null;
    const svg = button.querySelector('svg') as SVGElement;
    const dot = button.querySelector('span[aria-hidden="true"]') as HTMLElement | null;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { button: box(button), svg: box(svg), dot: dot ? box(dot) : null };
  });
  if (!read) throw new Error(`${cell.id}: the Toggle menu button is not on the page`);
  const { button, svg, dot } = read;
  const problems: string[] = [];
  if (Math.abs(button.width - 44) > PX || Math.abs(button.height - 44) > PX) problems.push(`the menu button is ${button.width} x ${button.height}, not 44 x 44`);
  if (!dot) problems.push('the unread dot is not drawn (one pending invite is answered)');
  else {
    if (Math.abs(dot.width - (svg.width * 10) / 24) > PX) problems.push(`the dot is ${dot.width}px wide with a ${svg.width}px icon, not icon x 10/24`);
    if (dot.left < button.left - PX || dot.right > button.right + PX || dot.top < button.top - PX || dot.bottom > button.bottom + PX) problems.push('the dot leaves the menu button box');
  }
  if (problems.length > 0) throw new Error(`${cell.id}: ${problems.join('; ')}`);
}

/** Every link and button in the open panel can be scrolled fully into view. */
async function everyRowReachable(page: Page, cell: SweepCell, within: string): Promise<void> {
  const unreachable = await page.evaluate((selector) => {
    const root = document.querySelector(selector) as HTMLElement | null;
    if (!root) return ['(the root is not on the page)'];
    const panel = document.querySelector('[data-slot="header-menu-panel"]') as HTMLElement | null;
    const keepPanel = panel?.scrollTop ?? 0;
    const keepX = window.scrollX;
    const keepY = window.scrollY;
    const missed: string[] = [];
    for (const row of Array.from(root.querySelectorAll('a, button')) as HTMLElement[]) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = row.getBoundingClientRect();
      const bottomLimit = Math.min(document.documentElement.clientHeight, panel ? panel.getBoundingClientRect().bottom : Infinity);
      const topLimit = panel ? panel.getBoundingClientRect().top : 0;
      if (r.bottom > bottomLimit + 0.5 || r.top < topLimit - 0.5) missed.push(`${(row.getAttribute('aria-label') ?? row.textContent ?? '').trim().slice(0, 40)} (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, room ${Math.round(topLimit)} to ${Math.round(bottomLimit)})`);
    }
    if (panel) panel.scrollTop = keepPanel;
    window.scrollTo(keepX, keepY);
    return missed;
  }, within);
  if (unreachable.length > 0) throw new Error(`${cell.id}: rows that cannot be scrolled into view: ${unreachable.join('; ')}`);
}

const o01Extras: SurfaceRow['extras'] = async (page, cell) => {
  await menuButtonHolds(page, cell);
  await everyRowReachable(page, cell, '[data-slot="header-menu-panel"]');
};

const o02Extras: SurfaceRow['extras'] = async (page, cell) => {
  const read = await menuDim(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, opacity: getComputedStyle(el).opacity, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
  });
  const problems: string[] = [];
  if (read.opacity !== '1') problems.push(`the dim layer opacity is ${read.opacity} with the menu open`);
  if (Math.abs(read.left) > PX || Math.abs(read.top) > PX || Math.abs(read.width - read.vw) > PX || Math.abs(read.height - read.vh) > PX) problems.push(`the dim layer box (${read.left}, ${read.top}, ${read.width} x ${read.height}) is not the ${read.vw} x ${read.vh} viewport`);
  if (problems.length > 0) throw new Error(`${cell.id}: ${problems.join('; ')}`);
};

const notificationsRegion = (page: Page): Locator => menuPanel(page).getByRole('region', { name: 'Notifications', exact: true });

const o03Extras: SurfaceRow['extras'] = async (page, cell) => {
  const read = await page.evaluate((word) => {
    const panel = document.querySelector('[data-slot="header-menu-panel"]') as HTMLElement;
    const region = panel.querySelector('section[aria-labelledby]') as HTMLElement | null;
    if (!region) return { missing: true as const };
    const keepPanel = panel.scrollTop;
    const keepY = window.scrollY;
    const room = () => ({ top: panel.getBoundingClientRect().top, bottom: Math.min(document.documentElement.clientHeight, panel.getBoundingClientRect().bottom) });
    region.scrollIntoView({ block: 'start' });
    const atStart = { region: region.getBoundingClientRect().top, ...room() };
    region.scrollIntoView({ block: 'end' });
    const atEnd = { region: region.getBoundingClientRect().bottom, ...room() };
    // The group name's text node: the tops of its line boxes, one per line.
    let lines = 0;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').includes(word)) continue;
      const range = document.createRange();
      const at = (node.textContent ?? '').indexOf(word);
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
    }
    panel.scrollTop = keepPanel;
    window.scrollTo(window.scrollX, keepY);
    return { missing: false as const, atStart, atEnd, lines };
  }, THIRTY_LETTER_WORD);
  if (read.missing) throw new Error(`${cell.id}: the Notifications panel is not open in the menu`);
  const problems: string[] = [];
  if (read.atStart.region < read.atStart.top - PX) problems.push(`the panel top cannot be scrolled into view (top ${Math.round(read.atStart.region)}, room from ${Math.round(read.atStart.top)})`);
  if (read.atEnd.region > read.atEnd.bottom + PX) problems.push(`the panel bottom cannot be scrolled into view (bottom ${Math.round(read.atEnd.region)}, room to ${Math.round(read.atEnd.bottom)})`);
  if (read.lines !== 1) problems.push(`the invite's group name sits on ${read.lines} lines`);
  if (problems.length > 0) throw new Error(`${cell.id}: ${problems.join('; ')}`);
};

const reachMenu: SurfaceRow['reach'] = async (page) => {
  await openMenu(page);
  return { root: menuPanel(page) };
};

const reachDim: SurfaceRow['reach'] = async (page) => {
  await openMenu(page);
  return { root: menuDim(page) };
};

const reachNotifications: SurfaceRow['reach'] = async (page) => {
  await openMenu(page);
  const row = menuPanel(page).getByRole('button', { name: 'Invites notifications', exact: true });
  await row.click();
  await expect(row, 'the Invites row did not open its panel').toHaveAttribute('aria-expanded', 'true');
  const region = notificationsRegion(page);
  await region.waitFor({ state: 'visible', timeout: 15_000 });
  await region.getByText(THIRTY_LETTER_WORD).first().waitFor({ state: 'visible', timeout: 15_000 });
  return { root: region };
};

// O04: plan 89.6-20's R08-expanded staging, looked up when the reach runs (planning.ts is a sibling
// module of the same row list).
const expandedRow = (): SurfaceRow => {
  const row = planningRows.find((each) => each.id === 'R08-expanded');
  if (!row?.reach) throw new Error('planning.ts has no R08-expanded row with a reach (plan 89.6-20)');
  return row;
};
const checkInTrigger = (page: Page): Locator => page.getByRole('button', { name: /^Check-in actions/ }).first();

const reachCheckInMenu: SurfaceRow['reach'] = async (page) => {
  await expandedRow().reach!(page);
  const trigger = checkInTrigger(page);
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await trigger.click();
  const listId = await trigger.getAttribute('aria-controls');
  if (!listId) throw new Error('the Check-in actions menu did not open (no aria-controls on its trigger)');
  const list = page.locator(`[id="${listId}"]`);
  await list.waitFor({ state: 'visible' });
  return { root: list };
};

const o04Extras: SurfaceRow['extras'] = async (page, cell) => {
  const trigger = checkInTrigger(page);
  const listId = await trigger.getAttribute('aria-controls');
  if (!listId) throw new Error(`${cell.id}: the Check-in actions menu is closed`);
  const read = await page.evaluate((id) => {
    const button = Array.from(document.querySelectorAll('button[aria-label^="Check-in actions"]')).find((b) => b.getAttribute('aria-controls') === id) as HTMLElement;
    const list = document.getElementById(id) as HTMLElement;
    const b = button.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const cut = (Array.from(list.querySelectorAll('button')) as HTMLElement[]).filter((item) => item.scrollWidth > item.clientWidth + 1).map((item) => (item.textContent ?? '').trim());
    return {
      rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
      glyphPx: parseFloat(getComputedStyle(button).fontSize),
      trigger: { width: b.width, height: b.height },
      list: { left: l.left, right: l.right },
      vw: document.documentElement.clientWidth,
      cut,
    };
  }, listId);
  const problems: string[] = [];
  if (Math.abs(read.trigger.width - 44) > PX || Math.abs(read.trigger.height - 44) > PX) problems.push(`the Check-in actions trigger is ${read.trigger.width} x ${read.trigger.height}, not 44 x 44`);
  const glyph = Math.min((24 * read.rootPx) / 16, 32);
  if (Math.abs(read.glyphPx - glyph) > PX) problems.push(`the trigger glyph is ${read.glyphPx}px, not ${glyph}px`);
  if (read.list.left < -PX || read.list.right > read.vw + PX) problems.push(`the open list runs off the screen (${Math.round(read.list.left)} to ${Math.round(read.list.right)} of ${read.vw})`);
  if (read.cut.length > 0) problems.push(`item labels cut: ${read.cut.join(', ')}`);
  if (problems.length > 0) throw new Error(`${cell.id}: ${problems.join('; ')}`);
};

// O08: the Customize Group save fails in the browser and its error toast is held on screen.
const SETTINGS_PATH = /\/groups\/[^/]+\/settings$/;
const clockInstalled = new WeakSet<BrowserContext>();
const saveAnswered = new WeakSet<Page>();
const toaster = (page: Page): Locator => page.locator('ol[data-sonner-toaster]');

const reachToast: SurfaceRow['reach'] = async (page) => {
  const context = page.context();
  if (clockInstalled.has(context)) await page.clock.resume();
  else {
    await page.clock.install();
    clockInstalled.add(context);
  }
  if (!saveAnswered.has(page)) {
    // Registered after the sweep's guard, so it runs first for the settings save: the save fails
    // here, in the browser, and never reaches the backend.
    await page.route(
      (url) => SETTINGS_PATH.test(url.pathname),
      async (route) => {
        const request = route.request();
        const headers = request.headers();
        const origin = headers['origin'] ?? '*';
        if (request.method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'PUT, OPTIONS', 'access-control-allow-headers': headers['access-control-request-headers'] ?? 'content-type, authorization' } });
          return;
        }
        if (request.method() === 'PUT') {
          await route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ error: 'Simulated save failure (89.6-26)' }) });
          return;
        }
        await route.fallback();
      },
    );
    saveAnswered.add(page);
  }
  const dialog = await openCustomizeGroup(page);
  await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const toast = page.locator('[data-sonner-toast]').first();
  await toast.waitFor({ state: 'visible', timeout: 15_000 });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 200);
  // Forced: the pointer only has to rest on the toast; a dialog layer under it must not stop the step.
  await toast.hover({ force: true });
  return { root: toaster(page) };
};

const o08Extras: SurfaceRow['extras'] = async (page, cell) => {
  const read = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]');
    let strip: Element | null = nav;
    while (strip && getComputedStyle(strip).position !== 'sticky') strip = strip.parentElement;
    const toast = document.querySelector('[data-sonner-toast]');
    if (!strip || !toast) return null;
    const close = toast.querySelector('button[data-close-button]');
    const t = toast.getBoundingClientRect();
    const c = close?.getBoundingClientRect();
    return {
      rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
      stripBottom: strip.getBoundingClientRect().bottom,
      toast: { left: t.left, top: t.top, right: t.right, bottom: t.bottom },
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
      close: c ? { width: c.width, height: c.height } : null,
    };
  });
  if (!read) throw new Error(`${cell.id}: the toast or the header strip is not on the page`);
  // Recorded, never changed here: the close button's size (a found-new row when under 44 x 44).
  // eslint-disable-next-line no-console -- the close button's size is recorded from the CI log (plan 89.6-26)
  console.log(`O08 ${cell.id}: toast top ${read.toast.top}px, strip bottom ${read.stripBottom}px, close button ${read.close ? `${read.close.width} x ${read.close.height}` : 'none'}`);
  const problems: string[] = [];
  if (read.toast.top < read.stripBottom - PX) problems.push(`the toast starts over the header strip (toast top ${read.toast.top}, strip bottom ${read.stripBottom})`);
  if (read.toast.top - read.stripBottom > 0.5 * read.rootPx + PX) problems.push(`the toast starts more than 0.5rem under the strip (toast top ${read.toast.top}, strip bottom ${read.stripBottom})`);
  if (read.toast.left < -PX || read.toast.right > read.vw + PX || read.toast.bottom > read.vh + PX) problems.push(`the toast leaves the screen (${Math.round(read.toast.left)} to ${Math.round(read.toast.right)} of ${read.vw}, bottom ${Math.round(read.toast.bottom)} of ${read.vh})`);
  if (problems.length > 0) throw new Error(`${cell.id}: ${problems.join('; ')}`);
};

export const rows: SurfaceRow[] = [
  { id: 'O01', census: 'O01', kind: 'overlay', owner: '89.6-26', status: 'enforced', state: 'phone menu open, one pending invite (the dot drawn)', reach: reachMenu, answers: answerInvite, extras: o01Extras },
  { id: 'O02', census: 'O02', kind: 'overlay', owner: '89.6-26', status: 'enforced', state: 'the dim layer behind the open phone menu', reach: reachDim, answers: answerInvite, extras: o02Extras },
  { id: 'O03', census: 'O03', kind: 'overlay', owner: '89.6-26', status: 'enforced', state: 'Notifications opened from the Invites row, one invite named by the 30-letter word', reach: reachNotifications, answers: answerInvite, extras: o03Extras },
  { id: 'O04', census: 'O04', kind: 'overlay', owner: '89.6-26', status: 'enforced', state: 'the first Check-in actions menu open on the planning page', reach: reachCheckInMenu, answers: (url) => expandedRow().answers?.(url), extras: o04Extras },
  { id: 'O08', census: 'O08', kind: 'overlay', owner: '89.6-26', status: 'enforced', state: 'the Customize Group save-failure toast, held', reach: reachToast, answers: answerPromptSettings, extras: o08Extras, clock: 'held' },
];
