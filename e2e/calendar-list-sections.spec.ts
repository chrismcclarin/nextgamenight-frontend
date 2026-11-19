import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { describeRatio, focusRingMeasurement } from './support/contrast';
import { E2E_GROUP_ID } from './support/groupSettings';
import { scrubbedFetch } from './support/scrubbedFetch';
import { expectTouchTarget } from './support/touchTarget';

// Phase 88.9-61 (owner fix rows 52-X25 ruled X25a, 52-X29 ruled A) — the Calendar list's two
// folding section headers, RENDERED, at 375 and at 1280.
//
// WHAT. Upcoming events and Past events (N) are two equal headers on every Calendar list (the
// phone Calendar sheet, the group page List view, the home List view). Each header STICKS to
// the top of the list while its own rows are under it, so the label over a list always names
// the rows below it (the owner at N40: it looks like the past events are under the Upcoming
// events heading). This file proves the three things no unit test can see, because jsdom lays
// nothing out:
//   1. the headers really stick (position sticky, pinned to the region's top once scrolled);
//   2. WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum): walking the rows by keyboard, forward
//      and back, the focused row is never under a stuck header. The mechanism is scroll
//      padding on the region; the header is the one component both sections use
//      (src/app/components/CalendarListView.js ("function SectionHeader("));
//   3. WCAG 2.4.7 Focus Visible: a focused header button shows its whole ring, drawn INSIDE the
//      button, because the scroll region clips anything drawn outside it on the left and top.
// Plus the X29 halves a render can check: no Today delineator on the group page, the list
// opens at its top, a date outside the current year carries its year.
//
// STAGING. The seeded account does not hold enough nights to make a list scroll, so the two
// events reads are edited IN THE BROWSER ONLY (GET only, the real response through
// scrubbedFetch, e2e/support/scrubbedFetch.ts ("export async function scrubbedFetch(")): the newest real past nights are kept, the oldest of
// them is moved to 15 March of last year, and twelve copies of a real night are added on the
// twelve days after the last real upcoming night. Nothing is written: the walk presses Tab and
// Shift+Tab only, and every test ends by asserting zero non-GET calls to the events and RSVP
// endpoints.
//
// PROJECT SPLIT. The two phone cases run in the phone project (375) and the home case in the
// journeys project (1280), each describe carrying the opposite skip, the same shape as
// e2e/phone-home-event-discovery.spec.ts ("PROJECT SPLIT — stated explicitly, as the plan requires.").
//
// SELECTOR POLICY: role, label and ARIA attributes only, never a class name. Geometry and
// computed style are read where they are real. Failure messages print numbers and colours
// only, never fixture values. e2e is CI-only by design: authored locally, verified in CI.

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_COPIES = 12;
const KEPT_PAST = 6;
const MIN_PAST = 3;

type Night = Record<string, unknown> & { id?: unknown; start_date?: unknown };

interface Staging {
  error: string;
  rewrites: number;
  writes: string[];
}

const startMs = (night: Night): number =>
  typeof night.start_date === 'string' ? Date.parse(night.start_date) : Number.NaN;

// Move one night to a new start, carrying its end with it when it has one.
function moved(night: Night, id: unknown, start: number): Night {
  const from = startMs(night);
  const end = typeof night.end_date === 'string' ? Date.parse(night.end_date) : Number.NaN;
  return {
    ...night,
    id,
    start_date: new Date(start).toISOString(),
    ...(Number.isNaN(end) || Number.isNaN(from) ? {} : { end_date: new Date(start + (end - from)).toISOString() }),
  };
}

