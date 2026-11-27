// Surface rows: Manage Group Members, Members and the dialogs they open. Owner: plan 89.6-11.
// One row per line, each with its census id. All seven are enforced (Phase 89.6-11).
// D12 and D13 also read their tags (plan 89.6-44, owner pick N04 = B): readRoleTags below and the
// night module's readTagLines (one helper, never a copy).
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
// D18 (Remove member) opens only from md up, so it is reached at 768 and then read through the cells (FL-17c).
//
// THE ROSTER. Every row answers the group's members read through the one roster answer
// (e2e/support/memberRoster.ts ("export async function routeMemberRoster")): the real roster plus
// ONE synthetic member with a long, hyphenated name (lane D's long-name case, UI-SPEC E1), who
// exists only in the answer sent to the browser. D13 and D17 are the dialog a member who is not
// owner or admin sees; the CI login OWNS the seeded group, so their answer also turns the owner's
// row into a member's. The group page reads the same path, so it sees the same roster.
//
// THE ROOT is the whole dialog: its header, notice, body and footer are one surface here (the
// shell alone is read by dialogShell.ts).
//
// WHICH CONTROL OPENS A CONFIRM. A member row shows a three-dot menu below md and a role select,
// a Remove button and a More actions menu from md up. A reach uses whichever is on screen at the
// width it runs at, and the opened dialog's EXACT name (it holds the long member's name) proves
// the right row was pressed.
//
// NOTHING HERE WRITES. Transfer ownership, Confirm Leave, Remove, Reset link and Make admin are
// NEVER pressed: each reach stops at the open confirm. The sweep's guard holds every write all the same.
import type { Locator, Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { routeMemberRoster } from '../memberRoster';
import { setTextMode } from '../wordLines';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';
import { readTagLines, tagSummary } from './night';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id, as in e2e/manage-members-refresh.spec.ts ("No '1' fallback").
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the members rows open that group');
  return id;
};

const LONG_NAME = 'Bartholomew Featherstonehaugh-Cholmondeley';
const LONG_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000d3',
  user_id: 'auth0|e2e-synthetic-long',
  username: LONG_NAME,
  email: null,
  UserGroup: { role: 'member' },
};

type RosterRow = { UserGroup?: { role?: string } };
type Transform = (rows: unknown[]) => unknown[];

// D12 and the confirms opened from it: the roster as the owner sees it, plus the long member.
const withLongMember: Transform = (rows) => [...rows, LONG_MEMBER];
// D13 and D17: the same, with the owner's row turned into a member's, so the viewer manages nothing.
const asPlainMember: Transform = (rows) => [
  ...rows.map((row) => {
    const member = row as RosterRow;
    return member.UserGroup?.role === 'owner' ? { ...member, UserGroup: { ...member.UserGroup, role: 'member' } } : row;
  }),
  LONG_MEMBER,
];

// One roster route per page: the sweep runs a reach again on the same page for the light cell, and
// a page's routes outlive its navigations.
const routed = new WeakSet<Page>();

