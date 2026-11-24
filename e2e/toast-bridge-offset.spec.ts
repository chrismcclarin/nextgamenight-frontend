import { test, expect, type Page } from '@playwright/test';

import { openGroupSettings } from './support/groupSettings';
import { expectNoApiWrites, holdRequests, holdWrites, type WriteHold } from './support/inFlight';

// Phase 89.6-03: the toast-to-dialog announcer bridge and the toast offset, in a real browser.
//
// WHAT THIS PROVES THAT JSDOM CANNOT.
//   1. With Customize Group open and Save Changes failing, the error toast's words are in the
//      polite region INSIDE the dialog, and Chromium's accessibility tree holds them ONCE, there:
//      Sonner's own copy is hidden from assistive tech while the dialog is open
//      (src/components/ui/ToastAnnouncer.tsx ("DECISION Phase 89.6-03 (toast-single-reading)")).
//      Android Chrome + TalkBack reads this same tree, so this read is that platform's check.
//      After the dialog closes with the toast still showing, the tree holds the words once.
//      jsdom has no accessibility tree; it pins the attribute and where the words are
//      (src/components/ui/ToastAnnouncer.test.tsx ("6. Sonner section is aria-hidden while a house Modal is open or closing")).
//   2. The toast list starts just under the header strip at 320 and 375 (phone project) and at
//      768 and 1280 (journeys project), at 100% and 200% text (owner pick O-9e = B). jsdom has
//      no layout; src/app/miniPicks.test.ts ("8. 88.9-52 W40") pins the two offsets at source.
//
// WHY IT IS SAFE TO PRESS SAVE CHANGES HERE. Three routes, registered before the page loads:
//   a. holdWrites, the catch-all backstop: every request that is not a GET or HEAD is held in the
//      browser and never answered (both origins: the backend and the same-origin proxy).
//   b. a GET guard: a GET carrying a timezone parameter is sent on WITHOUT it (the self read
//      backfills a null timezone when it carries one), and every GET that writes is answered in
//      the browser, never sent: /prompt-settings gets the empty settings body
//      (src/lib/schemas/prompts.ts ("export const EMPTY_PROMPT_SETTINGS: PromptSettings = {")),
//      because its backend read persists a schedule clean-up
//      (backend:Sonnet/routes/groupPromptSettings.js ("// Persist cleanup if any schedules were modified"))
//      and Customize Group always mounts the summary that reads it
//      (src/app/components/PromptScheduleReadOnly.js ("() => promptSettingsAPI.getGroupPromptSettings(groupId),"));
//      /rsvp/respond and the two invite-token reads
//      (src/lib/api.ts ("// Get (or lazy-generate) group invite token")) are held unanswered,
//      and afterEach asserts none was sent (this page has no reason to send one).
//   c. the settings PUT is answered 500 in the browser (registered last, so it wins for that PUT).
// CI's database is an ephemeral service per run: defence in depth, never relied on.
//
// CI ONLY, like every signed-in spec (C-14): the login the setup project stores exists only in
// CI. Typecheck and listing are the local proof. Both projects run both tests: there is no skip.
//
// NOT CHECKED HERE: whether a screen reader SPEAKS the words. The iPhone and Mac listen rows are
// plan 89.6-32's.

const SETTINGS_PATH = /\/groups\/[^/]+\/settings$/;
// The announcer's dwell (src/components/ui/StatusRegion.tsx ("export const REGION_EMPTY_DWELL_MS = 100;")).
const REGION_EMPTY_DWELL_MS = 100;
// The empty settings body; the schema accepts it.
const EMPTY_PROMPT_SETTINGS = { id: null, schedules: [], games: [], members: [] };

const customizeGroup = (page: Page) => page.getByRole('dialog', { name: /customize group/i });
const saveChanges = (page: Page) =>
  customizeGroup(page).getByRole('button', { name: 'Save Changes', exact: true });
const frontToastTitle = (page: Page) =>
  page.locator('[data-sonner-toast][data-front="true"] [data-title]');

type Place = 'dialog' | 'sonner' | 'root' | 'elsewhere';
interface ToastNode {
  place: Place;
  /** The roles (and names) from the node's parent up to the page. */
  chain: string;
  name: string;
}
interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  parentId?: string;
}

