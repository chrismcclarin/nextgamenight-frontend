// Surface rows: the day popup and Share Game QR. Owner: plan 89.6-28.
// One row per line, each with its census id. Plan 89.6-28 turned both on.
// How a row is turned on: e2e/support/largeTextSurfaces/index.ts ("HOW A SWEEP PLAN TURNS A ROW ON").
//
// WHAT IS STAGED. The browser clock is pinned (page.clock.setFixedTime) to today at 20:00 in the
// runner's local time, and a RUNNING night is staged against it: a start one hour before the pinned
// instant and a stored length of 180 minutes, status scheduled. Under SPEC A2 (D-04, the owner's
// 'they should follow the same rule, agreed.') Share Game QR shows until the night is over, so on
// both surfaces the button exists only under that rule; before it, both reaches fail by name.
//   D05: the group page's events read is answered with two nights on today (the running one and a
//        later one, so the day opens the day popup: one night jumps straight to the night page),
//        copied from the shape of the real read; the popup's running row must show Share Game QR.
//   D06: the fixture night's event read is answered with the running start and one typed-in
//        participant (the Participants card that holds Share Game QR renders only with one), and
//        Share Game QR opens the QR box.
// The invite-token read (a GET that writes) is answered in the browser with a fixture link on a
// host nobody can receive at (P5); no real address is typed anywhere.
//
// EVERY ANSWER IS IN THE BROWSER. Nothing is written: the sweep's guard holds every write, and the
// only control these rows press is Copy Invite Link, whose clipboard write is replaced on the
// current document for the copy-failure cells and never reaches a server.
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { settleAnimations } from '../inFlight';
import { scrubbedFetch } from '../scrubbedFetch';
import { toDialogTop } from './dialogs';
import type { SurfaceRow, SweepCell } from './index';

