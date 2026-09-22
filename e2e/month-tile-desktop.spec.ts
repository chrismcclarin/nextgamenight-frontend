import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect, type Locator, type Page } from '@playwright/test';

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
 * `hidden md:flex` column (`:492`); the phone sheet renders the COMPACT variant, which passes
 * `hasBackgroundImage: false` at the call site (`CalendarMonthView.js:573`) and paints no image.
 * So this spec runs in the `journeys` project (1280 x 720, `playwright.config.ts:64`) and skips
 * in `phone` — the SAME runtime-skip shape as `contrast.spec.ts:96`, inverted. There is NO
 * project named `desktop` (`88.6-VALIDATION.md` already corrects the plan's `--project=desktop`
 * to `--project=journeys`).
 *
 * ---------------------------------------------------------------------------------------
 * THIS SPEC CANNOT BE RUN ON A LAPTOP, BY DESIGN.
 * ---------------------------------------------------------------------------------------
 * `.auth/user.json` comes from the `setup` project against real Auth0 and the credentials are
 * deliberately absent locally (`playwright.config.ts:22-24`). Local proofs: `--list` collects
 * exactly the two tests below in `journeys` (and two runtime-skipped in `phone`), and
 * `npx tsc --noEmit -p tsconfig.e2e.json` compiles it. CI is the only place it REPORTS.
 *
 * ---------------------------------------------------------------------------------------
 * HOW THE IMAGE URL REACHES THE TILE — a render-data seed, NOT a database write.
 * ---------------------------------------------------------------------------------------
 * DECISION Phase 88.6-45 (task 3 seeding): BOTH scenarios plant `background_image_url` by
 * rewriting the SAME payload the month view fetches — the BFF-proxied
 * `GET /api/events/user/<uuid>` response, whose nested `Group` carries the key
 * (`routes/events.js:331-334`, `attributes: [... 'background_image_url']`) — chosen OVER the
 * plan's two named carriers: the authenticated `PUT /groups/:id/settings` path for the allowed
 * URL and the backend fixture minter for the rejected one.
 *
 * WHY, and it is CONSEQUENCE, not convenience. (1) Every fixture group is SHARED with the
 * `phone` project, whose `contrast.spec.ts` pins the rendered ground of `E2E_GROUP_ID`,
 * `E2E_COLOURED_GROUP_ID` and `E2E_PRESET_ONLY_GROUP_ID` — and the two projects are scheduled
 * across the same worker pool (`fullyParallel: false` is per-FILE, `workers` is unset), so a
 * database write here can land in the middle of a phone-lane measurement and red a sibling
 * gate. (2) The rejected value CANNOT pass `validateGroupUpdate` at all
 * (`middleware/validators.js:161-179`, `^https?:\/\/.+`), so the plan's own carrier for it is
 * a BACKEND edit to `scripts/e2e-fixtures.js` — a cross-repo change this plan's dispatch
 * forbade, and one whose merge deploys production. (3) The subject under test is the RENDER
 * PATH: `CalendarMonthView.js:523` reads `event.Group?.background_image_url` off this exact
 * JSON and hands it to `safeBgImageStyle` (`:560`); a value planted in the response is
 * byte-indistinguishable to that path from one read out of Postgres. What this does NOT
 * exercise is the write-side validator — which is the backend's own unit-tested contract, not
 * this spec's subject. Recorded in `88.6-45-SUMMARY.md` as a deviation with both arms.
 * Reverting either scenario to a database seed is a decision, not a cleanup.
 *
 * SELECTOR POLICY (`padding-budget.spec.ts:50-51`): role, label and ARIA state only. The tile is
 * `role="button"` with `aria-label="<game> - <group>"` (`CalendarMonthView.js:719`); the
 * overlay is found by its computed colour, never a class.
 */

test.skip(
  ({ isMobile }) => isMobile,
  'AC-7 second half: the image-backed FULL month tile renders only at >= 768px (UserHomePage.js:492 `hidden md:flex`), so this spec runs only in the journeys project'
);

/** The FSEC-03 motivating case, verbatim from `safeBgImageStyle.ts:29`. */
const REJECTED_URL = 'javascript:alert(1)';

/** The overlay `CalendarMonthView.js:1122` paints ONLY when `hasValidBgImage` is true. */
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
 * ground is null, so the plain treatment is `{}` (`tileTextTreatment`, `CalendarMonthView.js:136`)
 * and the two scenarios are separable by the stroke ALONE — a dark stored colour would also
 * resolve to `STROKE_DARK` on the plain path (`:143`) and blur the comparison.
 */
async function seedGroupImage(page: Page, url: string): Promise<() => Seeded> {
  let seeded: FixtureEvent | null = null;
  let rewrites = 0;
  await page.route('**/api/events/user/**', async (route) => {
    const response = await route.fetch();
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

/** Walk the month view to the month that holds `iso`, then return the tile for `event`. */
async function tileFor(page: Page, event: FixtureEvent): Promise<Locator> {
  const start = new Date(event.start_date);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const wanted = `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
  // The FULL month view's own heading (`CalendarMonthView.js:209-211`). Bounded walk: the fixture
  // events sit +3/+4 days from the run (`e2e-fixtures.js:119`, `:349`), so at most ONE step.
  const heading = page.getByRole('heading', { level: 3, name: /^[A-Z][a-z]+ \d{4}$/ });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  for (let step = 0; step < 2 && (await heading.textContent())?.trim() !== wanted; step += 1) {
    await page.getByRole('button', { name: /Next/ }).click();
  }
  await expect(heading, `the month view did not reach ${wanted}`).toHaveText(wanted);

  const label = `${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Group'}`;
  const tile = page.getByRole('button', { name: label, exact: true }).first();
  await expect(tile, `no FULL-variant tile labelled ${JSON.stringify(label)} is visible at 1280px`).toBeVisible();
  return tile;
}

/** The game-name span — the ONLY element the stroke/shadow utilities are declared on (`:1151`). */
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
    // allow-list checks (`safeBgImageStyle.ts:12`), and this is it.
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
      expect(await overlayCount(tile, IMAGE_OVERLAY_RGBA), 'the image overlay (CalendarMonthView.js:1122) is gated on hasValidBgImage and did not mount').toBe(1);
    });

    await test.step('the --t-stroke pair carries STROKE_DARK on both theme arms, and the declaration is LIVE on the text', async () => {
      const strokeDark = strokeDarkFromSource();
      const vars = await tileVars(tile);
      expect(vars.stroke, '--t-stroke (dark arm) is not colorUtils.js STROKE_DARK').toBe(strokeDark);
      expect(vars.strokeL, '--t-stroke-l (light arm) is not colorUtils.js STROKE_DARK').toBe(strokeDark);
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
      await heading.locator('xpath=ancestor::div[contains(@class, "card")][1]').screenshot({ path: gridPath }).catch(async () => {
        await page.screenshot({ path: gridPath });
      });
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
      // themedTextStyleVars fills both arms with `none` (`colorUtils.js:672-677`).
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
