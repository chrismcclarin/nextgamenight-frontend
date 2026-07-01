// app/api/[...path]/route.ts
// BFF catch-all proxy (FSEC-01 / D-01).
//
// The ONE chokepoint through which every AUTHENTICATED browser data call flows.
// The browser makes same-origin requests to `/api/...`; this handler obtains the
// Auth0 access token SERVER-SIDE (never exposed to client JS) and forwards to the
// Express backend with the bearer attached. Unauthenticated/public callers do NOT
// route through here — they hit the absolute backend origin directly (see
// lib/api.ts PUBLIC_API_BASE_URL), so this proxy always attempts getAccessToken().
//
// Analog: app/api/auth/google-connect/route.js (server-side getAccessToken + forward),
// generalized from one GET to all methods + a wildcard path.
import { getAccessToken } from '@auth0/nextjs-auth0';
import type { AccessTokenRequest } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Uses cookies (session) — cannot be statically generated.
export const dynamic = 'force-dynamic';

// Upper bound on a single proxied request (D-01b — sane handler timeout).
const PROXY_TIMEOUT_MS = 30_000;

// Hop-by-hop headers (RFC 7230 §6.1) — never forwarded end-to-end.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Minimal inbound allow-list (T-86-02). Everything else — notably inbound
// `Authorization`, `cookie`, and any client-supplied `X-Forwarded-For` — is
// dropped before the SERVER bearer is attached.
const INBOUND_ALLOW_LIST = [
  'content-type',
  'accept',
  'accept-language',
  'cache-control',
  'if-none-match',
  'if-modified-since',
];

// Response headers we must NOT pass back verbatim: hop-by-hop plus the
// encoding/length trio (fetch already decoded the body, so the original
// content-encoding/length would be wrong and break the browser).
const RESPONSE_STRIP = new Set([...HOP_BY_HOP, 'content-encoding', 'content-length']);

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function backendBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
}

// SSRF / path-traversal guard (HIGH — T-86-01). Reject any segment that is empty,
// `.`/`..`, carries a scheme, embeds a slash/backslash, or contains control chars.
function isSafePathSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false;
  if (seg.includes('/') || seg.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(seg)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(seg)) return false; // scheme-bearing (http:, javascript:, ...)
  return true;
}

// CSRF defense-in-depth (T-86-08). The proxy authorizes via the ambient Auth0
// session cookie, so for state-changing methods we require the request Origin
// (Sec-Fetch-Site / Referer fallback) to match the app's own origin.
function isSameOriginRequest(request: NextRequest): boolean {
  const self = (process.env.AUTH0_BASE_URL || request.nextUrl.origin).replace(/\/$/, '');
  const requestOrigin = request.nextUrl.origin.replace(/\/$/, '');
  const allowed = new Set([self, requestOrigin]);

  const origin = request.headers.get('origin');
  if (origin) return allowed.has(origin.replace(/\/$/, ''));

  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite) return secFetchSite === 'same-origin' || secFetchSite === 'none';

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin.replace(/\/$/, ''));
    } catch {
      return false;
    }
  }
  // No usable origin signal on an unsafe method → reject (defense-in-depth).
  return false;
}

async function proxy(
  request: NextRequest,
  { params }: { params: { path: string[] } }
): Promise<Response> {
  const method = request.method.toUpperCase();

  // CSRF gate on state-changing methods, BEFORE any backend forward.
  if (UNSAFE_METHODS.has(method) && !isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }

  const segments = params.path ?? [];
  if (segments.length === 0 || !segments.every(isSafePathSegment)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const base = backendBase();
  const target = `${base}/${segments.join('/')}${request.nextUrl.search}`;

  // Fixed-base containment: the resolved target must stay inside the backend
  // origin + base path (no absolute-URL / scheme injection escaped the segment
  // check above). Any deviation → 400.
  try {
    const baseUrl = new URL(base);
    const targetUrl = new URL(target);
    if (
      targetUrl.origin !== baseUrl.origin ||
      !targetUrl.pathname.startsWith(baseUrl.pathname) ||
      !target.startsWith(`${base}/`)
    ) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Acquire the token SERVER-SIDE (T-86-10: pass the API audience so the backend
  // JWT validation accepts it — argument-less can mint a wrong-audience token
  // that silently 401s). If there is no session, degrade to a tokenless forward
  // rather than 500 — public flows do NOT rely on this (they bypass the proxy).
  let accessToken: string | null = null;
  try {
    // The shipped AccessTokenRequest type omits `audience`, but the SDK runtime
    // accepts it — mirror the proven google-connect analog (T-86-10). Cast bridges
    // the types-vs-runtime gap at this one call.
    const result = await getAccessToken(
      { audience: process.env.AUTH0_AUDIENCE } as AccessTokenRequest
    );
    accessToken = result?.accessToken ?? null;
  } catch {
    accessToken = null;
  }

  // Build the outbound header set from the allow-list only. Inbound
  // Authorization/cookie/X-Forwarded-For are intentionally NOT copied.
  const outboundHeaders = new Headers();
  for (const key of INBOUND_ALLOW_LIST) {
    const value = request.headers.get(key);
    if (value) outboundHeaders.set(key, value);
  }
  if (accessToken) outboundHeaders.set('Authorization', `Bearer ${accessToken}`);

  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers: outboundHeaders,
      redirect: 'manual',
      signal: controller.signal,
    };
    if (hasBody) {
      init.body = request.body;
      init.duplex = 'half'; // request streaming
    }

    const backendResponse = await fetch(target, init as RequestInit);

    const responseHeaders = new Headers();
    backendResponse.headers.forEach((value, key) => {
      if (!RESPONSE_STRIP.has(key.toLowerCase())) responseHeaders.set(key, value);
    });

    // Stream the backend body through rather than buffering (D-01b Vercel hop).
    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    // Logging hygiene (T-86-09): NEVER log the bearer or the header set. Log only
    // method + sanitized path + a coarse reason.
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error(`Proxy ${method} /${segments.join('/')} failed:`, aborted ? 'timeout' : 'upstream error');
    return NextResponse.json(
      { error: aborted ? 'Upstream request timed out' : 'Upstream request failed' },
      { status: aborted ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
