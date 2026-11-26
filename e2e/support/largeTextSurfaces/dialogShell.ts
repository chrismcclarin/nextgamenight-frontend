// Surface rows: the shared dialog shell, read on three dialogs (the shell extras; census D07, D12 and D19). Owner: plan 89.6-10.
// D07-shell was pending under plan 89.6-25 from Phase 89.6-11 until plan 89.6-25 re-enforced it: the marker at its row says why.
// One row per line, each with its census id.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// WHAT A SHELL ROW READS. The root of the read is the dialog's HEADER (the dialog's first child:
// the title and the close), so the five checks of the cell are about the shell's own row and not
// about the dialog's body, which is a surface row of its own. The row extras then read the rest of
// the shell: the footer with the same five checks, and the shell's geometry (readShell and
// shellProblems, below), which the large-text matrix's dialog-shell block runs too.
//
// A TALL DIALOG SCROLLS (Phase 89.6-11, owner pick O-8 = C): below the 12rem dialog container the
// whole dialog scrolls as one page (src/app/components/Modal.tsx ("DECISION Phase 89.6-11 (O-8)")),
// and house rule GR says scrolling down is fine. So the shell read asks what a finger can REACH,
// not what is on screen at rest: the header is read with the dialog scrolled to its top, and each
// footer button is scrolled into view first, and must then be whole inside the dialog box and be
// the thing under a finger at its centre. A box that had to scroll for that must be one a finger
// can scroll (overflow-y auto or scroll): a clipping box moves for a script and for nobody else.
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
import { SIDEWAYS_SCROLL_FAILS_AT_PAGE_ZOOM, expectLargeTextCell, expectPageZoomUsable, readLargeTextCell, readPageZoomCell } from '../wordLines';
// The group page, Customize Group's opening steps and its prompt-settings answer are shared with
// the Customize Group surface rows (Phase 89.6-25), in one place: e2e/support/largeTextSurfaces/dialogs.ts ("export async function openCustomizeGroup").
import { answerPromptSettings, customizeGroup, groupPage, openCustomizeGroup } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';

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
  /** The width of the dialog box inside its border, in rem: the size its container query reads. */
  containerRem: number;
  header: ShellBox | null;
  title: ShellBox | null;
  /** One box per drawn line of the title's text. */
  titleLines: ShellBox[];
  close: ShellBox | null;
  closeIcon: ShellBox | null;
  /** The Body: the dialog's direct child that grows to fill it (flex-1). */
  body: ShellBox | null;
  footer: ShellBox | null;
  /** The footer's content box: its box less its padding and border. */
  footerContent: ShellBox | null;
  /** Every button of the shell's own parts (its header and its footer), in document order, with the dialog scrolled to its top. */
  buttons: Array<{ label: string; part: 'header' | 'footer'; box: ShellBox; reached?: ShellReach }>;
}

/** One footer button after it was scrolled into view: where it and the dialog box then are. */
export interface ShellReach {
  box: ShellBox;
  dialog: ShellBox;
  /** Is the button the thing under a finger at its centre? */
  onTop: boolean;
  /** How far the dialog box itself scrolled to show the button. */
  dialogScrolledTo: number;
  /** The dialog box's computed overflow-y: only auto and scroll are scrolls a finger can make. */
  dialogOverflowY: string;
}

/**
 * Read one dialog shell. The header is the dialog's first child; the footer its direct child with
 * a top border. The dialog is scrolled to its top for the read, each footer button is scrolled
 * into view for its own reach read, and the dialog and the window are put back to where they were.
 */
export async function readShell(dialog: Locator): Promise<ShellGeometry> {
  return dialog.evaluate((el) => {
    const box = (node: Element | DOMRect) => {
      const r = node instanceof Element ? node.getBoundingClientRect() : node;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const before = { dialog: el.scrollTop, x: window.scrollX, y: window.scrollY };
    el.scrollTop = 0;
    const header = el.firstElementChild;
    const footer = Array.from(el.children).find((child) => child.tagName === 'DIV' && child.classList.contains('border-t')) ?? null;
    const bodyPart = Array.from(el.children).find((child) => child.classList.contains('flex-1')) ?? null;
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
        node: button,
      }));
    const headerButtons = buttonsOf('header', header).map(({ label, part, box: at }) => ({ label, part, box: at }));
    const footerAtTop = buttonsOf('footer', footer);
    const read = {
      dialog: box(el),
      sideways: el.scrollWidth - el.clientWidth,
      containerRem: el.clientWidth / (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16),
      header: header ? box(header) : null,
      title: title ? box(title) : null,
      titleLines,
      close: close ? box(close) : null,
      closeIcon: icon ? box(icon) : null,
      body: bodyPart ? box(bodyPart) : null,
      footer: footer ? box(footer) : null,
      footerContent,
    };
    // Each footer button, scrolled into view: is it then whole inside the dialog, and under a finger?
    const footerButtons = footerAtTop.map(({ label, part, box: at, node }) => {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        label,
        part,
        box: at,
        reached: {
          box: box(r),
          dialog: box(el),
          onTop: Boolean(hit && node.contains(hit)),
          dialogScrolledTo: el.scrollTop,
          dialogOverflowY: getComputedStyle(el).overflowY,
        },
      };
    });
    el.scrollTop = before.dialog;
    window.scrollTo(before.x, before.y);
    return { ...read, buttons: [...headerButtons, ...footerButtons] };
  });
}

