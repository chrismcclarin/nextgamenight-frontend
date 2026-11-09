import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect, type Locator, type Page } from '@playwright/test';
import { scrubbedFetch } from './support/scrubbedFetch';
import {
  assertTheme,
  blend,
  compositeGround,
  contrastRatio,
  forceLightMode,
  inkRatioThroughOpacity,
  probeElement,
} from './support/contrast';

/**
 * Phase 88.6-45 (R7 / AC-7 second half; 88.3 CR-01 inheritance; FSEC-03) — the image-backed
 * FULL month tile, RENDERED, at desktop width.
 *
 * WHAT THIS PROVES, and what it deliberately does not. Phase 88.3 CR-01 fixed the tile's
 * text-stroke VALUE (`colorUtils.js` `STROKE_DARK`) and plan 88.3-16 hoisted the group image
 * through the `--t-stroke` custom-property pair — which turned an inert, browser-discarded
 * `WebkitTextStroke` declaration into a LIVE one. Nothing ever looked at the live result:
 * `88-RESIDUAL-CENSUS.md` row 5.4 handed the rendered confirmation to 88.6 unconditionally.
 * Scenario A below asserts everything a browser CAN assert about that (the declaration is live,
 * carries the intended value, and the validated `hasBackgroundImage` derivation resolved TRUE)
 * and captures the screenshot. Whether the text is LEGIBLE over an arbitrary image has no
 * oracle — that is the owner's judgement, priced as a `checkpoint:human-verify` in the plan.
 * Scenario B is the other direction of the same allow-list (`safeBgImageStyle.ts`): a URL it
 * REJECTS paints no image and gets the plain-coloured treatment. That one has a real oracle.
 *
 * DESKTOP ONLY, BY CONSTRUCTION. The FULL variant mounts inside `UserHomePage.js`'s
 * `hidden md:flex` column (src/app/userHome/UserHomePage.js ("hidden md:flex md:flex-col")); the phone sheet renders the COMPACT variant, which passes
 * `hasBackgroundImage: false` at the call site (src/app/components/CalendarMonthView.js ("const tileHasBgImage = variant === 'compact' ? false : hasValidBgImage;")) and paints no image.
 * So this spec runs in the `journeys` project (1280 x 720, playwright.config.ts ("name: 'journeys'")) and skips
 * in `phone` — the SAME runtime-skip shape as e2e/contrast.spec.ts ("({ isMobile }) => !isMobile,"), inverted. There is NO
 * project named `desktop` (`88.6-VALIDATION.md` already corrects the plan's `--project=desktop`
 * to `--project=journeys`).
 *
 * ---------------------------------------------------------------------------------------
 * THIS SPEC CANNOT BE RUN ON A LAPTOP, BY DESIGN.
 * ---------------------------------------------------------------------------------------
 * `.auth/user.json` comes from the `setup` project against real Auth0 and the credentials are
 * deliberately absent locally (playwright.config.ts ("They are intentionally absent locally")). Local proofs: `--list` collects
 * exactly the two tests below in `journeys` (and two runtime-skipped in `phone`), and
 * `npx tsc --noEmit -p tsconfig.e2e.json` compiles it. CI is the only place it REPORTS.
 *
 * ---------------------------------------------------------------------------------------
 * HOW THE IMAGE URL REACHES THE TILE — a render-data seed, NOT a database write.
 * ---------------------------------------------------------------------------------------
 * DECISION Phase 88.6-45 (task 3 seeding): BOTH scenarios plant `background_image_url` by
 * rewriting the SAME payload the month view fetches — the BFF-proxied
 * `GET /api/events/user/<uuid>` response, whose nested `Group` carries the key
 * (backend:Sonnet/routes/events.js ("Removing the flag re-arms the ghost-card path."), `attributes: [... 'background_image_url']`) — chosen OVER the
 * plan's two named carriers: the authenticated `PUT /groups/:id/settings` path for the allowed
 * URL and the backend fixture minter for the rejected one.
 *
 * WHY, and it is CONSEQUENCE, not convenience. (1) Every fixture group is SHARED with the
 * `phone` project, whose `contrast.spec.ts` pins the rendered ground of `E2E_GROUP_ID`,
 * `E2E_COLOURED_GROUP_ID` and `E2E_PRESET_ONLY_GROUP_ID` — and the two projects are scheduled
 * across the same worker pool (`fullyParallel: false` is per-FILE, `workers` is unset), so a
 * database write here can land in the middle of a phone-lane measurement and red a sibling
 * gate. (2) The rejected value CANNOT pass `validateGroupUpdate` at all
 * (backend:Sonnet/middleware/validators.js ("body('background_image_url')"), `^https?:\/\/.+`), so the plan's own carrier for it is
 * a BACKEND edit to backend:Sonnet/scripts/e2e-fixtures.js — a cross-repo change this plan's dispatch
 * forbade, and one whose merge deploys production. (3) The subject under test is the RENDER
 * PATH: src/app/components/CalendarMonthView.js ("const groupBgImage = event.Group?.background_image_url;") reads `event.Group?.background_image_url` off this exact
 * JSON and hands it to `safeBgImageStyle` (src/app/components/CalendarMonthView.js ("const bgImageStyle = safeBgImageStyle(groupBgImage);")); a value planted in the response is
 * byte-indistinguishable to that path from one read out of Postgres. What this does NOT
 * exercise is the write-side validator — which is the backend's own unit-tested contract, not
 * this spec's subject. Recorded in `88.6-45-SUMMARY.md` as a deviation with both arms.
 * Reverting either scenario to a database seed is a decision, not a cleanup.
 *
 * SELECTOR POLICY (e2e/padding-budget.spec.ts ("SELECTOR POLICY")): role, label and ARIA state only. The tile is
 * `role="button"` with `aria-label="<game> - <group>"` (src/app/components/CalendarMonthView.js ("const tileLabel =")); the
 * overlay is found by its computed colour, never a class.
 */

