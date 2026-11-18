import { test, expect, type Locator, type Page } from '@playwright/test';

// Phase 88.9-62 (owner fix rows 52-X22 ruled C, 52-X28) — the month calendar's nav row, RENDERED,
// at 375 and at 1280, at 100% and with root text at 200%.
//
// WHAT. X22: the two month arrows sit on the month title's line at the row's two edges, with the
// time-zone caption and the Today + Month | List row below (owner pick C at N13, 2026-11-12).
// X28 (WCAG 1.4.4 Resize Text): with text at 200% on a 375 phone nothing in the nav row overlaps
// or leaves the calendar card, both arrows stay on screen, no word of the month title is split,
// and the List view's Month | List switch stays inside the card. jsdom lays nothing out, so the
// unit pins can only read classes; this file reads the boxes. X28's weekday half (and 52-X13's
// compact grid at 200%): the weekday row reads Sun to Sat at 100% and shows one whole letter per
// day at 200% text on a phone, where a column is narrower than a three-letter name.
//
// HOW 200% IS PRODUCED. A style tag sets the root font size to 200%, the same injection the
// capture that found X28 used. The app sets no root font size, so every rem doubles (the title
// is 40px). Browser zoom is NOT used: 200% zoom at 375 is a 187.5 CSS px layout, which is the
// WCAG 1.4.10 Reflow case and not the frames the owner saw.
//
// READ-ONLY. No route, no API write. The one press that changes anything is List (P3), which
// stores the view choice in this browser context's localStorage and nowhere else.
//
// PROJECT SPLIT. The phone cases run in the phone project (375, the group page, because the home
// calendar is behind the Calendar sheet at phone width) and the desktop cases in the journeys
// project (1280, the home page), each describe carrying the opposite skip, the same shape as
// e2e/calendar-list-sections.spec.ts ("PROJECT SPLIT. The two phone cases run in the phone project").
//
// SELECTOR POLICY: role, label and ARIA attributes only, never a class name. Every box a check
// compares is read in ONE page read, after the layout has settled. Failure messages print
// numbers only, never fixture values. e2e is CI-only by design: authored locally (typecheck,
// lint and listing), verified in CI.

// Repo idiom: no fallback group id, so a job that failed to export the fixture id fails loudly
// instead of opening group 1 (e2e/browse-games-modal.spec.ts ("const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';")).
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

const ROOT_200 = 'html{font-size:200% !important}';
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface NavRead {
  error: string;
  content: Box;
  navScrollWidth: number;
  navClientWidth: number;
  pageScrollWidth: number;
  prev: Box;
  next: Box;
  heading: Box;
  headingLineHeight: number;
  caption: Box | null;
  today: Box;
  group: Box;
  segments: Box[];
  words: number;
  wordRects: number[];
}

interface WeekdayRead {
  error: string;
  rowScrollWidth: number;
  rowClientWidth: number;
  labels: string[];
  cells: Box[];
  texts: Array<Box | null>;
}

const midY = (box: Box): number => (box.top + box.bottom) / 2;
const fmt = (box: Box): string =>
  `x ${box.left.toFixed(1)}..${box.right.toFixed(1)}, y ${box.top.toFixed(1)}..${box.bottom.toFixed(1)}`;

