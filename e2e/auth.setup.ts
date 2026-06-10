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

  // Auth0 hosted login page. Use accessible label selectors (survive Auth0 theme
  // churn). New Universal Login labels the identifier field "Email address" or
  // "Username" depending on connection settings — match any of them.
  await page.getByLabel(/email|username/i).first().fill(user!);
  await page.getByLabel(/^password/i).fill(pass!);
  await page.getByRole('button', { name: /continue|log in|log\s*in|sign in/i }).click();

  // Back on the app after the Auth0 callback completes.
  const appOrigin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await expect(page).toHaveURL(new RegExp(appOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // Persist the appSession cookie for the journey specs. `.auth/` is git-ignored.
  await page.context().storageState({ path: AUTH_FILE });
});
