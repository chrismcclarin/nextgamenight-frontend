'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { rsvpPublicAPI } from '@/lib/api';
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
  ERROR: 'error',
};

/**
 * The live region's test handle. A bare `getByRole('status')` is fine on this page today —
 * it carries exactly one — but addressing it by handle keeps the node-identity assertions in
 * `page.test.tsx` pinned to THIS region if a branch ever grows one of its own.
 *
 * NOT EXPORTED, deliberately, and the sibling `availability-form/[token]/page.js:30` does the
 * same: Next's generated route types constrain a page module's named exports to the App Router's
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

  useEffect(() => {
    /* AC-13 (owner ruling 2026-09-09, option 1): the per-effect-run cancellation flag, copied
       from the shipped idiom at `invite/game/[token]/page.js` (its `let cancelled = false`
       before the async body, an early return ahead of every post-resolve state write, and a
       cleanup that sets it true). Before this, every write below fired unconditionally after
       the await resolved, so an unmount mid-flight produced a late setState on a dead component.

       WHAT IT DOES NOT DO, stated so nobody "completes" it later: this effect fires a MUTATION
       (`respondViaToken` below), so the guard prevents the late setState and NOT the request.
       The RSVP is still recorded — which is correct; the user clicked an RSVP link. No
       `AbortController`, and the request is never made conditional.

       NOT THE SAME THING as the two `cancelled` STRINGS in this file: the `event_cancelled`
       discriminant below and the user-facing "or has been cancelled" copy are domain values and
       are untouched by this flag. */
    let cancelled = false;

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

      try {
        const result = await rsvpPublicAPI.respondViaToken(token, eventId, userId, status);
        if (cancelled) return;

        /* DECISION Phase 88.6-24 (D62, owner ruling 2026-09-09): the two `result.error === …`
           branches below are DOMAIN DISCRIMINANTS off a body that carries no `code`, and they
           STAY that way in this phase — chosen OVER the cross-repo conversion (branch A: add a
           registry `code` to the backend branches and read `body.code ?? body.error` here), which
           the owner rejected on blast radius: a backend commit inside a frontend phase is a
           Railway PRODUCTION deploy.

           THE CONSTRAINT, so a later sweep cannot mistake this for an oversight.
           `periodictabletopbackend_v2/Sonnet/routes/rsvp.js` emits HTTP 410 with
           `{ error: 'event_cancelled', group_id }` (:293-296) or
           `{ error: 'event_passed', event_name, group_id }` (:302-306) — verified 2026-09-16 —
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
           code-only body, which asserts `ERROR` deliberately. */
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
        } else {
          setPageState(PAGE_STATES.ERROR);
        }
      } catch (err) {
        if (cancelled) return;
        /* AC-2 WIDENED (owner ruling 2026-09-09), level AMENDED 2026-09-13: the file's one raw
           `console.error` retired onto the house logger at `logger.info` — a Sentry BREADCRUMB
           (`logger.ts:34-36`), NOT an event. `logger.error` is `Sentry.captureException` and was
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
        setPageState(PAGE_STATES.ERROR);
      }
    };

    submitRsvp();
    return () => {
      cancelled = true;
    };
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
  const announcement =
    pageState === PAGE_STATES.LOADING
      ? ''
      : showSuccess
        ? `${successConfig.heading} ${successConfig.messageTemplate(responseData.event_name, responseData.event_date)}`
        : pageState === PAGE_STATES.EVENT_PASSED
          ? `${EVENT_PASSED_HEADLINE} ${eventPassedDetail}`
          : `${ERROR_HEADLINE} ${ERROR_DETAIL}`;

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
                Changed your mind? Click a different RSVP link from the email to update your response.
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
            /* §3.2's `asChild` row: this stays an `<a>` and its `href` is byte-identical — the
               element kind is not a cleanup target. `inline-block` is DELETED as dead: unlayered
               `.btn` sets `display: inline-flex` (globals.css:2195), so the utility never applied.
               `min-h-11` is not added at the site — the cva base supplies it at every viewport. */
            <Button asChild variant="primary" size="default">
              <a href={`/groups/${errorInfo.group_id}`}>
                Go to Group
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  } else {
    // ---- ERROR STATE ----
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
            {ERROR_DETAIL}
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
     at all on any branch — it auto-submits on mount from an emailed link — so that rule excludes
     every branch here. Adding a focus move is a decision, not a cleanup. */
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