test.skip(
  ({ isMobile }) => isMobile,
  'AC-7 second half: the image-backed FULL month tile renders only at >= 768px (src/app/userHome/UserHomePage.js ("hidden md:flex md:flex-col")), so this spec runs only in the journeys project'
);

/** The FSEC-03 motivating case, verbatim from src/lib/safeBgImageStyle.ts ("still parses with protocol"). */
const REJECTED_URL = 'javascript:alert(1)';

/** The overlay src/app/components/CalendarMonthView.js ("rgba(255, 255, 255, 0.7)") paints ONLY when `hasValidBgImage` is true. */
const IMAGE_OVERLAY_RGBA = 'rgba(255, 255, 255, 0.7)';

/**
 * `colorUtils.js`'s `STROKE_DARK` is a module-private constant, so it is READ FROM THE SOURCE at
 * run time rather than transcribed — the value under test is the one the app ships, and a
 * future re-tune moves this expectation with it (the plan-47 "derived, not guessed" shape).
 */
function strokeDarkFromSource(): string {
  const src = readFileSync(resolve(__dirname, '../src/lib/colorUtils.js'), 'utf8');
  const m = src.match(/const STROKE_DARK = '([^']+)'/);
  if (!m) throw new Error('colorUtils.js no longer declares `const STROKE_DARK = \'…\'` — re-derive this spec');
  return m[1];
}

interface FixtureEvent {
  id: string;
  start_date: string;
  Game?: { name?: string } | null;
  Group?: {
    id: string;
    name?: string;
    background_color?: string | null;
    color_preset?: string | null;
    background_image_url?: string | null;
    profile_picture_url?: string | null;
  } | null;
}

interface Seeded {
  /** The event whose group carries the planted URL. */
  event: FixtureEvent;
  /** How many event payloads the rewrite actually touched (0 = the intercept never fired). */
  rewrites: number;
}

/**
 * Rewrite the month view's events payload so ONE uncoloured-group event carries `url` as its
 * group's `background_image_url`. Uncoloured on purpose: with no stored colour the tile's
 * ground is null, so the plain treatment is `{}` (`tileTextTreatment`, src/app/components/CalendarMonthView.js ("if (!tileGround) return {};"))
 * and the two scenarios are separable by the stroke ALONE — a dark stored colour would also
 * resolve to `STROKE_DARK` on the plain path (src/app/components/CalendarMonthView.js ("WebkitTextStroke: brightness <= 128 ?")) and blur the comparison.
 */
async function seedGroupImage(page: Page, url: string): Promise<() => Seeded> {
  let seeded: FixtureEvent | null = null;
  let rewrites = 0;
  await page.route('**/api/events/user/**', async (route) => {
    const response = await scrubbedFetch(route);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (!Array.isArray(body) || body.length === 0) {
      await route.fulfill({ response, json: body });
      return;
    }
    const events = body as FixtureEvent[];
    const target =
      events.find((e) => e.Group && !e.Group.background_color && !e.Group.color_preset) ?? events[0];
    for (const e of events) {
      if (e.Group && e.Group.id === target.Group?.id) {
        e.Group = { ...e.Group, background_image_url: url };
      }
    }
    seeded = target;
    rewrites += 1;
    await route.fulfill({ response, json: events });
  });
  return () => {
    if (!seeded) {
      throw new Error(
        `the events intercept never rewrote a payload (rewrites=${rewrites}) — the month view did not fetch ` +
          `/api/events/user/<uuid>, or the fixture returned no events; nothing below is measured`
      );
    }
    return { event: seeded, rewrites };
  };
}

/**
 * Walk the month view to the month that holds `iso`, then return the tile for `event`. `name`
 * defaults to the exact label; the D5a/O18a guest tiles pass a pattern that also admits the
 * ', Guest' name suffix plan 88.9-28 adds, so that pin reds at its edge read, not here.
 */
async function tileFor(page: Page, event: FixtureEvent, name?: RegExp): Promise<Locator> {
  const start = new Date(event.start_date);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const wanted = `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
  // The FULL month view's own heading (src/app/components/CalendarMonthView.js ("{monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}")). Bounded walk: the fixture
  // events sit +3/+4 days from the run (backend:Sonnet/scripts/e2e-fixtures.js ("start_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),"), backend:Sonnet/scripts/e2e-fixtures.js ("const [eventPhone] = await Event.findOrCreate({")), so at most ONE step.
  const heading = page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  for (let step = 0; step < 2 && (await heading.textContent())?.trim() !== wanted; step += 1) {
    await page.getByRole('button', { name: /Next/ }).click();
  }
  await expect(heading, `the month view did not reach ${wanted}`).toHaveText(wanted);

  const label = `${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Group'}`;
  const tile = name
    ? page.getByRole('button', { name }).first()
    : page.getByRole('button', { name: label, exact: true }).first();
  await expect(tile, `no FULL-variant tile labelled ${JSON.stringify(label)} is visible at 1280px`).toBeVisible();
  return tile;
}

/** The game-name span — the ONLY element the stroke/shadow utilities are declared on (src/app/components/CalendarMonthView.js ("truncate font-bold [text-shadow:var(--t-shadow-l)]")). */
function gameName(tile: Locator, event: FixtureEvent): Locator {
  return tile.getByText(event.Game?.name || 'Game Night', { exact: true });
}

async function tileVars(tile: Locator): Promise<{ stroke: string; strokeL: string; shadow: string; bgImage: string }> {
  return tile.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      stroke: cs.getPropertyValue('--t-stroke').trim(),
      strokeL: cs.getPropertyValue('--t-stroke-l').trim(),
      shadow: cs.getPropertyValue('--t-shadow').trim(),
      bgImage: cs.backgroundImage,
    };
  });
}

