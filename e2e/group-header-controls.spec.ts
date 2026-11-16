import { test, expect, type Locator, type Page } from '@playwright/test';
import { assertTheme, compositeGround, contrastRatio, deltaLStar, forceLightMode, lStar, probeElement } from './support/contrast';
import { E2E_GROUP_ID } from './support/groupSettings';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';
import { scrubbedFetch } from './support/scrubbedFetch';

// Plan 88.9-64 (owner fix rows 52-X9, 52-X30 and the direction ruling of 52-X31): what the group
// header's Manage Members button paints at rest and under the pointer, read as computed style in a
// real browser. jsdom applies no hover and no cascade, so this plan's class pins in the group page
// identity suite and its token arithmetic in the token contrast suite (both titled X30) cannot see
// which rule wins when two hover classes meet, nor what a translucent fill composites to.
//
// WHAT EACH TEST READS. The button's fill and label colour with the mouse parked in the page corner,
// then again with the mouse on the button, each after the button's running transitions have
// finished. On a photo header the resting fill must be fully opaque (X9: over a white photo a
// translucent white fill left only a hairline to say there was a button). On a header with no photo
// the fill is translucent by design, so it is composited over the header ground before it is
// measured. The two reads must differ by at least 4.0 in L* (the smallest surface step this app
// pins as visible, src/app/tokenContrast.test.ts ("floor 4.00 (one full ladder step)")), the label
// must clear 4.5:1 on both (WCAG 1.4.3), and the step goes the way the owner ruled: darker in
// light, lighter in dark.
//
// STAGING. The group record's read is passed through to the real server and only its picture field
// is replaced on the way back: a 1x1 white picture on a reserved .invalid host that this spec
// answers itself (white is the worst case for the old fill), or no picture. The group's stored
// colour is left as seeded and named in every message. Nothing is pressed in the hover tests;
// writes are held in the browser and the afterEach fails the test if an /api write reached the hold.
// Nothing is screenshotted; messages carry colours and ratios only.
//
// DECISION Phase 88.9-64 (X30 e2e): the four hover reads run in the desktop journeys project only,
// chosen OVER a phone arm. The hover rule sits behind a hover-capable-pointer media query, so on a
// phone it never applies and there is nothing to read; the journeys floors row for this spec keeps
// the four runs from being zeroed silently. Changing this is a decision, not a cleanup.
//
// Plan 88.9-69 (88.9-64 hand-off d) adds two reads of the group settings gear in the same describe
// and on the same no-photo staging: the gear's fill at rest and under the pointer, and its icon
// against the hovered fill. The icon is a graphic, so its floor is 3:1 (WCAG 1.4.11), not the
// label's 4.5:1.

type Theme = 'light' | 'dark';

const HOVER_STEP_FLOOR = 4.0;
const LABEL_FLOOR = 4.5;
const ICON_FLOOR = 3.0;
const PHOTO_URL = 'https://e2e-x64.invalid/white-photo.png';
// A 1x1 opaque white PNG (69 bytes).
const WHITE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

let hold: WriteHold | undefined;

test.afterEach(async ({ page }) => {
  expectNoApiWrites(hold);
  hold = undefined;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

function isGroupDetailRead(url: URL): boolean {
  return url.pathname.endsWith(`/groups/${E2E_GROUP_ID}`);
}

interface StagedHeader {
  /** The group's stored colour fields as the server returned them, for messages. */
  stored: () => string;
  photoRequests: () => number;
}

// One route over the group record's read: the picture field is set to the staged value (a URL or
// null) and the stored colour fields are captured. A second route answers the staged picture.
async function stageHeader(page: Page, picture: string | null): Promise<StagedHeader> {
  let stored = 'the group record was never read';
  let photoRequests = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (String(record.id) === E2E_GROUP_ID && 'name' in record) {
      stored = `stored colour ${JSON.stringify(record.background_color ?? null)}, preset ${JSON.stringify(record.color_preset ?? null)}`;
      record.background_image_url = picture;
    }
    for (const value of Object.values(record)) walk(value);
  };
  await page.route(
    (url) => isGroupDetailRead(url),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const response = await scrubbedFetch(route);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      walk(body);
      await route.fulfill({ response, json: body });
    },
  );
  await page.route('https://e2e-x64.invalid/**', async (route) => {
    photoRequests += 1;
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(WHITE_PIXEL_PNG, 'base64') });
  });
  return { stored: () => stored, photoRequests: () => photoRequests };
}

