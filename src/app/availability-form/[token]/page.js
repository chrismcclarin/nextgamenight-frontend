'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import AvailabilityForm from '@/app/components/AvailabilityForm';
import { magicAuthAPI, availabilityFormAPI } from '@/lib/api';
import { Heading } from '@/components/ui/Heading';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { logger, errCtx } from '@/lib/logger';

/**
 * Page states for the availability form flow
 */
const PAGE_STATES = {
  LOADING: 'loading',
  ERROR: 'error',
  READY: 'ready',
  SUBMITTED: 'submitted',
};

/**
 * The confirmation headline, hoisted so the `<h1>` and the live announcement render from ONE
 * constant and cannot drift. P1: this is the string the page already shipped — composing the
 * announcement out of it authors no new copy.
 */
const SUBMITTED_HEADLINE = 'Availability Submitted!';

/** The `data-testid` the page-level live region is addressed by. See the AC-19 marker below. */
const PAGE_STATUS_TESTID = 'availability-page-status';

/**
 * AvailabilityFormPage - Public page for magic token-based availability submission
 *
 * Flow:
 * 1. Validates magic token on mount
 * 2. Shows form if valid, error state if invalid
 * 3. Shows confirmation after successful submission
 *
 * This page does NOT require Auth0 authentication - it uses magic tokens
 */
