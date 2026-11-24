// Surface rows: the shared dialog shell, read on three dialogs (the shell extras; census D07, D12 and D19). Owner: plan 89.6-10.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// WHAT A SHELL ROW READS. The root of the read is the dialog's HEADER (the dialog's first child:
// the title and the close), so the five checks of the cell are about the shell's own row and not
// about the dialog's body, which is a surface row of its own. The row extras then read the rest of
// the shell: the footer with the same five checks, and the shell's geometry (readShell and
// shellProblems, below), which the large-text matrix's dialog-shell block runs too.
//
// THE FOOTER IS FOUND BY STRUCTURE, never by position: the dialog's LAST child is the
// screen-reader announcer region, an empty 1px box on which every check passes with nothing read
// (src/app/components/Modal.tsx ("DECISION Phase 88.9-52 (A-47): every house Modal carries its own announcer region")).
// The footer is the dialog's one direct child with a top border; the extras fail when there is not
// exactly one, or when it holds no button, so a selector that stops matching is red, not green.
//
// NOTHING HERE WRITES. Reset invite link opens a confirm dialog and sends nothing; its Reset link
// button is never pressed. The sweep's guard holds every write all the same.
import { expect, type Locator, type Page } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { expectLargeTextCell, expectPageZoomUsable, readLargeTextCell, readPageZoomCell } from '../wordLines';
import type { SurfaceRow, SweepCell } from './index';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login
// owns. No fallback id, as in e2e/manage-members-refresh.spec.ts ("No '1' fallback"): a row that
// opened some other group would read a dialog the fixtures do not own.
const groupPage = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the dialog shell rows open that group');
  return `/groupHomePage?id=${id}`;
};

export interface ShellBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** The geometry of one dialog shell: its own box, its header parts and its footer buttons. */
export interface ShellGeometry {
  dialog: ShellBox;
  /** scrollWidth minus clientWidth of the dialog box: above 0 the dialog scrolls sideways. */
  sideways: number;
  header: ShellBox | null;
  title: ShellBox | null;
  /** One box per drawn line of the title's text. */
  titleLines: ShellBox[];
  close: ShellBox | null;
  closeIcon: ShellBox | null;
  footer: ShellBox | null;
  /** The footer's content box: its box less its padding and border. */
  footerContent: ShellBox | null;
  /** Every button of the shell's own parts (its header and its footer), in document order. */
  buttons: Array<{ label: string; part: 'header' | 'footer'; box: ShellBox }>;
}

