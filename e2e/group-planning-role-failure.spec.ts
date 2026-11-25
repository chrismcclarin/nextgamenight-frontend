import { test, expect, type Page } from '@playwright/test';

import { scrubbedFetch } from './support/scrubbedFetch';

// Phase 88.6.1 plan 16 (D-25, copy row G6): the planning page tells a failed ROLE read, seen on a
// phone at 375 x 667.
//
// WHY THIS FILE EXISTS. Before 88.6.1-16 a failed members read on the planning page was swallowed:
// every admin control (the poll schedule tools, the response dashboard's admin actions) simply
// vanished with no word to the user. The page now shows the shipped compact notice ("Some personal
// controls are unavailable.") with a Retry. The jsdom suite (`src/app/groupPlanning/page.test.tsx`,
// arms R1-R6) proves the content, the one live region and the retry outcome; jsdom evaluates no
// layout, so THIS spec is where the notice is proven on a phone: exactly one visible line, inside
// the viewport, no page-level horizontal scroll, and Retry clears it.
//
// NOT RUN LOCALLY. The `phone` project depends on the `setup` project, which drives Auth0 Universal
// Login with credentials `playwright.config.ts` records as deliberately absent locally, and there is
// no `.auth/user.json` in the tree (C-14 in .planning/codebase/FE-TESTING-CONVENTIONS.md).
// Collection and typecheck are the only local proof this file has; the CI e2e job is the proof.
//
// SYNTHETIC FAILURE, NO REAL DATA. The route answers the browser's members GET with a 500 and a
// small made-up body while a flag is set; every other request, and every request once the flag is
// cleared, continues to the real backend unchanged. Nothing is written.

// Seeded fixture minted by the backend's scripts/e2e-fixtures.js in CI — the padding-budget idiom.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';

// Copy row G6: the shipped COMPACT_NOTICE (src/components/ui/FetchErrorBanner.tsx), no new string.
const G6_NOTICE = 'Some personal controls are unavailable.';