export default function AvailabilityFormPage() {
  const { token } = useParams();

  // Page state
  const [pageState, setPageState] = useState(PAGE_STATES.LOADING);
  const [errorMessage, setErrorMessage] = useState(null);

  // Token validation data
  const [tokenData, setTokenData] = useState(null);
  const [existingResponse, setExistingResponse] = useState(null);

  // Submission result
  const [submissionResult, setSubmissionResult] = useState(null);

  // Timezone detection (client-side only)
  const [timezone, setTimezone] = useState('UTC');

  // Detect timezone on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, []);

  // Validate token and fetch existing response on mount
  useEffect(() => {
    // AC-13 (owner ruling 2026-09-09, option 1). Idiom copied VERBATIM from the sibling
    // magic-link page `invite/game/[token]/page.js:69,74,77,100`: `let cancelled = false`, an
    // `if (cancelled) return` ahead of every post-resolve state write, and a cleanup that sets
    // it true. Confined to this page — no shared hook, no util.
    let cancelled = false;

    const validateAndFetch = async () => {
      if (!token) {
        setErrorMessage('No token provided');
        setPageState(PAGE_STATES.ERROR);
        return;
      }

      try {
        // Store when the form was loaded for token validation
        const formLoadedAt = new Date().toISOString();

        // Validate the magic token
        const validation = await magicAuthAPI.validateToken(token, formLoadedAt);
        if (cancelled) return;

        // The `validation.error` read that stood here is DELETED by plan 88.6-42 (cleanup,
        // not a conversion, and unaffected by the D62 branch-B ruling). It was INERT:
        // Sonnet/routes/magicAuth.js assigns `valid: true` ONLY on the success path (:208-209,
        // the sole `valid:` assignment in that route) and never on any failure branch, so the
        // `!validation.valid` arm beside it already caught every failure identically.
        if (!validation || !validation.valid) {
          setErrorMessage('This link is no longer valid. It may have expired or already been used.');
          setPageState(PAGE_STATES.ERROR);
          return;
        }

        // Token is valid - store the data
        // Phase 81 Plan 01: capture gcal_connected + has_saved_availability so
        // we can forward them to AvailabilityForm as props. Plans 02 + 03 will
        // consume them to gate "Import from Google Calendar" + "Use my saved
        // availability" pre-fill button rendering. Defaulted to false so old
        // backend deployments (no booleans on the response) silently hide the
        // buttons rather than crashing.
        setTokenData({
          userName: validation.user?.name || 'User',
          promptId: validation.prompt_id,
          expiresAt: validation.expiresAt,
          gameName: validation.game?.name || null,
          gcalConnected: validation.gcal_connected ?? false,
          hasSavedAvailability: validation.has_saved_availability ?? false,
          // Rolling 7-day window anchor (YYYY-MM-DD) — the calendar day the
          // prompt email was sent. Null on old backend deployments, which
          // makes AvailabilityForm fall back to its legacy nextMonday anchor.
          windowStart: validation.window_start ?? null,
        });

        // Phase 71.2 / Plan 03 hotfix — prefer the user's profile timezone
        // (returned from /magic-auth/validate) over browser-detected TZ.
        // Profile TZ is the source of truth in the rest of the app, and the
        // browser may be on a different timezone than where the user normally
        // games (different machine, VPN, travel).
        if (validation.user?.timezone) {
          setTimezone(validation.user.timezone);
        }

        // Try to fetch existing response for pre-fill
        try {
          const existing = await availabilityFormAPI.getExistingResponse(
            validation.prompt_id,
            token
          );
          if (cancelled) return;
          // The `existing.error` read that stood here is DELETED by plan 88.6-42 (cleanup).
          // It was DEAD: `getExistingResponse` returns `null` on a non-2xx
          // (api.ts, `res.ok ? res.json() : null`), so the truthy-`existing` guard could
          // never be entered with an error body at all.
          if (existing) {
            setExistingResponse(existing);
          }
        } catch (prefillError) {
          // Pre-fill is optional - ignore errors.
          /* DECISION Phase 88.6-23 (AC-2): the browser-console LOG that stood here — its message
             was the string "No existing response to pre-fill", written without parentheses so
             the acceptance grep for a call-shaped `console.` stays satisfiable on this file —
             is DELETED, not converted. Chosen OVER `logger.info`, which is the
             convert-on-touch DEFAULT for this round and is what a blanket reading of AC-2 would
             have produced. The rule, stated rather than decided here: a `console.log` recording
             a NORMAL, non-error control-flow outcome with no operator value is deleted; one with
             diagnostic value becomes `logger.info` (a Sentry breadcrumb, never an event). This
             was a success-path branch note on a page that renders its own empty pre-fill state,
             so the DELETE arm applies. It is the only `console.log` in the entire widened AC-2
             population. Reviving it as a breadcrumb is a decision, not a cleanup. */
        }

        if (cancelled) return;
        setPageState(PAGE_STATES.READY);
      } catch (error) {
        if (cancelled) return;
        /* AC-2 (owner ruling 2026-09-09, level AMENDED 2026-09-13): the raw `console.error` is
           retired onto the house logger at `info` — `Sentry.addBreadcrumb` (`logger.ts:34-36`),
           NOT an event, so no new Sentry event and no new Session Replay egress. Message string
           verbatim; the caught error rides in the CONTEXT OBJECT through the shared `errCtx`
           helper, never as a raw `Error` (`logger.info(msg, ctx)`'s second parameter is
           `ctx?: Record<string, unknown>`, `logger.ts:24`, and `checkJs: false` means no
           typecheck catches that at a `.js` call site). `errCtx` also keeps the `message:` key
           off this line, which is what stops a correct conversion redding R1's gate. */
        logger.info('Token validation error:', errCtx(error));
        /* R1 + SPEC Edge Coverage `empty / R1`: the ratified register replaces the blanket
           authored line this catch used to set unconditionally.

           DECISION Phase 88.6-23: `getFetchErrorMessage(error)` with NO `fallback`, chosen OVER
           passing the page's shipped string as the fallback. Two reasons, and the first is the
           load-bearing one: the old line — "This link is no longer valid. Please request a new
           one from your group organizer." — is a LIE for the two failures that actually reach
           this catch. A dropped packet arrives as `ApiError(…, 'network', 0)` and a backend
           outage as `internal`; the visitor's link is fine in both cases, and telling them to
           ask for a new one sends them down a dead end. The genuinely-expired link never reaches
           here at all: `validateToken` resolves 200 with `valid: false` and the branch above
           owns it, with its authored copy untouched. Second, a code-less, message-less throw now
           renders the register's ratified `unknown` line rather than an empty string or the
           literal `undefined`. The organizer guidance is NOT lost either way — it is a separate
           always-rendered `<p>` in the error branch below. */
        setErrorMessage(getFetchErrorMessage(error));
        setPageState(PAGE_STATES.ERROR);
      }
    };

    validateAndFetch();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Handle successful form submission
  const handleSubmissionSuccess = useCallback((result) => {
    setSubmissionResult(result);
    setPageState(PAGE_STATES.SUBMITTED);
  }, []);

  /* AC-19 (owner ruling 2026-09-09), the FOCUS half — the clause an earlier revision of the
     owning plan named in its problem statement and then did not close. On submit this page swaps
     wholesale to the confirmation state, so the submit control UNMOUNTS and focus lands on
     `<body>`: a keyboard user is returned to the top of the document with no indication of where
     they are. The confirmation heading is the focus target, reached on the SUBMITTED EDGE only.
     `Heading` forwards a ref (it is built on `React.forwardRef`), so this needs no wrapper.

     The ERROR flip deliberately takes the announcement but NOT a focus move: the error branch has
     no control the user was operating, so moving focus there would be an unrequested jump. */
  const confirmationHeadingRef = useRef(null);
  useEffect(() => {
    if (pageState === PAGE_STATES.SUBMITTED) {
      confirmationHeadingRef.current?.focus();
    }
  }, [pageState]);

  // Calculate time remaining until token expires
  const getTimeRemaining = useCallback(() => {
    if (!tokenData?.expiresAt) return null;
    const now = new Date();
    const expiry = new Date(tokenData.expiresAt);
    const remaining = expiry - now;

    if (remaining <= 0) return null;

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 1) return `${hours} hours`;
    if (hours === 1) return `1 hour ${minutes} minutes`;
    return `${minutes} minutes`;
  }, [tokenData?.expiresAt]);

  // Check if token expires within 1 hour
  const isExpiryWarning = useCallback(() => {
    if (!tokenData?.expiresAt) return false;
    const now = new Date();
    const expiry = new Date(tokenData.expiresAt);
    const remaining = expiry - now;
    return remaining > 0 && remaining < 60 * 60 * 1000; // Less than 1 hour
  }, [tokenData?.expiresAt]);

  /* The confirmation detail sentence — ONE constant, rendered by the `<p>` below AND composed
     into the live announcement, so the two cannot drift. P1: both halves are strings this page
     already shipped, so composing them authors no copy. */
  const submittedDetail = submissionResult?.isUnavailable
    ? 'You have been marked as unavailable for this week.'
    : `You selected ${submissionResult?.slotCount || 0} time slot${submissionResult?.slotCount !== 1 ? 's' : ''}.`;

  /* AC-19 (owner ruling 2026-09-09, option (a)), WIDENED to the ERROR flip.

     SUBMITTED announces the SUCCESS STATEMENT **and** the detail sentence. The detail alone is
     NOT acceptable: on the majority path it only echoes the user's own input back and never
     states that the availability was recorded — which is the harm the ruling was made to close —
     and the only other success signal on this screen, the check `<svg>`, is `aria-hidden` by the
     same task, so no other channel carries it.

     ERROR yields the `errorMessage` the page already renders. The LOADING->ERROR transition was
     silent for exactly the reason SUBMITTED was: the page swaps wholesale, LOADING's "Validating
     your link..." is a plain `<p>`, and the error `<svg>` is now hidden too. The mount effect is
     the ONLY producer of `PAGE_STATES.ERROR`, so there is no second path to reason about.
     AC-19's ruling is scoped to SUBMITTED; that scope is a BOOKKEEPING constraint — no failure
     mode sits behind honouring it — and the cost of widening is one more arm in this expression,
     inside a region the ruling already puts on the page. The mechanism is untouched.

     Every other state yields `''`. */
  const announcement =
    pageState === PAGE_STATES.SUBMITTED
      ? `${SUBMITTED_HEADLINE} ${submittedDetail}`
      : pageState === PAGE_STATES.ERROR
        ? errorMessage || ''
        : '';

  let body;

  if (pageState === PAGE_STATES.LOADING) {
    // Render loading state
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto"></div>
          <p className="mt-4 text-content-secondary">Validating your link...</p>
        </div>
      </div>
    );
  } else if (pageState === PAGE_STATES.ERROR) {
    // Render error state
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface-card rounded-card shadow-theme-lg p-8 text-center">
          <div className="w-16 h-16 bg-status-error-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            {/* Decorative: the meaning is carried by the heading beside it. Repo idiom —
                `aria-hidden` + `focusable="false"` on the graphic itself, matching the
                `<svg>`s on the sibling invite pages and `Icon`'s own default. */}
            <svg className="w-8 h-8 text-content-status-error" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          {/* h1 @ 20 STAYS at 20 (D-04 row 2). This is the ERROR branch, mutually exclusive with
              the page title below — not a loading branch, and not the title. */}
          <Heading level={1} size="heading" className="text-content-primary mb-2">
            Link No Longer Valid
          </Heading>
          <p className="text-content-secondary mb-6">
            {errorMessage}
          </p>
          <p className="text-sm text-content-muted">
            Please contact your group organizer to request a new availability link.
          </p>
        </div>
      </div>
    );
  } else if (pageState === PAGE_STATES.SUBMITTED) {
    // Render submitted/confirmation state
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface-card rounded-card shadow-theme-lg p-8 text-center">
          <div className="w-16 h-16 bg-status-success-subtle rounded-full flex items-center justify-center mx-auto mb-4">
            {/* Decorative — see the error branch. Hiding it is why the announcement above must
                carry the success STATEMENT and not only the detail sentence. */}
            <svg className="w-8 h-8 text-content-status-success" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          {/* h1 @ 20 STAYS at 20 (D-04 row 2), and is the FOCUS TARGET on the SUBMITTED edge —
              see the AC-19 focus effect above. `tabIndex={-1}` makes it programmatically
              focusable without adding it to the tab order. */}
          <Heading
            ref={confirmationHeadingRef}
            tabIndex={-1}
            level={1}
            size="heading"
            className="text-content-primary mb-2"
          >
            {SUBMITTED_HEADLINE}
          </Heading>
          <p className="text-content-secondary mb-4">
            {submittedDetail}
          </p>
          <p className="text-sm text-content-muted mb-6">
            Your group organizer will be notified of your response.
          </p>
          <div className="border-t border-line pt-4">
            <p className="text-sm text-content-secondary mb-2">
              You can safely close this tab.
            </p>
            <p className="text-xs text-content-muted">
              Made a mistake? You can reopen this link to update your response until the deadline.
            </p>
          </div>
        </div>
      </div>
    );
  } else {
    // Render ready state (form)
    body = (
      <div className="min-h-screen bg-surface-page py-8 px-4 md:px-6">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="bg-surface-card rounded-card shadow-theme-lg p-3 md:p-6 mb-6">
            <Heading level={1} size="display" className="text-content-primary mb-2">
              Submit Your Availability
            </Heading>
            <p className="text-content-secondary">
              Select the times you&apos;re available for the upcoming {tokenData?.gameName || 'Game TBD'} session.
            </p>

            {/* Token expiry warning */}
            {isExpiryWarning() && (
              <div className="mt-4 bg-status-warning-subtle border border-status-warning rounded-btn p-2 md:p-3">
                <p className="text-sm text-content-status-warning">
                  {/* §4.5: 500 -> 700, the HIERARCHY outcome rather than the emphasis one. The
                      emphasis outcome is "400 + a colour token", and this span has no colour of
                      its own — the whole sentence is already `text-content-status-warning` — so
                      dropping to 400 would erase the lead-in distinction entirely rather than
                      re-carry it. REJECTED: 400 + delete. */}
                  <span className="font-bold">Heads up:</span> This link expires in {getTimeRemaining()}. Please submit your availability soon.
                </p>
              </div>
            )}
          </div>

          {/* Form Container */}
          <div className="bg-surface-card rounded-card shadow-theme-lg p-3 md:p-6">
            <AvailabilityForm
              magicToken={token}
              userName={tokenData?.userName}
              promptId={tokenData?.promptId}
              existingResponse={existingResponse}
              timezone={timezone}
              onSuccess={handleSubmissionSuccess}
              // Phase 81 Plan 01 — pre-fill button gates. Plans 02 + 03 wire these
              // into the AvailabilityForm pre-fill button row; this plan only
              // threads the prop pipeline so the wave-2 plans don't have to
              // touch this page.
              gcalConnected={tokenData?.gcalConnected ?? false}
              hasSavedAvailability={tokenData?.hasSavedAvailability ?? false}
              windowStart={tokenData?.windowStart ?? null}
            />
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-content-muted">
            <p>
              Times shown in your local timezone ({timezone})
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* DECISION Phase 88.6-23 (AC-19): ONE `StatusRegion`, rendered from THIS component at
     FRAGMENT SLOT 0 — chosen OVER three alternatives, each rejected for a stated reason.

     REJECTED (1) — placing the region inside the SUBMITTED branch. A region mounted together
     with its content does not announce; screen readers announce CHANGES to a live region, not
     the conditional mount of a new one. That is the whole contract `StatusRegion` codifies.

     REJECTED (2) — hoisting a shared wrapper `<div>` around the four branches. The four branch
     roots are NOT interchangeable: LOADING is `min-h-screen bg-surface-page flex items-center
     justify-center`, ERROR and SUBMITTED add ` p-4`, and READY is `min-h-screen bg-surface-page
     py-8 px-4 md:px-6` with NO centering. One shared root would vertically-centre the READY form
     at the wrong horizontal padding on this phase's most phone-primary surface. All four root
     className strings above are therefore byte-unchanged, and a FRAGMENT adds no box at all.

     REJECTED (3) — a route `layout.js` hosting the region. It would have perfect node identity
     and would PASS an identity assertion while never being FILLED, because a server-rendered
     shell cannot read this client page's `pageState`. That is a CONSEQUENCE, not a preference:
     "shared shell" must not be read as "add a route layout". This directory holds `error.tsx`,
     `loading.tsx` and `page.js` only, and this plan adds nothing to it.

     WHY SLOT 0 WORKS: React reconciles same-type children by index, so the region is the SAME
     DOM node across every branch flip and the flip really is empty -> filled in one commit
     (`handleSubmissionSuccess` sets `submissionResult` and `pageState` together).

     A SECOND `role="status"` LIVES ON THIS SURFACE AND IS NOT CONSOLIDATED. `AvailabilityForm`
     renders `replaceGate.statusNode` unconditionally — a `StatusRegion` with `className:
     'sr-only'` built in `useConfirmAction.ts`. So the READY render legitimately carries TWO
     always-mounted `role="status"` nodes. (A third region, the `<p role="alert">` in that same
     form, is conditional and a different role, so it does not collide with a `status` query.)
     UI-SPEC's "exactly one live region … Do not add a second region" is scoped to FAILURE
     announcement, so a SUBMITTED-success region does not violate it. They coexist DELIBERATELY:
     this one survives the branch flip, the form's unmounts with the form. Hence the
     `data-testid` — a bare `getByRole('status')` matches two elements on READY. */
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