// The first background picture painted by the button's ancestors, or 'none'.
async function pictureBehind(control: Locator): Promise<string> {
  return control.evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const image = getComputedStyle(node).backgroundImage;
      if (image && image !== 'none') return image;
    }
    return 'none';
  });
}

async function openHeader(page: Page, theme: Theme, picture: string | null, what: string): Promise<{ manage: Locator; staged: StagedHeader }> {
  hold = await holdWrites(page, {});
  if (theme === 'light') {
    await page.emulateMedia({ colorScheme: 'light' });
    await forceLightMode(page);
  } else {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
  }
  const staged = await stageHeader(page, picture);
  const detailRead = page.waitForResponse((r) => r.request().method() === 'GET' && isGroupDetailRead(new URL(r.url())));
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  await detailRead;
  await assertTheme(page, theme);
  const manage = page.getByRole('button', { name: 'Manage Members', exact: true });
  await expect(manage, `${what}: the Manage Members button never rendered`).toBeVisible({ timeout: 15_000 });

  if (picture === null) {
    expect(await pictureBehind(manage), `${what}: the header paints a picture, so the no-photo arm is not under test (${staged.stored()})`).toBe('none');
  } else {
    await expect
      .poll(async () => pictureBehind(manage), { message: `${what}: the header never painted the staged picture`, timeout: 15_000 })
      .toContain(new URL(picture).pathname);
    const loaded = await page.evaluate(
      (src) =>
        new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = src;
        }),
      picture,
    );
    expect(loaded, `${what}: the staged picture did not load, so the photo arm was never under test`).toBe(true);
    expect(staged.photoRequests(), `${what}: the staged picture was never requested`).toBeGreaterThan(0);
  }
  return { manage, staged };
}

interface ControlRead {
  /** The fill as painted: the button's own colour when opaque, else composited over the header ground. */
  fill: string;
  /** The alpha of the button's own background, before compositing. */
  ownAlpha: number;
  ink: string;
}

async function readControl(manage: Locator, what: string): Promise<ControlRead> {
  const probe = await probeElement(manage, ['background-color', 'color']);
  const own = probe.computed['background-color'];
  const ink = probe.computed['color'];
  expect(own?.css ?? null, `${what}: the button's background did not read as a colour (${JSON.stringify(own?.raw)})`).not.toBeNull();
  expect(ink?.css ?? null, `${what}: the label colour did not read as a colour (${JSON.stringify(ink?.raw)})`).not.toBeNull();
  expect(ink!.alpha, `${what}: the label colour is translucent (${JSON.stringify(ink!.raw)})`).toBe(1);
  const ownAlpha = own!.alpha ?? 0;
  if (ownAlpha === 1) return { fill: own!.css!, ownAlpha, ink: ink!.css! };
  const composited = compositeGround(probe);
  expect(
    composited,
    `${what}: the button's fill is translucent (alpha ${ownAlpha.toFixed(3)}) and no opaque colour lies behind it, so what it paints cannot be measured`,
  ).not.toBeNull();
  return { fill: composited!, ownAlpha, ink: ink!.css! };
}

interface HoverReads {
  rest: ControlRead;
  hovered: ControlRead;
}

