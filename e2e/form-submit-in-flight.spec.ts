import { test, expect, type Route, type Page } from '@playwright/test';

// Phase 88.6.1 plan 26 — a second press while a form is working changes nothing, proven in a real
// browser at the phone project's 375 x 667 (and in journeys).
//
// The jsdom suites prove the attributes and the request counts (`useAppForm.test.ts` U1-U4,
// `AvailabilityForm.test.tsx` A1 / P1-P5, `createEvent.participants.test.tsx` C1-C4). jsdom never
// blurs a disabled element, so THIS spec is where "the pressed control keeps focus" is proven (C-11
// in .planning/codebase/FE-TESTING-CONVENTIONS.md).
//
// CI ONLY. The phone and journeys projects need the `.auth/user.json` login state, which exists only
// in CI (C-14). Not run locally.
//
// NOTHING IS WRITTEN. Every held request is ABORTED, so no availability response, pre-fill or event
// reaches the backend. The magic-link validate answer is patched in the browser only (two booleans).
// The spec reads only the fixture ids the existing journeys read (`E2E_AVAILABILITY_TOKEN`,
// `E2E_GROUP_ID`, `E2E_GAME_NAME`).

// Copy row A5 (88.6.1-COPY-TABLE.html), byte-equal: the ellipsis is U+2026.
const SAVED_PREFILL_LOADING_LABEL = 'Loading your availability…';

// The magic-link page calls the public backend directly (`PUBLIC_API_BASE_URL` in src/lib/api.ts),
// whose origin differs between environments, so routes match on the PATHNAME only.
const pathEndsWith = (suffix: string) => (url: URL) => url.pathname.endsWith(suffix);

/** Hold every request of `method` on a matched route; count them; continue everything else. */
async function holdRequests(page: Page, match: (url: URL) => boolean, method: string) {
  const held: Route[] = [];
  let count = 0;
  let markSeen: () => void = () => {};
  const firstSeen = new Promise<void>((resolve) => {
    markSeen = resolve;
  });
  await page.route(match, async (route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    count += 1;
    held.push(route);
    markSeen();
  });
  return {
    firstSeen,
    count: () => count,
    abortAll: async () => {
      for (const r of held) await r.abort();
    },
  };
}

/** Phone floor and width: at least 44px tall, inside the viewport. */
async function expectPhoneBox(page: Page, locator: ReturnType<Page['getByRole']>, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} has no layout box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, 'no viewport size').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

test.describe('Availability form — a second press while submitting changes nothing (AC-12)', () => {
  test('a second press while submitting changes nothing: one POST, the CTA stays Submitting..., aria-disabled and focused', async ({
    page,
  }) => {
    const token = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';
    const post = await holdRequests(page, pathEndsWith('/availability-responses'), 'POST');

    await page.goto(`/availability-form/${token}`);
    await page.getByRole('checkbox', { name: /^all$/i }).first().check();
    await page.getByRole('button', { name: /submit availability|update availability/i }).click();
    await post.firstSeen;

    const busy = page.getByRole('button', { name: /submitting/i });
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await expect(busy).not.toHaveAttribute('disabled');
    await expect(busy).toBeFocused();

    // A second press (forced: Playwright's actionability treats aria-disabled as not enabled).
    await busy.click({ force: true });
    // A negative needs a settle window: long enough for a second fetch to reach the route.
    await page.waitForTimeout(500);
    expect(post.count()).toBe(1);
    await expect(busy).toHaveAccessibleName(/submitting/i);

    await post.abortAll();
    // Filtered to a non-empty alert: Next.js's route announcer is also a `role="alert"` (empty on
    // a full page load), so an unfiltered lookup could match two nodes.
    const alert = page.getByRole('alert').filter({ hasText: /\S/ });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/\S/);
    const idle = page.getByRole('button', { name: /submit availability|update availability/i });
    await expect(idle).not.toHaveAttribute('aria-disabled', 'true');
    await expect(idle).toBeFocused();
    expect(post.count()).toBe(1);
  });
});

test.describe('Availability form — the pressed pre-fill button (D-35, copy row A5)', () => {
  test('the pressed pre-fill button reads A5, stays focused and aria-disabled; its sibling is natively disabled; one POST', async ({
    page,
  }) => {
    const token = process.env.E2E_AVAILABILITY_TOKEN ?? 'seed-availability-token';

    // Both pre-fill buttons need the validate answer to say they apply; flip the two booleans in
    // the browser only.
    await page.route(pathEndsWith('/magic-auth/validate'), async (route) => {
      const response = await route.fetch();
      let body: Record<string, unknown>;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        await route.fulfill({ response });
        return;
      }
      await route.fulfill({
        response,
        json: { ...body, has_saved_availability: true, gcal_connected: true },
      });
    });
    // Nothing painted, so no replace dialog: the prior-response lookup answers "none".
    await page.route(
      (url) => url.pathname.includes('/availability-responses/'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        await route.fulfill({ response, status: 200, json: null });
      }
    );
    const saved = await holdRequests(page, pathEndsWith('/availability-prefill/saved'), 'POST');

    await page.goto(`/availability-form/${token}`);
    const savedButton = page.getByRole('button', { name: 'Use my saved availability', exact: true });
    const gcalButton = page.getByRole('button', { name: 'Import from Google Calendar', exact: true });
    await savedButton.click();
    await saved.firstSeen;

    const pressed = page.getByRole('button', { name: SAVED_PREFILL_LOADING_LABEL, exact: true });
    await expect(pressed).toHaveAttribute('aria-disabled', 'true');
    await expect(pressed).not.toHaveAttribute('disabled');
    await expect(pressed).toBeFocused();
    await expect(gcalButton).toBeDisabled();
    await expectPhoneBox(page, pressed, 'the pressed pre-fill button');
    await expectPhoneBox(page, gcalButton, 'the sibling pre-fill button');

    await pressed.click({ force: true });
    await page.waitForTimeout(500);
    expect(saved.count()).toBe(1);

    await saved.abortAll();
    const failure = "Couldn't use saved availability.";
    // Two nodes carry the sentence on purpose: index 0 is the sr-only outcome region (the card's
    // FIRST child), index 1 is the visible line. `.first()` would assert the sr-only one.
    const sentence = page.getByText(failure, { exact: true });
    await expect(sentence).toHaveCount(2);
    await expect(sentence.nth(1)).toBeVisible();
    // `toContainText`, never `toBeVisible`: the region is sr-only (DECISION Phase 88.6-47 in
    // availability-submit.spec.ts explains why a visibility check on it proves nothing).
    await expect(page.getByTestId('prefill-status')).toContainText(failure);
    await expect(savedButton).toBeFocused();
    expect(saved.count()).toBe(1);
  });
});
