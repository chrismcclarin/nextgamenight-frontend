'use client';

/**
 * DangerZoneDeleteAccount — the irreversible account-deletion flow (Phase 87.2,
 * SPEC Req 7). Born-typed per the project preference for new primitives.
 *
 * UX contract (D-13..D-17):
 *   - A red-accented Danger Zone card with a single trigger button that opens a
 *     NON-DISMISSABLE danger modal (Modal.tsx, dismissable={false} — only
 *     outside-click is suppressed; Esc + close button still abandon the flow,
 *     which is non-destructive, RESEARCH Pitfall 10).
 *   - STATIC warning prose enumerates what is destroyed vs. what survives
 *     anonymized (D-17) — NO live counts, NO pre-flight spinner.
 *   - A fixed-phrase type-to-confirm gate: the confirm button stays disabled
 *     until the input exactly equals `delete my account` (D-15). No native
 *     confirm() is stacked on top.
 *   - On modal open (NEVER on page load) it calls getDeletionBlockers; while the
 *     pre-flight is pending the confirm input is disabled (no spinner). A 200
 *     with non-empty groups renders the blocked state WITHOUT ever issuing the
 *     DELETE. The pre-flight is a 200 { groups } body — it NEVER rejects with
 *     owner_of_active_groups (that code arrives only on the DELETE, the
 *     server-side TOCTOU re-check, D-10).
 *
 * DELETE outcome splits THREE ways (do NOT collapse them):
 *   1. BLOCKED — owner_of_active_groups @409 on the DELETE (or the pre-flight
 *      resolving 200 with non-empty groups): keep the modal open, render the
 *      blocked-groups list as named transfer links. The 409 list is NESTED at
 *      err.details.details.groups — read it via getEnvelopeDetails, never
 *      err.details.groups (which is undefined and renders a dead-end).
 *   2. AMBIGUOUS — network failure/timeout, 504/408 proxy abort, or
 *      not_found/410 (already deleted): navigate to logout->goodbye the same as
 *      success. A BFF 504 can arrive AFTER the backend commit, and an
 *      already-deleted account must never be left on a live session (Pitfall 9 /
 *      threat T-87.2-22).
 *   3. DEFINITIVE backend failure — 500/'internal' with a received response
 *      body, or any other 4xx not covered above: the transaction rolled back and
 *      NOTHING was deleted, so keep the session and the modal open with a
 *      safe-retry message. Destroying the session here would break the SPEC's
 *      retryable path.
 *      Phase 88.8 (D-19): the never-provisioned 404 joins this lane — same
 *      non-destructive outcome, same surviving session — but carries its OWN
 *      copy (NOT_PROVISIONED_MESSAGE), because a plain retry can never resolve
 *      it and a reload can. Still THREE lanes, not four.
 *
 * On success (and ambiguous outcomes) navigation is IMMEDIATE via
 * window.location — no toast-then-wait — so no authenticated fetch re-provisions
 * a JIT ghost Users row before logout completes (Pitfall 9). The
 * ?returnTo=/goodbye honoring itself is delivered by plan 87.2-08's handleLogout
 * allowlist provider; this component owns only the navigation URL string.
 */

import * as React from 'react';

import { Modal } from './Modal';
import { Input } from '@/components/ui/Input';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { errCtx, logger } from '@/lib/logger';
import {
  ApiError,
  getEnvelopeDetails,
  usersAPI,
  type DeleteAccountBlockedDetails,
  type DeletionBlockerGroup,
} from '@/lib/api';

const CONFIRM_PHRASE = 'delete my account';
const LOGOUT_GOODBYE_URL = '/api/auth/logout?returnTo=/goodbye';
const DEFINITIVE_FAILURE_MESSAGE =
  'Deletion failed — nothing was deleted. Please try again.';
// A 409 blocked outcome whose envelope carries no renderable groups list
// (contract drift, a proxy stripping the body) must NOT silently no-op —
// fall back to a generic blocked explanation in the failure-message slot.
const BLOCKED_NO_DETAILS_MESSAGE =
  'You still own groups with other members. Transfer ownership, then try again.';
