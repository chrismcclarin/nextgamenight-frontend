'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { eventsAPI } from '../../../../lib/api';

function GameInvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading'); // loading | preview | joining | joined | already-joined | expired | error
  const [eventInfo, setEventInfo] = useState(null);
  const [error, setError] = useState(null);

  // Fetch event preview info (public, no auth needed)
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Invalid invite link');
      return;
    }

    async function fetchPreview() {
      try {
        const data = await eventsAPI.getEventInvitePreview(token);
        setEventInfo(data);
      } catch (err) {
        // Check for expired event (410 status)
        if (err.message && (err.message.includes('expired') || err.message.includes('passed'))) {
          // Try to get partial event info from error context
          setStatus('expired');
        } else {
          setStatus('error');
          setError('This invite link is no longer valid.');
        }
      }
    }

    fetchPreview();
  }, [token]);

  // Handle auth state after preview is loaded
  useEffect(() => {
    if (authLoading) return;
    if (status === 'error') return;

    // For expired events, just show the expired state (even if preview loaded)
    if (status === 'expired') return;

    if (!eventInfo) return;

    if (!user) {
      setStatus('preview');
      return;
    }

    // User is logged in -- auto-join
    async function autoJoin() {
      setStatus('joining');
      try {
        const result = await eventsAPI.joinGameByToken(token);
        if (result.already_joined) {
          setStatus('already-joined');
        } else if (result.success) {
          setStatus('joined');
        }
      } catch (err) {
        setStatus('error');
        setError(err.message || 'Failed to join game night.');
      }
    }

    autoJoin();
  }, [authLoading, user, eventInfo, status, token, router]);

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

  // Loading state
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

        {/* Preview state (unauthenticated) */}
        {status === 'preview' && eventInfo && (
          <div className="text-center">
            {/* Game icon */}
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

        {/* Joining state */}
        {status === 'joining' && (
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
            <p className="text-content-primary font-medium">Joining game night...</p>
          </div>
        )}

        {/* Joined state */}
        {status === 'joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-success/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              You&apos;re in!
            </h1>
            <p className="text-content-secondary mb-1">
              You&apos;ve joined the game night.
            </p>
            {eventInfo && (
              <div className="mt-4 p-4 bg-surface-elevated rounded-lg">
                <p className="font-semibold text-content-primary">{eventInfo.game_name || 'Game Night'}</p>
                <p className="text-sm text-content-muted">{formatEventDate(eventInfo.event_date)}</p>
              </div>
            )}
          </div>
        )}

        {/* Already joined state */}
        {status === 'already-joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              You&apos;re already signed up for this game night
            </h1>
            {eventInfo && (
              <div className="mt-4 p-4 bg-surface-elevated rounded-lg">
                <p className="font-semibold text-content-primary">{eventInfo.game_name || 'Game Night'}</p>
                <p className="text-sm text-content-muted">{formatEventDate(eventInfo.event_date)}</p>
              </div>
            )}
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

        {/* Error state */}
        {status === 'error' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              Unable to join game night
            </h1>
            <p className="text-content-secondary mb-6">{error}</p>
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
