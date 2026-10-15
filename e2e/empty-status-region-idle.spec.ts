import { test, expect, type Locator, type Page } from '@playwright/test';

// Phase 88.6.1 plan 06 (D-22): the idle geometry of an EMPTY status region, measured at
// 375 x 667 in the `phone` project.
//
// WHAT IS MEASURED. Two surfaces where an always-mounted, empty live region used to cost
// visible space, and now costs none because the region is `sr-only` while it has nothing
// to say (`srOnlyWhenEmpty` on the shared primitive):
//   A. the Calendar sheet's NEXT GAME NIGHT hero card: nothing under the RSVP buttons but
//      the card's own padding (it read 8px before plan 88.6.1-06, the RSVP group's
//      space-y-2 bottom margin with the empty outcome wrapper as the stack's last child);
//   B. the Create Event dialog's custom participant row: nothing under the name line (it
//      read 4px before, the duplicate-name hint's mt-1 reserved on every custom row).
//
// THE POSITIVE CONTROLS ARE WHAT MAKE EACH 0px READING NON-VACUOUS. A broken instrument
// (wrong element, wrong ancestor, a layout that never rendered) can also read 0. So each
// test, in the same page, makes the region SHOW and measures the expected gap: the 8px
// outcome line (success arm and failure arm) and the 4px hint. A measurement that reads 0
// idle and 8 or 4 shown is reading the real boxes.
//
// CI ONLY. The phone project needs the `.auth/user.json` login state, which exists only in
// CI (C-14 in .planning/codebase/FE-TESTING-CONVENTIONS.md). The RED run against the
// pre-fix tree was therefore NOT made; the jsdom pins in tasks 1-2 of the plan carry the red
// half (StatusRegion.test.tsx, ParticipantRow.test.tsx, NextGameNightCard.test.tsx).
//
// NO WRITES. Test A intercepts only the browser's POST to /api/rsvp and fulfils it in the
// browser (every other method falls through), then unroutes; the seeded account's RSVP
// never changes. Test B never submits the Create Event form and closes it with Escape.

/** Same names as `phone-home-event-discovery.spec.ts:206-207`, re-declared, never imported. */
const calendarButton = (page: Page) => page.getByRole('button', { name: /^calendar\b/i });
const calendarSheet = (page: Page) => page.getByRole('dialog', { name: 'Calendar' });

const FIXTURE_OWNER = 'periodictabletopbackend_v2/Sonnet/scripts/e2e-fixtures.js';

/** Visible-or-fail guard (the `guardResolved` shape): a missing element is a FIXTURE
 *  failure, never a skip and never a vacuous pass. */
async function guardVisible(locator: Locator, what: string): Promise<void> {
  await expect(
    locator.first(),
    `${what} resolved no visible element — a fixture failure (owner: ${FIXTURE_OWNER}), not a pass and not a skip`,
  ).toBeVisible();
}

type HeroGeometry = {
  /** card content-box bottom minus the RSVP group's bottom, in px */
  idle: number;
  /** shown outcome region's top minus the RSVP group's bottom (null when none is shown) */
  regionGap: number | null;
  /** card content-box bottom minus the shown region's bottom (null when none is shown) */
  regionToCardEnd: number | null;
  cardText: string;
};

/** Measures the hero card from its RSVP group. `shownText`, when given, picks the outcome
 *  region (role=status or role=alert inside the card) whose trimmed text equals it. */
