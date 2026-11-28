import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { E2E_GROUP_ID, openGroupSettings } from './support/groupSettings';
import {
  expectNoApiWrites,
  holdRequests,
  holdWrites,
  settleAnimations,
  type RequestHold,
  type WriteHold,
} from './support/inFlight';
import { isWriteGet } from './support/largeTextSurfaces';
import { injectViewerYesRsvp } from './support/viewerRsvp';
import { setNarrowLargeText } from './support/wordLines';

// Phase 89.6-36, S4w = S4-c (owner pick 2026-11-23: Same width, spinner only).
//
// WHAT. A busy Button keeps its resting size while its Spinner shows: its width, height and left
// edge do not change, the Cancel beside it stays where it is, the words give way to a Spinner
// centred in the button, and the accessible name still says the label and "saving". Before this
// plan the Spinner was mounted beside the label and the button grew by the Spinner's 16px plus the
// 8px gap (24px; 48px at 320 wide with 200% text), which moved the Cancel beside it.
// Measured on Save Changes in the Customize Group dialog, at rest and while its write is held.
//
// WRITE GUARD. holdWrites is registered FIRST, before any other route and before the navigation,
// so every request that is not a GET or HEAD is held in the browser as the last resort. Then
// holdRequests takes the settings PUT, matched by pathname on any host, so the BFF proxy at
// localhost:3000/api and the backend at localhost:4000/api are both caught; it is answered in the
// browser with a 500 after the reads, so nothing is saved and the dialog stays open. The spec never
// calls unrouteAll: disabling interception resumes held requests (the 88.9-03 leak). Two more
// routes are registered before the navigation, as the two-tap spec and the sweep's write guard do:
// the signed-in self read is sent on with its timezone parameter deleted (the backend backfills a
// missing time zone from it), and every GET that writes (the WRITE_GETS list behind isWriteGet in
// e2e/support/largeTextSurfaces/index.ts: invite-token, rsvp/respond, prompt-settings) is held
// unanswered in the browser, never sent. The dialog's read-only schedule summary reads the group's
// prompt settings, one of those GETs, so it stays loading; the Save and Cancel boxes are read at
// rest and while busy in that same state, so the comparison is not affected.
//
// WHERE. Both projects (phone and journeys). Each test sets its viewport before the navigation;
// there is no conditional skip. Its two rows in scripts/gate-c-floors.manifest.mjs exist so that a
// green run names this spec (CI prints no line per passing test).
//
// CI ONLY like every signed-in spec here (C-14): the projects need the setup project's login,
// whose credentials exist only in CI. Typecheck and listing are the local proof.

// Copied from e2e/group-settings-pending-focus.spec.ts ("const SETTINGS_PATH").
const SETTINGS_PATH = /\/groups\/[^/]+\/settings$/;

const isSelfReadWithTimezone = (url: URL): boolean =>
  /\/users\/[^/]+$/.test(url.pathname) && url.searchParams.has('timezone');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const readBox = (locator: Locator): Promise<Box> =>
  locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

// The opacity of every element child of the button except the Spinner (the label span and, while
// busy, the screen-reader suffix).
const readWordOpacities = (button: Locator): Promise<string[]> =>
  button.evaluate((el) =>
    Array.from(el.children)
      .filter((child) => child.getAttribute('data-slot') !== 'spinner')
      .map((child) => getComputedStyle(child).opacity),
  );

const near = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance;