// The nav row's boxes against the card's content box, all in one page read.
async function readNav(card: Locator): Promise<NavRead> {
  return card.evaluate((el) => {
    const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const px = (value: string): number => Number.parseFloat(value) || 0;
    const style = getComputedStyle(el);
    const outer = el.getBoundingClientRect();
    const left = outer.left + px(style.borderLeftWidth) + px(style.paddingLeft);
    const top = outer.top + px(style.borderTopWidth) + px(style.paddingTop);
    const right = outer.right - px(style.borderRightWidth) - px(style.paddingRight);
    const bottom = outer.bottom - px(style.borderBottomWidth) - px(style.paddingBottom);
    const out = {
      error: '',
      content: { left, top, right, bottom, width: right - left, height: bottom - top },
      navScrollWidth: 0,
      navClientWidth: 0,
      pageScrollWidth: document.documentElement.scrollWidth,
      prev: zero,
      next: zero,
      heading: zero,
      headingLineHeight: 0,
      caption: null as null | typeof zero,
      today: zero,
      group: zero,
      segments: [] as Array<typeof zero>,
      words: 0,
      wordRects: [] as number[],
    };
    const prev = el.querySelector('button[aria-label="Previous month"]');
    const next = el.querySelector('button[aria-label="Next month"]');
    const heading = el.querySelector('h3');
    const today = Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Today');
    const group = el.querySelector('[role="group"][aria-label="Calendar view"]');
    const caption = Array.from(el.querySelectorAll('p')).find((p) => (p.textContent ?? '').trim().startsWith('Times shown in'));
    if (!prev || !next || !heading || !today || !group) {
      out.error = `missing in the card: ${[!prev && 'Previous month', !next && 'Next month', !heading && 'the month title', !today && 'Today', !group && 'the Calendar view group'].filter(Boolean).join(', ')}`;
      return out;
    }
    // The nav block: the smallest ancestor of the Previous chevron that also holds Today.
    let nav = prev.parentElement;
    while (nav && !nav.contains(today)) nav = nav.parentElement;
    if (!nav) {
      out.error = 'no element holds both the Previous month chevron and Today';
      return out;
    }
    out.navScrollWidth = nav.scrollWidth;
    out.navClientWidth = nav.clientWidth;
    out.prev = box(prev);
    out.next = box(next);
    out.heading = box(heading);
    const headingStyle = getComputedStyle(heading);
    out.headingLineHeight = px(headingStyle.lineHeight) || px(headingStyle.fontSize) * 1.4;
    out.caption = caption ? box(caption) : null;
    out.today = box(today);
    out.group = box(group);
    out.segments = Array.from(group.querySelectorAll('button')).map(box);
    // One Range per title word: a word that breaks across two lines has two client rects.
    out.words = (heading.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const word = /\S+/g;
      for (let match = word.exec(text); match; match = word.exec(text)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        out.wordRects.push(range.getClientRects().length);
      }
    }
    return out;
  });
}

// The weekday row, found by STRUCTURE: the one element under the card with exactly seven
// children whose first child holds Sun. A label's box is the box of its VISIBLE text (a Range
// over the cell: text that is not displayed has no client rects).
async function readWeekdays(card: Locator): Promise<WeekdayRead> {
  return card.evaluate((el) => {
    const out = { error: '', rowScrollWidth: 0, rowClientWidth: 0, labels: [] as string[], cells: [] as Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number }>, texts: [] as Array<{ left: number; top: number; right: number; bottom: number; width: number; height: number } | null> };
    const rows = Array.from(el.querySelectorAll('div')).filter(
      (d) => d.children.length === 7 && (d.children[0].textContent ?? '').includes('Sun'),
    );
    if (rows.length !== 1) {
      out.error = `expected one seven-cell weekday row under the card, found ${rows.length}`;
      return out;
    }
    out.rowScrollWidth = rows[0].scrollWidth;
    out.rowClientWidth = rows[0].clientWidth;
    for (const cell of Array.from(rows[0].children)) {
      const r = cell.getBoundingClientRect();
      out.cells.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      out.labels.push(((cell as HTMLElement).innerText ?? '').trim());
      const range = document.createRange();
      range.selectNodeContents(cell);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) {
        out.texts.push(null);
        continue;
      }
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      out.texts.push({ left, top, right, bottom, width: right - left, height: bottom - top });
    }
    return out;
  });
}

// The web font is in, then two animation frames: the style and layout work a class or a
// root-size change causes is done.
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => null));
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function injectRoot200(page: Page, label: string): Promise<void> {
  await page.addStyleTag({ content: ROOT_200 });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
      message: `${label}: the root font size did not become 32px after the 200% style tag`,
    })
    .toBe('32px');
  await settle(page);
}

const viewGroup = (scope: Locator | Page) => scope.getByRole('group', { name: 'Calendar view', exact: true });
const segment = (scope: Locator | Page, name: 'Month' | 'List') => viewGroup(scope).getByRole('button', { name, exact: true });

