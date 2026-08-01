import { defineConfig } from '@playwright/test';

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
  ],
});
