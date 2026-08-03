/**
 * Feedback pageUrl credential scrub — FE half, the SOURCE (Plan 87.8-05 Task 4,
 * round-3 security finding).
 *
 * FeedbackButton mounts at the layout root, so it renders on every route for a
 * signed-in user — including the token-bearing routes below, whose PATH
 * segment carries a live credential (signed magic JWT, HMAC RSVP token, invite
 * token, restore nonce). Sending `window.location.href` verbatim published
 * that credential into a GitHub Issue body. The token is in the path segment,
 * so dropping the query string alone is not enough — the dynamic segment is
 * replaced with the literal placeholder form of the route.
 *
 * DEFAULT-DENY RULE: any route whose path embeds a credential gets a
 * placeholder before leaving the client (and, defence-in-depth, before
 * entering an issue body server-side — the same list lives in the backend's
 * routes/feedback.js scrub). The list is the five token routes TODAY; the
 * next token route added to the app belongs here AND there.
 *
 * Callers must pass Next's `usePathname()` value and must NEVER append
 * `window.location.search` — the RSVP query string carries an Auth0 sub.
 */
export const TOKEN_ROUTE_PREFIXES = [
  '/availability-form/',
  '/rsvp/',
  '/invite/group/',
  '/invite/game/',
  '/restore/group/',
] as const;

export function scrubFeedbackPageUrl(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  for (const prefix of TOKEN_ROUTE_PREFIXES) {
    // Replace the ENTIRE dynamic remainder with the placeholder — never
    // truncate the token partially (a prefix of a signed token is still
    // sensitive material).
    if (pathname.startsWith(prefix)) return `${prefix}[token]`;
  }
  return pathname;
}