// The seeded group minted by the backend's scripts/e2e-fixtures.js in CI, which the CI login owns.
// No fallback id, as in e2e/support/largeTextSurfaces/members.ts ("No fallback id").
const groupId = (): string => {
  const id = process.env.E2E_GROUP_ID ?? '';
  if (id === '') throw new Error('E2E_GROUP_ID must be set: the CI step that runs scripts/e2e-fixtures.js exports it, and the QR rows open that group');
  return id;
};
const groupPage = (): string => `/groupHomePage?id=${groupId()}`;
// The fixture night, derived as e2e/support/largeTextSurfaces/night.ts derives it.
const eventPath = (): string => process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${groupId()}`;
const eventId = (): string => new URL(eventPath(), 'http://localhost').searchParams.get('event_id') ?? '1';

// A fixture link on the reserved .invalid top-level domain: no host can ever receive it (P5).
export const QR_FIXTURE_URL = 'https://qr.nextgamenight.invalid/invite/game/e2e-sweep-fixture';
const QR_TITLE = 'Game Night Invite QR';
const COPY = 'Copy Invite Link';
const FAIL_SENTENCE = "Couldn't copy the link.";
const RUNNING = 'E2E D05 Running Night';
const LATER = 'E2E D05 Later Night';
const MINUTE = 60_000;

/** Today at 20:00 in the runner's local time: the pinned instant both rows stage against. */
function pinnedInstant(): Date {
  const at = new Date();
  at.setHours(20, 0, 0, 0);
  return at;
}
const runningStart = (): string => new Date(pinnedInstant().getTime() - 60 * MINUTE).toISOString();

// Both rows answer the GETs that write the same way: the invite-token read with the fixture link,
// and a prompt-settings read (if a page sends one) with the empty settings body.
const answers: NonNullable<SurfaceRow['answers']> = (url) => {
  if (url.pathname.endsWith('/invite-token')) return { invite_url: QR_FIXTURE_URL, invite_token: 'e2e-sweep-fixture' };
  if (url.pathname.endsWith('/prompt-settings')) return { id: null, schedules: [], games: [], members: [] };
  return undefined;
};

/** GET only: everything else falls back, so a write still reaches the sweep's hold. */
async function onGet(route: Route, answer: (route: Route) => Promise<void>): Promise<void> {
  if (route.request().method() !== 'GET') {
    await route.fallback();
    return;
  }
  await answer(route);
}

async function realJson(route: Route): Promise<{ response: Awaited<ReturnType<typeof scrubbedFetch>>; body: unknown }> {
  const response = await scrubbedFetch(route);
  try {
    return { response, body: await response.json() };
  } catch {
    return { response, body: undefined };
  }
}

// One set of routes per page: the sweep runs a reach again on the same page for the light cell, and
// a page's routes outlive its navigations.
const dayStaged = new WeakSet<Page>();
const nightStaged = new WeakSet<Page>();

const CUSTOM_PARTICIPANT = { id: '8928a072-0000-4000-8000-0000000000a1', user_id: null, username: 'E2E Typed Guest', is_guest: true, is_custom: true };

async function pinClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(pinnedInstant());
}

/** D05's staged reads: two nights on today in the group's events read. */
async function stageDay(page: Page): Promise<void> {
  if (dayStaged.has(page)) return;
  dayStaged.add(page);
  await page.route(
    (url) => url.pathname === `/api/events/group/${groupId()}`,
    (route) =>
      onGet(route, async (r) => {
        const { response, body } = await realJson(r);
        const template = (Array.isArray(body) && body.length > 0 ? body[0] : {}) as Record<string, unknown>;
        const night = (tail: string, start: string, name: string) => ({
          ...template,
          id: `8928a072-0000-4000-8000-0000000000${tail}`,
          group_id: groupId(),
          start_date: start,
          duration_minutes: 180,
          status: 'scheduled',
          Game: { ...((template.Game as object | null | undefined) ?? {}), name, image_url: null },
          EventParticipations: [],
        });
        const later = new Date(pinnedInstant().getTime() + 90 * MINUTE).toISOString();
        await r.fulfill({ response, json: [night('d1', runningStart(), RUNNING), night('d2', later, LATER)] });
      }),
  );
}

/** D06's staged read: the fixture night, running, with one typed-in participant. */
async function stageNight(page: Page): Promise<void> {
  if (nightStaged.has(page)) return;
  nightStaged.add(page);
  const id = eventId();
  await page.route(
    (url) => url.pathname === `/api/events/${id}`,
    (route) =>
      onGet(route, async (r) => {
        const { response, body } = await realJson(r);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          Object.assign(body as Record<string, unknown>, { start_date: runningStart(), duration_minutes: 180, status: 'scheduled', EventParticipations: [CUSTOM_PARTICIPANT] });
          await r.fulfill({ response, json: body });
          return;
        }
        await r.fulfill({ response });
      }),
  );
}

// D05: the group calendar's day popup for today, whose running night must offer Share Game QR.
const dayPopup = (page: Page): Locator => page.getByRole('dialog').filter({ hasText: RUNNING });
const reachDayPopup: SurfaceRow['reach'] = async (page) => {
  await pinClock(page);
  await stageDay(page);
  await page.goto(groupPage());
  const day = page.getByRole('button', { name: /, 2 games\. Open this day\.$/ });
  await day.first().waitFor({ state: 'visible', timeout: 20_000 });
  await day.first().click();
  const dialog = dayPopup(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  const runningRow = dialog.locator('div.p-edge-page.rounded-lg').filter({ hasText: RUNNING });
  try {
    await runningRow.getByRole('button', { name: 'Share Game QR', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw new Error('D05: the running night in the day popup offers no Share Game QR (SPEC A2: the button shows until the night is over)');
  }
  await settleAnimations(dialog);
  await toDialogTop(dialog);
  return { root: dialog, dialog };
};

// D06: Share Game QR on the running night opens the QR box.
const qrBox = (page: Page): Locator => page.getByRole('dialog', { name: QR_TITLE, exact: true });
const reachQr: SurfaceRow['reach'] = async (page) => {
  await pinClock(page);
  await stageNight(page);
  await page.goto(eventPath());
  const share = page.getByRole('main').getByRole('button', { name: 'Share Game QR', exact: true });
  try {
    await share.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    throw new Error('D06: the running night page offers no Share Game QR (SPEC A2: the button shows until the night is over)');
  }
  await share.click();
  const dialog = qrBox(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await qrCode(dialog).waitFor({ state: 'visible', timeout: 15_000 });
  await settleAnimations(dialog);
  return { root: dialog, dialog };
};

const qrCode = (dialog: Locator): Locator => dialog.locator('svg:has(> title)').first();
const r2 = (n: number): number => Math.round(n * 100) / 100;
const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

/** The close's centre y against the title block's centre y (the title may wrap at 200%). */
async function closeAgainstTitle(dialog: Locator, tag: string): Promise<string | null> {
  const close = await dialog.getByRole('button', { name: 'Close', exact: true }).and(dialog.locator('[data-modal-close]')).boundingBox();
  const title = await dialog.getByRole('heading', { name: QR_TITLE, exact: true }).boundingBox();
  if (!close || !title) return `${tag}: the header close or the title has no box (O-2 B: title left on Modal.Header with the shared close)`;
  const closeY = close.y + close.height / 2;
  const titleY = title.y + title.height / 2;
  if (Math.abs(closeY - titleY) > 1) return `${tag}: the close centre y ${r2(closeY)} is ${r2(Math.abs(closeY - titleY))}px from the title centre y ${r2(titleY)} (AC-9: within 1px)`;
  return null;
}

/** The gap from Close to Copy Invite Link against the footer's own gap, on the axis they share. */
async function footerGap(dialog: Locator, tag: string): Promise<string | null> {
  const close = dialog.getByRole('button', { name: 'Close', exact: true }).and(dialog.locator(':not([data-modal-close])'));
  const copy = dialog.getByRole('button', { name: COPY, exact: true });
  const closeBox = await close.boundingBox();
  const copyBox = await copy.boundingBox();
  if (!closeBox || !copyBox) return `${tag}: the footer Close or Copy Invite Link has no box`;
  const gaps = await copy.evaluate((el) => {
    const parent = el.parentElement;
    const style = parent ? getComputedStyle(parent) : null;
    return { row: style ? parseFloat(style.rowGap) : NaN, column: style ? parseFloat(style.columnGap) : NaN, display: style?.display ?? '' };
  });
  if (copyBox.y >= closeBox.y + closeBox.height - 0.5) {
    const gap = copyBox.y - (closeBox.y + closeBox.height);
    if (!(Math.abs(gap - gaps.row) <= 0.5)) return `${tag}: Copy Invite Link sits ${r2(gap)}px below Close, the footer's row gap is ${gaps.row}px (${gaps.display}; C9: one footer gap apart)`;
    return null;
  }
  const gap = copyBox.x - (closeBox.x + closeBox.width);
  if (!(Math.abs(gap - gaps.column) <= 0.5)) return `${tag}: Copy Invite Link sits ${r2(gap)}px right of Close, the footer's column gap is ${gaps.column}px (${gaps.display}; C9: one footer gap apart; O-2 B: Close first)`;
  return null;
}

