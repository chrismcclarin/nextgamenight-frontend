'use client';

/**
 * useSignInRedirect — the ONE latched sign-in guard for every protected page.
 *
 * DECISION Phase 88.9-40 (SESSION-01, owner ruling 2026-11-07 8:29 PM Pacific; SPEC A8): ONE sign-in
 * guard for every protected page — a latched window.location.replace to the house sign-in URL
 * (src/lib/signIn.ts, returnTo from window.location only), the latch one sessionStorage key per
 * path + search, read and written fail-closed, cleared only by an answer that proves the session.
 * Chosen OVER withPageAuthRequired (it redirects only a visitor with no user, so a live cookie whose
 * token the backend rejects would 401 with no way out; it uses location.assign, which leaves a Back
 * entry that redirects again; it has no latch to bound a repeat) and OVER a hand-rolled effect per
 * page (two such idioms already disagreed, COPY-CENSUS K9). The signed-out arm is for pages whose
 * reads wait on a user; a page whose reads run signed-out decides on the read's 401 (gameDetail). A
 * useUser() error is not signed out: the hook returns sessionError and each page with a signed-out
 * arm shows ErrorFallback with Reload, chosen OVER redirecting (offline, the login route is
 * unreachable too; a 500 on /api/auth/me is the 2026-08-28 incident shape, where login fails as
 * well) and OVER the signed-out prompt. The hook files no report for it: a 500 is logged
 * server-side, status 0 is the visitor's own network, and userProfile keeps its DECISION Phase
 * 88.6-17 breadcrumb. A 401 after a round trip files ONE logger.warn (path only) — owner ruling
 * 88.9-RULINGS.md R-F3, 2026-11-08, the F1 / O-05 level for a failure whose breadcrumb never leaves
 * the browser — chosen OVER silence and over logger.info (api.ts's generic catch already leaves that
 * breadcrumb, F1-4b, and nothing else carries it out). On groupHomePage the decision is per mount:
 * after a 'declined', a client-side switch to another group shows that group's banner with Sign in
 * rather than redirecting. Accepted (owner, 2026-11-08, 88.9-RULINGS.md R-F4): shipped groupHomePage
 * never redirects; a reset in its fetch effect can leave the hold up forever. Removing the latch or
 * the auth-settled gate is a decision, not a cleanup.
 *
 * The latch helpers are lifted from gameDetail's 88.6.1-25 (D-01) trio, with their rule: every
 * helper is FAIL-CLOSED — a storage call that throws reads as "latch already set" (banner, never a
 * redirect) and a write that throws reports failure, so blocked storage can never produce a
 * redirect loop (RESEARCH P-4). None of them logs. SDK 3.8.0 leaves `user` undefined and sets
 * `error` when /api/auth/me fails (RequestError(0) offline, RequestError(<status>) otherwise); a 204
 * is the only signed-out answer — node_modules:@auth0/nextjs-auth0/dist/client/use-user.js ("if (response.status == 204)").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { buildSignInUrl } from '@/lib/signIn';
import {
  useFetchErrorState,
  type FetchErrorSource,
  type FetchErrorState,
} from '@/components/ui/useFetchErrorState';

// The in-repo `ng<feature>:<purpose>` key convention (src/app/page.js, 'nggroups:refresh').
const SIGN_IN_LATCH_PREFIX = 'ngauth:signinRedirect:';

/**
 * The latch key for a location: one per path + search. The hash is excluded because it never
 * changes which page loads.
 */
export function signInLatchKey(loc: Pick<Location, 'pathname' | 'search'>): string {
  return SIGN_IN_LATCH_PREFIX + loc.pathname + loc.search;
}

type LatchRead = 'set' | 'clear' | 'unreadable';

// A throw is 'unreadable', which counts as set (fail-closed).
function readLatch(key: string): LatchRead {
  try {
    return window.sessionStorage.getItem(key) !== null ? 'set' : 'clear';
  } catch {
    return 'unreadable';
  }
}

