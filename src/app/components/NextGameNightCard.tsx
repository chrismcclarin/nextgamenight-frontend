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
import { StatusRegion } from '@/components/ui/StatusRegion';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { rsvpAPI } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime, formatWithTzAbbr } from '@/lib/datetime';
import { logger } from '@/lib/logger';

import { statusConfig, type RsvpStatusKey } from './rsvpStatusConfig';

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

/**
 * "I have not read the viewer's answer yet" — a real state, distinct from "the viewer
 * has not answered" (`null`). The status row renders EMPTY for it. Claiming "no answer"
 * before the answer arrives is the card-level twin of D-03's count suppression.
 */
const UNKNOWN = 'unknown' as const;

type ViewerStatus = RsvpStatusKey | null | typeof UNKNOWN;

/**
 * The two keys the hero maps, in order.
 *
 * DECISION Phase 88.5 (SPEC Req 4 / D-07): a TWO-key subset of the shared
 * `statusConfig`, chosen OVER (a) rendering all three keys and OVER (b) declaring a
 * private `{yes, no}` map here. `maybe` and notes stay on the event page by owner
 * ruling — the tap-through is DESIGNED, not missing — and (b) would be the THIRD status
 * idiom that `DECISION Phase 88-27` exists to prevent. Everything except the button TEXT
 * still comes from the shared object, so the hero and the event page cannot disagree
 * about what an RSVP looks like or says. Adding `maybe` here is a decision, not a
 * cleanup: it changes what the hero is FOR.
 */
const HERO_KEYS = ['yes', 'no'] as const satisfies readonly RsvpStatusKey[];

/**
 * DECISION Phase 88.5 (SPEC Req 4): the hero OVERRIDES `statusConfig`'s generic
 * `buttonText` (`Yes` / `No`) with the ruled first-person copy, and only that field.
 * The label, the text colour, the active/hover treatment all still come from the shared
 * object. This is a surface-specific copy override, not drift from the config.
 */
