// Surface rows: Create Event and Edit Event, and the member picker inside Create Schedule (D25-members). Owner: plan 89.6-24.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// NOTHING HERE WRITES. Every row runs under the sweep's write guard; no row presses Create Event,
// Update Event or any other control that writes. The group's members read is answered with two
// staged members put first (they exist only in the answer the browser gets).
//
// WHAT A ROW PRINTS. CI keeps nothing from a passing browser test, so the row's own reads are
// also printed as one ZZ24 line per read and cell (the test's attachments hold the whole read).
// The phase reads those lines with execute/ci-log.sh in the planning folder.
import type { Locator, Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { routeMemberRoster } from '../memberRoster';
import { readLargeTextCell, setTextMode } from '../wordLines';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';
import { actionPairProblems, answerSettings, reachRecurring, recordInputFit, SETTINGS_EMPTY } from './profileA';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id: a row that opened some other group would read a dialog the fixtures do not own.
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the event dialog rows open that group');
  return id;
};

// Two staged members, first in the roster answer, so the first read-only participant boxes are
// theirs: a short name (the word the 2rem lock reserve broke at 320 / 200%) and a 40-character
// name of ordinary words. Synthetic ids in a range no seed owns. The seeded roster has an Alice of
// its own (flip run 45827953808), so a read of the staged one takes the first match.
const SHORT_MEMBER = 'Alice';
const LONG_MEMBER = 'Christopher Alexander Montgomery Whitley';
const STAGED_ROSTER = [
  { id: '89624000-0000-4000-8000-000000000001', user_id: 'auth0|e2e-89-6-24-alice', username: SHORT_MEMBER, email: null, UserGroup: { role: 'member' } },
  { id: '89624000-0000-4000-8000-000000000002', user_id: 'auth0|e2e-89-6-24-long', username: LONG_MEMBER, email: null, UserGroup: { role: 'member' } },
];
// One roster route per page: the sweep runs a reach again on the same page for the light cell, and a page's routes outlive its navigations.
const rostered = new WeakSet<Page>();

const createEventDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Create Event', exact: true });
const participantsOf = (dialog: Locator): Locator => dialog.getByRole('group', { name: 'Participants (required)', exact: true });

const say = (line: string): void => {
  process.stdout.write(`ZZ24 ${line}\n`);
};
const r1 = (value: number): string => value.toFixed(1);

/**
 * Print what a cell's own read found, one ZZ24 line per entry (CI keeps nothing else from a test,
 * and the ci-log reader cuts a line at 400 characters), and the leaf-most boxes that run past the
 * dialog box sideways. Diagnosis only: it asserts nothing (the sweep's own read fails the cell).
 */
async function printDiagnosis(tag: string, root: Locator, dialog: Locator, cell: SweepCell): Promise<void> {
  if (cell.zoom) return;
  const read = await readLargeTextCell(root, { dialog });
  for (const kind of ['cut', 'split', 'held', 'spill', 'selectCut'] as const) {
    for (const entry of read[kind]) say(`diag ${tag} ${kind}: ${entry.slice(0, 300)}`);
  }
  if ((read.dialogSideways ?? 0) > 0 || read.pageSideways > 0) {
    const out = await dialog.evaluate((box) => {
      const frame = box.getBoundingClientRect();
      const past = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > frame.right + 0.5 || r.left < frame.left - 0.5);
      };
      return Array.from(box.querySelectorAll('*'))
        .filter((el) => past(el) && !Array.from(el.children).some(past))
        .slice(0, 8)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').slice(0, 90)} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.left)}-${Math.round(r.right)} (box ${Math.round(frame.left)}-${Math.round(frame.right)})`;
        });
    });
    say(`diag ${tag} sideways page=${read.pageSideways} dialog=${read.dialogSideways}`);
    for (const line of out) say(`diag ${tag} past: ${line}`);
  }
}

/** Wait until the dialog box and the page stop moving after a viewport or text-size change. */
async function settle(page: Page, dialog: Locator): Promise<void> {
  await settleAnimations(dialog);
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
  });
}

