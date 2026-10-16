import { test, expect, type Locator, type Page } from '@playwright/test';

// Phase 88.6.1-33 — the Send-feedback dialog (FeedbackButton.js, opened from the phone menu's
// "Send feedback" row) at 375px, in the `phone` project only.
//
// WHAT EACH TEST MEASURES, in a real engine, that jsdom cannot (C-11 / CT-3):
//   P1 — the pressed Submit while sending (D-35, Req 4): aria-disabled, never natively disabled,
//     still FOCUSED, and one request however it is pressed twice; then copy row F2 on a failure
//     with no known cause, in the dialog's own alert region (empty and visually hidden before
//     the send, D-22), visible and inside the 375px viewport.
//   P2 — a successful send (Req 5): the thank-you line takes focus, the dialog closes itself
//     after its shipped two-second delay, and focus returns to the menu toggle.
//
// EVERY TEST INTERCEPTS THE FEEDBACK WRITER AND FULFILS IT LOCALLY. It never forwards the
// request (no continue, no fetch through to the network): each accepted POST to the real
// writer files a GitHub issue in the private repo, so a forwarded request from CI would file a
// real issue. The hit counter doubles as the vacuity guard that the interception happened.
//
// NOT RUN LOCALLY. The `phone` project depends on the `setup` project, which signs in through
// Auth0 with credentials that exist only in CI (there is no local `.auth` state). CI's `e2e` job
// runs this file on the phase PR. Both tests are RED by construction against the tree before
// 88.6.1-33 (the busy Submit carried the native disabled attribute, the failure box had no
// alert role, and the thank-you line was never focused); the jsdom pins in
// src/app/components/FeedbackButton.test.tsx carry the red half.
//
// Selector policy (feedback-stacking.spec.ts): role, label and text only, never a Tailwind
// class. Every alert query is scoped to the dialog, because the framework's route announcer is
// also an alert. Every typed value is a synthetic literal; no environment value is read.

const WRITER = '**/api/feedback/github';
const F2 = "We couldn't send your feedback. Please try again.";
const THANKS = 'Thanks! Your feedback has been submitted.';
const DRAFT = 'Synthetic e2e feedback typed on a phone.';

// The nav row is the "Send feedback" button that carries visible text (the FAB is icon-only and
// hidden below md). Vacuity guard: exactly one.
async function openFromMenu(page: Page): Promise<Locator> {
  const toggle = page.getByRole('button', { name: 'Toggle menu' });
  await toggle.click();
  const row = page.getByRole('button', { name: 'Send feedback' }).filter({ hasText: 'Send feedback' });
  await expect(row, 'the menu "Send feedback" row must resolve exactly one element').toHaveCount(1);
  await row.click();
  await expect(page.getByRole('heading', { name: 'Send Feedback' })).toBeVisible();
  return page.getByRole('dialog', { name: 'Send Feedback' });
}

test.describe('phone: feedback submit (88.6.1-33)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-project block — the menu row exists below md only');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Toggle menu' }),
      'the menu toggle must render — a missing toggle means the page or the signed-in session did not load',
    ).toBeVisible();
  });

  test('P1: a pressed Submit stays focused and busy, a second tap sends nothing, and an unexplained failure reads F2 in the dialog alert region', async ({
    page,
  }) => {
    let hits = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/feedback/github', async (route) => {
      hits += 1;
      await gate;
      // 418 with an empty body: no code, no known status, so the client derives `unknown`.
      await route.fulfill({ status: 418, contentType: 'application/json', body: JSON.stringify({}) });
    });

    const dialog = await openFromMenu(page);
    const region = dialog.getByRole('alert');
    await expect(region, 'the dialog must hold exactly one alert region before any send').toHaveCount(1);
    await expect(region, 'the alert region must be EMPTY before the send').toHaveText('');
    await expect(region, 'the empty alert region must be visually hidden (D-22)').toHaveClass(/(^|\s)sr-only(\s|$)/);

    await dialog.getByPlaceholder("Tell us what's on your mind...").fill(DRAFT);
    await dialog.getByRole('button', { name: 'Submit' }).click();

    const busy = dialog.getByRole('button', { name: 'Submitting...' });
    await expect(busy, 'Submit must be aria-disabled while sending').toHaveAttribute('aria-disabled', 'true');
    await expect(busy, 'Submit must NOT be natively disabled while sending (rule of POSITION)').not.toHaveAttribute(
      'disabled',
    );
    await expect(busy, 'the pressed Submit must keep focus while sending').toBeFocused();
    await expect.poll(() => hits, { message: 'the first tap must reach the intercepted writer once' }).toBe(1);

    // A second tap while pending. `force` because Playwright's actionability check treats an
    // aria-disabled control as disabled and would wait instead of tapping, which is the press
    // this test exists to make.
    await busy.click({ force: true });
    // The one sanctioned fixed wait: proving that a second request did NOT happen needs elapsed
    // time, and there is no positive signal for an absence.
    await page.waitForTimeout(500);
    expect(hits, `a second tap while pending must not send — ${hits} requests were made`).toBe(1);

    release();
    await expect(region, 'copy row F2 on a failure with no known cause, exact text').toHaveText(F2);
    await expect(region).toBeVisible();
    const box = await region.boundingBox();
    expect(box, 'the alert region must have a layout box once it holds text').not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project must define a viewport').not.toBeNull();
    if (box && viewport) {
      expect(box.x, `the alert box starts at ${box.x}px, left of the viewport`).toBeGreaterThanOrEqual(0);
      expect(
        box.x + box.width,
        `the alert box ends at ${box.x + box.width}px, past the ${viewport.width}px viewport`,
      ).toBeLessThanOrEqual(viewport.width + 0.5);
    }
    const submit = dialog.getByRole('button', { name: 'Submit' });
    await expect(submit, 'Submit must read "Submit" again after the failure').toHaveCount(1);
    await expect(submit, 'Submit must still hold focus after the failure').toBeFocused();
    expect(hits).toBe(1);

    await page.unroute(WRITER);
  });

  test('P2: a successful send focuses the thank-you line, the dialog closes itself, and focus returns to the menu toggle', async ({
    page,
  }) => {
    let hits = 0;
    await page.route('**/api/feedback/github', async (route) => {
      hits += 1;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    const dialog = await openFromMenu(page);
    await dialog.getByPlaceholder("Tell us what's on your mind...").fill(DRAFT);
    await dialog.getByRole('button', { name: 'Submit' }).click();

    await expect(
      page.getByText(THANKS),
      'after a successful send focus must land on the thank-you line, not on the dialog container or <body>',
    ).toBeFocused();
    await expect(
      page.getByRole('heading', { name: 'Send Feedback' }),
      'the dialog must close itself after its two-second delay',
    ).toHaveCount(0, { timeout: 5000 });
    await expect(
      page.getByRole('button', { name: 'Toggle menu' }),
      'closing the dialog must return focus to the menu toggle (owner ruling 6, the invoker override)',
    ).toBeFocused();
    expect(hits, `exactly one request must reach the intercepted writer — ${hits} did`).toBe(1);

    await page.unroute(WRITER);
  });
});