// The staged payload, or a string naming why the real one cannot be staged.
function stage(real: Night[], nowMs: number): Night[] | string {
  const dated = real.filter((night) => !Number.isNaN(startMs(night)));
  if (dated.length === 0) return 'the events read holds no night with a start date (an empty payload is a fixture failure)';
  const template = dated[0];

  // PAST: started more than two days ago, so no timezone or run-window edge can move it.
  const past = dated.filter((night) => startMs(night) < nowMs - 2 * DAY_MS).sort((a, b) => startMs(b) - startMs(a));
  const kept = past.slice(0, KEPT_PAST);
  // A group with little history is topped up with copies of a real night, so the Past section
  // always holds a recent night AND one to move to last year.
  for (let n = 1; kept.length < MIN_PAST; n++) {
    kept.push(moved(template, `x61-past-${n}`, nowMs - (4 + 7 * n) * DAY_MS));
  }
  kept.sort((a, b) => startMs(b) - startMs(a));
  const oldest = kept[kept.length - 1];
  const lastYear = new Date(nowMs).getUTCFullYear() - 1;
  // Noon UTC on 15 March: the 15th in every timezone from UTC-11 to UTC+11.
  const lastYearNight = moved(oldest, oldest.id, Date.UTC(lastYear, 2, 15, 12, 0, 0));

  // EVERYTHING ELSE that is not past stays as the server sent it.
  const rest = dated.filter((night) => startMs(night) >= nowMs - 2 * DAY_MS);
  // UPCOMING: twelve copies after the LAST real upcoming night, so the soonest upcoming night
  // (the one the sheet's hero reads RSVPs for) is still a real one whenever the seed has one.
  const base = rest.reduce((latest, night) => Math.max(latest, startMs(night)), nowMs);
  const copies = Array.from({ length: UPCOMING_COPIES }, (_, i) =>
    moved({ ...template, status: 'scheduled', EventParticipations: [] }, `x61-up-${i + 1}`, base + (i + 1) * DAY_MS),
  );
  return [...kept.slice(0, -1), lastYearNight, ...rest, ...copies];
}

async function stageEvents(page: Page): Promise<Staging> {
  const state: Staging = { error: '', rewrites: 0, writes: [] };
  page.on('request', (request) => {
    if (request.method() === 'GET') return;
    const path = new URL(request.url()).pathname;
    if (/\/api\/(events|rsvp)(\/|$)/.test(path)) state.writes.push(request.method());
  });
  const handler = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await scrubbedFetch(route);
    let real: unknown;
    try {
      real = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (!Array.isArray(real)) {
      await route.fulfill({ response, json: real });
      return;
    }
    const staged = stage(real as Night[], Date.now());
    if (typeof staged === 'string') {
      state.error = staged;
      await route.fulfill({ response, json: real });
      return;
    }
    state.rewrites += 1;
    await route.fulfill({ response, json: staged });
  };
  await page.route('**/api/events/user/**', handler);
  await page.route('**/api/events/group/**', handler);
  // A copy has no row on the server. If the seed holds no real upcoming night, the sheet's hero
  // would read RSVPs for the first copy; that one read is answered here, in the browser, empty.
  await page.route('**/api/rsvp/event/x61-*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, json: { rsvps: [], summary: { yes: 0, maybe: 0, no: 0 } } });
  });
  return state;
}

const upcomingHeader = (scope: Locator) => scope.getByRole('button', { name: 'Upcoming events', exact: true });
const pastHeader = (scope: Locator) => scope.getByRole('button', { name: /^Past events \(\d+\)$/ });
// The element holding both sections (the parent of the Upcoming section).
const listRoot = (scope: Locator) => upcomingHeader(scope).locator('xpath=ancestor::section[1]/parent::*');
// An event row is the role=button element that contains a heading (the two header buttons sit
// INSIDE a heading and contain none).
const upcomingRows = (scope: Locator, page: Page) =>
  upcomingHeader(scope)
    .locator('xpath=ancestor::section[1]')
    .getByRole('button')
    .filter({ has: page.getByRole('heading') });

interface RegionRead {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  top: number;
  left: number;
  bottom: number;
}

// The list's scroll region: the nearest ancestor of the Upcoming header that scrolls vertically.
async function readRegion(header: Locator): Promise<RegionRead | null> {
  return header.evaluate((el) => {
    let node = el.parentElement;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') break;
      node = node.parentElement;
    }
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return {
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      top: box.top,
      left: box.left,
      bottom: box.bottom,
    };
  });
}

interface Placement {
  left: number;
  top: number;
  bottom: number;
  regionLeft: number;
  regionTop: number;
  regionBottom: number;
}

// Where a header button sits against the scroll region, BOTH boxes read in one page read.
// AMENDED Phase 88.9-61 (after CI run 43730473151 at FE 3db93e4, 1 flaky): the first form read
// the region and the button in two separate round trips, and on the Calendar sheet the first
// read can land while the sheet is still sliding up, so the two boxes were 17px apart in time,
// not in space. One read cannot disagree with itself.
async function readPlacement(button: Locator): Promise<Placement | null> {
  return button.evaluate((el) => {
    let node = el.parentElement;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') break;
      node = node.parentElement;
    }
    if (!node) return null;
    const region = node.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      bottom: box.bottom,
      regionLeft: region.left,
      regionTop: region.top,
      regionBottom: region.bottom,
    };
  });
}