async function overlayCount(tile: Locator, rgba: string): Promise<number> {
  return tile.evaluate(
    (el, colour) =>
      Array.from(el.querySelectorAll('div')).filter((d) => getComputedStyle(d).backgroundColor === colour).length,
    rgba
  );
}

test.describe('the image-backed FULL month tile at desktop width (88.6-45, AC-7 / CR-01 / FSEC-03)', () => {
  // FSEC-03's whole point: a `javascript:` value must never execute. A throw inside an event
  // listener cannot fail a test, so every dialog is RECORDED here and asserted absent at the end.
  let dialogsSeen: string[] = [];
  test.beforeEach(async ({ page }) => {
    dialogsSeen = [];
    page.on('dialog', (dialog) => {
      dialogsSeen.push(`${dialog.type()}: ${dialog.message()}`);
      void dialog.dismiss();
    });
  });
  test.afterEach(() => {
    expect(dialogsSeen, 'a browser dialog opened — a planted URL EXECUTED (FSEC-03)').toEqual([]);
  });

  test('Scenario A — an ALLOWED image URL: the stroke pair is LIVE at STROKE_DARK, the validated flag resolved TRUE, and the tile is photographed', async ({ page, baseURL }) => {
    // An app-origin asset, not a third-party host: the mechanical assertions do not depend on
    // the bytes loading, and a CI run must not fail on someone else's CDN. `http(s):` is what the
    // allow-list checks (src/lib/safeBgImageStyle.ts ("export const ALLOWED_IMAGE_PROTOCOLS")), and this is it.
    const allowedUrl = new URL('/bgg-logo.png', baseURL ?? 'http://localhost:3000').href;
    const read = await seedGroupImage(page, allowedUrl);

    await page.goto('/');
    const heading = page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ });
    await expect(heading).toBeVisible({ timeout: 20_000 });
    const { event } = read();
    const tile = await tileFor(page, event);

    await test.step('the validated derivation resolved TRUE: the image is painted and the 0.7 white overlay is mounted', async () => {
      const vars = await tileVars(tile);
      expect(vars.bgImage, 'the tile paints no background-image — safeBgImageStyle rejected an allow-listed URL').toContain('bgg-logo.png');
      expect(await overlayCount(tile, IMAGE_OVERLAY_RGBA), 'the image overlay (src/app/components/CalendarMonthView.js ("rgba(255, 255, 255, 0.7)")) is gated on hasValidBgImage and did not mount').toBe(1);
    });

    await test.step('the dark --t-stroke arm carries STROKE_DARK and the declaration is LIVE on the text; the light arm carries none (F7a)', async () => {
      const strokeDark = strokeDarkFromSource();
      const vars = await tileVars(tile);
      expect(vars.stroke, '--t-stroke (dark arm) is not colorUtils.js STROKE_DARK').toBe(strokeDark);
      // DECISION Phase 88.9-21 (owner pick F7a, votes-b5 v10): the light arm is expected empty or none, chosen over the both-arms STROKE_DARK pin of src/app/components/CalendarMonthView.js ("DECISION Phase 88.3-cr (CR-01, code-adversarial-review 2026-08-27)"); the dark arm and the computed 0.5px stay pinned. Reverting it is a decision.
      expect(['', 'none'], 'F7a: the light arm (--t-stroke-l) carries no stroke').toContain(vars.strokeL);
      // The original CR-01 bug was a VALUE browsers discarded — so the computed style on the text,
      // not the custom property, is the assertion that would have caught it.
      const [width, colour] = await gameName(tile, event).evaluate((el) => {
        const cs = getComputedStyle(el);
        return [cs.getPropertyValue('-webkit-text-stroke-width'), cs.getPropertyValue('-webkit-text-stroke-color')];
      });
      expect(width, 'the text-stroke width did not resolve — the declaration was dropped again (the CR-01 class)').toBe('0.5px');
      expect(colour).toBe('rgba(0, 0, 0, 0.9)');
    });

    await test.step('screenshot — the verification record for the owner legibility judgement', async () => {
      const tilePath = test.info().outputPath('month-tile-desktop-allowed-tile.png');
      const gridPath = test.info().outputPath('month-tile-desktop-allowed-grid.png');
      await tile.screenshot({ path: tilePath });
      // The whole month card, so the tile is seen in its context.
      //
      // DECISION Phase 88.6-59 (review MEDLOW-12, dated 2026-09-29): NO whole-page fallback. When
      // the card ancestor is missing the step FAILS, naming it, so the `if: always()` artifact
      // (`ci.yml`, "Upload desktop month-tile screenshots") can only ever carry the tile and its
      // month card — bounded by construction. REJECTED (T-82-12 / MEDLOW-12): the shipped
      // `.catch()` arm that screenshotted the whole `page` instead, which on a GREEN run
      // published a viewport shot of the logged-in `/` from a PUBLIC repo; and "record that
      // the e2e account is fixture-only",
      // which rests on a value only the owner can read and a later seed change reverses silently.
      // RESIDUE (recorded here 2026-09-29) [CORRECTED 2026-09-29 — plan 88.6-61, review round 2
      // H-5: "CLOSED the same day by 88.6 CR-01" was true for the TRACE channel only]: the
      // pre-existing `if: failure()` upload publishes `test-results/` on every red run. CR-01
      // closed the trace channel (a `**/*.zip` exclusion; the setup project records no trace).
      // The aria-snapshot channel — `error-context.md`, which on a failing journey carries the
      // logged-in page's content and on a failing login the typed password — stayed OPEN until
      // plan 88.6-61, which excludes `**/error-context.md` from the upload and makes the setup
      // project take no screenshot either (playwright.config.ts). STILL UPLOADED, pre-existing:
      // journeys/phone failure screenshots, bounded by the `.auth/`, zip and error-context
      // exclusions and by fixture data. All arms are lockstep-pinned in
      // src/lib/ci-grep-gate.fixture.test.ts ("88.6 CR-01"), src/lib/ci-grep-gate.fixture.test.ts ("88.6 R2-H5"). Restoring a fallback
      // is a decision, not a cleanup.
      // [AMENDED 2026-10-24 — Phase 88.6.2-27: both uploads now ship only age ciphertext
      // (scripts/encrypt-evidence.sh), so this RESIDUE is closed for the artifact channel; the CI
      // log channel is plan 20's scrub.]
      const card = heading.locator('xpath=ancestor::div[contains(@class, "card")][1]');
      await expect(
        card,
        'UI-SPEC month tile: the month card ancestor was not found — the grid screenshot would otherwise fall back to the WHOLE authenticated page, which the always() artifact would carry out of CI, as age ciphertext since Phase 88.6.2-27 (review MEDLOW-12)'
      ).toHaveCount(1);
      await card.screenshot({ path: gridPath });
      await test.info().attach('month-tile-desktop-allowed-tile', { path: tilePath, contentType: 'image/png' });
      await test.info().attach('month-tile-desktop-allowed-grid', { path: gridPath, contentType: 'image/png' });
    });
  });

  test('Scenario B — a REJECTED URL (FSEC-03, javascript:alert(1)): no image, no overlay, the plain treatment, and nothing executes', async ({ page }) => {
    const read = await seedGroupImage(page, REJECTED_URL);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible({ timeout: 20_000 });
    const { event } = read();
    const tile = await tileFor(page, event);

    await test.step('hasBackgroundImage resolved FALSE: no background-image, no 0.7 white overlay', async () => {
      const vars = await tileVars(tile);
      expect(vars.bgImage, 'a rejected URL was painted as a background-image').toBe('none');
      expect(await overlayCount(tile, IMAGE_OVERLAY_RGBA), 'the image overlay mounted for a REJECTED URL — the D-20(i) gate regressed to the raw value').toBe(0);
    });

    await test.step('the PLAIN-coloured treatment, not the image-tuned one', async () => {
      // Uncoloured group (seedGroupImage picks one): the plain path returns `{}` and
      // themedTextStyleVars fills both arms with `none` (src/lib/colorUtils.js ("export function themedTextStyleVars(dark, light) {")).
      const vars = await tileVars(tile);
      expect(vars.stroke, 'the image-tuned stroke reached a tile whose URL was rejected').toBe('none');
      expect(vars.shadow, 'the image-tuned shadow reached a tile whose URL was rejected').toBe('none');
      const width = await gameName(tile, event).evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-text-stroke-width'));
      expect(width).toBe('0px');
    });

    await test.step('screenshot — the fallback, for the record beside Scenario A', async () => {
      const path = test.info().outputPath('month-tile-desktop-rejected-tile.png');
      await tile.screenshot({ path });
      await test.info().attach('month-tile-desktop-rejected-tile', { path, contentType: 'image/png' });
    });
  });
});

