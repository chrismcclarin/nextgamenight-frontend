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
import { StatusRegion } from '@/components/ui/StatusRegion';

// The page region's test handle. NOT EXPORTED, deliberately, for the reason the rsvp page records
// (`rsvp/[token]/page.js`, anchor `NOT EXPORTED, deliberately`): Next's generated route types reject
// a page module's non-route named exports. The test re-declares the literal.
const PAGE_STATUS_TESTID = 'group-invite-page-status';

// Copy row L1 (D-30, owner-ratified 2026-10-04), byte-equal to this route's own `loading.tsx` label.
const LOADING_LABEL = 'Loading your group invite...';

// Strings this page already rendered before plan 88.6.1-19, hoisted so the branch markup and the
// screen-reader announcement read ONE source and cannot drift apart (no new words, D-31).
const REDIRECTING_DETAIL = 'Redirecting to your group...';
const JOIN_ERROR_HEADLINE = 'Unable to join group';
const INVALID_LINK_DETAIL = 'This invite link is no longer valid.';

/** Join the non-empty parts of an announcement with one space (never a trailing space). */
function joinParts(...parts) {
  return parts.filter(Boolean).join(' ');
}

function GroupInvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading'); // loading | preview | joining | joined | already-member | error
  const [groupInfo, setGroupInfo] = useState(null);
  const [error, setError] = useState(null);

  // BUG-02 (F-450) single-shot guard — mirrors the game-invite fix
  // (invite/game/[token]/page.js, anchor `const joiningRef = useRef(false);`). The previous implementation listed
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
     `invite/game/[token]/page.js` preview effect uses (anchor `let cancelled = false;`) and which the preview effect below DOES
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
    // Idiom copied VERBATIM from the sibling `invite/game/[token]/page.js` preview effect (anchor
    // `let cancelled = false;`):
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
          setError(INVALID_LINK_DETAIL);
          return;
        }
        setGroupInfo(data);
      } catch (err) {
        if (cancelled) return;
        /* DECISION Phase 88.6.1-19 (SPEC Prohibition 2): the preview route's ONLY 404
           (`periodictabletopbackend_v2/Sonnet/routes/groups.js`, anchor `Invalid invite link`) keeps
           this page's own invalid-link sentence; EVERY other failure shows the shared register line,
           read through the same `getFetchErrorMessage` call this page's join catch below already makes.
           REJECTED: the old blanket sentence for every failure — false when the request failed: a
           network drop, a 429 or a 5xx told the holder of a VALID link that it was dead.
           REJECTED: a Retry control on this branch — a new visible control is a look change
           (Phase 88.9's charter), and the register line already says what to do.
           Calling a failed request an invalid link again is a decision, not a cleanup. */
        setStatus('error');
        setError(err?.status === 404 ? INVALID_LINK_DETAIL : getFetchErrorMessage(err));
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
          // result.success, because the flags record a join that HAS happened.
          // Corrected Phase 88.6.1-19 (RESEARCH MC-6): an earlier note here said
          // session storage does not survive the Auth0 cross-origin redirect. It
          // does — the WHATWG Storage Standard holds session storage per tab, so
          // it survives a same-tab round trip through Auth0. The placement stands
          // on its own reason above. Self-deletes on read in TutorialOverlay.
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

  // Render values shared by the branch markup AND the announcement below — one source each, with
  // the same fallbacks the markup has always used.
  const memberCountLine = groupInfo
    ? `${groupInfo.member_count} member${groupInfo.member_count !== 1 ? 's' : ''}`
    : '';
  const joinedHeadline = `You've joined ${groupInfo?.group_name || 'the group'}!`;
  const alreadyMemberHeadline = `You're already a member of ${groupInfo?.group_name || 'this group'}`;

  // The announcement MIRRORS the render dispatch below, in order, so it can never describe a
  // branch other than the one on screen. Loading and joining yield '' — the region must be
  // mounted and empty first, or there is no CHANGE for a screen reader to announce.
  const isLoading = authLoading || status === 'loading';
  let announcement = '';
  if (isLoading) {
    announcement = '';
  } else if (status === 'preview' && groupInfo) {
    announcement = joinParts(groupInfo.group_name, memberCountLine);
  } else if (status === 'joining') {
    announcement = '';
  } else if (status === 'joined') {
    announcement = joinParts(joinedHeadline, REDIRECTING_DETAIL);
  } else if (status === 'already-member') {
    announcement = joinParts(alreadyMemberHeadline, REDIRECTING_DETAIL);
  } else if (status === 'error') {
    announcement = joinParts(JOIN_ERROR_HEADLINE, error);
  }

  let body;
  if (isLoading) {
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
                {memberCountLine}
              </p>

              {/* UI-SPEC §3.2 `asChild`: stays an `<a>` (Auth0 handoff needs a hard
                  navigation), `href` byte-identical, surviving utilities on `<Button
                  className>` and not on the slotted child. `block` is dead under unlayered
                  `.btn`'s `display: inline-flex` (globals.css, anchor `.btn {`). */}
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
                <svg className="w-8 h-8 text-content-status-success" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              {/* h1 @ 20 STAYS at 20 (D-04 row 2): a mutually-exclusive STATUS branch, not the
                  page title. Same level-vs-size split as `ErrorFallback`. */}
              <Heading level={1} size="heading" className="text-content-primary mb-2">
                {joinedHeadline}
              </Heading>
              <p className="text-content-secondary">{REDIRECTING_DETAIL}</p>
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
                {alreadyMemberHeadline}
              </Heading>
              <p className="text-content-secondary">{REDIRECTING_DETAIL}</p>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="text-center">
              <div className="mx-auto mb-4 w-16 h-16 bg-status-error-subtle rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-content-status-error" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <Heading level={1} size="heading" className="text-content-primary mb-2">
                {JOIN_ERROR_HEADLINE}
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

  /* DECISION Phase 88.6.1-19 (R8): ONE always-mounted `StatusRegion` at FRAGMENT SLOT 0, rendered
     from this component and never from inside a branch — ported from `DECISION Phase 88.6-24`
     (`rsvp/[token]/page.js`) and `DECISION Phase 88.6-23` (`availability-form/[token]/page.js`),
     not re-invented. React reconciles same-type children by index, so the region is the SAME DOM
     node across every branch flip and each outcome lands as a change to it.

     REJECTED (1) — a region inside each branch: mounted together with its text, a polite region
     announces nothing (D-42 keeps that premise for polite/status regions).
     REJECTED (2) — hoisting the shared outer wrapper: both roots happen to share a className here,
     but a fragment adds no box and matches both shipped siblings.
     REJECTED (3) — a route layout: a server-rendered shell cannot read this client page's state.

     sr-only, because the region repeats a heading that is already on screen. D-22's opt-in
     empty-state prop is NOT adopted: this region is always sr-only (ST-2 group A).
     NO FOCUS MOVE on this page: nothing the user operated is removed — the join runs on load (the
     availability-form ERROR-flip rule).
     The preview announcement leaves out the optional owner-written description (free text of any
     length); the name and the member count say what the page is.
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

export default GroupInvitePage;
