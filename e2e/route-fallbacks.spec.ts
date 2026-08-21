import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 88 plan 30 — SPEC Req 3 acceptance: the route boundaries plan 88-09 added
 * render the DESIGNED surface, not an unstyled text dump, and leak nothing.
 *
 * PROJECT GUARD: every new spec joins BOTH projects automatically — `journeys` and
 * `phone` share `testMatch: /.*\.spec\.ts/` (playwright.config.ts:44 and :87). This
 * file is `journeys`-only, matching the guard shape at tailwind-v4-styles.spec.ts:57
 * rather than the inverted one in touch-targets.spec.ts. Nothing asserted here is a
 * phone-tenet claim: these are rendering and information-disclosure assertions, and
 * running them twice per CI job would double a held-request test's wall clock for no
 * additional signal. If a phone-specific fallback assertion is ever added (a fallback
 * that reflows at 375px, say), move THAT test into its own describe with the inverse
 * guard — do not delete this one.
 *
 * WHY THIS FILE EXISTS: 88-09 created 11 `loading.tsx`, 11 `error.tsx` and the app's
 * first `not-found.tsx`, all thin files rendering three shared primitives. Their unit
 * suites prove the primitives render; the machine grep proves no `error.tsx` passes an
 * error into the DOM. Neither can see whether Next actually MOUNTS these boundaries in
 * a real browser with the stylesheet loaded — which is the whole of Req 3's "renders
 * STYLED (not unstyled text dumps) when forced".
 *
 * THE ERROR BOUNDARY IS DELIBERATELY NOT DRIVEN HERE, and this is the part a later
 * reader will want to "finish". It cannot be forced without adding production code,
 * which the plan forbids and which would be worse than the gap:
 *   - Every one of the 11 boundaried routes is a `'use client'` page whose data lands
 *     in `useEffect`, so the server render cannot be made to throw from outside.
 *   - Forcing a client render throw by poisoning an API response does not work on this
 *     codebase: the fetch call sites are defensive (`friends/page.js:136` is
 *     `Array.isArray(data) ? data : []`, and the pattern repeats), so a malformed
 *     payload produces an empty list, not a throw. A test that depended on finding a
 *     NON-defensive call site would silently stop testing the boundary the moment that
 *     site was hardened — a gate that goes green when the app improves.
 *   - `test-sentry/page.js` reports to Sentry from a try/catch and from a `setTimeout`;
 *     neither is a render throw, so neither reaches an `error.tsx`.
 * What DOES cover it: `AppErrorBoundary.test.tsx` drives a real render throw through the
 * real `ErrorFallback` JSX (styled fallback, both actions, Sentry auto-report, reset-loop
 * guard), `ErrorFallback.test.tsx` covers the primitive, and 88-09's grep covers the ASVS
 * V7 contract across all 11 files. Adding a `?throw=1` hook to a page to close this in
 * e2e would put a denial-of-service switch in production to make a test greener.
 *
 * SELECTOR POLICY (e2e/invite.spec.ts:18): role, label and text only — never Tailwind
 * classes. The computed-style reads below start FROM a role-located element and walk the
 * DOM; no locator selects by class.
 *
 * Fixtures: none needed. Both surfaces render for any authenticated session, so this file
 * declares no `E2E_*` env consts. It still requires CI's storageState like every other
 * spec — do not run locally (playwright.config.ts:19-21).
 */

/** D-11 dark-theme pre-assertion (tailwind-v4-styles.spec.ts:78-86). On these two
 *  surfaces it is more than a pre-condition: Next's UNSTYLED default 404 — what this app
 *  shipped before 88-09 — renders outside the app shell entirely, so a resolved theme on
 *  <html> is itself evidence that the designed boundary, not the default, is on screen. */
async function assertDarkTheme(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveClass(/dark/);
}

/**
 * ASVS V7 (and T-88-04-01): a designed dead end shows designed copy and nothing else.
 * Asserted as ABSENCE, on the rendered text of the whole page — the one shape that can
 * catch a leak nobody anticipated, unlike checking that a specific field is missing.
 */
