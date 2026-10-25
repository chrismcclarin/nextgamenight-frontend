import { expect, type Page } from '@playwright/test';

/**
 * The ONE Create Event drive: open the group home page's Create Event dialog and fill it by
 * manual entry, WITHOUT submitting. Moved here by Phase 88.6.1-71 from the create-event journey
 * (e2e/create-event.spec.ts), so the journey, e2e/group-home-load-failures.spec.ts and plan
 * 88.6.1-56's phone spec share one drive instead of three copies. The caller has already
 * navigated to `/groupHomePage?id=…` (the "Add New Game Event" button lives there) and presses
 * `create-event-submit` itself, so it can arm its own routes first.
 *
 * Phase 88.6.2-11 split the drive into its steps, so a spec that needs only a slice of it calls
 * that slice instead of copying it:
 *   - openCreateEventDialog: open the dialog and wait for its heading;
 *   - switchToManualEntry: the STRICT switch, for a freshly opened dialog;
 *   - switchToManualEntryIfOffered: the mode-aware switch, for a dialog reopened mid-test;
 *   - fillCreateEventFields: game, switch, start date and time, duration, on an open dialog;
 *   - fillCreateEventManualEntry: open then fill, the original whole drive (signature kept).
 */

// DECISION Phase 88.6.2-11 (PC-7): the drive is split into open / switch / switch-if-offered /
// fill, chosen OVER one open-and-fill function that every spec copied a slice of (five code lines
// in four specs drove the switch on their own before this plan). A STEP COPY is a drive of the
// Manual Entry switch used to reach a state for some OTHER assertion; every step copy calls these
// functions. Two tests whose SUBJECT is the switch keep it inline on purpose and are not copies:
// e2e/event-scheduler-touch.spec.ts ("this file exists precisely to cover that mode") asserts the
// dialog opened in visual mode, and e2e/event-scheduler-touch.spec.ts ("after a visual -> manual -> visual round-trip")
// drives the round trip it measures. A fresh dialog always takes the STRICT switch, chosen OVER
// the if-offered one: the strict click times out when the dialog did not open in visual mode, and
// that timeout is the proof of the default mode, which an if-offered switch would skip silently.
// The if-offered switch is only for a dialog instance reopened mid-test, which keeps its mode.
// Changing this is a decision, not a cleanup.

/** Open the Create Event dialog from the group home page; the heading proves it mounted. */
export async function openCreateEventDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /add new game event/i }).click();
  await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
}

/**
 * The STRICT switch to manual entry. The modal opens in visual-calendar (drag-select) mode, so the
 * toggle offers manual entry; if the dialog did not open in visual mode, this click times out, and
 * that timeout is the proof. A freshly opened dialog always uses this one.
 */
export async function switchToManualEntry(page: Page): Promise<void> {
  await page.getByRole('button', { name: /switch to manual entry/i }).click();
}

/**
 * The mode-aware switch, ONLY for a dialog instance reopened mid-test: the dialog keeps its
 * date-entry mode across a close and a reopen of the same instance, so the switch to manual entry
 * is pressed only while the toggle still offers it. Returns whether it clicked.
 */
export async function switchToManualEntryIfOffered(page: Page): Promise<boolean> {
  const modeToggle = page.getByRole('button', { name: /switch to (manual entry|visual calendar)/i });
  await expect(modeToggle).toBeVisible();
  if (!/manual entry/i.test((await modeToggle.textContent()) ?? '')) return false;
  await modeToggle.click();
  return true;
}

/**
 * Fill an already-open Create Event dialog with the journey's values, so no new game is minted:
 * the game, the switch to manual entry ('required' = strict, the default; 'if-offered' = only for a
 * reopened dialog), the start date and time, then the duration. The switch sits between the game
 * and the date because both drives this replaced did it in that order.
 */
export async function fillCreateEventFields(
  page: Page,
  options: { gameName?: string; switchMode?: 'required' | 'if-offered' } = {},
): Promise<void> {
  const gameName = options.gameName ?? process.env.E2E_GAME_NAME ?? 'Catan';
  const switchMode = options.switchMode ?? 'required';

  // Pick a game via the game search combo (createEvent.js, its search placeholder).
  await page.getByPlaceholder('Search for a game or type a name').fill(gameName);

  // start_date is required (backend Event.start_date NOT NULL) and defaults
  // empty. The modal opens in visual-calendar (drag-select) mode — switch to
  // manual entry and fill the labeled datetime-local input instead.
  if (switchMode === 'required') await switchToManualEntry(page);
  else await switchToManualEntryIfOffered(page);
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const startValue = `${start.toISOString().slice(0, 10)}T19:00`;
  await page.getByLabel(/start date & time/i).fill(startValue);

  // Duration is also a required field — native browser validation blocks the
  // submit with "Please fill out this field" (run 27318628271 screenshot).
  await page.getByPlaceholder(/enter duration in minutes/i).fill('120');
}

/** Open the dialog and fill it by manual entry (strict switch), without submitting. */
export async function fillCreateEventManualEntry(
  page: Page,
  gameName = process.env.E2E_GAME_NAME ?? 'Catan',
): Promise<void> {
  await openCreateEventDialog(page);
  await fillCreateEventFields(page, { gameName, switchMode: 'required' });
}
