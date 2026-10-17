import { test, expect } from '@playwright/test';

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
// CI-RUN ONLY: the phone project needs the .auth/user.json login state, which exists only in CI
// (FE-TESTING-CONVENTIONS C-14). It was typechecked and listed locally, not run.

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
    let checkedCards = 0;
    for (let i = 0; i < cardCount; i += 1) {
      const card = cards.nth(i);
      const heading = ((await card.locator('h3').first().textContent()) ?? '').trim();

      const invite = card.getByRole('button', { name: /^Invite member to /i });
      if ((await invite.count()) > 0) {
        await expect(invite.first()).toHaveAccessibleName('Invite member to ' + heading);
      }

      const gear = card.getByRole('button', { name: /^Customize /i });
      if ((await gear.count()) > 0) {
        await expect(gear.first()).toHaveAccessibleName('Customize ' + heading);
        await expect(gear.first()).toHaveAttribute('title', 'Customize ' + heading);
        await expect(gear.first()).not.toHaveAttribute('aria-label');
      }

      checkedCards += 1;
    }
    expect(checkedCards, 'every rendered card was checked').toBeGreaterThanOrEqual(1);
  });
});
