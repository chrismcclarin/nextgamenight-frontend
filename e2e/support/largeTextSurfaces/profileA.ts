// Surface rows: the availability part of Profile (census R16), the schedule forms, Disconnect Google Calendar and the BGG import. Owner: plan 89.6-22.
// One row per line, each with its census id. D25 and D26 (the schedule dialogs) are re-owned to plan 89.6-41.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE PATTERNS READ. Every R16 row answers the availability patterns read in the browser (answers,
// status 200) with one Wednesday schedule and one specific-date override, so the CI login's real
// schedules are never touched and every row holds the same two pattern rows. Nothing that writes is
// pressed: the schedule Delete is pressed ONCE (it arms; arming writes nothing) and disarmed by a
// press on the section heading, and the sweep's guard holds every write all the same.
//
// DECISION Phase 89.6-22 (identity-room): the identity row is marked data-room at run time so a title squeezed by the picture is read against the whole row, chosen OVER reading the identity row as root (the email line under the title is plan 89.6-27's truncate) and OVER a src attribute (no src hook for a test). Changing this is a decision, not a cleanup.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { routeGroupRead } from '../groupRead';
import { settleAnimations } from '../inFlight';
import { readCellUnderExceptions, readPageZoomCellUnderExceptions } from '../largeTextExceptions';
import { routePlanningPolls } from '../planningPolls';
import { scrubbedFetch } from '../scrubbedFetch';
import { THIRTY_LETTER_WORD, TWO_WORD_NAME, expectLargeTextCell, expectPageZoomUsable } from '../wordLines';
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

/** A reach reads at normal text: the sweep applies a cell's text mode only after the reach. */
async function expectNormalText(page: Page, id: string): Promise<void> {
  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  if (fontSize !== '16px') throw new Error(`${id}: STOP, the reach ran at a ${fontSize} root, not at normal text: the sweep's cell order changed`);
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
  // One short line per offender, box first: the CI log reader keeps about 260 characters of a line.
  offenders.forEach((o, n) => {
    process.stdout.write(`89.6-22 offender ${label} ${n + 1}/${offenders.length}: ${o.tag} right ${o.right} width ${o.width} left ${o.left} id '${o.id}' class '${o.classes.slice(0, 110)}'\n`);
  });
}

// R16-availability: Profile, the Notification Preferences card and the availability section with the
// New Schedule form open. Before any text mode is applied the page is read at normal text at 320 and
// 375: nothing may scroll sideways, and at 375 the reminder select sits centred on its Remind me:
// label (at 320 pick O-M3 A+ allows the select its own line, so only the sideways read runs there).
const reachAvailability: SurfaceRow['reach'] = async (page) => {
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 2, name: 'Availability Settings' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Delete Wednesday schedule', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await expectNormalText(page, 'R16-availability');
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

// R16-specific: the Specific Dates tab with the override form open. Before any text mode the strip
// is read at normal text at 320 and 375: every tab fits there, so no edge cue renders.
const stripCues = (page: Page): Locator => page.locator('#availability-settings [data-strip-cue]');
const reachSpecific: SurfaceRow['reach'] = async (page) => {
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 2, name: 'Availability Settings' }).waitFor({ state: 'visible', timeout: 15_000 });
  await expectNormalText(page, 'R16-specific');
  for (const size of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(size);
    await settleFrames(page);
    expect(await stripCues(page).count(), `R16-specific: at ${size.width} x ${size.height} with normal text the availability strip shows an edge cue`).toBe(0);
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('tab', { name: 'Specific Dates', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Override', exact: true }).click();
  const root = page.locator('#availability-settings');
  await settleAnimations(root);
  return { root };
};

// R16-specific extras, the 320 x 568 dark 200% cell only (X-01, the strip half): the strip scrolls
// there; scrolled to its start, the end that hides Specific Dates shows its aria-hidden cue. Then,
// still at the start, the first tab is focused and ArrowRight moves focus to Specific Dates, which
// must sit as clear of the cues as the geometry allows (review M027 / M115). Focus and the strip are
// put back for the cells after this one.
const STRIP_CELL = '320x568-dark-200';
const specificExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  if (cell.id !== STRIP_CELL) return;
  const tag = `R16-specific ${cell.id}`;
  const strip = page.getByRole('tablist', { name: 'Availability settings' });
  const scrolls = await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (!scrolls) throw new Error(`${tag}: the availability strip does not scroll at 320 / 200%, so the edge cue is not exercised`);
  await strip.evaluate((el) => el.scrollTo({ left: 0 }));
  const endCue = page.locator('#availability-settings [data-strip-cue="end"][aria-hidden="true"]');
  await expect(endCue, `${tag}: the strip hides Specific Dates at its end but shows no end cue`).toBeVisible();
  const first = page.getByRole('tab', { name: 'Schedules', exact: true });
  const specific = page.getByRole('tab', { name: 'Specific Dates', exact: true });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(specific, `${tag}: ArrowRight from Schedules did not move focus to Specific Dates`).toBeFocused();
  const coverage = () =>
    specific.evaluate(async (tab) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const t = tab.getBoundingClientRect();
      const box = (tab.closest('[role="tablist"]') as HTMLElement).getBoundingClientRect();
      const cues = Array.from(document.querySelectorAll('#availability-settings [data-strip-cue]')).map((el) => el.getBoundingClientRect());
      const covered = cues.reduce((sum, c) => sum + Math.max(0, Math.min(t.right, c.right) - Math.max(t.left, c.left)), 0);
      const cueWidth = cues[0]?.width ?? 32;
      const allowed = Math.max(0, t.width - (box.width - 2 * cueWidth)) + 0.5;
      return { covered, allowed };
    });
  await expect
    .poll(async () => {
      const read = await coverage();
      return read.covered <= read.allowed ? 'clear' : `covered ${read.covered}px, allowed ${read.allowed}px`;
    }, { message: `${tag}: the keyboard-focused Specific Dates tab stays under the edge cue` })
    .toBe('clear');
  await specific.evaluate((tab) => (tab as HTMLElement).blur());
};

