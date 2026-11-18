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
// R3/R4 (the other hosts) reuse plan 71's `fillCreateEventManualEntry` and plan 20's `E2E_GROUP_ID`,
// and answer every write in the browser (`holdWrites` plus plan 44's `holdUntilReleased`).
import { test, expect, type Page } from '@playwright/test';

import { fillCreateEventManualEntry } from './support/createEvent';
import { E2E_GROUP_ID } from './support/groupSettings';
import { holdWrites, holdUntilReleased } from './support/inFlight';
import { expectTouchTarget } from './support/touchTarget';
import { scrubbedFetch } from './support/scrubbedFetch';

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
        const response = await scrubbedFetch(route);
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
    await expectTouchTarget(reopened, 'the reopened submit', { axes: 'height', withinViewportOf: page });
    expect(put.count()).toBe(1);
    expect(net.count('PUT', /\/events\//)).toBe(0);
    expect(net.count('POST', /\/events/)).toBe(0);
    await page.keyboard.press('Escape');
  });

  test('R2: the ordinary update still closes the dialog, refreshes the page and fires no success toast (save-feedback rule 2)', async ({ page }) => {
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
    // 88.9-52 (A-09): the result IS spoken, once, by the root announcer's sr-only polite region
    // (DECISION Phase 88.9-24 in src/app/components/createEvent.js). Read straight after the close:
    // the announcer clears its text 4s after it is written.
    await expect(page.getByRole('status').filter({ hasText: /^Event updated$/ })).toHaveCount(1);
    await expect.poll(() => readsAfterPut).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1000);
    // Save-feedback rule 2 (88.9-24): the page shows the result, so no toast. Scoped to sonner's
    // toast items because the root announcer's sr-only region speaks the same words.
    // 88.9-52 (A-05): read AFTER the fixed wait — an absence read taken at once would pass on a
    // toast that had not been raised yet.
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Event updated' })).toHaveCount(0);
    await expect(editHeading(page)).toBeHidden();
    expect(put.count()).toBe(1);
  });
});

// The rendered proof for G5 and its fleet form L3 (round 4). A screen-reader-only box is position
// absolute; while the dialog's scrolling Body was not positioned, the form's sr-only boxes were laid
// out against the dialog SHELL, below its foot, so the clipping shell could be scrolled: a
// scrollIntoView on a field slid the shell up by its header and left a blank band at its foot (the
// after-build capture of the Edit Event dialog). The Body is positioned now,
// src/app/components/Modal.tsx ("DECISION Phase 88.9-52 (R4 L3, round 4, 2026-11-18)"), so the shell has nothing to scroll to.
// This test opens the dialog and scrolls only: it presses no submit. holdWrites is registered
// before the navigation and never hands a write on, so nothing reaches the shared fixture.
test.describe('Edit Event — the dialog shell cannot be scrolled (88.9-52 round 4)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('R4 L4 (88.9-52): with the Participants group scrolled to the top, the dialog shell has not moved and has nothing to scroll to', async ({ page }) => {
    const net = await holdWrites(page);
    await page.goto(E2E_EVENT_DETAIL_PATH);
    await page.getByRole('button', { name: 'Edit Event', exact: true }).click();
    await expect(editHeading(page)).toBeVisible();
    // The form has loaded (the body gate is open) once its submit reads Update Event.
    await expect(page.getByTestId('create-event-submit')).toHaveText('Update Event');
    const dialog = page.getByRole('dialog');
    const group = dialog.getByRole('group', { name: /^Participants/ });
    await expect(group).toBeVisible();

    // Guards, so the reads below are not true by having nothing to measure: the form holds
    // sr-only boxes, and it is taller than the dialog (its Body really scrolls).
    const before = await dialog.evaluate((shell) => {
      const body = Array.from(shell.children).find((el) => getComputedStyle(el).overflowY === 'auto');
      return {
        srOnly: body ? body.querySelectorAll('.sr-only').length : 0,
        bodyFound: Boolean(body),
        bodyPosition: body ? getComputedStyle(body).position : '',
        bodyScrollHeight: body ? body.scrollHeight : 0,
        bodyClientHeight: body ? body.clientHeight : 0,
      };
    });
    expect(before.bodyFound, 'the dialog has no scrolling Body child: the shell changed shape').toBe(true);
    expect(before.srOnly, 'the Body holds no sr-only box, so this test measures nothing').toBeGreaterThan(0);
    expect(
      before.bodyScrollHeight,
      'the form fits the dialog without scrolling at this size, so no box sits below the shell and this test measures nothing',
    ).toBeGreaterThan(before.bodyClientHeight);
    expect(before.bodyPosition, 'Modal.Body is not positioned').toBe('relative');

    // What the capture did, and what a find-in-page does: bring the group to the top.
    await group.evaluate((el) => el.scrollIntoView({ block: 'start' }));

    const after = await dialog.evaluate((shell) => {
      const body = Array.from(shell.children).find((el) => getComputedStyle(el).overflowY === 'auto');
      return {
        scrollTop: shell.scrollTop,
        scrollHeight: shell.scrollHeight,
        clientHeight: shell.clientHeight,
        bodyScrollTop: body ? body.scrollTop : -1,
      };
    });
    expect(after.scrollTop, 'the dialog shell itself scrolled: its header is off the top and a blank band shows at its foot').toBe(0);
    expect(
      after.scrollHeight,
      `the dialog shell has ${after.scrollHeight - after.clientHeight}px to scroll to: a box inside it is laid out below its foot`,
    ).toBeLessThanOrEqual(after.clientHeight + 1);
    // The scroll went where it belongs: the Body moved, and the header is still on screen.
    expect(after.bodyScrollTop, 'the Body did not scroll, so the scrollIntoView above did nothing').toBeGreaterThan(0);
    await expect(editHeading(page)).toBeInViewport();

    expect(net.count('PUT', /\/events\//)).toBe(0);
    expect(net.count('POST', /\/events/)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(editHeading(page)).toBeHidden();
  });
});

