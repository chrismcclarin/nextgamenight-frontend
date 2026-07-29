'use client';

/**
 * Restore a soft-deleted group from an emailed ownership offer.
 * Phase 88.2 / SPEC-REQ-9: a PUBLIC preview (group name + deadline) plus a
 * single-shot acceptance a signed-in visitor triggers with one explicit tap.
 *
 * DECISION Phase 88.2 M-3 (owner, 2026-07-27): explicit "Take over this group"
 * button for signed-in visitors, chosen OVER firing the acceptance POST
 * automatically on page load. The acceptance is irreversible and consumes the
 * ONE nonce fanned to every member, so a curiosity tap on the emailed link must
 * not transfer ownership by itself; the logged-out path already required an
 * explicit action, and now both paths do. Still single-shot per D-02 — the tap
 * makes it intentional, the state machine is unchanged.
 *
 * The route path is fixed by the backend: routes/groups.js builds the emailed
 * link as `${FRONTEND_URL}/restore/group/${nonce}`, so this directory name is a
 * cross-repo contract. Renaming either side 404s every offer email already sent,
 * and neither repo's CI can see the other.
 *
 * DECISION Phase 88.2 D-02: a NEW route was chosen OVER extending
 * `src/app/invite/group/[token]/page.js`. That page auto-JOINS on auth; this one
 * auto-ACCEPTS OWNERSHIP and restores deleted data. Grafting a second auto-action
 * with different semantics onto one file and one state machine is exactly how the
 * F-450 parallel-POST double-join happened. For the same reason the two guards
 * below are deliberately COPIED, not extracted into a shared hook: the duplication
 * is the point, because the two flows must be able to diverge without breaking
 * each other. Removing either guard reintroduces a named, already-fixed bug --
 * F-450 (parallel state-changing POSTs from an effect re-fire) for the ref, and
 * F-190 (a 2xx with an empty body spinning on the loading state forever) for the
 * falsy-payload check. This page also deliberately discloses LESS than the invite
 * preview does: an invite link is meant to reach non-members and earns its
 * disclosure; a restore link only ever goes to people who were already in the
 * group, so a richer public preview buys no reach and only widens what a
 * forwarded link leaks.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { groupsAPI, ApiError, type RestorePreview } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { formatLongDate } from '@/lib/datetime';

type Status =
  | 'loading'
  | 'preview'
  | 'accepting'
  | 'restored'
  | 'already-restored'
  | 'error';

/** Matches the invite page's post-success dwell before it hands off. */
const REDIRECT_DELAY_MS = 1500;

/**
 * The weaker of the two terminal messages. Used for every failure the client
 * cannot attribute -- including a 410 whose cause code is missing or unknown.
 * It says nothing about what happened to the group, because the client does not
 * know, and guessing is how the wrong message ships.
 */
const LINK_DEAD = 'This restore link is no longer valid.';

/** The ONE case where the data really is gone: the recovery window closed. */
const WINDOW_EXPIRED =
  "This link has expired. The group's 30-day recovery window ended and its data was erased.";

const NOT_A_MEMBER = "You're not a member of this group, so you can't take it over.";

const GENERIC_FAILURE = 'Something went wrong bringing this group back. Please try again.';

/**
 * R-4: the acceptance came back 401 — the visitor's Auth0 session expired
 * between page load and the tap (the take-over button can sit on screen for
 * hours). The remedy is signing back in, not trying again.
 */
const SESSION_EXPIRED =
  'Your sign-in session has expired. Sign back in and you can pick up right where you left off.';

/**
 * M-6: the RETRYABLE preview failure — network blip, 5xx, misconfig. Distinct
 * from LINK_DEAD on purpose: the backend's byte-identical 404 is the only
 * signal that the token itself was rejected, and telling a member on a flaky
 * phone connection that their one recovery link is dead is how a recoverable
 * group actually dies. Anti-probing is preserved — the 404 causes stay
 * unsplit; this only separates "the server said no" from "we never heard back".
 */
const PREVIEW_UNAVAILABLE =
  "We couldn't check this link. It may be a connection problem — please try again.";