// Phase 88.8 (BOPS-05, SPEC R7 / D-19). The DEFINITIVE lane's second copy, for
// the never-provisioned 404 registered BE-side by plan 07. The generic
// DEFINITIVE_FAILURE_MESSAGE says "try again", which for this outcome is advice
// that can never work: a repeat DELETE returns the same 404 forever. Reloading
// is what resolves it, because a reload runs the just-in-time provisioning
// fetch that creates the row. Wording is D-19's discuss-agreed string verbatim.
const NOT_PROVISIONED_MESSAGE =
  "There's no account data to delete yet. Reload the page and try again.";

/* DECISION Phase 88.6-30 (D52 piece (i), owner ruling 2026-09-13; visibility ruled
   2026-09-14): the in-flight progress region reuses THIS FILE'S ALREADY-SHIPPED
   in-flight string — the danger action's own `Deleting…` label — CHOSEN OVER minting a
   fuller sentence for the region.

   An executor never mints visible copy, and `88.6-UI-SPEC.md` §6.3 (the ratified-strings
   register) holds no progress string for this surface. The register-was-the-blocker
   precedent is `ResponseDashboard.js`, which shipped with NO banner title for exactly this
   reason until the owner ratified one. Rather than stop the whole plan on a missing
   register row, the region carries the string the dialog ALREADY says out loud, hoisted to
   one constant so the button label and the announcement cannot drift apart. Whether a
   fuller sentence is wanted here is an owner question, routed with plan 88.6-30's
   checkpoint — not a guess taken at execution. */
const DELETING_LABEL = 'Deleting…';

/* DECISION Phase 88.6-30 (D1, round-3 verdict): the in-flight DELETE is BOUNDED by a
   client timeout, CHOSEN OVER leaving it unbounded now that AC-21 has closed Cancel,
   Escape and the overlay. Undismissable without a bound is a worse state than the one
   AC-21 replaced: a request that never settles would leave the user with no exit but a
   browser reload, on the app's only irreversible flow.

   THE VALUE IS DERIVED, NOT PREFERRED — it is not an owner knob. It MUST exceed the BFF's
   own `PROXY_TIMEOUT_MS` (`src/app/api/[...path]/route.ts:22`, 30s). The citation chain:
   the BFF aborts its upstream leg at 30s (`:164-165`) and returns 504 (`:195-199`), which
   `classifyDeleteError` maps to 'ambiguous' at the `err.status === 504` arm; a plain
   network drop rejects as a TypeError -> ApiError('network', 0) -> 'ambiguous'. So every
   SERVER-side stall is already bounded. The only case this timer can reach is a
   browser<->BFF leg that stalls WITHOUT rejecting — half-open socket, captive portal,
   device sleep — which no server-side timer can see. Sitting ABOVE the proxy's value is
   what keeps it there: a SHORTER value would pre-empt the proxy's own 504 and convert the
   still-reachable `blocked` (409) and `definitive` (500-rollback) outcomes into false
   "your account has been deleted" logouts. That is the inverse of this file's own threat
   note above — never tell a user their account is gone when the request that would have
   deleted it was still reachable (Pitfall 9 / threat T-87.2-22).

   `DangerZoneDeleteAccount.test.tsx` asserts the ordering against the route's own
   constant, so the rule is mechanical rather than a comment. */
export const DELETE_REQUEST_TIMEOUT_MS = 45_000;

/**
 * Classify a DELETE rejection into the three outcome lanes. The ApiError seam
 * already carries `code` (envelope-preferred) and `status`; a definitive failure
 * is one where a response body was actually received (an ApiError that is not a
 * client-side network throw). A raw abort/timeout (non-ApiError) is ambiguous —
 * the deletion may have committed server-side.
 */
type DeleteOutcome = 'blocked' | 'ambiguous' | 'definitive';