async function assertNoDiagnosticLeak(page: Page, surface: string): Promise<void> {
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length, `${surface}: the page rendered no text at all, so every absence assertion below would pass vacuously`).toBeGreaterThan(0);

  const forbidden: Array<[RegExp, string]> = [
    [/digest/i, "Next.js's error `digest` — the field error.tsx receives and must never render"],
    [/\bat\s+\S+\s*\(.*:\d+:\d+\)/, 'a V8 stack frame'],
    [/\.(?:js|jsx|ts|tsx|mjs|cjs):\d+:\d+/, 'a source location (file:line:column)'],
    [/node_modules|webpack|\.next\/(?:static|server)/i, 'a build-internal path'],
    [/\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b/, 'a raw JS error class name'],
    [/\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|sequelize|postgres)\b/i, 'a backend/infrastructure detail'],
  ];

  for (const [pattern, what] of forbidden) {
    expect(
      text,
      `${surface} leaked ${what}. Route boundaries render DESIGNED COPY ONLY (ASVS V7 / T-88-04-01): the thrown value's detail goes to Sentry at the boundary, never to the DOM. Rendered text was:\n${text}`,
    ).not.toMatch(pattern);
  }
}

test.describe('SPEC Req 3 — route boundaries render designed surfaces, not text dumps', () => {
  // Inverse of touch-targets.spec.ts:130 — see the PROJECT GUARD note above.
  test.skip(({ isMobile }) => !!isMobile, 'Req 3 rendering + disclosure assertions are viewport-independent; the desktop journeys project owns them so a held-request test runs once per CI job');

  test('an unknown URL renders the designed 404 inside the app shell, with its way back', async ({ page }) => {
    // A path with no matching segment anywhere in src/app. The 88-30 suffix keeps it
    // from colliding with any future real route.
    const response = await page.goto('/no-such-route-88-30');

    // The designed page must come with the right STATUS too — a 200 here would mean the
    // app is serving a soft 404, which is an SEO and correctness defect the styling
    // assertions below would happily pass over.
    expect(
      response?.status(),
      `an unknown URL returned HTTP ${response?.status()} — not-found.tsx must be served with 404, not a soft 200`,
    ).toBe(404);

    await assertDarkTheme(page);

    // The designed copy, at the level 88-18 fixed it to. `level: 1` is load-bearing:
    // `EmptyState` renders `<h3>` by default and not-found.tsx passes `headingLevel="h1"`
    // (DEF-88-09-01). If that prop is dropped, this fails rather than quietly regressing
    // the page to no `<h1>` at all.
    const heading = page.getByRole('heading', { level: 1, name: 'This page took a wrong turn' });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Designed dead end, not a cul-de-sac: the action that gets the person out.
    await expect(
      page.getByRole('link', { name: 'Back to your groups' }),
      'the 404 rendered without its escape action — a dead end with no way back is the state 88-09 existed to remove',
    ).toBeVisible();

    // STYLED, not a text dump. Next's pre-88-09 default was literally unstyled text on a
    // white page, so the claim under test is "the stylesheet loaded and the design tokens
    // resolved on this surface". Walk up from the heading for the card frame rather than
    // selecting it by class (selector policy).
    const frame = await heading.evaluate((el) => {
      let node: Element | null = el;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        const radius = parseFloat(style.borderTopLeftRadius) || 0;
        const bg = style.backgroundColor;
        const painted = bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
        if (radius > 0 && painted) {
          return { found: true, radius, backgroundColor: bg, tagName: node.tagName.toLowerCase() };
        }
        node = node.parentElement;
      }
      return { found: false, radius: 0, backgroundColor: '', tagName: '' };
    });
    expect(
      frame.found,
      'no painted, rounded ancestor was found above the 404 heading — the page is rendering as unstyled text, which is exactly the pre-88-09 Next default this surface replaced. Check that the app stylesheet loaded and that not-found.tsx still renders inside the ErrorFallback page frame',
    ).toBe(true);

    await assertNoDiagnosticLeak(page, 'the designed 404');
  });

  test('the route loading boundary renders the shared RouteFallback while a segment is in flight', async ({ page }) => {
    /* Forcing mechanism, and the reason it is a HELD request rather than a delay: the
       loading boundary is transient by construction, so any timing-based probe races it.
       Holding the segment's payload open makes the window unbounded — the fallback cannot
       have unmounted before the assertion, because the data it is waiting on has not been
       allowed to arrive. The hold is released inside the test, so nothing leaks.

       The route is installed BEFORE the first navigation on purpose: Next prefetches
       in-viewport `<Link>`s, and a prefetch that completed during page load would make the
       click resolve from cache with no loading state at all — the fallback would never
       render and the test would fail for a reason that has nothing to do with the boundary.

       DOCUMENT requests are passed straight through: holding those would hang the
       navigation itself rather than the segment fetch, and the loading boundary is a
       CLIENT-router transition state. A hard navigation to a `'use client'` page never
       shows it (the server render completes immediately; the data lands in useEffect),
       which is also why this test clicks a link instead of calling page.goto. */
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holds = 0;

    await page.route('**/friends**', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.continue();
        return;
      }
      // Prefetches PASS THROUGH — this is the half the first CI run got wrong.
      // Next prefetches a dynamic route only up to its loading.js, and that
      // prefetched payload is the very fallback this test asserts on: holding
      // the prefetch too starves the router of the boundary, so the old page
      // simply persists in the transition and the fallback never appears.
      // Only the on-click navigation fetch (no prefetch header) is held. If
      // the route is ever STATIC in a prod build, the click resolves entirely
      // from the prefetch cache, nothing is held, and the anti-vacuity holds
      // assertion below fails loudly — that failure means the mechanism cannot
      // force this boundary any more, not that the boundary broke.
      const headers = await route.request().allHeaders();
      if (headers['next-router-prefetch'] !== undefined || headers['purpose'] === 'prefetch') {
        await route.continue();
        return;
      }
      holds += 1;
      await held;
      try {
        await route.continue();
      } catch {
        // Released during teardown (the finally below runs release() before
        // unroute): the request is already handled or gone. Swallowing this is
        // correct — the alternative is the "Route is already handled!" noise
        // that masked the real failure in the first CI run.
      }
    });

    try {
      await page.goto('/');
      await assertDarkTheme(page);

      await page.getByRole('link', { name: 'Friends', exact: true }).click();

      // `RouteFallback` is a `role="status"` live region whose accessible name is the
      // label its caller passes — `friends/loading.tsx` passes "Finding your people...".
      // Locating by ROLE + NAME asserts the announced-not-silent contract (AR R1-M18) at
      // the same time as the rendering one: a fallback that lost its aria-label would
      // still look right and would still fail here.
      const fallback = page.getByRole('status', { name: 'Finding your people...' });
      await expect(
        fallback,
        'the /friends loading boundary never rendered. Before touching loading.tsx or RouteFallback, check this test\'s forcing mechanism: it depends on the segment payload being an interceptable non-document request to a URL containing "/friends". If Next changes how the client router fetches segments, the hold stops working and this fails while the boundary is perfectly healthy',
      ).toBeVisible({ timeout: 15_000 });

      // STYLED: the spinner is a real, animated, token-coloured element — not the bare
      // text a boundary rendered outside the stylesheet would produce.
      const spinner = await fallback.evaluate((root) => {
        const el = root.querySelector('[aria-hidden="true"]');
        if (!el) return { found: false, animationName: '', borderBottomWidth: 0, borderBottomColor: '' };
        const style = getComputedStyle(el);
        return {
          found: true,
          animationName: style.animationName,
          borderBottomWidth: parseFloat(style.borderBottomWidth) || 0,
          borderBottomColor: style.borderBottomColor,
        };
      });
      expect(
        spinner.found,
        'the loading fallback rendered its label but no decorative spinner element — RouteFallback renders the arc as an aria-hidden sibling of the label, so this means the primitive changed shape or the boundary is rendering something else entirely',
      ).toBe(true);
      expect(
        spinner.animationName,
        `the loading spinner's computed animation-name is "${spinner.animationName}" — expected a running animation. A frozen spinner reads as a hung app, which is why RouteFallback's own DECISION marker rejects a reduced-motion kill-switch and says to SLOW it instead. 88-28's prefers-reduced-motion block exempts .animate-spin for exactly this reason`,
      ).not.toBe('none');
      expect(
        spinner.borderBottomWidth,
        `the loading spinner's border-bottom-width computed to ${spinner.borderBottomWidth}px — the arc is drawn as a bottom border, so 0 means the stylesheet did not reach this surface`,
      ).toBeGreaterThan(0);

      await assertNoDiagnosticLeak(page, 'the route loading boundary');

      // Anti-vacuity for the forcing mechanism itself: if nothing was actually held, the
      // fallback we just measured appeared for some other reason and this test proves
      // nothing about the boundary.
      expect(
        holds,
        'the route handler held zero non-document requests, so the loading state was not produced by this test\'s mechanism — the assertions above are coincidental and must not be trusted',
      ).toBeGreaterThan(0);
    } finally {
      // Release before unrouting, so no request is left hanging on a dead handler.
      release();
      await page.unroute('**/friends**');
    }

    // Presence THEN absence: the boundary must be transient. A fallback that never
    // unmounts is a stuck screen, and a presence-only assertion cannot tell the two apart.
    await expect(
      page.getByRole('status', { name: 'Finding your people...' }),
      'the loading boundary was still on screen after its segment payload was released — loading.tsx must unmount when the segment resolves',
    ).toHaveCount(0, { timeout: 15_000 });
  });
});
