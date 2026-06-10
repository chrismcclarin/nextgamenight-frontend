import { test as setup, expect } from '@playwright/test';

/**
 * Login journey + storageState producer (D-05, TEST-03).
 *
 * Runs ONCE as the `setup` project (see playwright.config.ts). It drives the real
 * Auth0 Universal Login hosted page via the @auth0/nextjs-auth0 `/api/auth/login`
 * route, then persists the resulting `appSession` cookie to `.auth/user.json`. The
 * four journey specs declare `dependencies: ['setup']` + `storageState` and reuse
 * this cookie, so they never re-authenticate.
 *
 * Credentials are read ONLY from env (GitHub secrets in CI; absent locally). They
 * are NEVER logged — leaking them would defeat the secret. (Threat T-82-08.)
 *
 * This is also the 5th critical journey (login). Requires a test user with MFA off
 * (Plan 05 human checkpoint / Open Q1) — there is no code fallback for MFA.
 */
const AUTH_FILE = '.auth/user.json';

setup('login + cache session', async ({ page, baseURL }) => {
  const user = process.env.E2E_AUTH0_USER;
  const pass = process.env.E2E_AUTH0_PASS;

  // Fail loudly (without echoing the values) if the CI secrets are missing.
  expect(user, 'E2E_AUTH0_USER must be set (GitHub secret)').toBeTruthy();
  expect(pass, 'E2E_AUTH0_PASS must be set (GitHub secret)').toBeTruthy();

  // Kick off the @auth0/nextjs-auth0 login flow → redirects to Auth0 Universal Login.
  await page.goto('/api/auth/login');

  // Fail FAST with the actual URL if we never reached Auth0's hosted page —
  // distinguishes "login route 500'd / callback misconfig" from "field label
  // changed" without needing a screenshot. (/u/login is Universal Login's path.)
  await page.waitForURL(/\/u\/login|auth0\.com/, { timeout: 15_000 }).catch(() => {
    throw new Error(`Never reached Auth0 Universal Login — browser is at: ${page.url()}`);
  });

  // Auth0 hosted login page. The identifier field is label-associated, but the
  // password input is NOT reliably reachable via getByLabel in the New
  // Universal Login markup (run 27306918140's screenshot shows it visible while
  // getByLabel(/^password/i) timed out) — target the input directly instead;
  // name="password" is stable across Auth0 NUL themes.
  await page.getByLabel(/email|username/i).first().fill(user!);
  await page.locator('input[name="password"], input[type="password"]').first().fill(pass!);
  // The name regex alone is ambiguous against "Continue with Google" (strict
  // mode violation, run 27307831376). Auth0 NUL tags its primary submit with
  // data-action-button-primary — deterministic across themes.
  await page.locator('button[data-action-button-primary="true"]').click();

  // Auth0 cannot consent-skip localhost callbacks (non-verifiable first party),
  // so a one-time authorize screen may follow valid credentials. Accept and
  // move on; absent screen = no-op.
  await page.getByRole('button', { name: /^accept$/i }).click({ timeout: 7_000 }).catch(() => {});

  // Back on the app after the Auth0 callback completes.
  const appOrigin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await expect(page).toHaveURL(new RegExp(appOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // Persist the appSession cookie for the journey specs. `.auth/` is git-ignored.
  await page.context().storageState({ path: AUTH_FILE });
});