export function classifyDeleteError(err: unknown): DeleteOutcome {
  if (err instanceof ApiError) {
    // 1. Owner gate — the server-side TOCTOU re-check fired.
    if (err.code === 'owner_of_active_groups') return 'blocked';
    // 2a. Client-side network failure (apiFetch throws code 'network', status 0).
    if (err.code === 'network') return 'ambiguous';
    // 2b. Proxy abort — a BFF 504/408 can arrive AFTER the backend committed.
    if (err.status === 504 || err.status === 408) return 'ambiguous';
    // DECISION Phase 88.8 D-19 / SPEC R7: the never-provisioned 404 gets its OWN
    // arm, placed deliberately ABOVE the already-gone lane below — chosen OVER
    // letting it keep falling through to `return 'definitive'` at the bottom,
    // which is what it does today and which produces the SAME value.
    //
    // What is true right now, so nobody "simplifies" this away as dead code:
    // the already-gone lane matches only `not_found`, `account_deleted` and a
    // bare status 410. A `not_provisioned` envelope arrives with that exact code
    // (mapErrorToCode passes body.code VERBATIM) and status 404, so it misses
    // all three and reaches the definitive fall-through. Behaviourally identical
    // — today.
    //
    // The arm earns its place on ORDER, not value. The lane below is the
    // logout->goodbye lane: widen it to "every 404" (an easy, plausible future
    // edit) and a user who never had an account would be signed out and shown a
    // page telling them their account was permanently deleted. Sitting above it
    // makes that widening impossible to make by accident. The COPY split is the
    // part that changes behaviour today, and it lives at the definitive branch
    // in handleDelete — see NOT_PROVISIONED_MESSAGE.
    if (err.code === 'not_provisioned') return 'definitive';
    // 2c. Already gone — repeat-DELETE tombstone / missing row.
    if (
      err.code === 'not_found' ||
      err.code === 'account_deleted' ||
      err.status === 410
    ) {
      return 'ambiguous';
    }
    // 3. Any other received-body failure (500/'internal', other 4xx) → the
    //    transaction rolled back; keep the session for a safe retry.
    return 'definitive';
  }
  // A non-ApiError throw: treat an abort/timeout as ambiguous (the request may
  // have committed server-side); anything else is definitive so we never destroy
  // the session on an unclassifiable failure.
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'ambiguous';
  return 'definitive';
}

/** Immediate, side-effecting navigation seam (overridable in tests). */
function navigateToLogout(): void {
  window.location.assign(LOGOUT_GOODBYE_URL);
}

