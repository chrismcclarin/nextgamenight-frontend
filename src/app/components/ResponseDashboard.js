'use client';

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { toast } from 'sonner';
import { promptAPI } from '@/lib/api';
import {
  useFetchErrorState,
  getFetchErrorMessage,
} from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner, RefreshFailedNotice, RetainedContentFocusGuard, useRetainedContent } from '../../components/ui/FetchErrorBanner';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { logger } from '@/lib/logger';
import { formatDateTime } from '../../lib/datetime';
import { useTimezone } from './TimezoneProvider';

// Copy row P14 (close ruling P-14, owner 2026-10-17; D-30 hoisted constant; D-32 R8 has nothing to normalise — no apostrophe).
const RESPONSES_LOADING_LABEL = 'Loading responses...';
// Copy ruling CR-3 (88.6.1 code review A-42, owner ratified 2026-10-19; D-30 placement rule: a
// hoisted constant at the site): what a PRESSED Refresh says while it runs and when it succeeds.
// The ellipsis is the single character U+2026.
const REFRESHING_RESPONSES_COPY = 'Refreshing responses…';
const RESPONSES_REFRESHED_COPY = 'Responses refreshed.';

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
  // AC-29 / RF1 (Phase 88.6.1-73, 88.6.1-70 contract C3): the prompt id of the last SUCCESSFUL
  // load, set only by a current-generation success. It replaces the old `loading` flag as the
  // render's first-load test (the AC-29 / RF1 marker at the render): the skeleton is simply what
  // shows while nothing has loaded for THIS prompt, so no loading flag is read any more.
  const [loadedFor, setLoadedFor] = useState(null);
  // The stamped failure record `{ key, caught }`: `key` is the prompt it was read for, `caught` the
  // thrown error itself (see the catch). The field is `caught`, not `error`, so this local record
  // is never read as an API envelope's `.error` (errorEnvelopeReads.test.ts; plan 88.6.1-31's shape).
  const [error, setError] = useState(null);
  // Review #237 (Phase 88.6.1-73): true while a PRESSED 'Refresh' is out; drives the word-free
  // busy cue (the icon's spin and the list's aria-busy). Only the press sets it.
  const [refreshing, setRefreshing] = useState(false);
  // CR-3 / A-42: the spoken line of a PRESSED Refresh (the marker at the region in the render).
  const [refreshStatus, setRefreshStatus] = useState('');
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
  // C4 (Phase 88.6.1-73): the in-flight run's promise, handed to a call that joins it.
  const inFlightRunRef = useRef(null);
  // W031 (Phase 88.6.1-11): the respondents capture's per-episode latch; see the catch below.
  const lastReportedKeyRef = useRef(null);
  // D-35 (Phase 88.6.1-11): the synchronous per-row latch (a Set of user ids); see handleRemind.
  const remindInFlightRef = useRef(new Set());
  // Req 5 (Phase 88.6.1-11): the 'Responses:' heading is the focus fallback (D-05), and each
  // row's settled "Reminded ..." text is the preferred target; see handleRemind.
  const responsesHeadingRef = useRef(null);
  const recovery = useFocusRecovery({ fallback: responsesHeadingRef });
  // Req 5 under C10 (Phase 88.6.1-73): a SECOND instance for the 'Refresh' press, because `arm()`
  // replaces any earlier intent of the same instance and the Remind button arms the one above.
  const refreshRecovery = useFocusRecovery({ fallback: responsesHeadingRef });
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
    /* DECISION Phase 88.6.1-73 (C4) [88.6.1-70 contract C4]: a call that finds this generation
       already in flight is handed THAT run's promise, so it resolves `{ isError }` only when the
       run settles; the generation-keyed short-circuit itself (keyed "deliberately", above) is
       unchanged. The run resolves `{ isError: false }` / `{ isError: true }` for a current-
       generation success / failure, `undefined` when the generation moved on, and never rejects.
       REJECTED: resolving a joining call at once — the RF1 notice reads that outcome, so it would
       treat it as unknown, end its dwell and re-speak the failure while the request is still out,
       a moment before a success can land. Changing this is a decision, not a cleanup. */
    if (inFlightGenerationRef.current === generation) return inFlightRunRef.current;
    inFlightGenerationRef.current = generation;
    // This run's own promise, answered in `finally` with the run's outcome.
    let answerRun = () => {};
    inFlightRunRef.current = new Promise((resolve) => {
      answerRun = resolve;
    });
    let outcome;
    try {
      const data = await promptAPI.getRespondents(promptId);
      if (generation !== generationRef.current) return undefined;
      setRespondents(data);
      // C3: only a current-generation SUCCESS records what has loaded; no catch or finally does.
      setLoadedFor(promptId);
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

         Restoring the fetch-start clear is a decision, not a cleanup.

         AMENDED Phase 88.6.1-73 (AC-29 / RF1): owner ruling 2026-10-05 — this clear-on-success
         rule is now ALSO what keeps the RF1 notice and its focused Retry on screen through a
         retry (88.6.1-70 contract C2: the error is cleared only by the newest run's success,
         never at the start of a run). The "ordering" half above now governs the not-yet-loaded
         case only, because a roster that loaded for this prompt stays on screen. */
      setError(null);
      // W031: a current-generation success ends the failure episode (the catch's latch).
      lastReportedKeyRef.current = null;
      outcome = { isError: false };
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
      if (generation !== generationRef.current) return undefined;
      // Store the ERROR OBJECT, never a flattened string: `useFetchErrorState` derives the
      // user-facing copy from `ApiError.code` (`useFetchErrorState.ts:128`), so a string here
      // would make every failure resolve to `unknown` and render one generic line for a 403, a
      // 404 and a 500 alike — WHILE the roster scan reported green, because the `err.message`
      // read would be gone. `getFetchErrorMessage` is deliberately NOT applied here.
      // Phase 88.6.1-73: the record's `caught` field holds that object (so a 401 / 403 keeps its
      // code, C10), and its `key` field is the prompt it was read for, so a new prompt never shows
      // the previous prompt's failure, even for the one commit before the `promptId` effect below
      // clears it (an inserted alert that carries text IS announced, D-42).
      setError({
        key: promptId,
        caught: err instanceof Error ? err : new Error("The respondents request didn't complete."),
      });
      outcome = { isError: true };
    } finally {
      if (inFlightGenerationRef.current === generation) {
        inFlightGenerationRef.current = null;
        inFlightRunRef.current = null;
      }
      // C4: every caller this run answers (the starter and any call that joined it) gets the
      // run's outcome; `undefined` when the generation moved on.
      answerRun(outcome);
    }
    return outcome;
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
  // Phase 88.6.1-73 (C2, C3): only a record stamped with the CURRENT prompt reaches the hook.
  const currentError = error && error.key === promptId ? error.caught : null;
  const errorState = useFetchErrorState({
    isError: Boolean(currentError),
    error: currentError,
    refetch: fetchRespondents,
  });
  // 88.6.1-70 contract C10: `retained` comes from plan 70's one hook, at the top level before any
  // early return. `hasData` is C3's has-loaded flag for THIS prompt, never a row count (a roster
  // that loaded EMPTY is retained content, owner ruling Y). No code list is written here.
  const retained = useRetainedContent(loadedFor === promptId, errorState);
  /* DECISION Phase 88.6.1-73 (C12, focus when content leaves) [88.6.1-70 contract C12 (a), C8 (f)]:
     CHOSEN — plan 70's one shared guard, ONE instance rendered as the card's next sibling (the
     second child of a top-level fragment) in every return below, so React keeps it across the
     switch from the roster to the not-retained card and it sees `retained` go from true to false.
     It covers the refresh nobody pressed (the hook's tab-return re-attempt), which arms nothing:
     an access answer to it withdraws the roster while a control inside it may hold focus. The
     'Refresh' press arm (`refreshRecovery`) stays for the press (plan 70: a site's own press arm
     may stay). It takes the notice's own `focusTarget`; after a withdrawal that ref is null (the
     heading leaves with the roster), so the guard floors (dialog title, `main h1`, `main`).
     REJECTED — (a) the guard in the content return only: it unmounts with the roster and never
     sees the flip; (b) the guard BEFORE the card: here it would land on the same floor, but in
     `EventCalendar.js` the target heading attaches during the card's own layout pass, and one
     shape for both files keeps a later edit from copying the wrong one; (c) focus code of this
     file's own (D-04, one shared mechanism). Changing this is a decision, not a cleanup. */
  const retainedGuard = <RetainedContentFocusGuard retained={retained} focusTarget={responsesHeadingRef} />;

  /* Phase 88.6.1-73 (Req 5 under C10, plan 88.6.1-04's consumer contract): an access or gone answer
     to a 'Refresh' press now replaces the whole card, unmounting the focused button, so the press
     arms `refreshRecovery` synchronously before any await and settles it in `finally`. The button
     stays enabled (a second press joins the in-flight run through the short-circuit). Review
     #237: the skeleton no longer acknowledges a press, so `refreshing` drives a word-free busy cue
     (the icon spins, the roster list is aria-busy) while the PRESSED request is out; the tab-return
     re-attempt and the notice's Retry (which has its own `Retrying…`) do not set it. */
  // 88.6.1 code review: `from: event.currentTarget` per useFocusRecovery's consumer contract (1) —
  // Safari does not focus a tapped button, and a bare `arm()` then seeded from <body> and disarmed,
  // so an access answer that withdrew the roster dropped focus to <body>.
  const handleRefresh = async (event) => {
    const settle = refreshRecovery.arm({ from: event?.currentTarget ?? null });
    setRefreshing(true);
    setRefreshStatus(REFRESHING_RESPONSES_COPY);
    let result;
    try {
      result = await fetchRespondents();
    } finally {
      setRefreshing(false);
      // CR-3 / A-42: only a current-generation success is announced; a failure (RF1 speaks it) or
      // a superseded run (undefined) empties the line, so nothing is said twice.
      setRefreshStatus(result && result.isError === false ? RESPONSES_REFRESHED_COPY : '');
      settle();
    }
  };

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

    // 88.6.1 code review IN-12: the component-scope generation guard the fetch already reads. The
    // `promptId` effect bumps it, so a reminder that settles after the host moved to another poll
    // writes nothing into that poll's roster (and arms no focus recovery); the `finally` release
    // stays unconditional so the latch never sticks.
    const generation = generationRef.current;

    try {
      await promptAPI.sendReminder(promptId, userId);
      if (generation !== generationRef.current) return;

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

     AMENDED Phase 88.6.1-73 (AC-29 / RF1, owner ruling 2026-10-05): the order below now applies
     only while nothing has loaded for this prompt. Once a roster has loaded, a failed refresh
     keeps it and shows the RF1 notice under the heading, so the screen says the refresh failed
     and that the roster is from earlier — nothing on it contradicts anything.

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
     AMENDED Phase 88.6.1-73 (AC-29 / RF1): the latch rejected here was set by a FAILURE too.
     `loadedFor` is set only by a successful load for THIS prompt, so a failed first load still
     reaches the banner, and the empty sentence can show over a failed refresh only when the
     earlier SUCCESSFUL load was empty — then with RF1 above it.

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
  /* DECISION Phase 88.6.1-73 (AC-29 / RF1, owner ruling 2026-10-05) [D-47, D-51, Req 9]:
     CHOSEN: a failed refresh keeps the roster and plan 88.6.1-70's `RefreshFailedNotice`
     qualifies it (88.6.1-70 contract C1-C10); the full banner and the skeleton are FIRST-LOAD-
     ONLY, keyed on `loadedFor` (D-09a's has-loaded flag for this prompt, never a row count); the
     notice sits under the heading, which is the section's label and the Retry's focus target.
     `retained` comes from plan 70's `useRetainedContent` (C10): a 401 / 403 / 404 / 410 answer is
     never RF1 — the full banner takes the roster's place, with the register's line, until the
     next success — and the 'Refresh' press arms `refreshRecovery` because such an answer unmounts
     it. A pressed 'Refresh' is acknowledged by a word-free busy cue (the spinning icon and
     aria-busy on the list) instead of the skeleton. The first-load banner takes the same
     `focusTarget` as the notice (review #82), so a successful Try again lands on the heading the
     success mounts, not on the page's top heading.
     REJECTED: (a) the full banner above the retained roster (two shapes for one situation; the
     orchestrator's consistency decision, manifest row 70); (b) the notice above the heading (the
     heading would no longer open the section the notice qualifies, and focus after a Retry would
     land below the spot the user pressed); (c) the skeleton on a healthy refresh of a loaded
     roster (the pressed Refresh unmounts and focus falls to <body>; D-09a / D-37); (d) the
     88.6-32-rejected `hasLoadedOnce` latch in a `finally` (still rejected — this flag is set by a
     success only); (e) a local list of access codes, or the bare predicate formula without the
     hook (C10: one predicate, read through the hook, whose memory stops a later 500 from
     re-showing a roster an access answer withdrew). Changing any of these is a decision, not a
     cleanup. */
  if (!retained) {
    if (errorState.showError) {
      return (
        <>
          <div className="bg-surface-card rounded-card border border-line p-4">
            <FetchErrorBanner
              state={errorState}
              title="We couldn't load the respondents."
              reportContext="Availability poll — respondents fetch"
              focusTarget={responsesHeadingRef}
            />
          </div>
          {retainedGuard}
        </>
      );
    }

    // Loading state: nothing has loaded for this prompt yet (the first load, or a new prompt).
    return (
      <>
        <div className="bg-surface-card rounded-card border border-line p-4">
          {/* DECISION Phase 88.6.1-86 (close ruling P-14, owner 2026-10-17): CHOSEN — the
              ratified loading line in the slot of the heading bar (the Responses heading lands
              here once the roster loads), outside the pulse, in the plain-paragraph shape of the
              calendar's loader (`EventCalendar.js`, anchor `Loading calendar...`); the three row
              bars keep pulsing below it. REJECTED: (a) the line above the heading bar (two
              heading-shaped rows, one of them blank); (b) the line inside the `animate-pulse`
              block (the words would pulse in and out of contrast); (c) `sr-only` text (the owner
              ratified a visible line in the calendar loader's shape); (d) a live region (no app
              loader announces itself; the line is read where it sits). Changing this is a
              decision, not a cleanup. */}
          <p className="text-content-secondary mb-4">{RESPONSES_LOADING_LABEL}</p>
          {/* `data-testid` is a REQUIREMENT here, not decoration: the skeleton's outer node had
              nothing addressable on it, so the "a refocus retry does not replace the banner with
              the skeleton" assertion was unwritable. Asserting on `animate-pulse` instead was
              rejected — that is a styling utility, and pinning a test to it makes a token rename
              a test failure. */}
          <div className="animate-pulse" data-testid="response-dashboard-skeleton">
            <div className="space-y-3">
              <div className="h-10 bg-surface-elevated rounded-sm"></div>
              <div className="h-10 bg-surface-elevated rounded-sm"></div>
              <div className="h-10 bg-surface-elevated rounded-sm"></div>
            </div>
          </div>
        </div>
        {retainedGuard}
      </>
    );
  }

  return (
    <>
    <div className="bg-surface-card rounded-card border border-line p-4">
      <Heading ref={responsesHeadingRef} level={3} size="heading" className="text-content-primary mb-3">
        Responses: {responseCount}/{totalCount} responded
      </Heading>
      <RefreshFailedNotice state={errorState} retained={retained} focusTarget={responsesHeadingRef} className="mb-3" />

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
        <ul className="space-y-1" aria-busy={refreshing ? 'true' : undefined}>
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

      {/* Refresh button.
          DECISION Phase 88.6.1 code review A-35 / A-41 (floor) [SPEC Constraints: 44x44 on every
          control this phase touches]: CHOSEN — a 44px minimum height (`min-h-11`, label centred)
          with the top margin cut from 16px to 4px and a -12px bottom margin, so the label sits
          where it did and the card's bottom spacing does not grow (the sibling Remind's
          negative-margin floor, DECISION Phase 88.6.1-11 (floor) below). REJECTED — the plain
          minimum height alone (the card grows by 24px, a look change in a non-look phase).
          Pinned by `controlSizeFloor.test.tsx` subject `responseDashboardRefresh`. Changing the
          margins is a decision, not a cleanup. */}
      <button
        onClick={handleRefresh}
        className="mt-1 -mb-3 min-h-11 text-sm text-content-muted hover:text-content-secondary active:opacity-75 inline-flex items-center gap-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
      >
        <RefreshIcon className={refreshing ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
        Refresh
      </button>
      {/* DECISION Phase 88.6.1 code review CR-3 / A-42 (owner ratified 2026-10-19, WCAG 4.1.3):
          a PRESSED Refresh is heard from this ONE polite region, mounted empty with the roster
          (EMPTY-FIRST) and OUTSIDE the aria-busy list, which most screen readers do not announce
          and which is absent when the roster is empty. It says Refreshing responses… when the
          press starts and Responses refreshed. when it succeeds; a repeat press re-announces
          because the text changes back to Refreshing first. A failure EMPTIES it and says
          nothing, chosen OVER a failure line here, because RefreshFailedNotice already speaks
          the failure and a second line would double-announce. The tab-return re-attempt and the
          notice's Retry (its own Retrying…) never write here: nobody pressed Refresh. sr-only for
          its whole life, chosen OVER srOnlyWhenEmpty, because the sighted cue (the spin and the
          new count) already exists and a visible line would be a look change. Changing any of
          this is a decision, not a cleanup. */}
      <StatusRegion className="sr-only" data-testid="response-dashboard-refresh-status">
        {refreshStatus}
      </StatusRegion>
    </div>
    {retainedGuard}
    </>
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