/** The dialog container width, in rem, under which the footer stacks: src/app/components/Modal.tsx ("DECISION Phase 89.6-10 (F4)"). */
const SHELL_STACK_REM = 12;

const inside = (inner: ShellBox, outer: ShellBox): boolean =>
  inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
const near = (value: number, want: number): boolean => Math.abs(value - want) <= 0.5;
const px = (value: number): string => `${Math.round(value * 100) / 100}`;

/**
 * What is wrong with one dialog shell, one line per problem, each starting with `tag`. `mode` is
 * the cell's TEXT mode: the close icon is 20px at normal text (the page-zoom cells too) and 32px
 * at 200% and with a 32px default font; a mode between them (150%) checks only that it follows.
 * `options.zoom` says the cell is one of the two page-zoom cells of the sweep.
 */
export function shellProblems(read: ShellGeometry, mode: string, tag: string, options: { zoom?: boolean } = {}): string[] {
  const problems: string[] = [];
  // Every button of the shell can be reached: a header button lies inside the dialog box with the
  // dialog scrolled to its top; a footer button, scrolled into view, lies whole inside the dialog
  // box and is the thing under a finger at its centre (Phase 89.6-11: a tall dialog scrolls).
  for (const button of read.buttons) {
    const at = button.reached?.box ?? button.box;
    const dialog = button.reached?.dialog ?? read.dialog;
    if (!inside(at, dialog)) {
      problems.push(`${tag}: the ${button.part} button "${button.label}" is outside the dialog box${button.reached ? ' after it was scrolled into view' : ''} (button ${px(at.left)} to ${px(at.right)} by ${px(at.top)} to ${px(at.bottom)}; dialog ${px(dialog.left)} to ${px(dialog.right)} by ${px(dialog.top)} to ${px(dialog.bottom)})`);
    }
    if (!button.reached) continue;
    if (!button.reached.onTop) problems.push(`${tag}: the footer button "${button.label}", scrolled into view, is not the thing under a finger at its centre`);
    if (button.reached.dialogScrolledTo > 0.5 && button.reached.dialogOverflowY !== 'auto' && button.reached.dialogOverflowY !== 'scroll') {
      problems.push(`${tag}: the footer button "${button.label}" is reached only by scrolling the dialog box ${px(button.reached.dialogScrolledTo)}px, and a finger cannot scroll that box (overflow-y ${button.reached.dialogOverflowY})`);
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
    // Owner pick E8b: beside the title the close is centred on the whole title block; on its own
    // row above the title it sits at the right, where the title's row ends.
    if (read.close.bottom <= read.title.top + 0.5) {
      if (!near(read.close.right, read.title.right)) problems.push(`${tag}: the close is on its own row above the title and ends at ${px(read.close.right)}px, not at the row's right edge (${px(read.title.right)}px)`);
    } else if (overlapY > 0.5) {
      const closeMid = (read.close.top + read.close.bottom) / 2;
      const titleMid = (read.title.top + read.title.bottom) / 2;
      if (!near(closeMid, titleMid)) problems.push(`${tag}: the close beside the title is not centred on the title block (close centre ${px(closeMid)}px, title centre ${px(titleMid)}px; E8b)`);
    } else {
      problems.push(`${tag}: the close is neither beside the title nor on a row above it (close ${px(read.close.top)} to ${px(read.close.bottom)}px, title ${px(read.title.top)} to ${px(read.title.bottom)}px)`);
    }
  }
  // The dialog box does not scroll sideways. At a page-zoom cell (options.zoom) that is printed, not
  // failed, by the owner's ruling L2 (e2e/support/wordLines.ts ("DECISION Phase 89.6 R16 (L2)")):
  // the sweep's own read of the cell records the dialog box's sideways scroll there.
  if (read.sideways > 0 && (!options.zoom || SIDEWAYS_SCROLL_FAILS_AT_PAGE_ZOOM)) problems.push(`${tag}: the dialog box scrolls sideways by ${read.sideways}px`);
  // The footer's buttons are seen in the order of the page (owner pick F4): each one sits right of
  // the one before it on its row, or below it. Under the 12rem dialog container (large text on a
  // phone) they are stacked, each as wide as the footer's content box.
  const footerButtons = read.buttons.filter((button) => button.part === 'footer');
  const stacked = read.containerRem < SHELL_STACK_REM;
  footerButtons.forEach((button, at) => {
    if (stacked && read.footerContent && !near(button.box.width, read.footerContent.width)) {
      problems.push(`${tag}: the footer button "${button.label}" is ${px(button.box.width)}px wide in a dialog ${px(read.containerRem)}rem wide, expected the footer's ${px(read.footerContent.width)}px (stacked full width under ${SHELL_STACK_REM}rem, F4)`);
    }
    if (at === 0) return;
    const before = footerButtons[at - 1];
    const below = button.box.top >= before.box.bottom - 0.5;
    const rightOf = button.box.left >= before.box.right - 0.5 && button.box.top < before.box.bottom && before.box.top < button.box.bottom;
    if (stacked ? !below : !below && !rightOf) {
      problems.push(`${tag}: the footer button "${button.label}" is not ${stacked ? 'below' : 'right of or below'} "${before.label}", the button before it in the page's order (F4: seen order is page order)`);
    }
  });
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
  const dialog = await openCustomizeGroup(page);
  return { root: await headerOf(dialog, 'D07-shell'), dialog };
};

// Customize Group always mounts the check-in schedule summary, which reads the group's prompt
// settings (src/app/components/PromptScheduleReadOnly.js ("() => promptSettingsAPI.getGroupPromptSettings(groupId),")),
// and the backend's handler for that read saves a clean-up: a GET that writes. It is answered in
// the browser with the empty settings body, the answer of
// e2e/toast-bridge-offset.spec.ts ("const EMPTY_PROMPT_SETTINGS = { id: null, schedules: [], games: [], members: [] };"):
// answerPromptSettings, imported above.

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
    problems.push(...shellProblems(await readShell(dialog), cell.mode, tag, { zoom: cell.zoom }));
    if (problems.length > 0) throw new Error(problems.join(' || '));
  };

