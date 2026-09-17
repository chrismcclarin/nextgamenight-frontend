// app/api/auth/google-connect/route.js
// Proxy route to initiate Google Calendar OAuth with authentication
import { getAccessToken } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

// Force dynamic rendering - this route uses cookies and cannot be statically generated
export const dynamic = 'force-dynamic';

/* DECISION Phase 88.6-42 (T-88.6-117, #116/#124): every client-visible body in this route
   returns a FIXED string — chosen OVER the "trace the consumer chain, find no reader,
   conclude the chain is closed, rename the key to `message`" reading, which would have
   recorded this threat as mitigated while leaving an internal exception on the user's
   screen.

   THE FACT THAT INVERTS THE TREATMENT: the only consumer is a NAVIGATION, not a fetch —
   `userProfile/page.js` does `window.location.href = '/api/auth/google-connect'`. No
   JavaScript reads `body.error`. On a failure the user's browser LANDS HERE and RENDERS
   this JSON body as a page, with no way back. So the upstream OAuth string, the raw Node
   exception message and the AUTH0_AUDIENCE deployment hint were all user-visible copy, and
   redaction was REQUIRED rather than optional.

   The real detail is not lost, it MOVES: it stays in the Vercel server function log, via
   the two `console.error` calls below. Redaction makes this route SAFE; it does not make
   the JSON-as-a-page experience GOOD — that is an owned residual with Phase 93 named
   (`.planning/deferred/phase-93.md`), not something this plan fixed.

   THE BODY CENSUS IS FOUR, and it is load-bearing: a fifth client-visible body would
   silently falsify the enumeration this whole block turns on. `errorEnvelopeReads.test.ts`
   asserts both properties — no interpolation / `errorData.` / `error.message` inside any
   `NextResponse.json` argument, and exactly four of them — so the mitigation is a machine
   check rather than proof-by-careful-reading. Adding a body here is a decision, not a
   cleanup. */

/* DECISION Phase 88.6-42 (AC-2 / D2): the two `console.error` calls in this file are KEPT —
   chosen OVER converting them to `logger.info` (AC-2's phase-wide convert-on-touch level)
   and OVER `logger.error`. Server-side Sentry is not initialised in this app: there is no
   `instrumentation.ts` anywhere under `periodictabletop/`, and `@sentry/nextjs` v8 loads
   `sentry.server.config.js` ONLY via `instrumentation.ts`'s `register()`, so that file's
   `Sentry.init` never runs and BOTH `logger.info` and `logger.error` are no-ops here. The
   console line is this route's only diagnostic channel, and the Vercel function log is
   where it lands. Converting this file is a REGRESSION, not a cleanup: it would delete the
   only working channel and put nothing in its place. The `.eslintrc.json` no-console entry
   stays with it and is swept at milestone close (`ROADMAP.md:28`), alongside
   `api/[...path]/route.ts`, the phase's other deliberately-kept server route handler.
   Revisit only when Phase 90 lands server init WITH a `beforeSendTransaction` scrub —
   `sentry.scrub.js` exports no such hook today, and `beforeSend` does not run on
   transactions. */

/**
 * Google's OAuth consent origin — the ONLY origin this route will redirect to.
 *
 * DECISION Phase 88.6-42 (T-88.6-126, ACCEPT §12 / #94, owner ruling 2026-09-14): `authUrl`
 * must PARSE as a URL, be `https:` AND be on this exact origin — chosen OVER the looser
 * `https:`-only floor, which would still permit any HTTPS origin the upstream ever returned,
 * and OVER the do-nothing arm (leave the redirect unmentioned), which is rejected because
 * this route's own exhaustive four-body disclosure enumeration would then certify the one
 * real SINK as checked. The sibling precedent already shipped in this app is
 * `isAllowedImageUrl` / `safeBgImageStyle` (`src/lib/safeBgImageStyle.ts:36`, `:66`) —
 * default-deny on the same class of value.
 *
 * NOT EXPLOITABLE TODAY, and that is stated on evidence rather than on purpose: the backend
 * builds this value with `oauth2Client.generateAuthUrl(...)`
 * (`periodictabletopbackend_v2/Sonnet/routes/googleAuth.js:249`, returned as
 * `res.json({ authUrl })` at `:280`), which emits an `accounts.google.com` consent URL. This
 * is DEFENCE-IN-DEPTH against an ABSENCE — there is no scheme or origin check between the
 * backend's JSON and `NextResponse.redirect` — and if the backend ever proxies a
 * third-party value there it stops being defence-in-depth, which is the argument for taking
 * it now.
 *
 * FAILURE MODE if Google ever moves the consent host: a fixed 500 plus a function-log line
 * naming the rejected origin. Loud and recoverable, rather than silent.
 */
