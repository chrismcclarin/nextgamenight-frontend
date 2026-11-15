import { test, expect, type Page } from '@playwright/test';

import { assertTheme, forceLightMode } from './support/contrast';

// Phase 88.6.1-54 (D-19, D-52, copy rows H1/H2, AC-20) — every home group card names its gear
// and its Invite button after THAT card's group. PHONE PROJECT ONLY (375 x 667).
//
// WHAT IT PROVES, in Chromium at phone width: the per-card names "Customize {group}" and
// "Invite member to {group}", computed by Playwright's role engine. That is Playwright's own
// accname implementation run in the page DOM, not the platform accessibility tree. The gear has
// no aria-label and its glyph is aria-hidden, so its name comes from its title alone (D-52);
// this is therefore also the real-DOM proof that the hidden glyph leaves the title as the name.
// What a screen reader SPEAKS is plan 88.6.1-57's VoiceOver step, not this spec's.
//
// READ-ONLY: the spec clicks, types, presses and routes nothing, so it cannot change the fixture.
//
// N DISTINCT NAMES across several cards is NM-1's job in
// src/app/components/keyboardOperability.test.tsx: the fixture gives Alice one owned group, so
// this spec checks each card it finds against that card's own heading.
//
// SELECTORS: role, name and text, plus the one contract attribute data-testid="group-card"
// (DECISION Phase 88.6-47 in grouplist.js: it exists so tests address the CARD).
//
// 88.9-59 X8 (owner pick G2, 2026-11-11): the same fixture card's gear is also read for its PAINT,
// in both themes: the darker blue fill and a white icon, the two computed colours a person sees.
// The token floors (icon, hover, ring) are held at the token layer; this is the proof that the
// utilities reach the element in a real browser at 375. Still read-only.
//
// CI-RUN ONLY: the phone project needs the .auth/user.json login state, which exists only in CI
// (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.

const GEAR_FILL = 'rgb(66, 83, 110)'; // the gear token in both themes (G2 is theme-equal)
const GEAR_ICON = 'rgb(255, 255, 255)';

/** X8 G2: the fixture card's gear paints the darker blue with a white icon. The theme is checked before any colour is read. */
async function gearPaint(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.goto('/');
  await assertTheme(page, theme);
  const cards = page.getByTestId('group-card');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  const fixtureCard = cards.filter({ has: page.getByText('Weekend Warriors', { exact: true }) });
  await expect(fixtureCard).toHaveCount(1);
  const gear = fixtureCard.getByRole('button', { name: 'Customize Weekend Warriors', exact: true });
  await expect(gear).toHaveCount(1);
  await expect(gear, `the gear fill (${theme})`).toHaveCSS('background-color', GEAR_FILL);
  await expect(gear, `the gear icon colour (${theme})`).toHaveCSS('color', GEAR_ICON);
}

test.describe('Phase 88.6.1-54 — group card button names carry the group name (phone project)', () => {
  // Same phone-only guard idiom as touch-targets.spec.ts: both projects match every spec, and
  // this is a phone-width proof.
  test.skip(({ isMobile }) => !isMobile, 'D-19 per-card names — phone project only');

  test('every home group card names its gear and Invite after that group (88.6.1-54)', async ({ page }) => {
    await page.goto('/');

    const cards = page.getByTestId('group-card');
    // Vacuity guard: at least one card, or every later assertion is about nothing.
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const cardCount = await cards.count();
    expect(cardCount, 'at least 1 group card renders on the home page').toBeGreaterThanOrEqual(1);

    // The seeded owner's group (the backend fixture names it Weekend Warriors).
    const fixtureCard = cards.filter({ has: page.getByText('Weekend Warriors', { exact: true }) });
    await expect(fixtureCard).toHaveCount(1);

    const fixtureGear = fixtureCard.getByRole('button', { name: 'Customize Weekend Warriors', exact: true });
    await expect(fixtureGear).toHaveCount(1);
    // D-52: the tooltip is the gear's one name source, with no aria-label beside it.
    await expect(fixtureGear).toHaveAttribute('title', 'Customize Weekend Warriors');
    await expect(fixtureGear).not.toHaveAttribute('aria-label');

    const fixtureInvite = fixtureCard.getByRole('button', {
      name: 'Invite member to Weekend Warriors',
      exact: true,
    });
    await expect(fixtureInvite).toHaveCount(1);

    // Every card against its OWN heading. textContent, never innerText, so a CSS text transform
    // cannot change what is compared.
    // 88.6.1 code review A-04 / REVIEW IN-04: each control is FOUND without its expected name (the
    // Invite button by its visible words "Invite Member", the gear by its glyph), so a card whose
    // button regressed to a generic name is asserted, and fails, instead of being skipped. The
    // counter counts only cards where at least one named control was actually asserted.
    let checkedCards = 0;
    for (let i = 0; i < cardCount; i += 1) {
      const card = cards.nth(i);
      const heading = ((await card.locator('h3').first().textContent()) ?? '').trim();
      let asserted = false;

      const invite = card.getByRole('button').filter({ hasText: 'Invite Member' });
      if ((await invite.count()) > 0) {
        await expect(invite.first()).toHaveAccessibleName('Invite member to ' + heading);
        asserted = true;
      }

      const gear = card.getByRole('button').filter({ hasText: '\u2699' });
      if ((await gear.count()) > 0) {
        await expect(gear.first()).toHaveAccessibleName('Customize ' + heading);
        await expect(gear.first()).toHaveAttribute('title', 'Customize ' + heading);
        await expect(gear.first()).not.toHaveAttribute('aria-label');
        asserted = true;
      }

      if (asserted) checkedCards += 1;
    }
    expect(checkedCards, 'cards whose Invite or gear name was asserted').toBeGreaterThanOrEqual(1);
  });

  test("X8 G2 (88.9): the fixture card's gear is the darker blue with a white icon at 375, dark", async ({ page }) => {
    await gearPaint(page, 'dark');
  });

  test("X8 G2 (88.9): the fixture card's gear is the darker blue with a white icon at 375, light", async ({ page }) => {
    // Before any navigation: the init script lands at the first goto.
    await forceLightMode(page);
    await gearPaint(page, 'light');
  });
});