// D32: Disconnect Google Calendar?, opened by Disconnect Calendar with the calendar status read
// answered connected. Its Disconnect is NEVER pressed.
const isCalendarStatus = (url: URL): boolean => /\/auth\/google\/status\/[^/]+$/.test(url.pathname);
const answerConnected = (url: URL): unknown => (isCalendarStatus(url) ? { connected: true } : answerPatterns(url));
const reachDisconnect: SurfaceRow['reach'] = async (page) => {
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Disconnect Calendar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Disconnect Google Calendar?', exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return { root: dialog, dialog };
};

// D33: Import your BGG collection?, opened by Import Collection with the 30-letter word typed as the
// BoardGameGeek username. Its Continue is NEVER pressed.
const reachImport: SurfaceRow['reach'] = async (page) => {
  await page.goto('/userProfile');
  await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('textbox', { name: 'BoardGameGeek username', exact: true }).fill(THIRTY_LETTER_WORD);
  const importButton = page.getByRole('button', { name: 'Import Collection', exact: true });
  await expect(importButton).toBeEnabled({ timeout: 15_000 });
  await expect(importButton).not.toHaveAttribute('aria-disabled', 'true');
  await importButton.click();
  const dialog = page.getByRole('dialog', { name: 'Import your BGG collection?', exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return { root: dialog, dialog };
};

// R16-identity: the profile title row with the self read staged in the browser. The real self read
// is fetched without its timezone parameter (scrubbedFetch, never a bare route.fetch: DECISION Phase
// 88.6.2-20) and its username set to one word that fits the identity row at 320 / 200% but not the
// column the picture leaves. The route is GET-only and matches the EXACT self-read path (a path
// ending in /users/<id>, a query allowed), never a prefix: the Profile writes are its siblings one
// segment below (username, timezone, phone, email, notification-preferences, tutorial), and a
// forwarded write would never reach the guard's hold, so any other method falls back to it first
// (review M073 / M075). The route is registered once per page, after the guard, so it runs first.
const STAGED_NAME = 'Gareth';
const isSelfRead = (url: URL): boolean => /\/users\/[^/]+$/.test(url.pathname);
const selfRouted = new WeakSet<Page>();
const titleOf = (page: Page): Locator => page.getByRole('heading', { level: 1, name: STAGED_NAME, exact: true });
const identityRowOf = (page: Page): Locator => titleOf(page).locator('xpath=ancestor::div[3]');
const reachIdentity: SurfaceRow['reach'] = async (page) => {
  if (!selfRouted.has(page)) {
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
      const json = body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as object), username: STAGED_NAME } : body;
      await route.fulfill({ response, json });
    });
  }
  await page.goto('/userProfile');
  await titleOf(page).waitFor({ state: 'visible', timeout: 15_000 });
  await identityRowOf(page).evaluate((el) => el.setAttribute('data-room', ''));
  const root = titleOf(page).locator('xpath=ancestor::div[1]');
  await settleAnimations(root);
  return { root };
};

