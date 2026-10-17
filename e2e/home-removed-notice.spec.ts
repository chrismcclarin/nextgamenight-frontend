import { test, expect, type Page } from '@playwright/test';

/** Plan 88.6.1-82: the in-page trace written by the recorder below. `attach` = the region (or
 *  an element containing it) was added to the document, with the region's text at that moment;
 *  `fill` = nodes were added INSIDE the already-attached region, with its text afterwards. */
declare global {
  interface Window {
    __removedNoticeTrace?: Array<{ kind: 'attach' | 'fill'; text: string }>;
  }
}

/**
 * Phase 88.6.1 plan 82 (Req 8 / Req 5, D-22 / D-42 / D-31 / D-04 / D-07) — the home page's
 * removed-from-group notice ("You're no longer a member of {group}."), proven at 375x667.
 *
 * What it proves in a real browser: the notice's polite region is attached EMPTY on arrival and
 * the shipped sentence arrives LATER inside that same region (a polite region inserted already
 * holding its text is not announced — AT-4, `research/APPENDIX-AT.md:297-299`); nothing
 * overflows the phone width; Dismiss empties the region and focus lands on `main`, never <body>;
 * and with nothing to say the region's wrapper takes 0px.
 *
 * Read-only: no write is made, and the group name comes from the URL this spec sets itself,
 * never from the backend. CI-run only (the `e2e` job, phone project). It takes no screenshot and
 * makes no attachment (DECISION 88.6-59).
 */

const REGION = '[data-testid="removed-from-group-status"]';

async function installRecorder(page: Page) {
  await page.addInitScript((selector: string) => {
    window.__removedNoticeTrace = [];
    const start = () => {
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== 'childList') continue;
          const target = record.target as Element;
          if (target.matches?.(selector) && record.addedNodes.length > 0) {
            window.__removedNoticeTrace?.push({ kind: 'fill', text: target.textContent ?? '' });
            continue;
          }
          for (const node of Array.from(record.addedNodes)) {
            if (!(node instanceof Element)) continue;
            const region = node.matches(selector) ? node : node.querySelector(selector);
            if (region) {
              window.__removedNoticeTrace?.push({ kind: 'attach', text: region.textContent ?? '' });
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    };
    start();
  }, REGION);
}

async function wrapperHeight(page: Page) {
  return page.locator(REGION).evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().height);
}

test.describe('Phase 88.6.1-82 — the removed-from-group notice (phone project)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-tenet requirement — phone project only');

  test('the removed-from-group notice is spoken from a region that was already there, and Dismiss keeps focus (88.6.1-82)', async ({
    page,
  }) => {
    await installRecorder(page);
    await page.goto('/?removedFrom=' + encodeURIComponent('Removed Check Group'));

    const region = page.locator(REGION);
    await expect(region).toHaveText("You're no longer a member of Removed Check Group.");

    const trace = await page.evaluate(() => window.__removedNoticeTrace ?? []);
    const firstAttach = trace.findIndex((entry) => entry.kind === 'attach');
    expect(firstAttach, 'the region was never seen being attached').toBeGreaterThanOrEqual(0);
    expect(trace[firstAttach].text, 'the region was attached already holding text').toBe('');
    const laterFill = trace.findIndex(
      (entry, index) =>
        index > firstAttach &&
        entry.kind === 'fill' &&
        entry.text === "You're no longer a member of Removed Check Group."
    );
    expect(laterFill, 'the sentence never arrived inside the already-attached region').toBeGreaterThan(firstAttach);

    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits, 'the page overflows the phone width with the notice shown').toBe(true);

    const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismiss.focus();
    await page.keyboard.press('Enter');

    await expect(region).toHaveText('');
    await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ''))
      .toBe('MAIN');
    expect(await wrapperHeight(page)).toBe(0);
  });

  test('with no removed group the region is mounted, empty and takes no space (88.6.1-82)', async ({ page }) => {
    await page.goto('/');
    // Vacuity guard: the signed-in home really rendered (the phone-only Calendar entry point).
    await expect(page.getByRole('button', { name: /^calendar\b/i })).toBeVisible();

    const region = page.locator(REGION);
    await expect(region).toBeAttached();
    await expect(region).toHaveText('');
    expect(await wrapperHeight(page)).toBe(0);
  });
});
