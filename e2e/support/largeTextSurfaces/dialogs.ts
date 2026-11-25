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
import { readLargeTextCell, setTextMode } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id: a row that opened some other group would read a dialog the fixtures do not own.
const groupPage = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the Customize Group rows open that group');
  return `/groupHomePage?id=${id}`;
};

const customizeGroup = (page: Page): Locator => page.getByRole('dialog', { name: 'Customize Group', exact: true });

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
const answerPromptSettings: NonNullable<SurfaceRow['answers']> = (url) =>
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

export const rows: SurfaceRow[] = [
  { id: 'D07', census: 'D07', kind: 'dialog', owner: '89.6-25', status: 'enforced', reach: reachCustomizeGroup, answers: answerPromptSettings, extras: customizeGroupExtras },
  { id: 'D08', census: 'D08', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D09', census: 'D09', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D10', census: 'D10', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D11', census: 'D11', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'D24', census: 'D24', kind: 'dialog', owner: '89.6-25', status: 'pending' },
  { id: 'O09', census: 'O09', kind: 'overlay', owner: '89.6-25', status: 'pending' },
];
