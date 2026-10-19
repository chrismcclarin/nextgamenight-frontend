'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ApiError, rsvpPublicAPI } from '@/lib/api';
import { logger, errCtx } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Heading';
import { StatusRegion } from '@/components/ui/StatusRegion';

/**
 * Page states for the RSVP magic link flow
 */
const PAGE_STATES = {
  LOADING: 'loading',
  SUCCESS: 'success',
  EVENT_PASSED: 'event_passed',
  // Plan 88.6-58 task 7 (review MEDLOW-16): the two 403 discriminants get their own states.
  EXPIRED_LINK: 'expired_link',
  ACCOUNT_NOT_FOUND: 'account_not_found',
  ERROR: 'error',
  // Plan 88.6.1-36 (D-25): entered when respondViaToken rejects an ApiError with code `network`.
  UNCONFIRMED_NETWORK: 'unconfirmed_network',
  // Plan 88.6.1-36 (D-25, owner R9 ruling 2026-10-05): entered on an ApiError with code `internal`.
  UNCONFIRMED_INTERNAL: 'unconfirmed_internal',
  // Plan 88.6.1-87 (close ruling P-77): the backend's own 404, carrying its token, after the
  // link was used. Entered on an ApiError with code `not_found`.
  EVENT_GONE: 'event_gone',
};

/**
 * The live region's test handle. A bare `getByRole('status')` is fine on this page today —
 * it carries exactly one — but addressing it by handle keeps the node-identity assertions in
 * `page.test.tsx` pinned to THIS region if a branch ever grows one of its own.
 *
 * NOT EXPORTED, deliberately, and the sibling `availability-form/[token]/page.js` (anchor
 * `const PAGE_STATUS_TESTID = 'availability-page-status'`) does the same: Next's generated route types constrain a page module's named exports to the App Router's
 * own vocabulary, so `export const PAGE_STATUS_TESTID` fails `npm run typecheck` with
 * "not assignable to type 'never'". The test re-declares the literal.
 */
const PAGE_STATUS_TESTID = 'rsvp-page-status';

/**
 * The EVENT_PASSED and ERROR branch copy, hoisted so each string is rendered by its `<h1>`
 * AND composed into the live announcement from ONE source and the two cannot drift. P1: every
 * string below is one this page already shipped; composing them authors no copy. SUCCESS needs
 * no hoist — its heading and message already come from `STATUS_CONFIG`.
 */
const EVENT_PASSED_HEADLINE = 'This event has already happened';
const EVENT_PASSED_DETAIL_GENERIC = 'This event has already taken place or has been cancelled.';
const ERROR_HEADLINE = 'Something went wrong';
const ERROR_DETAIL =
  'This link may be invalid or expired. Please try clicking the RSVP link from your email again.';

/* Plan 88.6.1-36 (D-25). The two details for a request that did not complete or an answer the
   page could not use; the headline for both stays `ERROR_HEADLINE`. R3 is copy row R3 (D-32,
   ratified 2026-10-04); R9 is the owner's line ratified 2026-10-05 (R3 minus the cause; recorded
   in CONTEXT as D-47). Each is ONE whole literal so a copy scan finds it byte-for-byte; R9 is not
   built from pieces of R3. `ERROR_DETAIL` above stays the detail for every OTHER error path: no
   token, a missing query value, a resolved body with no recognised discriminant, and a rejection
   that is not an `ApiError` with one of these two codes. */
const UNCONFIRMED_NETWORK_DETAIL =
  "We couldn't confirm your RSVP — the connection timed out. Sign in and open the event to check your answer.";
const UNCONFIRMED_INTERNAL_DETAIL =
  "We couldn't confirm your RSVP. Sign in and open the event to check your answer.";
const UNCONFIRMED_DETAIL_BY_STATE = {
  [PAGE_STATES.UNCONFIRMED_NETWORK]: UNCONFIRMED_NETWORK_DETAIL,
  [PAGE_STATES.UNCONFIRMED_INTERNAL]: UNCONFIRMED_INTERNAL_DETAIL,
};

