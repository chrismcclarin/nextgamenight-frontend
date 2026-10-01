'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { groupsAPI } from '../../../../lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Heading';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

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

  /* AC-13 (owner ruling 2026-09-09, option 1) — the post-unmount write guard for the
     `autoJoin` effect, and the home of its redirect timer id.

     DECISION Phase 88.6-23 (AC-13): `autoJoin`'s guard is UNMOUNT-SCOPED (this ref), chosen
     OVER the per-effect-run `let cancelled = false` idiom the sibling
     `invite/game/[token]/page.js:69,74,77,100` uses and which the preview effect below DOES
     copy verbatim. The two effects need different guards because only this one carries the
     BUG-02 single-shot latch above, and that makes it NON-RETRYABLE:

       under React 18 StrictMode (dev) the effect mounts, is cleaned up, and mounts again. A
       per-run flag would mark run 1 cancelled while `joiningRef.current` — a ref, which
       SURVIVES the remount — makes run 2 return immediately. Run 1's join POST then resolves
       into a cancelled closure and writes nothing at all, and the page sits on "Joining…"
       forever. Measured, not reasoned: `page.test.tsx`'s StrictMode arm is red against the
       per-run form and green against this one.

     An unmount-scoped ref has no such hole: a re-run does not flip it, so the in-flight POST
     still lands, and a real unmount stops every write. It is ADDITIVE to the latch — the latch
     stops a second POST inside one page-load, this stops a write after the page is gone. */
  const unmountedRef = useRef(false);
  const redirectTimerRef = useRef(null);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  // Fetch group preview info (public, no auth needed)
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Invalid invite link');
      return;
    }

    // AC-13 (owner ruling 2026-09-09, option 1), applied here as the fourth magic-link page.
    // Idiom copied VERBATIM from the sibling `invite/game/[token]/page.js:69,74,77,100`:
    // `let cancelled = false`, an `if (cancelled) return` ahead of every post-resolve state
    // write, and a cleanup that sets it true. Additive — no shared hook, no util.
    let cancelled = false;

    async function fetchPreview() {
      try {
        const data = await groupsAPI.getInvitePreview(token);
        if (cancelled) return;
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
        if (cancelled) return;
        setStatus('error');
        setError('This invite link is no longer valid.');
      }
    }

    fetchPreview();
    return () => {
      cancelled = true;
    };
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

    /* AC-13, second half: the two `setTimeout(router.push, …)` ids are now STORED in
       `redirectTimerRef` so the unmount effect above can clear them. Before this they were
       stored nowhere at all and fired 1.5-2s after unmount, navigating a user who had already
       left the page. The guard and the timer clear are ADDITIVE to the BUG-02 latch above,
       not a replacement for it, and the dependency array below is BYTE-UNCHANGED — `status`
       stays omitted for the reason recorded there. */
    // User is logged in -- auto-join
    async function autoJoin() {
      setStatus('joining');
      try {
        const result = await groupsAPI.joinByToken(token);
        if (unmountedRef.current) return;
        if (result.already_member) {
          // GROUP-08: signal /userHome to refresh its groups list on next visit
          // even when the user was already a member (e.g., re-clicking an old link
          // after logging out/in elsewhere — list should still resync).
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('nggroups:refresh', '1');
          }
          setStatus('already-member');
          redirectTimerRef.current = setTimeout(() => {
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
          redirectTimerRef.current = setTimeout(() => {
            router.push(`/groupHomePage?id=${result.group_id || groupInfo.group_id}`);
          }, 1500);
        }
      } catch (err) {
        if (unmountedRef.current) return;
        setStatus('error');
        // R1 (SPEC DEF-88-25-01): the ratified register replaces the raw upstream text and the
        // hand-rolled "Failed to join group." fallback. MUTATION-path failure; the toast arm of
        // UI-SPEC §6.2 does not apply because this page IS the mutation and has no other
        // content whose context must be preserved, so the whole-page error branch is the
        // placement and the register supplies the words.
        setError(getFetchErrorMessage(err));
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
            <div className="mx-auto mb-4 w-16 h-16 bg-surface-accent-subtle-strong rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-accent-strong" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>

            <Heading level={1} size="display" className="text-content-primary mb-2">
              {groupInfo.group_name}
            </Heading>

            {groupInfo.group_description && (
              <p className="text-content-muted mb-3">
                {groupInfo.group_description}
              </p>
            )}

            <p className="text-sm text-content-muted mb-6">
              {groupInfo.member_count} member{groupInfo.member_count !== 1 ? 's' : ''}
            </p>

            {/* UI-SPEC §3.2 `asChild`: stays an `<a>` (Auth0 handoff needs a hard
                navigation), `href` byte-identical, surviving utilities on `<Button
                className>` and not on the slotted child. `block` is dead under unlayered
                `.btn`'s `display: inline-flex` (globals.css:2195). */}
            <Button asChild variant="primary" size="default" className="w-full text-center">
              <a
                href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/group/${token}`)}`}
              >
                Join {groupInfo.group_name}
              </a>
            </Button>

            <p className="text-xs text-content-muted mt-4">
              Don&apos;t have an account? Signing in will create one automatically.
            </p>
          </div>
        )}

        {/* Joining state */}
        {status === 'joining' && (
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4" />
            <p className="text-content-primary">Joining {groupInfo?.group_name || 'group'}...</p>
          </div>
        )}

        {/* Joined state */}
        {status === 'joined' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-success-subtle rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {/* h1 @ 20 STAYS at 20 (D-04 row 2): a mutually-exclusive STATUS branch, not the
                page title. Same level-vs-size split as `ErrorFallback`. */}
            <Heading level={1} size="heading" className="text-content-primary mb-2">
              You&apos;ve joined {groupInfo?.group_name || 'the group'}!
            </Heading>
            <p className="text-content-secondary">Redirecting to your group...</p>
          </div>
        )}

        {/* Already a member state */}
        {status === 'already-member' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-surface-accent-subtle-strong rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-accent-strong" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <Heading level={1} size="heading" className="text-content-primary mb-2">
              You&apos;re already a member of {groupInfo?.group_name || 'this group'}
            </Heading>
            <p className="text-content-secondary">Redirecting to your group...</p>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-error-subtle rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-content-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <Heading level={1} size="heading" className="text-content-primary mb-2">
              Unable to join group
            </Heading>
            <p className="text-content-secondary mb-6">{error}</p>
            <Button asChild variant="primary" size="default" className="w-full text-center">
              <Link href="/">
                Go Home
              </Link>
            </Button>
          </div>
        )}

      </Card>
    </div>
  );
}

export default GroupInvitePage;
