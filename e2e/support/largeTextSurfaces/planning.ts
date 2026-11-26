// Surface rows: the planning page and the heatmap tooltip. Owner: plan 89.6-20.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// THE STAGING. Every planning row answers the page's poll reads through the one shared helper
// (e2e/support/planningPolls.ts ("export async function routePlanningPolls(")) and the group's own
// read through the one group-read answer (e2e/support/groupRead.ts ("export async function routeGroupRead")),
// with the two-word group name, so the breadcrumb and the title carry it whatever the seed holds.
// Both register inside reach, after the sweep's guard, once per page (the sweep runs a reach again
// on the same page for the light cell, and a page's routes outlive its navigations). Nothing on the
// page is pressed except the Check-ins header, which only folds the panel; the guard holds every
// write all the same.
import type { Page } from '@playwright/test';

import { routeGroupRead } from '../groupRead';
import {
  PLANNING_CREATOR_A_ID,
  PLANNING_CREATOR_B_ID,
  PLANNING_POLL_A_ID,
  PLANNING_POLL_B_ID,
  routePlanningPolls,
  syntheticPlanningPoll,
  syntheticRespondent,
  type PlanningPollsOptions,
} from '../planningPolls';
import { THIRTY_LETTER_WORD, TWO_WORD_NAME } from '../wordLines';
import type { SurfaceRow } from './index';
import { rows as linksRows } from './links';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id, as in e2e/support/largeTextSurfaces/members.ts ("No fallback id").
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the planning rows open that group');
  return id;
};

// UI-SPEC E5 overflow, the planning third: a two-word group name, a 30-letter respondent name, two
// open polls. The respondents are answered for every staged poll.
const POLL_A = syntheticPlanningPoll(PLANNING_POLL_A_ID, 'E2E Ana', PLANNING_CREATOR_A_ID);
const POLL_B = syntheticPlanningPoll(PLANNING_POLL_B_ID, 'E2E Ben', PLANNING_CREATOR_B_ID);
const RESPONDENTS = [
  syntheticRespondent('89620000-0000-4000-8000-0000000000c1', TWO_WORD_NAME, 3),
  syntheticRespondent('89620000-0000-4000-8000-0000000000c2', THIRTY_LETTER_WORD, null),
  syntheticRespondent('89620000-0000-4000-8000-0000000000c3', 'E2E Ben', 1),
];
type Staging = Omit<PlanningPollsOptions, 'groupId'>;
const TWO_OPEN_POLLS: Staging = { polls: [POLL_A, POLL_B], activeId: PLANNING_POLL_A_ID, respondents: RESPONDENTS };

const routed = new WeakSet<Page>();

/** Stage the group read and the poll reads once per page, then open the planning page. */
async function openPlanning(page: Page, staging: Staging, query = ''): Promise<void> {
  if (!routed.has(page)) {
    routed.add(page);
    await routeGroupRead(page, groupId(), (group) => ({ ...group, name: TWO_WORD_NAME }));
    await routePlanningPolls(page, { groupId: groupId(), ...staging });
  }
  await page.goto(`/groupPlanning?group_id=${groupId()}${query}`);
}

/** The Check-ins header: a role=button div whose name starts with Check-ins (its badge follows). */
const checkInsHeader = (page: Page) => page.getByRole('button', { name: /^Check-ins/ });

