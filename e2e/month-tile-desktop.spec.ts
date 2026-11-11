import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect, type Locator, type Page } from '@playwright/test';
import { scrubbedFetch } from './support/scrubbedFetch';
import { assertTheme, forceLightMode, inkRatioThroughOpacity } from './support/contrast';

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

/**
 * `colorUtils.js`'s white-is-unset rule is module-private too, so its pattern is READ FROM THE
 * SOURCE the same way: src/lib/colorUtils.js ("const UNSET_BACKGROUND_PATTERN = "). Every seeded
 * group stores background_color '#ffffff' (the backend model default), which the app renders as NO
 * colour, so a plain truthiness test calls every seeded group coloured.
 */
function unsetBackgroundFromSource(): RegExp {
  const src = readFileSync(resolve(__dirname, '../src/lib/colorUtils.js'), 'utf8');
  const m = src.match(/const UNSET_BACKGROUND_PATTERN = \/(.+)\/([a-z]*);/);
  if (!m) throw new Error('colorUtils.js no longer declares `const UNSET_BACKGROUND_PATTERN = /…/` — re-derive this spec');
  return new RegExp(m[1], m[2]);
}

type GroupColours = { color_preset?: string | null; background_color?: string | null };
type Participation = { user_id?: string | null; is_guest?: boolean | null };
type PlainCandidate = {
  status?: string | null;
  Group?: GroupColours | null;
  EventParticipations?: readonly Participation[] | null;
};

/**
 * TRUE when the app renders this group with no colour of its own: no preset, and a stored
 * background_color that is null, empty, or the white sentinel.
 */
function isUncolouredGroup(group: GroupColours | null | undefined): boolean {
  if (!group || group.color_preset != null) return false;
  const bg = typeof group.background_color === 'string' ? group.background_color.trim() : group.background_color;
  return bg == null || bg === '' || unsetBackgroundFromSource().test(bg);
}

/**
 * The viewer's User.id: the last path segment of the events GET (/events/user/<id>). Compared in
 * memory only, never printed.
 */
function viewerFromEventsUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(segments[segments.length - 1] ?? '');
}

/**
 * A real event a tile may be measured on or copy its shape from: a scheduled night, on an
 * uncoloured group, that the viewer does not join as a guest. The guest rule is the one the upcoming
 * list's Guest pill reads: the viewer's own participation, matched on User.id, with is_guest strictly
 * true. An unread viewer (empty) counts ANY guest row, so an unknown viewer never admits a guest night.
 */
function isPlainScheduled(e: PlainCandidate, viewer: string): boolean {
  if (e.status !== 'scheduled' || !e.Group || !isUncolouredGroup(e.Group)) return false;
  const participations = Array.isArray(e.EventParticipations) ? e.EventParticipations : [];
  return !participations.some((p) => p.is_guest === true && (viewer === '' || p.user_id === viewer));
}

// DECISION Phase 88.9 (quick 261110-ugi H-1): every synthetic tile below copies its shape from the
// first plain scheduled event (isPlainScheduled), chosen OVER the positional real[0], which is the
// NEWEST event the viewer can see (the events GET orders by start_date DESC) and so silently takes
// on whatever group and status the seed last added: a green group and a completed status after
// BE PR 70. No such event is a fixture error, never a fallback.
// DECISION Phase 88.9 (quick 261110-ugi S-2): the guest rule is restated in isPlainScheduled, chosen
// OVER importing isGuestEvent, because this picker also lands on FE main, where that module does not
// exist yet, and both copies must stay textually identical so the phase merge is clean. Every
// synthetic tile also sets its own EventParticipations (an empty list, unless it is a guest tile on
// purpose), so a drift between the two rules can move only the real Scenario A/B target.
function plainScheduledTemplate(real: unknown[], viewer: string): Record<string, unknown> | null {
  const found = (real as PlainCandidate[]).find((e) => isPlainScheduled(e, viewer));
  return (found as Record<string, unknown> | undefined) ?? null;
}

