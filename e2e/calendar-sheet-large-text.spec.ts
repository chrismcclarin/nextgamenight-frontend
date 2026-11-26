// The phone Calendar sheet at normal and large text (Phase 89.6-40, CAL pick S2 and FL-05).
//
// WHAT. Four reads of the sheet no unit test can make, because jsdom lays nothing out:
//   1. normal text: at 375 x 667 and 320 x 568 with 100% text the list keeps its own scroll box
//      (the CAL card read, lane D's keep of the 211px box), filling the sheet below the hero, and
//      the header and the close hold their place (61px header, the close 52 x 44 at the right
//      edge less the 16px page edge);
//   2. keyboard: a focused row's day heading is never left behind the stuck section header
//      (FL-05 part b), at 100% and at 200% text, where the sheet body is the one scroll;
//   3. dark: the Next game night card's RSVP to this event line is painted, its contrast against
//      its own ground at least 4.5 (FL-05 part c);
//   4. fold: below a 14rem sheet the body is the one scroll, so a Past header folded by keyboard
//      from deep inside its section must be brought back by the element that really scrolls
//      (FL-05 part e; src/components/ui/BottomSheet.tsx ("DECISION Phase 89.6-40 (CAL)")).
//
// STAGING. The seeded account does not hold enough nights to make the list scroll, so the events
// reads are edited IN THE BROWSER ONLY (GET only, the real response through scrubbedFetch): the
// real nights stay, and twelve copies of a real night are added on the twelve days after the last
// of them and twelve more on the days before the first past one, one night per day, so every Past
// row starts its own day group. The RSVP reads are answered empty in the browser, so the card
// shows its RSVP to this event line.
//
// WRITE GUARD, written out in full (phase rule 12; plan review R1 M079): holdWrites is registered
// FIRST, before any route and before the navigation, so it runs last and holds every non-GET on
// every URL; then one route sends the self read on without its timezone parameter (the backend
// backfills a missing time zone from it) and answers every GET that writes (WRITE_GETS) in the
// browser, never holding it (a held request resumes when interception ends), listing its path.
// afterEach asserts expectNoApiWrites and an empty list. Nothing ever calls unrouteAll: turning
// interception off resumes held requests (the 88.9-03 leak). Nothing is pressed that writes: the
// tests press Tab, Enter on a fold button and the Past header, and scroll.
//
// No conditional skip; floored anyway (scripts/gate-c-floors.manifest.mjs, 4 per project) so a
// green CI run names this spec. No scanner import, so no registry row. Both projects run
// every test: each sets its own viewport.
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { assertTheme, focusByKeyboard, ratioAgainstGround } from './support/contrast';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { WRITE_GETS } from './support/largeTextSurfaces';
import { scrubbedFetch } from './support/scrubbedFetch';
import { setTextMode } from './support/wordLines';

const DAY_MS = 24 * 60 * 60 * 1000;
const COPIES = 12;

type Night = Record<string, unknown> & { id?: unknown; start_date?: unknown; end_date?: unknown };

const startMs = (night: Night): number => (typeof night.start_date === 'string' ? Date.parse(night.start_date) : Number.NaN);

// A copy of a night moved to a new start, its end carried with it.
function copyAt(night: Night, id: string, start: number): Night {
  const from = startMs(night);
  const end = typeof night.end_date === 'string' ? Date.parse(night.end_date) : Number.NaN;
  return {
    ...night,
    id,
    status: 'scheduled',
    EventParticipations: [],
    start_date: new Date(start).toISOString(),
    ...(Number.isNaN(end) || Number.isNaN(from) ? {} : { end_date: new Date(start + (end - from)).toISOString() }),
  };
}

function stage(real: Night[], nowMs: number): Night[] | string {
  const dated = real.filter((night) => !Number.isNaN(startMs(night)));
  if (dated.length === 0) return 'the events read holds no night with a start date (an empty payload is a fixture failure)';
  const template = dated[0];
  const last = dated.reduce((latest, night) => Math.max(latest, startMs(night)), nowMs);
  const firstPast = dated.reduce((earliest, night) => Math.min(earliest, startMs(night)), nowMs - 2 * DAY_MS);
  const upcoming = Array.from({ length: COPIES }, (_, i) => copyAt(template, `x640-up-${i + 1}`, last + (i + 1) * DAY_MS));
  const past = Array.from({ length: COPIES }, (_, i) => copyAt(template, `x640-past-${i + 1}`, firstPast - (i + 1) * DAY_MS));
  return [...dated, ...upcoming, ...past];
}