// Wait until the list has stopped moving (the Calendar sheet slides up when it opens): two
// consecutive reads of the header's position, a moment apart, must agree.
async function waitForStill(target: Locator, label: string): Promise<void> {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox();
        const y = box ? Math.round(box.y * 100) / 100 : Number.NaN;
        const still = y === last;
        last = y;
        return still;
      },
      { message: `${label}: the list never stopped moving`, intervals: [100, 100, 150, 200, 250], timeout: 5_000 },
    )
    .toBe(true);
}

interface HeaderRead {
  position: string;
  top: number;
  bottom: number;
  left: number;
  expanded: string | null;
}

// A section header, read from its button: the h3 around it is the element that sticks.
async function readHeader(button: Locator): Promise<HeaderRead> {
  return button.evaluate((el) => {
    const heading = el.closest('h3') ?? el;
    const box = heading.getBoundingClientRect();
    return {
      position: getComputedStyle(heading).position,
      top: box.top,
      bottom: box.bottom,
      left: el.getBoundingClientRect().left,
      expanded: el.getAttribute('aria-expanded'),
    };
  });
}

interface FocusRead {
  kind: 'row' | 'header' | 'other';
  section: 'upcoming' | 'past' | 'none';
  headerPosition: string;
  headerTop: number;
  headerBottom: number;
  rowTop: number;
  regionTop: number;
  scrollTop: number;
}

// Where keyboard focus is now, against the header of the section it is in.
async function readFocus(page: Page): Promise<FocusRead> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const blank = { headerPosition: '', headerTop: 0, headerBottom: 0, rowTop: 0, regionTop: 0, scrollTop: 0 };
    if (!active) return { kind: 'other' as const, section: 'none' as const, ...blank };
    const section = active.closest('section[aria-labelledby]');
    const headingId = section?.getAttribute('aria-labelledby') ?? '';
    const heading = headingId ? document.getElementById(headingId) : null;
    if (!section || !heading) return { kind: 'other' as const, section: 'none' as const, ...blank };
    let region = heading.parentElement;
    while (region) {
      const overflow = getComputedStyle(region).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') break;
      region = region.parentElement;
    }
    const isRow = active.getAttribute('role') === 'button' && active.querySelector('h4, h5, h6') !== null;
    const isHeader = active.tagName === 'BUTTON' && active.hasAttribute('aria-controls') && heading.contains(active);
    const headingBox = heading.getBoundingClientRect();
    return {
      kind: isRow ? ('row' as const) : isHeader ? ('header' as const) : ('other' as const),
      section: headingId.endsWith('-upcoming') ? ('upcoming' as const) : ('past' as const),
      headerPosition: getComputedStyle(heading).position,
      headerTop: headingBox.top,
      headerBottom: headingBox.bottom,
      rowTop: active.getBoundingClientRect().top,
      regionTop: region ? region.getBoundingClientRect().top : 0,
      scrollTop: region ? region.scrollTop : 0,
    };
  });
}

// The ring is 2px wide and, on a row, sits 2px outside it: 4px above the row's top edge.
const RING_REACH_PX = 4;

