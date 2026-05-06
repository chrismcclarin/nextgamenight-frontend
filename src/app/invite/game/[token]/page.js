'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { eventsAPI } from '../../../../lib/api';

// POLL-05 status enum (D-INVITE-LANDING-04 zero-flash mandate):
// loading → preview (unauth) | joining → joined | already-joined | expired
//                                                | error-transient | error-permanent
function GameInvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading');
  const [eventInfo, setEventInfo] = useState(null);
  const [error, setError] = useState(null);

  // POLL-05 race fix (D-INVITE-LANDING-04): single-shot in-flight guard.
  // The previous implementation listed `status` in the autoJoin effect's
  // deps array, so setStatus('joining') re-fired the effect and triggered
  // parallel joinGameByToken POSTs — which 500'd the second-arriving call
  // on the EventParticipations unique constraint and visibly bounced the UI
  // through 'already-joined' for a legitimate first-join. The ref keeps
  // the contract single-shot per page-load regardless of effect re-fires
  // (React 18 strict-mode dev double-render included). Belt-and-suspenders
  // alongside removing `status` from the dep array.
  const joiningRef = useRef(false);

  // Fetch event preview info (public, no auth needed)
  useEffect(() => {
    if (!token) {
      setStatus('error-permanent');
      setError('Invalid invite link');
      return;
    }

    let cancelled = false;

    async function fetchPreview() {
      try {
        const data = await eventsAPI.getEventInvitePreview(token);
        if (cancelled) return;
        setEventInfo(data);
      } catch (err) {
        if (cancelled) return;
        // 410 expired event
        if (err.message && (err.message.includes('expired') || err.message.includes('passed'))) {
          setStatus('expired');
        } else {
          // Preview failed permanently (404 invalid token, etc.)
          setStatus('error-permanent');
          setError('This invite link is no longer valid.');
        }
      }
    }

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Handle auth state after preview is loaded
  useEffect(() => {
    if (authLoading) return;
    if (!eventInfo) return;
    if (!user) {
      // Surface the auth gate first; once Auth0 returns to this page the
      // effect re-runs with user truthy and proceeds to autoJoin.
      setStatus('preview');
      return;
    }
    // Terminal states — never re-fire join from any of these.
    if (status === 'expired' || status === 'error-permanent') return;
    if (status === 'joined' || status === 'already-joined') return;

    // POLL-05: single-shot guard. Once we've fired the POST for this
    // page-load, never fire again — even if the effect re-runs because of
    // some unrelated dep change. Retry handler explicitly resets this.
    if (joiningRef.current) return;

    joiningRef.current = true;
    setStatus('joining');

    eventsAPI
      .joinGameByToken(token)
      .then((result) => {
        if (result?.already_joined) {
          setStatus('already-joined');
        } else if (result?.success) {
          setStatus('joined');
        } else {
          // Defensive: backend returned an unexpected shape.
          setStatus('error-transient');
          setError('Unexpected response from server.');
        }
      })
      .catch((err) => {
        // D-INVITE-LANDING-03: branch transient vs permanent.
        // Permanent: 404 invalid token, 410 expired, "expired"/"passed" copy,
        // "full"/"deleted" copy. These won't be fixed by retrying.
        // Transient: network failures, 5xx, fetch TypeErrors. Retry-able.
        const msg = err?.message || '';
        const status = err?.status;
        const isPermanent =
          status === 404 ||
          status === 410 ||
          msg.includes('expired') ||
          msg.includes('passed') ||
          msg.includes('full') ||
          msg.includes('deleted') ||
          msg.includes('Invalid invite');
        const isTransient =
          status === 0 ||
          (status >= 500 && status < 600) ||
          err?.name === 'TypeError' ||
          msg.toLowerCase().includes('network') ||
          msg.toLowerCase().includes('fetch') ||
          msg.toLowerCase().includes('failed to fetch');

        setError(msg || 'Failed to join game night.');
        // If we can't classify confidently, treat as transient — retry is
        // safer than a dead-end CTA, and findOrCreate makes retry idempotent.
        setStatus(isPermanent && !isTransient ? 'error-permanent' : 'error-transient');
      });
    // NOTE: `status` deliberately omitted from deps — its inclusion was the
    // root cause of the parallel-POST flicker bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, eventInfo, token]);

  // Retry handler for transient errors. Resets the ref so the autoJoin
  // effect can fire one more POST.
  const handleRetry = () => {
    joiningRef.current = false;
    setError(null);
    setStatus('loading');
    // Bump the effect: status flips to loading, eventInfo + user still
    // truthy, ref cleared → next render runs the join path again.
  };

  // Format event date nicely
  const formatEventDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Build the canonical event detail URL. Phase 64-01 confirmed gameDetail
  // accepts ?event_id= for the canonical single-event surface.
  const goToEventHref = eventInfo?.event_id
    ? `/gameDetail?event_id=${eventInfo.event_id}`
    : '/';

  // Loading / joining state — brief spinner only. D-INVITE-LANDING-04
  // mandates legit first-joins go loading → joining → joined without
  // bouncing through 'already-joined'.
  if (authLoading || status === 'loading' || status === 'joining') {
    const label = status === 'joining' ? 'Joining game night...' : 'Loading...';
    return (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4 text-center">
          <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
          <p className="text-content-primary font-medium">{label}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="bg-surface-card rounded-card shadow-theme-md p-8 max-w-md w-full mx-4">

        {/* Preview state (unauthenticated) */}
        {status === 'preview' && eventInfo && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875S10.5 3.09 10.5 4.125c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.421 48.421 0 01-4.185-.408c-.009-.003-.018-.006-.028-.006A2.794 2.794 0 014.5 3.75 2.25 2.25 0 002.25 6v.776c0 .543.29 1.048.757 1.325a6.016 6.016 0 013.744 1.313c.178.165.424.262.681.262h8.136c.257 0 .503-.097.681-.262a6.016 6.016 0 013.744-1.313c.467-.277.757-.782.757-1.325V6a2.25 2.25 0 00-2.25-2.25 2.794 2.794 0 00-1.88 2.557c-.01 0-.019.003-.028.006a48.421 48.421 0 01-4.185.408.64.64 0 01-.657-.643v0zM12.75 16.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 18a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-content-primary mb-2">
              {eventInfo.game_name || 'Game Night'}
            </h1>
            <p className="text-content-muted mb-6">
              {formatEventDate(eventInfo.event_date)}
            </p>
            <a
              href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/game/${token}`)}`}
              className="btn btn-primary block w-full text-center"
            >
              Join Game Night
            </a>
            <p className="text-xs text-content-muted mt-4">
              Don&apos;t have an account? Signing in will create one automatically.
            </p>
          </div>
        )}

        {/* Joined state — D-INVITE-LANDING-01: welcome card + explicit
            "Go to event" button. NO auto-redirect, ever. */}
        {status === 'joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-success/10 rounded-full flex items-center justify-center">
              <span className="text-3xl" role="img" aria-label="game die">🎲</span>
            </div>
            <h1 className="text-2xl font-bold text-content-primary mb-2">
              You&apos;re in!
            </h1>
            {eventInfo && (
              <div className="mb-6 p-4 bg-surface-elevated rounded-lg">
                <p className="font-semibold text-content-primary">{eventInfo.game_name || 'Game Night'}</p>
                <p className="text-sm text-content-muted mt-1">{formatEventDate(eventInfo.event_date)}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => router.push(goToEventHref)}
              className="btn btn-primary block w-full text-center"
            >
              Go to event
            </button>
            <p className="text-xs text-content-muted mt-4">
              We&apos;ve added you to the participant list.
            </p>
          </div>
        )}

        {/* Already-joined state — D-INVITE-LANDING-02: distinct softer copy
            so the user knows the link wasn't broken. */}
        {status === 'already-joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              You&apos;re already in this game
            </h1>
            <p className="text-content-secondary mb-4">
              You joined earlier — see you there!
            </p>
            {eventInfo && (
              <div className="mb-6 p-4 bg-surface-elevated rounded-lg">
                <p className="font-semibold text-content-primary">{eventInfo.game_name || 'Game Night'}</p>
                <p className="text-sm text-content-muted mt-1">{formatEventDate(eventInfo.event_date)}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => router.push(goToEventHref)}
              className="btn btn-primary block w-full text-center"
            >
              Go to event
            </button>
          </div>
        )}

        {/* Expired state */}
        {status === 'expired' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-surface-elevated rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              Game Night Has Passed
            </h1>
            <p className="text-content-muted mb-6">
              This game night has already passed. Ask the organizer for an invite to the next one!
            </p>
            <Link
              href="/"
              className="btn btn-primary block w-full text-center"
            >
              Go Home
            </Link>
          </div>
        )}

        {/* Transient error — D-INVITE-LANDING-03 transient branch: inline
            error + Retry button. Network failures, 5xx, ambiguous errors. */}
        {status === 'error-transient' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              Couldn&apos;t join game night
            </h1>
            <p className="text-content-secondary mb-2">{error}</p>
            <p className="text-xs text-content-muted mb-6">
              Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="btn btn-primary block w-full text-center mb-2"
            >
              Retry
            </button>
            <Link
              href="/"
              className="block w-full text-center text-sm text-content-muted hover:text-content-secondary mt-2"
            >
              Go Home
            </Link>
          </div>
        )}

        {/* Permanent error — D-INVITE-LANDING-03 permanent branch: inline
            error + manual contact CTA. NO retry button — retrying won't fix
            an expired/full/deleted event. */}
        {status === 'error-permanent' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              This invite is no longer valid
            </h1>
            <p className="text-content-secondary mb-6">{error}</p>
            <p className="text-sm text-content-muted mb-6">
              Contact the group owner for a new invite link.
            </p>
            <Link
              href="/"
              className="btn btn-primary block w-full text-center"
            >
              Go Home
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}

export default GameInvitePage;