// Chromium's accessibility tree, read through a CDP session. Counted: nodes that are not
// ignored, whose role is StaticText and whose name is the toast's words. Chromium gives every
// rendered text a StaticText node and an InlineTextBox child of the same name, so InlineTextBox
// nodes are never counted. Each counted node is placed by its parent chain: under the dialog;
// under Sonner's section (the node named Notifications ...); under a status region outside the
// dialog (the root announcer); or elsewhere.
async function readToastNodes(page: Page, words: string): Promise<ToastNode[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AXNode[] };
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const found: ToastNode[] = [];
    for (const node of nodes) {
      if (node.ignored || node.role?.value !== 'StaticText' || node.name?.value !== words) continue;
      const parents: AXNode[] = [];
      for (let up = node.parentId; up !== undefined; up = byId.get(up)?.parentId) {
        const parent = byId.get(up);
        if (!parent) break;
        parents.push(parent);
      }
      const roleOf = (each: AXNode) => String(each.role?.value ?? '');
      const nameOf = (each: AXNode) => String(each.name?.value ?? '');
      let place: Place = 'elsewhere';
      if (parents.some((each) => roleOf(each) === 'dialog')) place = 'dialog';
      else if (parents.some((each) => nameOf(each).startsWith('Notifications'))) place = 'sonner';
      else if (parents.some((each) => roleOf(each) === 'status')) place = 'root';
      const chain = parents
        .map((each) => (nameOf(each) ? `${roleOf(each)} "${nameOf(each).slice(0, 40)}"` : roleOf(each)))
        .join(' < ');
      found.push({ place, chain, name: String(node.name?.value) });
    }
    return found;
  } finally {
    await cdp.detach();
  }
}

const countOf = (found: ToastNode[], place: Place): number =>
  found.filter((each) => each.place === place).length;
const listOf = (found: ToastNode[]): string =>
  found.length === 0
    ? '(no node holds the words)'
    : found.map((each) => `[${each.place}] ${each.name} < ${each.chain}`).join('\n');