export const rows: SurfaceRow[] = [
  // DECISION Phase 89.6-11 (D07-shell pending; orchestrator ruling 2026-11-24, the owner can veto): this row goes back from
  // enforced (plan 89.6-10) to PENDING under plan 89.6-25, chosen OVER leaving it enforced and red until that plan, OVER
  // fixing the emoji picker here (plan 89.6-25 Task 1 carries the designed fix, owner finding H-23), and OVER changing the
  // O-8 C recipe so the Body keeps the overflow to itself (that hides it again). Its 7 of 7 was only true while the Body's
  // own scroll box hid the emoji picker's sideways overflow. With O-8 C the Body is overflow-visible below the 12rem dialog
  // container, so the dialog box itself shows it: 8px at 215 wide, 15px at 187, 42px at 320 with 200% text, 28px at 375
  // with 200% text (both themes). Plan 89.6-25 fixes the picker and sets this row back to enforced in that commit; the
  // coverage script's --close run fails on any pending row, so the phase cannot close with this one off. The reach, the
  // answers and the extras stay, so turning it on is the status word alone. Changing this is a decision, not a cleanup.
  // AMENDED Phase 89.6-25: re-enforced by plan 89.6-25 in the commit that fixes the emoji picker (both pickers hold at most
  // four columns and drop to fewer, so the picker no longer overflows the dialog box); its reach and answers now come from
  // the Customize Group rows' module, one copy of each.
  { id: 'D07-shell', census: 'D07', kind: 'dialog', owner: '89.6-25', status: 'enforced', reach: reachCustomizeGroup, answers: answerPromptSettings, extras: shellExtras('D07-shell', customizeGroup) },
  { id: 'D12-shell', census: 'D12', kind: 'dialog', owner: '89.6-10', status: 'enforced', reach: reachManageMembers, extras: shellExtras('D12-shell', manageMembers) },
  { id: 'D19-shell', census: 'D19', kind: 'dialog', owner: '89.6-10', status: 'enforced', reach: reachResetConfirm, extras: shellExtras('D19-shell', resetConfirm) },
];