/**
 * Open Create Event on the group page the way e2e/create-event.spec.ts opens it (the group page's
 * Create Event button), with the staged members first, and wait for the participant list. The
 * dialog is read from its top. Nothing is submitted.
 */
async function openCreateEvent(page: Page): Promise<Locator> {
  if (!rostered.has(page)) {
    await routeMemberRoster(page, groupId(), (rows) => [...STAGED_ROSTER, ...rows]);
    rostered.add(page);
  }
  await page.goto(`/groupHomePage?id=${groupId()}`);
  const open = page.getByRole('button', { name: 'Create Event', exact: true });
  await open.waitFor({ state: 'visible', timeout: 15_000 });
  await open.click();
  const dialog = createEventDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await participantsOf(dialog).getByText(SHORT_MEMBER, { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return dialog;
}

interface Box {
  top: number;
  bottom: number;
  height: number;
}

interface MemberRowRead {
  name: Box;
  score: Box | null;
  faction: Box | null;
}

/** The first staged member's read-only name box and the Score and Faction boxes of its row. */
async function readMemberRow(dialog: Locator): Promise<MemberRowRead> {
  return participantsOf(dialog)
    .getByText(SHORT_MEMBER, { exact: true })
    .first()
    .evaluate((el) => {
      const box = (node: Element | null) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      const row = el.closest('div.border-b');
      return {
        name: box(el) as { top: number; bottom: number; height: number },
        score: box(row?.querySelector('input[type="number"]') ?? null),
        faction: box(row?.querySelector('input[placeholder="Optional"]') ?? null),
      };
    });
}

// D21-readonly extras, every cell: the input fit is recorded, never asserted (text cut inside an
// input box goes to plan 89.6-34's list). In cell 320x568-dark-200 only, the row is then read at
// normal text at 375 and at 1280: the read-only name box is 42px tall (within 0.5px), and at 1280,
// where the row is one line, its bottom is level with Score's and Faction's (within 0.5px); the
// cell's size and text are put back after. Whether Alice is whole is the cell's own split read.
// Every problem is thrown as ONE line: the sweep fails a cell only on a throw.
const readonlyExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `D21-readonly ${cell.id}`;
  const dialog = createEventDialog(page);
  const problems: string[] = [];
  await recordInputFit(dialog, 'D21-readonly', cell);
  await printDiagnosis(tag, participantsOf(dialog), dialog, cell);
  if (cell.id === '320x568-dark-200') {
    await setTextMode(page, '100', `${tag} normal-text pass`);
    for (const size of [
      { width: 375, height: 667 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await settle(page, dialog);
      await participantsOf(dialog).getByText(SHORT_MEMBER, { exact: true }).first().scrollIntoViewIfNeeded();
      const read = await readMemberRow(dialog);
      say(`D21-readonly normal-${size.width} name=${r1(read.name.height)}@${r1(read.name.bottom)} score=${read.score ? `${r1(read.score.height)}@${r1(read.score.bottom)}` : 'none'} faction=${read.faction ? `${r1(read.faction.height)}@${r1(read.faction.bottom)}` : 'none'}`);
      if (Math.abs(read.name.height - 42) > 0.5) problems.push(`${tag}: at ${size.width} with normal text the read-only name box is ${r1(read.name.height)}px tall, expected 42`);
      if (size.width === 1280) {
        for (const [label, other] of [
          ['Score', read.score],
          ['Faction', read.faction],
        ] as const) {
          if (!other) problems.push(`${tag}: at 1280 the ${label} box of the first member row was not found`);
          else if (Math.abs(other.bottom - read.name.bottom) > 0.5) problems.push(`${tag}: at 1280 with normal text the ${label} box's bottom (${r1(other.bottom)}) is not level with the read-only name box's (${r1(read.name.bottom)})`);
        }
      }
    }
    await page.setViewportSize({ width: cell.width, height: cell.height });
    await setTextMode(page, '200', `${tag} back to 200%`);
    await settle(page, dialog);
    await toDialogTop(dialog);
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D21-readonly: the participant list of Create Event, its first two rows the staged members.
const reachReadonly: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCreateEvent(page);
  return { root: participantsOf(dialog), dialog };
};

// The custom row's name box (the typed twin of the read-only name), found by its placeholder.
const CUSTOM_NAME = 'Type name (group member or custom)';

/** The S5 band's four boxes: the custom row's name, Score and Faction, and the first member's read-only name with its row's Score and Faction. */
async function readS5(dialog: Locator): Promise<{ custom: Array<{ label: string; height: number; bottom: number }>; member: Array<{ label: string; height: number; bottom: number }> }> {
  return participantsOf(dialog).evaluate((group, short) => {
    const box = (label: string, node: Element | null) => {
      const r = node?.getBoundingClientRect();
      return { label, height: r ? r.height : -1, bottom: r ? r.bottom : -1 };
    };
    const typed = group.querySelector('input[placeholder="Type name (group member or custom)"]');
    const customRow = typed?.closest('div.border-b') ?? null;
    const named = Array.from(group.querySelectorAll('div')).find((node) => node.childNodes.length > 0 && Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === short));
    const memberRow = named?.closest('div.border-b') ?? null;
    return {
      custom: [box('typed name', typed ?? null), box('typed Score', customRow?.querySelector('input[type="number"]') ?? null), box('typed Faction', customRow?.querySelector('input[placeholder="Optional"]') ?? null)],
      member: [box('read-only name', named ?? null), box('member Score', memberRow?.querySelector('input[type="number"]') ?? null), box('member Faction', memberRow?.querySelector('input[placeholder="Optional"]') ?? null)],
    };
  }, SHORT_MEMBER);
}

// D21 extras, every cell: plan 89.6-41's tall-dialog reads of Cancel and Create Event (each, scrolled
// into view, inside the dialog box sideways and at least 44px tall; below the 12rem dialog container
// equal width with Cancel above, elsewhere a shared top), and the input fit recorded. In cell
// 320x568-dark-200 only, the S5 band is then read at normal text at 700 x 900: the three typed boxes
// of the custom row and the read-only name box are each 44px (within 0.5px), and each row's boxes
// share a bottom (within 0.5px); the cell's size and text are put back after. One joined line is thrown.
const createEventExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `D21 ${cell.id}`;
  const dialog = createEventDialog(page);
  const problems = await actionPairProblems(dialog, tag, 'Create Event');
  await recordInputFit(dialog, 'D21', cell);
  await printDiagnosis(tag, dialog, dialog, cell);
  if (cell.id === '320x568-dark-200') {
    await setTextMode(page, '100', `${tag} S5 normal-text pass`);
    await page.setViewportSize({ width: 700, height: 900 });
    await settle(page, dialog);
    await participantsOf(dialog).getByPlaceholder(CUSTOM_NAME).scrollIntoViewIfNeeded();
    const read = await readS5(dialog);
    say(`D21 normal-700 ${[...read.custom, ...read.member].map((b) => `${b.label}=${r1(b.height)}@${r1(b.bottom)}`).join(' ')}`);
    for (const b of [...read.custom, read.member[0]]) {
      if (Math.abs(b.height - 44) > 0.5) problems.push(`${tag}: at 700 with normal text the ${b.label} box is ${r1(b.height)}px tall, expected 44 (S5)`);
    }
    for (const set of [read.custom, read.member]) {
      for (const b of set.slice(1)) {
        if (Math.abs(b.bottom - set[0].bottom) > 0.5) problems.push(`${tag}: at 700 with normal text the ${b.label} box's bottom (${r1(b.bottom)}) is not level with the ${set[0].label} box's (${r1(set[0].bottom)})`);
      }
    }
    await page.setViewportSize({ width: cell.width, height: cell.height });
    await setTextMode(page, '200', `${tag} back to 200%`);
    await settle(page, dialog);
  }
  await toDialogTop(dialog);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D21: Create Event read whole, with one custom row added (+ Add Participant changes only the
// form's own state; nothing is sent), so a typed name box is in the dialog beside the read-only ones.
const reachCreateEvent: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCreateEvent(page);
  await dialog.getByRole('button', { name: '+ Add Participant', exact: true }).click();
  await participantsOf(dialog).getByPlaceholder(CUSTOM_NAME).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D22: Edit Event, opened from the night page the way e2e/event-dialog-reopen.spec.ts opens it
// ("reopening while an update is saving (88.6.1-68)"): the fixture night, its Edit Event button,
// then the form loaded once its submit reads Update Event. The fixture night is derived as
// e2e/support/largeTextSurfaces/night.ts derives it ("const eventPath = (): string =>").
// Update Event is NEVER pressed.
const eventPath = (): string => process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${groupId()}`;
const editEventDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Edit Event', exact: true });
const reachEditEvent: SurfaceRow['reach'] = async (page) => {
  await page.goto(eventPath());
  const open = page.getByRole('button', { name: 'Edit Event', exact: true });
  await open.waitFor({ state: 'visible', timeout: 15_000 });
  await open.click();
  const dialog = editEventDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByTestId('create-event-submit').filter({ hasText: 'Update Event' }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D22 extras, every cell: the same tall-dialog reads of Cancel and Update Event, and the input fit recorded.
const editEventExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const dialog = editEventDialog(page);
  const problems = await actionPairProblems(dialog, `D22 ${cell.id}`, 'Update Event');
  await recordInputFit(dialog, 'D22', cell);
  await printDiagnosis(`D22 ${cell.id}`, dialog, dialog, cell);
  await toDialogTop(dialog);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D21-scheduler: the visual calendar inside Create Event (the dialog opens in it), on the week that
// holds today. At a phone width it is the week strip over one day column; from 768 the desktop week
// grid with its day headers. The root is the scheduler: the nearest ancestor of its availability grid
// that is the component's own space-y-4 root. Read from the dialog's top, as every dialog row is.
const schedulerGrid = (dialog: Locator): Locator => dialog.getByRole('grid', { name: 'Group availability by day and time', exact: true });
const reachScheduler: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCreateEvent(page);
  const grid = schedulerGrid(dialog);
  await grid.waitFor({ state: 'visible', timeout: 15_000 });
  const root = grid.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " space-y-4 ")][1]');
  await settleAnimations(dialog);
  return { root, dialog };
};

interface SchedulerRead {
  phone: boolean;
  /** Each strip tab whose text runs past its box: the tab's label and the overrun. */
  spills: string[];
  /** Today's cue: the element that carries it, whether it is underlined, and its box. */
  today: { found: boolean; underline: boolean; width: number; height: number };
  /** The day column's window and its first slot row. */
  window: { height: number; header: number; row: number } | null;
}

/** Read the scheduler in the dialog: strip spill, today's shape cue, the day column's window. */
async function readScheduler(dialog: Locator): Promise<SchedulerRead> {
  return schedulerGrid(dialog).evaluate((grid) => {
    const dialogEl = grid.closest('[role="dialog"]') ?? document.body;
    const strip = dialogEl.querySelector('[role="tablist"][aria-label="Choose a day"]');
    const spills: string[] = [];
    if (strip) {
      for (const tab of Array.from(strip.querySelectorAll('[role="tab"]'))) {
        const box = tab.getBoundingClientRect();
        for (const span of Array.from(tab.querySelectorAll('span'))) {
          const r = span.getBoundingClientRect();
          if (r.height === 0) continue;
          const over = Math.max(r.bottom - box.bottom, box.top - r.top, r.right - box.right, box.left - r.left);
          if (over > 0.5) spills.push(`${tab.getAttribute('aria-label') ?? tab.textContent ?? ''} "${(span.textContent ?? '').trim()}" by ${over.toFixed(1)}px`);
        }
      }
    }
    const cue = strip
      ? strip.querySelector('[role="tab"][aria-current="date"] [data-testid="strip-day-number"]')
      : grid.querySelector('[role="columnheader"] .text-content-accent');
    const cueBox = cue?.getBoundingClientRect();
    const scroller = grid.parentElement as HTMLElement | null;
    const header = grid.querySelector('[role="columnheader"]');
    const cell = grid.querySelector('[role="gridcell"]');
    return {
      phone: strip !== null,
      spills,
      today: {
        found: cue !== null,
        underline: cue ? getComputedStyle(cue).textDecorationLine.includes('underline') : false,
        width: cueBox ? cueBox.width : 0,
        height: cueBox ? cueBox.height : 0,
      },
      window: scroller && header && cell ? { height: scroller.clientHeight, header: header.getBoundingClientRect().height, row: cell.getBoundingClientRect().height } : null,
    };
  });
}

// D21-scheduler extras, every cell: no strip tab's text runs past its box (spill, CI-01e); today is
// told by a shape as well as colour (an underline on today's strip number or desktop day label,
// with a non-empty box, CI-01b); and at the page-zoom and 200% cells the day column's window shows
// its header and at least one whole slot row (CI-01f). One joined line is thrown.
const schedulerExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `D21-scheduler ${cell.id}`;
  const dialog = createEventDialog(page);
  const read = await readScheduler(dialog);
  await printDiagnosis(tag, schedulerGrid(dialog).locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " space-y-4 ")][1]'), dialog, cell);
  const problems: string[] = [];
  say(`D21-scheduler ${cell.id} phone=${read.phone} spills=${read.spills.length} today=${read.today.found ? `${read.today.underline ? 'underlined' : 'plain'} ${r1(read.today.width)}x${r1(read.today.height)}` : 'none'} window=${read.window ? `${read.window.height}/${r1(read.window.header)}+${r1(read.window.row)}` : 'none'}`);
  if (read.spills.length > 0) problems.push(`${tag}: strip text runs past its cell: ${read.spills.join('; ')}`);
  if (!read.today.found) problems.push(`${tag}: today's ${read.phone ? 'strip number' : 'day label'} was not found`);
  else if (!read.today.underline || read.today.width < 0.5 || read.today.height < 0.5) problems.push(`${tag}: today's ${read.phone ? 'strip number' : 'day label'} carries no underline (${r1(read.today.width)} x ${r1(read.today.height)}): today is told by colour alone (WCAG 1.4.1)`);
  if (cell.mode !== 'font32') {
    if (!read.window) problems.push(`${tag}: the day column's window, header or first slot row was not found`);
    else if (read.window.height < read.window.header + read.window.row - 0.5) problems.push(`${tag}: the day column's window (${read.window.height}px) does not show its header (${r1(read.window.header)}) and one whole slot row (${r1(read.window.row)})`);
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D25-members: the member picker of Create Schedule (census D25; MemberSelector renders only inside
// ScheduleForm), with three staged members: a 40-character name with spaces, a 50-character name
// with no break, and E2E Ana. The planning page is reached by plan 89.6-41's one helper, its
// prompt-settings read (a GET that writes) answered with the empty body plus the three members; with
// no schedule the card's empty state offers Create a schedule, the same action as + New Schedule
// (src/app/components/ScheduleList.js ("same action, so the same touch target")). The root is the
// group named Send to Members. Create Schedule is NEVER pressed.
const UNBROKEN_MEMBER = 'Grandmasterboardgamecollectiveofthenorthernvalleys';
const PICKER_MEMBERS = [
  { id: '89624000-0000-4000-8000-000000000011', user_id: 'auth0|e2e-89-6-24-long', username: LONG_MEMBER },
  { id: '89624000-0000-4000-8000-000000000012', user_id: 'auth0|e2e-89-6-24-unbroken', username: UNBROKEN_MEMBER },
  { id: '89624000-0000-4000-8000-000000000013', user_id: 'auth0|e2e-89-6-24-ana', username: 'E2E Ana' },
];
const createScheduleDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Create Schedule', exact: true });
const memberPicker = (dialog: Locator): Locator => dialog.getByRole('group', { name: 'Send to Members', exact: true });
const reachMemberPicker: SurfaceRow['reach'] = async (page) => {
  await reachRecurring(page);
  await page.getByRole('button', { name: 'Create a schedule', exact: true }).click();
  const dialog = createScheduleDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await memberPicker(dialog).getByText(UNBROKEN_MEMBER, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: memberPicker(dialog), dialog };
};

// D25-members extras, in cell 320x568-dark-200 only (the PR lane has no normal-text cell): after the
// cell's own reads, the picker is read at normal text at 375 x 667: the first member's name starts
// 8px (within 0.5px) after its checkbox ends, and level (within 0.5px) with the Select All text;
// the cell's size and text are put back after. One joined line is thrown. On the tree before the
// fix the long name squeezed its checkbox (a plain flex row shrinks every item): the name started
// at 59.69 against Select All's 62 (flip run 45827953808), so this read is red there too.
const memberPickerExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  if (cell.id !== '320x568-dark-200') return;
  const tag = `D25-members ${cell.id}`;
  const dialog = createScheduleDialog(page);
  await setTextMode(page, '100', `${tag} normal-text pass`);
  await page.setViewportSize({ width: 375, height: 667 });
  await settle(page, dialog);
  const read = await memberPicker(dialog).evaluate((group, first) => {
    const named = Array.from(group.querySelectorAll('label span')).find((span) => span.textContent?.trim() === first);
    const box = named?.closest('label')?.querySelector('input[type="checkbox"]');
    const all = Array.from(group.querySelectorAll('label span')).find((span) => span.textContent?.trim() === 'Select All');
    return {
      name: named ? named.getBoundingClientRect().left : null,
      checkbox: box ? box.getBoundingClientRect().right : null,
      selectAll: all ? all.getBoundingClientRect().left : null,
    };
  }, LONG_MEMBER);
  const problems: string[] = [];
  say(`D25-members normal-375 name-left=${read.name ?? 'none'} checkbox-right=${read.checkbox ?? 'none'} select-all-left=${read.selectAll ?? 'none'}`);
  if (read.name === null || read.checkbox === null || read.selectAll === null) problems.push(`${tag}: the first member's name, its checkbox or the Select All text was not found`);
  else {
    if (Math.abs(read.name - read.checkbox - 8) > 0.5) problems.push(`${tag}: at 375 with normal text the first member's name starts ${r1(read.name - read.checkbox)}px after its checkbox, expected 8`);
    if (Math.abs(read.name - read.selectAll) > 0.5) problems.push(`${tag}: at 375 with normal text the first member's name (${r1(read.name)}) is not level with the Select All text (${r1(read.selectAll)})`);
  }
  await page.setViewportSize({ width: cell.width, height: cell.height });
  await setTextMode(page, '200', `${tag} back to 200%`);
  await settle(page, dialog);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'D21', census: 'D21', kind: 'dialog', owner: '89.6-24', status: 'enforced', state: 'one custom row added', reach: reachCreateEvent, extras: createEventExtras },
  { id: 'D21-readonly', census: 'D21', kind: 'dialog', owner: '89.6-24', status: 'enforced', state: 'a group member row with the name Alice and a member with a 40-letter name', reach: reachReadonly, extras: readonlyExtras },
  { id: 'D21-scheduler', census: 'D21', kind: 'dialog', owner: '89.6-24', status: 'enforced', state: 'visual calendar, the week holding today, phone strip and day column', reach: reachScheduler, extras: schedulerExtras },
  { id: 'D25-members', census: 'D25', kind: 'dialog', owner: '89.6-24', status: 'enforced', state: 'three members: a 40-character name with spaces, a 50-character unbroken name, E2E Ana', reach: reachMemberPicker, answers: answerSettings({ ...SETTINGS_EMPTY, members: PICKER_MEMBERS }), extras: memberPickerExtras },
  { id: 'D22', census: 'D22', kind: 'dialog', owner: '89.6-24', status: 'enforced', reach: reachEditEvent, extras: editEventExtras },
];