// R08: the planning page with two open polls and the Check-ins panel COLLAPSED. The card list is
// plan 89.6-42's row (R08-expanded below reads the page with it open); folding it keeps this row's
// five checks off the cards. The root is the page's main, as on every other route row: the header
// strip and the footer are rows of their own (the chrome module). CI run 45762484376 read the body
// and flagged the header strip's die logo letter (shrunk: "N", the letter of a 34px icon).
const reachTwoPolls: SurfaceRow['reach'] = async (page) => {
  await openPlanning(page, TWO_OPEN_POLLS);
  await page.getByRole('heading', { level: 3, name: 'Poll Responses' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText(THIRTY_LETTER_WORD, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  const header = checkInsHeader(page);
  await header.waitFor({ state: 'visible' });
  if ((await header.getAttribute('aria-expanded')) === 'true') await header.click();
  await page.locator('[role="button"][aria-expanded="false"]').filter({ hasText: 'Check-ins' }).waitFor({ state: 'visible' });
  return { root: page.locator('main') };
};

// R08-expanded: the same page with the Check-ins panel left EXPANDED (the page default), so the
// check-in cards, the auto-prompt banner and the admin Recurring Check-ins list are on the page.
// The root is the Check-ins header: its five checks read the header row, and the read's
// document-level sideways check covers everything the open panel adds. The five checks INSIDE the
// card list are plan 89.6-42's own row.
const reachExpanded: SurfaceRow['reach'] = async (page) => {
  await openPlanning(page, TWO_OPEN_POLLS);
  await page.getByRole('heading', { level: 3, name: 'Poll Responses' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: /Started by E2E Ben/ }).waitFor({ state: 'visible', timeout: 15_000 });
  const header = checkInsHeader(page);
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await page.locator('[role="button"][aria-expanded="true"]').filter({ hasText: 'Check-ins' }).waitFor({ state: 'visible' });
  return { root: header };
};

// R08-empty: no open poll and no active poll, so the page shows its empty states: the check-ins
// empty line, the auto-prompt banner, the admin Recurring Check-ins list with no schedule, and the
// no-poll line. The schedule list reads GET /groups/<id>/prompt-settings, a GET that WRITES (the
// sweep's guard holds it unanswered, so the list would sit on Loading schedules... for ever): it is
// answered here, in the browser, with the empty body of
// e2e/recurring-checkins-phone.spec.ts ("const EMPTY_SETTINGS_BODY = { id: null, schedules: [], games: [], members: [] };"),
// matched on the path as that spec's SETTINGS_PATH is. The seed's own list is never reached. No
// card renders in this state, so the root is the whole of the page's main.
const NO_POLLS: Staging = { polls: [], activeId: null, respondents: [] };
const EMPTY_SETTINGS_BODY = { id: null, schedules: [], games: [], members: [] };
// Every planning row answers the same read the same way: the admin list mounts inside the Check-ins
// panel whether it is open or folded, so the read is sent on every planning page (CI run
// 45767320517: O06 failed on it, held unanswered).
const emptySettingsAnswers: SurfaceRow['answers'] = (url) => (url.pathname.endsWith(`/groups/${groupId()}/prompt-settings`) ? EMPTY_SETTINGS_BODY : undefined);
const reachEmpty: SurfaceRow['reach'] = async (page) => {
  await openPlanning(page, NO_POLLS);
  await page.getByText('No active availability poll found. Use the schedule manager above to send one.').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('heading', { name: 'No schedules yet' }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: page.locator('main') };
};

// O06: the heatmap tooltip (census O06) on a read cell of the Create Event dialog's visual
// calendar. The email-link route opens the dialog with the poll's own heatmap
// (src/app/groupPlanning/page.js ("hideVisualCalendar={!promptId}")): prompt_id names staged poll A,
// and its heatmap read answers every hour of ten days around the answered week with two free
// members, one of them the 30-letter word, so whichever cell the calendar shows in the viewer's own
// time zone carries the tooltip. Keyboard focus opens it (no tap, no paint): a key press first, so
// the browser treats the focus as keyboard focus, then the first cell with availability is focused.
// The root is the tooltip.
const mondayInTwoWeeks = (): Date => {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) + 14);
  return monday;
};
const isoDay = (date: Date, plusDays: number): string => {
  const day = new Date(date);
  day.setUTCDate(day.getUTCDate() + plusDays);
  return day.toISOString().slice(0, 10);
};
const tooltipHeatmap = (monday: Date): unknown => ({
  weekStart: isoDay(monday, 0),
  totalMembers: 3,
  totalGroupMembers: 3,
  membersWithoutDataCount: 0,
  gcalConflicts: [],
  slots: Array.from({ length: 10 }, (_, day) => isoDay(monday, day - 1)).flatMap((date) =>
    Array.from({ length: 24 }, (_, hour) => ({
      date,
      hour,
      availableCount: 2,
      availableMembers: [
        { user_id: '89620000-0000-4000-8000-0000000000c2', username: THIRTY_LETTER_WORD },
        { user_id: PLANNING_CREATOR_A_ID, username: 'E2E Ana' },
      ],
    })),
  ),
});
const reachTooltip: SurfaceRow['reach'] = async (page) => {
  const monday = mondayInTwoWeeks();
  await openPlanning(page, { ...TWO_OPEN_POLLS, heatmap: tooltipHeatmap(monday) }, `&prompt_id=${PLANNING_POLL_A_ID}&prefillDate=${isoDay(monday, 2)}&prefillTime=19:00`);
  const cell = page.locator('[role="gridcell"][aria-label*=" available"]').first();
  await cell.waitFor({ state: 'attached', timeout: 20_000 });
  await page.keyboard.press('Shift');
  await cell.focus();
  const tooltip = page.getByRole('tooltip');
  await tooltip.waitFor({ state: 'visible', timeout: 10_000 });
  await tooltip.getByText(THIRTY_LETTER_WORD, { exact: false }).waitFor({ state: 'visible' });
  return { root: tooltip };
};
// O06 extras: the tooltip is open in every cell (the sweep reaches once per page, so a viewport
// change that closed it is a STOP, reported, not patched here) and its box lies inside the window.
const tooltipInWindow: SurfaceRow['extras'] = async (page) => {
  const read = await page.evaluate(() => {
    const tip = document.querySelector('[role="tooltip"]');
    if (!tip) return null;
    const box = tip.getBoundingClientRect();
    return { left: box.left, right: box.right, window: document.documentElement.clientWidth };
  });
  if (read === null) throw new Error('O06: no open tooltip in this cell');
  if (read.left < 0 || read.right > read.window + 0.5) throw new Error(`O06: the tooltip runs out of the window (left ${read.left.toFixed(1)}, right ${read.right.toFixed(1)}, window ${read.window})`);
};

// R03-grid (register CI-01, section D, CI-01d): the availability link page's paint grid, its day
// headers measured in every cell. The reach and the answers are links.ts's R03 row's, imported,
// never copied. Each header's text lies inside its own header box, and each word of a header is on
// one line (a header may wrap between its two words; no word breaks).
const availabilityRow = linksRows.find((row) => row.id === 'R03');
if (!availabilityRow?.reach) throw new Error('planning.ts: links.ts has no R03 row with a reach for R03-grid');
const headersWhole: SurfaceRow['extras'] = async (page) => {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const headerRow = document.querySelector('main .min-w-max > div');
    const headers = headerRow ? Array.from(headerRow.children).slice(1) : [];
    if (headers.length === 0) out.push('no day headers found');
    for (const header of headers) {
      const box = header.getBoundingClientRect();
      const text = header.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) {
        out.push(`a header holds no text node: ${header.textContent}`);
        continue;
      }
      const all = document.createRange();
      all.selectNodeContents(header);
      for (const rect of Array.from(all.getClientRects())) {
        if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5) out.push(`"${header.textContent}" runs out of its column (text ${rect.left.toFixed(1)}-${rect.right.toFixed(1)}, column ${box.left.toFixed(1)}-${box.right.toFixed(1)})`);
      }
      const value = text.textContent ?? '';
      for (const match of value.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, match.index ?? 0);
        range.setEnd(text, (match.index ?? 0) + match[0].length);
        const lines = new Set(Array.from(range.getClientRects()).filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
        if (lines !== 1) out.push(`"${match[0]}" in "${value}" is on ${lines} lines`);
      }
    }
    return out;
  });
  if (problems.length > 0) throw new Error(`CI-01d: ${problems.join('; ')}`);
};