/* Plan 88.6-58 task 7 (review MEDLOW-16; `ITEM-16-COPY-RULING: ratified`, owner 2026-09-29,
   UI-SPEC §6.3). Before this, a second tap on a used link — or a link for an account the backend
   cannot find — fell through to ERROR above and told the user to tap the link AGAIN, which fails
   again. The backend already discriminates both (`Sonnet/routes/rsvp.js` 403 `expired_link` /
   `account_not_found`); these are the page's own strings for them. The backend's `message` on
   those bodies is deliberately NOT rendered (fetchErrorTreatment R1: upstream prose is never the
   display string). Same hoist idiom as above: each string ONCE, rendered by the `<h1>` AND the
   live announcement. */
const EXPIRED_LINK_HEADLINE = 'This link has already been used';
const EXPIRED_LINK_DETAIL = 'Each RSVP link works once. Sign in and open the event to change your answer.';
const ACCOUNT_NOT_FOUND_HEADLINE = "We couldn't find your account";
const ACCOUNT_NOT_FOUND_DETAIL = 'Sign in and open the event to RSVP.';
/* DECISION Phase 88.6.1-87 (close ruling P-77, owner 2026-10-18): CHOSEN — owner-ruled
   2026-10-18 ("amber"), shown at 375px (88.6.1-65-RULINGS-INFLIGHT.md, section
   "Planner flag (a), P-77 look"): the ratified pair as a LINK_STATE_COPY entry (the amber card
   the cancelled 410 also draws; no new markup, the shipped "Go to Home"). This amends in place
   DECISION 88.6.1-36 REJECTED (a) (in the catch below, anchor "REJECTED (a): adding the states
   to"), which had called the amber clock glyph a Phase 88.9 look change, for this one state
   only. Keyed on the not_found code, which respondViaToken gives only to a 404 carrying the
   backend token event_not_found (owner ruling D4). The generic "ask the organizer" because no
   organizer name reaches this page. The same answer also covers an event soft-deleted with its
   group and restorable for 30 days: owner-accepted 2026-10-18 ("a"), the words and their hedge
   stand, the BE improvement routed to Phase 93 (.planning/deferred/phase-93.md, entry
   "GET /rsvp/respond: the 404 for a missing event").
   REJECTED (a): the ERROR branch with the new words (a red error card for a cancelled game
   night, beside an amber card for the cancelled 410).
   REJECTED (b): a name in the sentence (the 404 body has none and the page holds only the
   link's ids).
   REJECTED (c): keying on the body text (backend prose). */
const EVENT_GONE_HEADLINE = 'This game night was cancelled';
const EVENT_GONE_DETAIL = "The event this link was for no longer exists, so there is nothing to answer. If you think that's a mistake, ask the organizer.";
const LINK_STATE_COPY = {
  [PAGE_STATES.EXPIRED_LINK]: { headline: EXPIRED_LINK_HEADLINE, detail: EXPIRED_LINK_DETAIL },
  [PAGE_STATES.ACCOUNT_NOT_FOUND]: {
    headline: ACCOUNT_NOT_FOUND_HEADLINE,
    detail: ACCOUNT_NOT_FOUND_DETAIL,
  },
  [PAGE_STATES.EVENT_GONE]: { headline: EVENT_GONE_HEADLINE, detail: EVENT_GONE_DETAIL },
};

/**
 * Status display config: message templates, colors, and icons
 */
const STATUS_CONFIG = {
  yes: {
    heading: "You're in!",
    messageTemplate: (name, date) => `See you at ${name} on ${date}.`,
    accent: 'bg-status-success-subtle text-content-status-success',
    border: 'border-status-success',
    iconBg: 'bg-status-success-subtle',
    iconColor: 'text-content-status-success',
  },
  maybe: {
    heading: 'Got it!',
    messageTemplate: (name, date) => `You're a maybe for ${name} on ${date}.`,
    accent: 'bg-status-warning-subtle text-content-status-warning',
    border: 'border-status-warning',
    iconBg: 'bg-status-warning-subtle',
    iconColor: 'text-content-status-warning',
  },
  no: {
    heading: 'Got it!',
    messageTemplate: (name, date) => `We'll miss you at ${name} on ${date}.`,
    accent: 'bg-surface-elevated text-content-secondary',
    border: 'border-line',
    iconBg: 'bg-surface-elevated',
    iconColor: 'text-content-muted',
  },
};