/** Open the members dialog on the group page, with the roster answered, and wait for the long member's row. */
async function openMembers(page: Page, transform: Transform, title: 'Manage Group Members' | 'Members'): Promise<Locator> {
  if (!routed.has(page)) {
    await routeMemberRoster(page, groupId(), transform);
    routed.add(page);
  }
  await page.goto(`/groupHomePage?id=${groupId()}`);
  const manage = page.getByRole('button', { name: 'Manage Members' });
  await manage.waitFor({ state: 'visible', timeout: 15_000 });
  await manage.click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByText(LONG_NAME, { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return dialog;
}

/** Wait for a confirm dialog by its exact name, settle it, and hand it back as the row's root. */
async function opened(page: Page, name: string): Promise<{ root: Locator; dialog: Locator }> {
  const dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return { root: dialog, dialog };
}

/** Press one item of the long member's menu: the three-dot menu below md, the More actions menu from md up. */
async function pressMenuItem(members: Locator, item: string): Promise<void> {
  const phone = members.getByRole('button', { name: `Member actions for ${LONG_NAME}`, exact: true });
  const desktop = members.getByRole('button', { name: `More actions for ${LONG_NAME}`, exact: true });
  const trigger = (await phone.isVisible()) ? phone : desktop;
  await trigger.click();
  await members.getByRole('button', { name: item, exact: true }).click();
}

// D12: Manage Group Members, as the group's owner.
const reachManage: SurfaceRow['reach'] = async (page) => {
  const dialog = await openMembers(page, withLongMember, 'Manage Group Members');
  return { root: dialog, dialog };
};

// D13: Members, as a member who is not owner or admin.
const reachMembers: SurfaceRow['reach'] = async (page) => {
  const dialog = await openMembers(page, asPlainMember, 'Members');
  return { root: dialog, dialog };
};

// readRoleTags: the role tags of the members dialog (owner pick N04 = B, plan 89.6-44).
// readTagLines (./night) reads Owner and Admin by its own word list; Member and a bare Pending are
// not on that list (on the night page those words are not tags), so this read is the dialog's own.
// A role tag is a leaf span, shown, not inside a button, a select or an option, whose trimmed text
// is exactly Owner, Admin, Member or Pending. It returns one message for:
//   each tag whose computed weight is not 400 (the pick is regular weight everywhere);
//   each tag with an edge (a top border wider than 0px);
//   each tag drawn in more than one box (it broke inside itself);
//   tag heights that spread more than 0.5px across the dialog (one tag block, one height);
//   each (You) that is not plain words (a weight other than 400, a fill, or side padding);
//   fewer than min tags found (a read that found nothing proves nothing).
// An empty list means every role tag is one height, whole, with no edge, at regular weight, and
// every (You) the roster shows is plain words. A roster that shows no (You) adds no message.
async function readRoleTags(dialog: Locator, min: number): Promise<string[]> {
  return dialog.evaluate((root, floor) => {
    const round = (n: number): number => Math.round(n * 100) / 100;
    const words = ['Owner', 'Admin', 'Member', 'Pending'];
    const shown = (span: Element): boolean => {
      const style = getComputedStyle(span);
      const box = span.getBoundingClientRect();
      return style.display !== 'none' && style.visibility === 'visible' && span.getClientRects().length > 0 && box.width > 0 && box.height > 0;
    };
    const problems: string[] = [];
    const heights: Array<{ word: string; height: number }> = [];
    for (const span of Array.from(root.querySelectorAll('span'))) {
      if (span.childElementCount > 0) continue;
      const word = (span.textContent ?? '').trim();
      if (span.closest('button, select, option') || !shown(span)) continue;
      const style = getComputedStyle(span);
      if (word === '(You)') {
        const fill = style.backgroundColor;
        if (style.fontWeight !== '400') problems.push(`(You) has weight ${style.fontWeight}, not 400`);
        if (fill !== 'transparent' && fill !== 'rgba(0, 0, 0, 0)') problems.push(`(You) has a fill (${fill}): it is plain words`);
        if (style.paddingLeft !== '0px') problems.push(`(You) has side padding (${style.paddingLeft}): it is plain words`);
        continue;
      }
      if (!words.includes(word)) continue;
      heights.push({ word, height: span.getBoundingClientRect().height });
      if (style.fontWeight !== '400') problems.push(`the role tag ${word} has weight ${style.fontWeight}, not 400`);
      if (style.borderTopWidth !== '0px') problems.push(`the role tag ${word} has an edge (${style.borderTopWidth})`);
      const boxes = span.getClientRects().length;
      if (boxes > 1) problems.push(`the role tag ${word} is drawn in ${boxes} boxes (it broke inside itself)`);
    }
    if (heights.length < floor) problems.push(`${heights.length} role tags found, fewer than ${floor}`);
    if (heights.length > 1) {
      const low = heights.reduce((a, b) => (b.height < a.height ? b : a));
      const high = heights.reduce((a, b) => (b.height > a.height ? b : a));
      if (high.height - low.height > 0.5) {
        problems.push(`role tags differ in height by ${round(high.height - low.height)}px: ${high.word} ${round(high.height)}px, ${low.word} ${round(low.height)}px`);
      }
    }
    return problems;
  }, min);
}

// The tag reads of one members dialog, as one list of short lines (tagSummary, ./night): the role
// tags read above, and the night module's tag read (one height and one top on a line, whole, 400).
async function memberTagProblems(dialog: Locator, at: string): Promise<string[]> {
  return [...tagSummary(`${at} role tags`, await readRoleTags(dialog, 2)), ...tagSummary(`${at} tags`, await readTagLines(dialog, 1))];
}

// D12 and D13 extras, every cell (plan 89.6-44, N04 B): the tags of the open dialog. Reads only:
// nothing is pressed. In D12's 320 x 568, 200% cell the same reads are also taken at normal text at
// 320 x 568 and at 375 x 667 (the pick was drawn at normal text), then the cell's size and mode are
// put back; the sweep sets the next cell's mode itself. A failure throws ONE joined line, because
// the sweep keeps only an error's first line.
const membersTagExtras = (rowId: 'D12' | 'D13', title: 'Manage Group Members' | 'Members'): NonNullable<SurfaceRow['extras']> =>
  async (page: Page, cell: SweepCell) => {
    const tag = `${rowId} ${cell.id}`;
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const problems = await memberTagProblems(dialog, tag);
    if (rowId === 'D12' && cell.id === '320x568-dark-200') {
      await setTextMode(page, '100', `${tag} tags normal-text pass`);
      for (const size of [{ width: 320, height: 568 }, { width: 375, height: 667 }]) {
        await page.setViewportSize(size);
        await settleAnimations(dialog);
        problems.push(...(await memberTagProblems(dialog, `${tag} at ${size.width} x ${size.height}, normal text`)));
      }
      await page.setViewportSize({ width: cell.width, height: cell.height });
      await setTextMode(page, '200', `${tag} back to 200%`);
      await settleAnimations(dialog);
      await toDialogTop(dialog);
    }
    if (problems.length > 0) throw new Error(problems.join(' || '));
  };

// D16: the long member's Transfer ownership item opens the confirm. Its Transfer ownership button is NEVER pressed.
const reachTransfer: SurfaceRow['reach'] = async (page) => {
  const members = await openMembers(page, withLongMember, 'Manage Group Members');
  await pressMenuItem(members, 'Transfer ownership to this member');
  return opened(page, `Transfer ownership to ${LONG_NAME}?`);
};

// D17: the viewer's own Leave Group opens the confirm. Its Confirm Leave button is NEVER pressed.
// The confirm is named after the group, so it is found by how its name starts.
const reachLeave: SurfaceRow['reach'] = async (page) => {
  const members = await openMembers(page, asPlainMember, 'Members');
  await members.getByRole('button', { name: 'Leave Group', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Leave .+\?$/ });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return { root: dialog, dialog };
};

// The width from which md matches when the default font is 32px (48rem of 32px), with room.
const MD_AT_FONT_32 = { width: 1600, height: 1024 };

// D18: the long member's desktop Remove opens the confirm (reached at 768, FL-17c). Its Remove
// button is NEVER pressed. The long member is the roster's last row, so their Remove is the last
// one; the confirm's exact name holds their name. Where md does not match at 768 (a default font
// of 32px), the window is widened until it does, the confirm is opened, and the cell then narrows
// the window with the confirm open: the path a person at that text size has to this dialog.
const reachRemove: SurfaceRow['reach'] = async (page) => {
  const members = await openMembers(page, withLongMember, 'Manage Group Members');
  const remove = members.getByRole('button', { name: 'Remove', exact: true }).last();
  if (!(await remove.isVisible())) {
    await page.setViewportSize(MD_AT_FONT_32);
    await remove.waitFor({ state: 'visible', timeout: 15_000 });
  }
  await remove.click();
  return opened(page, `Remove ${LONG_NAME} from this group?`);
};

// D19: Reset invite link opens the confirm. Its Reset link button is NEVER pressed.
const reachReset: SurfaceRow['reach'] = async (page) => {
  const members = await openMembers(page, withLongMember, 'Manage Group Members');
  await members.getByRole('button', { name: 'Reset invite link', exact: true }).click();
  return opened(page, 'Reset the invite link?');
};

// D20: the long member's role set to Admin opens the confirm: the menu's Make admin below md, the
// role select from md up. Its Make admin button is NEVER pressed.
const reachMakeAdmin: SurfaceRow['reach'] = async (page) => {
  const members = await openMembers(page, withLongMember, 'Manage Group Members');
  const select = members.getByRole('combobox', { name: `Role for ${LONG_NAME}`, exact: true });
  if (await select.isVisible()) await select.selectOption('admin');
  else await pressMenuItem(members, 'Make admin');
  return opened(page, `Make ${LONG_NAME} an admin?`);
};

export const rows: SurfaceRow[] = [
  { id: 'D12', census: 'D12', kind: 'dialog', owner: '89.6-11', status: 'enforced', reach: reachManage, extras: membersTagExtras('D12', 'Manage Group Members') },
  { id: 'D13', census: 'D13', kind: 'dialog', owner: '89.6-11', status: 'enforced', reach: reachMembers, extras: membersTagExtras('D13', 'Members') },
  { id: 'D16', census: 'D16', kind: 'dialog', owner: '89.6-11', status: 'enforced', reach: reachTransfer },
  { id: 'D17', census: 'D17', kind: 'dialog', owner: '89.6-11', status: 'enforced', reach: reachLeave },
  // DECISION Phase 89.6-15 (D18 and D20 enforced again by the owner's hyphen ruling, 2026-11-25): plan 89.6-15 had set
  // these two rows pending under plan 89.6-34 (orchestrator decision D8 of 2026-11-24), because at 768 wide, dark, 200%
  // text the long name in the confirm title breaks only at its hyphen beside the close and the split read then listed it
  // split. The owner ruled question D "a" (a break at a hyphen is fine), chosen OVER restructuring the dialog header so the
  // close stacks for a hyphen break; the read now lists such a break as ordinary wrapping before stacking is asked
  // (e2e/support/wordLines.ts ("AMENDED 2026-11-25 by the owner's ruling on question D")), and both rows are back under
  // plan 89.6-11, enforced. Changing this is a decision, not a cleanup.
  { id: 'D18', census: 'D18', kind: 'dialog', owner: '89.6-11', status: 'enforced', reachAt: { width: 768, height: 1024 }, reach: reachRemove },
  { id: 'D19', census: 'D19', kind: 'dialog', owner: '89.6-11', status: 'enforced', reach: reachReset },
  { id: 'D20', census: 'D20', kind: 'dialog', owner: '89.6-11', status: 'enforced', reach: reachMakeAdmin },
];
