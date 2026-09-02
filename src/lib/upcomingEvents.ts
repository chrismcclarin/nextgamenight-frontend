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
 *   - an unparseable `start_date` used to be KEPT: `NaN` fails every comparison, so
 *     such an event fell through BOTH bounds. That was the shipped behaviour and this
 *     block used to say rejecting it needed its own decision. It GOT one. Phase 88.5
 *     OWNER RULING O1a (2026-09-01) excludes unparseable dates EVERYWHERE, via the
 *     explicit `Number.isNaN` drop inside `isLiveUpcoming` below, which this selector
 *     now calls. Why the flip: the phone pill COUNTED NaN-dated events that the sheet
 *     silently DROPPED — a number disagreeing with its own list, the exact defect this
 *     module exists to prevent. The branch is defensive-only in practice (`start_date`
 *     is a Postgres `timestamptz`, `models/Event.js:20-23`, and creation-time rejection
 *     is pinned by plan 88.5-01). Accepted side effect, recorded in the 88.5 SPEC's
 *     Out-of-scope AMENDED note: the desktop `UpcomingEventsCard` also stops rendering
 *     NaN-dated events — a one-line exception to "desktop unchanged."
 *
 * Phase 88.5 additions living beside this block: `hasLiveStatus` (the status-only
 * predicate) and `isLiveUpcoming` (status + future), which this selector now calls
 * instead of re-testing inline, plus the sibling selector `selectNextUpcoming`. See
 * the `DECISION Phase 88.5` block below for what each one rejected.
 */

/** The minimum shape this selector reads. Callers keep their own richer event type. */
export interface UpcomingEventLike {
  start_date: string | number | Date;
  status?: string | null;
}

/**
 * DECISION Phase 88.5 (SPEC Req 3 / D-06 / OWNER RULING 2a): "is this event live and
 * upcoming" is ONE named, exported predicate that every consumer calls, and the "next"
 * event is ONE named, exported sibling selector in this module.
 *
 * Before this, the live/future test was inlined in `selectUpcomingWithin7Days`'s filter
 * body and not exported, so anything else needing the same test had to copy it. The
 * status half is exported SEPARATELY as `hasLiveStatus` because plan 88.5-08's
 * happening-now classification needs the status question WITHOUT the future question;
 * it imports this symbol rather than writing a second inline status test (that is the
 * whole point of OWNER RULING 2a, and why the export is mandatory even though it has no
 * call site outside `isLiveUpcoming` today).
 *
 * CHOSEN: shared `hasLiveStatus` -> `isLiveUpcoming` -> both selectors, plus a named
 * `selectNextUpcoming` here. REJECTED, and each rejection is a real defect avoided:
 *
 *   (a) an inline "soonest event" filter inside the hero card — the second-definition
 *       defect the 88.1-05 block above exists to prevent, one level up.
 *   (b) reusing `selectUpcomingWithin7Days` for the hero — its 7-day cap makes the hero
 *       VANISH for an event 10 days out while the "Later" list below still names it.
 *       The absence of an upper bound here is the entire difference between the two
 *       selectors and is load-bearing; adding a cap would be a behaviour change.
 *   (c) `futureGroups[0]` from `CalendarListView.js:206-211` — that is a DATE-KEY split
 *       (`if (k >= todayKey)`), not a time comparison, so it can surface a game that
 *       already STARTED earlier today as the "next" one.
 *   (d) a private inline copy of the live/future check inside `CalendarListView` or any
 *       other sheet-side consumer — a third, unpinned definition of "upcoming"
 *       (threat T-88.5-25). Exporting `isLiveUpcoming` is what makes copying pointless.
 *
 * NaN: `isLiveUpcoming` drops an unparseable `start_date` EXPLICITLY. That is OWNER
 * RULING O1a (2026-09-01) — a ruled behaviour change superseding the passthrough the
 * 88.1-05 block above used to document, NOT an oversight and NOT a cleanup. It applies
 * everywhere precisely so the pill's count and the sheet's list can never disagree over
 * one. Restoring the passthrough is a decision.
 */

/**
 * The STATUS half of "live and upcoming": is this event still on the books?
 *
 * No time/date logic — that is `isLiveUpcoming`'s job. Split out so a consumer that
 * needs only the status question (plan 88.5-08's happening-now classification) reuses
 * this instead of re-inlining the `(status || 'scheduled')` default.
 */
export const hasLiveStatus = (event: UpcomingEventLike): boolean => {
  const status = event.status || 'scheduled';
  return status === 'scheduled' || status === 'in_progress';
};

/**
 * The ONE test for "this event is live and still ahead of us".
 *
 * Both `selectUpcomingWithin7Days` and `selectNextUpcoming` route their live/future
 * check through here, so they cannot drift apart: the 7-day selector adds only its
 * window cap on top.
 *
 * @param event - the event to test
 * @param nowMs - the instant to measure against, in epoch ms (callers share a clock)
 * @returns true iff the status is live AND the start is strictly after `nowMs`
 */
export const isLiveUpcoming = (event: UpcomingEventLike, nowMs: number): boolean => {
  if (!hasLiveStatus(event)) return false;
  const startMs = new Date(event.start_date).getTime();
  // OWNER RULING O1a: an unparseable date is EXCLUDED, explicitly. Relying on NaN
  // comparisons being false would silently include it in an "everything except" filter.
  if (Number.isNaN(startMs)) return false;
  return startMs > nowMs;
};

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
      // The live/future half is NOT re-tested here — it is `isLiveUpcoming`'s, shared
      // with `selectNextUpcoming` (DECISION Phase 88.5). All this selector adds is the
      // window cap, whose upper bound stays INCLUSIVE.
      if (!isLiveUpcoming(event, nowMs)) return false;
      const startMs = new Date(event.start_date).getTime();
      if (startMs > sevenDaysLaterMs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
};

/**
 * The single soonest live event ahead of `now`, with NO upper bound — the hero card's
 * one source of truth for "the next game night" (SPEC Req 3 / D-06).
 *
 * Shares `isLiveUpcoming` with `selectUpcomingWithin7Days`, so whenever that selector
 * returns a non-empty array, this returns its first element. The only difference is the
 * missing 7-day cap; see the DECISION block above for why that is deliberate.
 *
 * `now` is an explicit defaulted parameter for the same recorded reason the sibling has
 * one — callers and pins must share a clock. Pure: never mutates `events`.
 *
 * @param events - raw event list, or null/undefined (treated as empty)
 * @param now - the instant to measure from; defaults to the wall clock
 * @returns the soonest live future event, or null when there is none
 */
export const selectNextUpcoming = <T extends UpcomingEventLike>(
  events: readonly T[] | null | undefined,
  now: Date = new Date()
): T | null => {
  // Defensive: treat null/undefined as empty array.
  const safeEvents = events ?? [];
  const nowMs = now.getTime();

  let next: T | null = null;
  let nextMs = Number.POSITIVE_INFINITY;

  for (const event of safeEvents) {
    if (!isLiveUpcoming(event, nowMs)) continue;
    const startMs = new Date(event.start_date).getTime();
    if (startMs < nextMs) {
      next = event;
      nextMs = startMs;
    }
  }

  return next;
};
