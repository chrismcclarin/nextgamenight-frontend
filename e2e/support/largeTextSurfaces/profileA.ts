// Surface rows: the availability part of Profile (census R16), the schedule forms, Disconnect Google Calendar and the BGG import. Owner: plan 89.6-22.
// One row per line, each with its census id. D25 and D26 (the schedule dialogs) are re-owned to plan 89.6-41.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE PATTERNS READ. Every R16 row answers the availability patterns read in the browser (answers,
// status 200) with one Wednesday schedule and one specific-date override, so the CI login's real
// schedules are never touched and every row holds the same two pattern rows. Nothing that writes is
// pressed: the schedule Delete is pressed ONCE (it arms; arming writes nothing) and disarmed by a
// press on the section heading, and the sweep's guard holds every write all the same.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { readCellUnderExceptions, readPageZoomCellUnderExceptions } from '../largeTextExceptions';
import { expectLargeTextCell, expectPageZoomUsable } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';

const PATTERNS = [
  {
    id: 'e2e-sweep-89-6-22-recurring',
    type: 'recurring_pattern',
    pattern_data: { dayOfWeek: 3, startTime: '19:00', endTime: '23:00' },
    start_date: '2026-01-07',
    end_date: '2026-12-30',
    is_available: null,
  },
  {
    id: 'e2e-sweep-89-6-22-override',
    type: 'specific_override',
    pattern_data: { date: '2026-12-31', startTime: '18:00', endTime: '22:00' },
    is_available: true,
  },
];

const isPatternsRead = (url: URL): boolean => /\/availability\/user\/[^/]+\/patterns$/.test(url.pathname);
const answerPatterns = (url: URL): unknown => (isPatternsRead(url) ? PATTERNS : undefined);

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

/** Two animation frames and the fonts: enough for a resize to lay out before a read. */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

const sidewaysOf = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Every element whose right edge passes the window and that no scrolling or clipping ancestor holds,
 * outermost per branch. Layout facts only: tag, class list, data-testid or id, and the box. NO text,
 * so no email line or phone wording from the signed-in page reaches an attachment or a log (review M074).
 */
async function offendersOf(page: Page): Promise<Array<{ tag: string; classes: string; id: string; left: number; right: number; width: number }>> {
  return page.evaluate(() => {
    const window_ = document.documentElement.clientWidth;
    const held = (el: Element): boolean => {
      for (let up = el.parentElement; up && up !== document.documentElement; up = up.parentElement) {
        if (getComputedStyle(up).overflowX !== 'visible') return true;
      }
      return false;
    };
    const past = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.right + window.scrollX > window_ + 0.5 && !held(el);
    });
    const set = new Set(past);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return past
      .filter((el) => !el.parentElement || !set.has(el.parentElement))
      .slice(0, 40)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          classes: el.getAttribute('class') ?? '',
          id: el.getAttribute('data-testid') ?? el.getAttribute('id') ?? '',
          left: r1(box.left + window.scrollX),
          right: r1(box.right + window.scrollX),
          width: r1(box.width),
        };
      });
  });
}

/** Attach the offenders of a page that scrolls sideways, and print them for the CI log (layout facts only). */
async function recordOffenders(page: Page, label: string): Promise<void> {
  const offenders = await offendersOf(page);
  const body = JSON.stringify(offenders, null, 2);
  await test.info().attach(`offenders-${label}.json`, { body, contentType: 'application/json' });
  process.stdout.write(`89.6-22 R16-availability offenders ${label}: ${JSON.stringify(offenders)}\n`);
}

// R16-availability: Profile, the Notification Preferences card and the availability section with the
// New Schedule form open. Before any text mode is applied the page is read at normal text at 320 and
// 375: nothing may scroll sideways, and at 375 the reminder select sits centred on its Remind me:
// label (at 320 pick O-M3 A+ allows the select its own line, so only the sideways read runs there).
const reachAvailability: SurfaceRow['reach'] = async (page) => {
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 2, name: 'Availability Settings' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Delete Wednesday schedule', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  if (fontSize !== '16px') throw new Error(`R16-availability: STOP, the reach ran at a ${fontSize} root, not at normal text: the sweep's cell order changed`);
  for (const size of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(size);
    await settleFrames(page);
    const sideways = await sidewaysOf(page);
    if (sideways > 0) await recordOffenders(page, `reach-${size.width}-normal`);
    expect(sideways, `R16-availability: at ${size.width} x ${size.height} with normal text the page scrolls sideways by ${sideways}px`).toBeLessThanOrEqual(0);
  }
  const select = page.getByRole('combobox', { name: 'Remind me' });
  const label = page.getByText('Remind me:', { exact: true });
  const selectBox = await select.boundingBox();
  const labelBox = await label.boundingBox();
  if (!selectBox || !labelBox) throw new Error('R16-availability: the Remind me select or its label is not drawn at 375 with normal text');
  const offset = Math.abs(selectBox.y + selectBox.height / 2 - (labelBox.y + labelBox.height / 2));
  expect(offset, `R16-availability: at 375 with normal text the reminder select centre is ${offset}px off its Remind me: label's`).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: '+ Add Schedule', exact: true }).click();
  const root = page.locator('#availability-settings');
  await settleAnimations(root);
  return { root };
};