test.describe('The toast bridge and the toast offset (89.6-03)', () => {
  let backstop: WriteHold;
  let heldWriteGets: string[];
  let promptSettingsAnswered: number;

  test.beforeEach(async ({ page }) => {
    heldWriteGets = [];
    promptSettingsAnswered = 0;
    // a. The backstop FIRST: Playwright runs the newest matching route first, so this one sees
    //    whatever the two below hand back.
    backstop = await holdWrites(page);
    // b. The GET guard.
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      const url = new URL(request.url());
      if (url.pathname.endsWith('/prompt-settings')) {
        promptSettingsAnswered += 1;
        await route.fulfill({ status: 200, json: EMPTY_PROMPT_SETTINGS });
        return;
      }
      if (url.pathname.endsWith('/rsvp/respond') || url.pathname.endsWith('/invite-token')) {
        // Held: never answered, never sent.
        heldWriteGets.push(url.pathname);
        return;
      }
      if (url.searchParams.has('timezone')) {
        url.searchParams.delete('timezone');
        await route.continue({ url: url.toString() });
        return;
      }
      await route.fallback();
    });
    // c. Every Save is answered 500 in the browser.
    const save = await holdRequests(page, {
      method: 'PUT',
      match: (url) => SETTINGS_PATH.test(url.pathname),
    });
    await save.release({ error: 'Simulated save failure (89.6-03)' }, 500);
    // Installed before the page loads; time runs normally until a test pauses it.
    await page.clock.install();
    await openGroupSettings(page);
  });

  test.afterEach(() => {
    expectNoApiWrites(backstop);
    expect(heldWriteGets, 'a GET that writes was sent by this page (held, never answered)').toEqual([]);
  });

  test('1. an error toast raised while Customize Group is open is in the dialog region, and in the accessibility tree once', async ({ page }, testInfo) => {
    // Anti-vacuity for the GET guard: the check-ins summary mounted and its writing read was
    // answered here, never sent.
    expect(promptSettingsAnswered, 'the /prompt-settings read was answered in the browser').toBeGreaterThanOrEqual(1);

    const dialog = customizeGroup(page);
    await saveChanges(page).click();
    const title = frontToastTitle(page);
    await expect(title, 'the failed save raises an error toast').toBeVisible({ timeout: 15_000 });
    const words = (await title.innerText()).trim();
    expect(words.length, 'the toast has words').toBeGreaterThan(0);

    // Pause the page clock just past the announcer's dwell: the words have landed, and neither
    // the toast's 4 s lifetime nor the region's 4 s clear can run out under the reads below.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + REGION_EMPTY_DWELL_MS + 50);

    const region = dialog.locator('[data-announcer="dialog"]');
    await expect(region, 'the open dialog carries exactly one announcer region').toHaveCount(1);
    await expect(region, 'the toast words land in the open dialog region').toHaveText(words);
    await expect(
      page.getByRole('status').filter({ hasText: words }),
      'exactly one status region on the page holds the toast words',
    ).toHaveCount(1);
    await expect(
      page.locator('[data-announcer="root"]'),
      'the root announcer region stays empty while the dialog is open',
    ).toHaveText('');

    // The accessibility tree with the dialog open: one reading, in the dialog region.
    const open = await readToastNodes(page, words);
    await testInfo.attach('ax-toast-nodes.json', {
      body: JSON.stringify({ when: 'dialog open', words, nodes: open }, null, 2),
      contentType: 'application/json',
    });
    expect(countOf(open, 'dialog'), `dialog open: the dialog region holds the words once\n${listOf(open)}`).toBe(1);
    expect(countOf(open, 'sonner'), `dialog open: Sonner's section must be hidden from assistive tech\n${listOf(open)}`).toBe(0);
    expect(countOf(open, 'root'), `dialog open: the root region must not hold the words\n${listOf(open)}`).toBe(0);
    // A node placed elsewhere does not fail this test: it is a found-new double reading for
    // Phase 89.8 (spoken output), recorded from the attachment.

    // The close path: the toast still shows when the dialog closes.
    await expect(title, 'the toast still shows when the dialog is closed').toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog, 'Customize Group closed').toHaveCount(0);
    // One dwell and a margin after the dialog left the page (the clock is paused: run it).
    await page.clock.runFor(REGION_EMPTY_DWELL_MS + 250);
    await expect(title, 'the toast still shows after the dialog closed').toBeVisible();
    await expect(
      page.locator('section[aria-live][aria-label^="Notifications"]'),
      'after the close, with no toast whose words went to the root, the bridge hands Sonner its section back',
    ).not.toHaveAttribute('aria-hidden');

    const closed = await readToastNodes(page, words);
    await testInfo.attach('ax-toast-nodes-after-close.json', {
      body: JSON.stringify({ when: 'after close', words, nodes: closed }, null, 2),
      contentType: 'application/json',
    });
    // The words landed in the dialog region when the toast arrived and left with it
    // (src/components/ui/announcer.ts ("The target is chosen HERE")), so the root never holds them.
    expect(countOf(closed, 'root'), `after close: the root region must not hold the words\n${listOf(closed)}`).toBe(0);
    expect(countOf(closed, 'dialog'), `after close: no dialog is left\n${listOf(closed)}`).toBe(0);
    expect(
      countOf(closed, 'root') + countOf(closed, 'sonner') + countOf(closed, 'elsewhere'),
      `after close: the words are exposed at most once\n${listOf(closed)}`,
    ).toBeLessThanOrEqual(1);
    // The control for the open read above: the toast is on screen and its section is exposed
    // again, so this same count MUST see Sonner's copy now. If it read 0 here, the 0 read with
    // the dialog open would prove nothing.
    expect(countOf(closed, 'sonner'), `after close: the count sees Sonner's exposed copy\n${listOf(closed)}`).toBe(1);
  });

  test('2. the toast list starts just under the header strip, on a phone and on a desktop, at 100% and 200% text', async ({ page, isMobile }) => {
    // Phone first. A plain branch on the project, never a skip.
    const widths = isMobile ? [320, 375] : [768, 1280];
    const height = page.viewportSize()?.height ?? 667;

    for (const textSize of [100, 200]) {
      if (textSize === 200) {
        // How 200% is produced here: the root font size doubles, as in
        // e2e/support/wordLines.ts ("export async function setNarrowLargeText(") (that helper
        // also forces 320 wide, so it is not called).
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await expect
          .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
            message: 'the root font size did not become 32px after the 200% style tag',
          })
          .toBe('32px');
      }
      for (const width of widths) {
        const cell = `${width}px wide, ${textSize}% text`;
        await page.setViewportSize({ width, height });
        await expect
          .poll(() => page.evaluate(() => document.documentElement.clientWidth), {
            message: `${cell}: the window did not become ${width}px wide`,
          })
          .toBe(width);
        await saveChanges(page).click();
        await expect(frontToastTitle(page), `${cell}: the failed save raises an error toast`).toBeVisible({
          timeout: 15_000,
        });

        const read = await page.evaluate(() => {
          const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
          const nav = document.querySelector('nav[aria-label="Main"]');
          let strip: Element | null = nav;
          while (strip && getComputedStyle(strip).position !== 'sticky') strip = strip.parentElement;
          const list = document.querySelector('ol[data-sonner-toaster]');
          if (!strip || !list) return null;
          const stripBox = strip.getBoundingClientRect();
          return {
            rootPx,
            stripHeight: stripBox.height,
            stripBottom: stripBox.bottom,
            listTop: list.getBoundingClientRect().top,
          };
        });
        expect(read, `${cell}: the sticky header strip (the nav named Main) or the toast list is not on the page`).not.toBeNull();
        const { rootPx, stripHeight, stripBottom, listTop } = read as NonNullable<typeof read>;
        const numbers = `${cell}: toast list top ${listTop}px, header strip bottom ${stripBottom}px, root font size ${rootPx}px`;

        // The offsets are derived from the strip's h-16 (4rem). A later change to the strip must
        // fail HERE, with its cause named, not below as a toast-offset fault.
        expect(
          Math.abs(stripHeight - 4 * rootPx),
          `the header strip is no longer 4rem tall: the plan that changed src/app/Header.js must re-derive both Toaster offsets in layout.js (the O-9e amendment). ${cell}: strip height ${stripHeight}px, root font size ${rootPx}px`,
        ).toBeLessThanOrEqual(1);
        expect(listTop, `the toast list starts over the header strip. ${numbers}`).toBeGreaterThanOrEqual(stripBottom);
        expect(
          listTop - stripBottom,
          `the toast list starts more than half a rem under the header strip. ${numbers}`,
        ).toBeLessThanOrEqual(0.5 * rootPx + 1);
      }
    }
  });
});
