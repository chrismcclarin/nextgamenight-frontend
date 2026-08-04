import { test, expect } from '@playwright/test';

/**
 * Critical journey: invite a friend to a group (INVITE-01 / regression guard for
 * the Phase 83-06 PII default-deny break).
 *
 * Runs auth-free via the cached storageState (the `setup` project logs in once).
 *
 * This journey exists BECAUSE the invite-to-group flow had no e2e coverage, which
 * let 83-06 (friend email stripped from the friends payload) ship a silent
 * "Invited 0 friends!" to production. The assertion below — "Invited 1 friend" and
 * explicitly NOT "Invited 0" — is the guard that turns that regression class red in CI.
 *
 * Fixture (backend scripts/e2e-fixtures.js): Alice owns E2E_INVITE_GROUP_NAME and has
 * an accepted friend (E2E_INVITE_FRIEND_NAME) who is NOT in that group, so the friend
 * checkbox is enabled and the invite has a valid target.
 *
 * Selectors are role/label/text only (PATTERNS.md) — never Tailwind classes.
 */
test('user can invite a friend to a group', async ({ page }, testInfo) => {
  const groupName = process.env.E2E_INVITE_GROUP_NAME ?? 'E2E Invite Group';

  // DECISION Phase 87.8 (D-07): the phone project invites a DIFFERENT friend
  // (E2E_INVITE_FRIEND_NAME_PHONE, minted by the backend fixture script) than the
  // desktop journeys project — chosen OVER narrowing the phone project's testMatch to
  // exclude this spec (which would silently shrink the MOB-03 gate below "all journeys
  // at phone width"), and OVER making the journey re-entrant with a backend delete or
  // re-invite endpoint (no public route a spec can drive exists; that would mean new
  // endpoints for a test's convenience). WHY a shared target fails: with both projects
  // armed this spec runs twice per CI job, and routes/invites.js:381-383 returns 409
  // for a duplicate pending invite to the same friend — the frontend renders "Failed
  // to send invites" (friends/page.js:617) and the "Invited 1 friend" assertion below
  // fails. Per-project targets keep both runs first-use.
  const friendName =
    testInfo.project.name === 'phone'
      ? process.env.E2E_INVITE_FRIEND_NAME_PHONE ?? 'Charlie'
      : process.env.E2E_INVITE_FRIEND_NAME ?? 'Bob';

  await page.goto('/friends');

  // The friend must be listed before we can select them (friends payload loaded).
  await expect(page.getByText(friendName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // The invite controls render only once userGroups loads (page.js conditionally
  // renders the bar when userGroups.length > 0). friends + groups fetch in parallel,
  // so wait for the group <select> explicitly before interacting — no render race.
  const groupSelect = page.getByRole('combobox', { name: /invite to group/i });
  await expect(groupSelect).toBeVisible({ timeout: 15_000 });

  // Pick the target group in the "Invite to group" <select> (aria-label on the select).
  await groupSelect.selectOption({ label: groupName });

  // Select the friend's checkbox (aria-label={`Select ${username}`} on the input).
  await page.getByRole('checkbox', { name: new RegExp(`select ${friendName}`, 'i') }).check();

  // Click the "Invite to Group" button (role=button, distinct from the select's label).
  await page.getByRole('button', { name: /invite to group/i }).click();

  // The fix is proven by a NON-zero count. Assert "Invited 1 friend" and guard
  // against the regression's "Invited 0 friends!".
  await expect(page.getByText(/invited 1 friend/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/invited 0 friend/i)).toHaveCount(0);
});
