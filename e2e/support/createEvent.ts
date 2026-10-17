import { expect, type Page } from '@playwright/test';

/**
 * The ONE Create Event drive: open the group home page's Create Event dialog and fill it by
 * manual entry, WITHOUT submitting. Moved here by Phase 88.6.1-71 from the create-event journey
 * (`e2e/create-event.spec.ts`), so the journey, `e2e/group-home-load-failures.spec.ts` and plan
 * 88.6.1-56's phone spec share one drive instead of three copies. The caller has already
 * navigated to `/groupHomePage?id=…` (the "Add New Game Event" button lives there) and presses
 * `create-event-submit` itself, so it can arm its own routes first.
 */
export async function fillCreateEventManualEntry(
  page: Page,
  gameName = process.env.E2E_GAME_NAME ?? 'Catan',
): Promise<void> {
  // Open the create-event modal — heading "Create Event" confirms it's mounted.
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();

  // Pick a game via the game search combo (createEvent.js, its search placeholder).
  await page.getByPlaceholder('Search for a game or type a name').fill(gameName);

  // start_date is required (backend Event.start_date NOT NULL) and defaults
  // empty. The modal opens in visual-calendar (drag-select) mode — switch to
  // manual entry and fill the labeled datetime-local input instead.
  await page.getByRole('button', { name: /switch to manual entry/i }).click();
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const startValue = `${start.toISOString().slice(0, 10)}T19:00`;
  await page.getByLabel(/start date & time/i).fill(startValue);

  // Duration is also a required field — native browser validation blocks the
  // submit with "Please fill out this field" (run 27318628271 screenshot).
  await page.getByPlaceholder(/enter duration in minutes/i).fill('120');
}
