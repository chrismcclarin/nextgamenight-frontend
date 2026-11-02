import { test, expect, type Locator, type Page } from '@playwright/test';

import {
  assertTheme,
  describeGround,
  describeRatio,
  forceLightMode,
  groundResolutionOf,
  probeElement,
  ratioAgainstGround,
  vacuityGround,
  type Measurement,
} from './support/contrast';
import { openCreateEventDialog, switchToManualEntry } from './support/createEvent';
import { E2E_GROUP_ID } from './support/groupSettings';
import { holdWrites } from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';

// Phase 88.9 plan 04 (lane A, the 1280 twins): SPEC R4 / ROADMAP SC-2 verify every changed
// surface at 375 AND at desktop, in both themes (AC-4: at least 44px in dark and in light). The
// 375 halves live in e2e/lane-a-tap-floors.spec.ts ("phone-only: the 375 tap floors of 88.9 lane A")
// and in the phone-only Gate C spec e2e/contrast.spec.ts ("A6e + O1b: the highlighted timezone row's inset cue, its abbr ink and the current-zone ink."),
// and neither can run here: both are skipped at 1280 by a file-level predicate. No source gate covers
// 1280 either: src/app/components/controlSizeFloor.test.tsx ("function meetsFloor(") passes any
// unprefixed token. So the desktop halves of A7a + O3a (both tab strips), A9a + O3a (the six
// text-button controls), A5a (the scheduler badge) and A6e + O1b (the highlighted timezone row)
// are pinned HERE, at the journeys project's 1280 viewport. Every test is red on the pre-fix tree
// on its measured value except the A5a light arm, a confirm (see washBadge); the fixes land later.
//
// THEME: no file-level hook. The theme check is a class assertion on the html element
// (e2e/support/contrast.ts ("export async function assertTheme(")), which times out on about:blank,
// and the light switch is an init script (e2e/support/contrast.ts ("export async function forceLightMode("))
// that takes effect at the next navigation; a file-level hook would also run before every nested
// describe's hooks. So each test checks its theme right after its own first navigation, and the
// light describe forces light in its own hook BEFORE any navigation.
//
// WRITES NOTHING: the size and badge tests load a page and open at most the create-event dialog
// without submitting it. The timezone tests hold every write and ANSWER the timezone PATCH in the
// browser (see timezoneRowCue), so no selection reaches the CI database.
//
// NOT RUN LOCALLY (no stored sign-in locally): typecheck and listing are the local proof; the CI
// e2e job (journeys project) is the proof.
//
// The bodies below mirror the phone twins (the size bodies of e2e/lane-a-tap-floors.spec.ts and
// plan 03's washInk / timezoneRowCue in e2e/contrast.spec.ts) because a spec file cannot be
// imported from another spec without registering its tests; the one-line and strip-overflow
// checks (UI Considerations E7 / E9) stay phone-only, where the strip is narrow.

// DECISION Phase 88.9-04: no capture of any kind on this spec (no failure screenshot, no retry
// trace, no video), chosen OVER the shared failure screenshot and the retry trace that the config
// would otherwise take (playwright.config.ts ("retries: process.env.CI ? 1 : 0,"), playwright.config.ts ("trace: 'on-first-retry',"),
// playwright.config.ts ("screenshot: 'only-on-failure',")) and that CI keeps, encrypted, for seven
// days (.github/workflows/ci.yml ("bash scripts/encrypt-evidence.sh --name playwright-report")). This spec loads the e2e
// account's REAL friends page and its REAL profile page (the timezone picker), so it follows the
// rule of e2e/home-removed-notice.spec.ts ("DECISION Phase 88.6.1 code review WR-02") and
// e2e/friend-invite-panel-header.spec.ts ("DECISION Phase 88.6.1-27"): the WR-02 / 88.6.1-27 rule.
// Failure lines carry box sizes, colours and ratios only, never page text. Saying nothing here is
// NOT the same thing: the shared use block would capture on failure. Re-enabling capture is a
// decision, not a cleanup.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test.skip(({ isMobile }) => isMobile, 'desktop-only: the 1280 twins of 88.9 lane A');