// R16-identity extras, every cell: the data-room mark is still on the identity row (a re-render
// that dropped it would read the title against its own squeezed column instead).
const identityExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const marked = await identityRowOf(page).evaluate((el) => el.hasAttribute('data-room'));
  if (!marked) throw new Error(`R16-identity ${cell.id}: the identity row lost its data-room mark`);
};

// ---------------------------------------------------------------------------------------------
// THE SCHEDULE DIALOGS AND THE RECURRING CHECK-INS LIST (Phase 89.6-41: census D25, D26, R08).
// Create Schedule and Edit Schedule are opened from the planning page's inline Recurring
// Check-ins card (src/app/components/PromptScheduleManager.js ("// Inline variant: no modal backdrop, rendered directly in page flow")), which only
// an owner or admin sees; the CI login owns the E2E group. The card reads
// GET /groups/<id>/prompt-settings, a GET that WRITES: every row here answers it in the browser
// with a staged body (answerSettings), so the CI login's real schedules are never read or touched.
// The page's poll reads are staged by plan 89.6-20's one helper with no poll at all, and the group
// read with the two-word name, as the planning rows stage them
// (e2e/support/largeTextSurfaces/planning.ts ("async function openPlanning(")). Only presses that
// open state are made: + New Schedule, the phone kebab and its Edit or Delete. Create Schedule,
// Update Schedule, Confirm Delete, Pause and Resume are NEVER pressed; the guard holds every write.

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id, as in the planning rows.
const scheduleGroupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the schedule rows open that group');
  return id;
};

// Synthetic ids in a range no seed owns.
const STAGED_GAME = { id: '89641000-0000-4000-8000-000000000010', name: 'Twilight Imperium: Fourth Edition', image_url: null, min_players: 3, max_players: 6 };
const STAGED_MEMBERS = [
  { id: '89641000-0000-4000-8000-000000000021', user_id: 'auth0|e2e-89-6-41-ana', username: 'E2E Ana' },
  { id: '89641000-0000-4000-8000-000000000022', user_id: 'auth0|e2e-89-6-41-ben', username: 'E2E Ben' },
];
const SCHEDULE_A = {
  id: '89641000-0000-4000-8000-000000000001',
  template_name: 'Thursday Strategy Night',
  schedule_day_of_week: 3,
  schedule_time: '19:00',
  schedule_timezone: 'America/Los_Angeles',
  game_id: STAGED_GAME.id,
  default_deadline_hours: 72,
  default_token_expiry_hours: 168,
  min_participants: 3,
  selected_member_ids: STAGED_MEMBERS.map((member) => member.id),
  is_active: true,
};
const SCHEDULE_B = {
  ...SCHEDULE_A,
  id: '89641000-0000-4000-8000-000000000002',
  template_name: 'Saturday Afternoon Campaign Session',
  schedule_day_of_week: 6,
  schedule_time: '14:00',
  game_id: null,
  is_active: false,
};
// Passes src/lib/schemas/prompts.ts ("export const promptSettingsSchema = z"), so nothing soft-fails to empty.
const SETTINGS_WITH_SCHEDULES = { id: '89641000-0000-4000-8000-000000000000', schedules: [SCHEDULE_A, SCHEDULE_B], games: [STAGED_GAME], members: STAGED_MEMBERS };
// The empty body, the shape of e2e/recurring-checkins-phone.spec.ts ("const EMPTY_SETTINGS_BODY = { id: null, schedules: [], games: [], members: [] };").
export const SETTINGS_EMPTY = { id: null, schedules: [], games: [], members: [] };

