import { test, expect, type Locator, type Page } from '@playwright/test';
import { assertTheme, contrastRatio } from './support/contrast';
import { E2E_GAME_PATH, routeFakeGameSuccess } from './support/fakeGame';
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

// Plan 88.9-58 (owner fix rows 52-X14, 52-X48, 52-X51 and the N13 dark chevron item of 52-X13):
// a static card does not react to the mouse, read as computed style in a real browser. jsdom
// applies no hover and no cascade, so this plan's source pins (the X14 pin in the card padding
// suite and Gate A test 11 in the token contrast suite) cannot see what a hovered card paints.
//
// WHY THESE THREE CARDS. In dark the card hover wash and the secondary button fill resolved to the
// same colour, so a hovered card swallowed every secondary button on it: the Show Filters & Sort
// button on the game page (52-X48), the month chevrons on the home calendar (52-X13, N13), and
// the Profile cards lit up under the mouse while pressing them does nothing (52-X51).
//
// WHAT EACH TEST READS. The card's background colour with the mouse parked away from it, then again
// with the mouse over the card's own padding (never over a control), after the card's computed
// transition has had time to finish. The two reads must be equal. X48 and X13 also read the control
// against the hovered card: at least 1.20 apart (WCAG contrast formula, measured 1.23 once the wash
// is gone, 1.00 with it).
//
// DECISION Phase 88.9-58 X14-e2e: journeys only and dark only, chosen OVER a phone arm and a light
// pass. A hover needs a fine pointer, so the phone project is skipped by the isMobile predicate
// (the journeys floors row for this spec keeps the three journeys runs from being
// zeroed silently); and the swallowed-button defect exists only in dark, where the two tokens met.
// Changing this is a decision, not a cleanup.
//
// Nothing is pressed except the Month segment when the calendar opens on List (a stored view
// preference, kept in the browser, no request). The game page is the shared fake custom game with
// writes held in the browser; the afterEach fails the test if an /api write reached the hold.
// Nothing is screenshotted; failure messages carry colours and ratios only.

test.skip(({ isMobile }) => isMobile, 'X14 (88.9): a hover needs a fine pointer; the desktop journeys project owns these reads');

const CARD_ANCESTOR = 'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " card ")][1]';
const SEPARATION_FLOOR = 1.2;

let hold: WriteHold | undefined;

test.afterEach(async ({ page }) => {
  expectNoApiWrites(hold);
  hold = undefined;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

// The longest computed transition on the element, in milliseconds.
async function transitionMs(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const toMs = (value: string) => (value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000);
    const style = getComputedStyle(el);
    const durations = style.transitionDuration.split(',').map((part) => toMs(part.trim()));
    const delays = style.transitionDelay.split(',').map((part) => toMs(part.trim()));
    const longest = Math.max(0, ...durations.filter((n) => Number.isFinite(n)));
    const delay = Math.max(0, ...delays.filter((n) => Number.isFinite(n)));
    return longest + delay;
  });
}

// A viewport point on the card's own left padding where the card itself is the topmost element.
// The card is centred first, then the 24px padding strip is walked downwards 6px in from the left
// edge until the hit test returns the card: that skips the part a sticky header covers and any
// child that reaches into the strip. AMENDED 88.9-58 after CI run 43693071548: the first shape
// hovered a fixed point near the card's top, which sits under the sticky header on a card taller
// than the viewport (the home calendar), so the hover never landed and the X13 read timed out
// instead of measuring.
async function paddingPoint(card: Locator): Promise<{ x: number; y: number } | null> {
  return card.evaluate((el) => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = el.getBoundingClientRect();
    const x = box.left + 6;
    const from = Math.max(box.top + 6, 0);
    const to = Math.min(box.bottom - 6, window.innerHeight - 1);
    for (let y = from; y <= to; y += 6) {
      if (document.elementFromPoint(x, y) === el) return { x, y };
    }
    return null;
  });
}

// Reads the card at rest (mouse parked in the page corner), then hovered on its own padding.
async function restAndHover(page: Page, card: Locator, what: string): Promise<{ rest: string; hovered: string }> {
  await page.mouse.move(0, 0);
  const point = await paddingPoint(card);
  expect(point, `${what}: no point on the card's left padding is uncovered, so it cannot be hovered`).not.toBeNull();
  const settle = (await transitionMs(card)) + 100;
  await page.waitForTimeout(settle);
  expect(await card.evaluate((el) => el.matches(':hover')), `${what}: the card reads as hovered with the mouse parked away`).toBe(false);
  const rest = await backgroundOf(card);
  // Over the card itself and over no control (the hit test above returned the card at this point).
  await page.mouse.move(point!.x, point!.y);
  await page.waitForTimeout(settle);
  expect(await card.evaluate((el) => el.matches(':hover')), `${what}: the card never took the hover, so the read below would prove nothing`).toBe(true);
  const hovered = await backgroundOf(card);
  return { rest, hovered };
}