const GOOGLE_CONSENT_ORIGIN = 'https://accounts.google.com';

/** The rejected target's origin, or a marker — for the function log only, never a body. */
function originOf(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return '<unparseable>';
  }
}

function isGoogleConsentUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.origin === GOOGLE_CONSENT_ORIGIN;
}

export async function GET(request) {
  try {
    // Get access token with audience (required for API authentication)
    const audience = process.env.AUTH0_AUDIENCE;
    const { accessToken } = await getAccessToken({
      audience: audience
    });

    if (!accessToken) {
      // The AUTH0_AUDIENCE hint that stood in this string is DEPLOYMENT DETAIL and is
      // dropped from client-visible copy (T-88.6-117). It keeps its diagnostic value in the
      // function log, where the same misconfiguration surfaces as a getAccessToken failure.
      return NextResponse.json(
        { error: 'No access token available. Please ensure you are logged in.' },
        { status: 401 }
      );
    }

    // Get the frontend URL for callback redirect
    // In production (Vercel), use AUTH0_BASE_URL which is set to the production URL
    // Fallback to request origin for localhost development
    let frontendOrigin;
    if (process.env.AUTH0_BASE_URL) {
      // Production: Use AUTH0_BASE_URL (already set to production frontend URL)
      frontendOrigin = process.env.AUTH0_BASE_URL.replace(/\/$/, ''); // Remove trailing slash if present
    } else {
      // Development: Use request origin
      const requestUrl = new URL(request.url);
      frontendOrigin = requestUrl.origin;
    }

    // Call backend to get Google OAuth URL
    // Backend will get user info from the token, so no need to pass email/username
    // Pass frontend_url as query parameter so backend can include it in the OAuth state
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const backendResponse = await fetch(`${backendUrl}/auth/google/url?frontend_url=${encodeURIComponent(frontendOrigin)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Backend error:', errorData);
      // The upstream string is NOT echoed to the client (T-88.6-117). It reaches the
      // Vercel function log through the line directly above, which is this runtime's only
      // working channel — and `errorData` itself is neither widened, re-shaped nor re-keyed.
      return NextResponse.json(
        { error: 'Failed to get Google OAuth URL' },
        { status: backendResponse.status }
      );
    }

    const { authUrl } = await backendResponse.json();

    // The route's ONE real SINK. Truthiness was the only check here before plan 88.6-42;
    // the scheme-and-origin floor above is what makes an arbitrary backend-supplied string
    // unusable as a redirect target on an authenticated route. The failure arm is the SAME
    // FIXED 500 BODY the truthiness arm always returned — not a new string, not the parsed
    // value, not the reason — so the client-visible body census stays at FOUR.
    if (!isGoogleConsentUrl(authUrl)) {
      console.error('google-connect: refusing redirect target, origin:', originOf(authUrl));
      return NextResponse.json(
        { error: 'No auth URL returned from backend' },
        { status: 500 }
      );
    }

    // Redirect to Google OAuth consent screen
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Error in google-connect route:', error.message);
    // The raw Node exception message is NOT interpolated into the body (T-88.6-117): the
    // user lands on this page, so an internal exception here was an information-disclosure
    // bug on a surface with no way back. The real exception stays in the function log, on
    // the line above.
    return NextResponse.json(
      { error: 'Failed to connect Google Calendar' },
      { status: 500 }
    );
  }
}
