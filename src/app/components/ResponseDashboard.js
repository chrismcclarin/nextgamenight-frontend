'use client';

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { toast } from 'sonner';
import { promptAPI } from '@/lib/api';
import {
  useFetchErrorState,
  getFetchErrorMessage,
} from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Heading } from '../../components/ui/Heading';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { logger } from '@/lib/logger';
import { formatDateTime } from '../../lib/datetime';
import { useTimezone } from './TimezoneProvider';

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
  // D-35 (Phase 88.6.1-11): the rows whose reminder is in flight, one entry per row.
  const [remindingUserIds, setRemindingUserIds] = useState([]);
  const { timezone } = useTimezone();

  /* The phase's ONE staleness idiom, ported from the shipped
     `NextGameNightCard.tsx:231`/`:236`/`:241`/`:248-250` cancelled-generation guard (the same
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
  // W031 (Phase 88.6.1-11): the respondents capture's per-episode latch; see the catch below.
  const lastReportedKeyRef = useRef(null);
  // D-35 (Phase 88.6.1-11): the synchronous per-row latch (a Set of user ids); see handleRemind.
  const remindInFlightRef = useRef(new Set());
  // Req 5 (Phase 88.6.1-11): the 'Responses:' heading is the focus fallback (D-05), and each
  // row's settled "Reminded ..." text is the preferred target; see handleRemind.
  const responsesHeadingRef = useRef(null);
  const recovery = useFocusRecovery({ fallback: responsesHeadingRef });
  const remindStatusIdPrefix = useId();
  const statusIdFor = (userId) => `${remindStatusIdPrefix}remind-status-${userId}`;

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
         (`grouplist.js:87-88`, `groupPlanning/page.js:157`), which is REJECTED at this call
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
      // W031: a current-generation success ends the failure episode (the catch's latch).
      lastReportedKeyRef.current = null;
    } catch (err) {
      // AC-2 WIDENED x the D2 AC-16 carve-out: this stays `logger.error` (a Sentry EVENT), not
      // `logger.info`, because AC-16 (a) requires a Sentry capture on this path. Logged BEFORE
      // the generation guard on purpose — a request that really failed is a real diagnostic
      // even when its answer is no longer wanted. The error OBJECT is the only second argument
      // (T-84-01): no respondent list, no member email, no identity field.
      // Re-confirmed 2026-09-29 (plan 88.6-63, review round 2 #6, R2-6-RECONFIRM: keep) — the swap to
      // guard-first was ruled on a misread of RsvpSection.js's marker and is void; this log-first
      // order is pinned by ResponseDashboard.test.tsx ("a superseded failure is still REPORTED").
      //
      // DECISION Phase 88.6.1-11 (W031) [D-26, Req 11]: ONE Sentry event per failure EPISODE,
      // still log-first. The capture is latched on `lastReportedKeyRef`, keyed on this closure's
      // prompt id plus the error's code, and the latch resets exactly where the banner is cleared:
      // a current-generation success and a new `promptId` (the two `setError(null)` sites).
      // Without it the hook's error-only refocus refetch (`useFetchErrorState.ts:285`) filed one
      // event per return to the tab for one outage. Same idiom as `QuickSuggestions.js`'s
      // `lastReportedKeyRef`. REJECTED: (a) once per mount (a later real failure would be
      // invisible); (b) `logger.info` (AC-16 (a) needs an event, and `logger.info` is a
      // breadcrumb, `logger.ts:52-53`); (c) dedup inside `useFetchErrorState` (the hook-dedup
      // note at the adapter below). The latched call stays BEFORE the generation guard; moving
      // either is a decision, not a cleanup.
      const reportKey = `${promptId}:${err?.code ?? 'none'}`;
      if (lastReportedKeyRef.current !== reportKey) {
        logger.error('Failed to fetch respondents:', err);
        lastReportedKeyRef.current = reportKey;
      }
      if (generation !== generationRef.current) return;
      // Store the ERROR OBJECT, never a flattened string: `useFetchErrorState` derives the
      // user-facing copy from `ApiError.code` (`useFetchErrorState.ts:128`), so a string here
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
    // W031: a new prompt starts a new failure episode (the catch's latch).
    lastReportedKeyRef.current = null;
    fetchRespondents();
    // The cleanup this effect did not have. It bumps the generation on unmount AND on a
    // `promptId` change, so no in-flight response can write state after teardown or after the
    // component has moved on to a different poll.
    return () => {
      generationRef.current += 1;
    };
  }, [promptId, fetchRespondents]);

  /* The synthetic adapter onto the shared fetch-error pair, matching the shipped shape at
     `groupPlanning/page.js:220-247` and `grouplist.js:121-125`. Both of that idiom's recorded
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

  /* DECISION Phase 88.6.1-11 (D-35) [Req 4, the rule of POSITION, `DECISION Phase 88.6-22` at
     `FriendInvitePanel.js:59`]: the Remind button the admin pressed takes `aria-disabled` plus a
     SYNCHRONOUS per-row ref latch (`remindInFlightRef`, a Set of user ids, refused on the first
     line, released in `finally`), chosen OVER the native attribute it shipped with. A natively
     disabled control leaves the focus order, stranding a keyboard or switch user mid-send. The
     latch is a REF because a state write does not land before a second synchronous press
     (`FriendInvitePanel.js:74-75`). The in-flight state is PER ROW (`remindingUserIds`): one
     shared id flipped the first row back to 'Remind' mid-flight when a second row was pressed.
     REJECTED: (a) one shared latch (it would silently drop a press on a second row, which
     works today); (b) natively gating the other rows (they are independent actions on different
     members, not siblings of one action, so nothing stays native); (c) a not-allowed cursor
     utility on the gated state (a desktop cursor change in a non-look phase). Dropping either
     half, or restoring the native attribute, is a decision, not a cleanup. */
  // Handle sending reminder
  const handleRemind = async (userId) => {
    if (remindInFlightRef.current.has(userId)) return;
    remindInFlightRef.current.add(userId);
    setRemindingUserIds((prev) => [...prev, userId]);

    try {
      await promptAPI.sendReminder(promptId, userId);

      /* DECISION Phase 88.6.1-11 (Req 5) [D-04 / D-05; D-06 is the precedent for focusing settled
         text]: a successful remind unmounts the focused button (the row then shows its
         'Reminded ...' text), so the host arms plan 88.6.1-04's `useFocusRecovery` and focus
         lands on that row's text, else on the 'Responses:' heading (the fallback), never on
         <body>. The text takes programmatic focus only (the hook adds and removes `tabindex=-1`);
         no heading and no text is minted.
         ARM AT SUCCESS, NOT AT PRESS: a failure removes nothing, so arming at press would leave
         the hook armed over an outcome with no removal. Arming after the await gives up the
         hook's arm-while-focused moment, so this host restores it with a GUARD: it arms only
         while THIS row's Remind button (looked up by its id with `getElementById`, compared as an
         element, never by text) still holds focus at success. A user who moved to another row or
         control meanwhile is never armed for, so never pulled back (D-04 never moves them); an
         unmounted dashboard has no such button, so a late resolve adds no focusin listener and
         no observer. On Safari's click path a pressed button never takes focus, so the guard
         arms nothing there and the removal drops no focus, because the button held none; plan
         88.6.1-57's optional VoiceOver step observes what iOS does.
         REJECTED: (a) inline per-host focus code (D-04, rejected by tenet);
         (b) arming after the await on behalf of a row the user is not on;
         (c) moving this guard into the shared hook (its contract is unchanged; the guard is this
         host's post-await choice). The
         `last_reminded_at` write happens either way. It is a decision, not a cleanup. */
      const pressed = document.getElementById(remindButtonIdFor(statusIdFor(userId)));
      const settle =
        pressed !== null && pressed === document.activeElement
          ? recovery.arm({ preferred: () => document.getElementById(statusIdFor(userId)) })
          : null;
      // Update local state with new last_reminded_at
      setRespondents(prev => prev.map(r =>
        r.user_id === userId
          ? { ...r, last_reminded_at: new Date().toISOString() }
          : r
      ));
      settle?.();
    } catch (err) {
      // AC-2 WIDENED x the D2 AC-16 carve-out: `logger.error` (a Sentry EVENT) is retained here
      // rather than demoted to `logger.info`, because AC-16 (a) requires a capture on this
      // path. The error OBJECT is the only second argument (T-84-01) — no respondent list, no
      // member email, no user record, and no code value is added to the call.
      // AMENDED by DECISION Phase 88.6.1-11 (W031) [D-26, Req 11]: the capture is kept on EVERY
      // non-cooldown failure (AC-16 (a)), and now lives in the `else` arm below. A
      // `reminder_cooldown` answer is an expected outcome the user is already told about by the
      // toast, so it files nothing. REJECTED: a `logger.info` breadcrumb in the cooldown arm (a
      // new diagnostic for an expected answer; SPEC Prohibition 5 asks this phase to add none it
      // does not need). Moving the capture back above the branch is a decision, not a cleanup.

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
          // Phase 88.6-57 (CR-301): the reopen instant is formatted in the PROFILE zone the
          // rest of the page speaks (`useTimezone()`), through the shared `formatDateTime` —
          // chosen OVER keeping `toLocaleString([], …)`, which used the browser zone. The
          // string is a formatted instant, not ratified copy; it now also carries the zone
          // abbreviation (e.g. "Sep 17, 12:30 PM" -> "Sep 18, 9:30 AM GMT+14").
          const when = formatDateTime(new Date(nextAvailable), timezone);
          toast.error(`You reminded this user recently. You can remind them again after ${when}.`);
        } else {
          toast.error('You reminded this user recently. Please wait before reminding them again.');
        }
      } else {
        // W031: the AC-16 (a) capture, on the non-cooldown failure only (marker above).
        logger.error('Failed to send reminder:', err);
        // The register derives the copy from `ApiError.code`; no fallback is passed, because
        // UI-SPEC §6.3 holds no ratified string for this site and the register's own `unknown`
        // line is already ratified copy (P1).
        toast.error(getFetchErrorMessage(err));
      }
    } finally {
      remindInFlightRef.current.delete(userId);
      setRemindingUserIds((prev) => prev.filter((id) => id !== userId));
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

     NOT authority-by-`groupPlanning`: `groupPlanning/page.js:451-453` renders LOADING FIRST
     (`heatmapLoading ? … : heatmapErrorState.showError ? … : heatmapPrompt ? …`). What that
     file's `DECISION Phase 88-25` at `:454-460` establishes is error-before-CONTENT — a failed
     request also leaves `heatmapPrompt` null, so flipping those two would tell someone whose
     request merely failed that their group has no poll running. It is NOT precedent for
     error-before-loading and must not be cited as such.

     NO `hasLoadedOnce` LATCH SET IN A `finally` — the obvious-looking alternative and the
     rejected one. It lets the `respondents.length === 0` empty state ("No group members
     found.") paint over a FAILED refetch, which is the exact class of defect that same
     `DECISION Phase 88-25` comment exists to prevent.

     THE BANNER IS ANNOUNCED. AMENDED Phase 88.6.1-11 (D-42, outline shared rule 8): this
     paragraph used to claim the conditionally mounted banner never announces; that premise was
     wrong and is replaced here. `FetchErrorBanner` is warning-toned, so its `StatusRegion` is
     `role="alert"` (`Banner.tsx:87`, `:103-104`), and an inserted alert that arrives carrying its
     text IS announced (D-42: ARIA 1.2 `alert`; TetraLogical 2024 matrix incl. VoiceOver iOS).
     The non-announcing claim the old text leaned on holds for polite / status regions only
     (`StatusRegion.tsx:9`, the EMPTY-FIRST contract). The conditional mount STAYS. The Phase 92
     residual this paragraph routed is void. Today's raw `<span>{error}</span>` has no region at
     all, so the swap is an improvement either way.

     THE `title` PROP, and why it exists now. AMENDED Phase 88.6-42 (owner ratification
     2026-09-16): this block previously read "NO `title` PROP: UI-SPEC §6.3's register holds no
     ratified string for this surface and an executor never mints copy, so the banner takes its
     own ratified default. A site-specific title is a §6.3 amendment, not an executor's call."
     That reasoning was RIGHT and is what produced the amendment rather than a workaround: the
     owner ratified "We couldn't load the respondents." into §6.3, and plan 42 wrote the row.
     The banner's own default ("Something went wrong") is generic chrome on a surface whose
     whole subject is WHO HAS REPLIED, so the named string tells the reader which fetch failed
     without painting anything upstream. Changing this string is a §6.3 amendment, not an
     executor's call — that half of the original rule is unchanged. */
  if (errorState.showError) {
    return (
      <div className="bg-surface-card rounded-card border border-line p-4">
        <FetchErrorBanner
          state={errorState}
          title="We couldn't load the respondents."
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
      <Heading ref={responsesHeadingRef} level={3} size="heading" className="text-content-primary mb-3">
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
                  isReminding={remindingUserIds.includes(r.user_id)}
                  statusId={statusIdFor(r.user_id)}
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

/* DECISION Phase 88.6.1-11 (floor) [SPEC Constraints: 44x44 is the floor on every control this
   phase touches]: the Remind button was about 28px tall (a 20px small-text line plus its
   vertical padding). It takes the house negative-margin floor (`userProfile/page.js:1530`): a
   44px minimum height that centres its label, with a negative vertical margin that cancels the
   row's own vertical padding, so the row stays its height.
   ARITHMETIC (read from the class strings: the row's `py-2 px-2` and bottom border, the list's
   `space-y-1`): the button's margin box is 44 - 16 = 28px tall, the row is 28 + 16 + 1px border =
   45px, and the button's border box spans the row's padding box only, so it stops above the
   row's bottom border; adjacent rows are separated by that border plus the 4px list gap. The
   username is plain text, so Remind is the only interactive control in a row today.
   REJECTED: (a) the plain minimum height alone (every pending row grows by about 16px, a look
   change in a non-look phase); (b) dropping the floor at the medium breakpoint (unnecessary once
   the row does not grow). DISCLOSED DELTA: the hover wash and the focus ring now span the row's
   full height. OWNER-CONFIRMED 2026-10-05 ('Ratify'; plan 88.6.1-58 ledger row P-13) on the
   condition that no Remind tap area overlaps another control, which the phone spec's no-overlap
   test pins (`e2e/response-dashboard-remind.spec.ts`, test 3). Changing the margin, the padding
   or the gap is a decision, not a cleanup.
   The in-flight wash is the aria-disabled opacity variant at the same 0.5 as before (house
   raw-button precedent at `KebabMenu.js:520`). */

/** The Remind button's id, derived from its row's status id in ONE place (Req 5 guard). */
function remindButtonIdFor(statusId) {
  return `${statusId}-button`;
}

/**
 * RemindButton - Button to send reminder with 24-hour cooldown display
 */
function RemindButton({ userId, lastRemindedAt, isReminding, statusId, onRemind }) {
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
        <span id={statusId} className="text-sm text-content-muted shrink-0">
          Reminded {timeAgo}
        </span>
      );
    }
  }

  return (
    <button
      id={remindButtonIdFor(statusId)}
      onClick={() => onRemind(userId)}
      aria-disabled={isReminding || undefined}
      className="-my-2 inline-flex min-h-11 items-center px-3 py-1 text-sm text-content-link rounded-sm hover:bg-surface-hover active:opacity-75 aria-disabled:opacity-50 shrink-0 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
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