const HERO_BUTTON_TEXT: Record<(typeof HERO_KEYS)[number], string> = {
  yes: "I'm in",
  no: "Can't make it",
};

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
  function NextGameNightCard({ event, selfUuid, onEventClick }, ref) {
    const { timezone: ctxTimezone } = useTimezone();
    const timezone = ctxTimezone || null;

    const startDate = event?.start_date;
    const eventId = event?.id;

    const [viewerStatus, setViewerStatus] = React.useState<ViewerStatus>(UNKNOWN);
    const [submitting, setSubmitting] = React.useState<RsvpStatusKey | null>(null);
    const [errorMessage, setErrorMessage] = React.useState('');

    /**
     * The stale-guard. A REF, not state, so setting it neither re-renders nor re-triggers
     * the effect below — a guard that re-runs the thing it guards is not a guard.
     */
    const submittedRef = React.useRef(false);
    // Which event the mounted card currently shows. `handleRsvp`'s continuations
    // compare their captured id against this so a submit that resolves AFTER the
    // `event` prop flipped (the old hero's start time passed and a re-render
    // reselected) cannot write the OLD event's status onto the NEW hero or arm the
    // stale-guard against the new event's own read (adversarial review 2026-09-01,
    // ML0). Kept in sync by the reset effect below.
    const eventIdRef = React.useRef<string | null | undefined>(null);

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

    /*
      DECISION Phase 88.5 (SPEC Req 4 / D-08): the viewer's own status is read with ONE
      `rsvpAPI.getEventRsvps(event.id)` fired when the sheet opens (i.e. on this card's
      mount), keyed by the event id and GATED on identity resolution.

      REJECTED: setting `include_rsvp_summary` on the home page's event fetch. It would
      not even answer the question — `rsvp_summary` is AGGREGATE counts, not the viewer's
      own row — and un-gating it is precisely the side effect D-08 forbids
      (`UserHomePage.js`'s `DECISION Phase 88.1 plan-10 D-06` item 3: "PHONE ROWS CARRY NO
      RSVP COUNTS, BY CONSTRUCTION"). This effect touches neither the page fetch nor the
      list rows' md-gated RSVP block.

      THE GATE IS LOAD-BEARING, not a micro-optimisation. Returning early while `selfUuid`
      is null means identity-resolving-after-mount produces exactly ONE fetch total, never
      one before resolution whose answer belongs to nobody and a second after.

      THE ASYNC-GATING RULE is carried in spirit from `RsvpSection.js:41-56`: while the
      viewer is unresolved, the status is left UNKNOWN — never resolved to "not mine".

      TELEMETRY DIVERGENCE, deliberate: `RsvpSection.js:58` uses `console.error` for this
      same rejection. This call upgrades that to the house `logger.error`, which IS
      `Sentry.captureException(err ?? new Error(msg))` (`src/lib/logger.ts:29`) — so a
      read failure is observable even though the UI stays silent about it. Converging
      `RsvpSection` onto the same helper belongs to 88.6's error pass, not here.
    */
    React.useEffect(() => {
      eventIdRef.current = eventId;
      submittedRef.current = false;
      setViewerStatus(UNKNOWN);
      if (!eventId || !selfUuid) return;

      let cancelled = false;
      rsvpAPI
        .getEventRsvps(eventId)
        .then((data) => {
          // The stale-guard: a slow initial read must never clobber a fresh submit.
          if (cancelled || submittedRef.current) return;
          const mine = (data?.rsvps ?? []).find((row) => row.User?.id === selfUuid);
          setViewerStatus(mine ? mine.status : null);
        })
        .catch((err) => {
          if (cancelled) return;
          logger.error('hero next-game-night RSVP status read failed', err);
          // An unknown status is not a failure the viewer must act on: empty row, no
          // banner. It is reported above so it is not invisible.
          setViewerStatus(UNKNOWN);
        });

      return () => {
        cancelled = true;
      };
    }, [eventId, selfUuid]);

    const handleRsvp = async (next: RsvpStatusKey) => {
      if (!eventId) return;
      // In-flight re-tap: a no-op, so the pressed button can stay focusable
      // (`aria-disabled`) without allowing a second mutation.
      if (submitting) return;
      // Same-status re-tap: also a no-op. Re-writing the answer the server already holds
      // is a request with no effect and a failure mode for no reason.
      if (viewerStatus === next) return;

      setSubmitting(next);
      setErrorMessage('');
      // Captured so the continuations below can tell whether the card still shows
      // the event this write was for (see `eventIdRef`, ML0).
      const submittedFor = eventId;
      try {
        /*
          DECISION Phase 88.5 (SPEC Req 4): the hero calls `submitRsvp` with NO note
          argument, and that is SAFE rather than lossy. Plan 88.5-01 made `POST /rsvp`
          status-only — the note write is conditional on the request body carrying a
          `note` key, via the hoisted `noteUpdate` at the top of POST / in
          `routes/rsvp.js`, spread at both the primary update and the race-retry
          path — and `JSON.stringify` DROPS an undefined `note`, so no key is sent
          and the saved note is preserved. (Cite is the stable `noteUpdate` anchor,
          not line numbers — the old `:413`/`:438` cites drifted; ML6/ML12.)

          REJECTED: forwarding a note from here. The hero has no note field to forward
          from, and adding one would reintroduce exactly the coupling the backend patch
          was written to remove. Adding a third argument to this call is a decision, not
          a cleanup — and it would silently wipe members' notes.

          No optimistic flip: set submitting, await, then reflect. Mirrors
          `RsvpSection.js:69-77` — and deliberately NOT its `:78` post-submit
          `await fetchRsvps()` refetch. The hero's own row is exactly what it just wrote;
          a second round trip to be told so is latency for nothing.
        */
        await rsvpAPI.submitRsvp(eventId, next);
        // The write succeeded — but only reflect it if the card still shows the
        // event it was for. After a hero flip, the old event's answer is neither
        // the new hero's status nor a reason to discard the new event's read.
        if (eventIdRef.current !== submittedFor) return;
        // Arm the stale-guard only on SUCCESS: if the write failed, nothing was written,
        // so a later read landing is the truth and must be allowed through.
        submittedRef.current = true;
        setViewerStatus(next);
      } catch (err) {
        logger.error('hero next-game-night RSVP submit failed', err);
        // Same hero-flip guard as the success path: an error banner about the OLD
        // event would read as a failure of the NEW hero's buttons.
        if (eventIdRef.current !== submittedFor) return;
        /*
          DECISION Phase 88.5 (SPEC Req 4): failure copy comes from the shared
          `getFetchErrorMessage`, chosen OVER `RsvpSection.js:82`'s hard-coded string —
          which is the exact idiom that helper was written to replace (it derives copy
          from `ApiError.code` instead of painting an upstream message at the user,
          `DECISION Phase 88-25`). The divergence from `RsvpSection` is NOTED here and
          deliberately not "fixed" in this file: converging that component is 88.6's
          error pass.

          Inline, not a toast: the sheet is a focus-trapping dialog at `z-50` and the
          toaster's stacking over it is unverified.
        */
        setErrorMessage(
          getFetchErrorMessage(err, {
            fallback: 'Could not save your RSVP. Please try again.',
          })
        );
      } finally {
        setSubmitting(null);
      }
    };

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
            the hero must not enter the sheet dialog's heading outline at ANY level.
            The sheet suite pins that outline as exactly h3>h4>h5>h6 with no extra
            heading (`UserHomePage.calendarSheet.test.tsx`, outline pin), and its
            `rowOrder()` helper is structure-based (re-pointed by plan 88.5-08 —
            DR2-7b — precisely so it survives heading-level changes), so a hero
            heading would red the outline pin, not silently corrupt row order.
            (Rationale refreshed 2026-09-01, ML11 — the old text cited the
            pre-88.5-08 level-5 `rowOrder()` mechanism.) Promoting this to a heading
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

        <div className="mt-3 space-y-2">
          {/*
            Status sentence — the non-colour carrier for the toggle's selected state
            (WCAG 1.4.1). Its copy and colour come FROM `statusConfig`; nothing here is
            re-authored. UNKNOWN renders an EMPTY row on purpose: never claim "you have
            not answered" before the answer arrives.
          */}
          <div className="min-h-5 text-sm">
            {viewerStatus === UNKNOWN ? null : viewerStatus ? (
              <p className={cn('font-medium', statusConfig[viewerStatus].textColor)}>
                {statusConfig[viewerStatus].label}
              </p>
            ) : (
              <p className="text-content-muted">RSVP to this event</p>
            )}
          </div>

          {/*
            The segmented toggle. `role="group"` + a label naming the event is what
            distinguishes this pair from any other control pair on the page for a screen
            reader that lands on one of the buttons.
          */}
          <div
            role="group"
            aria-label={`RSVP for ${whenLine}`}
            className="flex rounded-card border border-line overflow-hidden"
          >
            {HERO_KEYS.map((key, idx) => {
              const config = statusConfig[key];
              const isSelected = viewerStatus === key;
              const isFlight = submitting === key;
              const otherInFlight = submitting !== null && !isFlight;

              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isSelected}
                  /*
                    DECISION Phase 88.5 (SPEC Req 4 / UI-SPEC A-5, narrowed): the PRESSED
                    button gets `aria-disabled`, NEVER the native `disabled` attribute.
                    A natively-disabled element is removed from the focus order, so in a
                    real browser focus drops to `<body>` mid-submit and a keyboard or
                    switch user is stranded at the top of a focus-trapping sheet. The
                    re-tap it needs to block is blocked in the HANDLER instead. Only the
                    UNPRESSED button — which nobody is standing on — loses interactivity
                    outright. Swapping this back to `disabled` is a decision, not a
                    cleanup.
                  */
                  aria-disabled={isFlight || undefined}
                  disabled={otherInFlight}
                  onClick={() => handleRsvp(key)}
                  className={cn(
                    'flex-1 min-h-11 px-3 text-sm font-medium active:opacity-75 transition-colors',
                    'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset',
                    /*
                      DECISION Phase 88.5 (SPEC Req 4): the 2px selected ring is reserved
                      on BOTH states as `border-2 border-transparent`, chosen OVER
                      `RsvpSection.js:168`'s shape (which adds `border-2` only when
                      active). Two reasons, both real: (a) the width is present at rest,
                      so selecting a button no longer nudges the row by 2px; (b) the
                      repo's `borderExplicitness` gate flags an uncoloured width utility,
                      and `RsvpSection` needs a standing allow-list entry to ship its
                      shape — that gate says in as many words not to add an entry to make
                      a test green, so the code names its own colour instead. The divider
                      is the per-SIDE `border-l-line` (the shipped `Banner.tsx:47` idiom)
                      so it cannot repaint the whole ring.

                      44px FLOOR: `min-h-11`, and it is not optional. Do NOT "restore" the
                      horizontal+vertical padding pairing shipped at `RsvpSection.js:165`
                      in place of it — `text-sm` (20px line) plus that 16px of vertical
                      padding computes to about 36px and fails the touch floor
                      (D-07 constraint i). Phone-forward: 44x44 is a floor, not a target.
                    */
                    'border-2 border-transparent',
                    idx > 0 && 'border-l border-l-line',
                    isSelected
                      ? // Subtle tint + ring, NEVER a solid status block
                        // (`DECISION Phase 87.7 D-18`).
                        [config.activeBg, config.activeBorder, 'text-content-primary']
                      : ['bg-surface-card', config.hoverBg, 'text-content-secondary'],
                    otherInFlight && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isFlight ? (
                    <>
                      <span
                        // The shipped spinner, swapped in PLACE so the button element —
                        // and therefore DOM focus — survives the submit.
                        className="inline-block animate-spin h-4 w-4 border-2 border-line-strong border-t-transparent rounded-full"
                        aria-hidden="true"
                      />
                      {/* The button deliberately KEEPS focus in flight (aria-disabled,
                          D-08/A-5) — so it must keep an accessible NAME too, or the
                          focused control announces as nothing for the whole round trip
                          (WCAG 4.1.2; adversarial review 2026-09-01, ML13). */}
                      <span className="sr-only">{HERO_BUTTON_TEXT[key]}, saving</span>
                    </>
                  ) : (
                    HERO_BUTTON_TEXT[key]
                  )}
                </button>
              );
            })}
          </div>

          {/*
            EMPTY-FIRST, ALWAYS MOUNTED — `StatusRegion`'s documented contract
            (`StatusRegion.tsx:9-12`): a screen reader announces CHANGES to a live region,
            not the conditional mount of a new one. Wrapping this in `{error && …}` would
            make the failure silent for exactly the users who need it most. Only its text
            content changes. Do not add `empty:hidden` either — a region that is
            `display:none` until it has something to say has the same defect.
          */}
          <StatusRegion
            politeness="assertive"
            className="text-content-status-error"
            message={errorMessage}
          />
        </div>
      </Card>
    );
  }
);

export { NextGameNightCard };
export default NextGameNightCard;
