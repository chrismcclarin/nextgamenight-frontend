/**
 * Executed-count floors for every e2e spec with a conditional skip — Phase 88.6.2-26 (SPEC R8,
 * register row 64, the gate-c half). Read by scripts/gate-c-executed-floor.mjs --config, in the
 * e2e job's "Executed-count floors" step, against the run's own playwright-results.json.
 *
 * WHY. Playwright exits 0 on a run that skipped everything. A spec guarded by
 * test.skip(({ isMobile }) => …) runs only in the project its predicate allows, so flipping the
 * predicate, dropping the project from ci.yml's run line, or changing the project's isMobile
 * setting zeroes it while the job stays green. A floor per spec and project turns that into a red.
 *
 * ONE ROW PER LINE: { spec, project, floor, why, titlePrefix? }. spec is the e2e/ path, matched on
 * a path boundary, never on a basename suffix; floor is a positive integer; why says what runs.
 *
 * MEASURED 2026-10-24 on FE f2fa379 with
 *   npx playwright test --list --project=journeys --project=phone --no-deps
 * (542 tests in 69 files), counting the lines "  [<project>] › <file>:" per spec and project.
 * The population is every e2e/*.spec.ts whose comment-stripped text (withoutComments from
 * src/test-utils/sourceScan.ts) calls test.skip, test.fixme, describe.skip or describe.fixme: 51
 * of the 69 specs (contrast.spec.ts keeps Gate C's own floor instead, so 50 here).
 *
 * THE READING RULE. A skip at file level covers every test in the file; inside a test.describe(
 * it covers that block; inside a test body, that test. A !isMobile predicate skips in journeys,
 * an isMobile (or Boolean(isMobile), !!isMobile) predicate skips in phone. Any other predicate is
 * data-conditional: it is counted in no floor and named in the row's why. Each project where at
 * least one test executes gets floor = listed − skipped − data-conditional. Every floor here is
 * at or below its --list count; the script also reds ABOVE LISTED at run time.
 *
 * A floor is raised in the same commit that adds a test, and lowered only with a recorded reason
 * beside the row. Do not lower one to make a red run green.
 */
