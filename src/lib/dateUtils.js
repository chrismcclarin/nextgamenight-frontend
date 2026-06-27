/**
 * Date and time formatting utilities.
 *
 * BACKWARD-COMPAT SHIM. Phase 84 PRIM-05 (D-01/D-02) consolidated these casual
 * date/time/duration formatters into the typed `datetime.ts` module. They were
 * ported there with BYTE-FOR-BYTE identical output (pinned by `datetime.test.ts`).
 *
 * This file now re-exports them so existing importers not yet migrated to
 * `datetime.ts` (ScheduleList, GroupGamesList, grouplist, SuggestionCard,
 * userProfile) keep working. New code should import from `./datetime` directly.
 *
 * Locked casual format decisions (unchanged):
 * - Date: "Mar 20" for current year, "Mar 20, 2026" for different year
 * - Time: "7:00 PM" (12-hour format)
 * - No relative dates (no "Today", "Tomorrow")
 */

export {
  formatDate,
  formatTime,
  formatDateTime,
  formatLongDate,
  toLocalDateString,
  formatDuration,
} from './datetime';