export default function DangerZoneDeleteAccount(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [preflightPending, setPreflightPending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [blockedGroups, setBlockedGroups] = React.useState<
    DeletionBlockerGroup[] | null
  >(null);
  // WR-02: true only when the 409 envelope reported that the blocked-at-recheck
  // deletion had ALREADY revoked the user's Google Calendar integration.
  const [googleAccessRevoked, setGoogleAccessRevoked] = React.useState(false);
  const [failureMessage, setFailureMessage] = React.useState<string | null>(
    null
  );

  const isBlocked = blockedGroups !== null && blockedGroups.length > 0;

  /* DECISION Phase 88.6-30 (D-33, folded todo 2026-07-09 / 87.2 code review IN-05): the
     superseded pre-flight is discarded with a GENERATION COUNTER — this phase's ONE
     staleness idiom, chosen by plan 29 for this whole defect class, which REJECTED
     `AbortController` for it by name (`88.6-29-PLAN.md:394`, "AbortController is rejected
     here, not deferred"). A second idiom for one defect class is the duplication this
     phase exists to remove.

     THE COUNTER LIVES IN A REF — never `useState`, never a closured local. It is read
     inside `.then`/`.catch`/`.finally` AFTER an await, where a `useState` value is the one
     captured at issue time, so a state counter would pass the very check it exists to
     fail; and it would add two renders per open/close cycle on a modal the guard's own
     test opens and closes repeatedly. Same rule plan 29 states for the same idiom
     (`88.6-29-PLAN.md:379`, "The counter is COMPONENT-scope, and the port is deliberately
     NOT literal") — a component-scope counter in React is a ref. Do NOT port
     `NextGameNightCard`'s effect-local `let cancelled`: that is scoped to the effect that
     owns its promise, which this pre-flight is not.

     FOUR CHECKPOINTS, not one: the generation is bumped on modal OPEN and on CLOSE, all
     THREE settlement paths test it, and UNMOUNT invalidates it too. The `.finally` is not
     bookkeeping — a stale `.finally` clearing `preflightPending` early IS the todo's
     stated defect, so a guard covering only `.then` leaves the reported bug in place. */
  const preflightGenerationRef = React.useRef(0);
  React.useEffect(
    () => () => {
      preflightGenerationRef.current += 1;
    },
    []
  );

  /* D52 (owner ruling 2026-09-13) + D24 (outcome split): the focus targets. Each is a node
     THIS COMPONENT OWNS and holds a ref to. The Radix Content node is deliberately NOT a
     target: `Modal` renders `DialogContent` internally (`Modal.tsx:150-192`) and forwards
     no ref for it, and its only focus affordance — `initialFocusRef` (`:102`, `:121`,
     `:143`) — fires on `onOpenAutoFocus` and cannot serve a mid-life `deleting` edge. A
     `document.querySelector('[role="dialog"]')` lookup is REJECTED for the same reason
     plus its unassertability in jsdom. */
  const progressFocusRef = React.useRef<HTMLDivElement>(null);
  const confirmInputRef = React.useRef<HTMLInputElement>(null);
  const blockedLeadRef = React.useRef<HTMLParagraphElement>(null);
  const cancelActionRef = React.useRef<HTMLButtonElement>(null);

  const resetState = React.useCallback(() => {
    setConfirmText('');
    setPreflightPending(false);
    setDeleting(false);
    setBlockedGroups(null);
    setGoogleAccessRevoked(false);
    setFailureMessage(null);
  }, []);

  const handleClose = React.useCallback(() => {
    // AC-21 (owner ruling 2026-09-09): dismissing mid-DELETE would run `resetState()`
    // and leave the user with no indication of the request's outcome. The button-side
    // change alone does not make the ruling true — this modal mounts
    // `dismissable={false}`, which defeats overlay/outside dismissal but NOT Escape:
    // `Modal.tsx:133-135` records that Radix's `onEscapeKeyDown` is INTENTIONALLY left
    // enabled. One line closes every remaining path at once.
    if (deleting) return;
    // D-33: closing invalidates any outstanding pre-flight, so a response arriving
    // after the modal is reopened cannot land in the new cycle.
    preflightGenerationRef.current += 1;
    setOpen(false);
    resetState();
  }, [deleting, resetState]);

  // Pre-flight fires on MODAL OPEN — never on page load (D-17). The confirm
  // input is disabled while it is pending; a non-empty 200 renders the blocked
  // state without ever issuing the DELETE. The pre-flight NEVER rejects with the
  // owner code (contract) — a rare non-owner rejection (e.g. transient network)
  // is non-authoritative here, so we fall through to the normal confirm flow and
  // let the authoritative server-side gate re-check on the DELETE.
  const handleOpen = React.useCallback(() => {
    resetState();
    setOpen(true);
    setPreflightPending(true);
    const generation = (preflightGenerationRef.current += 1);
    const isCurrent = () => preflightGenerationRef.current === generation;
    usersAPI
      .getDeletionBlockers()
      .then((res) => {
        if (!isCurrent()) return;
        if (res.groups && res.groups.length > 0) {
          setBlockedGroups(res.groups);
        }
      })
      .catch((err: unknown) => {
        // D-33: a SUPERSEDED rejection stays completely silent — no state write and
        // no diagnostic. The guard comes FIRST for that reason.
        if (!isCurrent()) return;
        // Phase 88.6-30 (T-88.6-87): the UX swallow below is unchanged, but the
        // failure is no longer invisible. AC-16/D2 keeps this at `logger.info`, and
        // T-84-01 bounds the payload to the caught error's NAME and MESSAGE — never
        // the blockers list, and never the raw `Error` as `ctx` (`logger.ts:24` types
        // `ctx` as a plain record). `errCtx` rather than a hand-written
        // `{ name, message }` literal: spelling `message:` on the call line matches
        // `fetchErrorTreatment.test.ts`'s R1 sink pattern and would red a gate this
        // change never touched.
        logger.info('deletion pre-flight failed', errCtx(err));
        // The USER-FACING behaviour is intentionally swallowed: the pre-flight is
        // non-authoritative (it only pre-populates the blocked state as a UX
        // courtesy). A transient failure here must NOT block the flow — the
        // authoritative owner gate re-checks on the DELETE (D-10).
        //
        // CORRECTED Phase 88.6-30: this comment used to close with "and the query
        // layer already reports errors." That clause was FALSE for this path and is
        // deleted. The pre-flight is a BARE promise, not a TanStack query, so
        // `QueryCache.onError` -> `Sentry.captureException` (`queryClient.ts:162`,
        // wired at `:168`) never fires for it — which is why, on the app's most
        // destructive flow, a pre-flight failure previously produced no console line,
        // no Sentry event and no user signal at all. The `logger.info` above is the
        // channel that clause wrongly claimed already existed.
      })
      .finally(() => {
        // The todo's stated defect: a stale `.finally` clearing the pending flag
        // early, re-enabling the confirm input under a pre-flight still outstanding.
        if (!isCurrent()) return;
        setPreflightPending(false);
      });
  }, [resetState]);

  const handleDelete = React.useCallback(async () => {
    if (confirmText !== CONFIRM_PHRASE) return;
    setDeleting(true);
    setFailureMessage(null);
    /* DECISION Phase 88.6-30 (D1): this signal BOUNDS A WAIT. It does NOT discard a
       stale response, and it therefore does not violate plan 29's recorded rejection of
       `AbortController` for this phase's staleness class (`88.6-29-PLAN.md:394`,
       "AbortController is rejected here, not deferred"). That rejection is about WHICH
       RESPONSE TO APPLY when a superseded `fetchRsvps` must stay silent — a different
       question, and the generation counter above remains its answer. This is about HOW
       LONG TO WAIT before an irreversible flow with every dismissal path closed must
       give the user an exit. Re-deriving this as "plan 29 said no AbortController" is a
       category error; swapping it for a generation counter would leave the request
       running forever, which is the defect.

       An abort lands in the ALREADY-BUILT lane: `AbortError`/`TimeoutError` ->
       'ambiguous' -> `navigateToLogout()`. No new outcome, no new copy, no change to
       what deletion does. See the DELETE_REQUEST_TIMEOUT_MS marker for why the value is
       derived from the BFF's own timeout rather than chosen. */
    const controller = new AbortController();
    const bound = setTimeout(
      () => controller.abort(),
      DELETE_REQUEST_TIMEOUT_MS
    );
    try {
      await usersAPI.deleteAccount(controller.signal);
      // Success — navigate IMMEDIATELY (no toast-then-wait, Pitfall 9).
      navigateToLogout();
    } catch (err) {
      const outcome = classifyDeleteError(err);
      if (outcome === 'blocked') {
        // The blocked-groups list is NESTED at err.details.details.groups —
        // read it through the typed envelope-details seam.
        const details =
          err instanceof ApiError
            ? getEnvelopeDetails<DeleteAccountBlockedDetails>(err)
            : undefined;
        const groups = details?.groups;
        if (groups && groups.length > 0) {
          setBlockedGroups(groups);
          // WR-02: a blocked-at-recheck 409 arrives AFTER the user's Google
          // Calendar integration was already revoked — surface the reconnect
          // note in the blocked state. Fixed contract key: google_access_revoked.
          setGoogleAccessRevoked(details?.google_access_revoked === true);
        } else {
          // Missing/empty groups would leave isBlocked false and render NOTHING
          // — a silent dead-end on the most destructive action (WR-05). Surface
          // a generic blocked message instead.
          setFailureMessage(BLOCKED_NO_DETAILS_MESSAGE);
        }
        setDeleting(false);
        return;
      }
      if (outcome === 'ambiguous') {
        // Deletion may have committed server-side (or the account is already
        // gone) — never leave a live session on a possibly-deleted account.
        navigateToLogout();
        return;
      }
      // Definitive failure — the transaction rolled back; keep the session so
      // the SPEC-designed retry stays possible. Phase 88.8: the never-provisioned
      // 404 shares this lane (nothing was deleted, nothing was lost, the session
      // survives) but NOT its copy — "try again" can never succeed for it, so it
      // gets the reload instruction instead.
      setFailureMessage(
        err instanceof ApiError && err.code === 'not_provisioned'
          ? NOT_PROVISIONED_MESSAGE
          : DEFINITIVE_FAILURE_MESSAGE
      );
      setDeleting(false);
    } finally {
      clearTimeout(bound);
    }
  }, [confirmText]);

  const confirmDisabled =
    preflightPending || deleting || confirmText !== CONFIRM_PHRASE;

  /* DECISION Phase 88.6-30 (D52 piece (ii), owner ruling 2026-09-13; split by D24): an
     explicit focus move on BOTH `deleting` edges, mirroring the shipped house remedy at
     `ConfirmDialog.tsx:166-173` (a `prev`-style ref plus an effect on the edge) rather
     than inventing a second idiom.

     WHY IT IS NEEDED: while `deleting`, the confirm `Input` is disabled and the danger
     action is disabled, so the browser drops focus to `<body>` and Radix does NOT recover
     it — a disable-induced `focusout` carries a null `relatedTarget` and
     `@radix-ui/react-focus-scope` returns early on null, while the Content div is
     `tabIndex: -1`. The drop is PRE-EXISTING (`:391`'s native `disabled` is shipped code,
     pinned byte-unchanged); this is the house fix for it.

     THE RESTORE IS SPLIT BY OUTCOME, NOT UNCONDITIONAL (D24). An unconditional restore to
     the confirm input is a silent no-op on the blocked-with-groups outcome:
     `setBlockedGroups(groups)` and `setDeleting(false)` are one post-await continuation
     and React 18 auto-batches them into ONE commit, so `isBlocked` is already true when
     `deleting` goes false — the ternary has swapped and the confirm `Input` is unmounted.
     A freshly-rendered blocked list would arrive unfocused and unannounced. Keying on the
     mount condition is the house idiom, not a new one: `ConfirmDialog.tsx:166-173` already
     keys on `[pending, open, typedInputRendered]`.

     REJECTED for the blocked arm: minting a heading (task 3 pins `:259` as this file's
     ONLY heading), and "or the first focusable element" — that is the group link, which
     navigates the user OUT of the dialog mid-flow. CONSEQUENCE, not taste. The null
     fallback is stated POSITIVELY as the Cancel action, which sits in `<Modal.Footer>`
     outside the ternary, is mounted on both arms, and is already required by AC-21 to
     stay focusable. */
  const prevDeletingRef = React.useRef(deleting);
  React.useEffect(() => {
    const wasDeleting = prevDeletingRef.current;
    prevDeletingRef.current = deleting;
    if (!wasDeleting && deleting) {
      (progressFocusRef.current ?? cancelActionRef.current)?.focus();
      return;
    }
    if (wasDeleting && !deleting && open) {
      const target = isBlocked ? blockedLeadRef.current : confirmInputRef.current;
      (target ?? cancelActionRef.current)?.focus();
    }
  }, [deleting, open, isBlocked]);

  return (
    <section className="card p-3 md:p-6 border border-status-error">
      <h2 className="text-lg font-bold text-content-status-error mb-2">Danger Zone</h2>
      <p className="text-sm text-content-secondary mb-4">
        Permanently delete your account and all associated data. This action
        cannot be undone.
      </p>
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-danger px-4 py-2 text-sm"
      >
        Delete My Account
      </button>

      <Modal open={open} onClose={handleClose} dismissable={false}>
        <Modal.Header>Delete your account</Modal.Header>
        <Modal.Body>
          {/* DECISION Phase 88.6-30 (D52 piece (i), owner ruling 2026-09-13; visibility
              ruled 2026-09-14): an ALWAYS-MOUNTED polite region carrying IN-FLIGHT
              PROGRESS ONLY, as a direct child of `Modal.Body` and OUTSIDE the `isBlocked`
              ternary, so it survives the ternary swapping arms mid-flow.

              It is mounted EMPTY on the initial render because a region created by the
              event it announces announces nothing (`StatusRegion.tsx:9-12`). It is VISIBLE
              when set and `sr-only` is the RECORDED REJECTED ARM — this is the only
              feedback a SIGHTED phone user gets during an irreversible account deletion.
              There is no delta while idle: an empty `StatusRegion` renders nothing visible
              (`StatusRegion.tsx:43`), and `Modal.Body` is not a `space-y-*` stack, so the
              empty wrapper takes no margin.

              IT IS NOT A SECOND FAILURE REGION and must never carry an outcome — the
              failure keeps its own single region inside the non-blocked arm below
              (`88.6-UI-SPEC.md:555-557`, "exactly one live region per failure … Do not add
              a second region"; recorded as §14 row A-31). It is ALSO the focus carrier for
              the `deleting` false->true edge, which is why the wrapper is `tabIndex={-1}`
              and holds the ref. */}
          <div
            ref={progressFocusRef}
            tabIndex={-1}
            className={deleting ? 'mb-4 focus:outline-hidden' : 'focus:outline-hidden'}
          >
            <StatusRegion politeness="polite" className="text-content-secondary">
              {deleting ? DELETING_LABEL : null}
            </StatusRegion>
          </div>
          {isBlocked ? (
            <div className="space-y-4">
              <p
                ref={blockedLeadRef}
                tabIndex={-1}
                className="text-sm font-medium text-content-primary"
              >
                You still own {blockedGroups!.length === 1 ? 'a group' : 'groups'}{' '}
                with other members. Before you can delete your account, transfer
                ownership or remove the members of each group below.
              </p>
              <ul className="space-y-2">
                {blockedGroups!.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between gap-3 rounded-btn border border-line p-3"
                  >
                    <a
                      href={`/groupHomePage?id=${encodeURIComponent(group.id)}`}
                      className="font-semibold text-content-link hover:underline"
                    >
                      {group.name}
                    </a>
                    <span className="text-xs text-content-secondary">
                      {group.memberCount}{' '}
                      {group.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-content-secondary">
                On each group&rsquo;s page, open Manage Members to transfer
                ownership to another member or remove members, then return here
                to delete your account.
              </p>
              {googleAccessRevoked && (
                <p className="text-sm text-content-secondary">
                  Note: your Google Calendar connection was reset during this
                  attempt &mdash; reconnect it from your profile settings.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-medium text-content-primary">
                This permanently deletes your account. It cannot be undone.
              </p>
              <div className="space-y-2 text-sm text-content-secondary">
                <p>The following are permanently destroyed:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Your groups and group memberships</li>
                  <li>Your RSVPs and event participation history</li>
                  <li>Your game library</li>
                  <li>Your game reviews</li>
                  <li>Your friendships</li>
                  <li>Your login identity</li>
                </ul>
                <p>
                  Past event records are kept but anonymized — your name is
                  removed from them.
                </p>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="delete-account-confirm"
                  className="block text-sm font-medium text-content-secondary"
                >
                  To confirm, type{' '}
                  <span className="font-bold text-content-primary">
                    {CONFIRM_PHRASE}
                  </span>{' '}
                  below:
                </label>
                {/* DECISION Phase 88-21 (Req 1 + the phase's token/focus contracts): this is the
                    Tier-1 destructive-confirm reference implementation, and it was the last raw
                    palette left on a form control — it carried a raw Tailwind red border shade
                    and a raw red focus-ring shade, neither of which is a token, plus a
                    non-keyboard-scoped focus variant that fired on programmatic and pointer
                    focus too. (Those class names are described here rather than written out, so
                    that 88-29's raw-palette and focus-variant gates cannot match this comment
                    and report a violation that no longer exists — the idiom 88-19 established.)

                    The red BORDER is kept, re-authored onto `border-status-error`: it is not
                    decoration, it is the only persistent signal that this field belongs to a
                    destructive gate, and dropping it to "just adopt the primitive cleanly" would
                    make the delete-my-account box look identical to the group-name box. The RING
                    is NOT re-authored to a red token — it goes to the primitive's
                    `focus-visible:ring-focus-ring`, because focus indication is a system-wide
                    affordance and a per-surface focus colour is exactly the drift this phase's
                    §7.2 contract exists to stop. Behaviour is unchanged either way. */}
                <Input
                  ref={confirmInputRef}
                  id="delete-account-confirm"
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={preflightPending || deleting}
                  placeholder={CONFIRM_PHRASE}
                  autoComplete="off"
                  className="border-status-error disabled:opacity-50"
                />
              </div>
              {/* DECISION Phase 88.6-30 (D28, round-3 verdict): the failure region is an
                  ALWAYS-MOUNTED assertive `StatusRegion`, converted IN PLACE.

                  REJECTED (1): the conditional mount it replaces —
                  `{failureMessage && <p role="alert" …>}`. That is the exact defect
                  `StatusRegion.tsx:9-12` names: "Screen readers announce *changes* to a
                  live region, not the conditional mount of a new one." A definitive
                  failure on the most consequential flow in the app was announced to
                  nobody. The shipped remedy is verbatim at
                  `NextGameNightCard.tsx:452-464` ("EMPTY-FIRST, ALWAYS MOUNTED … Wrapping
                  this in `{error && …}` would make the failure silent for exactly the
                  users who need it most. Do not add `empty:hidden` either").

                  REJECTED (2): hoisting it out of the ternary to `Modal.Body` beside the
                  polite progress region. That would stand an assertive region next to a
                  polite one, which is the arrangement §14 row A-31 exists to prevent, and
                  keeping the child index is also what lets React reuse the node — which is
                  what makes node identity assertable.

                  Converting IN PLACE adds NO region: this is still the ONE failure region
                  `88.6-UI-SPEC.md:555-557` requires, now empty-first so it actually
                  announces. The className is COLOUR-ONLY: `text-sm` is the primitive's own
                  default (`StatusRegion.tsx:43`) and `font-medium` DELETES per
                  `88.6-UI-SPEC.md:375`'s emphasis outcome (400 + colour), byte-identical
                  to the ratified precedent at `NextGameNightCard.tsx:460-464`. The
                  standing empty region's `space-y-4` top margin is ACCEPTED, not hidden —
                  the phase accepted that cost once already (`88.6-29-PLAN.md:240`, "Do not
                  hide it when empty either"). */}
              <StatusRegion
                politeness="assertive"
                className="text-content-status-error"
              >
                {failureMessage}
              </StatusRegion>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          {/* DECISION Phase 88.6-30 (AC-21, mechanism amended by D52 — owner rulings
              2026-09-09 and 2026-09-13): Cancel is `aria-disabled` while `deleting`, with
              a first-line guard in its OWN handler AND a `deleting` early return in
              `handleClose`.

              CHOSEN OVER the native `disabled` attribute — which is what AC-21 literally
              said on 2026-09-09, and which `DECISION Phase 88.5`
              (`NextGameNightCard.tsx:379-391`) would even have PERMITTED here, since that
              split reserves `aria-disabled` for the PRESSED control and Cancel is "the
              button nobody is standing on". It was rejected on 2026-09-13 for a reason
              88.5 did not have to weigh: the danger action at `:391` is already natively
              disabled while `deleting` and `Modal.tsx:151` passes `hideCloseButton`, so
              native `disabled` on Cancel would leave this dialog with ZERO tab-reachable
              controls during an IRREVERSIBLE account deletion, with no control to Tab back
              to — Radix does not recover a disable-induced `focusout`, whose
              `relatedTarget` is null. `ConfirmDialog.tsx:160-173` records the identical
              focus drop for the same dialog class and ships the focus-restore effect this
              file now mirrors.

              ALSO REJECTED (gated, not free): moving the danger action at `:391` to
              `aria-disabled` too, per the strict 88.5 split. `globals.css:1310-1314`
              records that accent and danger have NO gated arm and that a future gated
              `.btn-danger` must mint its token pair there; that is an owner-level token
              decision and was not taken. `:391` is byte-unchanged.
              ALSO REJECTED: a deferred-register line, and accepting it forever —
              dismissing the modal mid-DELETE runs `resetState()` and leaves the user with
              no indication of the request's outcome.

              `aria-disabled` is ADVISORY, so the HANDLER guard is what enforces the rule;
              the attribute only communicates it. Same division of labour 88.5 states ("The
              re-tap it needs to block is blocked in the HANDLER instead"). `|| undefined`
              keeps the attribute ABSENT rather than `"false"` when not deleting, matching
              `NextGameNightCard.tsx:390`'s shipped shape. No primitive change is needed:
              `ModalActionProps` extends the native button props (`Modal.tsx:330-334`), so
              `aria-disabled` passes through exactly as `disabled` would, and
              `.btn-secondary[aria-disabled='true']` (`globals.css:2052-2056`) already
              supplies the gated look with all three tokens declared.

              The `handleClose` guard exists because `dismissable={false}` does NOT disable
              Escape — `Modal.tsx:133-135` leaves Radix's `onEscapeKeyDown` enabled on
              purpose. Swapping this back to `disabled` is a decision, not a cleanup. */}
          <Modal.Action
            ref={cancelActionRef}
            variant="secondary"
            aria-disabled={deleting || undefined}
            onClick={() => {
              if (deleting) return;
              handleClose();
            }}
          >
            Cancel
          </Modal.Action>
          {!isBlocked && (
            <Modal.Action
              variant="danger"
              onClick={handleDelete}
              disabled={confirmDisabled}
            >
              {deleting ? 'Deleting…' : 'Delete my account'}
            </Modal.Action>
          )}
        </Modal.Footer>
      </Modal>
    </section>
  );
}
