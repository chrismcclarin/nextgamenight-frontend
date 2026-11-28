// Surface rows: the rest of Profile (census R16), Delete your account and the combobox listbox. Owner: plan 89.6-27.
// One row per line at the bottom, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// WRITES. Every page gets the sweep's guard first. A row here never presses a control that writes
// unless that write is caught by a later route on a pathname predicate (any host: the backend and
// the proxy under /api alike) and answered in the browser; nothing is ever handed on to the network.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { holdRequests, settleAnimations } from '../inFlight';
import { readCellUnderExceptions, readPageZoomCellUnderExceptions } from '../largeTextExceptions';
import { scrubbedFetch } from '../scrubbedFetch';
import { expectLargeTextCell, expectPageZoomUsable } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';

// One unbreakable word in front of the at sign, on a reserved domain. It is only ever put into an
// answered read: never typed into a field, never sent anywhere.
const LONG_EMAIL = 'grandmasterboardgamecollective.weekendwarriors@example.com';

// The owned-games read, answered in the browser: game rows as the page reads them (id, name, year,
// picture), one long title and one short.
const OWNED_GAMES = [
  { id: '89627000-0000-4000-8000-000000000001', name: 'Twilight Imperium: Fourth Edition, Prophecy of Kings', year_published: 2020, image_url: null },
  { id: '89627000-0000-4000-8000-000000000002', name: 'Catan', year_published: 1995, image_url: null },
];

const isOwnedGamesRead = (url: URL): boolean => /\/user-games\/user\/[^/]+$/.test(url.pathname);
const answerOwnedGames = (url: URL): unknown => (isOwnedGamesRead(url) ? OWNED_GAMES : undefined);

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];
const r1 = (value: number): string => value.toFixed(1);

/** Two animation frames and the fonts: enough for a resize to lay out before a read. */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** A reach reads at normal text: the sweep applies a cell's text mode only after the reach. */
async function expectNormalText(page: Page, id: string): Promise<void> {
  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  if (fontSize !== '16px') throw new Error(`${id}: STOP, the reach ran at a ${fontSize} root, not at normal text: the sweep's cell order changed`);
}

const sidewaysOf = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Read a part of the page as the sweep reads the root: the lighter check at a page-zoom width, else the five. */
async function expectPart(part: Locator, cell: SweepCell, tag: string): Promise<void> {
  if (cell.zoom) expectPageZoomUsable((await readPageZoomCellUnderExceptions(part)).read, tag);
  else expectLargeTextCell((await readCellUnderExceptions(part)).read, tag);
}

// The self read (a path ending in /users/<id>, a query allowed, never a sub-path: the Profile writes
// are its siblings one segment below) is fetched without its timezone parameter through
// scrubbedFetch and answered with the staged address. GET only: any other method falls back to the
// guard's hold, so a Profile write is still held and counted. Registered once per page, after the
// guard, so it runs first. The same shape as plan 89.6-22's transform:
// e2e/support/largeTextSurfaces/profileA.ts ("const isSelfRead = (url: URL): boolean =>")
const isSelfRead = (url: URL): boolean => /\/users\/[^/]+$/.test(url.pathname);
const selfRouted = new WeakSet<Page>();
async function stageSelfRead(page: Page): Promise<void> {
  if (selfRouted.has(page)) return;
  selfRouted.add(page);
  await page.route(isSelfRead, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    url.searchParams.delete('timezone');
    const response = await scrubbedFetch(route, { url: url.toString() });
    const body = (await response.json().catch(() => null)) as unknown;
    const json = body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as object), email: LONG_EMAIL } : body;
    await route.fulfill({ response, json });
  });
}

const cardWith = (page: Page, heading: string): Locator =>
  page.locator('.card').filter({ has: page.getByRole('heading', { level: 2, name: heading, exact: true }) });
const pencilOf = (page: Page): Locator => page.getByRole('button', { name: 'Edit username', exact: true });
const collectionCardOf = (page: Page): Locator => page.locator('.card').filter({ has: page.getByRole('button', { name: '+ Add from BGG', exact: true }) });