// The loaded calendar card: the parent of the calendar's level-2 heading, once the Month | List
// switch is on the page (while the calendar loads the same heading sits in another parent).
async function calendarCard(page: Page, title: string, label: string): Promise<Locator> {
  await expect(viewGroup(page), `${label}: the Month | List switch never appeared`).toBeVisible({ timeout: 20_000 });
  const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
  await expect(heading, `${label}: expected exactly one level-2 calendar heading`).toHaveCount(1);
  const card = heading.locator('xpath=..');
  await expect(viewGroup(card), `${label}: the heading's parent does not hold the Month | List switch`).toHaveCount(1);
  return card;
}

// A stored view choice can reopen the List view; the month grid is this file's starting point.
async function showMonth(page: Page, card: Locator, label: string): Promise<void> {
  if ((await segment(card, 'Month').getAttribute('aria-pressed')) !== 'true') {
    await segment(card, 'Month').click();
  }
  await expect(segment(card, 'Month'), `${label}: Month is not the pressed segment`).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('button', { name: 'Previous month', exact: true }), `${label}: the Previous month chevron`).toBeVisible();
  await settle(page);
}

// The accessible names are unchanged by the move (P4: no new control, no new name).
async function expectNames(card: Locator, label: string): Promise<void> {
  for (const name of ['Previous month', 'Next month', 'Today']) {
    await expect(card.getByRole('button', { name, exact: true }), `${label}: expected exactly one ${name} button`).toHaveCount(1);
  }
  await expect(viewGroup(card).getByRole('button'), `${label}: the Calendar view group does not hold two segments`).toHaveCount(2);
  await expect(segment(card, 'Month'), `${label}: the Month segment`).toHaveCount(1);
  await expect(segment(card, 'List'), `${label}: the List segment`).toHaveCount(1);
}

function expectChevronsOnTitleLine(read: NavRead, label: string): void {
  for (const [name, chevron] of [['Previous month', read.prev], ['Next month', read.next]] as const) {
    const y = midY(chevron);
    expect(
      y >= read.heading.top - 0.5 && y <= read.heading.bottom + 0.5,
      `${label}: the ${name} chevron's centre (y ${y.toFixed(1)}) is not on the month title's line (y ${read.heading.top.toFixed(1)}..${read.heading.bottom.toFixed(1)})`,
    ).toBe(true);
  }
}

// X22, arm C at 100%.
function expectArmC(read: NavRead, label: string): void {
  expect(read.error, `${label}: ${read.error}`).toBe('');
  expectChevronsOnTitleLine(read, label);
  expect(Math.abs(read.prev.left - read.content.left), `${label}: the Previous month chevron starts at ${read.prev.left.toFixed(1)}px, not at the card's content edge ${read.content.left.toFixed(1)}px`).toBeLessThanOrEqual(1);
  expect(Math.abs(read.next.right - read.content.right), `${label}: the Next month chevron ends at ${read.next.right.toFixed(1)}px, not at the card's content edge ${read.content.right.toFixed(1)}px`).toBeLessThanOrEqual(1);
  expect(read.heading.height, `${label}: the month title is ${read.heading.height.toFixed(1)}px tall, more than one ${read.headingLineHeight.toFixed(1)}px line`).toBeLessThanOrEqual(read.headingLineHeight * 1.5);
  for (const [name, chevron] of [['Previous month', read.prev], ['Next month', read.next]] as const) {
    expect(chevron.width, `${label}: the ${name} chevron is ${chevron.width.toFixed(1)}x${chevron.height.toFixed(1)}, under 44 wide`).toBeGreaterThanOrEqual(44);
    expect(chevron.height, `${label}: the ${name} chevron is ${chevron.width.toFixed(1)}x${chevron.height.toFixed(1)}, under 44 tall`).toBeGreaterThanOrEqual(44);
    expect(Math.round(chevron.width), `${label}: the ${name} chevron is ${chevron.width.toFixed(1)}x${chevron.height.toFixed(1)}, not square`).toBe(Math.round(chevron.height));
  }
  expect(read.caption, `${label}: no time-zone caption (Times shown in ...) in the card; the signed-in account must have a time zone`).not.toBeNull();
  if (!read.caption) return;
  const titleRowBottom = Math.max(read.prev.bottom, read.next.bottom, read.heading.bottom);
  expect(read.caption.top, `${label}: the caption starts at ${read.caption.top.toFixed(1)}px, above the title row's bottom at ${titleRowBottom.toFixed(1)}px`).toBeGreaterThanOrEqual(titleRowBottom - 0.5);
  expect(Math.abs(midY(read.today) - midY(read.group)), `${label}: Today (centre y ${midY(read.today).toFixed(1)}) and the Month | List switch (centre y ${midY(read.group).toFixed(1)}) are not on one row`).toBeLessThanOrEqual(1);
  const controlsTop = Math.min(read.today.top, read.group.top);
  expect(controlsTop, `${label}: the Today + Month | List row starts at ${controlsTop.toFixed(1)}px, above the caption's bottom at ${read.caption.bottom.toFixed(1)}px`).toBeGreaterThanOrEqual(read.caption.bottom - 0.5);
  const controlsMid = (Math.min(read.today.left, read.group.left) + Math.max(read.today.right, read.group.right)) / 2;
  const contentMid = (read.content.left + read.content.right) / 2;
  expect(Math.abs(controlsMid - contentMid), `${label}: the Today + Month | List row is centred on ${controlsMid.toFixed(1)}px, the card's content on ${contentMid.toFixed(1)}px`).toBeLessThanOrEqual(2);
}