const isEventsRead = (url: URL): boolean => url.pathname.includes('/events/user/');
const isRsvpRead = (url: URL): boolean => url.pathname.includes('/rsvp/event/');
const isSelfReadWithTimezone = (url: URL): boolean => /\/users\/[^/]+$/.test(url.pathname) && url.searchParams.has('timezone');
const isWriteGet = (url: URL): boolean => WRITE_GETS.some((pattern) => pattern.test(url.pathname));

interface Guard {
  hold: WriteHold;
  writeGets: string[];
  stagingError: string[];
}

let guard: Guard | undefined;

test.beforeEach(async ({ page }) => {
  // FIRST: every non-GET on every URL is held in the browser.
  const hold = await holdWrites(page);
  const writeGets: string[] = [];
  const stagingError: string[] = [];
  // Before any navigation: the self read goes on without timezone; a GET that writes is answered
  // in the browser and listed; the events reads are staged and the RSVP reads answered empty.
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }
    const url = new URL(request.url());
    if (isWriteGet(url)) {
      writeGets.push(url.pathname);
      await route.fulfill({ status: 200, json: {} });
      return;
    }
    if (isSelfReadWithTimezone(url)) {
      url.searchParams.delete('timezone');
      await route.fallback({ url: url.toString() });
      return;
    }
    if (isRsvpRead(url)) {
      await route.fulfill({ status: 200, json: { rsvps: [], summary: { yes: 0, maybe: 0, no: 0 } } });
      return;
    }
    if (isEventsRead(url)) {
      const response = await scrubbedFetch(route);
      let real: unknown;
      try {
        real = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      const staged = Array.isArray(real) ? stage(real as Night[], Date.now()) : 'the events read is not a list';
      if (typeof staged === 'string') {
        stagingError.push(staged);
        await route.fulfill({ response, json: real });
        return;
      }
      await route.fulfill({ response, json: staged });
      return;
    }
    await route.fallback();
  });
  guard = { hold, writeGets, stagingError };
});

test.afterEach(() => {
  expectNoApiWrites(guard?.hold);
  expect(guard?.writeGets ?? [], 'a GET that writes was sent by the sheet; it was answered in the browser').toEqual([]);
  guard = undefined;
});

const sheet = (page: Page): Locator => page.getByRole('dialog', { name: 'Calendar', exact: true });
const upcomingHeader = (scope: Locator): Locator => scope.getByRole('button', { name: 'Upcoming events', exact: true });
const pastHeader = (scope: Locator): Locator => scope.getByRole('button', { name: /^Past events \(\d+\)$/ });

/** Open Home at a phone size and press the phone Calendar button; wait for the loaded list. */
async function openSheet(page: Page, viewport: { width: number; height: number }): Promise<Locator> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByRole('heading', { level: 2, name: 'Your Groups' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: /^Calendar(, .*)?$/ }).click();
  const dialog = sheet(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await upcomingHeader(dialog).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  expect(guard?.stagingError ?? [], 'the events read could not be staged').toEqual([]);
  return dialog;
}

/** The panel the Past header controls (its aria-controls). */
async function pastPanel(dialog: Locator): Promise<Locator> {
  const id = await pastHeader(dialog).getAttribute('aria-controls');
  expect(id, 'the Past header names no panel').toBeTruthy();
  return dialog.locator(`[id="${id}"]`);
}

// A Past row: a button holding a heading, inside the Past panel.
const rowsIn = (panel: Locator): Locator => panel.getByRole('button').filter({ has: panel.page().getByRole('heading') });

/** Open the Past section (a fold button: nothing is written) and wait for its first row. */
async function openPast(dialog: Locator): Promise<Locator> {
  const header = pastHeader(dialog);
  await expect(header, 'the staged list has no Past section').toBeVisible();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  const panel = await pastPanel(dialog);
  await expect(rowsIn(panel).first()).toBeVisible();
  return panel;
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/** The nearest ancestor of the element (itself included) whose overflow-y scrolls, with its visible box. */
async function scrollerOf(locator: Locator): Promise<{ name: string; overflowY: string; clientHeight: number; scrollHeight: number; visible: Box } | null> {
  return locator.evaluate((element) => {
    let node: HTMLElement | null = element as HTMLElement;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') break;
      node = node.parentElement;
    }
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const top = rect.top + node.clientTop;
    return {
      name: `${node.tagName.toLowerCase()}.${String(node.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`,
      overflowY: getComputedStyle(node).overflowY,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      visible: { top, bottom: top + node.clientHeight, left: rect.left, right: rect.right, width: rect.width, height: node.clientHeight },
    };
  });
}

const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });

const r1 = (n: number): string => n.toFixed(1);