test.describe('S4w (89.6-36): a busy button keeps its width', () => {
  let hold: WriteHold | undefined;
  let putHold: RequestHold | undefined;

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any route and before the navigation, so it is the last resort.
    hold = await holdWrites(page);
    // Registered after the hold, so it runs before it: the one write this spec is about.
    putHold = await holdRequests(page, { method: 'PUT', match: (url) => SETTINGS_PATH.test(url.pathname) });
    await page.route(isSelfReadWithTimezone, async (route: Route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      const url = new URL(request.url());
      url.searchParams.delete('timezone');
      await route.continue({ url: url.toString() });
    });
    await page.route(isWriteGet, async (route: Route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'HEAD') {
        await route.fallback();
        return;
      }
      // Held: never answered, never handed on.
    });
  });

  test.afterEach(async () => {
    await putHold?.abortAll();
    expectNoApiWrites(hold);
  });

  async function measureHold(page: Page, tag: string): Promise<void> {
    if (!putHold) throw new Error(`${tag}: the settings PUT hold was not registered`);
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /customize group/i }) });
    const save = dialog.getByRole('button', { name: /^Save Changes( ?, saving)?$/ });
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel, `${tag}: the dialog has one Cancel`).toHaveCount(1);
    await save.scrollIntoViewIfNeeded();
    await settleAnimations(dialog);

    const restSave = await readBox(save);
    const restCancel = await readBox(cancel);

    await save.click();
    await putHold.arrived;
    const spinner = save.locator('[data-slot="spinner"]');
    await expect(spinner, `${tag}: the Spinner shows while the write is held`).toHaveCount(1, { timeout: 5_000 });

    const busySave = await readBox(save);
    const busyCancel = await readBox(cancel);
    const spinnerBox = await readBox(spinner);
    const busyOpacities = await readWordOpacities(save);
    await expect(save, `${tag}: the busy name still says the label and saving`).toHaveAccessibleName(/^Save Changes ?, saving$/);

    const boxes = JSON.stringify({ restSave, busySave, restCancel, busyCancel, spinnerBox, busyOpacities });
    // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 89.6-36)
    console.log(`[89.6-36 S4w] ${tag} ${boxes}`);

    expect(
      near(busySave.width, restSave.width, 0.5),
      `${tag}: Save Changes changed width while busy (rest ${restSave.width}, busy ${busySave.width})`,
    ).toBe(true);
    expect(
      near(busySave.height, restSave.height, 0.5),
      `${tag}: Save Changes changed height while busy (rest ${restSave.height}, busy ${busySave.height})`,
    ).toBe(true);
    expect(
      near(busySave.x, restSave.x, 0.5),
      `${tag}: Save Changes moved sideways while busy (rest x ${restSave.x}, busy x ${busySave.x})`,
    ).toBe(true);
    expect(
      near(busyCancel.x, restCancel.x, 0.5),
      `${tag}: Cancel moved sideways while Save Changes was busy (rest x ${restCancel.x}, busy x ${busyCancel.x})`,
    ).toBe(true);
    expect(
      near(busyCancel.width, restCancel.width, 0.5),
      `${tag}: Cancel changed width while Save Changes was busy (rest ${restCancel.width}, busy ${busyCancel.width})`,
    ).toBe(true);
    const saveCentreX = busySave.x + busySave.width / 2;
    const saveCentreY = busySave.y + busySave.height / 2;
    const spinnerCentreX = spinnerBox.x + spinnerBox.width / 2;
    const spinnerCentreY = spinnerBox.y + spinnerBox.height / 2;
    expect(
      near(spinnerCentreX, saveCentreX, 1),
      `${tag}: the Spinner is not centred across the button (spinner centre x ${spinnerCentreX}, button centre x ${saveCentreX})`,
    ).toBe(true);
    expect(
      near(spinnerCentreY, saveCentreY, 1),
      `${tag}: the Spinner is not centred down the button (spinner centre y ${spinnerCentreY}, button centre y ${saveCentreY})`,
    ).toBe(true);
    expect(busyOpacities.length, `${tag}: the busy button has no word children to read`).toBeGreaterThan(0);
    expect(
      busyOpacities.every((opacity) => opacity === '0'),
      `${tag}: the words are still drawn while the Spinner shows (opacities ${busyOpacities.join(', ')}, want every one 0)`,
    ).toBe(true);

    // Answered in the browser: nothing is saved, the error toasts and the dialog stays open.
    await putHold.release({ error: 'held by e2e (89.6-36)' }, 500);
    await expect(spinner, `${tag}: the Spinner leaves after the write is answered`).toHaveCount(0, { timeout: 5_000 });
    const afterSave = await readBox(save);
    const afterOpacities = await readWordOpacities(save);
    expect(
      near(afterSave.width, restSave.width, 0.5),
      `${tag}: Save Changes did not return to its resting width (rest ${restSave.width}, after ${afterSave.width})`,
    ).toBe(true);
    expect(
      afterOpacities.every((opacity) => opacity === '1'),
      `${tag}: the words did not come back after the Spinner left (opacities ${afterOpacities.join(', ')}, want every one 1)`,
    ).toBe(true);
  }

  test('S4w (89.6-36): a busy Save Changes keeps its width and height, Cancel stays put, the spinner is centred and the name still says saving (375 x 667, normal text)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    await openGroupSettings(page);
    await measureHold(page, '375/100');
  });

  test('S4w (89.6-36): the same at 320 x 568 with 200% text', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await openGroupSettings(page);
    await setNarrowLargeText(page, 'S4w 320/200');
    await measureHold(page, '320/200');
  });
});