// X28: the nav row holds with root text at 200%.
function expectNavHolds(read: NavRead, viewportWidth: number, label: string): void {
  expect(read.error, `${label}: ${read.error}`).toBe('');
  expect(Math.abs(midY(read.prev) - midY(read.next)), `${label}: the two chevrons are not on one line (centre y ${midY(read.prev).toFixed(1)} and ${midY(read.next).toFixed(1)})`).toBeLessThanOrEqual(1);
  expect(read.caption, `${label}: no time-zone caption (Times shown in ...) in the card; the signed-in account must have a time zone`).not.toBeNull();
  const parts: Array<[string, Box]> = [
    ['the Previous month chevron', read.prev],
    ['the Next month chevron', read.next],
    ['the month title', read.heading],
    ...(read.caption ? ([['the caption', read.caption]] as Array<[string, Box]>) : []),
    ['Today', read.today],
    ['the Month | List switch', read.group],
  ];
  for (const [name, part] of parts.slice(0, 2)) {
    expect(part.left, `${label}: ${name} starts at ${part.left.toFixed(1)}px, left of the screen`).toBeGreaterThanOrEqual(-0.5);
    expect(part.right, `${label}: ${name} ends at ${part.right.toFixed(1)}px, past the ${viewportWidth}px screen`).toBeLessThanOrEqual(viewportWidth + 0.5);
  }
  for (const [name, part] of parts) {
    const inside =
      part.left >= read.content.left - 0.5 &&
      part.right <= read.content.right + 0.5 &&
      part.top >= read.content.top - 0.5 &&
      part.bottom <= read.content.bottom + 0.5;
    expect(inside, `${label}: ${name} (${fmt(part)}) leaves the card's content box (${fmt(read.content)})`).toBe(true);
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const [aName, a] = parts[i];
      const [bName, b] = parts[j];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(overlapX > 0.5 && overlapY > 0.5, `${label}: ${aName} (${fmt(a)}) overlaps ${bName} (${fmt(b)})`).toBe(false);
    }
  }
  expect(read.wordRects.length, `${label}: read ${read.wordRects.length} title words, the title holds ${read.words}`).toBe(read.words);
  expect(read.words, `${label}: the month title holds no word`).toBeGreaterThan(0);
  read.wordRects.forEach((rects, i) => {
    expect(rects, `${label}: title word ${i + 1} of ${read.words} is drawn in ${rects} pieces, so it is split across lines`).toBe(1);
  });
  expect(read.navScrollWidth, `${label}: the nav block's content is ${read.navScrollWidth}px wide in a ${read.navClientWidth}px block`).toBeLessThanOrEqual(read.navClientWidth + 1);
}

function logWidths(read: NavRead, label: string): void {
  const switchWidth = read.segments.length > 0 ? Math.max(...read.segments.map((s) => s.right)) - Math.min(...read.segments.map((s) => s.left)) : read.group.width;
  // eslint-disable-next-line no-console -- the measured widths are recorded from the CI log
  console.log(`[88.9-62 nav row] ${label}: card content ${read.content.width.toFixed(1)}px, switch ${switchWidth.toFixed(1)}px, page scrollWidth ${read.pageScrollWidth}px`);
}