function expectApart(control: string, ground: string, what: string): void {
  const ratio = contrastRatio(control, ground);
  expect(ratio, `${what}: could not read a ratio from ${control} and ${ground}`).not.toBeNull();
  expect(
    ratio!,
    `${what}: the control fill ${control} against the hovered card ${ground} reads ${ratio!.toFixed(4)}, under ${SEPARATION_FLOOR}`,
  ).toBeGreaterThanOrEqual(SEPARATION_FLOOR);
}

test('X48 (88.9): hovering the Game Sessions card in dark leaves its ground unchanged and the Show Filters & Sort button stays apart from it', async ({ page }) => {
  hold = await holdWrites(page);
  await routeFakeGameSuccess(page);
  await page.goto(E2E_GAME_PATH);
  await assertTheme(page, 'dark');

  const toggle = page.getByRole('main').getByRole('button', { name: 'Show Filters & Sort', exact: true });
  await expect(toggle, 'X48: the Show Filters & Sort toggle never rendered').toBeVisible({ timeout: 15_000 });
  const card = toggle.locator(CARD_ANCESTOR);
  await expect(card, 'X48: the toggle does not sit on exactly one card').toHaveCount(1);

  const { rest, hovered } = await restAndHover(page, card, 'X48');
  expect(hovered, `X48: the Game Sessions card went from ${rest} to ${hovered} under the mouse`).toBe(rest);
  expect(await toggle.evaluate((el) => el.matches(':hover')), 'X48: the toggle itself is hovered, so its fill is not its resting fill').toBe(false);
  expectApart(await backgroundOf(toggle), hovered, 'X48');
});

test('X13 N13 (88.9): hovering the home calendar card in dark leaves its ground unchanged and the month chevrons keep their fill', async ({ page }) => {
  await page.goto('/');
  await assertTheme(page, 'dark');

  const month = page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month', exact: true }).first();
  await expect(month, 'X13: the Month | List group never rendered').toBeVisible({ timeout: 20_000 });
  if ((await month.getAttribute('aria-pressed')) !== 'true') {
    await month.click();
  }
  const previous = page.getByRole('button', { name: 'Previous month', exact: true });
  const next = page.getByRole('button', { name: 'Next month', exact: true });
  await expect(previous, 'X13: expected exactly one Previous month chevron on the home grid').toHaveCount(1);
  await expect(next, 'X13: expected exactly one Next month chevron on the home grid').toHaveCount(1);
  await expect(previous, 'X13: the Previous month chevron is not visible').toBeVisible();
  const card = previous.locator(CARD_ANCESTOR);
  await expect(card, 'X13: the chevrons do not sit on exactly one card').toHaveCount(1);

  const { rest, hovered } = await restAndHover(page, card, 'X13');
  expect(hovered, `X13: the home calendar card went from ${rest} to ${hovered} under the mouse`).toBe(rest);
  for (const [name, chevron] of [['Previous month', previous], ['Next month', next]] as const) {
    expect(await chevron.evaluate((el) => el.matches(':hover')), `X13: the ${name} chevron itself is hovered`).toBe(false);
    expectApart(await backgroundOf(chevron), hovered, `X13 (${name})`);
  }
});

test('X51 (88.9): hovering any Profile card in dark leaves its ground unchanged', async ({ page }) => {
  await page.goto('/userProfile');
  await assertTheme(page, 'dark');

  const cards = page.getByRole('main').locator('.card');
  await expect(cards.first(), 'X51: no Profile card rendered').toBeVisible({ timeout: 20_000 });
  // The page's cards mount in stages; wait for the count to hold at four or more.
  await expect.poll(async () => cards.count(), { message: 'X51: fewer than 4 Profile cards rendered', timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  const count = await cards.count();

  let read = 0;
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    if (!(await card.isVisible())) continue;
    const { rest, hovered } = await restAndHover(page, card, `X51 (card ${index + 1} of ${count})`);
    expect(hovered, `X51: Profile card ${index + 1} of ${count} went from ${rest} to ${hovered} under the mouse`).toBe(rest);
    read += 1;
  }
  expect(read, `X51: only ${read} of ${count} Profile cards were visible to hover`).toBeGreaterThanOrEqual(4);
});