// Phase 89.6-47, S4w-raw (owner pick 2026-11-23, S4-c: Same width, spinner only), carried from the
// shared Button above to the spinner hosts that are raw buttons.
//
// WHAT. Three raw hosts are measured at rest and while their write is held, at 375 x 667 with
// normal text and at 320 x 568 with 200% text: Remind on the Plan Game Session page, the Remove
// item of a member's three-dot menu in Manage Members (with the open menu as its container), and
// an unpressed status of the RSVP trio on the event page. Each keeps its x, width and height
// within 0.5px (the menu its width and height), its element children are transparent, the house
// Spinner sits centred over the control (1px) and the name still says the label and its suffix.
// Each test prints its resting boxes BEFORE any press, so a red run still records them:
// the lines start [89.6-47 S4w-raw].
//
// WRITE GUARD. holdWrites is registered FIRST, before any route and before the navigation. Then
// the self read is handed on without its timezone parameter (the backend backfills a missing time
// zone from it), and every GET that writes (isWriteGet: invite-token, rsvp/respond,
// prompt-settings) is held unanswered in the browser and its path printed in the afterEach. Each
// write a test presses is held by holdRequests, matched by pathname on any host (the BFF proxy at
// localhost:3000/api included), and answered in the browser with a 500, so nothing is sent, saved
// or removed and the control comes back to rest. The afterEach aborts what is still held and then
// checks that no /api write reached the backstop. It never calls unrouteAll (the 88.9-03 leak).
// The magic-link RSVP page and its /rsvp/respond read are never visited, so no single-use token
// is consumed.
//
// DECISION Phase 89.6-47 (self read): the timezone parameter is deleted with route.fallback and a
// url override, chosen OVER route.continue (what the describe above does). The event page's
// viewer-row injection (e2e/support/viewerRsvp.ts ("export async function injectViewerYesRsvp("))
// fetches the self read itself; a continue here would skip that handler and the trio would lose
// its viewer row, and registering the strip before the injection would let the injection fetch
// the parameter through. A fallback hands the changed request to the next handler and, when none
// answers, to the network (measured 2026-11-28 with a local server: both saw the URL without the
// parameter). The RSVP tests register the strip again AFTER the injection, so it runs first.
//
// NO NAME OR ADDRESS IS READ. Every member and respondent these tests name is synthetic or is
// located by position; the printed lines hold boxes and opacities only.

// Same convention as e2e/rsvp-section-outcome-spacing.spec.ts ("const E2E_EVENT_DETAIL_PATH =").
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;

// Copied from e2e/response-dashboard-remind.spec.ts ("async function mockDashboard("): one
// synthetic prompt with one pending respondent no seeded user owns, so the row shows Remind.
const RAW_PROMPT_ID = '89640047-0000-4000-8000-000000000047';
const RAW_PENDING_MEMBER = {
  user_id: '89640047-0000-4000-8000-0000000000a1',
  username: 'E2E pending member',
  has_responded: false,
  slot_count: null,
  last_reminded_at: null,
};

const LOG_TAG = '[89.6-47 S4w-raw]';

async function stripSelfReadTimezone(page: Page): Promise<void> {
  await page.route(isSelfReadWithTimezone, async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }
    const url = new URL(request.url());
    url.searchParams.delete('timezone');
    await route.fallback({ url: url.toString() });
  });
}

interface RawRead {
  control: Box;
  container: Box | null;
}

