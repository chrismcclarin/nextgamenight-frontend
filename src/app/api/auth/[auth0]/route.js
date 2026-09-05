import { handleAuth, handleLogout } from '@auth0/nextjs-auth0';

// Force dynamic rendering - Auth0 routes use cookies and cannot be statically generated
export const dynamic = 'force-dynamic';

export const GET = handleAuth({
  // The installed @auth0/nextjs-auth0@3.5.0 IGNORES a `returnTo` query param —
  // its logout handler only honors `options.returnTo` (RESEARCH Finding 1).
  // Read the query param ourselves and STRICTLY allowlist `/goodbye` (open-redirect
  // guard: never reflect arbitrary values). A relative `/goodbye` is joined onto
  // AUTH0_BASE_URL by the SDK, so the resulting absolute URL must be in the Auth0
  // app's Allowed Logout URLs (Finding 2 — human dashboard step, plan 87.2-09).
  // Returning {} for anything else preserves the default post-logout redirect for
  // normal Header logouts (never hijack them).
  //
  // Phase 88.8 (SPEC R9 / D-22, T-88.8-55): a SECOND exact literal,
  // '/goodbye?reason=account_deleted'. Plan 06's backend emits it as
  // `${frontendUrl}/api/auth/logout?returnTo=${encodeURIComponent('/goodbye?reason=account_deleted')}`
  // when a tombstoned account comes back through the Google OAuth callback;
  // `searchParams.get` below decodes the value, so the compare sees the decoded
  // path. Both comparisons stay STRICT `===`. A prefix / startsWith / substring
  // match here would reopen the exact open redirect this allowlist exists to
  // prevent (`/goodbye@evil.example` starts with `/goodbye`), so the two
  // literals are written out rather than derived.
  // VERIFIED against Auth0's own docs (2026-09-04,
  // auth0.com/docs/authenticate/login/logout/redirect-users-after-logout): "the
  // query string, and hash information provided as part of the URL are not taken
  // into account" when validating `returnTo` against Allowed Logout URLs. So the
  // already-allow-listed https://www.nextgamenight.app/goodbye covers the reason
  // variant and NO Auth0 dashboard change is needed (owner confirmed the base
  // URL is on that list, 2026-09-02).
  logout: handleLogout((req) => {
    const returnTo = new URL(req.url).searchParams.get('returnTo');
    if (returnTo === '/goodbye') return { returnTo: '/goodbye' };
    if (returnTo === '/goodbye?reason=account_deleted') {
      return { returnTo: '/goodbye?reason=account_deleted' };
    }
    return {};
  }),
});