type Theme = 'dark' | 'light';

const GROUP_PAGE = `/groupHomePage?id=${E2E_GROUP_ID}`;
const AA_TEXT = 4.5;
const NON_TEXT = 3.0; // WCAG 1.4.11: the row cue is a non-text indicator

/** The page, then the theme check: the order every test here keeps (see the header). */
async function openPage(page: Page, path: string, theme: Theme): Promise<void> {
  await page.goto(path);
  await assertTheme(page, theme);
}

/** The probe landed on the intended element and found an opaque ground (the contrast.spec guard). */
function guardGround(label: string, m: Measurement): void {
  const resolution = groundResolutionOf(m.probe);
  const innermost = m.probe.levels[0]?.tagName ?? '(none)';
  expect(
    innermost,
    `${label}: the probe's innermost element is <${innermost}> — the locator landed on the document root, ` +
      `so every ratio below would be vacuous. Fix the ANCHOR, do not touch the tokens.\n${vacuityGround(label, resolution)}`,
  ).not.toMatch(/^(body|html)$/);
  expect(m.probe.opaqueAt, describeGround(label, resolution)).toBeGreaterThanOrEqual(0);
}

function expectRatio(label: string, m: Measurement, floor: number): void {
  guardGround(label, m);
  expect(m.ratio, describeRatio(label, floor, m)).toBeGreaterThanOrEqual(floor);
}

/** A computed box-shadow split into its layers on top-level commas only (rgba() keeps its commas). */
function shadowLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

async function friendsTabs(page: Page, theme: Theme): Promise<void> {
  await openPage(page, '/friends', theme);
  const tabs: Array<[string, Locator]> = [
    ['Friends', page.getByRole('button', { name: /^Friends(\s*\d+)?$/ })],
    ['Requests', page.getByRole('button', { name: /^Requests(\s*\d+)?$/ })],
    ['Sent', page.getByRole('button', { name: /^Sent(\s*\d+)?$/ })],
  ];
  await expect(tabs[0][1], 'the friends page tab strip rendered').toBeVisible({ timeout: 15_000 });
  for (const [name, tab] of tabs) {
    await expectTouchTarget(tab, `friends ${name} tab at 1280 (A7a + O3a, ${theme})`, { axes: 'both' });
  }
}

async function groupTabs(page: Page, theme: Theme): Promise<void> {
  await openPage(page, GROUP_PAGE, theme);
  const tabs: Array<[string, Locator]> = [
    ['Overview', page.getByRole('button', { name: 'Overview', exact: true })],
    ['Library', page.getByRole('button', { name: 'Library', exact: true })],
  ];
  await expect(tabs[0][1], 'the group page tab strip rendered').toBeVisible({ timeout: 15_000 });
  for (const [name, tab] of tabs) {
    await expectTouchTarget(tab, `group ${name} tab at 1280 (A7a + O3a, ${theme})`, { axes: 'both' });
  }
}

async function createEventControls(page: Page, theme: Theme): Promise<void> {
  // openCreateEventDialog does not navigate, so the page and the theme check come first.
  await openPage(page, GROUP_PAGE, theme);
  await openCreateEventDialog(page);

  // The three week buttons live in the MANUAL-entry branch, never in the visual scheduler the
  // dialog opens in, so the shared switch step is taken first; the Switch link is the same button
  // in both modes and is measured under its manual-mode words, like its phone twin.
  await switchToManualEntry(page);
  const switchLink = page.getByRole('button', { name: 'Switch to Visual Calendar', exact: true });
  const prev = page.getByRole('button', { name: 'Previous week', exact: true });
  const jump = page.getByRole('button', { name: 'Jump to current week', exact: true });
  const next = page.getByRole('button', { name: 'Next week', exact: true });
  await expect(switchLink, 'the create-event dialog switched to manual entry').toBeVisible();
  await expect(prev, 'the create-event week navigation rendered').toBeVisible({ timeout: 15_000 });
  await expect(jump, 'the create-event Jump to current week rendered').toBeVisible();
  await expect(next, 'the create-event Next week rendered').toBeVisible();

  await expectTouchTarget(switchLink, `create-event Switch link at 1280 (A9a, ${theme})`, { axes: 'height' });
  await expectTouchTarget(prev, `create-event Previous week at 1280 (A9a + O3a, ${theme})`, { axes: 'both' });
  await expectTouchTarget(jump, `create-event Jump to current week at 1280 (A9a, ${theme})`, { axes: 'height' });
  await expectTouchTarget(next, `create-event Next week at 1280 (A9a + O3a, ${theme})`, { axes: 'both' });
}