interface RawOptions {
  tag: string;
  /** The control's name while its spinner shows. */
  busyName: RegExp;
  /** The hold on the write the press sends. */
  write: RequestHold;
  /** Where animations are settled before the resting read (the page body, or the open dialog). */
  settle: Locator;
  /** The box that must not change with the control (the open menu). */
  container?: Locator;
  /** What starts the write; the default is one click on the control. */
  press?: () => Promise<void>;
}

async function measureRaw(control: Locator, options: RawOptions): Promise<void> {
  const { tag, busyName, write, settle, container } = options;
  const readBoth = async (): Promise<RawRead> => ({
    control: await readBox(control),
    container: container ? await readBox(container) : null,
  });

  await expect(control, `${tag}: the control is on the page once`).toHaveCount(1);
  await control.scrollIntoViewIfNeeded();
  await settleAnimations(settle);

  const rest = await readBoth();
  // Printed BEFORE any press: the before-read of a red run.
  // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 89.6-47)
  console.log(`${LOG_TAG} ${tag} rest ${JSON.stringify(rest)}`);

  if (options.press) await options.press();
  else await control.click();
  await write.arrived;
  const spinner = control.locator('[data-slot="spinner"]');
  await expect(spinner, `${tag}: the Spinner shows while the write is held`).toHaveCount(1, { timeout: 5_000 });

  const busy = await readBoth();
  const spinnerBox = await readBox(spinner);
  const opacities = await readWordOpacities(control);
  // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log (plan 89.6-47)
  console.log(`${LOG_TAG} ${tag} busy ${JSON.stringify({ ...busy, spinner: spinnerBox, opacities })}`);

  expect(
    near(busy.control.x, rest.control.x, 0.5),
    `${tag}: the control moved sideways while busy (rest x ${rest.control.x}, busy x ${busy.control.x})`,
  ).toBe(true);
  expect(
    near(busy.control.width, rest.control.width, 0.5),
    `${tag}: the control changed width while busy (rest ${rest.control.width}, busy ${busy.control.width})`,
  ).toBe(true);
  expect(
    near(busy.control.height, rest.control.height, 0.5),
    `${tag}: the control changed height while busy (rest ${rest.control.height}, busy ${busy.control.height})`,
  ).toBe(true);
  if (rest.container && busy.container) {
    expect(
      near(busy.container.width, rest.container.width, 0.5),
      `${tag}: the menu changed width while its item was busy (rest ${rest.container.width}, busy ${busy.container.width})`,
    ).toBe(true);
    expect(
      near(busy.container.height, rest.container.height, 0.5),
      `${tag}: the menu changed height while its item was busy (rest ${rest.container.height}, busy ${busy.container.height})`,
    ).toBe(true);
  }
  const controlCentreX = busy.control.x + busy.control.width / 2;
  const controlCentreY = busy.control.y + busy.control.height / 2;
  const spinnerCentreX = spinnerBox.x + spinnerBox.width / 2;
  const spinnerCentreY = spinnerBox.y + spinnerBox.height / 2;
  expect(
    near(spinnerCentreX, controlCentreX, 1),
    `${tag}: the Spinner is not centred across the control (spinner centre x ${spinnerCentreX}, control centre x ${controlCentreX})`,
  ).toBe(true);
  expect(
    near(spinnerCentreY, controlCentreY, 1),
    `${tag}: the Spinner is not centred down the control (spinner centre y ${spinnerCentreY}, control centre y ${controlCentreY})`,
  ).toBe(true);
  expect(opacities.length, `${tag}: the busy control has no element children to read`).toBeGreaterThan(0);
  expect(
    opacities.every((opacity) => opacity === '0'),
    `${tag}: the words are still drawn while the Spinner shows (opacities ${opacities.join(', ')}, want every one 0)`,
  ).toBe(true);
  await expect(control, `${tag}: the busy name still says the label and its suffix`).toHaveAccessibleName(busyName);

  // Answered in the browser: nothing is sent, saved or removed, and the control comes back.
  await write.release({ error: 'held by e2e (89.6-47)' }, 500);
  await expect(spinner, `${tag}: the Spinner leaves after the write is answered`).toHaveCount(0, { timeout: 5_000 });
  const after = await readBox(control);
  expect(
    near(after.width, rest.control.width, 0.5),
    `${tag}: the control did not return to its resting width (rest ${rest.control.width}, after ${after.width})`,
  ).toBe(true);
}