test.describe('the month nav row at phone width (88.9-62, X22 + X28)', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    'the 375px group-page calendar renders at phone width only; this describe runs in the phone project',
  );

  test.beforeEach(() => {
    expect(
      E2E_GROUP_ID,
      'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this file opens a group the fixtures do not own.',
    ).toBeTruthy();
  });

  test('X22 (88.9): at 375 the month arrows sit on the title\'s line at the row\'s edges, with the caption and the Today + Month | List row below, arrows 44x44', async ({ page }) => {
    const label = 'group page month view, 375';
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const card = await calendarCard(page, 'Calendar', label);
    await showMonth(page, card, label);
    await expectNames(card, label);
    const read = await readNav(card);
    logWidths(read, label);
    expectArmC(read, label);
  });

  test('X28 (88.9): at 375 with root text at 200% the nav row holds: no overlap, nothing outside the card, both chevrons on screen, no title word split', async ({ page }) => {
    const label = 'group page month view, 375, root text 200%';
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const card = await calendarCard(page, 'Calendar', label);
    await showMonth(page, card, label);
    await injectRoot200(page, label);
    const read = await readNav(card);
    // The page's own scrollWidth is logged, not asserted: a sideways scroll alone is tolerated.
    logWidths(read, label);
    expectNavHolds(read, page.viewportSize()?.width ?? 375, label);
  });

  test('X28 (88.9): at 375 with root text at 200% the List view\'s Month | List switch stays inside the card', async ({ page }) => {
    const label = 'group page List view, 375, root text 200%';
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const card = await calendarCard(page, 'Calendar', label);
    if ((await segment(card, 'List').getAttribute('aria-pressed')) !== 'true') {
      await segment(card, 'List').click();
    }
    await expect(segment(card, 'List'), `${label}: List is not the pressed segment`).toHaveAttribute('aria-pressed', 'true');
    await injectRoot200(page, label);
    await expect(segment(card, 'Month'), `${label}: the Month segment is not visible`).toBeVisible();
    await expect(segment(card, 'List'), `${label}: the List segment is not visible`).toBeVisible();
    const read = await card.evaluate((el) => {
      const px = (value: string): number => Number.parseFloat(value) || 0;
      const style = getComputedStyle(el);
      const outer = el.getBoundingClientRect();
      const group = el.querySelector('[role="group"][aria-label="Calendar view"]');
      const sides = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      return {
        left: outer.left + px(style.borderLeftWidth) + px(style.paddingLeft),
        right: outer.right - px(style.borderRightWidth) - px(style.paddingRight),
        group: group ? sides(group) : null,
        segments: group ? Array.from(group.querySelectorAll('button')).map(sides) : [],
      };
    });
    expect(read.group, `${label}: no Calendar view group in the card`).not.toBeNull();
    expect(read.segments.length, `${label}: the Calendar view group does not hold two segments`).toBe(2);
    const contentWidth = read.right - read.left;
    const switchWidth = read.segments.length > 0 ? Math.max(...read.segments.map((s) => s.right)) - Math.min(...read.segments.map((s) => s.left)) : 0;
    // eslint-disable-next-line no-console -- the measured widths are recorded from the CI log
    console.log(`[88.9-62 nav row] ${label}: card content ${contentWidth.toFixed(1)}px, switch ${switchWidth.toFixed(1)}px`);
    const parts = [...(read.group ? [read.group] : []), ...read.segments];
    parts.forEach((part, i) => {
      const name = i === 0 ? 'the Month | List switch' : `segment ${i} of the switch`;
      expect(part.left, `${label}: ${name} starts at ${part.left.toFixed(1)}px, left of the card's content edge at ${read.left.toFixed(1)}px (switch ${switchWidth.toFixed(1)}px in ${contentWidth.toFixed(1)}px)`).toBeGreaterThanOrEqual(read.left - 0.5);
      expect(part.right, `${label}: ${name} ends at ${part.right.toFixed(1)}px, past the card's content edge at ${read.right.toFixed(1)}px (switch ${switchWidth.toFixed(1)}px in ${contentWidth.toFixed(1)}px)`).toBeLessThanOrEqual(read.right + 0.5);
    });
  });

  test('X28 (88.9): at 375 the weekday row reads Sun to Sat at 100% and, with root text at 200%, shows seven whole one-letter labels side by side in their columns', async ({ page }) => {
    const viewportWidth = page.viewportSize()?.width ?? 375;
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const card = await calendarCard(page, 'Calendar', 'group page weekday row, 375');
    await showMonth(page, card, 'group page weekday row, 375');

    // Every weekday label is whole, inside its own column, on the screen, and clear of its neighbours.
    const expectWholeLabels = (read: WeekdayRead, label: string): void => {
      expect(read.error, `${label}: ${read.error}`).toBe('');
      expect(read.cells.length, `${label}: the weekday row does not hold seven cells`).toBe(7);
      const texts: Box[] = [];
      read.texts.forEach((text, i) => {
        const cell = read.cells[i];
        expect(text, `${label}: weekday ${i + 1} shows no text`).not.toBeNull();
        if (!text) return;
        texts.push(text);
        expect(
          text.left >= cell.left - 0.5 && text.right <= cell.right + 0.5,
          `${label}: weekday ${i + 1}'s text (x ${text.left.toFixed(1)}..${text.right.toFixed(1)}, ${text.width.toFixed(1)}px) leaves its column (x ${cell.left.toFixed(1)}..${cell.right.toFixed(1)}, ${cell.width.toFixed(1)}px)`,
        ).toBe(true);
        expect(text.left, `${label}: weekday ${i + 1}'s text starts at ${text.left.toFixed(1)}px, left of the screen`).toBeGreaterThanOrEqual(-0.5);
        expect(text.right, `${label}: weekday ${i + 1}'s text ends at ${text.right.toFixed(1)}px, past the ${viewportWidth}px screen`).toBeLessThanOrEqual(viewportWidth + 0.5);
      });
      for (let i = 1; i < texts.length; i++) {
        expect(texts[i].left, `${label}: weekday ${i + 1}'s text starts at ${texts[i].left.toFixed(1)}px, over weekday ${i}'s text, which ends at ${texts[i - 1].right.toFixed(1)}px`).toBeGreaterThanOrEqual(texts[i - 1].right - 0.5);
      }
    };
    const logLabels = (read: WeekdayRead, label: string): void => {
      const widths = read.texts.map((text) => (text ? text.width.toFixed(1) : 'none')).join(' ');
      const column = read.cells.length > 0 ? read.cells[0].width.toFixed(1) : 'none';
      // eslint-disable-next-line no-console -- the measured label widths are recorded from the CI log
      console.log(`[88.9-62 weekday row] ${label}: label widths ${widths} px in ${column}px columns`);
    };

    const rest = await readWeekdays(card);
    logLabels(rest, 'group page weekday row, 375');
    expect(rest.labels, 'group page weekday row, 375: the weekday row does not read Sun to Sat at 100%').toEqual(WEEKDAYS_SHORT);
    expectWholeLabels(rest, 'group page weekday row, 375');

    const label = 'group page weekday row, 375, root text 200%';
    await injectRoot200(page, label);
    const big = await readWeekdays(card);
    logLabels(big, label);
    expect(big.labels, `${label}: the weekday row does not read S M T W T F S`).toEqual(WEEKDAYS_SHORT.map((day) => day[0]));
    expectWholeLabels(big, label);
    expect(big.rowScrollWidth, `${label}: the weekday row's content is ${big.rowScrollWidth}px wide in a ${big.rowClientWidth}px row`).toBeLessThanOrEqual(big.rowClientWidth + 1);

    // DECISION Phase 88.9-62 (P4, card width): the card's own scrollWidth is LOGGED here, chosen
    // OVER asserting it. The nav block (P2) and the weekday row (above) are asserted on their own
    // boxes, which is what this plan fixes. The card also holds the day grid, where a day with
    // more events than it shows prints a "+N more" label that is wider than a 200% column: in
    // the Saturday column that label runs past the card, so a card-level check would go red or
    // green with the seeded dates, for a defect this plan does not fix (recorded in the plan's
    // SUMMARY for routing). Asserting the card here is a decision, not a cleanup.
    const fit = await card.evaluate((el) => {
      const out = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, dayNumbers: 0, overlaps: 0, error: '', pastCell: 0, counts: 0, badCounts: [] as string[], shownTiles: 0, shownMore: 0, countsOutside: [] as string[], smallOverlays: [] as string[] };
      // The day grid, by structure: the one element under the card holding whole weeks of cells.
      const grids = Array.from(el.querySelectorAll('div')).filter((d) => [28, 35, 42].includes(d.children.length));
      if (grids.length !== 1) {
        out.error = `expected one month grid of 28, 35 or 42 cells under the card, found ${grids.length}`;
        return out;
      }
      // A day number is the first text in its cell that is one or two digits and nothing else.
      const rects: DOMRect[] = [];
      for (const cell of Array.from(grids[0].children)) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!/^\d{1,2}$/.test((node.textContent ?? '').trim())) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            rects.push(rect);
            // R22 + R26 (88.9-52): how far the day number runs past its own cell's right edge.
            out.pastCell = Math.max(out.pastCell, rect.right - cell.getBoundingClientRect().right);
          }
          break;
        }
      }
      // R22 + R26 (88.9-52): in this narrow grid each day with nights shows one count (CSS content
      // read from data-count); a several-night day shows no tile, and no +N label shows anywhere.
      const shown = (node: Element) => node.getClientRects().length > 0;
      for (const stack of Array.from(grids[0].querySelectorAll('[data-count]'))) {
        const nights = stack.getAttribute('data-count') ?? '';
        const before = getComputedStyle(stack, '::before');
        out.counts += 1;
        // Chromium reports the resolved string; an engine that reports the attr() form is let through.
        const content = before.content.replace(/"/g, '');
        if (before.display === 'none' || (content !== nights && content !== 'attr(data-count)')) out.badCounts.push(`${nights}: display ${before.display}, content ${before.content}`);
        if (nights !== '1') out.shownTiles += Array.from(stack.querySelectorAll('[role="button"]')).filter(shown).length;
        // G1 (88.9-52 round 4): a one- or two-digit count's ink ends inside its own cell. The count
        // is CSS content, which no Range can read, so its ink is measured on a canvas in the
        // count's own computed font and placed from the count line's margin and padding. Three
        // digits are left out: on a 320 phone at 200% no size at or above 12px holds them.
        const cell = stack.parentElement?.getBoundingClientRect();
        const canvas = document.createElement('canvas').getContext('2d');
        if (cell && canvas && before.display !== 'none' && nights.length <= 2) {
          canvas.font = `${before.fontWeight} ${before.fontSize} ${before.fontFamily}`;
          const ink = canvas.measureText(nights).width;
          const left = stack.getBoundingClientRect().left + (parseFloat(before.marginLeft) || 0) + (parseFloat(before.paddingLeft) || 0);
          if (left < cell.left - 0.5 || left + ink > cell.right + 0.5) out.countsOutside.push(`${nights}: ink ${left.toFixed(1)}..${(left + ink).toFixed(1)} at ${before.fontSize}, cell ${cell.left.toFixed(1)}..${cell.right.toFixed(1)}`);
        }
        // G1: a one-night day's clear overlay button covers its day cell (2px each way: the border).
        if (cell && nights === '1') {
          const overlay = stack.querySelector('[role="button"]')?.getBoundingClientRect();
          if (!overlay || overlay.width < cell.width - 2.5 || overlay.height < cell.height - 2.5) out.smallOverlays.push(overlay ? `${overlay.width.toFixed(1)} x ${overlay.height.toFixed(1)} in a ${cell.width.toFixed(1)} x ${cell.height.toFixed(1)} cell` : 'no button on a one-night day');
        }
        out.shownMore += Array.from(stack.querySelectorAll('[role="img"]')).filter(shown).length;
      }
      out.dayNumbers = rects.length;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const x = Math.min(rects[i].right, rects[j].right) - Math.max(rects[i].left, rects[j].left);
          const y = Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top);
          if (x > 0.5 && y > 0.5) out.overlaps += 1;
        }
      }
      return out;
    });
    // eslint-disable-next-line no-console -- the card's measured width is recorded from the CI log, not asserted (marker above)
    console.log(`[88.9-62 weekday row] ${label}: card scrollWidth ${fit.scrollWidth}px in a ${fit.clientWidth}px card`);
    // Guard: the day numbers under the letters do not run into each other either.
    expect(fit.error, `${label}: ${fit.error}`).toBe('');
    expect(fit.dayNumbers, `${label}: fewer than 28 day numbers were read from the month grid`).toBeGreaterThanOrEqual(28);
    expect(fit.overlaps, `${label}: ${fit.overlaps} pairs of day numbers overlap`).toBe(0);
    // R22 + R26 (88.9-52, owner pick C): the day numbers are held inside their own cells (2px of
    // slack: the 12px floor on a narrower phone), and the tiles and +N give way to one count.
    // The seeded month may hold no night at all, so the number of counts is logged, not asserted.
    // eslint-disable-next-line no-console -- how many days carried a count is recorded from the CI log (seed-dependent)
    console.log(`[88.9-52 R22 + R26] ${label}: ${fit.counts} days carry a count; the widest day number ends ${fit.pastCell.toFixed(1)}px past its cell edge`);
    expect(fit.pastCell, `${label}: a day number runs ${fit.pastCell.toFixed(1)}px past its own cell`).toBeLessThanOrEqual(2);
    expect(fit.badCounts, `${label}: a day with nights does not show its count`).toEqual([]);
    expect(fit.shownTiles, `${label}: ${fit.shownTiles} tiles still show on days with several nights`).toBe(0);
    expect(fit.shownMore, `${label}: ${fit.shownMore} +N labels still show`).toBe(0);
    // G1 (88.9-52 round 4): counts end inside their own cells, and a one-night day's button is its cell.
    expect(fit.countsOutside, `${label}: a count's ink leaves its own cell`).toEqual([]);
    expect(fit.smallOverlays, `${label}: a one-night day's button does not cover its cell`).toEqual([]);
  });
});