test('89.6-40 normal text: at 375 x 667 then 320 x 568 with 100% text the sheet keeps the list in its own scroll box, the header and the x hold today\'s place', async ({ page }) => {
  const dialog = await openSheet(page, { width: 375, height: 667 });
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 320, height: 568 },
  ]) {
    const tag = `${viewport.width} x ${viewport.height} / 100%`;
    await page.setViewportSize(viewport);
    await setTextMode(page, '100', tag);
    await settleAnimations(dialog);
    const region = await scrollerOf(upcomingHeader(dialog));
    expect(region, `${tag}: nothing scrolls the list`).not.toBeNull();
    if (!region) return;
    const read = await dialog.evaluate((panel) => {
      const body = panel.querySelector('h2')?.parentElement?.nextElementSibling as HTMLElement | null;
      const header = panel.querySelector('h2')?.parentElement as HTMLElement | null;
      const close = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Close') ?? null;
      const box = (element: Element | null) => {
        const r = element?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null;
      };
      return {
        panel: box(panel),
        header: box(header),
        close: box(close),
        body: body ? { box: box(body), overflowY: getComputedStyle(body).overflowY, paddingBottom: parseFloat(getComputedStyle(body).paddingBottom) } : null,
      };
    });
    process.stdout.write(`89.6-40 normal text ${tag}: list box ${region.clientHeight}px (${region.name}), header ${read.header ? r1(read.header.height) : 'none'}px, close ${read.close ? `${r1(read.close.width)} x ${r1(read.close.height)} at right ${r1(read.close.right)}` : 'none'}\n`);
    // The list is its own scroll box (the region, not the sheet body), and it scrolls: the staged
    // list is taller than it.
    expect(region.name, `${tag}: the list's scroller is not the list region`).toMatch(/^div\.relative\.overflow-y-auto/);
    expect(read.body?.overflowY, `${tag}: the sheet body scrolls at normal text`).toBe('hidden');
    expect(region.clientHeight, `${tag}: the list box is under one row tall`).toBeGreaterThan(44);
    expect(region.scrollHeight, `${tag}: the staged list does not scroll in its box`).toBeGreaterThan(region.clientHeight);
    // It fills the sheet: its bottom is the body's content bottom (1px).
    if (read.body?.box) expect(Math.abs(region.visible.bottom - (read.body.box.bottom - read.body.paddingBottom)), `${tag}: the list box does not fill the sheet to its foot`).toBeLessThanOrEqual(1);
    // The header is 61px (44px close, 8px above and below, the 1px rule), the close 52 x 44 with its
    // right edge 16px in from the panel's and its top 8px below the header's.
    expect(read.header && read.close && read.panel, `${tag}: the header or the close is missing`).toBeTruthy();
    if (!read.header || !read.close || !read.panel) return;
    expect(Math.abs(read.header.height - 61), `${tag}: the header is ${r1(read.header.height)}px tall, not 61`).toBeLessThanOrEqual(1);
    expect(Math.abs(read.close.width - 52) <= 0.5 && Math.abs(read.close.height - 44) <= 0.5, `${tag}: the close is ${r1(read.close.width)} x ${r1(read.close.height)}, not 52 x 44`).toBe(true);
    expect(Math.abs(read.panel.right - 16 - read.close.right), `${tag}: the close's right edge is not 16px in from the panel's`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(read.close.top - read.header.top - 8), `${tag}: the close does not sit 8px below the header's top`).toBeLessThanOrEqual(0.5);
  }
});

test('89.6-40 keyboard: a focused row\'s day heading is not behind the stuck section header', async ({ page }) => {
  const dialog = await openSheet(page, { width: 375, height: 667 });
  const problems: string[] = [];
  for (const mode of ['100', '200'] as const) {
    const tag = `375 x 667 / ${mode}%`;
    await setTextMode(page, mode, tag);
    await settleAnimations(dialog);
    const panel = await openPast(dialog);
    const header = pastHeader(dialog);
    await focusByKeyboard(page, header);
    let checked = 0;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab');
      const read = await panel.evaluate((root, headerName) => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || !root.contains(active)) return { inside: false as const };
        const group = active.closest('section');
        const day = group?.firstElementChild ?? null;
        // Only the first row of its day group has its day heading directly above it. A row is a
        // div with role button (CalendarListView EventRow), never a button element.
        const firstRow = group ? Array.from(group.querySelectorAll('button, [role="button"]')).find((row) => row.querySelector('h1,h2,h3,h4,h5,h6')) : null;
        const stuck = Array.from(document.querySelectorAll('h3')).find((h3) => h3.textContent?.trim().startsWith(headerName)) ?? null;
        const box = (element: Element | null) => {
          const r = element?.getBoundingClientRect();
          return r ? { top: r.top, bottom: r.bottom } : null;
        };
        return { inside: true as const, first: firstRow === active, day: box(day), header: box(stuck), row: box(active) };
      }, 'Past events');
      if (!read.inside) break;
      if (!read.first || !read.day || !read.header) continue;
      checked += 1;
      if (read.day.top < read.header.bottom - 1) {
        problems.push(`${tag}: a focused Past row's day heading starts ${r1(read.header.bottom - read.day.top)}px behind the stuck Past header (heading top ${r1(read.day.top)}, header bottom ${r1(read.header.bottom)})`);
      }
    }
    if (checked < 3) problems.push(`${tag}: only ${checked} focused Past rows were read (at least 3 expected)`);
    // Fold Past again for the next mode, by its button (nothing is written).
    await header.focus();
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
  }
  expect(problems).toEqual([]);
});