test.describe('S4w-raw (89.6-47): spinner hosts outside Button keep their size when busy', () => {
  let hold: WriteHold | undefined;
  let writes: RequestHold[] = [];
  // Every GET that writes which a page sent, by path; held in the browser, printed after the test.
  let heldWriteGets: string[] = [];

  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any route and before the navigation, so it is the last resort.
    hold = await holdWrites(page);
    writes = [];
    heldWriteGets = [];
    await stripSelfReadTimezone(page);
    await page.route(isWriteGet, async (route: Route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'HEAD') {
        await route.fallback();
        return;
      }
      heldWriteGets.push(new URL(route.request().url()).pathname);
      // Held: never answered, never handed on.
    });
  });

  test.afterEach(async () => {
    for (const write of writes) await write.abortAll();
    expectNoApiWrites(hold);
    // eslint-disable-next-line no-console -- the held writing GETs are recorded from the CI log (plan 89.6-47)
    console.log(`${LOG_TAG} write-GETs held ${JSON.stringify(heldWriteGets)}`);
  });

  async function holdWrite(page: Page, method: string, match: (url: URL) => boolean): Promise<RequestHold> {
    const write = await holdRequests(page, { method, match });
    writes.push(write);
    return write;
  }

  // Remind: a synthetic prompt and one pending respondent answered in the browser, the remind
  // POST held. Returns the row's Remind button.
  async function reachRemind(page: Page, tag: string): Promise<{ control: Locator; write: RequestHold }> {
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await page.route(
      (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/prompts/active`),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          json: { prompt: { id: RAW_PROMPT_ID, status: 'active', blind_voting_enabled: false, deadline } },
        });
      },
    );
    await page.route(
      (url) => url.pathname.endsWith(`/prompts/${RAW_PROMPT_ID}/respondents`),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 200, json: [RAW_PENDING_MEMBER] });
      },
    );
    const write = await holdWrite(page, 'POST', (url) => url.pathname.includes(`/prompts/${RAW_PROMPT_ID}/remind/`));

    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
    const heading = page.getByRole('heading', { name: /^Responses:/ });
    await expect(heading, `${tag}: the response dashboard never rendered`).toBeVisible({ timeout: 15_000 });
    const row = heading.locator('xpath=..').getByRole('listitem').filter({ hasText: RAW_PENDING_MEMBER.username });
    const control = row.getByRole('button', { name: /^Remind( ?, sending)?$/ });
    await expect(control, `${tag}: the pending row has no Remind`).toBeVisible({ timeout: 15_000 });
    return { control, write };
  }

  // The first member's three-dot menu in Manage Members, open, with the remove DELETE held.
  // The member is the seeded group's own, found by position and never named.
  async function reachMemberRemove(
    page: Page,
    tag: string,
    largeText: boolean,
  ): Promise<{ dialog: Locator; menu: Locator; control: Locator; write: RequestHold }> {
    const write = await holdWrite(page, 'DELETE', (url) =>
      new RegExp(`/groups/${E2E_GROUP_ID}/users/[^/]+$`).test(url.pathname),
    );
    await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
    const manage = page.getByRole('button', { name: 'Manage Members' });
    await expect(manage, `${tag}: the group page never rendered Manage Members`).toBeVisible({ timeout: 15_000 });
    await manage.click();
    const dialog = page.getByRole('dialog', { name: 'Manage Group Members' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Before the menu opens, so the menu is laid out at the size it is read at.
    if (largeText) await setNarrowLargeText(page, tag);
    await settleAnimations(dialog);

    const triggers = dialog.getByRole('button', { name: /^Member actions for / });
    await expect
      .poll(() => triggers.count(), {
        message: `${tag}: the seeded group has no other member with a three-dot menu`,
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1);
    const trigger = triggers.first();
    await trigger.click();
    // The open list, through the trigger's own aria-controls, so the item below is this menu's.
    const listId = await trigger.getAttribute('aria-controls');
    expect(listId, `${tag}: the open member menu names no list`).toBeTruthy();
    const menu = dialog.locator(`[id="${listId}"]`);
    // One node in each of its states: at rest, waiting, live and busy.
    const control = menu.getByRole('button', {
      name: /^(Remove(, wait \d seconds?)?|Tap again to remove|Remove ?, removing)$/,
    });
    return { dialog, menu, control, write };
  }

  // The event page with the viewer answered Yes in the browser, so Maybe is an unpressed status,
  // and the RSVP POST held.
  async function reachRsvpStatus(page: Page, tag: string): Promise<{ control: Locator; write: RequestHold }> {
    await injectViewerYesRsvp(page);
    // AFTER the injection, so this runs first and the injection fetches the self read without
    // its timezone parameter (the DECISION in this block's header).
    await stripSelfReadTimezone(page);
    const write = await holdWrite(page, 'POST', (url) => url.pathname.endsWith('/rsvp'));

    await page.goto(E2E_EVENT_DETAIL_PATH);
    const group = page.getByRole('group', { name: /^RSVP for / });
    await expect(
      group,
      `${tag}: no RSVP trio on the event page (the fixture event is in the future, so a miss is a fixture or route failure)`,
    ).toHaveCount(1, { timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'Save note' }),
      `${tag}: Save note never appeared, so the viewer row was not injected`,
    ).toBeVisible({ timeout: 15_000 });
    const control = group.getByRole('button', { name: /^Maybe( ?, saving)?$/ });
    await expect(control, `${tag}: Maybe is not an unpressed status`).toHaveAttribute('aria-pressed', 'false');
    return { control, write };
  }

  test('S4w-raw (89.6-47): Remind keeps its size while sending, the spinner is centred and the name still says sending (375 x 667, normal text)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    const { control, write } = await reachRemind(page, 'Remind 375/100');
    await measureRaw(control, {
      tag: 'Remind 375/100',
      busyName: /^Remind ?, sending$/,
      write,
      settle: page.locator('body'),
    });
  });

  test('S4w-raw (89.6-47): Remind, the same at 320 x 568 with 200% text', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    const { control, write } = await reachRemind(page, 'Remind 320/200');
    await setNarrowLargeText(page, 'Remind 320/200');
    await measureRaw(control, {
      tag: 'Remind 320/200',
      busyName: /^Remind ?, sending$/,
      write,
      settle: page.locator('body'),
    });
  });

  async function measureMemberRemove(page: Page, tag: string, largeText: boolean): Promise<void> {
    const { dialog, menu, control, write } = await reachMemberRemove(page, tag, largeText);
    await measureRaw(control, {
      tag,
      busyName: /^Remove ?, removing$/,
      write,
      settle: dialog,
      container: menu,
      press: async () => {
        await control.click();
        // Live after the 3 s wait: it shows Tap again and is named by its sentence.
        await expect(control, `${tag}: the armed item never went live`).toHaveText('Tap again', { timeout: 10_000 });
        await control.click();
      },
    });
  }

  test('S4w-raw (89.6-47): the Manage Members Remove item keeps its row and the menu its size while removing (375 x 667, normal text)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    await measureMemberRemove(page, 'Member Remove 375/100', false);
  });

  test('S4w-raw (89.6-47): the Manage Members Remove item, the same at 320 x 568 with 200% text', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await measureMemberRemove(page, 'Member Remove 320/200', true);
  });

  test('S4w-raw (89.6-47): an RSVP status keeps its size while saving, the spinner is centred and the name still says saving (375 x 667, normal text)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 667 });
    const { control, write } = await reachRsvpStatus(page, 'RSVP status 375/100');
    await measureRaw(control, {
      tag: 'RSVP status 375/100',
      busyName: /^Maybe ?, saving$/,
      write,
      settle: page.locator('body'),
    });
  });

  test('S4w-raw (89.6-47): an RSVP status, the same at 320 x 568 with 200% text', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    const { control, write } = await reachRsvpStatus(page, 'RSVP status 320/200');
    await setNarrowLargeText(page, 'RSVP status 320/200');
    await measureRaw(control, {
      tag: 'RSVP status 320/200',
      busyName: /^Maybe ?, saving$/,
      write,
      settle: page.locator('body'),
    });
  });
});
