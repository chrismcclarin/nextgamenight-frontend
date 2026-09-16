'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { promptAPI } from '@/lib/api';
import {
  useFetchErrorState,
  getFetchErrorMessage,
} from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Heading } from '../../components/ui/Heading';
import { logger } from '@/lib/logger';

/**
 * ResponseDashboard - Shows who has/hasn't responded to an availability prompt
 *
 * Features:
 * - Displays respondent/pending status for all group members
 * - Admins can send reminder emails (24-hour cooldown)
 * - Blind voting: hides slot counts until user submits or poll closes
 *
 * @param {string} promptId - The availability prompt ID
 * @param {boolean} isAdmin - Whether the current user is admin/owner
 * @param {string} currentUserId - The current user's ID
 * @param {boolean} blindVotingEnabled - Whether blind voting is enabled for this prompt
 * @param {boolean} pollClosed - Whether the poll has closed (deadline passed)
 */
export default function ResponseDashboard({
  promptId,
  isAdmin = false,
  currentUserId,
  blindVotingEnabled = false,
  pollClosed = false,
}) {
  const [respondents, setRespondents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [remindingUserId, setRemindingUserId] = useState(null);

  /* The phase's ONE staleness idiom, ported from the shipped
     `NextGameNightCard.tsx:192`/`:197`/`:202`/`:209-211` cancelled-generation guard (the same
     one plan 88.6-29's W61 ports). It is COMPONENT-scope, not per-invocation, because
     `fetchRespondents` is called from TWO places that know nothing about each other — the
     `promptId` effect below and `useFetchErrorState`'s refocus recovery — so a per-invocation
     `let cancelled` could not see the other caller's supersession.

     `AbortController` is the RECORDED REJECTED alternative for this class (plan 29 rejects it
     by name): it cancels the transport, which is not what is wrong here — what is wrong is a
     LATE response writing over a newer one, and the guard has to hold for a request that has
     already resolved.

     `inFlightGenerationRef` is the in-flight short-circuit. It is keyed on the GENERATION and
     not a bare boolean, deliberately: a bare boolean would make a `promptId` change during an
     in-flight fetch drop the NEW prompt's request on the floor. Same generation in flight =>
     short-circuit; new generation => always proceeds. */
  const generationRef = useRef(0);
  const inFlightGenerationRef = useRef(null);

  // 87.4 PR-2 (D-02): the sub arm is dropped. groupPlanning now passes the
  // caller's resolved Users.id UUID as `currentUserId` (was user?.sub), and the
  // BE emits UUID respondent user_ids (Plan 08/09), so the is-me compare is
  // UUID-only. The remind sender passes respondent.user_id straight through to
  // the UUID-only BE remind endpoint (Plan 09) -- no sub survives either arm.
  const isMe = (id) => id != null && id === currentUserId;

  // Fetch respondents on mount
  const fetchRespondents = useCallback(async () => {
    const generation = generationRef.current;
    // IN-FLIGHT SHORT-CIRCUIT. `useFetchErrorState` arms a `visibilitychange` listener while
    // erroring and calls this on every return-to-visible, and on a phone that fires on every
    // app switch and every lock/unlock. Without this line one outage would issue one request
    // — and one Sentry event, since `dedupeIntegration` compares only against the immediately
    // preceding event — per refocus. This is what makes that multiplier BOUNDED.
    if (inFlightGenerationRef.current === generation) return;
    inFlightGenerationRef.current = generation;
    setLoading(true);
    try {
      const data = await promptAPI.getRespondents(promptId);
      if (generation !== generationRef.current) return;
      setRespondents(data);
      /* DECISION Phase 88.6-32 (R1): the error clears HERE, on SUCCESS — and in the `promptId`
         effect below — chosen OVER the house clear-at-fetch-start idiom
         (`grouplist.js:85-86`, `groupPlanning/page.js:134`), which is REJECTED at this call
         site and only at this one.

         WHY. This component adopts `useFetchErrorState`, whose refocus recovery re-issues the
         fetch on every return-to-tab WHILE `showError`. Clearing at fetch start would make
         `error` falsy for the whole in-flight window, so the error branch below would be
         unreachable during a retry and the skeleton would flash over the banner on every one
         of them — and, because the shipped code set `loading = true` and `error = null` in the
         same synchronous block, `error` could never be truthy while `loading` was truthy in a
         committed render at all. That is why re-ordering the branches ALONE is inert: this
         clear is the mechanism and the ordering is what lets the surviving error win.

         Restoring the fetch-start clear is a decision, not a cleanup. */
      setError(null);
    } catch (err) {
      // AC-2 WIDENED x the D2 AC-16 carve-out: this stays `logger.error` (a Sentry EVENT), not
      // `logger.info`, because AC-16 (a) requires a Sentry capture on this path. Logged BEFORE
      // the generation guard on purpose — a request that really failed is a real diagnostic
      // even when its answer is no longer wanted. The error OBJECT is the only second argument
      // (T-84-01): no respondent list, no member email, no identity field.
      logger.error('Failed to fetch respondents:', err);
      if (generation !== generationRef.current) return;
      // Store the ERROR OBJECT, never a flattened string: `useFetchErrorState` derives the
      // user-facing copy from `ApiError.code` (`useFetchErrorState.ts:116`), so a string here
      // would make every failure resolve to `unknown` and render one generic line for a 403, a
      // 404 and a 500 alike — WHILE the roster scan reported green, because the `err.message`
      // read would be gone. `getFetchErrorMessage` is deliberately NOT applied here.
      setError(
        err instanceof Error ? err : new Error("The respondents request didn't complete.")
      );
    } finally {
      if (inFlightGenerationRef.current === generation) inFlightGenerationRef.current = null;
      if (generation === generationRef.current) setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    if (!promptId) return undefined;
    // A NEW prompt never inherits the previous prompt's banner. A REFETCH of the same prompt
    // does keep it — that is the whole point of the clear-on-success rule above.
    setError(null);
    fetchRespondents();
    // The cleanup this effect did not have. It bumps the generation on unmount AND on a
    // `promptId` change, so no in-flight response can write state after teardown or after the
    // component has moved on to a different poll.
    return () => {
      generationRef.current += 1;
    };
  }, [promptId, fetchRespondents]);

  /* The synthetic adapter onto the shared fetch-error pair, matching the shipped shape at
     `groupPlanning/page.js:172-196` and `grouplist.js:91-96`. Both of that idiom's recorded
     constraints are honoured: the ERROR OBJECT is what is stored (above), and `refetch` is
     STABLE — `fetchRespondents` is already a `useCallback([promptId])`, so no ref hop is
     needed here (an unstable `refetch` would re-subscribe the hook's refocus listener on
     every render while erroring, and `checkJs: false` would hide the shape mismatch from
     `npm run typecheck`).

     DEDUP IS NOT PUSHED INTO THE HOOK, and the reason is measured (2026-09-14): 22 production
     call sites across 12 files, of which 12 pass a TanStack result straight through and 10 are
     hand-rolled synthetic adapters like this one. The hook is a read-only PRESENTATION adapter
     — it reads `isError`/`error`/`refetch` and derives copy — so dedup inside it is a no-op
     for the 12 that already dedup and impossible for the 10 whose `refetch` is a caller-owned
     callback it does not own the lifecycle of. "Fixing it properly in the hook" is a decision
     that loses. */
  const errorState = useFetchErrorState({
    isError: Boolean(error),
    error,
    refetch: fetchRespondents,
  });

  // Handle sending reminder
  const handleRemind = async (userId) => {
    setRemindingUserId(userId);

    try {
      await promptAPI.sendReminder(promptId, userId);

      // Update local state with new last_reminded_at
      setRespondents(prev => prev.map(r =>
        r.user_id === userId
          ? { ...r, last_reminded_at: new Date().toISOString() }
          : r
      ));
    } catch (err) {
      // AC-2 WIDENED x the D2 AC-16 carve-out: `logger.error` (a Sentry EVENT) is retained here
      // rather than demoted to `logger.info`, because AC-16 (a) requires a capture on this
      // path. The error OBJECT is the only second argument (T-84-01) — no respondent list, no
      // member email, no user record, and no code value is added to the call.
      logger.error('Failed to send reminder:', err);

      /* DECISION Phase 88.6-32 (R1 / UI-SPEC §6.2's mutation row): BOTH branches of this catch
         now render through `toast.error`, and the inline `{reminderError && …}` block plus its
         `setReminderError` state are GONE. This is a mutation (a button press), so §6.2 puts
         it on the toast arm — and routing only the `else` here would leave ONE button
         surfacing its two failure modes two different ways.

         REJECTED 2026-09-14: keeping `setReminderError` as the single sink for both branches
         and changing only the raw-read branch's VALUE. That arm would have to be recorded as a
         NAMED §6.2 mutation-row exception, and `88.6-UI-SPEC.md:1007` (amendment A-30) scopes
         the only such exception to `createGroup.js` and says in terms that plan 32 task 2 must
         not inherit it; it would additionally require the deleted block to gain live-region
         semantics, because it announced nothing.

         Cooldown is code-driven, not prose-matched (the BE rewrote the old cooldown-duration
         wording to the generic registry message). Branch on the machine code
         `reminder_cooldown` and surface the exact reopen time from the envelope. NOTE:
         ApiError.details carries the WHOLE response body, so the envelope's own `details` is
         nested one level deeper — err.details.details.next_reminder_available (verified
         against the BE sendError('reminder_cooldown', { next_reminder_available }) shape).

         BOTH cooldown strings are carried across BYTE-FOR-BYTE. The computed reopen-time
         sentence is the most useful string this button produces; deleting the renderer without
         carrying it would have silently lost it. */
      if (err?.code === 'reminder_cooldown') {
        const nextAvailable = err?.details?.details?.next_reminder_available;
        if (nextAvailable) {
          const when = new Date(nextAvailable).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          toast.error(`You reminded this user recently. You can remind them again after ${when}.`);
        } else {
          toast.error('You reminded this user recently. Please wait before reminding them again.');
        }
      } else {
        // The register derives the copy from `ApiError.code`; no fallback is passed, because
        // UI-SPEC §6.3 holds no ratified string for this site and the register's own `unknown`
        // line is already ratified copy (P1).
        toast.error(getFetchErrorMessage(err));
      }
    } finally {
      setRemindingUserId(null);
    }
  };

  // Calculate if user has responded (for blind voting visibility)
  const userHasResponded = respondents.find(
    r => isMe(r.user_id)
  )?.has_responded;

  // Determine visibility level for slot counts
  const showSlotCounts = !blindVotingEnabled || pollClosed || userHasResponded;

  // Calculate response counts
  const responseCount = respondents.filter(r => r.has_responded).length;
  const totalCount = respondents.length;

  /* Error state — evaluated BEFORE the loading branch. Paired with the clear-on-success rule
     in `fetchRespondents`, this is what keeps the banner on screen across a refocus-driven
     retry instead of flashing the skeleton over it on every return-to-tab. NEITHER HALF WORKS
     ALONE: with the fetch-start clear still present the `if (loading)` guard wins under either
     branch order, which is why re-ordering on its own is inert.

     NOT authority-by-`groupPlanning`: `groupPlanning/page.js:309-311` renders LOADING FIRST
     (`heatmapLoading ? … : heatmapErrorState.showError ? … : heatmapPrompt ? …`). What that
     file's `DECISION Phase 88-25` at `:312-318` establishes is error-before-CONTENT — a failed
     request also leaves `heatmapPrompt` null, so flipping those two would tell someone whose
     request merely failed that their group has no poll running. It is NOT precedent for
     error-before-loading and must not be cited as such.

     NO `hasLoadedOnce` LATCH SET IN A `finally` — the obvious-looking alternative and the
     rejected one. It lets the `respondents.length === 0` empty state ("No group members
     found.") paint over a FAILED refetch, which is the exact class of defect that same
     `DECISION Phase 88-25` comment exists to prevent.

     THIS BANNER DOES NOT ANNOUNCE, and nothing here claims it does. `Banner.tsx:103`-`:109`
     renders the message INSIDE its `StatusRegion`, so the region is a CHILD of
     `FetchErrorBanner`: mounting the banner inside `if (…showError)` mounts the region already
     carrying its text — the exact shape `StatusRegion.tsx:8-12`'s EMPTY-FIRST contract
     codifies as non-announcing. The FULL branch is visible chrome, not an `sr-only` region, so
     plan 36's compact-branch hoist is not portable here; the conditional mount STAYS, as a
     deliberate divergence, and the residual is routed in
     `.planning/deferred/phase-88.6.md` (proposed owner: Phase 92). Today's raw
     `<span>{error}</span>` has no region at all, so the swap is an improvement either way.

     NO `title` PROP: UI-SPEC §6.3's register holds no ratified string for this surface and an
     executor never mints copy, so the banner takes its own ratified default. A site-specific
     title is a §6.3 amendment, not an executor's call. */
  if (errorState.showError) {
    return (
      <div className="bg-surface-card rounded-card border border-line p-4">
        <FetchErrorBanner
          state={errorState}
          reportContext="Availability poll — respondents fetch"
        />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="bg-surface-card rounded-card border border-line p-4">
        {/* `data-testid` is a REQUIREMENT here, not decoration: the skeleton's outer node had
            nothing addressable on it, so the "a refocus retry does not replace the banner with
            the skeleton" assertion was unwritable. Asserting on `animate-pulse` instead was
            rejected — that is a styling utility, and pinning a test to it makes a token rename
            a test failure. */}
        <div className="animate-pulse" data-testid="response-dashboard-skeleton">
          <div className="h-6 bg-surface-elevated rounded-sm w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-10 bg-surface-elevated rounded-sm"></div>
            <div className="h-10 bg-surface-elevated rounded-sm"></div>
            <div className="h-10 bg-surface-elevated rounded-sm"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-card border border-line p-4">
      <Heading level={3} size="heading" className="text-content-primary mb-3">
        Responses: {responseCount}/{totalCount} responded
      </Heading>

      {/* The reminder-error block that used to sit here is GONE — both of the remind button's
          failure modes go through `toast.error` now. See the DECISION marker in `handleRemind`
          for why, and for the rejected arm. */}

      {/* Blind voting notice */}
      {blindVotingEnabled && !pollClosed && !userHasResponded && !isAdmin && (
        <div className="mb-3 p-2 bg-status-warning-subtle border border-status-warning rounded-sm text-sm text-content-status-warning">
          Slot counts are hidden until you submit your response or the poll closes.
        </div>
      )}

      {/* Empty state */}
      {respondents.length === 0 ? (
        <p className="text-content-muted text-sm">No group members found.</p>
      ) : (
        /* Respondent list */
        <ul className="space-y-1">
          {respondents.map(r => (
            <li
              key={r.user_id}
              className="flex items-center justify-between py-2 px-2 rounded-sm hover:bg-surface-hover border-b border-line last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                {r.has_responded ? (
                  <CheckIcon className="w-5 h-5 text-content-status-success shrink-0" />
                ) : (
                  <ClockIcon className="w-5 h-5 text-content-muted shrink-0" />
                )}

                <span className="text-content-primary truncate">
                  {r.username}
                  {isMe(r.user_id) && (
                    <span className="text-content-muted text-sm ml-1">(you)</span>
                  )}
                </span>

                {r.has_responded && showSlotCounts && r.slot_count !== null && (
                  <span className="text-sm text-content-muted shrink-0">
                    - {r.slot_count} slot{r.slot_count !== 1 ? 's' : ''} available
                  </span>
                )}

                {r.has_responded && (!showSlotCounts || r.slot_count === null) && (
                  <span className="text-sm text-content-muted shrink-0">
                    - responded
                  </span>
                )}

                {!r.has_responded && (
                  <span className="text-sm text-content-muted shrink-0">
                    - pending
                  </span>
                )}
              </div>

              {/* Remind button for admins on non-respondents */}
              {isAdmin && !r.has_responded && !isMe(r.user_id) && (
                <RemindButton
                  userId={r.user_id}
                  lastRemindedAt={r.last_reminded_at}
                  isReminding={remindingUserId === r.user_id}
                  onRemind={handleRemind}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Refresh button */}
      <button
        onClick={fetchRespondents}
        className="mt-4 text-sm text-content-muted hover:text-content-secondary active:opacity-75 flex items-center gap-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
      >
        <RefreshIcon className="w-4 h-4" />
        Refresh
      </button>
    </div>
  );
}

/**
 * RemindButton - Button to send reminder with 24-hour cooldown display
 */
function RemindButton({ userId, lastRemindedAt, isReminding, onRemind }) {
  // Check if within 24-hour cooldown
  if (lastRemindedAt) {
    const hoursSince = (Date.now() - new Date(lastRemindedAt)) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      const hoursAgo = Math.floor(hoursSince);
      const minutesAgo = Math.floor((hoursSince % 1) * 60);

      let timeAgo;
      if (hoursAgo === 0) {
        timeAgo = `${minutesAgo}m ago`;
      } else {
        timeAgo = `${hoursAgo}h ago`;
      }

      return (
        <span className="text-sm text-content-muted shrink-0">
          Reminded {timeAgo}
        </span>
      );
    }
  }

  return (
    <button
      onClick={() => onRemind(userId)}
      disabled={isReminding}
      className="px-3 py-1 text-sm text-content-link rounded-sm hover:bg-surface-hover active:opacity-75 disabled:opacity-50 shrink-0 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
    >
      {isReminding ? 'Sending...' : 'Remind'}
    </button>
  );
}


// Icon Components

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ClockIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// `ExclamationIcon` was deleted with the hand-rolled error branch it was the only consumer of
// — `FetchErrorBanner` composes `Banner tone="warning"`, whose tone Icon supplies the leading
// glyph. Keeping a dead local SVG beside a primitive that already draws one is the duplication
// the adoption exists to remove.

function RefreshIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