async function reportBugAndGoToToday(page: Page, theme: Theme): Promise<void> {
  await openPage(page, GROUP_PAGE, theme);

  // A stored calendar preference can reopen the list view; the month grid holds Go to Today.
  const viewToggle = page.getByRole('button', { name: /^(List|Month) View$/ });
  await expect(viewToggle, 'the group calendar rendered').toBeVisible({ timeout: 20_000 });
  if ((await viewToggle.textContent())?.trim() === 'Month View') await viewToggle.click();
  const today = page.getByRole('button', { name: 'Go to Today', exact: true });
  await expect(today, 'the month grid rendered Go to Today').toBeVisible();

  const reportBug = page.getByRole('button', { name: 'Report bug or suggest feature', exact: true });
  await reportBug.scrollIntoViewIfNeeded();
  await expect(reportBug, 'the footer Report bug rendered').toBeVisible();

  await expectTouchTarget(reportBug, `footer Report bug at 1280 (A9a, ${theme})`, { axes: 'height' });
  await today.scrollIntoViewIfNeeded();
  await expectTouchTarget(today, `month grid Go to Today at 1280 (A9a, ${theme})`, { axes: 'height' });
}

const NO_WASH = 'no availability wash on screen — the CI fixture week shows no availability; fix the navigation, never delete this guard';

/** A5a at 1280: the scheduler count badge on its availability wash. */
async function washBadge(page: Page, theme: Theme): Promise<void> {
  // The LIGHT arm is a confirm, as plan 03 declares for its own A5a light arm: the on-screen wash
  // (the .29 step) passes before and after the pick (badge 5.55, 88.9-PICKS-A.json). The DARK arm
  // is red (3.56 at the .29 step).
  // The week-strip aggregate is deliberately NOT read here: the strip renders only at phone width,
  // src/app/components/EventScheduler.tsx ("{isPhoneViewport && (") on the query in
  // src/lib/hooks/usePhoneViewport.ts ("PHONE_MEDIA_QUERY = '(max-width: 767px)'"), so a 1280 strip read could
  // never pass. Its absence is not a gap; the strip is pinned at 375 in e2e/contrast.spec.ts.
  await openPage(page, GROUP_PAGE, theme);
  await openCreateEventDialog(page);
  const badge = page.locator('[role="gridcell"] span[aria-hidden="true"]').filter({ hasText: /^\s*\d+(\s*\/\s*\d+)?\s*$/ }).first();
  await expect(badge, `A5a at 1280 (${theme}): ${NO_WASH}`).toBeVisible({ timeout: 15_000 });

  const badgeLabel = `A5a at 1280 (${theme}) scheduler count badge on its cell wash`;
  const b = await ratioAgainstGround(badge, badgeLabel);
  const washed = b.probe.levels.slice(0, Math.max(b.probe.opaqueAt, 0)).some((l) => !l.transparent);
  expect(washed, `A5a at 1280 (${theme}): no translucent wash between the badge and its opaque ground (${b.ground}) — ${NO_WASH}`).toBe(true);
  expectRatio(badgeLabel, b, AA_TEXT);
}