/* =========================================================================================
 * Phase 88.9-04 — O4b, the 1280 half of A4b: adjacent-month ink on the home FULL grid.
 *
 * Red by design until plan 88.9-07 takes the whole-cell opacity-60 off the adjacent cell
 * (removed by plan 88.9-07; see its owner-picks marker in
 * src/app/components/CalendarMonthView.js ("owner picks A4b + O4b, 88.9-PICKS-A.json")). Pre-fix the
 * trailing day numbers read 2.38 light / 3.48 dark through that 0.6. Per the UI-SPEC A4b row
 * (amended C11) the adjacent cell's event tile text must clear 4.5 at 1280 as well as at 375,
 * so each test also reads a SEEDED full-variant tile in a trailing cell. The phone half is
 * e2e/contrast.spec.ts ("async function adjacentMonthInk(").
 * ======================================================================================= */

const O4B_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const O4B_FLOOR = 4.5;
/** The synthetic tile's game name: the full tile's visible text is the game name (src/app/components/CalendarMonthView.js ("the full tile's game name, the twin of")). */
const O4B_GAME = 'E2E adjacent home';

async function adjacentHomeInk(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  // The grid is always 42 cells (src/lib/calendarUtils.js ("while (cells.length < 42) {")): the
  // leading days of the previous month, this month, then the trailing next-month days. The same
  // arithmetic here, so the handler and the reads know which days trail.
  const leading = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const trailing = 42 - leading - daysInMonth;
  const syntheticId = crypto.randomUUID();
  let syntheticDay = 0;
  let seedError = '';
  let rewrites = 0;

  // GET-only, the real response through scrubbedFetch (never a raw Playwright route fetch: a failing
  // one prints the session cookie into the public Actions log), ONE synthetic event appended in the
  // browser copy. No write is made.
  await page.route('**/api/events/user/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await scrubbedFetch(route);
    let real: unknown;
    try {
      real = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (!Array.isArray(real)) {
      await route.fulfill({ response, json: real });
      return;
    }
    // Bucket the REAL events by LOCAL date, the way the grid does:
    // src/lib/calendarUtils.js ("const eventDate = new Date(event.start_date);").
    // The runner and the browser share the host timezone because the Playwright config sets no timezoneId.
    const occupied = new Set<number>();
    for (const e of real as { start_date?: string }[]) {
      if (!e.start_date) continue;
      const d = new Date(e.start_date);
      if (d.getFullYear() === nextYear && d.getMonth() === nextMonth) occupied.add(d.getDate());
    }
    // DATE-PROOF: the CI seed puts events at +3 and +4 days, so on the last days of a month they land
    // on trailing days and a fixed seed day would share its cell. The synthetic day is computed from
    // THIS response — the FIRST trailing day it leaves empty — so no real event can share it.
    syntheticDay = 0;
    for (let d = 1; d <= trailing; d++) {
      if (!occupied.has(d)) { syntheticDay = d; break; }
    }
    if (syntheticDay === 0) {
      seedError = `every one of the ${trailing} trailing next-month days already holds a real event`;
      await route.fulfill({ response, json: real });
      return;
    }
    // Shape copied from a real element; the group keeps its colour but carries NO background image,
    // because an image-backed full tile keeps the owner-ruled white/stroke treatment over a photo,
    // which a colour ratio cannot measure.
    const template = (real[0] ?? {}) as Record<string, unknown>;
    const group = (template.Group as Record<string, unknown> | null | undefined) ?? { id: 'e2e-adjacent-home-group', name: 'E2E Adjacent Home' };
    const start = new Date(nextYear, nextMonth, syntheticDay, 12); // LOCAL noon, never a UTC-midnight literal
    const synthetic = {
      ...template,
      id: syntheticId,
      start_date: start.toISOString(),
      ...('end_date' in template ? { end_date: new Date(start.getTime() + 2 * 3600_000).toISOString() } : {}),
      Game: { ...((template.Game as object | null | undefined) ?? {}), name: O4B_GAME },
      Group: { ...group, background_image_url: null },
    };
    rewrites += 1;
    await route.fulfill({ response, json: [...real, synthetic] });
  });

  try {
    await page.goto('/');
    await assertTheme(page, theme);
    const wanted = `${O4B_MONTHS[month]} ${year}`;
    const heading = page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ });
    await expect(heading, `O4b (${theme}): the home full grid's month heading is not visible`).toBeVisible({ timeout: 20_000 });
    // A stored calendar preference can reopen another month; Go to Today brings the grid to the month
    // the route handler built against.
    if ((await heading.textContent())?.trim() !== wanted) {
      await page.getByRole('button', { name: 'Go to Today', exact: true }).click();
    }
    await expect(heading, `O4b (${theme}): the home full grid is not on ${wanted}`).toHaveText(wanted);
    expect(seedError, `O4b (${theme}): ${seedError}`).toBe('');
    expect(rewrites, `O4b (${theme}): the route handler never answered the home events GET with an array`).toBeGreaterThan(0);

    // DECISION Phase 88.9-04 (O4b grid): the trailing cells are found by STRUCTURE — the one element
    // under the month card with exactly 42 children (the calendarUtils grid) — chosen OVER a Tailwind
    // class locator (SELECTOR POLICY above) and over day-number names alone: the home grid passes no
    // onEmptyDayClick, so an empty or one-event day number has NO accessible name to find it by.
    const card = heading.locator('xpath=ancestor::*[.//div[count(*)=42]][1]');
    const grid = card.locator('xpath=.//div[count(*)=42]');
    await expect(grid, `O4b (${theme}): no 42-cell month grid under the home calendar heading`).toHaveCount(1);
    const cellOf = (day: number): Locator => grid.locator('xpath=./*').nth(42 - trailing + day - 1);

    // The tile, located by its role=button name, which begins with the fixed game name
    // (src/app/components/CalendarMonthView.js ("const tileLabel =")).
    const tile = cellOf(syntheticDay).getByRole('button', { name: new RegExp(`^${O4B_GAME} - `) });
    await expect(
      tile,
      `O4b (${theme}): no seeded tile in the trailing cell for ${O4B_MONTHS[nextMonth]} ${syntheticDay} — the seed did not reach the cell, so the adjacent-month event tile text through ancestor opacity read has nothing to measure; fix the route, never delete this guard`
    ).toBeVisible({ timeout: 15_000 });

    // Two OTHER trailing days: a one-event day loses its day-number name, so each is found by name
    // when it has one and by its text otherwise:
    // src/app/components/CalendarMonthView.js ("const dayTargetActive = cellClickable && dayEvents.length !== 1;").
    const days = Array.from({ length: trailing }, (_, i) => i + 1).filter((d) => d !== syntheticDay).slice(0, 2);
    expect(days.length, `O4b (${theme}): fewer than two trailing next-month days besides the seeded one`).toBe(2);
    const next = O4B_MONTHS[nextMonth];
    const numbers: { day: number; el: Locator }[] = [];
    for (const day of days) {
      const named = cellOf(day).getByRole('button', { name: new RegExp(`^${next} ${day}\\b`) });
      const el = (await named.count()) > 0 ? named.first() : cellOf(day).getByText(String(day), { exact: true }).first();
      await expect(el, `O4b (${theme}): the trailing day number ${next} ${day} is not on the grid`).toBeVisible();
      await expect(el).toHaveText(String(day));
      numbers.push({ day, el });
    }

    // Every read is taken BEFORE any assertion, so the tile's measured value reaches the CI log even
    // though the first failing expect below is the day number's opacity.
    const reads: { label: string; r: Awaited<ReturnType<typeof inkRatioThroughOpacity>> }[] = [];
    for (const { day, el } of numbers) {
      const label = `O4b (${theme}) adjacent-month day number ${next} ${day}`;
      reads.push({ label, r: await inkRatioThroughOpacity(el, label) });
    }
    const tileLabel = `O4b (${theme}) adjacent-month event tile text through ancestor opacity`;
    const tileRead = await inkRatioThroughOpacity(tile.getByText(O4B_GAME, { exact: true }), tileLabel);
    // eslint-disable-next-line no-console -- the measured tile value is recorded from the CI log
    console.log(`${tileLabel}: ${tileRead.ratio.toFixed(3)}:1, opacity product ${tileRead.opacity} (ink ${tileRead.effectiveFg} on ${tileRead.ground})`);

    for (const { label, r } of reads) {
      expect(r.opacity, `${label}: ancestor opacity product ${r.opacity} — the day number must not sit under a dimmed ancestor (A4b takes the whole-cell opacity-60 off it)`).toBe(1);
      expect(r.ratio, `${label}: ${r.ratio.toFixed(2)}:1 through ancestor opacity ${r.opacity} (ink ${r.effectiveFg} on ${r.ground}), floor ${O4B_FLOOR}:1`).toBeGreaterThanOrEqual(O4B_FLOOR);
    }
    // The tile's own opacity is not asserted (its hover rule is its own); its ink through every ancestor is.
    expect(tileRead.ratio, `${tileLabel}: ${tileRead.ratio.toFixed(2)}:1 through ancestor opacity product ${tileRead.opacity} (ink ${tileRead.effectiveFg} on ${tileRead.ground}), floor ${O4B_FLOOR}:1`).toBeGreaterThanOrEqual(O4B_FLOOR);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
}