/** Answer the group's prompt-settings read (a GET that writes) with `body`, in the browser. */
export const answerSettings =
  (body: unknown): NonNullable<SurfaceRow['answers']> =>
  (url) =>
    /\/groups\/[^/]+\/prompt-settings$/.test(url.pathname) ? body : undefined;

const planningStaged = new WeakSet<Page>();
const recurringHeading = (page: Page): Locator => page.getByRole('heading', { level: 3, name: 'Recurring Check-ins', exact: true });

/**
 * Open the planning page at 375 x 667 with no poll staged and wait for the inline Recurring
 * Check-ins card. STOPS when the card is absent (the CI login is no longer an owner or admin), when
 * the poll-error banner shows (the staging is wrong: the row would read a page production never
 * shows, review M082) or when the text is not normal (the sweep's cell order changed).
 */
export async function reachRecurring(page: Page): Promise<void> {
  if (!planningStaged.has(page)) {
    planningStaged.add(page);
    await routeGroupRead(page, scheduleGroupId(), (group) => ({ ...group, name: TWO_WORD_NAME }));
    await routePlanningPolls(page, { groupId: scheduleGroupId(), polls: [], activeId: null, respondents: [] });
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`/groupPlanning?group_id=${scheduleGroupId()}`);
  try {
    await recurringHeading(page).waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    throw new Error('89.6-41: STOP, the Recurring Check-ins card did not show on the planning page: the CI login is no longer an owner or admin of the E2E group');
  }
  const banner = await page.getByText("Couldn't load the poll responses").count();
  if (banner > 0) throw new Error('89.6-41: STOP, the poll-error banner shows on the planning page: the poll staging is wrong');
  await expectNormalText(page, '89.6-41 reachRecurring');
}

interface ActionPair {
  dialog: { left: number; right: number; width: number };
  stacked: boolean;
  rootPx: number;
  buttons: Array<{ label: string; left: number; right: number; top: number; bottom: number; width: number; height: number }>;
  row: { right: number };
}

/**
 * Scroll each of the dialog's two action buttons into view and measure it, with the dialog box,
 * the action row's right edge and whether the dialog is narrower than its 12rem container step.
 */
async function readActionPair(dialog: Locator, submit: string): Promise<ActionPair> {
  const labels = ['Cancel', submit];
  const buttons: ActionPair['buttons'] = [];
  for (const label of labels) {
    const button = dialog.getByRole('button', { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    buttons.push({ label, ...(await button.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; })) });
  }
  const frame = await dialog.evaluate((el) => {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const box = el.getBoundingClientRect();
    return { dialog: { left: box.left, right: box.right, width: box.width }, stacked: el.clientWidth < 12 * rootPx, rootPx };
  });
  const row = await dialog.getByRole('button', { name: submit, exact: true }).evaluate((el) => ({ right: (el.parentElement as HTMLElement).getBoundingClientRect().right }));
  return { ...frame, buttons, row };
}

const r1 = (value: number): string => value.toFixed(1);

/** Print one short line for the CI log (a passing test keeps nothing else) and attach the whole read. */
export async function recordInputFit(dialog: Locator, rowId: string, cell: SweepCell): Promise<void> {
  const inputs = await dialog.locator('input').evaluateAll((nodes) =>
    nodes.map((node) => {
      const input = node as HTMLInputElement;
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent?.trim() : undefined;
      return {
        name: input.getAttribute('aria-label') ?? label ?? input.placeholder ?? input.name ?? '',
        type: input.type,
        placeholder: input.placeholder,
        scrollWidth: input.scrollWidth,
        clientWidth: input.clientWidth,
      };
    }),
  );
  await test.info().attach(`input-fit-${cell.id}.json`, { body: JSON.stringify(inputs, null, 2), contentType: 'application/json' });
  const text = inputs.filter((input) => input.type !== 'checkbox' && input.type !== 'radio' && input.type !== 'hidden');
  process.stdout.write(`ZZ41 input-fit ${rowId} ${cell.id}: ${text.map((input) => `${input.name.slice(0, 24)}=${input.scrollWidth}/${input.clientWidth}`).join(' | ')}\n`);
}

