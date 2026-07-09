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
  logout: handleLogout((req) => {
    const returnTo = new URL(req.url).searchParams.get('returnTo');
    return returnTo === '/goodbye' ? { returnTo: '/goodbye' } : {};
  }),
});