async function measureHero(group: Locator, shownText: string | null): Promise<HeroGeometry> {
  return group.evaluate(
    (el, wanted) => {
      const stack = el.parentElement as HTMLElement;
      const card = stack.parentElement as HTMLElement;
      const cs = getComputedStyle(card);
      const contentBottom =
        card.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
      const groupBottom = el.getBoundingClientRect().bottom;
      let regionGap: number | null = null;
      let regionToCardEnd: number | null = null;
      if (wanted !== null) {
        const regions = Array.from(card.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'));
        const shown = regions.find((r) => (r.textContent ?? '').trim() === wanted);
        if (shown) {
          const rect = shown.getBoundingClientRect();
          regionGap = rect.top - groupBottom;
          regionToCardEnd = contentBottom - rect.bottom;
        }
      }
      return {
        idle: contentBottom - groupBottom,
        regionGap,
        regionToCardEnd,
        cardText: card.textContent ?? '',
      };
    },
    shownText,
  );
}

test.describe('Phase 88.6.1-06 D-22 — an empty status region costs no idle space (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet geometry — phone project only');

  test('hero card at 375 — no idle gap under the RSVP buttons; a shown outcome sits 8px below them', async ({
    page,
  }) => {
    await page.goto('/');
    await calendarButton(page).click();
    const sheet = calendarSheet(page);
    await expect(sheet).toBeVisible();

    const group = sheet.getByRole('group', { name: /^RSVP for / });
    await guardVisible(
      group,
      'the NEXT GAME NIGHT hero RSVP group (the hero renders only when the seeded account has an upcoming event)',
    );
    const card = group.locator('xpath=../..');

    // Idle: both outcome regions are empty, so sr-only and out of flow.
    const idle = await measureHero(group, null);
    expect(idle.cardText, 'the measured ancestor is not the hero card (no "Next game night" eyebrow in it)').toContain(
      'Next game night',
    );
    expect(
      Math.abs(idle.idle),
      `idle gap under the RSVP buttons = ${idle.idle}px (card content bottom minus the RSVP group bottom); expected 0 (+/-1). It read 8 before plan 88.6.1-06.`,
    ).toBeLessThanOrEqual(1);

    // Success arm: mock the write in the browser; every non-POST falls through.
    await page.route('**/api/rsvp', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 200, json: { id: 'e2e-mock', status: 'yes', note: null } });
    });
    await group.locator('button[aria-pressed="false"]').first().click();
    await expect(card.getByText('Response saved', { exact: true })).toBeVisible();

    const success = await measureHero(group, 'Response saved');
    // A null reading (region not found) becomes NaN, which fails both comparisons below.
    expect(
      Math.abs((success.regionGap ?? NaN) - 8),
      `success region top minus RSVP group bottom = ${success.regionGap}px; expected 8 (+/-1), the region's mt-2 (positive control for the idle reading)`,
    ).toBeLessThanOrEqual(1);
    expect(
      success.regionToCardEnd ?? NaN,
      `card content bottom minus success region bottom = ${success.regionToCardEnd}px; expected 0 (+/-1): the shown line is the last thing in the card`,
    ).toBeLessThanOrEqual(1);

    // Failure arm: re-route the write to a 500.
    await page.unroute('**/api/rsvp');
    await page.route('**/api/rsvp', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 500, json: { error: 'e2e mock failure' } });
    });
    await group.locator('button[aria-pressed="false"]').first().click();
    const alert = card.getByRole('alert');
    await expect(alert, 'the hero card failure region never received text after a 500').toHaveText(/\S/);
    const failureText = ((await alert.textContent()) ?? '').trim();

    const failure = await measureHero(group, failureText);
    expect(
      Math.abs((failure.regionGap ?? NaN) - 8),
      `failure region top minus RSVP group bottom = ${failure.regionGap}px; expected 8 (+/-1), the region's mt-2 (positive control for the idle reading)`,
    ).toBeLessThanOrEqual(1);
    expect(
      failure.regionToCardEnd ?? NaN,
      `card content bottom minus failure region bottom = ${failure.regionToCardEnd}px; expected 0 (+/-1)`,
    ).toBeLessThanOrEqual(1);
    await expect(
      card.getByText('Response saved', { exact: true }),
      'the success copy survived a later failure: the two regions must clear each other',
    ).toHaveCount(0);

    await page.unroute('**/api/rsvp');
  });

  test("Create Event participant row at 375 — no idle gap under a custom row's name line; the duplicate hint sits 4px below it", async ({
    page,
  }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    await page.goto(`/groupHomePage?id=${groupId}`);
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

    const add = page.getByRole('button', { name: /add participant/i });
    await add.click();
    await add.click();

    // Only CUSTOM rows render a <label> "Participant Name" (member rows render a span).
    const names = page.getByLabel('Participant Name', { exact: true });
    await guardVisible(names, 'the custom participant name inputs');
    const count = await names.count();
    expect(count, `custom participant rows = ${count}; expected at least 2 after two "+ Add Participant" taps`).toBeGreaterThanOrEqual(2);
    const first = names.nth(count - 2);
    const last = names.nth(count - 1);

    // Idle: the last row has an empty name, so no hint; the hint region is sr-only.
    const idleGap = await last.evaluate((input) => {
      const line = input.parentElement as HTMLElement;
      const column = line.parentElement as HTMLElement;
      return column.getBoundingClientRect().bottom - line.getBoundingClientRect().bottom;
    });
    expect(
      idleGap,
      `idle gap under the custom row's name line = ${idleGap}px (column bottom minus name-line bottom); expected 0 (+/-1). It read 4 before plan 88.6.1-06.`,
    ).toBeLessThanOrEqual(1);

    // Positive control: a duplicate name shows the hint on both rows.
    await first.fill('Pat');
    await last.fill('Pat');
    await expect(page.getByText("Heads up: there's already a participant named Pat.", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Heads up: there's already a participant named Pat.", { exact: true }).last()).toBeVisible();

    const shown = await last.evaluate((input) => {
      const line = input.parentElement as HTMLElement;
      const column = line.parentElement as HTMLElement;
      const hint = column.querySelector<HTMLElement>('[role="status"]');
      if (!hint) return null;
      const lineBottom = line.getBoundingClientRect().bottom;
      const hintRect = hint.getBoundingClientRect();
      return {
        hintGap: hintRect.top - lineBottom,
        hintToColumnEnd: column.getBoundingClientRect().bottom - hintRect.bottom,
      };
    });
    expect(shown, "the last custom row's column holds no role=status hint region").not.toBeNull();
    const { hintGap, hintToColumnEnd } = shown as { hintGap: number; hintToColumnEnd: number };
    expect(
      Math.abs(hintGap - 4),
      `hint top minus name-line bottom = ${hintGap}px; expected 4 (+/-1), the hint's mt-1 (positive control for the idle reading)`,
    ).toBeLessThanOrEqual(1);
    expect(
      hintToColumnEnd,
      `column bottom minus hint bottom = ${hintToColumnEnd}px; expected 0 (+/-1): the hint is the last thing in the column`,
    ).toBeLessThanOrEqual(1);

    // Nothing is persisted: close without submitting.
    await page.keyboard.press('Escape');
  });
});