test('89.6-40 dark: the Next game night card\'s RSVP to this event line is painted', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
  const dialog = await openSheet(page, { width: 375, height: 667 });
  await assertTheme(page, 'dark');
  const line = dialog.getByText('RSVP to this event', { exact: true });
  await expect(line, 'the Next game night card shows no RSVP to this event line').toBeVisible();
  const box = await boxOf(line);
  expect(box.width > 0 && box.height > 0, `the line's box is empty (${r1(box.width)} x ${r1(box.height)})`).toBe(true);
  const measured = await ratioAgainstGround(line, 'RSVP to this event (dark, 375 x 667)');
  process.stdout.write(`89.6-40 dark RSVP line: ${measured.ratio.toFixed(2)} (${measured.fg} on ${measured.ground})\n`);
  expect(measured.ratio, `RSVP to this event: ${measured.fg} on ${measured.ground}`).toBeGreaterThanOrEqual(4.5);
});

test('89.6-40 fold: with one scroll below 14rem, a Past header folded by keyboard from deep inside its section stays on screen and focused', async ({ page }) => {
  const dialog = await openSheet(page, { width: 375, height: 667 });
  const tag = '375 x 667 / 200%';
  await setTextMode(page, '200', tag);
  await settleAnimations(dialog);
  const panel = await openPast(dialog);
  const header = pastHeader(dialog);
  const scroller = await scrollerOf(header);
  expect(scroller, `${tag}: nothing scrolls the Past section`).not.toBeNull();
  // Focus first (focusByKeyboard presses Tab, which may scroll), then scroll by script: a scroll
  // moves no focus.
  await focusByKeyboard(page, header);
  const scrolled = await header.evaluate((button, panelId) => {
    let node: HTMLElement | null = button.parentElement;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') break;
      node = node.parentElement;
    }
    // A row is a div with role button (CalendarListView EventRow), never a button element.
    const rows = Array.from(document.getElementById(panelId)?.querySelectorAll('button, [role="button"]') ?? []).filter((row) => row.querySelector('h1,h2,h3,h4,h5,h6'));
    if (!node || rows.length < 4) return { ok: false, rows: rows.length, above: 0, stuck: false };
    // Scroll until the third Past row's bottom is above the scroller's visible top.
    const top = node.getBoundingClientRect().top + node.clientTop;
    node.scrollTop += rows[2].getBoundingClientRect().bottom - top + 1;
    const visibleTop = node.getBoundingClientRect().top + node.clientTop;
    const above = rows.filter((row) => row.getBoundingClientRect().bottom <= visibleTop).length;
    const stuck = Math.abs((button.closest('h3')?.getBoundingClientRect().top ?? -1000) - visibleTop) <= 1;
    return { ok: true, rows: rows.length, above, stuck };
  }, (await header.getAttribute('aria-controls')) ?? '');
  expect(scrolled.ok, `${tag}: the Past section holds ${scrolled.rows} rows (at least 4 are staged)`).toBe(true);
  expect(scrolled.above, `${tag}: no Past row is above the visible area after the scroll`).toBeGreaterThanOrEqual(1);
  expect(scrolled.stuck, `${tag}: the Past header is not stuck at the scroller's top after the scroll`).toBe(true);
  await expect(header).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(rowsIn(panel)).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(header, `${tag}: the folded Past header lost focus`).toBeFocused();
  const after = await scrollerOf(header);
  const box = await boxOf(header);
  expect(after, `${tag}: nothing scrolls the folded Past header`).not.toBeNull();
  if (!after) return;
  process.stdout.write(`89.6-40 fold ${tag}: scroller ${after.name}, header ${r1(box.top)} to ${r1(box.bottom)}, visible ${r1(after.visible.top)} to ${r1(after.visible.bottom)}\n`);
  expect(
    box.top >= after.visible.top - 1 && box.bottom <= after.visible.bottom + 1,
    `${tag}: the folded Past header (${r1(box.top)} to ${r1(box.bottom)}) is outside the visible part of ${after.name} (${r1(after.visible.top)} to ${r1(after.visible.bottom)})`,
  ).toBe(true);
});
