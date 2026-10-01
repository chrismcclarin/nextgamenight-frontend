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

/**
 * Routes whose credential rides in the QUERY string rather than the path
 * (`/invite/accept?token=…`, built at the backend's `routes/invites.js`).
 * `scrubFeedbackPageUrl` needs no entry for them — its callers never append
 * `window.location.search` — but a whole-URL sink does: Session Replay's
 * Meta event records `window.location.href`, query and all.
 *
 * Phase 88.6 R-7. The next query-token route belongs here.
 */
export const TOKEN_QUERY_ROUTES = ['/invite/accept'] as const;

/**
 * True when a page at `pathname` carries a live credential in its URL — in
 * the path segment (`TOKEN_ROUTE_PREFIXES`) or the query (`TOKEN_QUERY_ROUTES`).
 *
 * The consumer is `sentry.client.config.js`, which does NOT register the
 * Session Replay integration on such a page: replay records the full URL in
 * its Meta event and keeps `href` attributes in DOM snapshots, both outside
 * every scrub hook this app has (marker (v) in `sentry.scrub.js`). Magic-link
 * pages are entered by full page load from an SMS or email, so the init-time
 * pathname is the right gate. Prefix match, never substring: `/rsvpx` and
 * `/groups/invite-history` keep replay.
 *
 * DECISION Phase 88.6 R-7 (code-adversarial-review N1, owner ruling
 * "fix-now" 2026-09-29): gate replay INIT by route, chosen OVER scrubbing the
 * Meta `href` (no client hook exists for it in @sentry-internal/replay 8.55.2)
 * and OVER adding a fourth hand-authored route list (this reuses the two
 * lists the set-equality arm in `sentry.scrub.test.ts` already holds
 * together). Removing the gate is a decision, not a cleanup.
 */
export function isTokenBearingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  for (const prefix of TOKEN_ROUTE_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  for (const route of TOKEN_QUERY_ROUTES) {
    if (pathname === route) return true;
  }
  return false;
}

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
