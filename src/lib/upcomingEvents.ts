/**
 * The single definition of "upcoming" for this app: an event that starts after now
 * and no later than 7 days from now, and is still live (`scheduled` / `in_progress`).
 *
 * DECISION Phase 88.1-05 (Req-11, PATTERNS §S5): this predicate is SHARED rather than
 * inlined in the card it came from — chosen OVER leaving it inside
 * `UpcomingEventsCard.js` and having the phone bottom bar count `events.length`.
 * Two consumers derive from it and they must not be able to disagree:
 *
 *   1. `src/app/components/UpcomingEventsCard.js` — the card/sheet BODY, which
 *      renders the rows.
 *   2. the phone bottom bar's upcoming-count pill (plan 88.1-08), which renders
 *      the NUMBER.
 *
 * The page owner (`UserHomePage.js`) passes the RAW, unfiltered list to the card on
 * purpose ("UpcomingEventsCard does its own filter+sort; pass the raw list"), so a bar
 * reading `upcomingEvents.length` would advertise a count the sheet does not show —
 * a badge saying 5 over a list of 2. One predicate, one source of truth.
 *
 * Transcribed with NO semantic change from the shipped block at
 * `UpcomingEventsCard.js:123-136` (pre-extraction). Two shipped behaviours are
 * deliberately preserved and are decisions, not oversights:
 *
 *   - the lower bound is EXCLUSIVE (`startDate <= now` is dropped), so an event
 *     starting exactly now is not "upcoming"; the upper bound is INCLUSIVE
 *     (only `startDate > sevenDaysLater` is dropped), so the 7-day boundary is in.
 *   - an unparseable `start_date` yields `NaN`, and every NaN comparison is false,
 *     so such an event falls through BOTH bounds and is kept. That is what ships
 *     today. Rejecting it is a behaviour change that needs its own decision — it
 *     is not a cleanup.
 */

/** The minimum shape this selector reads. Callers keep their own richer event type. */
export interface UpcomingEventLike {
  start_date: string | number | Date;
  status?: string | null;
}

/**
 * Filter an event list down to the next 7 days, sorted soonest-first.
 *
 * `now` is an explicit parameter (not `new Date()` read inline) so callers and pins
 * share a clock — reading the wall clock inside the predicate is exactly what made
 * the card's copy of this untestable.
 *
 * Pure: never mutates `events` (`.filter()` allocates before `.sort()` runs).
 *
 * @param events - raw event list, or null/undefined (treated as empty)
 * @param now - the instant to measure the window from; defaults to the wall clock
 * @returns a new array of the in-window, still-live events, ascending by start date
 */
export const selectUpcomingWithin7Days = <T extends UpcomingEventLike>(
  events: readonly T[] | null | undefined,
  now: Date = new Date()
): T[] => {
  // Defensive: treat null/undefined as empty array.
  const safeEvents = events ?? [];

  const nowMs = now.getTime();
  const sevenDaysLaterMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  return safeEvents
    .filter((event) => {
      const startMs = new Date(event.start_date).getTime();
      if (startMs <= nowMs) return false;
      if (startMs > sevenDaysLaterMs) return false;
      const status = event.status || 'scheduled';
      if (status !== 'scheduled' && status !== 'in_progress') return false;
      return true;
    })
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
};