test.describe('adjacent-month ink on the home full grid at 1280, dark (88.9 O4b)', () => {
  test('O4b (88.9): adjacent-month day numbers on the home full grid are undimmed and clear 4.5:1, dark', async ({ page }) => {
    await adjacentHomeInk(page, 'dark');
  });
});

test.describe('adjacent-month ink on the home full grid at 1280, light (88.9 O4b)', () => {
  // Both projects bake dark; colorScheme alone does not set the class, so forceLightMode writes the
  // stored theme before the first navigation and assertTheme proves it after (inside the helper).
  test.use({ colorScheme: 'light' });
  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
  });

  test('O4b (88.9): adjacent-month day numbers on the home full grid are undimmed and clear 4.5:1, light', async ({ page }) => {
    await adjacentHomeInk(page, 'light');
  });
});

/* =========================================================================================
 * Phase 88.9 code review d1 / d3 — the UNDER-32 fallback glyph, MEASURED (SPEC R3 / AC-5).
 *
 * The FULL tile mounts a 16px SafeImage avatar for a group whose profile_picture_url starts
 * with http or a slash (src/app/components/CalendarMonthView.js ("w-4 h-4 rounded-full object-cover border border-line")).
 * Every such URL passes the allow-list, so the fallback is reachable here ONLY through the
 * img onError path: a dead picture URL. The register row closed this case from 48px and 32px
 * boxes and said the under-32 box was not exercised; this test exercises it. The glyph span
 * must lie inside the 16px box, and both boxes are printed in the assertion message so the
 * record carries the numbers.
 *
 * DECISION Phase 88.9-CR d3: the dead URL is an https URL on the reserved .invalid TLD whose
 * request is ABORTED by the route, chosen OVER reusing REJECTED_URL above: a javascript: value
 * fails the http-or-slash test at the call site, takes the plain text branch and never mounts
 * SafeImage, so it would measure nothing. Same GET-only render-data seed as the scenarios
 * above (no database write), for the same reasons.
 * ======================================================================================= */

