/**
 * signIn — the house sign-in URL.
 *
 * DECISION Phase 88.9-26 (O22d, SESSION groundwork): the ONE sign-in URL builder, lifted from the
 * gameDetail page's local helper so the banner and the page guard share it, chosen OVER a second
 * copy in FetchErrorBanner. The return address comes from window.location (path + search + hash)
 * and NEVER from the query string (SPEC Constraint, V5.1.5); the Auth0 SDK's same-origin check is
 * the server-side control; the hash rides inside returnTo because a fragment never reaches a
 * server. Plan 88.9-40 moves gameDetail onto this import.
 */

/** `/api/auth/login?returnTo=<this page>`; plain `/api/auth/login` where there is no window. */
export function buildSignInUrl(): string {
  if (typeof window === 'undefined') return '/api/auth/login';
  const { pathname, search, hash } = window.location;
  return `/api/auth/login?returnTo=${encodeURIComponent(pathname + search + hash)}`;
}
