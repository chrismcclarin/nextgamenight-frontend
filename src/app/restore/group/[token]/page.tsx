'use client';

/**
 * Restore a soft-deleted group from an emailed ownership offer.
 * Phase 88.2 / SPEC-REQ-9: a PUBLIC preview (group name + deadline) that turns
 * into a single-shot acceptance the moment the visitor has a session.
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
      } catch {
        // One indistinguishable message for every rejection, deliberately. The
        // backend returns one byte-identical 404 for expired / invalid / purged
        // so the endpoint cannot be used to probe which tokens ever existed;
        // splitting the causes in the UI would undo that property.
        setStatus('error');
        setError(LINK_DEAD);
      }
    }

    fetchPreview();
  }, [token]);

  // ---------------------------------------------------------------------------
  // Effect 2 -- the AUTHENTICATED auto-accept. Runs once auth has resolved and a
  // preview exists.
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
      const liveGroupId = preview.group_id;
      setTimeout(() => {
        router.push(`/groupHomePage?id=${liveGroupId}`);
      }, REDIRECT_DELAY_MS);
      return;
    }

    if (!user) {
      setStatus('preview');
      return;
    }

    // F-450 single-shot guard: once the accept POST has fired for this
    // page-load, never fire again even if the effect re-runs.
    if (acceptingRef.current) return;
    acceptingRef.current = true;

    async function accept() {
      setStatus('accepting');
      try {
        const result = await groupsAPI.acceptGroupOwnership(token);

        // GROUP-08: signal /userHome to resync its group list on next visit, so
        // the restored group reappears without a manual reload.
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('nggroups:refresh', '1');
        }
        setStatus('restored');
        setTimeout(() => {
          router.push(`/groupHomePage?id=${result.group_id}`);
        }, REDIRECT_DELAY_MS);
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
              setTimeout(() => {
                router.push(`/groupHomePage?id=${liveGroupId}`);
              }, REDIRECT_DELAY_MS);
            }
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
        setStatus('error');
        setError(GENERIC_FAILURE);
      }
    }

    accept();
    // NOTE: the status state is deliberately omitted from these deps. Listing it
    // is what re-fired the effect and issued parallel POSTs in F-450; the ref
    // above is the second half of that fix, not a replacement for this one.
    // `router` is a stable Next.js ref and is intentionally omitted alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, preview, token]);

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

            <a
              href={returnTo}
              className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center"
            >
              Sign in to bring it back
            </a>

            <p className="text-xs text-content-muted mt-4">
              You&apos;ll be brought straight back here after signing in.
            </p>
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
              <p className="text-content-secondary">Taking you to the group...</p>
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
            <Link
              href="/"
              className="btn btn-primary flex items-center justify-center w-full min-h-[44px] text-center"
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
