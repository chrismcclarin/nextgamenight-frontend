'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { invitesAPI } from '../../../lib/api';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Heading';
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
   version and proves nothing. */
function isWrongEmailRefusal(err) {
  if (err?.code !== 'forbidden' || err?.status !== 403) return false;
  const body = err?.details;
  return !(body && typeof body === 'object' && body.csrf_rejected === true);
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
     200 body — is deliberately NOT owned here and has no owner invented for it. */
  const [error, setError] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null);

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
      // Store token in localStorage as backup for post-login redirect
      if (typeof window !== 'undefined') {
        localStorage.setItem('pendingInviteToken', token);
      }
      return;
    }

    // AC-13: the sibling magic-link pages' cancellation idiom, copied verbatim from
    // `invite/game/[token]/page.js:69,74,77,100`. The per-effect-run form is correct here
    // because this effect carries no single-shot latch to deadlock against.
    let cancelled = false;

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
         shipped `removeItem` could not reach (it sat inside the override branch). */
      const tokenToUse = token;

      try {
        const result = await invitesAPI.acceptInviteByToken(tokenToUse);
        if (cancelled) return;
        setStatus('accepted');
        setGroupId(result.group_id || result.groupId || null);
      } catch (err) {
        if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, token]);

  // Fetch invite info for not-logged-in users (public endpoint)
  useEffect(() => {
    if (status !== 'not-logged-in' || !token) return;

    // AC-13: same idiom as the accept effect above.
    let cancelled = false;

    async function fetchInviteInfo() {
      try {
        const info = await invitesAPI.getInviteInfo(token);
        if (cancelled) return;
        setInviteInfo(info);
      } catch (err) {
        // Fall back to generic message if fetch fails.
        // AC-2 (owner ruling 2026-09-09, level AMENDED 2026-09-13): the raw `console.error` is
        // retired onto the house logger at `info` — `Sentry.addBreadcrumb` (`logger.ts:34-36`),
        // NOT an event. The message string is verbatim, and the caught error rides in the CONTEXT
        // OBJECT via the shared `errCtx(err)` helper rather than being passed as an object:
        // `logger.info(msg, ctx)`'s second parameter is `ctx?: Record<string, unknown>`
        // (`logger.ts:24`) and `checkJs: false` means no typecheck catches that at a `.js` site.
        // `errCtx` also keeps the `message:` key OFF this line, which is what stops a correct
        // conversion redding `fetchErrorTreatment`'s R1 gate (see the helper's own marker).
        logger.info('Failed to fetch invite info:', errCtx(err));
      }
    }

    fetchInviteInfo();
    return () => {
      cancelled = true;
    };
  }, [status, token]);

  // Loading state while Auth0 resolves
  if (authLoading || status === 'loading') {
    return (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4 text-center">
          <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
          <p className="text-content-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
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
              <svg className="w-8 h-8 text-content-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {/* The copy is the string this heading ALREADY rendered on every code path: the
                `groupName` interpolation was provably dead (see the marker on the deleted
                state above), so this is a P1 no-op, not a copy change. */}
            <Heading level={1} size="heading" className="text-content-primary mb-2">
              You&apos;ve joined the group!
            </Heading>
            <p className="text-content-secondary mb-6">
              You can now see events, suggest games, and coordinate with your group.
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
              <svg className="w-8 h-8 text-content-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <Heading level={1} size="heading" className="text-content-primary mb-2">
              Unable to accept invite
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
              You&apos;re invited!
            </Heading>

            {inviteInfo ? (
              <p className="text-content-secondary mb-6">
                {/* §4.5 emphasis: 500 -> 400, and the distinction is carried by the colour
                    token each span already had (`text-content-primary` against the
                    paragraph's `text-content-secondary`), not by the weight. */}
                <span className="text-content-primary">{inviteInfo.inviter_name || 'Someone'}</span> invited you to join{' '}
                <span className="text-content-primary">{inviteInfo.group_name || 'a group'}</span> on Next Game Night.
                {inviteInfo.member_count && (
                  <span className="block text-sm text-content-muted mt-1">
                    The group has {inviteInfo.member_count} member{inviteInfo.member_count !== 1 ? 's' : ''}.
                  </span>
                )}
              </p>
            ) : (
              <p className="text-content-secondary mb-6">
                You&apos;ve been invited to a group on Next Game Night.
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

export default InviteAcceptPage;
