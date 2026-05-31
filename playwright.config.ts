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
  },
  projects: [
    // The login journey + storageState producer (D-05).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'journeys',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'], // runs after the login/setup project
      use: { storageState: '.auth/user.json' }, // reuse the cached appSession cookie
    },
  ],
});