export const floors = [
  { spec: 'e2e/account-delete-pending.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/availability-grid-touch.spec.ts', project: 'phone', floor: 8, why: '8 of 8 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/ballot-pick-in-flight.spec.ts', project: 'phone', floor: 4, why: '4 of 4 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/browse-games-modal.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/check-ins-banner-dismiss.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/check-ins-end-focus.spec.ts', project: 'journeys', floor: 2, why: '2 of 3 listed run in journeys; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/check-ins-end-focus.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/check-ins-select-poll.spec.ts', project: 'phone', floor: 5, why: '5 of 5 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/dialog-focus-floor.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/email-change-drift.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/empty-status-region-idle.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/error-recovery-floor.spec.ts', project: 'phone', floor: 5, why: '5 of 5 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/event-link-signed-out.spec.ts', project: 'phone', floor: 4, why: '4 of 4 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/event-scheduler-touch.spec.ts', project: 'journeys', floor: 2, why: '2 of 19 listed run in journeys; 17 skipped here by an isMobile predicate' },
  { spec: 'e2e/event-scheduler-touch.spec.ts', project: 'phone', floor: 17, why: '17 of 19 listed run in phone; 1 skipped here by an isMobile predicate; 1 data-conditional (arm (9), the QuickSuggestions 44px test, skips at run time when the fixture group has no suggestions, so no floor counts it)' },
  { spec: 'e2e/feedback-form-phone.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/feedback-stacking.spec.ts', project: 'journeys', floor: 4, why: '4 of 6 listed run in journeys; 2 skipped here by an isMobile predicate' },
  { spec: 'e2e/feedback-stacking.spec.ts', project: 'phone', floor: 3, why: '3 of 6 listed run in phone; 3 skipped here by an isMobile predicate' },
  { spec: 'e2e/feedback-submit.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/friend-request-kept-on-failure.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/game-suggestion-card.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/gamedetail-refresh-failed.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/games-to-bring-picker-phone.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-card-names.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-games-failed-refresh.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-home-games-refresh.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-home-load-failures.spec.ts', project: 'phone', floor: 6, why: '6 of 6 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-planning-role-failure.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-settings-danger.spec.ts', project: 'phone', floor: 9, why: '9 of 9 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/group-settings-pending-focus.spec.ts', project: 'phone', floor: 5, why: '5 of 5 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/header-main-nav.spec.ts', project: 'journeys', floor: 1, why: '1 of 3 listed run in journeys; 2 skipped here by an isMobile predicate' },
  { spec: 'e2e/header-main-nav.spec.ts', project: 'phone', floor: 2, why: '2 of 3 listed run in phone; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/home-group-list-refresh.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/home-removed-notice.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/input-date-phone.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/manage-members-refresh.spec.ts', project: 'phone', floor: 4, why: '4 of 4 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/member-plus-failure.spec.ts', project: 'phone', floor: 4, why: '4 of 4 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/month-tile-desktop.spec.ts', project: 'journeys', floor: 2, why: '2 of 2 listed run in journeys; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/notification-bell-actions.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/notification-bell-load-failure.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/notification-bell-panel.spec.ts', project: 'journeys', floor: 1, why: '1 of 2 listed run in journeys; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/notification-bell-panel.spec.ts', project: 'phone', floor: 1, why: '1 of 2 listed run in phone; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/padding-budget.spec.ts', project: 'journeys', floor: 1, why: '1 of 10 listed run in journeys; 9 skipped here by an isMobile predicate' },
  { spec: 'e2e/padding-budget.spec.ts', project: 'phone', floor: 9, why: '9 of 10 listed run in phone; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/phone-home-event-discovery.spec.ts', project: 'journeys', floor: 1, why: '1 of 9 listed run in journeys; 8 skipped here by an isMobile predicate' },
  { spec: 'e2e/phone-home-event-discovery.spec.ts', project: 'phone', floor: 8, why: '8 of 9 listed run in phone; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/profile-identity-refresh.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/prompt-schedule-readonly-notice-phone.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/recurring-checkins-phone.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/report-form-survives-recovery.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/restore-preview.spec.ts', project: 'phone', floor: 3, why: '3 of 3 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/route-fallbacks.spec.ts', project: 'journeys', floor: 1, why: '1 of 1 listed run in journeys; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/rsvp-section-outcome-spacing.spec.ts', project: 'phone', floor: 2, why: '2 of 2 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/share-game-qr-pending.spec.ts', project: 'phone', floor: 1, why: '1 of 1 listed run in phone; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/tailwind-v4-styles.spec.ts', project: 'journeys', floor: 3, why: '3 of 3 listed run in journeys; the other project is skipped by an isMobile predicate' },
  { spec: 'e2e/touch-targets.spec.ts', project: 'journeys', floor: 3, why: '3 of 26 listed run in journeys; 23 skipped here by an isMobile predicate (the D10 arm; the D10 step keeps its own title-prefixed floor)' },
  { spec: 'e2e/touch-targets.spec.ts', project: 'phone', floor: 23, why: '23 of 26 listed run in phone; 3 skipped here by an isMobile predicate' },
  { spec: 'e2e/tutorial-phone-wording.spec.ts', project: 'journeys', floor: 1, why: '1 of 2 listed run in journeys; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/tutorial-phone-wording.spec.ts', project: 'phone', floor: 1, why: '1 of 2 listed run in phone; 1 skipped here by an isMobile predicate' },
  { spec: 'e2e/typed-line-breaks.spec.ts', project: 'phone', floor: 10, why: '10 of 10 listed run in phone; the other project is skipped by an isMobile predicate' },
];