// R08 extras (register R6-02): in every cell exactly one Switch poll chip is pressed and it names
// the poll the Showing line names, and every chip box is at least 44 x 44 (within 0.5px). One
// joined line is thrown, so a failure fails the cell.
const chipsHold: SurfaceRow['extras'] = async (page) => {
  const read = await page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="Switch poll"]');
    const chips = group ? Array.from(group.querySelectorAll('button')) : [];
    const showing = Array.from(document.querySelectorAll('p')).find((p) => (p.textContent ?? '').startsWith('Showing '));
    return {
      chips: chips.map((chip) => {
        const box = chip.getBoundingClientRect();
        return { name: (chip.textContent ?? '').trim(), pressed: chip.getAttribute('aria-pressed'), width: box.width, height: box.height };
      }),
      showing: (showing?.textContent ?? '').trim(),
    };
  });
  const problems: string[] = [];
  if (read.chips.length !== 2) problems.push(`${read.chips.length} Switch poll chips, not 2`);
  const pressed = read.chips.filter((chip) => chip.pressed === 'true');
  if (pressed.length !== 1) problems.push(`${pressed.length} chips pressed, not 1`);
  else if (read.showing !== `Showing ${pressed[0].name}`) problems.push(`the pressed chip "${pressed[0].name}" is not the shown poll ("${read.showing}")`);
  for (const chip of read.chips) {
    if (chip.width < 43.5 || chip.height < 43.5) problems.push(`chip "${chip.name}" is ${chip.width.toFixed(1)} x ${chip.height.toFixed(1)}, under 44 x 44`);
  }
  if (problems.length > 0) throw new Error(`R6-02: ${problems.join('; ')}`);
};

export const rows: SurfaceRow[] = [
  { id: 'R08', census: 'R08', kind: 'route', owner: '89.6-20', status: 'enforced', state: 'two open polls, Check-ins collapsed', reach: reachTwoPolls, answers: emptySettingsAnswers, extras: chipsHold },
  // pending until 89.6-42: the read covers the check-in cards (plan 42's S3 fix) and their three-dot trigger (plan 26's KebabMenu), both after this plan.
  { id: 'R08-expanded', census: 'R08', kind: 'route', owner: '89.6-42', status: 'pending', state: 'two open polls, Check-ins expanded: the page holds with the cards present', reach: reachExpanded, answers: emptySettingsAnswers },
  { id: 'R08-empty', census: 'R08', kind: 'route', owner: '89.6-20', status: 'enforced', state: 'no open poll: check-ins empty state, auto-prompt banner, Recurring Check-ins empty list, no active poll', reach: reachEmpty, answers: emptySettingsAnswers },
  { id: 'O06', census: 'O06', kind: 'overlay', owner: '89.6-20', status: 'enforced', state: 'heatmap tooltip naming the 30-letter word, opened by keyboard focus', reach: reachTooltip, answers: emptySettingsAnswers, extras: tooltipInWindow },
  { id: 'R03-grid', census: 'R03', kind: 'route', owner: '89.6-20', status: 'enforced', state: 'availability grid day headers (CI-01d)', reach: availabilityRow.reach, answers: availabilityRow.answers, extras: headersWhole },
];