/** Read one dialog shell. The header is the dialog's first child; the footer its direct child with a top border. */
export async function readShell(dialog: Locator): Promise<ShellGeometry> {
  return dialog.evaluate((el) => {
    const box = (node: Element | DOMRect) => {
      const r = node instanceof Element ? node.getBoundingClientRect() : node;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const header = el.firstElementChild;
    const footer = Array.from(el.children).find((child) => child.tagName === 'DIV' && child.classList.contains('border-t')) ?? null;
    const title = header?.querySelector('h2') ?? null;
    const close = header?.querySelector('[data-modal-close]') ?? null;
    const icon = close?.querySelector('svg') ?? null;
    let titleLines: ReturnType<typeof box>[] = [];
    if (title) {
      const range = document.createRange();
      range.selectNodeContents(title);
      // One rect per line box of the text; rects on one line share a top.
      const tops = new Map<number, DOMRect[]>();
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width === 0) continue;
        const key = Math.round(rect.top);
        tops.set(key, [...(tops.get(key) ?? []), rect]);
      }
      titleLines = Array.from(tops.values()).map((rects) => {
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      });
    }
    let footerContent: ReturnType<typeof box> | null = null;
    if (footer) {
      const r = footer.getBoundingClientRect();
      const style = getComputedStyle(footer);
      const px = (value: string) => Number.parseFloat(value) || 0;
      const left = r.left + px(style.paddingLeft) + px(style.borderLeftWidth);
      const right = r.right - px(style.paddingRight) - px(style.borderRightWidth);
      const top = r.top + px(style.paddingTop) + px(style.borderTopWidth);
      const bottom = r.bottom - px(style.paddingBottom) - px(style.borderBottomWidth);
      footerContent = { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    const buttonsOf = (part: 'header' | 'footer', root: Element | null) =>
      Array.from(root?.querySelectorAll('button') ?? []).map((button) => ({
        label: (button.getAttribute('aria-label') ?? button.textContent ?? '').trim(),
        part,
        box: box(button),
      }));
    return {
      dialog: box(el),
      sideways: el.scrollWidth - el.clientWidth,
      header: header ? box(header) : null,
      title: title ? box(title) : null,
      titleLines,
      close: close ? box(close) : null,
      closeIcon: icon ? box(icon) : null,
      footer: footer ? box(footer) : null,
      footerContent,
      buttons: [...buttonsOf('header', header), ...buttonsOf('footer', footer)],
    };
  });
}

const inside = (inner: ShellBox, outer: ShellBox): boolean =>
  inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
const near = (value: number, want: number): boolean => Math.abs(value - want) <= 0.5;
const px = (value: number): string => `${Math.round(value * 100) / 100}`;

/**
 * What is wrong with one dialog shell, one line per problem, each starting with `tag`. `mode` is
 * the cell's TEXT mode: the close icon is 20px at normal text (the page-zoom cells too) and 32px
 * at 200% and with a 32px default font; a mode between them (150%) checks only that it follows.
 */
export function shellProblems(read: ShellGeometry, mode: string, tag: string): string[] {
  const problems: string[] = [];
  // Every button of the shell lies inside the dialog box.
  for (const button of read.buttons) {
    if (!inside(button.box, read.dialog)) {
      problems.push(`${tag}: the ${button.part} button "${button.label}" is outside the dialog box (button ${px(button.box.left)} to ${px(button.box.right)} by ${px(button.box.top)} to ${px(button.box.bottom)}; dialog ${px(read.dialog.left)} to ${px(read.dialog.right)} by ${px(read.dialog.top)} to ${px(read.dialog.bottom)})`);
    }
  }
  // The close is a 44 x 44 box inside the dialog, and its icon follows the text up to 32px.
  if (!read.close) problems.push(`${tag}: the dialog header holds no close button (data-modal-close)`);
  else {
    if (!near(read.close.width, 44) || !near(read.close.height, 44)) problems.push(`${tag}: the close box is ${px(read.close.width)} x ${px(read.close.height)}, expected 44 x 44 (O-M4 Fixed+)`);
    if (!inside(read.close, read.dialog)) problems.push(`${tag}: the close box is outside the dialog box`);
    const wantIcon = mode === '100' ? 20 : mode === '200' || mode === 'font32' ? 32 : null;
    if (!read.closeIcon) problems.push(`${tag}: the close button holds no svg icon`);
    else if (wantIcon !== null && (!near(read.closeIcon.width, wantIcon) || !near(read.closeIcon.height, wantIcon))) {
      problems.push(`${tag}: the close icon is ${px(read.closeIcon.width)} x ${px(read.closeIcon.height)}, expected ${wantIcon} x ${wantIcon} (Icon followText, O-M4 Fixed+)`);
    } else if (wantIcon === null && (read.closeIcon.width < 20 - 0.5 || read.closeIcon.width > 32 + 0.5 || !near(read.closeIcon.width, read.closeIcon.height))) {
      problems.push(`${tag}: the close icon is ${px(read.closeIcon.width)} x ${px(read.closeIcon.height)}, expected a square between 20 and 32`);
    }
  }
  // The close and the title never overlap.
  if (!read.title) problems.push(`${tag}: the dialog header holds no h2 title`);
  else if (read.close) {
    const overlapX = Math.min(read.close.right, read.title.right) - Math.max(read.close.left, read.title.left);
    const overlapY = Math.min(read.close.bottom, read.title.bottom) - Math.max(read.close.top, read.title.top);
    if (overlapX > 0.5 && overlapY > 0.5) problems.push(`${tag}: the close box overlaps the title by ${px(overlapX)} x ${px(overlapY)}px`);
  }
  // The dialog box does not scroll sideways.
  if (read.sideways > 0) problems.push(`${tag}: the dialog box scrolls sideways by ${read.sideways}px`);
  return problems;
}

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

/**
 * The header of an open dialog: its first child, which must hold the title and the close. The
 * dialog's opening animation (a zoom and a slide on the dialog box itself) is waited out first:
 * the sweep settles what is under the root it is handed, and this root is inside the animated box.
 */
async function headerOf(dialog: Locator, what: string): Promise<Locator> {
  await settleAnimations(dialog);
  const header = dialog.locator(':scope > :first-child');
  expect(await header.locator('h2').count(), `${what}: the dialog's first child holds no h2, so it is not the shell's header`).toBe(1);
  expect(await header.locator('[data-modal-close]').count(), `${what}: the dialog's first child holds no close button, so it is not the shell's header`).toBe(1);
  return header;
}

const manageMembers = (page: Page): Locator => page.getByRole('dialog', { name: 'Manage Group Members', exact: true });
const resetConfirm = (page: Page): Locator => page.getByRole('dialog', { name: 'Reset the invite link?', exact: true });
const customizeGroup = (page: Page): Locator => page.getByRole('dialog', { name: 'Customize Group', exact: true });

async function openManageMembers(page: Page): Promise<Locator> {
  await page.goto(groupPage());
  const manage = page.getByRole('button', { name: 'Manage Members' });
  await manage.waitFor({ state: 'visible', timeout: 15_000 });
  await manage.click();
  const dialog = manageMembers(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

// D12: the group page's Manage Members (owner or admin).
const reachManageMembers: SurfaceRow['reach'] = async (page) => {
  const dialog = await openManageMembers(page);
  return { root: await headerOf(dialog, 'D12-shell'), dialog };
};

// D19: D12's Reset invite link opens the confirm dialog. Its Reset link button is NEVER pressed.
const reachResetConfirm: SurfaceRow['reach'] = async (page) => {
  const members = await openManageMembers(page);
  await members.getByRole('button', { name: 'Reset invite link', exact: true }).click();
  const dialog = resetConfirm(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return { root: await headerOf(dialog, 'D19-shell'), dialog };
};

// D07: the group page's gear opens Customize Group (the entry path of e2e/support/groupSettings.ts ("export async function openGroupSettingsFromGear")).
const reachCustomizeGroup: SurfaceRow['reach'] = async (page) => {
  await page.goto(groupPage());
  const gear = page.getByRole('button', { name: 'Group settings', exact: true });
  await gear.waitFor({ state: 'visible', timeout: 15_000 });
  await gear.click();
  const dialog = customizeGroup(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return { root: await headerOf(dialog, 'D07-shell'), dialog };
};

/**
 * The extras of a shell row, per cell: the footer holds the cell's checks, and the shell's
 * geometry holds (shellProblems). Every problem of the cell is thrown as ONE line, because the
 * sweep marks a cell failed from what its extras throw and prints the first line of it.
 */
const shellExtras =
  (rowId: string, dialogOf: (page: Page) => Locator): NonNullable<SurfaceRow['extras']> =>
  async (page: Page, cell: SweepCell) => {
    const tag = `${rowId} ${cell.id}`;
    const dialog = dialogOf(page);
    const footer = dialog.locator(':scope > div.border-t');
    expect(await footer.count(), `${tag}: the dialog must hold exactly one footer (a direct child with a top border)`).toBe(1);
    expect(await footer.locator('button').count(), `${tag}: the dialog's footer holds no button`).toBeGreaterThan(0);
    await headerOf(dialog, tag);
    const problems: string[] = [];
    try {
      if (cell.zoom) expectPageZoomUsable(await readPageZoomCell(footer, { dialog }), `${tag} footer`);
      else expectLargeTextCell(await readLargeTextCell(footer, { dialog }), `${tag} footer`);
    } catch (error) {
      problems.push(firstLine(error));
    }
    problems.push(...shellProblems(await readShell(dialog), cell.mode, tag));
    if (problems.length > 0) throw new Error(problems.join(' || '));
  };

export const rows: SurfaceRow[] = [
  { id: 'D07-shell', census: 'D07', kind: 'dialog', owner: '89.6-10', status: 'enforced', reach: reachCustomizeGroup, extras: shellExtras('D07-shell', customizeGroup) },
  { id: 'D12-shell', census: 'D12', kind: 'dialog', owner: '89.6-10', status: 'enforced', reach: reachManageMembers, extras: shellExtras('D12-shell', manageMembers) },
  { id: 'D19-shell', census: 'D19', kind: 'dialog', owner: '89.6-10', status: 'enforced', reach: reachResetConfirm, extras: shellExtras('D19-shell', resetConfirm) },
];