async function restAndHover(page: Page, manage: Locator, what: string, restMustBeOpaque: boolean): Promise<HoverReads> {
  await manage.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await settleAnimations(manage);
  expect(await manage.evaluate((el) => el.matches(':hover')), `${what}: the button reads as hovered with the mouse parked away`).toBe(false);
  if (restMustBeOpaque) {
    const own = (await probeElement(manage, ['background-color'])).computed['background-color'];
    expect(
      own?.alpha ?? null,
      `${what}: over a photo the resting fill must be fully opaque; it reads ${JSON.stringify(own?.raw)} (alpha ${own?.alpha === null || own?.alpha === undefined ? 'unreadable' : own.alpha.toFixed(3)})`,
    ).toBe(1);
  }
  const rest = await readControl(manage, `${what}, at rest`);

  const box = await manage.boundingBox();
  expect(box, `${what}: the button has no box to hover`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await settleAnimations(manage);
  expect(await manage.evaluate((el) => el.matches(':hover')), `${what}: the button never took the hover, so the read below would prove nothing`).toBe(true);
  const hovered = await readControl(manage, `${what}, hovered`);
  return { rest, hovered };
}

function need(value: number | null, what: string): number {
  expect(value, `${what}: not computable`).not.toBeNull();
  return value!;
}

// The three floors every arm shares, plus the ruled direction. Prints the measured values so the
// run's log is the record of what rendered.
function expectVisibleStep(theme: Theme, reads: HoverReads, what: string, stored: string, inkFloor: number = LABEL_FLOOR): void {
  const { rest, hovered } = reads;
  const step = need(deltaLStar(rest.fill, hovered.fill), `${what} step`);
  const labelRest = need(contrastRatio(rest.ink, rest.fill), `${what} label at rest`);
  const labelHover = need(contrastRatio(hovered.ink, hovered.fill), `${what} label hovered`);
  const restL = need(lStar(rest.fill), `${what} rest lightness`);
  const hoverL = need(lStar(hovered.fill), `${what} hover lightness`);
  const record =
    `${what}: rest ${rest.fill} (own alpha ${rest.ownAlpha.toFixed(3)}), hovered ${hovered.fill} (own alpha ${hovered.ownAlpha.toFixed(3)}), ` +
    `step ${step.toFixed(4)} L*, label ${labelRest.toFixed(4)} at rest and ${labelHover.toFixed(4)} hovered; ${stored}`;
  // eslint-disable-next-line no-console -- the rendered hover values are recorded from the CI log
  console.log(record);

  expect(step, `${record}. The hover must move the fill by at least ${HOVER_STEP_FLOOR.toFixed(1)} L*`).toBeGreaterThanOrEqual(HOVER_STEP_FLOOR);
  expect(labelRest, `${record}. The label must clear ${inkFloor}:1 at rest`).toBeGreaterThanOrEqual(inkFloor);
  expect(labelHover, `${record}. The label must clear ${inkFloor}:1 hovered`).toBeGreaterThanOrEqual(inkFloor);
  if (theme === 'light') {
    expect(hoverL, `${record}. In light the hover must darken the fill`).toBeLessThan(restL);
  } else {
    expect(hoverL, `${record}. In dark the hover must lighten the fill`).toBeGreaterThan(restL);
  }
}

// X37 (owner at N18, 2026-11-13: "when I switch from overview to library, I see a brief flash of
// dark corners on the tabs"). The tab being left fades its fill out; while it fades it must keep
// the rounded top corners the active tab has, or the fading fill shows square corners for the
// length of the fade. The fade is too short to catch by waiting, so ONE evaluate presses Library,
// finds Overview's running background transition, pauses it at three points (a tenth, half and
// three quarters of its length) and reads Overview's computed top corners and fill at each: computed
// style on a held frame, not a screenshot comparison. AMENDED after the red run 43751458336: the
// last frame was held at nine tenths, where the eased fill is down to 1/255 of its alpha (read
// 0.004), one rounding step from failing the still-has-a-fill check on a correct build; three
// quarters keeps a fill worth measuring. Runs in both projects (the tab strip is the
// same markup at 375 and at 1280); pressing a tab sends no write.
test('X37 (88.9): the group tab being left keeps its rounded top corners for the whole fade', async ({ page }) => {
  hold = await holdWrites(page, {});
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/groupHomePage?id=${E2E_GROUP_ID}`);
  const overview = page.getByRole('button', { name: 'Overview', exact: true });
  await expect(overview, 'X37: the Overview tab never rendered').toBeVisible({ timeout: 15_000 });
  await expect(overview, 'X37: Overview is not the active tab on load').toHaveAttribute('aria-current', 'true');
  await settleAnimations(overview);

  const read = await overview.evaluate(async (leaving) => {
    const entering = leaving.nextElementSibling;
    if (!(entering instanceof HTMLElement) || (entering.textContent ?? '').trim() !== 'Library') {
      return { error: 'the Library tab is not the element after Overview' };
    }
    const alphaOf = (value: string): number | null => {
      if (!CSS.supports('color', value)) return null;
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
    };
    const activeRadius = getComputedStyle(leaving).borderTopLeftRadius;
    entering.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const fade = leaving
      .getAnimations()
      .find((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'background-color');
    if (!fade) return { error: 'no fade to observe: Overview runs no background-color transition after Library is pressed' };
    const timing = fade.effect?.getComputedTiming();
    const duration = typeof timing?.duration === 'number' ? timing.duration : 0;
    const delay = timing?.delay ?? 0;
    if (duration <= 0) return { error: 'no fade to observe: the background-color transition has no length' };
    fade.pause();
    const frames = [0.1, 0.5, 0.75].map((at) => {
      fade.currentTime = delay + duration * at;
      const style = getComputedStyle(leaving);
      return {
        at,
        fill: style.backgroundColor,
        alpha: alphaOf(style.backgroundColor),
        topLeft: style.borderTopLeftRadius,
        topRight: style.borderTopRightRadius,
      };
    });
    const enteringStyle = getComputedStyle(entering);
    const result = {
      error: null,
      duration,
      activeRadius,
      frames,
      enteringTopLeft: enteringStyle.borderTopLeftRadius,
      enteringTopRight: enteringStyle.borderTopRightRadius,
      enteringCurrent: entering.getAttribute('aria-current'),
    };
    fade.finish();
    return result;
  });

  expect('frames' in read ? null : read.error, 'X37: the fade could not be held').toBeNull();
  if (!('frames' in read)) return;
  const record =
    `X37: fade ${read.duration}ms; active radius before the press ${read.activeRadius}; Library after the press ${read.enteringTopLeft} / ${read.enteringTopRight}; ` +
    read.frames.map((f) => `at ${f.at}: fill ${f.fill} (alpha ${f.alpha === null ? 'unreadable' : f.alpha.toFixed(3)}), corners ${f.topLeft} / ${f.topRight}`).join('; ');
  // eslint-disable-next-line no-console -- the held-frame values are recorded from the CI log
  console.log(record);

  expect(read.enteringCurrent, `${record}. Library did not become the active tab`).toBe('true');
  expect(parseFloat(read.enteringTopLeft), `${record}. The active tab has no top radius to compare with`).toBeGreaterThan(0);
  expect(read.enteringTopRight, `${record}. The active tab's two top corners differ`).toBe(read.enteringTopLeft);
  for (const frame of read.frames) {
    // Anti-vacuity: the frame is inside the fade, so there is still a fill to show corners.
    expect(frame.alpha, `${record}. The frame at ${frame.at} holds no fill, so its corners would prove nothing`).not.toBeNull();
    expect(frame.alpha!, `${record}. The frame at ${frame.at} holds no fill, so its corners would prove nothing`).toBeGreaterThan(0);
    expect(frame.topLeft, `${record}. At ${frame.at} of the fade Overview's top-left corner is square while its fill is still showing`).toBe(read.enteringTopLeft);
    expect(frame.topRight, `${record}. At ${frame.at} of the fade Overview's top-right corner is square while its fill is still showing`).toBe(read.enteringTopLeft);
  }
});

test.describe('Manage Members under the pointer (88.9-64: X9, X30)', () => {
  test.skip(({ isMobile }) => isMobile, 'X30 (88.9): a hover needs a fine pointer; the desktop journeys project owns these reads');

  const photoHeader = async (page: Page, theme: Theme): Promise<void> => {
    const what = `X30 + X9 photo header (${theme})`;
    const { manage, staged } = await openHeader(page, theme, PHOTO_URL, what);
    const reads = await restAndHover(page, manage, what, true);
    expect(reads.hovered.ownAlpha, `${what}: over a photo the hovered fill must be fully opaque too`).toBe(1);
    expectVisibleStep(theme, reads, what, staged.stored());
  };

  test('X30 + X9 (88.9): on a photo header Manage Members rests opaque and visibly changes under the pointer, light', async ({ page }) => {
    await photoHeader(page, 'light');
  });

  test('X30 + X9 (88.9): on a photo header Manage Members rests opaque and visibly changes under the pointer, dark', async ({ page }) => {
    await photoHeader(page, 'dark');
  });

  test('X30 (88.9): on a header with no photo Manage Members visibly changes under the pointer, light', async ({ page }) => {
    const what = 'X30 no-photo header (light)';
    const { manage, staged } = await openHeader(page, 'light', null, what);
    const reads = await restAndHover(page, manage, what, false);
    // The resting look is not this plan's to change: the 80% white fill stays.
    expect(reads.rest.ownAlpha, `${what}: the resting fill is no longer the 80% white one (${staged.stored()})`).toBeCloseTo(0.8, 1);
    expectVisibleStep('light', reads, what, staged.stored());
  });

  test('X30 (88.9): on a header with no photo the dark wash hover still wins and is a visible step, dark', async ({ page }) => {
    const what = 'X30 no-photo header (dark)';
    const { manage, staged } = await openHeader(page, 'dark', null, what);
    const reads = await restAndHover(page, manage, what, false);
    // Both states stay translucent white washes (10% at rest, 20% hovered). An opaque hovered fill
    // here means the light arm's hover class beat the dark one in the cascade.
    expect(reads.rest.ownAlpha, `${what}: the resting fill is no longer the 10% white wash (${staged.stored()})`).toBeCloseTo(0.1, 1);
    expect(reads.hovered.ownAlpha, `${what}: the hovered fill is not the 20% white wash, so another hover rule won (${staged.stored()})`).toBeCloseTo(0.2, 1);
    expectVisibleStep('dark', reads, what, staged.stored());
  });

  // 88.9-69 (88.9-64 hand-off d: "the group-page settings gear's hover is invisible the same way").
  // The gear sits in the same header as Manage Members, so the header is opened by the same
  // staging and the gear is then found by its own name. Its fill is opaque in both themes; the
  // "label" in the shared record line is the gear icon, which inherits the button's colour.
  const gearHover = async (page: Page, theme: Theme): Promise<void> => {
    const what = `Gear hover no-photo header (${theme})`;
    const { staged } = await openHeader(page, theme, null, what);
    const gear = page.getByRole('button', { name: 'Group settings', exact: true });
    await expect(gear, `${what}: the Group settings gear never rendered (it shows only to someone who can edit the group)`).toBeVisible();
    const reads = await restAndHover(page, gear, what, true);
    expect(reads.hovered.ownAlpha, `${what}: the hovered gear fill must be fully opaque too`).toBe(1);
    expectVisibleStep(theme, reads, what, staged.stored(), ICON_FLOOR);
  };

  test('Gear hover (88.9-69): the group settings gear visibly changes under the pointer, light', async ({ page }) => {
    await gearHover(page, 'light');
  });

  test('Gear hover (88.9-69): the group settings gear visibly changes under the pointer, dark', async ({ page }) => {
    await gearHover(page, 'dark');
  });
});