/** A refused copy brings the failure sentence's first line inside the visible Body, then resets. */
async function copyFailure(page: Page, dialog: Locator, tag: string): Promise<string[]> {
  const problems: string[] = [];
  const copy = dialog.getByRole('button', { name: COPY, exact: true });
  // (a) On the current document, never an init script (it runs only on documents loaded after it).
  await page.evaluate(() => {
    const w = window as unknown as { __e2eSavedWriteText?: unknown };
    const clipboard = navigator.clipboard;
    w.__e2eSavedWriteText = clipboard.writeText;
    const refuse = () => Promise.reject(new Error('e2e: the clipboard write is refused'));
    clipboard.writeText = refuse;
    if (clipboard.writeText !== refuse) Object.defineProperty(clipboard, 'writeText', { configurable: true, writable: true, value: refuse });
  });
  try {
    // (b)
    await copy.click();
    const sentence = dialog.getByText(FAIL_SENTENCE, { exact: false });
    await sentence.waitFor({ state: 'visible', timeout: 5_000 });
    const focusOnCopy = await copy.evaluate((el) => el === document.activeElement);
    if (!focusOnCopy) problems.push(`${tag}: after a refused copy the focus left Copy Invite Link (CR-1 keeps it there)`);
    // (c)
    const body = dialog.locator(':scope > div.overflow-y-auto');
    const bodies = await body.count();
    if (bodies !== 1) {
      problems.push(`${tag}: the dialog holds ${bodies} scrolling Body boxes, expected 1`);
    } else {
      // (d) The first line of the sentence, wholly inside the visible Body.
      const line = await body.evaluate((el, text) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null = walker.nextNode();
        while (node && !(node.textContent ?? '').includes(text)) node = walker.nextNode();
        if (!node) return null;
        const range = document.createRange();
        range.selectNodeContents(node);
        const first = range.getClientRects()[0];
        const box = el.getBoundingClientRect();
        const top = box.top + el.clientTop;
        return { lineTop: first?.top ?? NaN, lineBottom: first?.bottom ?? NaN, top, bottom: top + el.clientHeight };
      }, FAIL_SENTENCE);
      if (!line) problems.push(`${tag}: the failure sentence's text is not inside the Body`);
      else if (!(line.lineTop >= line.top - 0.5 && line.lineBottom <= line.bottom + 0.5)) {
        problems.push(`${tag}: the failure sentence's first line runs ${r2(line.lineTop)} to ${r2(line.lineBottom)}, outside the visible Body ${r2(line.top)} to ${r2(line.bottom)} (it must be scrolled into view)`);
      }
    }
    // (e) Reset inside the cell: a successful copy clears the failure; Copied! lasts 2000ms.
    await page.evaluate(() => {
      const accept = () => Promise.resolve();
      navigator.clipboard.writeText = accept;
      if (navigator.clipboard.writeText !== accept) Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: accept });
    });
    await copy.click();
    await expect(dialog.getByRole('button', { name: /^(Copied!|Copy Invite Link)$/ }).last()).toHaveText(COPY, { timeout: 5_000 });
    await expect(sentence).toHaveCount(0);
    await expect(dialog.locator(`a[href="${QR_FIXTURE_URL}"]`)).toHaveCount(0);
    if (bodies === 1) await body.evaluate((el) => (el.scrollTop = 0));
  } catch (error) {
    problems.push(`${tag}: copy failure: ${firstLine(error)}`);
  } finally {
    // (f)
    await page.evaluate(() => {
      const w = window as unknown as { __e2eSavedWriteText?: Clipboard['writeText'] };
      if (w.__e2eSavedWriteText) {
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: w.__e2eSavedWriteText });
        delete w.__e2eSavedWriteText;
      }
    });
  }
  return problems;
}