/** The pencil's box: 44 x 44 CSS px at every text size (pick O-M4, Fixed+). */
async function pencilProblems(page: Page, tag: string): Promise<string[]> {
  const box = await pencilOf(page).boundingBox();
  if (!box) return [`${tag}: the Edit username pencil is not drawn`];
  const problems: string[] = [];
  if (Math.abs(box.width - 44) > 0.5 || Math.abs(box.height - 44) > 0.5) problems.push(`${tag}: the Edit username pencil is ${r1(box.width)} x ${r1(box.height)}, not 44 x 44`);
  return problems;
}

const catanCardOf = (page: Page): Locator => collectionCardOf(page).locator('div.border').filter({ has: page.getByRole('heading', { level: 3, name: 'Catan', exact: true }) });

// FL-13: the Remove word sits level with its game's title. Read on the Catan card: the top of the
// word's own text box against the top of the title's first line, and the title against its row.
async function removeLevel(page: Page): Promise<{ wordTop: number; titleLineTop: number; titleTop: number; rowTop: number }> {
  return catanCardOf(page).evaluate((card) => {
    const title = card.querySelector('h3');
    const button = card.querySelector('button');
    if (!title || !button) throw new Error('the Catan card has no title or no Remove button');
    const firstTextRect = (el: Element): DOMRect => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects()[0];
      }
      throw new Error('no text');
    };
    const row = title.parentElement?.parentElement;
    if (!row) throw new Error('the title has no row');
    return { wordTop: firstTextRect(button).top, titleLineTop: firstTextRect(title).top, titleTop: title.getBoundingClientRect().top, rowTop: row.getBoundingClientRect().top };
  });
}

// S4-c on the collection Remove (owner pick S4w): while the removal runs the button keeps its
// resting box and shows only a centred spinner. Read once, at 320 wide and 200%. The DELETE is
// caught here on a pathname predicate (any host), never handed on, and answered 500 in the browser.
const BUSY_CELL = '320x568-dark-200';
async function busyRemoveProblems(page: Page, tag: string): Promise<string[]> {
  const problems: string[] = [];
  const hold = await holdRequests(page, { method: 'DELETE', match: (url) => url.pathname.includes('/user-games/user/') });
  const remove = catanCardOf(page).getByRole('button');
  try {
    await remove.scrollIntoViewIfNeeded();
    const rest = await remove.boundingBox();
    if (!rest) return [`${tag}: the Catan Remove is not drawn`];
    await remove.click();
    await expect(remove, 'the armed Remove never went live').toHaveAccessibleName('Tap again to remove', { timeout: 10_000 });
    await remove.click();
    await hold.arrived;
    const spinner = remove.locator('[data-slot="spinner"]');
    await spinner.waitFor({ state: 'visible', timeout: 5_000 });
    const name = await remove.getAttribute('aria-label');
    if (name !== 'Remove Catan, removing') problems.push(`${tag}: the busy Remove is named ${name}, not Remove Catan, removing`);
    const held = await remove.boundingBox();
    const spin = await spinner.boundingBox();
    if (!held || !spin) return [...problems, `${tag}: the busy Remove or its spinner is not drawn`];
    if (Math.abs(held.width - rest.width) > 0.5 || Math.abs(held.x - rest.x) > 0.5) {
      problems.push(`${tag}: the busy Remove is ${r1(held.width)} wide at x ${r1(held.x)}; at rest ${r1(rest.width)} wide at x ${r1(rest.x)} (width ${held.width >= rest.width ? '+' : ''}${r1(held.width - rest.width)}px)`);
    }
    // The spinner turns, so its box swings: its centre is read.
    const dx = spin.x + spin.width / 2 - (held.x + held.width / 2);
    const dy = spin.y + spin.height / 2 - (held.y + held.height / 2);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) problems.push(`${tag}: the spinner's centre is ${r1(dx)}px across and ${r1(dy)}px down from the busy Remove's centre`);
    if (hold.count() !== 1) problems.push(`${tag}: ${hold.count()} removals were sent, not one`);
  } finally {
    await hold.release({ error: 'held by the large-text sweep' }, 500);
  }
  await expect(remove, 'the Remove did not come back after the held removal failed').toHaveAccessibleName('Remove Catan', { timeout: 10_000 });
  await remove.locator('[data-slot="spinner"]').waitFor({ state: 'detached', timeout: 5_000 });
  // The failure toast is outside every part read here; it is given time to leave before the next cell.
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  return problems;
}

