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

  /* The loading-boundary probe that lived here (through two CI rounds of PR #22)
     is DELETED, not skipped: every route in the fleet is statically prerendered,
     so Next prefetches the full payload and a prod client-navigation resolves
     entirely from the prefetch cache — there is no in-flight segment fetch to
     hold, and loading.tsx can never be forced visible in a prod build. Round 1
     held the prefetch (starving the router of the boundary itself); round 2
     passed the prefetch through (the click then never fetched). Both red for
     mechanism reasons, the boundary healthy throughout. The adoption proof it
     carried now lives in src/app/routeLoadingBoundaries.test.tsx (per-file fleet
     render pins); the primitive contract stays in RouteFallback.test.tsx. If a
     route ever goes DYNAMIC, an e2e hold becomes forceable again — revive from
     git history and let the prefetch through. */
});
