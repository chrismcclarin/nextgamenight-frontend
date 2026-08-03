import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config — TEST-02 / TEST-03 (D-05 storageState pattern).
 *
 * The `setup` project drives Auth0 Universal Login ONCE (e2e/auth.setup.ts) and
 * writes the appSession cookie to `.auth/user.json`. The `journeys` project depends
 * on `setup` and reuses that storageState. Its testMatch is a glob over EVERY
 * e2e/*.spec.ts — currently the 5 user journeys (availability-submit, create-event,
 * create-group, invite, rsvp) plus the tailwind-v4-styles spot-check (Plan 10) —
 * so specs added to e2e/ join it automatically; don't restate a count here (that
 * count went stale twice: Phase 87.7 D-16, then again when Plan 10 added its spec).
 *
 * THREE projects since Phase 87.7: `setup`, `journeys` (desktop) and `phone`
 * (MOB-03; iPhone SE (3rd gen) as of Phase 87.8 D-06). The `phone` project does NOT
 * run on pull requests yet — ci.yml pins the PR lane to `--project=setup
 * --project=journeys` (D-13/D-15); plan 87.8-12 lands the arming edit. See the
 * marker on the project itself.
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
    // MOB-03 (Phase 87.7) — the phone-viewport project. Until it landed the suite had NEVER
    // run at phone width: this config declared only setup + journeys, with no `devices` import
    // and no viewport anywhere, so every spec ran at Playwright's 1280x720 default — while the
    // project's phone-forward tenet makes the phone the PRIMARY surface.
    //
    // DECISION Phase 87.8 (D-06): the preset is `devices['iPhone SE (3rd gen)']` — 375 x 667,
    // probed live against the installed @playwright/test 1.60.0 registry (isMobile + hasTouch
    // true, webkit default — hence the chromium override below) — chosen OVER keeping 87.7's
    // iPhone 13 preset at 390 x 664. One number everywhere: the gate, the design floor, the
    // acceptance-criteria geometry and the owner-walkthrough method are all 375px, so a spec,
    // a budget derived from 375 (e.g. padding-budget's 20%), and a walkthrough finding can
    // never disagree about the width they were measured at. Fluid phone-first design means
    // every wider phone only gains room — 390 was a CI proxy, never the design target.
    // TRAP: the BARE `devices['iPhone SE']` key is the 320 x 568 FIRST generation — do not
    // "simplify" the key to it. `devices['iPhone 8']` is an exact-geometry (375 x 667)
    // fallback if the SE 3rd-gen key is ever removed upstream.
    //
    // SUPERSEDED KNOWINGLY, not bulldozed: 87.7's D-20 record — viewport MEASURED live at
    // 390 x 664 on the iPhone 13 preset (the 390 x 844 in D-14 and the original SPEC R9 draft
    // was device SCREEN height, not viewport) — was correct for that preset; it is history
    // now, not a live constraint. Likewise 87.7's D-13 config-only status ends with Phase
    // 87.8: this phase arms the lane. The `--project=phone` arming edit in ci.yml belongs to
    // plan 87.8-12 ALONE, landed immediately after its green combined run and negative
    // control (ML-26) — plan 09 wired the fixtures, guards and pre-arm gate but left the PR
    // lane unarmed.
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
        ...devices['iPhone SE (3rd gen)'], // 375 x 667 viewport, isMobile + hasTouch (registry-probed, @playwright/test 1.60.0)
        browserName: 'chromium', // DECISION Phase 87.7 D-14: the explicit chromium override is
        // MANDATORY and MUST stay below the spread above. `devices['iPhone SE (3rd gen)']` carries
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