/** A6e + O1b at 1280: the highlighted timezone row's inset cue, its abbr ink and the current-zone ink. */
async function timezoneRowCue(page: Page, theme: Theme): Promise<void> {
  // Every selection write is held: nothing reaches the CI database.
  await holdWrites(page, {});
  // DECISION Phase 88.9-04 (tz-answer): the timezone PATCH is ANSWERED here, never left to the hold,
  // the rule of e2e/contrast.spec.ts ("DECISION Phase 88.9-03 (tz-answer)"). A held write is released
  // when interception is disabled at unrouteAll and reached the CI database (CI 41396760316).
  // Registered AFTER holdWrites on purpose: Playwright runs matching routes in reverse registration
  // order, so a route registered before the catch-all hold never sees the request. Do not remove or
  // reorder this route. The body mirrors the backend's success shape,
  // backend:Sonnet/routes/users.js ("res.json({ timezone: user.timezone });").
  await page.route(
    (url) => /\/users\/[^/]+\/timezone$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET' || request.method() === 'HEAD') {
        await route.fallback();
        return;
      }
      const sent = (request.postDataJSON() ?? {}) as { timezone?: unknown };
      await route.fulfill({ status: 200, json: { timezone: sent.timezone ?? null } });
    },
  );
  try {
    await openPage(page, '/userProfile', theme);
    const field = page.getByRole('combobox', { name: 'Timezone' });
    await expect(field, `A6e at 1280 (${theme}): the Timezone field is not visible`).toBeVisible({ timeout: 15_000 });
    const list = page.getByRole('listbox', { name: 'Timezones' });
    const active = list.locator('[role="option"][aria-selected="true"]');

    // ALWAYS select a fixed zone first, whatever the account has stored: constants only, never
    // page text, so no zone read off the page can reach a message in the public log. The picker
    // passes selectFirstOnEnter false, so Enter needs an ACTIVE option: ArrowDown first.
    await field.click();
    await field.fill('Los Angeles');
    await expect(list.getByRole('option'), `A6e at 1280 (${theme}): the fixed query did not filter to one option`).toHaveCount(1);
    await field.press('ArrowDown');
    await expect(active, `A6e at 1280 (${theme}): ArrowDown did not activate the filtered option`).toHaveCount(1);
    await field.press('Enter');

    // Reopen on a fixed query with many rows, so another row can be active for the at-rest read.
    await field.click();
    await field.fill('America');
    const options = list.getByRole('option');
    await expect(options.nth(1), `A6e at 1280 (${theme}): the America query shows fewer than two options`).toBeVisible();
    const current = list.locator('[aria-current="true"]');
    await expect(current, `A6e at 1280 (${theme}): no filtered option carries aria-current`).toHaveCount(1);

    // O1b AT REST: a DIFFERENT row active, the current zone keeps its link ink.
    await field.press('ArrowDown');
    await expect(active, `A6e at 1280 (${theme}): no row became active`).toHaveCount(1);
    await expect(active.locator('[aria-current="true"]'), `O1b at 1280 (${theme}): no other row can be active — the at-rest read needs one`).toHaveCount(0);
    const restLabel = `O1b at 1280 (${theme}) current zone at rest on the listbox ground`;
    const rest = await ratioAgainstGround(current, restLabel);
    expect(rest.ratio, `${describeRatio(restLabel, AA_TEXT, rest)} (at rest)`).toBeGreaterThanOrEqual(AA_TEXT);

    // Bounded: the list wraps (loop true), so an unbounded loop would never end.
    const n = await options.count();
    for (let i = 0; i < n; i++) {
      if ((await active.locator('[aria-current="true"]').count()) > 0) break;
      await field.press('ArrowDown');
    }
    expect(await active.locator('[aria-current="true"]').count(), 'no filtered option carries aria-current').toBe(1);
    const row = active;
    await expect(row).toHaveText(/\S/);

    // The cue: ring colour, ring-inset, AND a real inset box-shadow layer — ring-inset only sets a
    // custom property and only a ring WIDTH utility writes box-shadow, so the first two reads alone
    // would pass a fix that ships no ring width. Pre-fix the ring colour read throws.
    const cueLabel = `A6e at 1280 (${theme}) highlighted timezone row inset cue`;
    const cue = await ratioAgainstGround(row, cueLabel, '--tw-ring-color');
    expect(cue.ratio, describeRatio(cueLabel, NON_TEXT, cue)).toBeGreaterThanOrEqual(NON_TEXT);
    const p = await probeElement(row, ['--tw-ring-inset', 'box-shadow']);
    expect(p.computed['--tw-ring-inset']?.raw.trim(), `${cueLabel}: computed --tw-ring-inset is not inset`).toBe('inset');
    const shadow = p.computed['box-shadow']?.raw ?? '';
    const insetSpread = shadowLayers(shadow).some((layer) => {
      if (!/\binset\b/.test(layer)) return false;
      const lengths = [...layer.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      return lengths.length >= 4 && lengths[3] !== 0;
    });
    expect(insetSpread, `${cueLabel}: computed box-shadow is ${shadow} — no inset layer with a non-zero spread`).toBe(true);

    const abbrLabel = `A6e at 1280 (${theme}) highlighted row abbr/offset text`;
    expectRatio(abbrLabel, await ratioAgainstGround(row.locator('[aria-current="true"] > span'), abbrLabel), AA_TEXT);
    const zoneLabel = `O1b at 1280 (${theme}) current zone on the highlighted row`;
    expectRatio(zoneLabel, await ratioAgainstGround(row.locator('[aria-current="true"]'), zoneLabel), AA_TEXT);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
}

test.describe('lane A twins at 1280 — dark (88.9)', () => {
  test('A7a + O3a (88.9): the three friends tabs are at least 44 x 44 at 1280, dark', async ({ page }) => {
    await friendsTabs(page, 'dark');
  });

  test('A7a + O3a (88.9): the two group page tabs are at least 44 x 44 at 1280, dark', async ({ page }) => {
    await groupTabs(page, 'dark');
  });

  test("A9a + O3a (88.9): create-event's Switch link and three week buttons clear 44px tall at 1280, the two arrows 44px wide, dark", async ({
    page,
  }) => {
    await createEventControls(page, 'dark');
  });

  test("A9a (88.9): the footer Report bug and the month grid's Go to Today clear 44px tall at 1280, dark", async ({ page }) => {
    await reportBugAndGoToToday(page, 'dark');
  });

  test('A5a (88.9): the scheduler badge clears 4.5:1 on its wash at 1280, dark', async ({ page }) => {
    await washBadge(page, 'dark');
  });

  test('A6e + O1b (88.9): the highlighted timezone row shows a 3:1 inset cue and its abbr and current-zone inks clear 4.5:1 at 1280, dark', async ({
    page,
  }) => {
    await timezoneRowCue(page, 'dark');
  });
});

test.describe('lane A twins at 1280 — light (88.9)', () => {
  test.use({ colorScheme: 'light' });

  test.beforeEach(async ({ page }) => {
    // Before any navigation: the init script lands at the test's first goto (see the header).
    await forceLightMode(page);
  });

  test('A7a + O3a (88.9): the three friends tabs are at least 44 x 44 at 1280, light', async ({ page }) => {
    await friendsTabs(page, 'light');
  });

  test('A7a + O3a (88.9): the two group page tabs are at least 44 x 44 at 1280, light', async ({ page }) => {
    await groupTabs(page, 'light');
  });

  test("A9a + O3a (88.9): create-event's Switch link and three week buttons clear 44px tall at 1280, the two arrows 44px wide, light", async ({
    page,
  }) => {
    await createEventControls(page, 'light');
  });

  test("A9a (88.9): the footer Report bug and the month grid's Go to Today clear 44px tall at 1280, light", async ({ page }) => {
    await reportBugAndGoToToday(page, 'light');
  });

  test('A5a (88.9): the scheduler badge clears 4.5:1 on its wash at 1280, light', async ({ page }) => {
    await washBadge(page, 'light');
  });

  test('A6e + O1b (88.9): the highlighted timezone row shows a 3:1 inset cue and its abbr and current-zone inks clear 4.5:1 at 1280, light', async ({
    page,
  }) => {
    await timezoneRowCue(page, 'light');
  });
});
