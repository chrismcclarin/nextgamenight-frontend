// Surface rows: Customize Group, Delete group, the feedback dialogs, Start a check-in and the floating feedback button. Owner: plan 89.6-25.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// NOTHING HERE WRITES. Every row runs under the sweep's write guard; the prompt-settings read
// Customize Group sends is answered in the browser, and no row presses a control that writes.
//
// WHAT A ROW PRINTS. CI keeps nothing from a passing browser test, so the picker reads of D07 are
// also printed as one ZZ25 line per picker and cell (the test's attachments hold the full boxes).
// The phase reads those lines with execute/ci-log.sh in the planning folder.
import { test, type Locator, type Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { routeMemberRoster } from '../memberRoster';
import { readLargeTextCell, setTextMode } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id: a row that opened some other group would read a dialog the fixtures do not own.
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the group dialog rows open that group');
  return id;
};
export const groupPage = (): string => `/groupHomePage?id=${groupId()}`;

export const customizeGroup = (page: Page): Locator => page.getByRole('dialog', { name: 'Customize Group', exact: true });

/** The group page's gear opens Customize Group (owners and admins only). */
export async function openCustomizeGroup(page: Page): Promise<Locator> {
  await page.goto(groupPage());
  const gear = page.getByRole('button', { name: 'Group settings', exact: true });
  await gear.waitFor({ state: 'visible', timeout: 15_000 });
  await gear.click();
  const dialog = customizeGroup(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

// Customize Group mounts the check-in schedule summary, whose prompt-settings read is a GET that
// writes; it is answered in the browser with the empty settings body ("No schedules configured.").
export const answerPromptSettings: NonNullable<SurfaceRow['answers']> = (url) =>
  url.pathname.endsWith('/prompt-settings') ? { id: null, schedules: [], games: [], members: [] } : undefined;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface PickerItem {
  label: string;
  box: Box;
  /** The emoji span of an icon tile; null for a colour swatch. */
  emoji: Box | null;
  emojiFont: number | null;
}

interface PickerRead {
  picker: Box;
  items: PickerItem[];
}

const iconPicker = (dialog: Locator): Locator => dialog.getByRole('radiogroup', { name: 'Choose a default icon:', exact: true });
const colourPicker = (dialog: Locator): Locator => dialog.getByRole('group', { name: 'Choose a default color:', exact: true });

async function readPicker(picker: Locator, withEmoji: boolean): Promise<PickerRead> {
  return picker.evaluate((el, emojiToo) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const items = Array.from(el.querySelectorAll('button')).map((button) => {
      const span = emojiToo ? button.querySelector('span[aria-hidden="true"]') : null;
      return {
        label: (button.getAttribute('title') ?? button.getAttribute('aria-label') ?? button.textContent ?? '').trim(),
        box: box(button),
        emoji: span ? box(span) : null,
        emojiFont: span ? Number.parseFloat(getComputedStyle(span).fontSize) : null,
      };
    });
    return { picker: box(el), items };
  }, withEmoji);
}

const r2 = (value: number): number => Math.round(value * 100) / 100;

/** How many items share the first item's row. */
const columnsOf = (read: PickerRead): number => read.items.filter((item) => Math.abs(item.box.top - read.items[0].box.top) <= 0.5).length;

/** The boxes of a picker relative to its own top left, written short: the column lefts, the row tops and the item sizes. */
function shape(read: PickerRead): string {
  const xs = [...new Set(read.items.map((item) => r2(item.box.left - read.picker.left)))].sort((a, b) => a - b);
  const ys = [...new Set(read.items.map((item) => r2(item.box.top - read.picker.top)))].sort((a, b) => a - b);
  const ws = read.items.map((item) => r2(item.box.width));
  const hs = read.items.map((item) => r2(item.box.height));
  return `grid=${r2(read.picker.width)} cols=${columnsOf(read)} xs=${xs.join(',')} ys=${ys.join(',')} w=${Math.min(...ws)}-${Math.max(...ws)} h=${Math.min(...hs)}-${Math.max(...hs)}`;
}

/** What is wrong with one picker in one cell: spill or cut, a box under 44 x 44, two boxes overlapping, a box outside the picker, an emoji outside its tile. */
async function pickerProblems(picker: Locator, read: PickerRead, tag: string, wantEmojiFont: number | null): Promise<string[]> {
  const problems: string[] = [];
  const text = await readLargeTextCell(picker);
  if (text.spill.length > 0) problems.push(`${tag}: spill ${text.spill.join('; ')}`);
  if (text.cut.length > 0) problems.push(`${tag}: cut ${text.cut.join('; ')}`);
  if (read.items.length === 0) problems.push(`${tag}: the picker holds no button`);
  read.items.forEach((item, at) => {
    if (item.box.width < 44 - 0.5 || item.box.height < 44 - 0.5) problems.push(`${tag}: "${item.label}" is ${r2(item.box.width)} x ${r2(item.box.height)}, under 44 x 44`);
    if (item.box.left < read.picker.left - 0.5 || item.box.right > read.picker.right + 0.5) {
      problems.push(`${tag}: "${item.label}" (${r2(item.box.left)} to ${r2(item.box.right)}) is outside the picker (${r2(read.picker.left)} to ${r2(read.picker.right)})`);
    }
    for (const other of read.items.slice(at + 1)) {
      const overlapX = Math.min(item.box.right, other.box.right) - Math.max(item.box.left, other.box.left);
      const overlapY = Math.min(item.box.bottom, other.box.bottom) - Math.max(item.box.top, other.box.top);
      if (overlapX > 0.5 && overlapY > 0.5) problems.push(`${tag}: "${item.label}" and "${other.label}" overlap by ${r2(overlapX)} x ${r2(overlapY)}`);
    }
    if (wantEmojiFont === null) return;
    if (!item.emoji || item.emojiFont === null) {
      problems.push(`${tag}: the tile "${item.label}" holds no aria-hidden emoji span`);
      return;
    }
    const e = item.emoji;
    const b = item.box;
    if (e.left < b.left - 0.5 || e.right > b.right + 0.5 || e.top < b.top - 0.5 || e.bottom > b.bottom + 0.5) {
      problems.push(`${tag}: the emoji of "${item.label}" (${r2(e.left)} to ${r2(e.right)} by ${r2(e.top)} to ${r2(e.bottom)}) is outside its tile (${r2(b.left)} to ${r2(b.right)} by ${r2(b.top)} to ${r2(b.bottom)})`);
    }
    if (Math.abs(item.emojiFont - wantEmojiFont) > 0.5) problems.push(`${tag}: the emoji of "${item.label}" is ${r2(item.emojiFont)}px, expected ${wantEmojiFont}px (O-M4 Fixed+)`);
  });
  return problems;
}

/** The emoji centre minus the tile centre, x and y, per tile: recorded, never asserted (review M028). */
const centreOffsets = (read: PickerRead): string =>
  read.items
    .map((item) => (item.emoji ? `${r2((item.emoji.left + item.emoji.right) / 2 - (item.box.left + item.box.right) / 2)}/${r2((item.emoji.top + item.emoji.bottom) / 2 - (item.box.top + item.box.bottom) / 2)}` : 'none'))
    .join(' ');

const say = (line: string): void => {
  process.stdout.write(`ZZ25 ${line}\n`);
};

/** Wait until the dialog box and the page stop moving after a viewport or text-size change. */
async function settle(page: Page, dialog: Locator): Promise<void> {
  await settleAnimations(dialog);
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
  });
}