/**
 * The schedule dialogs' extras, every cell: (a) the two action buttons, each scrolled into view,
 * lie inside the dialog box horizontally and are at least 44px tall; below the 12rem dialog
 * container they are equal width with Cancel above, elsewhere they share a top; (b) the title, with
 * the dialog scrolled to its top, holds the cell's checks; (c) the input fit is recorded, never
 * asserted (text cut inside an input box goes to plan 89.6-34's list). One joined line is thrown.
 */
const scheduleDialogExtras =
  (rowId: string, title: string, submit: string): NonNullable<SurfaceRow['extras']> =>
  async (page: Page, cell: SweepCell) => {
    const tag = `${rowId} ${cell.id}`;
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const problems: string[] = [];
    const pair = await readActionPair(dialog, submit);
    for (const button of pair.buttons) {
      if (button.left < pair.dialog.left - 0.5 || button.right > pair.dialog.right + 0.5) problems.push(`${tag}: "${button.label}", scrolled into view, runs out of the dialog box sideways (${r1(button.left)} to ${r1(button.right)}; dialog ${r1(pair.dialog.left)} to ${r1(pair.dialog.right)})`);
      if (button.height < 43.5) problems.push(`${tag}: "${button.label}" is ${r1(button.height)}px tall, under 44`);
    }
    const [cancel, action] = pair.buttons;
    if (pair.stacked) {
      if (Math.abs(cancel.width - action.width) > 0.5) problems.push(`${tag}: below the 12rem dialog the two buttons are not equal width (Cancel ${r1(cancel.width)}, ${submit} ${r1(action.width)})`);
      if (cancel.bottom > action.top + 0.5) problems.push(`${tag}: below the 12rem dialog Cancel is not above ${submit} (Cancel bottom ${r1(cancel.bottom)}, ${submit} top ${r1(action.top)})`);
    } else if (Math.abs(cancel.top - action.top) > 0.5) {
      problems.push(`${tag}: at 12rem and over Cancel and ${submit} do not share a top (${r1(cancel.top)} and ${r1(action.top)})`);
    }
    process.stdout.write(`ZZ41 actions ${tag}: stacked=${pair.stacked} dialog=${r1(pair.dialog.width)} cancel=${r1(cancel.width)}x${r1(cancel.height)}@${r1(cancel.top)} action=${r1(action.width)}x${r1(action.height)}@${r1(action.top)}\n`);
    // Imported when the extras run: dialogs.ts imports this module (its D24 row reaches the same card).
    const { toDialogTop } = await import('./dialogs');
    await toDialogTop(dialog);
    try {
      await expectPart(dialog.getByRole('heading', { name: title, exact: true }), cell, `${tag} title`);
    } catch (error) {
      problems.push(firstLine(error));
    }
    await recordInputFit(dialog, rowId, cell);
    if (problems.length > 0) throw new Error(problems.join(' || '));
  };

