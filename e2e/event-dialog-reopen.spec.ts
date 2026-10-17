// Plan 88.6.1-68 — the Create Event dialog after a request outlives it (Requirement 11).
//
// What this proves that jsdom cannot: in a real browser at 375px (the phone project) and at the
// journeys width, an Edit Event dialog reopened on the event page while the first update is still
// saving waits on its loading line (copy row E4) instead of showing the pre-update copy, then shows
// the SAVED value once that update settles, and the update's late success no longer closes it; its
// submit stays at least 44px tall inside the viewport. The ordinary path still closes, refreshes and
// says so. The red halves are ED1 (createEvent.participants.test.tsx) and GD-1
// (gameDetail/page.test.tsx) in jsdom; this spec runs in CI only (no local `.auth`).
//
// Shared-fixture rule: the fixture event and its group are READ-ONLY here. `holdWrites` is
// registered before the first navigation and holds every write this spec does not answer; the one
// PUT each test is about goes through `holdUntilReleased` (registered after it, so it runs first)
// and is answered in the browser. The spec's own routes are GET-only. No request or response body
// is logged, printed or attached.
import { test, expect, type Page } from '@playwright/test';

import { holdWrites, holdUntilReleased } from './support/inFlight';

const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH =
  process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;
const EVENT_ID = new URL(E2E_EVENT_DETAIL_PATH, 'http://localhost').searchParams.get('event_id') ?? '1';
const EVENT_PATH = new RegExp(`/events/${EVENT_ID}$`);

const MARKER = 'E2E reopen check 88.6.1-68';
// Copy row E4 (ratified, D-30) — the Edit dialog's loading line.
const E4 = 'Loading game night...';

function editHeading(page: Page) {
  return page.getByRole('heading', { name: 'Edit Event', exact: true });
}

test.describe('Edit Event on the event page — reopening while an update is saving (88.6.1-68)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('R1: a reopened Edit dialog waits for the first update, then shows the saved value and stays open through its late success', async ({ page }) => {
    const net = await holdWrites(page);
    let released = false;
    // GET-only: once the update is released, the event read answers with the saved comment.
    await page.route(
      (url) => EVENT_PATH.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET' || !released) {
          await route.fallback();
          return;
        }
        const response = await route.fetch();
        const json = await response.json();
        await route.fulfill({ response, json: { ...json, comments: MARKER } });
      },
    );
    const put = await holdUntilReleased(page, 'PUT', EVENT_PATH);

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    await expect(editHeading(page)).toBeVisible();
    const submit = page.getByTestId('create-event-submit');
    await expect(submit).toHaveText('Update Event');
    await page.getByRole('dialog').getByLabel('Comments').fill(MARKER);
    await submit.click();
    await put.arrived;
    expect(put.count()).toBe(1);

    await page.keyboard.press('Escape');
    await expect(editHeading(page)).toBeHidden();
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    await expect(editHeading(page)).toBeVisible();
    // Scoped to the dialog: the event page's own loader uses the same copy row.
    await expect(page.getByRole('dialog').getByText(E4, { exact: true })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('create-event-submit')).toHaveCount(0);

    released = true;
    await put.release({}, 200);

    await expect(page.getByText('Event updated', { exact: true })).toBeVisible();
    await expect(editHeading(page)).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Comments')).toHaveValue(MARKER);
    const reopened = page.getByTestId('create-event-submit');
    await expect(reopened).toHaveText('Update Event');
    await expect(reopened).not.toHaveAttribute('aria-disabled', 'true');
    const box = await reopened.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(put.count()).toBe(1);
    expect(net.count('PUT', /\/events\//)).toBe(0);
    expect(net.count('POST', /\/events/)).toBe(0);
    await page.keyboard.press('Escape');
  });

  test('R2: the ordinary update still closes the dialog, refreshes the page and says Event updated (confirm-only)', async ({ page }) => {
    await holdWrites(page);
    let readsAfterPut = 0;
    let put: Awaited<ReturnType<typeof holdUntilReleased>> | null = null;
    // GET-only: count the event reads that follow the PUT (the page's refresh).
    await page.route(
      (url) => EVENT_PATH.test(url.pathname),
      async (route) => {
        if (route.request().method() === 'GET' && put && put.count() >= 1) readsAfterPut += 1;
        await route.fallback();
      },
    );
    put = await holdUntilReleased(page, 'PUT', EVENT_PATH);
    await put.release({}, 200);

    await page.goto(E2E_EVENT_DETAIL_PATH);
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    const submit = page.getByTestId('create-event-submit');
    await expect(submit).toHaveText('Update Event');
    await page.getByRole('dialog').getByLabel('Comments').fill(MARKER);
    await submit.click();
    await expect(editHeading(page)).toBeHidden();
    await expect(page.getByText('Event updated', { exact: true })).toBeVisible();
    await expect.poll(() => readsAfterPut).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1000);
    await expect(editHeading(page)).toBeHidden();
    expect(put.count()).toBe(1);
  });
});