// THE WALK (WCAG 2.4.11). From the Upcoming header, Tab to the last upcoming row, then Shift+Tab
// back to the first. At every step the section header is sticky and the focused row's top is at
// least a ring's reach below the header's bottom edge. At least one step must have happened
// with the list scrolled and the header pinned to the top of the region, or the walk proved
// nothing about a STUCK header.
async function walkUpcomingRows(page: Page, scope: Locator, label: string): Promise<void> {
  const header = upcomingHeader(scope);
  const region = await readRegion(header);
  expect(region, `${label}: no scrolling ancestor above the Upcoming header`).not.toBeNull();
  if (!region) return;
  expect(
    region.scrollHeight,
    `${label}: the list does not scroll (scrollHeight ${region.scrollHeight}, clientHeight ${region.clientHeight}); the staged nights did not reach it`,
  ).toBeGreaterThan(region.clientHeight + 100);

  let stuckSteps = 0;
  const check = (step: FocusRead, direction: string, index: number) => {
    const where = `${label}, ${direction} step ${index}`;
    expect(step.headerPosition, `${where}: the section header is not sticky`).toBe('sticky');
    expect(
      step.rowTop,
      `${where}: the focused row starts at ${step.rowTop}px, under the header's bottom edge at ${step.headerBottom}px (it needs ${RING_REACH_PX}px of clearance for its ring)`,
    ).toBeGreaterThanOrEqual(step.headerBottom + RING_REACH_PX);
    if (step.scrollTop > 0 && Math.abs(step.headerTop - step.regionTop) <= 1) stuckSteps += 1;
  };

  await header.focus();
  let rows = 0;
  for (let i = 1; i <= 40; i++) {
    await page.keyboard.press('Tab');
    const step = await readFocus(page);
    if (step.kind !== 'row' || step.section !== 'upcoming') break;
    rows += 1;
    check(step, 'forward', i);
  }
  expect(rows, `${label}: the forward walk reached ${rows} upcoming rows (the staging adds ${UPCOMING_COPIES})`).toBeGreaterThanOrEqual(UPCOMING_COPIES);
  expect(rows, `${label}: the forward walk never left the upcoming rows in 40 steps`).toBeLessThan(40);

  // The loop stopped one step PAST the last upcoming row; each Shift+Tab from here lands on a row.
  for (let i = rows; i >= 1; i--) {
    await page.keyboard.press('Shift+Tab');
    const step = await readFocus(page);
    expect(step.kind, `${label}, back step ${i}: focus is not on an upcoming row`).toBe('row');
    expect(step.section, `${label}, back step ${i}: focus left the Upcoming section`).toBe('upcoming');
    check(step, 'back', i);
  }
  expect(stuckSteps, `${label}: no step of the walk had the list scrolled with the header pinned to the top of the region`).toBeGreaterThan(0);
}

// THE HEADER RING (WCAG 2.4.7). A keyboard-focused header button draws its ring INSIDE itself
// and lies inside the scroll region, so the region cannot clip the ring on the left or the top.
// The ratio of the ring against the button's own ground is measured too (3:1 is the floor for a
// focus indicator) and printed, so the number can be recorded from the CI log.
async function expectInsetHeaderRing(page: Page, scope: Locator, label: string): Promise<void> {
  const header = upcomingHeader(scope);
  const ring = await focusRingMeasurement(page, header, label);
  // eslint-disable-next-line no-console -- the measured header ring ratio is recorded from the CI log
  console.log(`[88.9-61 header ring] ${label}: ${ring.ratio.toFixed(3)}:1 (${ring.fg} on ${ring.ground}), ${ring.ringGroundKind}`);
  expect.soft(ring.boxShadow, `${label}: the focused header button's ring is not drawn inset (box-shadow: ${ring.boxShadow})`).toContain('inset');
  expect.soft(ring.ringGroundKind, `${label}: the ring is not an inset ring`).toBe('inset');
  expect.soft(ring.ratio, describeRatio(label, 3, ring)).toBeGreaterThanOrEqual(3);
  const place = await readPlacement(header);
  expect(place, `${label}: no scroll region around the header button`).not.toBeNull();
  if (!place) return;
  expect.soft(place.left, `${label}: the header button starts at ${place.left}px, left of the region's edge at ${place.regionLeft}px`).toBeGreaterThanOrEqual(place.regionLeft - 0.5);
  expect.soft(place.top, `${label}: the header button starts at ${place.top}px, above the region's top at ${place.regionTop}px`).toBeGreaterThanOrEqual(place.regionTop - 0.5);
}

// Both headers at rest: Upcoming open, Past closed, both 44px tall, both sticky, the rule above Past.
async function expectHeadersAtRest(scope: Locator, label: string): Promise<void> {
  const upcoming = upcomingHeader(scope);
  const past = pastHeader(scope);
  await expect(upcoming, `${label}: the Upcoming header`).toBeVisible();
  await expect(past, `${label}: the Past header`).toBeVisible();
  await expect(upcoming).toHaveAttribute('aria-expanded', 'true');
  await expect(past).toHaveAttribute('aria-expanded', 'false');
  await expectTouchTarget(upcoming, `${label}: the Upcoming events header button`, { axes: 'height' });
  await expectTouchTarget(past, `${label}: the Past events header button`, { axes: 'height' });
  const rule = await past.evaluate((el) => {
    const section = el.closest('section[aria-labelledby]');
    const style = section ? getComputedStyle(section) : null;
    return { width: style?.borderTopWidth ?? '', style: style?.borderTopStyle ?? '' };
  });
  expect(rule, `${label}: the rule above Past`).toEqual({ width: '1px', style: 'solid' });
  expect((await readHeader(upcoming)).position, `${label}: the Upcoming header is not sticky`).toBe('sticky');
  expect((await readHeader(past)).position, `${label}: the Past header is not sticky`).toBe('sticky');
}

