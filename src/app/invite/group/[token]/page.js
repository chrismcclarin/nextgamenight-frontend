'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { groupsAPI } from '../../../../lib/api';
import { Card } from '@/components/ui/Card';

function GroupInvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading'); // loading | preview | joining | joined | already-member | error
  const [groupInfo, setGroupInfo] = useState(null);
  const [error, setError] = useState(null);

  // BUG-02 (F-450) single-shot guard — mirrors the game-invite fix
  // (invite/game/[token]/page.js:59). The previous implementation listed
  // `status` in the autoJoin effect deps, so setStatus('joining') re-fired
  // the effect and issued parallel joinByToken POSTs. The ref keeps the join
  // single-shot per page-load regardless of effect re-fires (React 18
  // strict-mode dev double-render included); belt-and-suspenders alongside
  // removing `status` from the dep array.
  const joiningRef = useRef(false);

  // Fetch group preview info (public, no auth needed)
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Invalid invite link');
      return;
    }

    async function fetchPreview() {
      try {
        const data = await groupsAPI.getInvitePreview(token);
        // F-190 infinite-load fix: a 2xx with an empty/falsy body would leave
        // `groupInfo` falsy forever, so the auth effect's `!groupInfo` guard
        // returns on every run and the page spins on 'loading' with no error
        // state. Treat a missing preview payload as a terminal error instead.
        if (!data) {
          setStatus('error');
          setError('This invite link is no longer valid.');
          return;
        }
        setGroupInfo(data);
      } catch (err) {
        setStatus('error');
        setError('This invite link is no longer valid.');
      }
    }

    fetchPreview();
  }, [token]);

  // Handle auth state after preview is loaded
  useEffect(() => {
    if (authLoading || !groupInfo) return;
    if (status === 'error') return;

    if (!user) {
      setStatus('preview');
      return;
    }

    // BUG-02 single-shot guard: once the join POST has fired for this
    // page-load, never fire again even if the effect re-runs.
    if (joiningRef.current) return;
    joiningRef.current = true;

    // User is logged in -- auto-join
    async function autoJoin() {
      setStatus('joining');
      try {
        const result = await groupsAPI.joinByToken(token);
        if (result.already_member) {
          // GROUP-08: signal /userHome to refresh its groups list on next visit
          // even when the user was already a member (e.g., re-clicking an old link
          // after logging out/in elsewhere — list should still resync).
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('nggroups:refresh', '1');
          }
          setStatus('already-member');
          setTimeout(() => {
            router.push(`/groupHomePage?id=${result.group_id || groupInfo.group_id}`);
          }, 2000);
        } else if (result.success) {
          // GROUP-08: signal /userHome to refresh its groups list on next visit
          // so the freshly-joined group appears without a manual reload.
          // ONBD-04: also flag this as an invited-source signup so the
          // tutorial uses the invited-branch handoff ("Set my availability")
          // instead of the cold-branch ("Invite your group"). Set AFTER
          // result.success — sessionStorage doesn't survive the Auth0 cross-
          // origin redirect (Pitfall 1 in 73-RESEARCH.md), so we stash it
          // post-join when the user is back on app origin. Self-deletes on
          // read in TutorialOverlay.
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('nggroups:refresh', '1');
            sessionStorage.setItem('ngtutorial:invitedSource', '1');
          }
          setStatus('joined');
          setTimeout(() => {
            router.push(`/groupHomePage?id=${result.group_id || groupInfo.group_id}`);
          }, 1500);
        }
      } catch (err) {
        setStatus('error');
        setError(err.message || 'Failed to join group.');
      }
    }

    autoJoin();
    // NOTE: `status` deliberately omitted from deps — its inclusion was the
    // root cause of the parallel-POST double-join (BUG-02 / F-450). `router`
    // is a stable Next.js ref and is intentionally omitted alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, groupInfo, token]);

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
      {/* PRIM-04 adoption: the group-info surface renders inside the shared Card
          primitive (elevated surface + semantic tokens). */}
      <Card className="p-8 max-w-md w-full mx-4 shadow-theme-md">

        {/* Preview state (unauthenticated) */}
        {status === 'preview' && groupInfo && (
          <div className="text-center">
            {/* Group icon */}
            <div className="mx-auto mb-4 w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-content-primary mb-2">
              {groupInfo.group_name}
            </h1>

            {groupInfo.group_description && (
              <p className="text-content-muted mb-3">
                {groupInfo.group_description}
              </p>
            )}

            <p className="text-sm text-content-muted mb-6">
              {groupInfo.member_count} member{groupInfo.member_count !== 1 ? 's' : ''}
            </p>

            <a
              href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/group/${token}`)}`}
              className="btn btn-primary block w-full text-center"
            >
              Join {groupInfo.group_name}
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
            <p className="text-content-primary font-medium">Joining {groupInfo?.group_name || 'group'}...</p>
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
              You&apos;ve joined {groupInfo?.group_name || 'the group'}!
            </h1>
            <p className="text-content-secondary">Redirecting to your group...</p>
          </div>
        )}

        {/* Already a member state */}
        {status === 'already-member' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              You&apos;re already a member of {groupInfo?.group_name || 'this group'}
            </h1>
            <p className="text-content-secondary">Redirecting to your group...</p>
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
              Unable to join group
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

      </Card>
    </div>
  );
}

export default GroupInvitePage;
