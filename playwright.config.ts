import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config — TEST-02 / TEST-03 (D-05 storageState pattern).
 *
 * The `setup` project drives Auth0 Universal Login ONCE (e2e/auth.setup.ts) and
 * writes the appSession cookie to `.auth/user.json`. The `journeys` project depends
 * on `setup` and reuses that storageState, so the four journey specs run auth-free.
 *
 * Credentials come from CI env (`E2E_AUTH0_USER`/`E2E_AUTH0_PASS`, GitHub secrets
 * wired in Plan 05). They are intentionally absent locally — this suite is designed
 * to run in CI after the human Auth0/secrets checkpoint.
 *
 * Source: playwright.dev/docs/auth (project-dependencies pattern).
 */
export default defineConfig({
  testDir: './e2e',
  // Auto-waits everywhere; assert on visible role/text outcomes, not network internals.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    // CI failures upload test-results/ — a screenshot shows WHAT page rendered
    // when a locator never resolved (e.g. an Auth0 error page vs a renamed field).
    screenshot: 'only-on-failure',
  },
  projects: [
    // The login journey + storageState producer (D-05).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'journeys',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'], // runs after the login/setup project
      use: {
        storageState: '.auth/user.json', // reuse the cached appSession cookie
        colorScheme: 'dark', // DECISION Phase 87.7 D-11: pin dark, chosen OVER leaving
        // Playwright's default. The premise is MEASURED, not assumed: Playwright emulates
        // `colorScheme: 'light'` and this config previously set none (the shared `use` block
        // still does not), so the suite has most likely been exercising LIGHT mode all along —
        // while dark is the theme the app is designed for (ThemeProvider `defaultTheme="dark"`)
        // and is this phase's only visual gate.
        //
        // Pinning here is only HALF the mechanism and must not be read as sufficient:
        // `e2e/auth.setup.ts` calls `storageState({ path: AUTH_FILE })`, which bakes
        // localStorage into the reused `.auth/user.json`. A stored next-themes `theme` key
        // therefore outranks `defaultTheme` regardless of what the config emulates, so Plan 10's
        // computed-style spec asserts `<html class="dark">` at RUNTIME as the other half.
        // Removing EITHER half is a decision, not a cleanup.
      },
    },
    // MOB-03 (Phase 87.7, D-13/D-14) — the phone-viewport project. Until this landed the
    // suite had NEVER run at phone width: this config declared only setup + journeys, with no
    // `devices` import and no viewport anywhere, so every spec ran at Playwright's 1280x720
    // default — while the project's phone-forward tenet makes the phone the PRIMARY surface.
    //
    // DECISION Phase 87.7 D-13: this project is CONFIG-ONLY this phase, chosen OVER arming it
    // as a blocking PR gate now. The CI PR lane excludes it by pinning
    // `--project=setup --project=journeys` (see .github/workflows/ci.yml); Phase 87.8 wires it
    // in and OWNS the resulting fixes. Mobile failures found here are reported, not fixed —
    // a migration phase is not blocked by known-broken mobile. Trade-off on the record: the
    // phone surface is unwatched on PRs until 87.8. Adding `--project=phone` to ci.yml is
    // Phase 87.8's, and it is a decision, not a cleanup.
    //
    // Viewport is MEASURED at 390 x 664 (D-20 — a standalone probe read `page.viewportSize()`
    // live). The 390 x 844 written into D-14 and the original SPEC R9 draft is the device
    // SCREEN height, not the viewport; the SPEC as amended carries the corrected 390 x 664.
    //
    // Pitfall 7 interacts with this project and is expected, not a bug: v4 wraps every `hover:`
    // utility in `@media (hover: hover)`, which v3 never did, and the iPhone 13 preset sets
    // `isMobile: true, hasTouch: true` — the probe measured `matchMedia('(hover: hover)')` as
    // false. All 222 `hover:` occurrences are therefore INERT here. Some of what looks like a
    // mobile-only layout failure will be that instead.
    {
      name: 'phone',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'], // same login/setup producer as journeys
      use: {
        ...devices['iPhone 13'], // 390 x 664 viewport, isMobile + hasTouch (D-20, measured)
        browserName: 'chromium', // DECISION Phase 87.7 D-14: the explicit chromium override is
        // MANDATORY and MUST stay below the spread above. `devices['iPhone 13']` carries
        // `defaultBrowserType: 'webkit'`, and ci.yml installs chromium ONLY
        // (`npx playwright install --with-deps chromium`). Chosen OVER the preset's webkit
        // default; also chosen OVER widening the browser install to make webkit work, because
        // the override IS the fix and the narrow install is deliberate. Deleting this line, or
        // moving it above the spread, is a HARD LAUNCH FAILURE — not a cleanup.
        storageState: '.auth/user.json', // the SAME state journeys reuses — deliberately not a
        // second path: ci.yml's failure-artifact upload excludes `.auth/` (T-82-12), and a
        // second storageState path would force that exclusion to be re-audited for no benefit.
        colorScheme: 'dark', // same D-11 reasoning as journeys, above
      },
    },
  ],
});