// X29 years. With both sections open: the oldest past day header is the staged 15 March of
// last year and carries that year; no day header carries THIS year; at least one carries none.
async function expectYearsOnOldDates(scope: Locator, label: string): Promise<void> {
  const past = pastHeader(scope);
  if ((await past.getAttribute('aria-expanded')) !== 'true') await past.click();
  await expect(past).toHaveAttribute('aria-expanded', 'true');
  const now = new Date();
  const thisYear = now.getFullYear();
  const lastYear = now.getUTCFullYear() - 1;
  const staged = listRoot(scope).getByRole('heading', { level: 4, name: new RegExp(`, March 15, ${lastYear}$`) });
  await expect(staged, `${label}: no day header reads March 15 of last year with its year`).toHaveCount(1);
  const headers = await listRoot(scope).getByRole('heading', { level: 4 }).allTextContents();
  const withYear = headers.filter((text) => /, \d{4}$/.test(text.trim()));
  const withoutYear = headers.filter((text) => !/, \d{4}$/.test(text.trim()));
  expect(withoutYear.length, `${label}: every one of the ${headers.length} day headers carries a year`).toBeGreaterThan(0);
  // Within a day and a half of New Year the runner's year and the viewer's can differ, so the
  // this-year half is only asserted outside that window.
  const startOfNextYear = Date.UTC(now.getUTCFullYear() + 1, 0, 1);
  const startOfThisYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const nearBoundary = Math.min(startOfNextYear - now.getTime(), now.getTime() - startOfThisYear) < 1.5 * DAY_MS;
  if (!nearBoundary) {
    const thisYearCount = withYear.filter((text) => text.trim().endsWith(`, ${thisYear}`)).length;
    expect(thisYearCount, `${label}: ${thisYearCount} day headers carry the current year`).toBe(0);
  }
}

async function expectStaged(state: Staging, label: string): Promise<void> {
  expect(state.error, `${label}: the events read could not be staged`).toBe('');
  expect(state.rewrites, `${label}: no events read was staged`).toBeGreaterThan(0);
}

const listSwitch = (page: Page) =>
  page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'List', exact: true }).first();