/**
 * RsvpPage - Public landing page for magic link RSVP responses
 *
 * Flow:
 * 1. Extracts token from path, e/u/s from query params
 * 2. Calls public RSVP endpoint on mount
 * 3. Shows confirmation (success), event-passed, or error state
 *
 * This page does NOT require Auth0 authentication.
 */
export default function RsvpPage() {
  const { token } = useParams();
  const searchParams = useSearchParams();

  const [pageState, setPageState] = useState(PAGE_STATES.LOADING);
  const [responseData, setResponseData] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null);

  /* AC-13 (owner ruling 2026-09-09, option 1): the per-effect-run cancellation flag, copied
     from the shipped idiom at `invite/game/[token]/page.js` (its `let cancelled = false`
     before the async body, an early return ahead of every post-resolve state write, and a
     cleanup that sets it true). Before this, every write below fired unconditionally after
     the await resolved, so an unmount mid-flight produced a late setState on a dead component.

     WHAT IT DOES NOT DO, stated so nobody "completes" it later: this effect fires a MUTATION
     (`respondViaToken` below), so the guard prevents the late setState and NOT the request.
     The RSVP is still recorded — which is correct; the user clicked an RSVP link. No
     `AbortController`, and the FIRST request is unconditional; the latch refuses only a
     duplicate (StrictMode / re-run); the RSVP is still recorded.

     NOT THE SAME THING as the two `cancelled` STRINGS in this file: the `event_cancelled`
     discriminant below and the user-facing "or has been cancelled" copy are domain values and
     are untouched by the guard.

     [AMENDED Phase 88.6.1-36 (#40): the per-run flag described above is GONE. CHOSEN — a
     single-shot submit latch (`submittedRef`) plus an unmount-scoped write guard
     (`unmountedRef`), the shape `invite/group/[token]/page.js` ships under its
     `DECISION Phase 88.6-23 (AC-13)` marker. WHY — the token is single-use (the backend
     consumes it, `Sonnet/routes/rsvp.js` anchor `SingleUseToken.consumeByNonce(token)`, before the
     work that records the RSVP), and StrictMode (on by default for the App Router;
     `next.config.js` sets no `reactStrictMode`) ran this effect twice in development: run 1's
     answer was dropped by its own cleanup, run 2 landed on the spent token, and the page showed
     the used-link state for an RSVP that WAS recorded. REJECTED (1) the per-run flag (what
     shipped). REJECTED (2) a latch BESIDE the per-run flag: run 1's cleanup marks its own
     answer cancelled and the latch stops run 2 from sending, so the page stays on "Recording
     your RSVP..." for good. PREMISE: the token cannot change within one mount — nothing in the
     app links to this route (verified 2026-10-11 and again 2026-10-16: outside tests, `/rsvp/`
     appears in `src` only as the respond / event API calls, a feedback-URL scrub list and a
     schema comment) — so the latch never refuses a different token. Re-adding a per-run flag,
     or clearing the latch, is a decision, not a cleanup.] */
  const submittedRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    // Reset on mount: StrictMode runs the cleanup and then this body again, and without the
    // reset the first request's answer would land on a page that reads as unmounted.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const submitRsvp = async () => {
      if (!token) {
        setPageState(PAGE_STATES.ERROR);
        return;
      }

      const eventId = searchParams.get('e');
      const userId = searchParams.get('u');
      const status = searchParams.get('s');

      if (!eventId || !userId || !status) {
        setPageState(PAGE_STATES.ERROR);
        return;
      }

      // #40: one request per page instance (see the AC-13 marker above the refs).
      if (submittedRef.current) return;
      submittedRef.current = true;

      try {
        const result = await rsvpPublicAPI.respondViaToken(token, eventId, userId, status);
        if (unmountedRef.current) return;

        /* DECISION Phase 88.6-24 (D62, owner ruling 2026-09-09): the two `result.error === …`
           branches below are DOMAIN DISCRIMINANTS off a body that carries no `code`, and they
           STAY that way in this phase — chosen OVER the cross-repo conversion (branch A: add a
           registry `code` to the backend branches and read `body.code ?? body.error` here), which
           the owner rejected on blast radius: a backend commit inside a frontend phase is a
           Railway PRODUCTION deploy.

           THE CONSTRAINT, so a later sweep cannot mistake this for an oversight.
           `periodictabletopbackend_v2/Sonnet/routes/rsvp.js` emits HTTP 410 with
           `{ error: 'event_cancelled', group_id }` (anchor `error: 'event_cancelled',`) or
           `{ error: 'event_passed', event_name, group_id }` (anchor `error: 'event_passed',`) —
           verified 2026-09-16; anchors over line cites since 2026-10-19 (88.6.1 code review A-70) —
           with NO `code` and NO `message`. A mechanical "read `body.code` instead" edit makes
           BOTH branches below unreachable and drops this page to its generic
           `PAGE_STATES.ERROR`: a silent, user-visible regression on the magic-link RSVP flow,
           one of this app's two primary entry points.

           WHO UNBLOCKS IT: Phase 93 adds the backend `code` FIRST (its own `[cleanup] Retighten`
           entry in `.planning/deferred/phase-93.md` carries this as a blocking precondition), and
           only then may this read move. Deploy order under that change is BACKEND FIRST — the
           `formatEnvelope` `error` alias keeps an un-deployed frontend working against a
           converted backend, and the reverse is not true.

           GATED, not just written down: `src/app/errorEnvelopeReads.test.ts` rosters this file
           with an exact site count in BOTH directions, so deleting these reads reds as loudly as
           adding an unrostered one, and `page.test.tsx` pins all four page states — including the
           code-only body, which asserts `ERROR` deliberately.

           [AMENDED 2026-09-29 — plan 88.6-58 task 7, review MEDLOW-16: the discriminant set is
           FOUR bodies, not two. The two 410s above carry no `code` and no `message`; the two 403s
           below (`rsvp.js` `account_not_found` :235-238, `expired_link` :260-263) carry a
           `message` that the FE deliberately does NOT render (R1). The roster count is now 4
           sites; Phase 93's retighten precondition lists all four literals.] */
        if (result.success) {
          setResponseData(result);
          setPageState(PAGE_STATES.SUCCESS);
        } else if (result.error === 'event_passed') {
          setErrorInfo({
            event_name: result.event_name,
            group_id: result.group_id,
          });
          setPageState(PAGE_STATES.EVENT_PASSED);
        } else if (result.error === 'event_cancelled') {
          setErrorInfo({ group_id: result.group_id });
          setPageState(PAGE_STATES.EVENT_PASSED);
        } else if (result.error === 'expired_link') {
          setPageState(PAGE_STATES.EXPIRED_LINK);
        } else if (result.error === 'account_not_found') {
          setPageState(PAGE_STATES.ACCOUNT_NOT_FOUND);
        } else {
          setPageState(PAGE_STATES.ERROR);
        }
      } catch (err) {
        if (unmountedRef.current) return;
        /* AC-2 WIDENED (owner ruling 2026-09-09), level AMENDED 2026-09-13: the file's one raw
           `console.error` retired onto the house logger at `logger.info` — a Sentry BREADCRUMB
           (`logger.ts:52-53`, anchor `Sentry.addBreadcrumb`), NOT an event. `logger.error` is `Sentry.captureException` and was
           the level first ruled on 2026-09-09; it is the RECORDED REJECTED ARM, because a
           captured event flushes the Session Replay buffer for the rest of that session
           (`sentry.client.config.js` `replaysOnErrorSampleRate` against `replaysSessionSampleRate`),
           bought for a gate about raw `console.*`. `logger.warn` is `Sentry.captureMessage` — also
           an event, so not a cheaper arm.

           T-84-01 / T-88.6-166: `errCtx` forwards the caught error's NAME AND MESSAGE only. The
           magic-link token, the request URL and the 410 body are forbidden in BOTH arguments —
           this is a token-bearing route and a breadcrumb egresses exactly as an exception value
           does. `errCtx` is used rather than a hand-written `{ name, message }` literal: the
           literal spells `message:` on the call line and reds `fetchErrorTreatment`'s R1 gate,
           which this conversion never touches.

           DISCLOSED RESIDUAL, not a fix: a breadcrumb reaches Sentry only if some other event is
           filed in the same session, and this page is a one-shot emailed link with no dashboard
           to retry from — so a silent submit failure stays invisible to the operator after this
           change exactly as it was before it. What changed is the CHANNEL and the lint gate. */
        logger.info('RSVP submission error:', errCtx(err));
        /* DECISION Phase 88.6.1-36 (D-25 / R3 / R9): CHOSEN — a rejected request whose
           `ApiError` code is `network` (a transport failure or the 20 s deadline) enters
           UNCONFIRMED_NETWORK (copy row R3), and one whose code is `internal` (a server error of
           500 or above, which `respondViaToken` rejects before the parse since plan 88.6.1-23,
           or an answer under 500 that could not be read) enters UNCONFIRMED_INTERNAL (R9, the
           owner's ruling of 2026-10-05). In all of these the request may have reached the app,
           which consumes the single-use token before the work that can fail
           (`Sonnet/routes/rsvp.js`, anchor `consumeByNonce(token)`), so the RSVP may be recorded and tapping the link again
           would land on the used-link state; R9 is true whether or not the token was spent.
           Keyed on `instanceof` plus `code`, never on the message, which plan 88.6.1-23 changes
           for a timeout.
           TWO PAGE STATES, chosen over one state plus a stored cause: every screen on this page
           is chosen by `pageState` alone, and the file already maps two page states to their
           own copy inside one branch (`LINK_STATE_COPY`).
           REJECTED (a): adding the states to `LINK_STATE_COPY` — that branch draws the amber
           clock glyph, a look change that belongs to Phase 88.9; the ERROR branch already has
           the right glyph, headline and link, so only the detail changes. AMENDED Phase
           88.6.1-87 — owner-ruled 2026-10-18 ("amber"), shown at 375px: the deleted-event state
           (EVENT_GONE) draws the LINK_STATE_COPY branch; UNCONFIRMED_NETWORK and
           UNCONFIRMED_INTERNAL stay on the ERROR branch, where this rejection still holds.
           REJECTED (b): ONE unconfirmed state plus a second state value (or an `errorInfo`
           field) holding the cause — two writes per failure that must agree, and the detail
           would no longer follow from `pageState`.
           REJECTED (c): R3 for `internal` — R3 names a timeout, and an `internal` rejection
           means an answer arrived.
           REJECTED (d): keeping `ERROR_DETAIL` for `internal` — this plan's FIRST ruling,
           superseded by the owner on 2026-10-05: an unreadable answer or a server error can
           come after the app consumed the token, so that constant's retap advice can send the
           person to a spent link.
           REJECTED (e): a longer per-helper deadline — it narrows the window and never closes
           it, and `lib/api.ts` is plan 88.6.1-23's.
           MERITS VS RECORD, stated: for an instant offline failure "timed out" is imprecise; the
           owner ratified R3 for the network-failure use (D-32 R3), the remedy it gives is right
           either way, and telling a timeout apart reliably would need the message text
           (rejected above).
           WHAT STILL SHOWS `ERROR_DETAIL`, stated so nobody strands or widens it by accident:
           the two pre-request arms (no token; a missing query value), any rejection that is not
           an `ApiError` with one of the two codes, and any RESOLVED body with no recognised
           discriminant. Only a status under 500 can resolve (`DECISION Phase 88.6.1-23 (R9
           mechanism)` in `lib/api.ts`), so the backend's own server error reaches R9, not that
           copy. What still resolves there: the backend's refusals before the token is used (the
           two 400s and the signature-mismatch 403), where that copy is true. The post-consume
           404 no longer resolves there once it carries the backend token. AMENDED Phase
           88.6.1-87 (close ruling P-77, owner 2026-10-18; key per owner ruling D4) — a 404 whose
           body carries `event_not_found` rejects `not_found` and enters EVENT_GONE with the
           owner's words; a 404 without that token (the backend before its deploy, Railway's
           edge fallback) still resolves and stays on this copy; neither is routed to R9, which
           tells the person to open an event that no longer exists. */
        if (err instanceof ApiError && err.code === 'not_found') {
          setPageState(PAGE_STATES.EVENT_GONE);
        } else if (err instanceof ApiError && err.code === 'network') {
          setPageState(PAGE_STATES.UNCONFIRMED_NETWORK);
        } else if (err instanceof ApiError && err.code === 'internal') {
          setPageState(PAGE_STATES.UNCONFIRMED_INTERNAL);
        } else {
          setPageState(PAGE_STATES.ERROR);
        }
      }
    };

    submitRsvp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* The SUCCESS branch's display config, hoisted above the branch dispatch so the live
     announcement below can compose the heading and message this page already renders. The
     `|| STATUS_CONFIG.yes` fallback is the shipped one, moved verbatim — `borderExplicitness`
     relies on it for the card's `border-t-4` colour. */
  const successConfig = responseData
    ? STATUS_CONFIG[responseData.status] || STATUS_CONFIG.yes
    : null;
  const showSuccess = pageState === PAGE_STATES.SUCCESS && Boolean(responseData);

  /* The EVENT_PASSED detail sentence — ONE expression, rendered by the branch AND composed into
     the announcement, so the two cannot drift. */
  const eventPassedDetail = errorInfo?.event_name
    ? `${errorInfo.event_name} has already taken place.`
    : EVENT_PASSED_DETAIL_GENERIC;

  /* r2 #181 / AC-19, EXTENDED to this page by the owner ruling of 2026-09-14. This page is four
     mutually-exclusive early returns driven by one `pageState` that the mount effect flips; the
     WHOLE page is replaced on that flip and, before this, nothing announced it — the file carried
     zero `aria-` attributes. A screen-reader user on a one-shot emailed link got silence exactly
     where the entire outcome lives.

     The arms below MIRROR the body dispatch's order exactly (LOADING, then SUCCESS-with-data,
     then EVENT_PASSED, then the fallthrough), so the announcement cannot describe a branch other
     than the one on screen. LOADING yields the empty string: the region must be mounted-and-empty
     first or there is no CHANGE for a screen reader to announce.

     P1 — NO new user-facing string is authored. Every fragment below is one this page already
     renders. MERITS-VS-RECORD, stated rather than buried: the plan's wording is "reuses the copy
     that branch's own `<h1>` already renders", which would announce "You're in!" alone. On the
     merits the heading alone is not the outcome — "See you at Trivia Night on March 3." is the
     substance, and the sibling plan 88.6-23 composed headline PLUS detail for exactly that reason
     and recorded that the detail alone "only echoes the user's own input back". The h1-only
     phrasing is BOOKKEEPING (nothing breaks if it is not honoured; P1 is satisfied either way), so
     this page composes both halves. Reverting to heading-only is a decision, not a cleanup. */
  // Plan 88.6.1-36 (D-25): the ERROR branch's detail — R3 or R9 for the two UNCONFIRMED states,
  // `ERROR_DETAIL` otherwise. ONE value read by the branch's `<p>` AND the announcement.
  const errorDetail = UNCONFIRMED_DETAIL_BY_STATE[pageState] ?? ERROR_DETAIL;
  const announcement =
    pageState === PAGE_STATES.LOADING
      ? ''
      : showSuccess
        ? `${successConfig.heading} ${successConfig.messageTemplate(responseData.event_name, responseData.event_date)}`
        : pageState === PAGE_STATES.EVENT_PASSED
          ? `${EVENT_PASSED_HEADLINE} ${eventPassedDetail}`
          : LINK_STATE_COPY[pageState]
            ? `${LINK_STATE_COPY[pageState].headline} ${LINK_STATE_COPY[pageState].detail}`
            : `${ERROR_HEADLINE} ${errorDetail}`;

  let body;

  if (pageState === PAGE_STATES.LOADING) {
    // ---- LOADING STATE ----
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto"></div>
          <p className="mt-4 text-content-secondary">Recording your RSVP...</p>
        </div>
      </div>
    );
  } else if (showSuccess) {
    // ---- SUCCESS STATE ----
    const config = successConfig;

    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
        <div className={`max-w-md w-full bg-surface-card rounded-card shadow-theme-lg overflow-hidden border-t-4 ${config.border}`}>
          <div className="p-8 text-center">
            {/* Icon — r2 #180: all three status glyphs are decorative duplicates of the heading
                beside them and carry `aria-hidden="true" focusable="false"`, the live house idiom
                (the sibling magic-link pages this phase swept, and `Icon`'s own default). The
                meaning is on the heading and, since this plan, on the live region above. */}
            <div className={`w-16 h-16 ${config.iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
              {responseData.status === 'yes' && (
                <svg className={`w-8 h-8 ${config.iconColor}`} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {responseData.status === 'maybe' && (
                <svg className={`w-8 h-8 ${config.iconColor}`} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {responseData.status === 'no' && (
                <svg className={`w-8 h-8 ${config.iconColor}`} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>

            {/* Heading — D-04 row 1: the page TITLE at 24 goes to Display 30. The two branch h1s
                below STAY at 20 under the `ErrorFallback` precedent; the three never coexist
                (D-06), so the different sizes are deliberate. Levels preserved (P4). */}
            <Heading level={1} size="display" className="text-content-primary mb-2">
              {config.heading}
            </Heading>

            {/* Message */}
            <p className="text-content-secondary mb-6">
              {config.messageTemplate(responseData.event_name, responseData.event_date)}
            </p>

            {/* Group name — §4.3: metadata beneath a primary string, stays at 14. */}
            {responseData.group_name && (
              <p className="text-sm text-content-muted mb-6">
                {responseData.group_name}
              </p>
            )}

            {/* Divider and links */}
            <div className="border-t border-line pt-4">
              {/* §4.3: a one-line descriptor, stays at 14 — the same string plan 88.6-23 kept at
                  14 on the sibling availability-form confirmation. */}
              <p className="text-sm text-content-muted mb-2">
                You can safely close this tab.
              </p>
              {/* §4.2: helper text is a named Caption role, stays at 12 — the same shape plan
                  88.6-23 kept at 12 for "Made a mistake?…". */}
              <p className="text-xs text-content-muted">
                Changed your mind? Sign in and open the event to update your response.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (pageState === PAGE_STATES.EVENT_PASSED) {
    // ---- EVENT PASSED STATE ----
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface-card rounded-card shadow-theme-lg p-8 text-center">
          <div className="w-16 h-16 bg-status-warning-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            {/* Decorative — see the success branch. */}
            <svg className="w-8 h-8 text-content-status-warning" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <Heading level={1} size="heading" className="text-content-primary mb-2">
            {EVENT_PASSED_HEADLINE}
          </Heading>
          <p className="text-content-secondary mb-6">
            {eventPassedDetail}
          </p>
          {errorInfo?.group_id && (
            /* DECISION Phase 88.6-63 (review round 2 #10): the href is the canonical group page
               `/groupHomePage?id=<encoded group_id>` (the page reads `searchParams.get('id')`,
               groupHomePage/page.js:80; the backend builds the same URL, Sonnet/routes/events.js:1698),
               chosen OVER keeping `/groups/<id>` — no `src/app/groups/` route is tracked, so that
               link 404ed — and OVER adding a `/groups/[id]` route for one link. `encodeURIComponent`
               keeps a body value from injecting query parameters (T-88.6-G47). §3.2's `asChild`
               row: this stays an `<a>` — the element kind is not a cleanup target. `inline-block`
               is DELETED as dead: unlayered `.btn` sets `display: inline-flex` (globals.css:2195),
               so the utility never applied. `min-h-11` is not added at the site — the cva base
               supplies it at every viewport. */
            <Button asChild variant="primary" size="default">
              <a href={`/groupHomePage?id=${encodeURIComponent(errorInfo.group_id)}`}>
                Go to Group
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  } else if (LINK_STATE_COPY[pageState]) {
    // ---- EXPIRED_LINK / ACCOUNT_NOT_FOUND STATES (plan 88.6-58 task 7) ----
    // One render on the EVENT_PASSED idiom: warning glyph, heading @ 20, detail, one CTA. The 403
    // bodies carry NO `group_id`, so "Go to Group" has no target; the CTA is the shipped
    // "Go to Home" (the ERROR branch's own string) rather than a NEW label such as "Open the
    // event" — the ruling ratified the two headline/detail pairs and nothing else (P1). Minting
    // an event-link label is an owner copy decision, not a cleanup.
    const copy = LINK_STATE_COPY[pageState];
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface-card rounded-card shadow-theme-lg p-8 text-center">
          <div className="w-16 h-16 bg-status-warning-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            {/* Decorative — see the success branch. */}
            <svg className="w-8 h-8 text-content-status-warning" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <Heading level={1} size="heading" className="text-content-primary mb-2">
            {copy.headline}
          </Heading>
          <p className="text-content-secondary mb-6">
            {copy.detail}
          </p>
          <Button asChild variant="primary" size="default">
            <a href="/">
              Go to Home
            </a>
          </Button>
        </div>
      </div>
    );
  } else {
    // ---- ERROR / UNCONFIRMED STATES ----
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface-card rounded-card shadow-theme-lg p-8 text-center">
          <div className="w-16 h-16 bg-status-error-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            {/* Decorative — see the success branch. */}
            <svg className="w-8 h-8 text-content-status-error" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <Heading level={1} size="heading" className="text-content-primary mb-2">
            {ERROR_HEADLINE}
          </Heading>
          <p className="text-content-secondary mb-6">
            {errorDetail}
          </p>
          <Button asChild variant="primary" size="default">
            <a href="/">
              Go to Home
            </a>
          </Button>
        </div>
      </div>
    );
  }

  /* DECISION Phase 88.6-24 (r2 #181 / AC-19): ONE always-mounted `StatusRegion` at FRAGMENT
     SLOT 0, rendered from `RsvpPage` itself and never from inside a branch — the mechanism plan
     88.6-23 settled on the sibling availability-form page, ported rather than re-invented,
     because this page is the same shape (four early returns, one state variable, no shared
     wrapper).

     REJECTED (1) — a region inside each branch. A region mounted together with its content does
     not announce; screen readers announce CHANGES to a live region, not a conditional mount.

     REJECTED (2) — a shared wrapper `<div>` around the four branches. The four branch roots are
     NOT interchangeable (LOADING carries no `p-4`; the other three do), and a fragment adds no
     box at all. All four root className strings above are byte-unchanged from before this sweep.

     REJECTED (3) — a route `layout.js` hosting the region. It would have perfect node identity
     and would PASS an identity assertion while NEVER being filled, because a server-rendered
     shell cannot read this client page's `pageState`. A CONSEQUENCE constraint, not a preference.

     VISIBILITY: `sr-only`, taking plan 88.6-23's AC-19 treatment (owner ruling 2026-09-09) and
     deliberately NOT the visible-when-set ruling of 2026-09-14, which is scoped to the three NEW
     regions in plans 28/30/31. The deliberately-different neighbour is named so a later sweep
     does not "converge" the two: this region announces copy that is ALREADY on screen in the
     heading beside it, so rendering it visibly would duplicate that line.

     NO FOCUS MOVE, and that is deliberate. Plan 88.6-23 moved focus on its SUBMITTED edge
     because its submit control unmounted under the user; its own marker records that the ERROR
     flip takes the announcement and NOT a focus move, "the error branch has no control the user
     was operating, so moving focus there would be an unrequested jump". THIS page has no control
     the user was operating on any branch — it auto-submits on mount from an emailed link — so
     that rule excludes every branch here. Adding a focus move is a decision, not a cleanup.

     [AMENDED Phase 88.6.1-36 (W053 / IN-405): "THIS page has no control at all on any branch"
     was false — the settled branches render a link ("Go to Group", "Go to Home"). What holds is
     that no branch removes a control the user was operating, because the submit runs on mount,
     so the availability-form rule still excludes every branch, both UNCONFIRMED states
     included.] */
  return (
    <>
      <StatusRegion
        className="sr-only"
        data-testid={PAGE_STATUS_TESTID}
        message={announcement}
      />
      {body}
    </>
  );
}