// A throw returns false: the caller declines instead of navigating.
function writeLatch(key: string): boolean {
  try {
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

function removeLatch(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to do: a latch that cannot be removed only means one more banner, never a loop.
  }
}

export type SignInDecision = 'idle' | 'redirecting' | 'declined';

/** Why a sign-in is being requested; it decides only whether the round-trip warn is filed. */
export type SignInReason = 'signedOut' | 'unauthorized';

export interface UseSignInRedirectOptions {
  /** `useUser().isLoading` — no decision is made while the session is still being read. */
  authLoading: boolean;
  /** `!user` on a page whose reads wait on a user. A page whose reads run signed-out omits it. */
  signedOut?: boolean;
  /** `useUser().error` — a failed /api/auth/me read; NOT signed out (see `sessionError`). */
  authError?: unknown;
  /** True when a primary read of this page answered 401. */
  unauthorized?: boolean;
  /** True when an answer on THIS visit proved the session (a primary load that succeeded). */
  sessionProven?: boolean;
}

export interface SignInRedirect {
  decision: SignInDecision;
  /** True while the page should show its own loading hold instead of any error screen. */
  holding: boolean;
  /** True when useUser settled with no user AND an error: show Reload, never redirect. */
  sessionError: boolean;
  /** The banner state for a signed-out visitor back with the latch set (code 'unauthorized'). */
  signedOutErrorState: FetchErrorState;
  /** Decide now (a page's own answer arm); returns at once unless the decision is still idle. */
  requestSignIn: (reason?: SignInReason) => void;
  /** Remove this path's latch (an answer that proves the session: 403 / 404 / 410 on gameDetail). */
  clearLatch: () => void;
  /** Remove this path's latch and return to idle (a primary load that succeeded). */
  markSessionProven: () => void;
  /** Back to idle WITHOUT touching storage — a page's own new-entity reset. */
  resetDecision: () => void;
}

const SIGNED_OUT_ERROR = new ApiError('Not signed in', 'unauthorized', 401);
// A refetch that resolves nothing: the banner's Sign in link, not Try again, is this state's control.
const resolveNothing = (() => Promise.resolve(undefined)) as unknown as FetchErrorSource['refetch'];
const WARN_ROUND_TRIP = '[signIn] a 401 came back after a sign-in round trip';

export function useSignInRedirect(options: UseSignInRedirectOptions): SignInRedirect {
  const { authLoading, signedOut, authError, unauthorized, sessionProven } = options;
  // A useUser() fetch error is NOT signed out: SDK 3.8.0 leaves `user` undefined and sets `error`.
  const signedOutArm = Boolean(signedOut) && !authError;
  const sessionError = !authLoading && Boolean(signedOut) && Boolean(authError);
  const unauthorizedArm = Boolean(unauthorized);

  // The ref, not the state, is the guard: two triggers in one flush must decide once.
  const decisionRef = useRef<SignInDecision>('idle');
  const [decision, setDecision] = useState<SignInDecision>('idle');

  const resetDecision = useCallback(() => {
    decisionRef.current = 'idle';
    setDecision('idle');
  }, []);

  const clearLatch = useCallback(() => {
    removeLatch(signInLatchKey(window.location));
  }, []);

  const markSessionProven = useCallback(() => {
    removeLatch(signInLatchKey(window.location));
    decisionRef.current = 'idle';
    setDecision('idle');
  }, []);

  const requestSignIn = useCallback((reason: SignInReason = 'unauthorized') => {
    if (decisionRef.current !== 'idle') return;
    const key = signInLatchKey(window.location);
    const read = readLatch(key);
    if (read !== 'clear' || !writeLatch(key)) {
      // Already redirected once for this path (or storage failed): the banner, never a loop.
      decisionRef.current = 'declined';
      setDecision('declined');
      // Only a 401 after a real round trip is filed (path only — never search, hash or an id).
      if (read === 'set' && reason === 'unauthorized') {
        logger.warn(WARN_ROUND_TRIP, { path: window.location.pathname });
      }
      return;
    }
    decisionRef.current = 'redirecting';
    setDecision('redirecting');
    window.location.replace(buildSignInUrl());
  }, []);

  // Effect 1: decide once the session has settled and an arm is up.
  useEffect(() => {
    if (authLoading) return;
    if (signedOutArm || unauthorizedArm) {
      requestSignIn(signedOutArm ? 'signedOut' : 'unauthorized');
    }
  }, [authLoading, signedOutArm, unauthorizedArm, requestSignIn]);

  // Effect 2: a proven session clears this path's latch. A 401 never does.
  useEffect(() => {
    if (!authLoading && !signedOut && !unauthorizedArm && sessionProven) markSessionProven();
  }, [authLoading, signedOut, unauthorizedArm, sessionProven, markSessionProven]);

  // The page shows its own loading hold, so no error screen paints for a frame before navigation
  // (gameDetail's RESEARCH P-5 rule). The hold is for a redirect that is ABOUT to happen: when the
  // latch is already set (or unreadable) the decision will be 'declined', so there is no hold —
  // the page keeps its content, and the focus inside it, for the one render before the effect
  // commits 'declined' (C12: a hold frame there unmounted a focused control and dropped focus to
  // body; userProfile K8 pins it). Reading the latch at render is a side-effect-free read.
  const armed = !authLoading && (signedOutArm || unauthorizedArm);
  const willDecline =
    armed &&
    decision === 'idle' &&
    typeof window !== 'undefined' &&
    readLatch(signInLatchKey(window.location)) !== 'clear';
  const holding = decision === 'redirecting' || (decision === 'idle' && armed && !willDecline);

  const signedOutErrorState = useFetchErrorState({
    isError: decision === 'declined' && signedOutArm,
    error: SIGNED_OUT_ERROR,
    refetch: resolveNothing,
  });

  return {
    decision,
    holding,
    sessionError,
    signedOutErrorState,
    requestSignIn,
    clearLatch,
    markSessionProven,
    resetDecision,
  };
}