function createHeading(page: Page) {
  return page.getByRole('heading', { name: 'Create Event', exact: true });
}

test.describe('Create Event — late success and the ordinary close at the other hosts (88.6.1-68)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('R3: groupHomePage — a reopened Create dialog keeps what was typed through the first create\'s late success (confirm-only)', async ({ page }) => {
    const net = await holdWrites(page);
    const resolve = await holdUntilReleased(page, 'POST', /\/games\/resolve$/);
    await resolve.release({ id: '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b' }, 200);
    const post = await holdUntilReleased(page, 'POST', /\/events$/);

    await page.goto('/groupHomePage?id=' + E2E_GROUP_ID);
    await fillCreateEventManualEntry(page);
    await page.getByTestId('create-event-submit').click();
    await post.arrived;
    expect(post.count()).toBe(1);

    await page.keyboard.press('Escape');
    await expect(createHeading(page)).toBeHidden();
    await page.getByRole('button', { name: 'Create Event', exact: true }).click();
    await expect(createHeading(page)).toBeVisible();
    const submit = page.getByTestId('create-event-submit');
    await expect(submit).toBeVisible();
    const comments = page.getByRole('dialog').getByLabel('Comments');
    await comments.fill('second session');

    await post.release({}, 201);
    await expect(page.getByText('Event created', { exact: true })).toBeVisible();
    await expect(createHeading(page)).toBeVisible();
    await expect(comments).toHaveValue('second session');
    await expect(submit).toHaveText('Create Event');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Loading games...', { exact: true })).toHaveCount(0);
    expect(post.count()).toBe(1);
    expect(net.count('POST', /\/events$/)).toBe(0);
    await page.keyboard.press('Escape');
  });

  test('R4: groupPlanning — the email-link dialog creates, closes once and clears its parameters (confirm-only)', async ({ page }) => {
    await holdWrites(page);
    const post = await holdUntilReleased(page, 'POST', /\/events$/);
    await post.release({}, 201);
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

    await page.goto(
      '/groupPlanning?group_id=' + E2E_GROUP_ID + '&prefillDate=' + date + '&prefillTime=19:00&prefillDuration=120',
    );
    await expect(createHeading(page)).toBeVisible();
    await expect(page.getByLabel('Start Date & Time')).toHaveValue(date + 'T19:00');
    await page.getByTestId('create-event-submit').click();
    await expect(createHeading(page)).toBeHidden();
    await expect(page.getByText('Event created', { exact: true })).toBeVisible();
    // Phase 71.2 hotfix: the close clears the email-link parameters.
    await expect.poll(() => new URL(page.url()).searchParams.has('prefillDate')).toBe(false);
    await page.waitForTimeout(1000);
    await expect(createHeading(page)).toBeHidden();
    expect(post.count()).toBe(1);
  });
});
