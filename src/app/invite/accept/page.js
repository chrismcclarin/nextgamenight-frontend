'use client';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { invitesAPI, isCsrfRejection } from '../../../lib/api';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Heading';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { logger, errCtx } from '@/lib/logger';

/* DECISION Phase 88.6-23 (D-46 / T-88.6-149): the wrong-email arm is GATED on the 403 NOT being
   the BFF proxy's CSRF rejection — chosen OVER keying it on `err.code === 'forbidden'` alone,
   which is the obvious shape and is WRONG, because TWO sources put a code-less 403 on this call:

     (i)  the BACKEND's wrong-email refusal — `user.email.toLowerCase() !==
          invite.invited_email.toLowerCase()` at `routes/invites.js:757-758`, the ONLY 403
          emitted inside that handler (verified live 2026-09-14); and
     (ii) the SAME-ORIGIN BFF PROXY this call traverses on its way there —
          `acceptInviteByToken` -> `apiFetch` -> `BFF_BASE = '/api'` ->
          `src/app/api/[...path]/route.ts`, whose CSRF gate returns 403 BEFORE any backend
          forward and is the only 403 that file emits.

   `mapErrorToCode` resolves both to `statusToCode(403)` = `'forbidden'`, so an UNGATED override
   tells a CSRF-rejected visitor their invite was sent to a different email address.

   THE DISCRIMINATOR IS STRUCTURAL, NOT PROSE: the proxy stamps `csrf_rejected: true` into its
   body (see the marker at that gate) and `ApiError.details` carries the whole body, so this
   survives plan 88.6-42's `body.error` alias drop in wave 8. Matching
   `'Cross-origin request rejected'` instead would not, and reading `err.details.error` would
   trip `errorEnvelopeReads.test.ts`'s `X.error` scanner at an unrostered site.

   IT FAILS TOWARD THE PROXY, DELIBERATELY: only the proxy's own marked body is excluded, so the
   arm fires for the backend refusal and for nothing the proxy produced. Both 403 shapes carry
   their own arm in `page.test.tsx` — an arm for the backend 403 alone passes on the ungated
   version and proves nothing.

   AMENDED Phase 88.6.1-35 (D-24): the gate's reason above STANDS — the arm is still gated on the
   403 not being the proxy's. The structural test of the proxy's flag now has ONE home,
   `isCsrfRejection` in `src/lib/api.ts` (`DECISION Phase 88.6.1-07`), which
   `getFetchErrorMessage` also reads, so a CSRF 403 here falls to the register's unknown line.
   CHOSEN over keeping this page's own copy of that test: two definitions of the proxy body's
   shape can drift (a later change to the flag would update one). Behaviour is unchanged for
   every `ApiError`: both checks are strict on status 403 and on the boolean `true`. */
function isWrongEmailRefusal(err) {
  return err?.code === 'forbidden' && err?.status === 403 && !isCsrfRejection(err);
}

// The page region's test handle. NOT EXPORTED, deliberately — the reason is recorded on the rsvp
// page (`rsvp/[token]/page.js`, anchor `NOT EXPORTED, deliberately`): Next's generated route types
// reject a page module's non-route named exports. The test re-declares the literal.
const PAGE_STATUS_TESTID = 'invite-accept-page-status';

// Strings this page already rendered before plan 88.6.1-35, hoisted so the branch markup and the
// screen-reader announcement read ONE source and cannot drift apart (no new words, D-31).
const ACCEPTED_HEADLINE = "You've joined the group!";
const ACCEPTED_DETAIL = 'You can now see events, suggest games, and coordinate with your group.';
const ERROR_HEADLINE = 'Unable to accept invite';
const INVITED_HEADLINE = "You're invited!";
const INVITED_GENERIC_LINE = "You've been invited to a group on Next Game Night.";

// Copy row L1 (D-30, owner-ratified 2026-10-04), byte-equal to this route's own `loading.tsx`
// label. Three ASCII dots, no apostrophe.
const LOADING_LABEL = 'Checking your invitation...';

/** Join the non-empty parts of an announcement with one space (never a trailing space). */
function joinParts(...parts) {
  return parts.filter(Boolean).join(' ');
}

function InviteAcceptPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading'); // loading | accepting | accepted | error | not-logged-in
  const [groupId, setGroupId] = useState(null);
  /* DECISION Phase 88.6-23: the `groupName` state and the `result.group_name ||
     result.groupName` read that fed it are DELETED — chosen OVER keeping the read "in case the
     backend starts sending it", which is the obvious defensive shape and is what shipped.
     MEASURED 2026-09-14: `POST /invites/accept-by-token` has exactly ONE success return,
     `res.json({ success: true, group_id: invite.group_id })` (`routes/invites.js:779`) — no
     `group_name`, no `groupName`. So the read always stored `null` and the heading below always
     rendered "You've joined the group!". Deleting it changes NO rendered string (P1); it just
     stops a dead read pretending the copy is dynamic. The BE half — adding `group_name` to that
     200 body — is deliberately NOT owned here and has no owner invented for it.

     AMENDED Phase 88.6.1-35 (W054): its twin — the camelCase id alias read beside the snake_case
     `group_id` on the same success body — was dead for the same reason (the route's sole success
     body carries the snake_case id only) and is deleted. The "User not found" half of W054 stays
     with Phase 93. */
  const [error, setError] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null);
  // Req 8: the signed-out announcement waits for the invite-info request to SETTLE (success, null
  // body or failure) — see DECISION Phase 88.6.1-35 (Req 8 / AC-24) at the return below.
  const [inviteInfoSettled, setInviteInfoSettled] = useState(false);

  // W039: the single-shot accept latch and the unmount-scoped write guard — see the
  // DECISION Phase 88.6.1-35 (W039 / WR-401) marker in the accept effect below.
  const acceptingRef = useRef(false);
  const unmountedRef = useRef(false);

  // The reset-on-mount line is required: StrictMode runs this cleanup and then the body again,
  // and without the reset the in-flight POST would land into a page that looks unmounted.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Handle logged-in user: auto-accept the invite
  useEffect(() => {
    if (authLoading) return;

    if (!token) {
      setStatus('error');
      setError('Invalid invite link');
      return;
    }

    if (!user) {
      setStatus('not-logged-in');
      // No localStorage copy of the token here — see the AMENDED 88.6-59 note in the
      // DECISION Phase 88.6-23 marker below. The sign-in anchor's `returnTo` carries it.
      return;
    }

    /* DECISION Phase 88.6.1-35 (W039 / WR-401): CHOSEN — a single-shot latch per page load
       (`acceptingRef`, checked and set here, never cleared) plus an unmount-scoped write guard
       (`unmountedRef`), the shape the sibling `invite/group/[token]/page.js` already ships under
       `DECISION Phase 88.6-23 (AC-13)`. AC-13's purpose — no write after the page is gone — is
       kept by the unmount-scoped ref.

       WHY: the accept route is NOT idempotent — a second call for the same token answers 404
       `Pending invite not found`. So a re-run of this effect while the first POST was in flight
       (an Auth0 revalidation hands back a new user object; StrictMode re-runs every effect in
       development) cancelled the successful run and fired a second request, whose 404 put
       "may have already been accepted or expired" in front of someone who had just joined.

       REJECTED (1) — the per-effect-run cancellation flag (what shipped): it is exactly the bug.
       REJECTED (2) — clearing the latch on the error path (the review's fix text): this page has
       no retry control, so only a session revalidation could re-arm it, which would re-POST
       unasked and flip a shown error to "Accepting..." and back; signing in as another account
       is a full navigation (the sign-in control is a plain anchor), which resets every ref anyway.

       ASSUMPTION, verified 2026-10-05: the token cannot change within one mount. The only
       producer of this URL is the backend's emailed invite link, and a tree-wide search of the
       frontend for links, pushes and replaces to this route finds none outside this page's own
       sign-in anchor — so a boolean latch, not a per-token one, is sufficient.

       Re-adding a per-run flag or clearing the latch is a decision, not a cleanup. */
    if (acceptingRef.current) return;
    acceptingRef.current = true;

    // User is logged in -- accept the invite
    async function acceptInvite() {
      setStatus('accepting');

      /* DECISION Phase 88.6-23 (T-88.6-148): the URL TOKEN WINS. The stored
         `pendingInviteToken` is no longer read here at all — chosen OVER the STORED-TOKEN-WINS
         ordering that shipped (`let tokenToUse = token` then an UNCONDITIONAL override from
         `localStorage`), which is the obvious shape and the one a future reader would restore.

         WHY IT HAD TO GO: an invite token is a bearer credential for group membership. A
         visitor who opened invite A logged out (the write is in the `!user` branch above) and
         later opened invite B logged in JOINED GROUP A. The code re-key below would have made
         that read worse, not better — the stale token's 404 now renders "already accepted or
         expired" while the invite actually clicked is valid.

         WHY NO `token || localStorage.getItem(…)` FALLBACK ARM, which is what an earlier
         revision of the owning plan asked for: the effect returns above without a URL token, so
         inside this function `token` is always a non-empty string and that arm is UNREACHABLE.
         Writing provably-dead code beside a security fix is worse than not writing it. Safe
         because the login anchor at the bottom of this file already round-trips the token
         through `returnTo` (`/invite/accept?token=…`), so the stored copy was a belt, never the
         post-login carrier.

         The stored copy is cleared in the `finally` below — on the ERROR path too, which the
         shipped `removeItem` could not reach (it sat inside the override branch).

         AMENDED 2026-09-29 — DECISION Phase 88.6-59 (review MEDLOW-10, owner ruling `R-5-RULING`):
         the WRITE is now DELETED as well. It sat in the `!user` branch above and outlived its
         only reader (the `getItem` this marker removed), so it was pure retention of a
         group-membership bearer credential. The `returnTo` on the sign-in anchor at the bottom
         of this file (`/invite/accept?token=…`) is the post-login carrier. REJECTED: keeping the
         write "as a backup" — nothing reads it, and a future reader added back would re-open
         the stored-token hijack above. The `finally` `removeItem` is KEPT for one release on
         purpose, to sweep tokens that older builds stored; Phase 90 deletes it once `043734d`
         has been in production for 30 days — `.planning/deferred/phase-90.md` (the `[cleanup]
         Delete the transitional pendingInviteToken removeItem sweep` entry; re-pointed by plan
         88.6-63, review round 2 #19). Deleting
         that sweep early is a decision, not a cleanup. */
      const tokenToUse = token;

      try {
        const result = await invitesAPI.acceptInviteByToken(tokenToUse);
        if (unmountedRef.current) return;
        setStatus('accepted');
        setGroupId(result.group_id || null);
      } catch (err) {
        if (unmountedRef.current) return;
        setStatus('error');
        /* R1 + D-46: the three outcomes are keyed on `err.code`, chosen OVER the shipped
           `err.message` prose match (`'not found'` / `'already'` / `'not for you'` /
           `'different email'`). Plan 88.6-42 drops the `body.error` alias in wave 8, after
           which every one of those strings becomes `HTTP error! status: N` and no arm matches.

           `POST /invites/accept-by-token` emits NO envelope `code` (`routes/invites.js:731-784`
           — verified 2026-09-14), so `mapErrorToCode` falls back to `statusToCode` and the codes
           reaching this page are status-derived: `not_found` (404), `forbidden` (403), `gone`
           (410), `validation` (400), `internal` (500). `already_member` / `invite_pending` are
           `/send`-only and are wrong on this page.

           The two overrides are REQUIRED, not stylistic: no string in `MESSAGE_BY_CODE`
           contains "already accepted" or "different email address", so deleting the read alone
           would collapse both specific screens into the generic line. */
        if (err?.code === 'not_found') {
          setError('This invite may have already been accepted or expired.');
        } else if (isWrongEmailRefusal(err)) {
          setError('This invite was sent to a different email address.');
        } else {
          setError(getFetchErrorMessage(err));
        }
      } finally {
        // Clear the stored credential on EVERY exit path — success, failure and cancellation.
        // The shipped `removeItem` was reachable only when a stored token had already been
        // promoted over the URL one, so on the error path the credential persisted forever.
        if (typeof window !== 'undefined') {
          localStorage.removeItem('pendingInviteToken');
        }
      }
    }

    acceptInvite();
  }, [user, authLoading, token]);

  // Fetch invite info for not-logged-in users (public endpoint)
  useEffect(() => {
    if (status !== 'not-logged-in' || !token) return;

    // AC-13 — corrected in place by plan 88.6.1-35: the per-effect-run cancellation idiom stays on
    // THIS effect and is correct here, unlike the accept effect above — the invite-info GET is
    // idempotent and carries no latch, so a re-run simply re-fetches and the stale run's result
    // is dropped.
    let cancelled = false;

    async function fetchInviteInfo() {
      try {
        const info = await invitesAPI.getInviteInfo(token);
        if (cancelled) return;
        setInviteInfo(info);
        setInviteInfoSettled(true);
      } catch (err) {
        // Fall back to generic message if fetch fails.
        // AC-2 (owner ruling 2026-09-09, level AMENDED 2026-09-13): the raw `console.error` is
        // retired onto the house logger at `info` — `Sentry.addBreadcrumb` (`logger.ts:53`),
        // NOT an event. The message string is verbatim, and the caught error rides in the CONTEXT
        // OBJECT via the shared `errCtx(err)` helper rather than being passed as an object:
        // `logger.info(msg, ctx)`'s second parameter is `ctx?: Record<string, unknown>`
        // (`logger.ts:31`) and `checkJs: false` means no typecheck catches that at a `.js` site.
        // `errCtx` also keeps the `message:` key OFF this line, which is what stops a correct
        // conversion redding `fetchErrorTreatment`'s R1 gate (see the helper's own marker).
        logger.info('Failed to fetch invite info:', errCtx(err));
        if (cancelled) return;
        setInviteInfoSettled(true);
      }
    }

    fetchInviteInfo();
    return () => {
      cancelled = true;
    };
  }, [status, token]);

  // W039 / Req 8: the outcome the page region speaks. Composed ONLY from text the settled branch
  // already renders (its <h1> plus its first body line, one space), read from the same hoisted
  // values the markup reads — see DECISION Phase 88.6.1-35 (Req 8 / AC-24) at the return below.
  const inviterName = inviteInfo?.inviter_name || 'Someone';
  const invitedGroupName = inviteInfo?.group_name || 'a group';
  const memberCount = inviteInfo?.member_count;
  /* DECISION Phase 88.6.1-35 (member count): the count line renders ONLY when the count is a number
     above zero. The old guard tested the raw count's truthiness, so when the info route counts zero
     active members it rendered a stray `0` glued to the end of the sentence. REJECTED: printing a
     zero count — true, but not what the line was written to say, and no ratified wording exists
     for it. Changing this is a decision, not a cleanup. */
  const memberCountLine =
    typeof memberCount === 'number' && memberCount > 0
      ? `The group has ${memberCount} member${memberCount !== 1 ? 's' : ''}.`
      : '';

  let announcement = '';
  if (!authLoading) {
    if (status === 'accepted') {
      announcement = joinParts(ACCEPTED_HEADLINE, ACCEPTED_DETAIL);
    } else if (status === 'error') {
      announcement = joinParts(ERROR_HEADLINE, error);
    } else if (status === 'not-logged-in' && inviteInfoSettled) {
      announcement = joinParts(
        INVITED_HEADLINE,
        inviteInfo
          ? joinParts(
              `${inviterName} invited you to join ${invitedGroupName} on Next Game Night.`,
              memberCountLine
            )
          : INVITED_GENERIC_LINE
      );
    }
  }

  let body;
  if (authLoading || status === 'loading') {
    // Loading state while Auth0 resolves
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4 text-center">
          <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
          <p className="text-content-secondary">{LOADING_LABEL}</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4">

          {/* Accepting state */}
          {status === 'accepting' && (
            <div className="text-center">
              <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
              <p className="text-content-primary">Accepting your invite...</p>
            </div>
          )}

          {/* Accepted state */}
          {status === 'accepted' && (
            <div className="text-center">
              {/* Green checkmark */}
              <div className="mx-auto mb-4 w-16 h-16 bg-status-success-subtle rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-content-status-success" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              {/* The copy is the string this heading ALREADY rendered on every code path: the
                  `groupName` interpolation was provably dead (see the marker on the deleted
                  state above), so this is a P1 no-op, not a copy change. */}
              <Heading level={1} size="heading" className="text-content-primary mb-2">
                {ACCEPTED_HEADLINE}
              </Heading>
              <p className="text-content-secondary mb-6">
                {ACCEPTED_DETAIL}
              </p>
              <div className="flex flex-col gap-3">
                {groupId && (
                  <Button asChild variant="primary" size="default" className="w-full text-center">
                    <Link href={`/groupHomePage?id=${groupId}`}>
                      Go to Group
                    </Link>
                  </Button>
                )}
                <Button asChild variant="secondary" size="default" className="w-full text-center">
                  <Link href="/">
                    Go Home
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="text-center">
              {/* Red X icon */}
              <div className="mx-auto mb-4 w-16 h-16 bg-status-error-subtle rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-content-status-error" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <Heading level={1} size="heading" className="text-content-primary mb-2">
                {ERROR_HEADLINE}
              </Heading>
              <p className="text-content-secondary mb-6">{error}</p>
              <Button asChild variant="primary" size="default" className="w-full text-center">
                <Link href="/">
                  Go Home
                </Link>
              </Button>
            </div>
          )}

          {/* Not logged in state */}
          {status === 'not-logged-in' && (
            <div className="text-center">
              {/* Invite icon.
                  DECISION Phase 88.3-16 (owner ruling 3, 2026-08-27) — pointer, full marker at
                  `src/components/ui/EmptyState.tsx`: this is the circle the owner actually tested on
                  his phone. It and its glyph move TOGETHER to the `-strong` pair (amber-200 /
                  amber-900, 7.28:1); the SHARED `--color-bg-accent-subtle` and its ~13 other
                  consumers are deliberately untouched. The `<svg>` here also gained
                  `aria-hidden="true" focusable="false"` — it is decorative and was announcing as a
                  bare "graphic" with no name, an inconsistency with our own `Icon` primitive, which
                  defaults to `aria-hidden`. Both are decisions, not cleanups. */}
              <div className="mx-auto mb-4 w-16 h-16 bg-surface-accent-subtle-strong rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-content-accent-strong" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>

              <Heading level={1} size="heading" className="text-content-primary mb-2">
                {INVITED_HEADLINE}
              </Heading>

              {inviteInfo ? (
                <p className="text-content-secondary mb-6">
                  {/* §4.5 emphasis: 500 -> 400, and the distinction is carried by the colour
                      token each span already had (`text-content-primary` against the
                      paragraph's `text-content-secondary`), not by the weight. */}
                  <span className="text-content-primary">{inviterName}</span> invited you to join{' '}
                  <span className="text-content-primary">{invitedGroupName}</span> on Next Game Night.
                  {memberCountLine && (
                    <span className="block text-sm text-content-muted mt-1">
                      {memberCountLine}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-content-secondary mb-6">
                  {INVITED_GENERIC_LINE}
                </p>
              )}

              {/* §3.2 `asChild`: stays an `<a>`, `href` byte-identical. This anchor is also what
                  makes the stored-token fallback unnecessary — it round-trips the URL token
                  through `returnTo`, so the accept effect always has one. */}
              <Button asChild variant="primary" size="default" className="w-full text-center">
                <a
                  href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
                >
                  Sign in to accept
                </a>
              </Button>

              <p className="text-xs text-content-muted mt-4">
                Don&apos;t have an account? Signing in will create one automatically.
              </p>
            </div>
          )}

        </div>
      </div>
    );
  }

  /* DECISION Phase 88.6.1-35 (Req 8 / AC-24): ONE always-mounted `StatusRegion` at FRAGMENT SLOT 0,
     rendered from this component and never from inside a branch — ported from
     `DECISION Phase 88.6-24` (`rsvp/[token]/page.js`), `DECISION Phase 88.6-23`
     (`availability-form/[token]/page.js`) and plan 88.6.1-19's two sibling invite pages
     (`DECISION Phase 88.6.1-19 (R8)`), not re-invented. React reconciles same-type children by
     index, so the region is the SAME DOM node across the loading-return to main-return swap and
     each outcome lands as a change to it.

     REJECTED (1) — a region inside each branch: mounted together with its text, a polite region
     announces nothing (D-42 keeps that premise for polite/status regions).
     REJECTED (2) — a shared wrapper `<div>`: the two roots happen to share a className here, but
     a fragment adds no box and matches both shipped siblings.
     REJECTED (3) — a route layout: a server-rendered shell cannot read this client page's state.

     sr-only, because the region repeats a heading that is already on screen. D-22's opt-in
     empty-state prop is NOT adopted: this region is always sr-only (ST-2 group A).
     NO FOCUS MOVE on this page: nothing the user operated is removed — the accept runs on load
     from an emailed link and the sign-in control is a navigation (the availability-form
     ERROR-flip rule; the rsvp page's NO FOCUS MOVE rule).

     SIGNED OUT: the announcement waits for the invite-info request to SETTLE (success, null body
     or failure), so it speaks once, with the final words. REJECTED: announcing the generic line at
     once and again when the names arrive — two announcements for one screen. ACCEPTED COST: a
     request that never settles announces nothing, while the page still shows its heading, the
     generic line and the sign-in control. The small print under the sign-in control is not
     announced (heading plus first body line, the sibling invite pages' rule).
     Changing any of this is a decision, not a cleanup. */
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

export default InviteAcceptPage;