/** At normal text, at 375 and at 320: Cancel and the submit share a top and the submit ends the row (today's look held). */
async function expectActionRowAtNormalText(page: Page, dialog: Locator, rowId: string, submit: string): Promise<void> {
  for (const size of [
    { width: 375, height: 667 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    await settleFrames(page);
    await settleAnimations(dialog);
    const pair = await readActionPair(dialog, submit);
    const [cancel, action] = pair.buttons;
    expect(Math.abs(cancel.top - action.top), `${rowId}: at ${size.width} with normal text Cancel and ${submit} do not share a top (${r1(cancel.top)} and ${r1(action.top)})`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(action.right - pair.row.right), `${rowId}: at ${size.width} with normal text ${submit} does not end its row (${r1(action.right)} and ${r1(pair.row.right)})`).toBeLessThanOrEqual(0.5);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await settleFrames(page);
}

// D25: Create Schedule, opened by + New Schedule over two staged schedules.
const reachCreateSchedule: SurfaceRow['reach'] = async (page) => {
  await reachRecurring(page);
  await page.getByRole('button', { name: '+ New Schedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Schedule', exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await expectActionRowAtNormalText(page, dialog, 'D25', 'Create Schedule');
  const { toDialogTop } = await import('./dialogs');
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

/** Open the phone kebab named Schedule actions (the nth, from 0) and return the list its trigger names. */
async function openScheduleActions(page: Page, nth: number): Promise<Locator> {
  const trigger = page.getByRole('button', { name: 'Schedule actions', exact: true }).nth(nth);
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-controls', /.+/);
  return page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
}

// D26: Edit Schedule, opened from the first schedule's phone kebab (Edit), pre-filled with
// SCHEDULE_A: its template name, its game and both members ticked.
const reachEditSchedule: SurfaceRow['reach'] = async (page) => {
  await reachRecurring(page);
  const list = await openScheduleActions(page, 0);
  await list.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Schedule', exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(dialog.getByRole('textbox', { name: 'Template Name', exact: true })).toHaveValue(SCHEDULE_A.template_name);
  await expect(dialog.locator('#schedule-game-name')).toHaveValue(STAGED_GAME.name);
  for (const member of STAGED_MEMBERS) await expect(dialog.locator(`[id="member-select-${member.id}"]`)).toBeChecked();
  await settleAnimations(dialog);
  const { toDialogTop } = await import('./dialogs');
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// R08-noschedules: the inline card with no schedule (the No schedules yet empty state). The root is
// the card: the nearest ancestor of the Recurring Check-ins heading that is a rounded card.
const reachNoSchedules: SurfaceRow['reach'] = async (page) => {
  await reachRecurring(page);
  await page.getByRole('heading', { name: 'No schedules yet', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  const root = recurringHeading(page).locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-card ")][1]');
  await settleAnimations(root);
  return { root };
};

// R08-schedules: the inline card with both staged schedules (one Active, one Paused) and the second
// schedule's inline delete confirm open (its kebab Delete only opens the confirm:
// src/app/components/ScheduleList.js ("const handleDeleteClick = (schedule) => {")). The root is the
// innermost box holding both schedules. Confirm Delete is NEVER pressed.
const SCHEDULE_B_PROMPT = `Delete ${SCHEDULE_B.template_name}? This will stop sending prompts.`;
const scheduleHeading = (page: Page, name: string): Locator => page.getByRole('heading', { level: 3, name, exact: true });
const scheduleListOf = (page: Page): Locator =>
  page.locator('div', { has: scheduleHeading(page, SCHEDULE_A.template_name) }).filter({ has: scheduleHeading(page, SCHEDULE_B.template_name) }).last();
const reachSchedules: SurfaceRow['reach'] = async (page) => {
  await reachRecurring(page);
  await scheduleHeading(page, SCHEDULE_B.template_name).waitFor({ state: 'visible', timeout: 15_000 });
  const list = await openScheduleActions(page, 1);
  await list.getByRole('button', { name: 'Delete', exact: true }).click();
  const prompt = page.getByText(SCHEDULE_B_PROMPT, { exact: true });
  // A Delete that armed first (it is not a two-tap today) is pressed once more: it only opens the confirm.
  if ((await prompt.count()) === 0 && (await list.isVisible())) await list.getByRole('button', { name: /Delete|Tap again/ }).click();
  await prompt.waitFor({ state: 'visible', timeout: 10_000 });
  const root = scheduleListOf(page);
  await settleAnimations(root);
  return { root };
};

/** Elements inside `root` that run past its right edge or scroll inside themselves: layout facts and the first 30 characters of their staged text. */
async function scheduleOffenders(root: Locator): Promise<Array<{ tag: string; classes: string; text: string; right: number; width: number; overflow: number }>> {
  return root.evaluate((el) => {
    const edge = el.getBoundingClientRect().right;
    return Array.from(el.querySelectorAll('*'))
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { node, box, overflow: (node as HTMLElement).scrollWidth - (node as HTMLElement).clientWidth };
      })
      .filter(({ box, overflow }) => box.width > 0 && (box.right > edge + 0.5 || overflow > 1))
      .slice(0, 20)
      .map(({ node, box, overflow }) => ({
        tag: node.tagName.toLowerCase(),
        classes: node.getAttribute('class') ?? '',
        text: (node.textContent ?? '').trim().slice(0, 30),
        right: Math.round(box.right * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        overflow,
      }));
  });
}

// R08-schedules extras, every cell: (a) Confirm Delete and Cancel each lie inside the confirm box
// sideways and are at least 44px tall; (b) the inline card's header row and, when present,
// + New Schedule hold the cell's checks; (c) when the root or a part reads red, the offenders are
// attached and printed (recorded, not asserted). One joined line is thrown.
const schedulesExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `R08-schedules ${cell.id}`;
  const problems: string[] = [];
  const confirm = page.getByRole('button', { name: 'Confirm Delete', exact: true });
  const box = confirm.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " bg-status-error-subtle ")][1]');
  const boxRect = await box.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  for (const label of ['Confirm Delete', 'Cancel']) {
    const at = await box.getByRole('button', { name: label, exact: true }).evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; });
    if (at.left < boxRect.left - 0.5 || at.right > boxRect.right + 0.5) problems.push(`${tag}: "${label}" runs out of the confirm box sideways (${r1(at.left)} to ${r1(at.right)}; box ${r1(boxRect.left)} to ${r1(boxRect.right)})`);
    if (at.height < 43.5) problems.push(`${tag}: "${label}" is ${r1(at.height)}px tall, under 44`);
  }
  let red = false;
  const parts: Array<[Locator, string]> = [[recurringHeading(page).locator('xpath=..'), 'the card header row']];
  const newSchedule = page.getByRole('button', { name: '+ New Schedule', exact: true });
  if ((await newSchedule.count()) > 0) parts.push([newSchedule, '+ New Schedule']);
  for (const [part, name] of parts) {
    try {
      await expectPart(part, cell, `${tag} ${name}`);
    } catch (error) {
      red = true;
      problems.push(firstLine(error));
    }
  }
  if (!red) {
    try {
      await expectPart(scheduleListOf(page), cell, tag);
    } catch {
      red = true;
    }
  }
  if (red) {
    const offenders = await scheduleOffenders(scheduleListOf(page));
    await test.info().attach(`offenders-${cell.id}.json`, { body: JSON.stringify(offenders, null, 2), contentType: 'application/json' });
    offenders.forEach((o, n) => process.stdout.write(`ZZ41 offender ${cell.id} ${n + 1}/${offenders.length}: ${o.tag} right ${o.right} width ${o.width} overflow ${o.overflow} text '${o.text}' class '${o.classes.slice(0, 100)}'\n`));
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'R16-availability', census: 'R16', kind: 'route', owner: '89.6-22', status: 'enforced', reach: reachAvailability, answers: answerPatterns, extras: availabilityExtras },
  { id: 'R16-identity', census: 'R16', kind: 'route', owner: '89.6-22', state: 'identity', status: 'enforced', reach: reachIdentity, answers: answerPatterns, extras: identityExtras },
  { id: 'D25', census: 'D25', kind: 'dialog', owner: '89.6-41', status: 'enforced', reach: reachCreateSchedule, answers: answerSettings(SETTINGS_WITH_SCHEDULES), extras: scheduleDialogExtras('D25', 'Create Schedule', 'Create Schedule') },
  { id: 'D26', census: 'D26', kind: 'dialog', owner: '89.6-41', status: 'enforced', reach: reachEditSchedule, answers: answerSettings(SETTINGS_WITH_SCHEDULES), extras: scheduleDialogExtras('D26', 'Edit Schedule', 'Update Schedule') },
  { id: 'R08-schedules', census: 'R08', kind: 'route', owner: '89.6-41', state: "admin, two schedules (Active and Paused), the second schedule's delete confirm open", status: 'enforced', reach: reachSchedules, answers: answerSettings(SETTINGS_WITH_SCHEDULES), extras: schedulesExtras },
  { id: 'R08-noschedules', census: 'R08', kind: 'route', owner: '89.6-41', state: 'admin, no schedules: the No schedules yet empty state', status: 'enforced', reach: reachNoSchedules, answers: answerSettings(SETTINGS_EMPTY) },
  { id: 'R16-specific', census: 'R16', kind: 'route', owner: '89.6-22', state: 'specific-dates', status: 'enforced', reach: reachSpecific, answers: answerPatterns, extras: specificExtras },
  { id: 'D32', census: 'D32', kind: 'dialog', owner: '89.6-22', status: 'enforced', reach: reachDisconnect, answers: answerConnected },
  { id: 'D33', census: 'D33', kind: 'dialog', owner: '89.6-22', status: 'enforced', reach: reachImport, answers: answerPatterns },
];
