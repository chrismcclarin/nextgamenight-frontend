'use client';

/**
 * NextGameNightCard — the calendar sheet's hero (SPEC Req 3 / D-05, D-06, D-14).
 *
 * It names the literal next game night (day + time + group), and its body is one
 * navigate target routing exactly where the sheet's rows route. It does NOT select
 * that event: the shared "next upcoming" sibling selector in `src/lib/upcomingEvents.ts`
 * does, and the sheet hands the result down as the `event` prop. No filter, sort or
 * selection may appear in this file — a second definition of "next" is exactly what
 * that module exists to prevent.
 *
 * The RSVP half (SPEC Req 4 / D-07, D-08) arrives in the same file as a SIBLING of the
 * navigate button — see the DECISION marker at the toggle.
 */
import * as React from 'react';

import { useTimezone } from '@/app/components/TimezoneProvider';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { formatTime, formatWithTzAbbr } from '@/lib/datetime';

/**
 * The minimal structural shape the hero reads off the `getUserEvents` wire.
 *
 * DECISION Phase 88.5 (SPEC Req 3): declared LOCALLY, chosen OVER importing the shared
 * zod event type from `@/lib/schemas/events`. That schema declares `event_id` as
 * required where the wire actually carries `id` (`formatEventWithCustomParticipants`
 * spreads the raw `Event.toJSON()`), so importing it here would either fail typecheck
 * against real data or silently paper over the mismatch. The schema drift is a real,
 * separately-flagged concern — this file declines to INHERIT it, and fixing it is not
 * this plan's job. Swapping this for the shared schema type is a decision, not a
 * cleanup: it needs the schema corrected first.
 */
export interface NextGameNightEvent {
  id: string;
  start_date: string;
  status?: string;
  Group?: { name?: string | null } | null;
}

export interface NextGameNightCardProps {
  /**
   * The ALREADY-SELECTED next event — whatever the shared "next upcoming" selector in
   * `src/lib/upcomingEvents.ts` returned. The hero never filters, sorts or selects.
   * `null`/`undefined` renders nothing at all.
   */
  event: NextGameNightEvent | null | undefined;
  /**
   * The viewer's resolved `Users.id` UUID, for own-RSVP matching. `undefined`/`null`
   * while identity is still resolving — which is a real state, not "no RSVP".
   */
  selfUuid: string | null | undefined;
  /** Wired by the sheet to `handleCalendarSheetEventClick`. */
  onEventClick: (event: NextGameNightEvent) => void;
}

const NextGameNightCard = React.forwardRef<HTMLDivElement, NextGameNightCardProps>(
  function NextGameNightCard({ event, onEventClick }, ref) {
    const { timezone: ctxTimezone } = useTimezone();
    const timezone = ctxTimezone || null;

    const startDate = event?.start_date;

    // The when-line, composed from the SHARED formatters the list rows below already
    // use. There is deliberately no second date formatter in this file.
    //
    // RULED COPY DELTA: `formatTime(date, tz)` APPENDS the timezone abbreviation
    // (`src/lib/datetime.ts:225-231` says so in as many words), so this renders
    // "7:00 PM EDT", not the literally-ruled "7:00 PM". Passing `timezone` is the
    // deliberate choice — the list rows directly beneath the hero already render
    // "7:00 PM EDT", and consistency with the rows the hero sits above beats a literal
    // copy match against the mockup.
    const whenLine = React.useMemo(() => {
      if (!startDate) return '';
      const d = new Date(startDate);
      if (Number.isNaN(d.getTime())) return '';
      let day: string;
      try {
        // SHORT month: the ruled copy is "Friday, Sep 4", not "Friday, September 4".
        // `CalendarListView.js:190` uses the LONG-month variant of this same token for
        // its day headers — that difference is intentional, not drift.
        day = formatWithTzAbbr(d, timezone, 'EEEE, MMM d');
      } catch {
        // Copied from `CalendarListView.js:191-193`: a malformed IANA string renders
        // in UTC rather than crashing the sheet.
        day = formatWithTzAbbr(d, null, 'EEEE, MMM d');
      }
      const time = formatTime(startDate, timezone);
      return time ? `${day} · ${time}` : day;
    }, [startDate, timezone]);

    const groupName = event?.Group?.name ?? '';

    // WCAG 2.5.3 (label-in-name): the accessible name must OPEN with the button's own
    // visible text, which starts at the eyebrow. UI-SPEC §6.3.4 governs what follows.
    // The event TITLE named there is deliberately absent: the card renders no title
    // row, and the minimal wire type above carries no title field to invent one from.
    const navigateLabel = `${['Next game night', whenLine, groupName]
      .filter(Boolean)
      .join(', ')} — open event`;

    // SPEC Req 3 / UI-SPEC §8: with no upcoming event there is NO hero — and no
    // skeleton, which would imply an event exists.
    if (!event) return null;

    return (
      <Card ref={ref} className="mb-4 p-4 shrink-0">
        {/*
          ONE navigate target for the eyebrow + when + who block. The RSVP toggle is a
          SIBLING of this button and never a child: interactive-in-interactive is an
          invalid tree and would make an RSVP tap navigate (UI-SPEC A-4).

          No `prefers-reduced-motion` override here on purpose — the global contract at
          `globals.css:2448-2470` already caps every transition, and
          `DECISION Phase 88-28 Req 4` says not to duplicate it per component.
        */}
        <button
          type="button"
          aria-label={navigateLabel}
          onClick={() => onEventClick(event)}
          className={cn(
            'block w-full min-h-11 text-left active:opacity-75',
            'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2'
          )}
        >
          <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-content-accent">
            Next game night
          </span>
          {/*
            DECISION Phase 88.5 (SPEC Req 3): the when-line is a span, NOT a heading —
            and specifically never a level-5 one. `UserHomePage.calendarSheet.test.tsx`'s
            `rowOrder()` helper reads `getAllByRole('heading', { level: 5 })` inside the
            dialog to assert LIST ORDER, so a level-5 hero would silently prepend itself
            to that list and break a pin in a different file. Promoting this to a heading
            is a decision, not a cleanup.
          */}
          <span className="mt-1 block text-lg font-bold leading-tight text-content-primary">
            {whenLine}
          </span>
          {/*
            D-14 (owner ruling 2026-08-31): the who-line is `{Group name}` ALONE. RESEARCH
            B-1 enumerated the whole `Event` model and the `GET /events/user/:user_id`
            include list and found NO host/creator/organizer field anywhere; substituting
            `picked_by` was REJECTED on semantics, and a real backend host column is
            DEFERRED to `.planning/todos/pending/2026-08-31-event-host-location-field-*`.
            Adding a host line here would be inventing data. That is a decision, not a
            cleanup — and it needs the backend column first.
          */}
          {groupName ? (
            <span className="mt-1 block text-sm text-content-secondary">{groupName}</span>
          ) : null}
        </button>
      </Card>
    );
  }
);

export { NextGameNightCard };
export default NextGameNightCard;