// R16-rest: Profile with a long address on file and two owned games. Before any text mode is applied
// the page is read at normal text at 375 and 320: nothing may scroll sideways and the pencil is
// 44 x 44. The root is the collection card; the other cards are read by the extras.
// The level read (FL-13) is taken here too, at 375 with normal text, but it is THROWN by the extras
// of every cell instead of by the reach: a reach that throws ends the row before any cell is read,
// which would hide the busy Remove's own read behind it.
const levelProblems = new WeakMap<Page, string[]>();
const reachRest: SurfaceRow['reach'] = async (page) => {
  await stageSelfRead(page);
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 2, name: 'Timezone', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText(LONG_EMAIL, { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Remove Catan', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await expectNormalText(page, 'R16-rest');
  const problems: string[] = [];
  const level: string[] = [];
  for (const size of [
    { width: 375, height: 667 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    await settleFrames(page);
    const tag = `R16-rest at ${size.width} x ${size.height} with normal text`;
    const sideways = await sidewaysOf(page);
    if (sideways > 0) problems.push(`${tag}: the page scrolls sideways by ${sideways}px`);
    problems.push(...(await pencilProblems(page, tag)));
    if (size.width === 375) {
      const read = await removeLevel(page);
      const low = read.wordTop - read.titleLineTop;
      if (Math.abs(low) > 3) level.push(`${tag}: FL-13, the Remove word's top is ${r1(low)}px below the title's first line`);
      if (Math.abs(read.titleTop - read.rowTop) > 0.5) level.push(`${tag}: FL-13, the title sits ${r1(read.titleTop - read.rowTop)}px below its row's top`);
    }
  }
  levelProblems.set(page, level);
  expect(problems, 'R16-rest: the normal-text reads at reach').toEqual([]);
  await page.setViewportSize({ width: 320, height: 568 });
  const root = collectionCardOf(page);
  await settleAnimations(root);
  return { root };
};

// R16-rest extras, every cell: (a) the header address line, (b) the Google Calendar zone of the header
// card, (c) the address section, (d) the Theme card, (e) the Timezone card, (f) the Tutorial card and
// (g) the Danger Zone section, each read with the cell's checks; then the pencil box, and at 200% its
// glyph's size and line height. Every problem is thrown as one joined line.
// The header card is NOT read whole, on purpose: under the address line it can draw the signed-in
// session's own name, which for a password login is the account's real address, and a failed read
// prints the words it lists into the CI log. Every address these parts can show is the staged one.
const restExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `R16-rest ${cell.id}`;
  const problems: string[] = [...(levelProblems.get(page) ?? [])];
  const parts: Array<[string, Locator]> = [
    ['the header address line', page.getByText(LONG_EMAIL, { exact: true }).first()],
    ['the Google Calendar zone', page.getByRole('heading', { level: 2, name: 'Google Calendar Integration', exact: true }).locator('xpath=ancestor::div[3]')],
    ['the address section', page.locator('section.card').filter({ hasText: 'The address we use now' })],
    ['the Theme card', cardWith(page, 'Theme')],
    ['the Timezone card', cardWith(page, 'Timezone')],
    ['the Tutorial card', cardWith(page, 'Tutorial')],
    ['the Danger Zone section', page.locator('section.card').filter({ has: page.getByRole('heading', { level: 2, name: 'Danger Zone', exact: true }) })],
  ];
  for (const [name, part] of parts) {
    try {
      await expectPart(part, cell, `${tag} ${name}`);
    } catch (error) {
      problems.push(`${name}: ${firstLine(error)}`);
    }
  }
  problems.push(...(await pencilProblems(page, tag)));
  if (cell.mode !== '100') {
    const glyph = await pencilOf(page).evaluate((el) => ({ fontSize: getComputedStyle(el).fontSize, lineHeight: getComputedStyle(el).lineHeight }));
    if (glyph.fontSize !== '32px' || glyph.lineHeight !== '32px') problems.push(`${tag}: the pencil glyph is ${glyph.fontSize} on a ${glyph.lineHeight} line, not 32px on 32px`);
  }
  if (cell.id === BUSY_CELL) problems.push(...(await busyRemoveProblems(page, tag)));
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// ---------------------------------------------------------------------------------------------
// O07: the time-zone list (the Combobox listbox) open on Profile, after a FAILED save.
// The save is PATCH /users/<id>/timezone: caught here on a pathname predicate (any host), answered
// 500 in the browser, never handed on. The reach picks a zone, waits for the failure line, reopens
// the list, and at 375 and 320 with normal text reads:
//   (i)  with the field near the top of the window the list opens BELOW the field and the failure
//        line, which sits between the hint and the field (pick O-9d = B), is readable: the point at
//        its centre is the line itself (asserted);
//   (ii) with the field near the bottom of the window the list flips ABOVE the field (the shared
//        Combobox places it; this plan does not own that file): what covers the line's centre is
//        READ, attached and printed, not asserted (owner item for look 2 when it is the list);
//   and the two theme buttons: icon and word centred (left and right gaps within 1px, N48).
// The root is the open listbox. The reads are thrown by every cell's extras, not by the reach.
const isTimezoneSave = (url: URL): boolean => /\/users\/[^/]+\/timezone$/.test(url.pathname);
const timezoneRouted = new WeakSet<Page>();
const timezoneProblems = new WeakMap<Page, string[]>();
const timezoneField = (page: Page): Locator => page.getByRole('combobox', { name: 'Timezone', exact: true });
const timezoneList = (page: Page): Locator => page.getByRole('listbox', { name: 'Timezones', exact: true });
const saveErrorLine = (page: Page): Locator => page.locator('[data-testid="timezone-save-error"]');

/** Scroll so the Timezone field's top sits fromTop px under the window's top, with the list closed, then open it. */
async function openListAt(page: Page, fromTop: number): Promise<void> {
  if (await timezoneList(page).isVisible()) {
    await page.keyboard.press('Escape');
    await timezoneList(page).waitFor({ state: 'hidden', timeout: 5_000 });
  }
  await timezoneField(page).evaluate((el, top) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - top), fromTop);
  await settleFrames(page);
  await timezoneField(page).click();
  await timezoneList(page).waitFor({ state: 'visible', timeout: 5_000 });
  await settleFrames(page);
}

interface TimezoneRead {
  /** The failure line's bottom minus the field's top: zero or less when the line sits above the field. */
  lineOverField: number;
  /** What is drawn at the centre of the failure line. */
  atLineCentre: 'line' | 'listbox' | 'other';
  /** The list's box against the field's: where the Combobox placed it. */
  placed: 'below' | 'above' | 'over';
  fieldBottomToWindowBottom: number;
}
async function readTimezone(page: Page): Promise<TimezoneRead> {
  return page.evaluate(() => {
    const line = document.querySelector('[data-testid="timezone-save-error"]');
    const field = document.querySelector('#profile-timezone');
    const list = document.querySelector('[role="listbox"][aria-label="Timezones"]');
    const surface = list?.parentElement;
    if (!line || !field || !list || !surface) throw new Error('the failure line, the Timezone field or its open list is missing');
    const l = line.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    const s = surface.getBoundingClientRect();
    const hit = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
    const atLineCentre = hit && line.contains(hit) ? 'line' : hit && surface.contains(hit) ? 'listbox' : 'other';
    const placed = s.top >= f.bottom - 0.5 ? 'below' : s.bottom <= f.top + 0.5 ? 'above' : 'over';
    return { lineOverField: l.bottom - f.top, atLineCentre, placed, fieldBottomToWindowBottom: window.innerHeight - f.bottom };
  });
}

/** In each theme button: the gap from its left edge to the icon, against the gap from the word to its right edge. */
async function themeGaps(page: Page): Promise<Array<{ name: string; left: number; right: number }>> {
  return cardWith(page, 'Theme').evaluate((card) =>
    Array.from(card.querySelectorAll('button')).map((button) => {
      const box = button.getBoundingClientRect();
      const icon = button.querySelector('svg');
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let word: DOMRect | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim();
        if (text !== 'Light' && text !== 'Dark') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        word = range.getBoundingClientRect();
      }
      if (!icon || !word) throw new Error('a theme button has no icon or no word');
      return { name: (button.textContent ?? '').replace(/[^A-Za-z]/g, ''), left: icon.getBoundingClientRect().left - box.left, right: box.right - word.right };
    }),
  );
}

const reachTimezoneList: SurfaceRow['reach'] = async (page) => {
  if (!timezoneRouted.has(page)) {
    timezoneRouted.add(page);
    await page.route(isTimezoneSave, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 500, json: { error: 'held by the large-text sweep' } });
    });
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 2, name: 'Timezone', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Edit username', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await expectNormalText(page, 'O07');

  // Pick a zone; the save fails in the browser; the failure line shows and stays.
  await timezoneField(page).click();
  await timezoneField(page).fill('Chicago');
  await page.getByRole('option', { name: /Chicago/ }).first().click();
  await saveErrorLine(page).waitFor({ state: 'visible', timeout: 10_000 });

  const problems: string[] = [];
  const flipped: string[] = [];
  for (const size of [
    { width: 375, height: 667 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    await settleFrames(page);
    const tag = `O07 at ${size.width} x ${size.height} with normal text`;

    // (i) the field near the top of the window: the list opens below it.
    await openListAt(page, 200);
    const below = await readTimezone(page);
    if (below.placed !== 'below') problems.push(`${tag}: with the field near the top the list is ${below.placed} the field, not below it`);
    if (below.lineOverField > 0.5) problems.push(`O-9d: ${tag}: the failure line ends ${r1(below.lineOverField)}px below the field's top (it must sit above the field)`);
    if (below.atLineCentre !== 'line') problems.push(`O-9d: ${tag}: with the list open below the field, the point at the failure line's centre is the ${below.atLineCentre}, not the line`);

    // (ii) the field near the bottom of the window: the list flips above it. Recorded, not asserted.
    let above: TimezoneRead | null = null;
    for (const room of [96, 64, 32, 8]) {
      await openListAt(page, size.height - room - 44);
      above = await readTimezone(page);
      if (above.placed === 'above') break;
    }
    if (!above || above.placed !== 'above') problems.push(`${tag}: the staging never made the list flip above the field (last: ${above?.placed}, ${r1(above?.fieldBottomToWindowBottom ?? 0)}px under the field)`);
    else flipped.push(`${size.width}: ${above.atLineCentre}`);

    // N48: icon and word centred in both theme buttons.
    for (const gap of await themeGaps(page)) {
      if (Math.abs(gap.left - gap.right) > 1) problems.push(`N48: ${tag}: the ${gap.name} button's icon starts ${r1(gap.left)}px from its left edge and its word ends ${r1(gap.right)}px from its right edge`);
    }
  }
  const flippedLine = `O-9d flipped: ${flipped.join(', ')}`;
  process.stdout.write(`${flippedLine}\n`);
  await test.info().attach('O-9d flipped', { body: flippedLine, contentType: 'text/plain' });
  timezoneProblems.set(page, problems);

  // Left for the cells: the list open below the field.
  await openListAt(page, 200);
  const root = timezoneList(page);
  await settleAnimations(root);
  return { root };
};

// O07 extras, every cell: the list is still open, and the reach's normal-text reads hold.
const timezoneListExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const problems = [...(timezoneProblems.get(page) ?? [])];
  if (!(await timezoneList(page).isVisible())) problems.push(`O07 ${cell.id}: the time-zone list closed`);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'R16-rest', census: 'R16', kind: 'route', owner: '89.6-27', status: 'enforced', reach: reachRest, answers: answerOwnedGames, extras: restExtras },
  { id: 'D34', census: 'D34', kind: 'dialog', owner: '89.6-27', status: 'pending' },
  { id: 'O07', census: 'O07', kind: 'overlay', owner: '89.6-27', status: 'enforced', reach: reachTimezoneList, extras: timezoneListExtras },
];