/**
 * Read the live group's id off a raw error body.
 *
 * The accept endpoint's 409 body is RAW (`{ error, code, group_id }`), NOT a
 * Phase 85 envelope, and `apiFetch` stores the whole parsed body at
 * `ApiError.details` (typed `unknown`). So this reads one level down, not two.
 * Do NOT reroute it through the envelope accessor in `@/lib/api` -- that one
 * reads a nested payload, which is correct for an envelope and `undefined` here,
 * and it fails SILENTLY: the state renders, the redirect never fires, and
 * nothing errors anywhere.
 */
function readGroupId(details: unknown): string | null {
  if (details && typeof details === 'object' && 'group_id' in details) {
    const id = (details as { group_id?: unknown }).group_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

function RestoreGroupPage() {
  const params = useParams();
  const rawToken = params?.token;
  // useParams() is `string | string[] | undefined` per segment. Narrow it
  // explicitly rather than asserting -- a catch-all rename upstream would
  // otherwise become a runtime crash instead of the terminal error state.
  const token =
    typeof rawToken === 'string' ? rawToken : Array.isArray(rawToken) ? (rawToken[0] ?? '') : '';

  const router = useRouter();
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState<Status>('loading');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // M-6 / R-3 / R-4: which affordance the terminal error renders alongside its
  // copy. 'preview-retry' re-runs the public preview; 'accept-retry' re-fires
  // the acceptance (the backend contract is retry-safe — a re-POST lands on
  // 200, 409 or 410, all handled below); 'sign-in' offers the login round-trip
  // for an expired session. null = a true rejection with no way back.
  const [recovery, setRecovery] = useState<
    'preview-retry' | 'accept-retry' | 'sign-in' | null
  >(null);
  // M-6: bumped by the Try-again button to re-run the preview effect.
  const [attempt, setAttempt] = useState(0);
  // M-7 / L-3: where the already-restored hand-off is going. 'group' = into the
  // live group, 'home' = the visitor's groups list (membership fetch refused —
  // forwarded link / different account), 'link-only' = no destination id at all
  // (409 without a parseable group_id), so render a link instead of promising a
  // redirect that was never scheduled.
  const [handoff, setHandoff] = useState<'group' | 'home' | 'link-only' | null>(null);

  // F-450 single-shot guard, copied from invite/group/[token]/page.js. Once the
  // acceptance POST has fired for this page-load it never fires again, whatever
  // the effect does -- React 18 strict-mode's dev double-invoke included. This is
  // belt-and-braces ALONGSIDE keeping the status state out of the effect deps
  // below; listing it there was the root cause of the original parallel POSTs.
  // Duplicate acceptances are precisely what D-04 exists to prevent: the
  // backend's row lock would hold, but the loser returns 409 and the person who
  // clicked once sees a failure they did not cause.
  const acceptingRef = useRef(false);
  // Same shape of guard for the already-restored hand-off, so a re-render cannot
  // stack redirect timers.
  const redirectRef = useRef(false);
  // L-3: the ONE pending redirect timer, so unmount can clear it — without this
  // a visitor who navigates away during the dwell is yanked to the destination
  // anyway. Only one redirect ever schedules per page-load (both schedulers are
  // ref-guarded), so a single slot is enough.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // R-1: both schedulers run AFTER an await, so a visitor can navigate away
  // while the fetch is still in flight — the unmount cleanup then runs BEFORE
  // the timer exists, and the continuation would install a timer nothing can
  // clear. This flag lets scheduleRedirect refuse to schedule at all after
  // unmount, closing the gap L-3's clearTimeout alone cannot cover.
  const unmountedRef = useRef(false);

  useEffect(() => {
    // Reset on mount: strict-mode's dev mount-unmount-remount cycle would
    // otherwise leave the flag stuck true and silently kill every redirect.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  /**
   * L-3 / R-1: every redirect goes through here, so the timer is always
   * clearable — and never scheduled in the first place once the page has
   * unmounted.
   */
  function scheduleRedirect(path: string) {
    if (unmountedRef.current) return;
    redirectTimerRef.current = setTimeout(() => {
      router.push(path);
    }, REDIRECT_DELAY_MS);
  }

  /**
   * M-7: hand off into the live group ONLY if this account can actually open
   * it. GET /groups/:id is membership-gated (403 for a non-member), so a
   * successful fetch proves /groupHomePage will render rather than park the
   * visitor on its eternal loading state — the forwarded-link /
   * different-account case. Refused or failed, the hand-off goes to the home
   * groups list instead (there is no /userHome route — the list renders at /).
   */
  async function routeToLiveGroup(liveGroupId: string) {
    try {
      await groupsAPI.getGroup(liveGroupId);
      setHandoff('group');
      scheduleRedirect(`/groupHomePage?id=${liveGroupId}`);
    } catch (err) {
      // R-2: only an actual REFUSAL proves the visitor is not a member. A
      // network drop or a 5xx here says nothing about membership — and this
      // sits on the page's most common path, on a phone — so those hand off
      // to the group, which carries its own retry surfaces. Routing them to
      // the groups list on a dropped packet strands a genuine member.
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setHandoff('home');
        scheduleRedirect('/');
        return;
      }
      setHandoff('group');
      scheduleRedirect(`/groupHomePage?id=${liveGroupId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Effect 1 -- the PUBLIC preview. Uses publicFetch and runs before the auth
  // check, so it must work for a logged-out visitor. An emailed link is opened
  // logged-out far more often than not.
  //
  // (Note for future editors: the TypeScript escape-hatch keyword -- the
  // three-letter one meaning "give up on the type" -- is deliberately absent
  // from this file's PROSE as well as its code. An acceptance criterion greps
  // the whole file for it as proof the escape hatch was never used, so writing
  // it in plain English reds the criterion on correct code. That is the
  // comment-inflates-the-grep trap this phase hit five times.)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError(LINK_DEAD);
      return;
    }

    async function fetchPreview() {
      try {
        const data = await groupsAPI.getRestorePreview(token);

        // F-190 guard, copied verbatim in intent from the invite page: a 2xx
        // with a falsy body leaves the preview state falsy forever, the accept
        // effect's data guard returns on every run, and the page spins on
        // 'loading' with no error state and no way forward. Terminal error.
        if (!data) {
          setStatus('error');
          setError(LINK_DEAD);
          return;
        }

        setPreview(data);

        if (data.status === 'already_restored') {
          // The MAJORITY case, not an edge case: the backend mints ONE nonce and
          // fans the same link to every remaining member, so every recipient
          // after the first arrives here. A success from the visitor's point of
          // view -- the group is healthy again -- so it gets its own state and
          // must never render as an error. The hand-off into the group is done
          // by Effect 2, and ONLY for a signed-in visitor.
          setStatus('already-restored');
        }
      } catch (err) {
        // M-6: only an actual REJECTION gets the terminal LINK_DEAD copy. The
        // backend returns one byte-identical 404 for expired / invalid / purged
        // so the endpoint cannot be used to probe which tokens ever existed;
        // those causes stay unsplit here. But a network failure or 5xx is not a
        // rejection — the phone in the kitchen just dropped a packet — and it
        // gets retryable copy plus a Try-again button instead of a dead end.
        if (err instanceof ApiError && err.status === 404) {
          setStatus('error');
          setError(LINK_DEAD);
          return;
        }
        setStatus('error');
        setError(PREVIEW_UNAVAILABLE);
        setRecovery('preview-retry');
      }
    }

    fetchPreview();
  }, [token, attempt]);

  /** M-6: re-run the preview fetch after a retryable failure. */
  function retryPreview() {
    setRecovery(null);
    setError(null);
    setStatus('loading');
    setAttempt((a) => a + 1);
  }

  /** R-3: re-fire the acceptance after a retryable failure (unlatched below). */
  function retryAccept() {
    setRecovery(null);
    setError(null);
    handleTakeOver();
  }

  // ---------------------------------------------------------------------------
  // Effect 2 -- resolve which surface the visitor gets once auth has settled and
  // a preview exists. Since M-3 this effect never fires the acceptance POST --
  // that lives in handleTakeOver, behind an explicit tap.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (authLoading || !preview) return;

    if (preview.status === 'already_restored') {
      // Redirect ONLY when useUser has resolved a signed-in visitor. A logged-out
      // one stays here and gets a sign-in CTA instead: /groupHomePage has no
      // route-level auth guard and gates its whole render on a membership check
      // that returns early without a session, so sending a logged-out visitor
      // there parks them on a loading state forever -- no error, no CTA, no way
      // forward. Since one nonce is fanned to every member, that would be the
      // single most common path through this page.
      if (!user) return;
      if (redirectRef.current) return;
      redirectRef.current = true;
      // M-7: membership-gated hand-off -- a signed-in NON-member (forwarded
      // link, different account) goes to the home groups list, not into a page
      // that will never render for them.
      routeToLiveGroup(preview.group_id);
      return;
    }

    // Live offer: BOTH auth states land on the preview surface. A signed-in
    // visitor gets the explicit take-over button (M-3); a logged-out one gets
    // the sign-in CTA. Guard on acceptingRef so an effect re-run (new user
    // object identity, strict-mode double-invoke) cannot yank the status back
    // to 'preview' mid-acceptance.
    if (acceptingRef.current) return;
    setStatus('preview');
    // NOTE: the status state is deliberately omitted from these deps. Listing it
    // is what re-fired the effect and issued parallel POSTs in F-450; the refs
    // above are the second half of that fix, not a replacement for this one.
    // `router` is a stable Next.js ref and is intentionally omitted alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, preview, token]);

  /**
   * M-3: the acceptance, fired by the explicit button. F-450's single-shot
   * guard now doubles as double-tap protection -- once this has fired for this
   * page-load it never fires again, and the button also disables via status.
   */
  async function handleTakeOver() {
    if (acceptingRef.current) return;
    acceptingRef.current = true;

    setStatus('accepting');
    try {
      const result = await groupsAPI.acceptGroupOwnership(token);

      // GROUP-08: signal the home page to resync its group list on next visit,
      // so the restored group reappears without a manual reload.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('nggroups:refresh', '1');
      }
      setStatus('restored');
      scheduleRedirect(`/groupHomePage?id=${result.group_id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          // The concurrent loser: another member's acceptance won the row lock
          // between this page's preview and its POST. Same event, same state
          // and same copy as the Effect 1 path above -- they differ only in
          // whether it happened before or after this page previewed.
          const liveGroupId = readGroupId(err.details);
          setStatus('already-restored');
          if (liveGroupId) {
            // M-7: same membership-gated hand-off as the preview path.
            routeToLiveGroup(liveGroupId);
          } else {
            // L-3: no destination id means no timer is ever scheduled -- say so
            // with a link instead of a "Taking you to the group..." that never
            // goes anywhere.
            setHandoff('link-only');
          }
          return;
        }
        if (err.status === 401) {
          // R-4: an expired Auth0 session surfaces here as a 401 from the
          // BFF's tokenless forward. useUser still reports the stale user, so
          // without this arm the failure reads as generic and the one real
          // remedy — signing back in, with returnTo landing right back on
          // this page — is never offered.
          acceptingRef.current = false;
          setStatus('error');
          setError(SESSION_EXPIRED);
          setRecovery('sign-in');
          return;
        }
        if (err.status === 403) {
          setStatus('error');
          setError(NOT_A_MEMBER);
          return;
        }
        if (err.status === 410) {
          // Split by CAUSE, not by status. Three different codes land on 410
          // and only one of them means the group is gone; the fallback is
          // always the weaker message, never the destructive claim.
          setStatus('error');
          setError(err.code === 'window_expired' ? WINDOW_EXPIRED : LINK_DEAD);
          return;
        }
      }
      // R-3: the single-shot latch guards against DOUBLE-fires, not retries.
      // Leaving it latched here turned "Please try again" into a lie — the
      // copy promised a retry the stuck state machine could never deliver.
      // Unlatch on the retryable failures only (network, 5xx, and the 401
      // above); the 403/409/410 arms stay terminal and latched.
      acceptingRef.current = false;
      setStatus('error');
      setError(GENERIC_FAILURE);
      setRecovery('accept-retry');
    }
  }

  const groupName = preview?.group_name ?? 'this group';
  const deadline =
    preview && preview.status === undefined ? formatLongDate(preview.purge_after) : '';
  const returnTo = `/api/auth/login?returnTo=${encodeURIComponent(`/restore/group/${token}`)}`;

  if (authLoading || status === 'loading') {
    return (
      <div className="min-h-screen bg-surface-page flex items-center justify-center">
        <div className="bg-surface-card rounded-card shadow-theme-md p-6 sm:p-8 max-w-md w-full mx-4 text-center">
          <div
            role="status"
            aria-label="Loading"
            className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4"
          />
          <p className="text-content-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      {/* Phone-forward: one column, the shared Card at max-w-md with a 375px-safe
          gutter, every control full-width and at least 44px tall. */}
      <Card className="p-6 sm:p-8 max-w-md w-full mx-4 shadow-theme-md">

        {/* Public preview (logged out). D-02: the group name and the deadline,
            and nothing else. */}
        {status === 'preview' && preview && preview.status === undefined && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </div>

            <p className="text-sm text-content-muted mb-1">Bring this group back</p>
            <h1 className="text-2xl font-bold text-content-primary mb-3 break-words">
              {preview.group_name}
            </h1>

            {deadline && (
              <p className="text-content-secondary mb-6">
                It was deleted, but you can restore it and take over as owner until{' '}
                <strong className="text-content-primary">{deadline}</strong>.
              </p>
            )}

            {user ? (
              // M-3 (owner, 2026-07-27): explicit consent. The tap, not the
              // page load, is what transfers ownership.
              <button
                type="button"
                onClick={handleTakeOver}
                className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center"
              >
                Take over this group
              </button>
            ) : (
              <>
                <a
                  href={returnTo}
                  className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center"
                >
                  Sign in to bring it back
                </a>

                <p className="text-xs text-content-muted mt-4">
                  You&apos;ll be brought straight back here after signing in.
                </p>
              </>
            )}
          </div>
        )}

        {/* Accepting */}
        {status === 'accepting' && (
          <div className="text-center">
            <div
              role="status"
              aria-label="Loading"
              className="inline-block w-8 h-8 border-4 border-line border-t-accent rounded-full animate-spin mb-4"
            />
            <p className="text-content-primary font-medium">Bringing back {groupName}...</p>
          </div>
        )}

        {/* Restored */}
        {status === 'restored' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-success/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2 break-words">
              {groupName} is back
            </h1>
            <p className="text-content-secondary">
              You&apos;re the owner now. Taking you to the group...
            </p>
          </div>
        )}

        {/* Already restored -- reached from the preview (the common case) and
            from a 409 (the concurrent loser). A success, not a failure. */}
        {status === 'already-restored' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-success/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              Someone else already brought this group back
            </h1>
            <p className="text-content-secondary mb-6">
              Nothing to do -- {groupName} is up and running again.
            </p>

            {user ? (
              handoff === 'link-only' ? (
                // L-3: no destination id ever arrived, so no redirect was
                // scheduled -- offer the way forward instead of implying one.
                <Link
                  href="/"
                  className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center"
                >
                  Open your groups
                </Link>
              ) : (
                // R-7: while the membership probe is still in flight (handoff
                // null), promise nothing — the copy otherwise says "Taking you
                // to the group" and then flips mid-read for a non-member.
                <p className="text-content-secondary">
                  {handoff === null
                    ? 'One moment...'
                    : handoff === 'home'
                      ? 'Taking you to your groups...'
                      : 'Taking you to the group...'}
                </p>
              )
            ) : (
              <>
                <a
                  href={returnTo}
                  className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center"
                >
                  Sign in to open it
                </a>
                <p className="text-xs text-content-muted mt-4">
                  You&apos;ll be brought straight back here after signing in.
                </p>
              </>
            )}
          </div>
        )}

        {/* Terminal error */}
        {status === 'error' && (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-content-primary mb-2">
              Unable to restore this group
            </h1>
            <p className="text-content-secondary mb-6">{error}</p>
            {(recovery === 'preview-retry' || recovery === 'accept-retry') && (
              // M-6 / R-3: a retryable failure gets a way back, not a dead end.
              <button
                type="button"
                onClick={recovery === 'preview-retry' ? retryPreview : retryAccept}
                className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center mb-3"
              >
                Try again
              </button>
            )}
            {recovery === 'sign-in' && (
              // R-4: the expired-session 401 — the remedy is the login
              // round-trip, which lands right back on this page.
              <a
                href={returnTo}
                className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center mb-3"
              >
                Sign in to try again
              </a>
            )}
            <Link
              href="/"
              className={`btn ${recovery ? 'btn-secondary' : 'btn-primary'} flex items-center justify-center w-full min-h-[44px] text-center`}
            >
              Go Home
            </Link>
          </div>
        )}

      </Card>
    </div>
  );
}

export default RestoreGroupPage;