// D07 extras, every cell: both pickers hold their tiles whole (the owner's finding H-23), and the
// URL fields' fit is recorded. In cell 320x568-dark-200 only, the pickers are then read at normal
// text at 375 and at 320, where both must keep four columns (the deltas rule: normal text is
// unchanged). Every problem is thrown as ONE line: the sweep fails a cell only on a throw.
const customizeGroupExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `D07 ${cell.id}`;
  const dialog = customizeGroup(page);
  const icons = iconPicker(dialog);
  const colours = colourPicker(dialog);
  const problems: string[] = [];
  const wantFont = cell.mode === '100' ? 30 : 32;
  const iconRead = await readPicker(icons, true);
  const colourRead = await readPicker(colours, false);
  problems.push(...(await pickerProblems(icons, iconRead, `${tag} icon picker`, wantFont)));
  problems.push(...(await pickerProblems(colours, colourRead, `${tag} colour picker`, null)));
  say(`D07 ${cell.id} icon ${shape(iconRead)} font=${iconRead.items[0]?.emojiFont ?? 'none'}`);
  say(`D07 ${cell.id} icon-centre ${centreOffsets(iconRead)}`);
  say(`D07 ${cell.id} colour ${shape(colourRead)}`);
  const fields = await dialog.locator('input#group-picture-url, input#group-background-url').evaluateAll((inputs) =>
    inputs.map((input) => `${input.id}=${(input as HTMLInputElement).scrollWidth}/${(input as HTMLInputElement).clientWidth}`),
  );
  say(`D07 ${cell.id} url-fields ${fields.join(' ')}`);
  await test.info().attach(`D07-${cell.id}-picker-geometry`, { body: JSON.stringify({ icon: iconRead, colour: colourRead, fields }, null, 2), contentType: 'application/json' });

  if (cell.id === '320x568-dark-200') {
    await setTextMode(page, '100', `${tag} normal-text pass`);
    const normal: Record<string, { icon: PickerRead; colour: PickerRead }> = {};
    for (const size of [
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      await settle(page, dialog);
      const icon = await readPicker(icons, true);
      const colour = await readPicker(colours, false);
      normal[size.width] = { icon, colour };
      say(`D07 normal-${size.width} icon ${shape(icon)} font=${icon.items[0]?.emojiFont ?? 'none'}`);
      say(`D07 normal-${size.width} icon-centre ${centreOffsets(icon)}`);
      say(`D07 normal-${size.width} colour ${shape(colour)}`);
      for (const [name, read] of [
        ['icon', icon],
        ['colour', colour],
      ] as const) {
        const fifth = read.items[4];
        if (columnsOf(read) !== 4 || !fifth || fifth.box.top < read.items[0].box.bottom - 0.5) {
          problems.push(`${tag}: at ${size.width} with normal text the ${name} picker reads ${columnsOf(read)} columns, expected four (normal text unchanged)`);
        }
      }
    }
    await test.info().attach('D07-normal-text-geometry', { body: JSON.stringify(normal, null, 2), contentType: 'application/json' });
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D07: Customize Group, read whole (the dialog is its own root: a tall dialog scrolls as one page below the 12rem dialog container).
const reachCustomizeGroup: SurfaceRow['reach'] = async (page) => {
  const dialog = await openCustomizeGroup(page);
  return { root: dialog, dialog };
};

// D07-leave: an admin sees the Leave arm. The roster is answered with the owner's row made an
// admin's and one synthetic member added (the Leave arm hides for the only member); the synthetic
// row exists only in the answer. Confirm Leave is NEVER pressed.
const SYNTHETIC_MEMBER = {
  id: '00000000-0000-4000-8000-0000000000d7',
  user_id: 'auth0|e2e-synthetic-leave',
  username: 'Synthetic Member',
  email: null,
  UserGroup: { role: 'member' },
};
type RosterRow = { UserGroup?: { role?: string } };
const ownerAsAdmin = (rows: unknown[]): unknown[] => [
  ...rows.map((row) => {
    const member = row as RosterRow;
    return member.UserGroup?.role === 'owner' ? { ...member, UserGroup: { ...member.UserGroup, role: 'admin' } } : row;
  }),
  SYNTHETIC_MEMBER,
];
// A reached dialog is read from its top, as the shell rows read theirs (e2e/support/largeTextSurfaces/dialogShell.ts ("the header is read with the dialog scrolled to its top")).
// Pressing a control low in a tall dialog, or the focus a confirm moves to its field, scrolls the
// dialog box down; the page-zoom read then lists everything above as lost ("starts above the
// page"), though a finger scrolls the dialog back up. Measured on the D07-leave and D08 flip run (89.6-25).
async function toDialogTop(dialog: Locator): Promise<void> {
  await dialog.evaluate((el) => {
    for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) if (node.scrollTop > 0) node.scrollTop = 0;
  });
}

// One roster route per page: the sweep runs a reach again on the same page for the light cell, and a page's routes outlive its navigations.
const rostered = new WeakSet<Page>();

const reachLeaveConfirm: SurfaceRow['reach'] = async (page) => {
  if (!rostered.has(page)) {
    await routeMemberRoster(page, groupId(), ownerAsAdmin);
    rostered.add(page);
  }
  const dialog = await openCustomizeGroup(page);
  await dialog.getByRole('button', { name: 'Leave Group', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Leave', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D08: the owner's Delete Group opens the typed confirm. Its Delete is NEVER pressed and nothing is typed.
const deleteConfirm = (page: Page): Locator => page.getByRole('dialog', { name: /^Delete .*\?$/ });
const reachDeleteConfirm: SurfaceRow['reach'] = async (page) => {
  const settings = await openCustomizeGroup(page);
  await settings.getByRole('button', { name: 'Delete Group', exact: true }).click();
  const dialog = deleteConfirm(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D08 extras (a tall dialog scrolls, plan 89.6-11): each footer button, scrolled into view, lies
// inside the dialog box and is the thing under a finger at its centre. readShell is the shell
// module's read; it is imported when the extras run, because the shell module imports this one.
const deleteConfirmExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const { readShell } = await import('./dialogShell');
  const read = await readShell(deleteConfirm(page));
  const footer = read.buttons.filter((button) => button.part === 'footer');
  const problems: string[] = [];
  if (footer.length === 0) problems.push(`D08 ${cell.id}: the dialog footer holds no button`);
  for (const button of footer) {
    const at = button.reached?.box ?? button.box;
    const box = button.reached?.dialog ?? read.dialog;
    if (at.left < box.left - 0.5 || at.right > box.right + 0.5 || at.top < box.top - 0.5 || at.bottom > box.bottom + 0.5) {
      problems.push(`D08 ${cell.id}: the footer button "${button.label}", scrolled into view, is outside the dialog box (${r2(at.left)} to ${r2(at.right)} by ${r2(at.top)} to ${r2(at.bottom)}; dialog ${r2(box.left)} to ${r2(box.right)} by ${r2(box.top)} to ${r2(box.bottom)})`);
    }
    if (!button.reached?.onTop) problems.push(`D08 ${cell.id}: the footer button "${button.label}", scrolled into view, is not the thing under a finger at its centre`);
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

// D09: Send Feedback, opened from the header menu's Send feedback row (the row with visible text;
// the floating button is icon-only), the path of e2e/feedback-submit.spec.ts ("async function openFromMenu").
const sendFeedback = (page: Page): Locator => page.getByRole('dialog', { name: 'Send Feedback', exact: true });
const menuToggle = (page: Page): Locator => page.getByRole('button', { name: 'Toggle menu' });
async function openSendFeedback(page: Page): Promise<Locator> {
  await page.goto('/');
  const toggle = menuToggle(page);
  await toggle.waitFor({ state: 'visible', timeout: 15_000 });
  await toggle.click();
  await page.getByRole('button', { name: 'Send feedback' }).filter({ hasText: 'Send feedback' }).click();
  const dialog = sendFeedback(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}
const reachSendFeedback: SurfaceRow['reach'] = async (page) => {
  const dialog = await openSendFeedback(page);
  return { root: dialog, dialog };
};

// D09-error: a send that failed. The writer is answered in the browser with 418 and an empty body
// (the answer of e2e/feedback-submit.spec.ts ("418 with an empty body: no code, no known status")),
// registered after the guard, so no request leaves the browser and no GitHub issue is filed.
const SEND_FAILED = "We couldn't send your feedback. Please try again.";
const writerAnswered = new WeakSet<Page>();
const reachSendFailed: SurfaceRow['reach'] = async (page) => {
  if (!writerAnswered.has(page)) {
    await page.route('**/api/feedback/github', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 418, contentType: 'application/json', body: JSON.stringify({}) });
    });
    writerAnswered.add(page);
  }
  const dialog = await openSendFeedback(page);
  await dialog.getByPlaceholder("Tell us what's on your mind...").fill('Synthetic large-text feedback, more than ten characters.');
  await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: SEND_FAILED }).waitFor({ state: 'visible', timeout: 15_000 });
  return { root: dialog, dialog };
};

// O09: the floating feedback button, icon-only (its name has no visible text), drawn only from md
// up while the header is not in its menu form; elsewhere the header menu offers the same entry.
// Found attached, not visible: at the font32 cell the md query no longer matches and it is not drawn.
const floatingFeedback = (page: Page): Locator =>
  page.getByRole('button', { name: 'Send feedback', includeHidden: true }).filter({ hasNotText: 'Send feedback' });
const reachFloatingFeedback: SurfaceRow['reach'] = async (page) => {
  await page.goto('/');
  const fab = floatingFeedback(page);
  await fab.waitFor({ state: 'attached', timeout: 15_000 });
  return { root: fab };
};

// O09 extras, every cell: exactly one feedback entry is offered, the floating button (56 x 56,
// inside the viewport) or the header menu toggle. In cell 320x568-dark-200 only, the same page is
// then read at 1280 x 800 with 200% text: the floating button shows, the toggle does not, and at
// the end of the page the footer's copyright line starts 8px (within 1px) below the button.
const floatingFeedbackExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `O09 ${cell.id}`;
  const problems: string[] = [];
  const fab = floatingFeedback(page);
  const toggle = page.getByRole('button', { name: 'Toggle menu', includeHidden: true });
  const entries = async (): Promise<{ fab: boolean; toggle: boolean; box: Box | null; viewport: { width: number; height: number } }> => {
    const fabShown = await fab.isVisible();
    const toggleShown = await toggle.isVisible();
    const box = fabShown ? await fab.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }) : null;
    const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: window.innerHeight }));
    return { fab: fabShown, toggle: toggleShown, box, viewport };
  };
  const checkOne = (seen: Awaited<ReturnType<typeof entries>>, at: string): void => {
    if (seen.fab === seen.toggle) problems.push(`${at}: ${seen.fab ? 'both' : 'neither'} the floating button and the header menu toggle are offered, expected exactly one`);
    if (seen.box) {
      if (Math.abs(seen.box.width - 56) > 0.5 || Math.abs(seen.box.height - 56) > 0.5) problems.push(`${at}: the floating button is ${r2(seen.box.width)} x ${r2(seen.box.height)}, expected 56 x 56`);
      if (seen.box.left < -0.5 || seen.box.top < -0.5 || seen.box.right > seen.viewport.width + 0.5 || seen.box.bottom > seen.viewport.height + 0.5) problems.push(`${at}: the floating button (${r2(seen.box.left)} to ${r2(seen.box.right)} by ${r2(seen.box.top)} to ${r2(seen.box.bottom)}) is outside the viewport`);
    }
  };
  const seen = await entries();
  checkOne(seen, tag);
  say(`O09 ${cell.id} entry=${seen.fab ? 'floating' : seen.toggle ? 'menu' : 'none'}${seen.box ? ` box=${r2(seen.box.width)}x${r2(seen.box.height)}` : ''}`);

  if (cell.id === '320x568-dark-200') {
    const at = `${tag} at 1280 x 800`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(async () => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await frame();
      await frame();
    });
    const wide = await entries();
    checkOne(wide, at);
    if (!wide.fab) problems.push(`${at}: the floating button is not shown`);
    if (wide.toggle) problems.push(`${at}: the header menu toggle is shown`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(async () => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await frame();
      await frame();
    });
    const copyright = page.getByRole('contentinfo').getByText(/©/).first();
    const gap = await page.evaluate(
      ([button, line]) => {
        if (!button || !line) return null;
        return line.getBoundingClientRect().top - button.getBoundingClientRect().bottom;
      },
      [await fab.elementHandle(), await copyright.elementHandle()] as const,
    );
    say(`O09 1280x800-200 entry=${wide.fab ? 'floating' : wide.toggle ? 'menu' : 'none'}${wide.box ? ` box=${r2(wide.box.width)}x${r2(wide.box.height)}` : ''} copyright-gap=${gap === null ? 'none' : r2(gap)}`);
    if (gap === null) problems.push(`${at}: the floating button or the footer copyright line was not found`);
    else if (Math.abs(gap - 8) > 1) problems.push(`${at}: at the end of the page the copyright line starts ${r2(gap)}px below the floating button, expected 8px (within 1px)`);
  }
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'D07', census: 'D07', kind: 'dialog', owner: '89.6-25', status: 'enforced', reach: reachCustomizeGroup, answers: answerPromptSettings, extras: customizeGroupExtras },
  { id: 'D07-leave', census: 'D07', kind: 'dialog', owner: '89.6-25', status: 'enforced', state: 'leave-confirm', reach: reachLeaveConfirm, answers: answerPromptSettings },
  { id: 'D08', census: 'D08', kind: 'dialog', owner: '89.6-25', status: 'enforced', reach: reachDeleteConfirm, answers: answerPromptSettings, extras: deleteConfirmExtras },
  { id: 'D09', census: 'D09', kind: 'dialog', owner: '89.6-25', status: 'enforced', reach: reachSendFeedback },
  { id: 'D09-error', census: 'D09', kind: 'dialog', owner: '89.6-25', status: 'enforced', state: 'send-failed', reach: reachSendFailed },
  { id: 'D10', census: 'D10', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D11', census: 'D11', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  // pending: D24 until 89.6-41 (the planning page scrolls sideways at 320 / 200% until 89.6-20; plan 41 depends on 20 and on this plan)
  { id: 'D24', census: 'D24', kind: 'dialog', owner: '89.6-41', status: 'pending' },
  { id: 'O09', census: 'O09', kind: 'overlay', owner: '89.6-25', status: 'enforced', reachAt: { width: 1280, height: 800 }, reach: reachFloatingFeedback, extras: floatingFeedbackExtras },
];
