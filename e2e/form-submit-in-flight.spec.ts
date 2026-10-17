import { test, expect, type Locator, type Route, type Page } from '@playwright/test';

import { settleAnimations } from './support/inFlight';

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
async function expectPhoneBox(page: Page, locator: Locator, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} has no layout box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, 'no viewport size').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

/**
 * Fill an already-open Create Event dialog with the existing journey's values
 * (e2e/create-event.spec.ts), so no new game is minted. The ONE copy of these steps in this spec
 * (plan 88.6.1-81 factored them out of plan 26's E2E C1; R1 fills with them twice). The dialog keeps
 * its date-entry mode across a close and a reopen of the same instance, so the switch to manual
 * entry is pressed only while the toggle still offers it.
 */
async function fillCreateEvent(page: Page) {
  const gameName = process.env.E2E_GAME_NAME ?? 'Catan';
  await page.getByPlaceholder('Search for a game or type a name').fill(gameName);
  const modeToggle = page.getByRole('button', { name: /switch to (manual entry|visual calendar)/i });
  await expect(modeToggle).toBeVisible();
  if (/manual entry/i.test((await modeToggle.textContent()) ?? '')) await modeToggle.click();
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await page.getByLabel(/start date & time/i).fill(`${start.toISOString().slice(0, 10)}T19:00`);
  await page.getByPlaceholder(/enter duration in minutes/i).fill('120');
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

test.describe('Create Event — a second press while creating changes nothing (D-35)', () => {
  test('a second press while creating changes nothing: one POST, the submit reads Creating..., stays aria-disabled and focused', async ({
    page,
  }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    // The create goes to the same-origin BFF: `POST /api/events` exactly (`BFF_BASE` is `/api` in
    // src/lib/api.ts). Only that pathname and method is held; everything else continues.
    const create = await holdRequests(page, (url) => url.pathname === '/api/events', 'POST');

    await page.goto(`/groupHomePage?id=${groupId}`);
    await page.getByRole('button', { name: /add new game event/i }).click();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    await fillCreateEvent(page);

    // Found by test id: the accessible name changes mid-flight (copy row C7), the test id does not.
    const submit = page.getByTestId('create-event-submit');
    await submit.click();
    await create.firstSeen;

    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await expect(submit).not.toHaveAttribute('disabled');
    await expect(submit).toHaveAccessibleName('Creating...');
    await expect(submit).toBeFocused();
    await expectPhoneBox(page, submit, 'the busy Create Event submit');

    await submit.click({ force: true });
    await page.waitForTimeout(500);
    expect(create.count()).toBe(1);
    await expect(submit).toHaveAccessibleName('Creating...');

    // Abort the held create: the failure is a toast, the dialog stays open, and the person is
    // left where they pressed, on the re-enabled submit.
    await create.abortAll();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
    await expect(submit).toHaveAccessibleName('Create Event');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await expect(submit).toBeFocused();
    expect(create.count()).toBe(1);
  });
});

// Plan 88.6.1-81 (E2E R1, Edge R11 concurrency, the real-browser half). groupHomePage keeps the SAME
// Create Event instance mounted, so a close and a reopen bring back that instance. A create is
// held mid-flight, the dialog is closed with Escape (closable mid-create, D-55 (b)) and opened
// again: the reopened submit is live, and the held request's later FAILURE leaves the reopened
// dialog open. NOTHING IS WRITTEN: the only POST to /api/events is held and then aborted. The
// SUCCESS path is not driven here (groupHomePage's refresh is plan 88.6.1-55's; plan 88.6.1-68's
// E2E R3 drives it); the jsdom arms S1-S3 pin it.
test.describe('Create Event — closing mid-create and reopening (88.6.1-81)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('closing mid-create and reopening gives a live submit, and the held create failing later leaves the reopened dialog open', async ({
    page,
  }) => {
    const groupId = process.env.E2E_GROUP_ID ?? '1';
    // `POST /api/events` exactly, as in C1; everything else continues.
    const create = await holdRequests(page, (url) => url.pathname === '/api/events', 'POST');

    await page.goto(`/groupHomePage?id=${groupId}`);
    const openDialog = page.getByRole('button', { name: /add new game event/i });
    const heading = page.getByRole('heading', { name: /create event/i });
    await openDialog.click();
    await expect(heading).toBeVisible();
    await fillCreateEvent(page);

    const submit = page.getByTestId('create-event-submit');
    await submit.click();
    await create.firstSeen;
    await expect(submit).toHaveAccessibleName('Creating...');

    // Close mid-create, then reopen. The reopen re-runs the members read (`GET /api/groups/<id>/users`),
    // which rebuilds the form; wait for it so nothing below races that rebuild.
    await page.keyboard.press('Escape');
    await expect(heading).toBeHidden();
    const membersReloaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' && /^\/api\/groups\/[^/]+\/users$/.test(new URL(response.url()).pathname),
    );
    await openDialog.click();
    await expect(heading).toBeVisible();
    await membersReloaded;
    await settleAnimations(page.getByRole('dialog'));

    // A fresh session: no press it never had.
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await expect(submit).toHaveAccessibleName('Create Event');
    await expectPhoneBox(page, submit, 'the reopened Create Event submit');

    // The join leg: the SAME details pressed again, seconds after the first POST and well inside
    // createEvent.js's 30-second join window, join the held create. The submit shows its own press
    // and no second POST is sent.
    await fillCreateEvent(page);
    await submit.click();
    await expect(submit).toHaveAccessibleName('Creating...');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(500);
    expect(create.count()).toBe(1);

    // The held create fails. Positive signal first (the request failed), then the absences.
    const createFailed = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === '/api/events');
    await create.abortAll();
    await createFailed;
    await page.waitForTimeout(500);
    await expect(heading).toBeVisible();
    await expect(submit).toHaveAccessibleName('Create Event');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    expect(create.count()).toBe(1);
  });
});