const BROKEN_AVATAR_URL = 'https://e2e.invalid/broken-avatar.png';

test.describe('the 16px group avatar fallback on the FULL month tile (88.9-CR d1)', () => {
  test('d1 (88.9-CR): a dead group picture URL falls back to a glyph that stays inside the 16px avatar box at 1280', async ({ page }) => {
    await page.route('https://e2e.invalid/**', (route) => route.abort());
    const seed: { event: FixtureEvent | null } = { event: null };
    await page.route('**/api/events/user/**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await scrubbedFetch(route);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      if (!Array.isArray(body) || body.length === 0) {
        await route.fulfill({ response, json: body });
        return;
      }
      const events = body as FixtureEvent[];
      const target = events.find((e) => e.Group) ?? null;
      if (target?.Group) {
        for (const e of events) {
          if (e.Group && e.Group.id === target.Group.id) {
            e.Group = { ...e.Group, profile_picture_url: BROKEN_AVATAR_URL };
          }
        }
        seed.event = target;
      }
      await route.fulfill({ response, json: events });
    });

    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible({ timeout: 20_000 });
      expect(seed.event, 'the events intercept found no event with a Group to carry the dead picture URL; nothing below is measured').not.toBeNull();
      const tile = await tileFor(page, seed.event as FixtureEvent);

      // The fallback is the div with role=img and the avatar's w-4 box (SafeImage passes the
      // call site's className onto it). A class read here is the one exception to the selector
      // policy: the box size IS the subject.
      const box = tile.locator('[role="img"].w-4');
      await expect(box, 'the avatar did not fall back: no role=img w-4 box on the tile after the aborted picture load').toHaveCount(1);
      const glyph = box.locator('span');
      await expect(glyph).toHaveCount(1);

      const outer = await box.boundingBox();
      const inner = await glyph.boundingBox();
      expect(outer, 'the fallback box has no layout box').not.toBeNull();
      expect(inner, 'the fallback glyph has no layout box').not.toBeNull();
      const o = outer!;
      const i = inner!;
      const fmt = (b: { x: number; y: number; width: number; height: number }) =>
        `x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} w=${b.width.toFixed(2)} h=${b.height.toFixed(2)}`;
      const record = `box ${fmt(o)}; glyph ${fmt(i)}`;
      // eslint-disable-next-line no-console -- the measured boxes are recorded from the CI log
      console.log(`d1 16px avatar fallback: ${record}`);
      const tol = 0.5;
      const inside =
        i.x >= o.x - tol &&
        i.y >= o.y - tol &&
        i.x + i.width <= o.x + o.width + tol &&
        i.y + i.height <= o.y + o.height + tol;
      expect(inside, `d1: the fallback glyph overflows the 16px avatar box (${record}, tolerance ${tol}px)`).toBe(true);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

/* =========================================================================================
 * Phase 88.9-21 — D5a / O18a: the guest edge on the FULL month tile at 1280.
 *
 * The owner pick (UI-SPEC row R2-27) marks a tile the viewer joins as a GUEST with a dashed
 * edge. The pin measures what renders: the edge colour, composited with its own alpha onto
 * the tile's ground, against BOTH the tile's own ground and the cell just outside the tile,
 * at 3:1 on the unrounded value, in dark and light, on an uncoloured (transparent) tile and a
 * tinted one. A quoted number is never the oracle: O18a amber-600 is 3.19 on the old card-white
 * cell but 2.5680 on the C3 tile ground (research Pitfall 10). A member tile carries no dash.
 * ======================================================================================= */

const D5A_FLOOR = 3;
const D5A_GUEST_PLAIN = 'E2E Guest Plain';
const D5A_GUEST_TINTED = 'E2E Guest Tinted';
const D5A_MEMBER = 'E2E Member Control';

interface GuestTiles {
  plain: FixtureEvent;
  tinted: FixtureEvent;
  member: FixtureEvent;
}

function d5aLabel(event: FixtureEvent): string {
  return `${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Group'}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// DECISION Phase 88.9-21 D5a/O18a: the guest tiles are synthetic events planted in the browser copy of the events response, chosen over a seeded guest participation — the seed holds none, a scratch insert is barred, and the plain + tinted pair is the outline's O18a measurement; the viewer id comes from the request path and is never printed.
async function seedGuestTiles(page: Page): Promise<() => GuestTiles> {
  const ids = { plain: crypto.randomUUID(), tinted: crypto.randomUUID(), member: crypto.randomUUID() };
  const groupIds = { plain: crypto.randomUUID(), tinted: crypto.randomUUID(), member: crypto.randomUUID() };
  let planted: GuestTiles | null = null;
  let seedError = '';
  let rewrites = 0;

  // GET-only, the real response through scrubbedFetch (never a raw route fetch), three synthetic
  // events appended in the browser copy. No write is made.
  await page.route('**/api/events/user/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const segments = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const viewer = decodeURIComponent(segments[segments.length - 1] ?? '');
    const response = await scrubbedFetch(route);
    let real: unknown;
    try {
      real = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    if (!Array.isArray(real) || real.length === 0 || viewer.length === 0) {
      seedError = 'the events GET carried no array of real events (or no viewer segment) to copy a tile shape from';
      await route.fulfill({ response, json: real });
      return;
    }
    const now = new Date();
    const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const month = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    // DATE-PROOF (the 88.9-04 rule): the three days are computed from THIS response, bucketed by
    // LOCAL date the way the grid does, so no real event shares a synthetic tile's cell.
    const occupied = new Set<number>();
    for (const e of real as { start_date?: string }[]) {
      if (!e.start_date) continue;
      const d = new Date(e.start_date);
      if (d.getFullYear() === year && d.getMonth() === month) occupied.add(d.getDate());
    }
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const free: number[] = [];
    for (let d = 8; d <= daysInMonth && free.length < 3; d += 1) {
      if (!occupied.has(d)) free.push(d);
    }
    if (free.length < 3) {
      seedError = `fewer than three days at or after the 8th of next month hold no real event (${free.length} free)`;
      await route.fulfill({ response, json: real });
      return;
    }
    const template = (real[0] ?? {}) as Record<string, unknown>;
    const group = (template.Group as Record<string, unknown> | null | undefined) ?? {};
    const make = (
      id: string,
      day: number,
      name: string,
      groupId: string,
      colours: { color_preset: string | null; background_color: string | null },
      participations: { user_id: string; is_guest: boolean }[]
    ): FixtureEvent => {
      const start = new Date(year, month, day, 12); // LOCAL noon, never a UTC-midnight literal
      return {
        ...template,
        id,
        start_date: start.toISOString(),
        ...('end_date' in template ? { end_date: new Date(start.getTime() + 2 * 3600_000).toISOString() } : {}),
        Game: { ...((template.Game as object | null | undefined) ?? {}), name },
        Group: {
          ...group,
          id: groupId,
          name: `${name} Group`,
          ...colours,
          background_image_url: null,
          profile_picture_url: null,
        },
        EventParticipations: participations,
      } as FixtureEvent;
    };
    const plain = make(ids.plain, free[0], D5A_GUEST_PLAIN, groupIds.plain, { color_preset: null, background_color: null }, [{ user_id: viewer, is_guest: true }]);
    // The coloured fixture's values, e2e/contrast.spec.ts ("background_color:'#172554'").
    const tinted = make(ids.tinted, free[1], D5A_GUEST_TINTED, groupIds.tinted, { color_preset: 'blue', background_color: '#172554' }, [{ user_id: viewer, is_guest: true }]);
    const member = make(ids.member, free[2], D5A_MEMBER, groupIds.member, { color_preset: null, background_color: null }, [{ user_id: viewer, is_guest: false }]);
    planted = { plain, tinted, member };
    rewrites += 1;
    await route.fulfill({ response, json: [...real, plain, tinted, member] });
  });

  return () => {
    if (rewrites === 0 || !planted) {
      throw new Error(
        `D5a/O18a fixture: the events intercept never planted the guest tiles (rewrites=${rewrites})` +
          (seedError ? ` — ${seedError}` : ' — the month view did not fetch the events list') +
          '; nothing below is measured'
      );
    }
    return planted;
  };
}

interface EdgeRead {
  style: string;
  width: number;
  edge: string;
  tileGround: string;
  cellGround: string;
  onTile: number;
  onCell: number;
}

async function readGuestEdge(tile: Locator, label: string): Promise<EdgeRead> {
  const [style, widthRaw] = await tile.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.getPropertyValue('border-top-style'), cs.getPropertyValue('border-top-width')];
  });
  const probe = await probeElement(tile, ['border-top-color']);
  const edgeColour = probe.computed['border-top-color'];
  const tileGround = compositeGround(probe, 0);
  // The tinted tile paints its own opaque ground, so its walk stops at index 0 and
  // compositeGround(probe, 1) is null: the cell is read from the parent's own walk, the
  // haloGroundRatio move (e2e/support/contrast.ts ("const parent = await probeElement(anchor.locator('xpath=..'), []);")).
  const cellGround = compositeGround(await probeElement(tile.locator('xpath=..'), []), 0);
  if (tileGround === null || cellGround === null) {
    throw new Error(
      `${label}: fixture — no opaque ground (tile ${tileGround ?? 'null'}, cell ${cellGround ?? 'null'}); nothing is measured`
    );
  }
  if (!edgeColour || edgeColour.css === null || edgeColour.alpha === null) {
    throw new Error(`${label}: the edge colour did not normalise (raw ${JSON.stringify(edgeColour?.raw ?? '')})`);
  }
  const edge = blend(edgeColour.css, edgeColour.alpha, tileGround);
  if (!edge) throw new Error(`${label}: could not blend the edge ${edgeColour.css} onto ${tileGround}`);
  const onTile = contrastRatio(edge, tileGround);
  const onCell = contrastRatio(edge, cellGround);
  if (onTile === null || onCell === null) throw new Error(`${label}: could not compute a ratio for edge ${edge}`);
  return { style, width: Number.parseFloat(widthRaw) || 0, edge, tileGround, cellGround, onTile, onCell };
}

async function measureGuestTiles(page: Page, read: () => GuestTiles, theme: 'light' | 'dark'): Promise<void> {
  await page.goto('/');
  await assertTheme(page, theme);
  await expect(page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible({ timeout: 20_000 });
  const { plain, tinted, member } = read();

  for (const [kind, event] of [['plain', plain], ['tinted', tinted]] as const) {
    const label = d5aLabel(event);
    const tile = await tileFor(page, event, new RegExp(`^${escapeRegExp(label)}(, Guest)?$`));
    const tag = `D5a/O18a (${theme}, ${kind} guest tile)`;
    const m = await readGuestEdge(tile, tag);
    const record = `edge ${m.edge} on tile ${m.tileGround} ${m.onTile.toFixed(3)}:1, on cell ${m.cellGround} ${m.onCell.toFixed(3)}:1`;
    // eslint-disable-next-line no-console -- the measured edge is recorded from the CI log
    console.log(`${tag}: style ${m.style}, width ${m.width}px, ${record}`);
    expect(m.style, `${tag}: the guest tile's top edge is ${m.style}, not dashed`).toBe('dashed');
    expect(m.width, `${tag}: the dashed edge is ${m.width}px wide, under 1px`).toBeGreaterThanOrEqual(1);
    expect(m.onTile, `${tag}: ${record}; floor ${D5A_FLOOR}:1 against the tile`).toBeGreaterThanOrEqual(D5A_FLOOR);
    expect(m.onCell, `${tag}: ${record}; floor ${D5A_FLOOR}:1 against the cell`).toBeGreaterThanOrEqual(D5A_FLOOR);
    await expect(tile).toHaveAccessibleName(`${label}, Guest`);
  }

  const memberLabel = d5aLabel(member);
  const memberTile = await tileFor(page, member);
  await expect(memberTile).toHaveAccessibleName(memberLabel);
  const memberStyle = await memberTile.evaluate((el) => getComputedStyle(el).getPropertyValue('border-top-style'));
  expect(memberStyle, `D5a/O18a (${theme}): a member tile carries a dashed edge`).not.toBe('dashed');
}

test.describe('the guest edge on the FULL month tile at 1280 (88.9 D5a / O18a)', () => {
  test('D5a/O18a (88.9): a guest event\'s full month tile carries a dashed edge that clears 3:1 against the tile and the cell, dark and light, plain and tinted', async ({ page }) => {
    const read = await seedGuestTiles(page);
    try {
      await measureGuestTiles(page, read, 'dark');
      await forceLightMode(page);
      await measureGuestTiles(page, read, 'light');
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});

test.describe('the image-backed FULL month tile, light (88.9 F7a)', () => {
  // Both projects bake dark; colorScheme alone does not set the class (the O4b light idiom above).
  test.use({ colorScheme: 'light' });
  test.beforeEach(async ({ page }) => {
    await forceLightMode(page);
  });

  test('F7a (88.9): an image tile\'s light arm has no shadow and no stroke; the dark arm keeps STROKE_DARK', async ({ page, baseURL }) => {
    const allowedUrl = new URL('/bgg-logo.png', baseURL ?? 'http://localhost:3000').href;
    const read = await seedGroupImage(page, allowedUrl);
    try {
      await page.goto('/');
      await assertTheme(page, 'light');
      await expect(page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible({ timeout: 20_000 });
      const { event } = read();
      const tile = await tileFor(page, event);

      // Anti-vacuity: the image branch is the one under test.
      const vars = await tileVars(tile);
      expect(vars.bgImage, 'F7a: the tile paints no background-image — the image branch is not under test').toContain('bgg-logo.png');
      expect(await overlayCount(tile, IMAGE_OVERLAY_RGBA), 'F7a: the 0.7 white image overlay did not mount').toBe(1);

      const [shadow, strokeWidth] = await gameName(tile, event).evaluate((el) => {
        const cs = getComputedStyle(el);
        return [cs.getPropertyValue('text-shadow'), cs.getPropertyValue('-webkit-text-stroke-width')];
      });
      expect(shadow, 'F7a (light): the image tile game name still carries a text shadow').toBe('none');
      expect(strokeWidth, 'F7a (light): the image tile game name still carries a text stroke').toBe('0px');
      expect(vars.stroke, 'F7a: --t-stroke (dark arm) is not colorUtils.js STROKE_DARK').toBe(strokeDarkFromSource());
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