test.describe('groupPlanning — a failed role read on a phone (88.6.1-16, D-25 / G6)', () => {
  // Runs ONLY in the `phone` project (the padding-budget idiom): both `journeys` and `phone`
  // collect every e2e spec, so this is a runtime skip, not a collection filter.
  test.skip(({ isMobile }) => !isMobile, 'G6 at 375px: this spec measures the PHONE viewport only');

  test('the personal controls notice shows once inside the 375px viewport, and Retry clears it', async ({ page }) => {
    let failMembers = true;
    // The members read is `groupsAPI.getGroupMembers` -> GET `/groups/<id>/users` (src/lib/api.ts),
    // reached through the BFF proxy.
    await page.route(
      (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}/users`),
      async (route) => {
        if (route.request().method() !== 'GET' || !failMembers) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'synthetic failure (88.6.1-16 e2e)' }),
        });
      },
    );

    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

    // The VISIBLE line is a span; the announcing region beside it is an sr-only div, so this
    // locator cannot match the region.
    const line = page.locator('span', { hasText: G6_NOTICE });
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line).toHaveCount(1);

    const box = await line.boundingBox();
    expect(box, 'the notice line has no layout box').not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project has no viewport').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

    failMembers = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(line).toBeHidden({ timeout: 15_000 });
  });

  // 88.9-52 R4 D2 (owner 2026-11-18: wrap, no line limit; his worry: a long name broken up too much
  // to read, We/eke/nd W/arr/iors). The breadcrumb's group name was cut at 200px with an ellipsis;
  // it now wraps in full (src/app/groupPlanning/page.js ("AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the group name in this breadcrumb wraps")).
  // Read at 320 wide with the root text at 200%, with a two-word name answered in the browser (the
  // real group read is fetched and only its name is replaced; nothing is written): the whole name is
  // shown, each WORD is on a single line, nothing is cut, and the breadcrumb is inside the screen.
  // The page's own sideways scroll at this size is recorded in the log, not asserted here: this test
  // was written without a browser and the rest of the planning page at 320 / 200% is not its subject.
  // SPLIT Phase 88.9-52 (scoped check 3, L3): one body, two tests. The ordinary-text test keeps the uncut
  // style checks and the whole name gated; only the 320 / 200% read is the known failure.
  const breadcrumbProof = async (page: Page, large: boolean) => {
    const NAME = 'Weekend Warriors';
    await page.route(
      (url) => url.pathname.endsWith(`/groups/${E2E_GROUP_ID}`),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        const response = await scrubbedFetch(route);
        const body = await response.json();
        // The name sits at the top of the answer, or one level down, depending on the envelope.
        const patched =
          body && typeof body.name === 'string'
            ? { ...body, name: NAME }
            : body && body.data && typeof body.data.name === 'string'
              ? { ...body, data: { ...body.data, name: NAME } }
              : body && body.group && typeof body.group.name === 'string'
                ? { ...body, group: { ...body.group, name: NAME } }
                : body;
        await route.fulfill({ response, json: patched });
      },
    );
    await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    const link = nav.getByRole('link', { name: NAME, exact: true });
    await expect(link, 'R4 D2: the breadcrumb never showed the answered group name').toBeVisible({ timeout: 15_000 });

    if (large) {
      const height = page.viewportSize()?.height ?? 667;
      await page.setViewportSize({ width: 320, height });
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize), {
          message: 'R4 D2: the root font size did not become 32px after the 200% style tag',
        })
        .toBe('32px');
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth), { message: 'R4 D2: the window did not become 320px wide' }).toBe(320);
    }
    const at = large ? '320 / 200%' : 'ordinary text';

    const read = await link.evaluate((el) => {
      const node = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      const text = node?.textContent ?? '';
      // One entry per word: how many line boxes the word is drawn on.
      const words: Array<{ word: string; lines: number; left: number; right: number }> = [];
      if (node) {
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index ?? 0);
          range.setEnd(node, (match.index ?? 0) + match[0].length);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
          words.push({
            word: match[0],
            lines: new Set(rects.map((r) => Math.round(r.top))).size,
            left: Math.min(...rects.map((r) => r.left)),
            right: Math.max(...rects.map((r) => r.right)),
          });
        }
      }
      const cs = getComputedStyle(el);
      const navEl = el.closest('nav') as HTMLElement;
      const navBox = navEl.getBoundingClientRect();
      return {
        text,
        words,
        display: cs.display,
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        maxWidth: cs.maxWidth,
        nav: { left: navBox.left, right: navBox.right },
        window: document.documentElement.clientWidth,
        pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const line = JSON.stringify(read);
    // eslint-disable-next-line no-console -- the measured breadcrumb is recorded from the CI log
    console.log(`[88.9-52 R4 D2 planning breadcrumb] ${at}: ${line}`);
    expect(read.text.trim(), `R4 D2: the link does not hold the whole name (${line})`).toBe(NAME);
    expect(read.words.map((w) => w.word), `R4 D2: the name was not read as two words (${line})`).toEqual(['Weekend', 'Warriors']);
    for (const w of read.words) {
      expect(w.lines, `R4 D2: the word ${w.word} is broken across ${w.lines} lines (${line})`).toBe(1);
      expect(w.left, `R4 D2: the word ${w.word} starts left of the breadcrumb (${line})`).toBeGreaterThanOrEqual(read.nav.left - 0.5);
      expect(w.right, `R4 D2: the word ${w.word} ends right of the breadcrumb (${line})`).toBeLessThanOrEqual(read.nav.right + 0.5);
    }
    // Uncut: an inline link with no cap, no ellipsis and ordinary wrapping.
    expect(read.display, `R4 D2: the link is not inline text (${line})`).toBe('inline');
    expect(read.textOverflow, `R4 D2: the link still cuts its text (${line})`).not.toBe('ellipsis');
    expect(read.whiteSpace, `R4 D2: the link cannot wrap (${line})`).not.toMatch(/nowrap/);
    expect(read.maxWidth, `R4 D2: the link still has a width cap (${line})`).toBe('none');
    // The breadcrumb itself is inside the screen.
    expect(read.nav.left, `R4 D2: the breadcrumb starts off the screen (${line})`).toBeGreaterThanOrEqual(0);
    expect(read.nav.right, `R4 D2: the breadcrumb ends off the screen (${line})`).toBeLessThanOrEqual(read.window + 0.5);
  };

  test('R4 D2 (88.9-52): at ordinary text the breadcrumb shows a two-word group name whole, with no cut, cap or ellipsis', async ({ page }) => {
    await breadcrumbProof(page, false);
  });

  test('R4 D2 (88.9-52): at 320 wide with 200% text a two-word group name wraps by whole words in the breadcrumb, uncut', async ({ page }) => {
    // DECISION Phase 88.9-52 (owner 2026-11-18): this 320 wide / 200% text read is marked as an
    // expected failure, kept running, over skipping it, deleting it or patching the screen. The
    // fix / see / fix rule stopped screen-by-screen patching at this size; Phase 89.6 researches
    // the large-text method and owns this read. When the screen is fixed this test reports an
    // unexpected pass: remove the test.fail line then. Removing it earlier is a decision, not a cleanup.
    // AMENDED Phase 89.6-39 (O-M1-bare): the screen is fixed and the line is removed. CI runs
    // 45561514680 and 45562275271 (FE be1bca1 and bf74366) reported the unexpected pass on the first
    // try and on the retry, once the planning breadcrumb box moved to px-edge-card (12px a side at
    // 200% text, was 24): the two-word group name gained the room it needs. This read is a plain test now.
    await breadcrumbProof(page, true);
  });
});
