// Surface rows: Create Event and Edit Event. Owner: plan 89.6-24.
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
import { setTextMode } from '../wordLines';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';
import { actionPairProblems, recordInputFit } from './profileA';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id: a row that opened some other group would read a dialog the fixtures do not own.
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the event dialog rows open that group');
  return id;
};

// Two staged members, first in the roster answer, so the first read-only participant boxes are
// theirs: a short name (the word the 2rem lock reserve broke at 320 / 200%) and a 40-character
// name of ordinary words. Synthetic ids in a range no seed owns.
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
  await participantsOf(dialog).getByText(SHORT_MEMBER, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
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
  if (cell.id === '320x568-dark-200') {
    await setTextMode(page, '100', `${tag} normal-text pass`);
    for (const size of [
      { width: 375, height: 667 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await settle(page, dialog);
      await participantsOf(dialog).getByText(SHORT_MEMBER, { exact: true }).scrollIntoViewIfNeeded();
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
  await toDialogTop(dialog);
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'D21', census: 'D21', kind: 'dialog', owner: '89.6-24', status: 'enforced', state: 'one custom row added', reach: reachCreateEvent, extras: createEventExtras },
  { id: 'D21-readonly', census: 'D21', kind: 'dialog', owner: '89.6-24', status: 'enforced', state: 'a group member row with the name Alice and a member with a 40-letter name', reach: reachReadonly, extras: readonlyExtras },
  { id: 'D22', census: 'D22', kind: 'dialog', owner: '89.6-24', status: 'enforced', reach: reachEditEvent, extras: editEventExtras },
];