const COPY_FAILURE_CELLS = new Set(['320x568-dark-200', '375x667-dark-200']);

// D06 extras. Every cell: the code renders at least 200px each way (zoom cells included: a cut or
// shrunk code is a loss of function). At 375: the close's centre within 1px of the title's centre,
// the gap from Close to Copy Invite Link equal to the footer's gap, and the rendered module size
// logged; once at 1280 x 800 (in the 375 dark 200% cell) the close-to-title check again. In the
// 320 x 568 and 375 x 667 dark 200% cells: a refused copy shows the failure sentence's first line
// inside the visible Body, then the cell resets itself.
const qrExtras: NonNullable<SurfaceRow['extras']> = async (page: Page, cell: SweepCell) => {
  const tag = `D06 ${cell.id}`;
  const dialog = qrBox(page);
  const problems: string[] = [];
  const code = await qrCode(dialog).boundingBox();
  if (!code) problems.push(`${tag}: the QR code has no box`);
  else if (code.width < 200 - 0.5 || code.height < 200 - 0.5) problems.push(`${tag}: the QR code renders ${r2(code.width)} x ${r2(code.height)}px, under 200px (a shrunk code is a loss of function)`);
  const gap = await footerGap(dialog, tag);
  if (gap) problems.push(gap);
  if (cell.width === 375 && !cell.zoom) {
    const aligned = await closeAgainstTitle(dialog, tag);
    if (aligned) problems.push(aligned);
    const viewBox = await qrCode(dialog).getAttribute('viewBox');
    const modules = Number((viewBox ?? '').trim().split(/\s+/)[2]);
    if (code && Number.isFinite(modules) && modules > 0) {
      const line = `ZZ28 D06 ${cell.id}: QR module ${r2(code.width / modules)}px (viewBox ${modules} modules incl. the quiet zone, rendered ${r2(code.width)}px)`;
      // eslint-disable-next-line no-console -- the measured module size is read from the CI log
      console.log(line);
      test.info().annotations.push({ type: 'ZZ28', description: line });
    }
    if (cell.id === '375x667-dark-200') {
      await page.setViewportSize({ width: 1280, height: 800 });
      await settleAnimations(dialog);
      const wide = await closeAgainstTitle(dialog, `D06 1280x800 (from ${cell.id})`);
      if (wide) problems.push(wide);
      await page.setViewportSize({ width: cell.width, height: cell.height });
      await settleAnimations(dialog);
    }
  }
  if (COPY_FAILURE_CELLS.has(cell.id)) problems.push(...(await copyFailure(page, dialog, tag)));
  if (problems.length > 0) throw new Error(problems.join(' || '));
};

export const rows: SurfaceRow[] = [
  { id: 'D05', census: 'D05', kind: 'dialog', owner: '89.6-28', status: 'enforced', reach: reachDayPopup, answers },
  { id: 'D06', census: 'D06', kind: 'dialog', owner: '89.6-28', status: 'enforced', reach: reachQr, answers, extras: qrExtras },
];