// The armed schedule Delete is read in these cells: 320 / 200% with the five checks, and the two
// A8 page-zoom cells with the lighter check (final-pass correction 19: it is a page two-tap).
const ARMED_CELLS = new Set(['320x568-dark-200', '215x466-dark-100-zoom', '187x333-dark-100-zoom']);
const RESTING_DELETE = 'Delete Wednesday schedule';
const ARMED_DELETE = 'Tap again to confirm';

/** Read a part of the page as the sweep reads the root: the lighter check at a page-zoom width, else the five. */
async function expectPart(part: Locator, cell: SweepCell, tag: string): Promise<void> {
  if (cell.zoom) expectPageZoomUsable((await readPageZoomCellUnderExceptions(part)).read, tag);
  else expectLargeTextCell((await readCellUnderExceptions(part)).read, tag);
}

// R16-availability extras, every cell: (a) the Notification Preferences card read with the cell's
// checks; (b) when the page scrolls sideways, the elements past the window are attached and printed
// (recorded, not asserted); (c) in ARMED_CELLS the Wednesday schedule's Delete is pressed ONCE, its
// row read once it reads Tap again, then the section heading is pressed to disarm, and the disarm is
// ASSERTED before the extras return (a press that did not disarm would make the next cell's single
// press the committing second tap). Every problem is thrown as one joined line.
const availabilityExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `R16-availability ${cell.id}`;
  const problems: string[] = [];
  const card = page
    .getByRole('heading', { name: 'Notification Preferences', exact: true })
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " card ")][1]');
  try {
    await expectPart(card, cell, `${tag} Notification Preferences card`);
  } catch (error) {
    problems.push(firstLine(error));
  }
  if ((await sidewaysOf(page)) > 0) await recordOffenders(page, cell.id);
  if (ARMED_CELLS.has(cell.id)) {
    const resting = page.getByRole('button', { name: RESTING_DELETE, exact: true });
    const armed = page.getByRole('button', { name: ARMED_DELETE, exact: true });
    if ((await armed.count()) > 0) throw new Error(`${tag}: a Delete was already armed before this cell's press; nothing was pressed${problems.length > 0 ? ` || ${problems.join(' || ')}` : ''}`);
    await resting.click();
    await armed.waitFor({ state: 'visible', timeout: 10_000 });
    if ((await resting.count()) !== 0) throw new Error(`${tag}: the armed Delete is not the Wednesday schedule's`);
    const row = armed.locator('xpath=..');
    await settleAnimations(row);
    try {
      await expectPart(row, cell, `${tag} with the Wednesday schedule's Delete armed`);
    } catch (error) {
      problems.push(firstLine(error));
    }
    await page.getByRole('heading', { level: 2, name: 'Availability Settings' }).click();
    try {
      await resting.waitFor({ state: 'attached', timeout: 5_000 });
    } catch {
      throw new Error(`${tag}: pressing the Availability Settings heading did not disarm the schedule Delete; no further press is made${problems.length > 0 ? ` || ${problems.join(' || ')}` : ''}`);
    }
    if ((await armed.count()) !== 0) throw new Error(`${tag}: a button still reads ${ARMED_DELETE} after the heading press`);
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'R16-availability', census: 'R16', kind: 'route', owner: '89.6-22', status: 'enforced', reach: reachAvailability, answers: answerPatterns, extras: availabilityExtras },
  { id: 'D25', census: 'D25', kind: 'dialog', owner: '89.6-41', status: 'pending' },
  { id: 'D26', census: 'D26', kind: 'dialog', owner: '89.6-41', status: 'pending' },
  { id: 'D32', census: 'D32', kind: 'dialog', owner: '89.6-22', status: 'pending' },
  { id: 'D33', census: 'D33', kind: 'dialog', owner: '89.6-22', status: 'pending' },
];