interface FixtureEvent {
  id: string;
  start_date: string;
  status?: string | null;
  EventParticipations?: Participation[] | null;
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
  let seedError = '';
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
    const viewer = viewerFromEventsUrl(route.request().url());
    // DECISION Phase 88.9 (quick 261110-ugi H-1): the target is FOUND by predicate (a plain
    // scheduled night, isPlainScheduled, still to come, and one of the two tiles its day cell
    // renders), and none is a thrown fixture error, chosen OVER the old positional events[0]
    // fallback. Every seeded group stores background_color '#ffffff', so the old truthiness find
    // never matched and events[0], the NEWEST event, was measured whatever its colour; when BE PR 70
    // made the newest event a green Strategy Squad night, Scenario B read a green tile's shadow.
    // Upcoming because tileFor walks forward only; the two-tile rule because the cell renders
    // dayEvents.slice(0, 2) in payload order (src/app/components/CalendarMonthView.js ("{dayEvents.slice(0, 2).map(event => {")).
    const nowMs = Date.now();
    const dayKey = (iso: string): string => {
      const d = new Date(iso); // LOCAL date, the grid's bucketing; runner and browser share the host timezone
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const rendered = new Set<FixtureEvent>();
    const perDay = new Map<string, number>();
    for (const e of events) {
      if (!e.start_date) continue;
      const k = dayKey(e.start_date);
      const n = perDay.get(k) ?? 0;
      if (n < 2) rendered.add(e);
      perDay.set(k, n + 1);
    }
    const candidates = events.filter(
      (e) => isPlainScheduled(e, viewer) && new Date(e.start_date).getTime() >= nowMs && rendered.has(e)
    );
    const target = candidates.reduce<FixtureEvent | null>(
      (best, e) => (!best || new Date(e.start_date).getTime() < new Date(best.start_date).getTime() ? e : best),
      null
    );
    if (!target) {
      seedError =
        `no upcoming scheduled event on an uncoloured group, that the viewer is not a guest on, renders as a tile (${events.length} events in the payload) — ` +
        'the plain treatment has nothing to be measured on; fix the seed, never fall back to a coloured event';
      await route.fulfill({ response, json: events });
      return;
    }
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
    if (seedError) throw new Error(`the image fixture found no target: ${seedError}; nothing below is measured`);
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
  // The FULL month view's own heading (src/app/components/CalendarMonthView.js ("{monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}")). Bounded walk: the fixture
  // events sit +3/+4 days from the run (backend:Sonnet/scripts/e2e-fixtures.js ("start_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),"), backend:Sonnet/scripts/e2e-fixtures.js ("const [eventPhone] = await Event.findOrCreate({")), so at most ONE step.
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
    // Shape copied from a real plain scheduled event (plainScheduledTemplate), so the tile measured
    // is an UNCOLOURED one, the case this read has measured since 88.9-04; the group carries NO
    // background image, because an image-backed full tile keeps the owner-ruled white/stroke
    // treatment over a photo, which a colour ratio cannot measure. It carries NO participations
    // either, so it is a member tile whatever guest rows the template held.
    const template = plainScheduledTemplate(real, viewerFromEventsUrl(route.request().url()));
    if (!template) {
      seedError = 'the events GET holds no scheduled event on an uncoloured group, not a guest night for the viewer, to copy a tile shape from';
      await route.fulfill({ response, json: real });
      return;
    }
    const group = template.Group as Record<string, unknown>;
    const start = new Date(nextYear, nextMonth, syntheticDay, 12); // LOCAL noon, never a UTC-midnight literal
    const synthetic = {
      ...template,
      id: syntheticId,
      start_date: start.toISOString(),
      ...('end_date' in template ? { end_date: new Date(start.getTime() + 2 * 3600_000).toISOString() } : {}),
      Game: { ...((template.Game as object | null | undefined) ?? {}), name: O4B_GAME },
      Group: { ...group, background_image_url: null },
      EventParticipations: [],
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