test.describe('the month nav row at desktop width (88.9-62, X22 + X28)', () => {
  test.skip(
    ({ isMobile }) => Boolean(isMobile),
    'the home month calendar renders at 768px and up only; this describe runs in the journeys project at 1280',
  );

  test('X22 (88.9): at 1280 the month arrows sit on the title\'s line at the row\'s edges, with the caption and the Today + Month | List row below', async ({ page }) => {
    const label = 'home month view, 1280';
    await page.goto('/');
    const card = await calendarCard(page, 'Game Sessions Calendar', label);
    await showMonth(page, card, label);
    await expectNames(card, label);
    const read = await readNav(card);
    logWidths(read, label);
    expectArmC(read, label);
  });

  test('X28 (88.9): at 1280 with root text at 200% the arrows stay on the title line and nothing in the nav row overlaps or leaves the card', async ({ page }) => {
    const label = 'home month view, 1280, root text 200%';
    await page.goto('/');
    const card = await calendarCard(page, 'Game Sessions Calendar', label);
    await showMonth(page, card, label);
    await injectRoot200(page, label);
    const read = await readNav(card);
    logWidths(read, label);
    expectNavHolds(read, page.viewportSize()?.width ?? 1280, label);
    expectChevronsOnTitleLine(read, label);

    // Guard: at 1280 the weekday row still reads Sun to Sat, each label inside its column.
    const weekdays = await readWeekdays(card);
    expect(weekdays.error, `${label}: ${weekdays.error}`).toBe('');
    expect(weekdays.labels, `${label}: the weekday row does not read Sun to Sat`).toEqual(WEEKDAYS_SHORT);
    weekdays.texts.forEach((text, i) => {
      const cell = weekdays.cells[i];
      expect(text, `${label}: weekday ${i + 1} shows no text`).not.toBeNull();
      if (!text) return;
      expect(
        text.left >= cell.left - 0.5 && text.right <= cell.right + 0.5,
        `${label}: weekday ${i + 1}'s text (x ${text.left.toFixed(1)}..${text.right.toFixed(1)}) leaves its column (x ${cell.left.toFixed(1)}..${cell.right.toFixed(1)})`,
      ).toBe(true);
    });
  });
});