test.describe('Calendar list sections at phone width (88.9-61, X25a + X29 A)', () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    'the Calendar sheet and the 375px group page List view render at phone width only; this describe runs in the phone project',
  );

  test("X25a (88.9): the Calendar sheet's two headers stick, fold and never cover a focused row; a last-year date carries its year", async ({ page }) => {
    const state = await stageEvents(page);
    await page.goto('/');
    const calendar = page.getByRole('button', { name: /^calendar\b/i });
    await expect(calendar.first(), 'the phone Calendar button').toBeVisible();
    await calendar.first().click();
    const sheet = page.getByRole('dialog', { name: 'Calendar' });
    await expect(sheet).toBeVisible();
    const label = 'Calendar sheet, 375';
    await expect(upcomingHeader(sheet), `${label}: the Upcoming header`).toBeVisible();
    await expect.poll(() => upcomingRows(sheet, page).count(), { message: `${label}: the staged upcoming rows` }).toBeGreaterThanOrEqual(UPCOMING_COPIES);
    await expectStaged(state, label);
    await waitForStill(upcomingHeader(sheet), label);

    // The list opens at its top.
    expect((await readRegion(upcomingHeader(sheet)))?.scrollTop, `${label}: the list does not open at its top`).toBe(0);
    await expectInsetHeaderRing(page, sheet, `${label}, header at the top`);
    await expectHeadersAtRest(sheet, label);

    await walkUpcomingRows(page, sheet, label);

    // A STUCK header keeps its whole ring: scroll deep, then focus the header by keyboard.
    await upcomingRows(sheet, page).nth(8).focus();
    await expectInsetHeaderRing(page, sheet, `${label}, header stuck`);
    const stuck = await readRegion(upcomingHeader(sheet));
    expect(stuck?.scrollTop ?? 0, `${label}: the list is not scrolled while the stuck header holds focus`).toBeGreaterThan(0);

    // Folding Upcoming from deep in it brings the Past header into view.
    await upcomingRows(sheet, page).nth(9).focus();
    await upcomingHeader(sheet).click();
    await expect(upcomingHeader(sheet)).toHaveAttribute('aria-expanded', 'false');
    await expect(upcomingHeader(sheet), `${label}: focus did not move to the header of the folded section`).toBeFocused();
    const folded = await readPlacement(pastHeader(sheet));
    expect(folded, `${label}: no scroll region around the Past header after the fold`).not.toBeNull();
    if (folded) {
      expect(folded.top, `${label}: after the fold the Past header starts at ${folded.top}px, above the region's top at ${folded.regionTop}px`).toBeGreaterThanOrEqual(folded.regionTop - 0.5);
      expect(folded.bottom, `${label}: after the fold the Past header ends at ${folded.bottom}px, below the region's bottom at ${folded.regionBottom}px`).toBeLessThanOrEqual(folded.regionBottom + 0.5);
    }
    await upcomingHeader(sheet).click();
    await expect(upcomingHeader(sheet)).toHaveAttribute('aria-expanded', 'true');

    await expectYearsOnOldDates(sheet, label);
    expect(state.writes, `${label}: the test wrote to the events or RSVP endpoints`).toEqual([]);
  });

  test('X29 (88.9): the group page List view at 375 takes the same two sections with no Today delineator', async ({ page }) => {
    const state = await stageEvents(page);
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    await expect(listSwitch(page), 'the Month | List switch on the group page').toBeVisible({ timeout: 15_000 });
    await listSwitch(page).click();
    const scope = page.getByRole('main');
    const label = 'group page List view, 375';
    await expect(upcomingHeader(scope), `${label}: the Upcoming header`).toBeVisible();
    await expect.poll(() => upcomingRows(scope, page).count(), { message: `${label}: the staged upcoming rows` }).toBeGreaterThanOrEqual(UPCOMING_COPIES);
    await expectStaged(state, label);
    await waitForStill(upcomingHeader(scope), label);

    await expect(page.getByRole('separator', { name: /^Today,/ }), `${label}: a Today delineator is still rendered`).toHaveCount(0);
    expect((await readRegion(upcomingHeader(scope)))?.scrollTop, `${label}: the list does not open at its top`).toBe(0);
    await expectInsetHeaderRing(page, scope, `${label}, header at the top`);
    await expectHeadersAtRest(scope, label);
    await walkUpcomingRows(page, scope, label);
    await expectYearsOnOldDates(scope, label);
    expect(state.writes, `${label}: the test wrote to the events or RSVP endpoints`).toEqual([]);
  });
});

test.describe('Calendar list sections at desktop width (88.9-61, X29 A)', () => {
  test.skip(
    ({ isMobile }) => Boolean(isMobile),
    'the home List view renders at 768px and up only; this describe runs in the journeys project at 1280',
  );

  test('X29 (88.9): the home List view at 1280 takes the two sections; a focused row is never under a header', async ({ page }) => {
    const state = await stageEvents(page);
    await page.goto('/');
    await expect(listSwitch(page), 'the Month | List switch on the home page').toBeVisible({ timeout: 15_000 });
    await listSwitch(page).click();
    const scope = page.getByRole('main');
    const label = 'home List view, 1280';
    await expect(upcomingHeader(scope), `${label}: the Upcoming header`).toBeVisible();
    await expect.poll(() => upcomingRows(scope, page).count(), { message: `${label}: the staged upcoming rows` }).toBeGreaterThanOrEqual(UPCOMING_COPIES);
    await expectStaged(state, label);
    await waitForStill(upcomingHeader(scope), label);

    await expect(page.getByRole('separator', { name: /^Today,/ }), `${label}: a Today delineator is still rendered`).toHaveCount(0);
    expect((await readRegion(upcomingHeader(scope)))?.scrollTop, `${label}: the list does not open at its top`).toBe(0);
    await expectInsetHeaderRing(page, scope, `${label}, header at the top`);
    await expectHeadersAtRest(scope, label);
    await walkUpcomingRows(page, scope, label);
    await expectYearsOnOldDates(scope, label);
    expect(state.writes, `${label}: the test wrote to the events or RSVP endpoints`).toEqual([]);
  });
});
