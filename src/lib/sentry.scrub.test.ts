import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';
// The scrub module lives at the repo root (imported by the three sentry.*.config.js
// runtime files). This test lives under src/ (A3) so the vitest `include` collects
// it; it reaches the root module via a relative path.
import {
  scrubString,
  scrubUrl,
  scrubEvent,
  scrubRecordingEvent,
  scrubSpanJson,
  scrubTransaction,
  TOKEN_PATH_PATTERNS_FE_ROUTES,
  TOKEN_PATH_PATTERNS_API_PATHS,
  URL_FRAGMENT,
} from '../../sentry.scrub.js';
// The cross-module import lives HERE, never inside `sentry.scrub.js` — that module's
// docblock promises pure functions safe to unit-test in isolation, and it must not import
// a `.ts` module. See the set-equality arm at the bottom.
import { TOKEN_ROUTE_PREFIXES } from './scrubFeedbackPageUrl';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// ---------------------------------------------------------------------------
// Phase 88.6-13 task 4 / AC-1. WHY THE SHIPPED ARMS WERE NOT PRESERVED AS-IS.
//
// Every assertion in the pre-88.6 version of this file was `toContain` /
// `not.toContain`, and every token payload was the `JWT` constant above — which
// `scrubString`'s OWN JWT rule redacts on a completely different path. Measured: the whole
// suite passed with `TOKEN_PATH_PATTERNS` EMPTIED. It was testing the JWT rule and
// reporting on the token-path rule. There was no `invite/` arm at all, and BOTH shipped
// patterns were 100% dead against the live tree — `invite-preview/info/` exists in neither
// repo, and the flat `invite/` entry ate the `group`/`game` segment so the token SURVIVED.
//
// So: every family is asserted against its REAL route shape and its REAL token shape, and
// no family's assertion may pass with that family's pattern removed.
// ---------------------------------------------------------------------------

/**
 * A payload NO OTHER RULE in the module can catch — the mutation guard.
 *
 * Not a JWT (no `eyJ`, no dots), not a bearer, not a `key=value` pair, not an email, no
 * digit run for PHONE, and not hex (so the long-hex backstop cannot claim it either). If an
 * arm using this payload goes green, it went green through that family's OWN prefix pattern
 * and nothing else.
 */
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

/** The REAL rsvp token shape: 43-char base64url HMAC-SHA256 (`routes/rsvp.js:95-100`). */
const RSVP_TOKEN = 'Ab3-Cd5_Ef7Gh9Ij1Kl3Mn5Op7Qr9St1Uv3Wx5Yz7Aq';

/** 64 lowercase hex — the `restore/group` / invite-token shape. */
const HEX64 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** 32 lowercase hex — the shape of Sentry's OWN `contexts.trace.trace_id`. */
const TRACE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const R = '[REDACTED]';

// Phase 88.6.1-08 (P-10, case D1): the ONE family list, declared inside the AC-1 describe below,
// is pushed here at collection time so the P-10 describe can loop over the SAME nine
// [prefix, token] pairs without a second copy that could drift (D1 asserts the length).
const SHARED_FAMILIES: Array<[string, string]> = [];

describe('scrubString / scrubUrl — the shipped value rules', () => {
  it('scrubString redacts emails and JWT-looking tokens', () => {
    expect(scrubString('mail me at alice@example.com')).toContain(R);
    expect(scrubString('mail me at alice@example.com')).not.toContain('alice@example.com');
    expect(scrubString(`token=${JWT}`)).not.toContain(JWT);
  });

  // Phase 88.6-57 (CR-501): `encodeURIComponent` turns `@` into `%40`, and that is what every
  // query-string producer in `api.ts` runs (`friendshipsAPI.searchUserByEmail`). The EMAIL
  // rule is the beforeSend layer that must catch the address INDEPENDENTLY of any one call
  // site, so it matches the encoded separator too.
  it('scrubString redacts a %40-encoded email (CR-501)', () => {
    const out = scrubString('mail me at bob%40example.com');
    expect(out).not.toContain('bob%40example.com');
    expect(out).toContain(R);
  });

  it('scrubString redacts a %40-encoded email inside a query-bearing endpoint (CR-501)', () => {
    // The exact breadcrumb shape the review measured coming back unchanged from scrubEvent.
    expect(scrubString('/friendships/search?email=bob%40example.com')).not.toContain('example.com');
  });

  it('scrubUrl strips the query string entirely', () => {
    const out = scrubUrl(`https://x/rsvp/${RSVP_TOKEN}?magic_token=${JWT}`);
    expect(out).not.toContain(JWT);
    expect(out).toContain(R);
  });
});

// Phase 88.6-59 (review MEDLOW-11). `usersAPI.getUser(user?.sub …)` (`useSelfIdentity.ts`) is
// the one apiFetch path that carries an Auth0 sub, as `/users/${encodeURIComponent(sub)}` — so a
// failed self-lookup put `auth0%7C<id>` / `google-oauth2%7C<id>` into the `API Error (…)`
// breadcrumb message AND its `data.endpoint`. Before this plan NEITHER encoded form was
// redacted, and a hex `auth0|<id>` was not redacted even unencoded (an all-numeric Google id
// was caught only by accident, by PHONE). `toBe` where the output is fully determined.
describe('scrubString — Auth0 subs (88.6-59, review MEDLOW-11)', () => {
  const HEX_SUB_ID = '6a2984bc1f0e4d3aa1b2c3d4e5f60718';

  it('a %7C-encoded google-oauth2 sub inside the apiFetch breadcrumb message is redacted', () => {
    const out = scrubString('API Error (/users/google-oauth2%7C115378212345678901234)');
    expect(out).toBe(`API Error (/users/google-oauth2|${R})`);
    expect(out).not.toContain('115378212345678901234');
  });

  it('an UNENCODED hex auth0 sub is redacted', () => {
    expect(scrubString(`auth0|${HEX_SUB_ID}`)).toBe(`auth0|${R}`);
  });

  it('a %7C-encoded hex auth0 sub is redacted (upper- and lower-case escape)', () => {
    expect(scrubString(`auth0%7C${HEX_SUB_ID}`)).toBe(`auth0|${R}`);
    expect(scrubString(`auth0%7c${HEX_SUB_ID}`)).toBe(`auth0|${R}`);
  });

  it('the whole breadcrumb shape apiFetch emits — message AND data.endpoint — carries no sub', () => {
    const endpoint = `/users/auth0%7C${HEX_SUB_ID}`;
    const out = scrubEvent({
      breadcrumbs: [{ message: `API Error (${endpoint})`, data: { endpoint, status: 500 } }],
    }) as { breadcrumbs: Array<{ message: string; data: { endpoint: string } }> };
    expect(out.breadcrumbs[0].message).toBe(`API Error (/users/auth0|${R})`);
    expect(out.breadcrumbs[0].data.endpoint).toBe(`/users/auth0|${R}`);
  });

  it('NEGATIVE: separator-GUARDED — a bare 32-hex trace id, a prose pipe and a non-connection word are untouched', () => {
    // Marker (iii): the rule must not widen onto bare hex, or it kills trace linking.
    expect(scrubString(TRACE_ID)).toBe(TRACE_ID);
    expect(scrubString('trace_id=4bf92f3577b34da6a3ce929d0e0e4736')).toBe(
      'trace_id=4bf92f3577b34da6a3ce929d0e0e4736'
    );
    expect(scrubString('a | b')).toBe('a | b');
    expect(scrubString('status|pending')).toBe('status|pending');
    // `line` is a real connection prefix; the word boundary keeps it from matching mid-word.
    expect(scrubString('timeline|abc123')).toBe('timeline|abc123');
  });
});

// Phase 88.6.1-08 (W007, AC-34 clause 1; DF-7 probe inputs). Before this plan the SECRET_KV key
// group was a bare word list behind a `\b`, so `access_token=` / `id_token=` / `refresh_token=`
// (the `_` is a word character, so no boundary sits before `token`), camelCase keys and quoted
// pairs all came back unchanged. `toBe` everywhere: every output here is fully determined.
describe('W007 — OAuth-shaped key=value pairs and the logger breadcrumb (88.6.1-08, AC-34, Prohibition 5)', () => {
  it('W007: access_token / id_token / refresh_token / client_secret / x-auth-token values are redacted, camelCase and quoted pairs included (DF-7 probe inputs)', () => {
    expect(scrubString('callback?access_token=abc123&x=1')).toBe(`callback?${R}&x=1`);
    expect(scrubString('id_token=eyJabc refresh_token=r3fr35h')).toBe(`${R} ${R}`);
    expect(scrubString('client_secret=s3cr3tval&x=1')).toBe(`${R}&x=1`);
    expect(scrubString('x-auth-token: abcdef')).toBe(R);
    // camelCase keys (review r2 #103): letters run straight into the keyword.
    expect(scrubString('accessToken=abc')).toBe(R);
    expect(scrubString('idToken: abc')).toBe(R);
    // Quoted pairs (review r2 #102). The whole pair goes, and the quote whose partner sat
    // outside the match is re-emitted, so the quotes stay balanced: a JSON pair reads as one
    // quoted string, and a quoted value keeps its pair of quotes.
    expect(scrubString('{"refresh_token":"v1.x"}')).toBe(`{"${R}"}`);
    expect(scrubString('refresh_token: "v1.x"')).toBe(`"${R}"`);
    // Owner ruling #10 (2026-10-13, `88.6.1-PLAN-REVIEW-work/RULINGS.md`), the cost line of the
    // W007 marker in `sentry.scrub.js`: the ONE word after a `<word>-token:` prose colon is
    // eaten, by design (fail-safe). Before this plan only the bare `token` after the hyphen
    // matched, leaving `refresh-` in front of the placeholder.
    expect(scrubString('Invalid refresh-token: expired session')).toBe(`Invalid ${R} session`);
  });

  it('W007 NEGATIVE: a token-ish word that is not a key=value secret is untouched', () => {
    // The `\b` after the key keeps these out; `passwordless` and `mytokens` are what an
    // unanchored keyword match (the camelCase clause done wrong) would catch.
    for (const s of [
      'token_count=5',
      'tokens=5',
      'password_reset=true',
      'passwordless=1',
      'mytokens=3',
      'trace_id=4bf92f3577b34da6a3ce929d0e0e4736',
      ALPHA,
    ]) {
      expect(scrubString(s), s).toBe(s);
    }
  });

  it('Prohibition 5: the exact object logger.info(msg, errCtx(err)) hands to addBreadcrumb comes back redacted from scrubEvent', () => {
    // The crumb is built LITERALLY (no logger import here, which keeps `@sentry/nextjs` out of
    // this suite). Its shape is `logger.info` at `src/lib/logger.ts:53`
    // (`Sentry.addBreadcrumb({ message: msg, level: 'info', data: ctx })`) with `ctx` from
    // `errCtx` at `src/lib/logger.ts:89-98` (name and message only). The WIRING proof, the real
    // logger through the `beforeSend` that `sentry.client.config.js` hands to `Sentry.init`, is
    // the 88.6.1-08 tracer in `src/lib/sentryClientReplayGate.test.ts`.
    const crumb = {
      message: 'Failed to refresh the session',
      level: 'info',
      data: {
        name: 'Error',
        message: 'refresh failed: id_token=eyJabc refresh_token=r3fr35h for alice@example.com',
      },
    };
    const out = scrubEvent({ breadcrumbs: [crumb] }) as {
      breadcrumbs: Array<{ message: string; data: { name: string; message: string } }>;
    };
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('eyJabc');
    expect(serialised).not.toContain('r3fr35h');
    expect(serialised).not.toContain('alice@example.com');
    expect(out.breadcrumbs[0].message).toBe('Failed to refresh the session');
    expect(out.breadcrumbs[0].data.name).toBe('Error');
    expect(out.breadcrumbs[0].data.message).toBe(`refresh failed: ${R} ${R} for ${R}`);
  });
});

describe('AC-1 — every LIVE token-in-path family is redacted, by its own pattern', () => {
  // The NINE live families, each against its real route prefix. The payload is the
  // mutation-guard ALPHA everywhere EXCEPT where a real token shape is the point, so a
  // family that loses its pattern cannot be rescued by the JWT/hex/email rules.
  //
  // `toBe`, NOT `toContain`. A single equality assertion fails under the WRONG PATTERN
  // ORDER, under the flat-`.replace(X, REDACTED)` misimplementation (which yields
  // `https://x/[REDACTED]` and destroys route identity), and under the
  // separator-outside-the-capture-group misreading (which yields `https://xinvite/…` by
  // eating the separator) — three distinct defects, one assertion.
  const FAMILIES: Array<[string, string]> = [
    // 5 FE `[token]` routes
    ['availability-form/', ALPHA],
    ['rsvp/', RSVP_TOKEN],
    ['invite/group/', HEX64],
    ['invite/game/', ALPHA],
    ['restore/group/', HEX64],
    // 4 token-in-path API fetch paths
    ['groups/invite-preview/', ALPHA],
    ['groups/restore-preview/', ALPHA],
    ['events/invite-preview/', ALPHA],
    ['invites/info/', ALPHA],
  ];
  // Phase 88.6.1-08: shared with the P-10 describe (see SHARED_FAMILIES at the top).
  SHARED_FAMILIES.push(...FAMILIES);

  it('redacts exactly the token segment and keeps the route identity (absolute URL)', () => {
    for (const [prefix, token] of FAMILIES) {
      expect(scrubUrl(`https://x/${prefix}${token}`), `family: ${prefix}`).toBe(
        `https://x/${prefix}${R}`
      );
    }
  });

  it('redacts a RELATIVE path too — the free-text and replay case the move into scrubString bought', () => {
    // Before 88.6-13 the prefix loop lived in `scrubUrl`, which `deepScrubRecording` reaches
    // only on `https?://`, `?` or the literal `invite`. A relative `/rsvp/<token>` never got
    // there, and neither did `event.message`, `exception.values[].value`,
    // `breadcrumb.message` or anything under `extra`/`contexts`.
    for (const [prefix, token] of FAMILIES) {
      expect(scrubString(`/${prefix}${token}`), `family: ${prefix}`).toBe(`/${prefix}${R}`);
    }
  });

  it('a family cannot pass on someone else\'s rule — the mutation guard', () => {
    // Every ALPHA payload above is invisible to JWT/BEARER/SECRET_KV/EMAIL/PHONE and to the
    // long-hex backstop. Proven here directly, so "the arm is green" cannot mean "another
    // rule caught it".
    expect(scrubString(ALPHA)).toBe(ALPHA);
    expect(scrubUrl(`https://x/not-a-token-route/${ALPHA}`)).toBe(
      `https://x/not-a-token-route/${ALPHA}`
    );
  });

  it('free text mentioning a token path is redacted (the phase WIDENS this traffic)', () => {
    // Plans 19-24 convert `console.error` to the house logger, including on `/rsvp`. Before
    // the move, `scrubEvent({ message: 'failed at /rsvp/<token>' })` returned the token
    // verbatim.
    const out = scrubEvent({ message: `failed at /rsvp/${RSVP_TOKEN}` }) as {
      message: string;
    };
    expect(out.message).toBe(`failed at /rsvp/${R}`);
    expect(out.message).not.toContain(RSVP_TOKEN);
  });
});

describe('AC-1 — the `rsvp` greedy family is held narrow from BOTH sides', () => {
  // `src/app/rsvp/` contains only `[token]`, so the full route prefix is the bare `rsvp/` —
  // which eats two LIVE authenticated siblings unless excluded. The pair below is what keeps
  // the exclusion narrow: loosen it and the positive control reds; drop it and the negatives
  // red.

  it('POSITIVE: a 43-char base64url rsvp token still redacts', () => {
    expect(scrubString(`/rsvp/${RSVP_TOKEN}`)).toBe(`/rsvp/${R}`);
    expect(scrubUrl(`https://x/rsvp/${RSVP_TOKEN}`)).toBe(`https://x/rsvp/${R}`);
  });

  it('NEGATIVE: the tokenless `/rsvp/` siblings come through with route identity intact', () => {
    // `api.ts:1087` (`/rsvp/event/${event_id}`) — an authenticated event lookup by UUID.
    expect(scrubString('/rsvp/event/f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(
      '/rsvp/event/f47ac10b-58cc-4372-a567-0e02b2c3d479'
    );
    // `api.ts:1109` (`/rsvp/respond?token=`) — the public respond endpoint. Its QUERY carries the token and `scrubUrl`
    // strips the whole query string, but the PATH must survive readable.
    expect(scrubUrl('https://x/rsvp/respond?token=abc&e=1')).toBe(`https://x/rsvp/respond?${R}`);
  });

  // Phase 88.6.1-08 (W012, AC-34 clause 2; SPEC Edge Coverage R13 'nested paths'). Before this
  // plan the sibling lookahead ended only at `/`, `?`, `#` or the end, so prose after a
  // sibling word was eaten, and any `rsvp/` segment anywhere in a path was read as the token
  // route although the FE route `src/app/rsvp/[token]` is a ROOT route.
  it('W012: an rsvp sibling word followed by prose is not a token (88.6.1-08)', () => {
    expect(scrubString('rsvp/event is broken')).toBe('rsvp/event is broken');
    expect(scrubString('rsvp/respond timed out')).toBe('rsvp/respond timed out');
  });

  it('W012: a NESTED rsvp/ segment is not the token route (88.6.1-08)', () => {
    expect(scrubString('GET /api/events/5/rsvp/summary failed')).toBe(
      'GET /api/events/5/rsvp/summary failed'
    );
    expect(scrubString('/_next/static/chunks/app/rsvp/[token]/page-abc123.js')).toBe(
      '/_next/static/chunks/app/rsvp/[token]/page-abc123.js'
    );
  });

  it('W012: the fix narrows nothing it must catch — every first-segment shape still redacts (88.6.1-08)', () => {
    // CONFIRM-ONLY: green before and after. The regression arm for the nested-path exclusion.
    const t = RSVP_TOKEN;
    for (const [input, expected] of [
      [`https://www.nextgamenight.app/rsvp/${t}`, `https://www.nextgamenight.app/rsvp/${R}`],
      [`www.nextgamenight.app/rsvp/${t}`, `www.nextgamenight.app/rsvp/${R}`],
      [`http://localhost:3000/rsvp/${t}`, `http://localhost:3000/rsvp/${R}`],
      [`/rsvp/${t}`, `/rsvp/${R}`],
      [`rsvp/${t}`, `rsvp/${R}`],
      [`returnTo=/rsvp/${t}`, `returnTo=/rsvp/${R}`],
      [`/api/auth/login?returnTo=/rsvp/${t}`, `/api/auth/login?returnTo=/rsvp/${R}`],
      [`failed at /rsvp/${t}`, `failed at /rsvp/${R}`],
      [`/rsvp/${t} failed`, `/rsvp/${R} failed`],
      // AC-34's literal case: the segment after the token is kept.
      [`/rsvp/${t}/next`, `/rsvp/${R}/next`],
      // Plan review r1 D14 (2026-10-06): six parent-segment shapes. A lookbehind segment built
      // from the end-set leaked the whole token for the first five (a query value or a `=`,
      // `|`, `:` or non-ASCII letter posed as a parent segment); an allowlist widened with
      // brackets leaked the sixth; one widened with `:` leaked the fourth.
      [`?from=/groups/x&to=/rsvp/${t}`, `?from=/groups/x&to=/rsvp/${R}`],
      [`nav /a/b=/rsvp/${t}`, `nav /a/b=/rsvp/${R}`],
      [`/a/b|/rsvp/${t}`, `/a/b|/rsvp/${R}`],
      [`https://x.app/a/b:/rsvp/${t}`, `https://x.app/a/b:/rsvp/${R}`],
      [`/a/bé/rsvp/${t}`, `/a/bé/rsvp/${R}`],
      [`/a/[b]/rsvp/${t}`, `/a/[b]/rsvp/${R}`],
    ]) {
      expect(scrubString(input), input).toBe(expected);
    }
  });
});

describe('AC-1 — the over-redaction negatives', () => {
  it('a short hex id, a dashed UUID and a non-token path segment are untouched', () => {
    expect(scrubString('/groups/a1b2c3d4')).toBe('/groups/a1b2c3d4');
    expect(scrubUrl('https://x/groups/f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(
      'https://x/groups/f47ac10b-58cc-4372-a567-0e02b2c3d479'
    );
    expect(scrubString('/userProfile/settings')).toBe('/userProfile/settings');
  });

  it('a %40 with no local part or no dotted domain is NOT an email (CR-501 arm stays narrow)', () => {
    // The `(?:@|%40)` arm added in plan 88.6-57 must not widen past an address shape.
    expect(scrubString('a bare %40 alone')).toBe('a bare %40 alone');
    expect(scrubString('/games?q=50%40off')).toBe('/games?q=50%40off');
  });

  it('`/invite/accept` is UNCHANGED — the negative control the deleted flat `invite/` entry reds', () => {
    // There is no flat `/invite/<token>` route. The only flat child of `/invite/` is
    // `invite/accept` (`src/app/invite/accept/page.js:9-10`), which is TOKENLESS — it reads
    // its token from `searchParams`, which `scrubUrl` already strips and `SECRET_KV` already
    // matches. The shipped flat `invite/` pattern over-redacted it to `/invite/[REDACTED]`
    // while LEAVING the real `/invite/group/<token>` token in place. Keeping that entry
    // "last" would still red this arm, which is why it was DELETED rather than reordered.
    expect(scrubString('/invite/accept')).toBe('/invite/accept');
    expect(scrubUrl('https://x/invite/accept?token=abc')).toBe(`https://x/invite/accept?${R}`);
  });
});

describe('AC-1 — the long-hex backstop lives in scrubUrl ONLY', () => {
  it('POSITIVE: a 32+-hex PATH SEGMENT is redacted by scrubUrl', () => {
    expect(scrubUrl(`https://x/unknown-future-route/${HEX64}`)).toBe(
      `https://x/unknown-future-route/${R}`
    );
    expect(scrubUrl(`https://x/a/${TRACE_ID}/b`)).toBe(`https://x/a/${R}/b`);
  });

  it('NEGATIVE (trace_id): a BARE 32-hex contexts.trace.trace_id survives byte-identical', () => {
    // THE assertion that would have caught a hoist of the hex rule into `scrubString`.
    // Sentry attaches `contexts.trace` to every event and its `trace_id` is a bare 32-char
    // lowercase hex string. Redacting it silently kills error-to-transaction and FE-to-BE
    // trace linking on every FE error — and NONE of the over-redaction negatives above would
    // notice, because the value is not in a path. This arm belongs here permanently,
    // whichever hex variant ships.
    const event = {
      contexts: { trace: { trace_id: TRACE_ID, span_id: 'a1b2c3d4e5f60718' } },
    };
    const out = scrubEvent(event) as { contexts: { trace: { trace_id: string } } };
    expect(out.contexts.trace.trace_id).toBe(TRACE_ID);
    // …and the bare value is untouched by the string scrubber directly, too.
    expect(scrubString(TRACE_ID)).toBe(TRACE_ID);
  });
});

// Phase 88.6.1-08 (W007 fragments, AC-34 clause 1; threat T-88.6.1-162). Before this plan no
// layer touched a URL fragment, so an OAuth implicit-flow `#access_token=…` or any opaque
// fragment token left whole. The `access_token=` inputs below are ALSO caught by Task 1's
// prefixed SECRET_KV in `scrubString`; the OPAQUE-fragment inputs (`#abc123`, `#tok`) are the
// ones only the fragment rule can redact, so they are what make each shape discriminating.
describe('W007 — scrubUrl strips URL fragments (88.6.1-08)', () => {
  it('W007: scrubUrl strips a URL fragment to #[REDACTED] (DF-7 probe; absolute, relative, fetch span, quoted, scheme-less; replay-leaf long input — the fragment rule, the EMAIL start, end to end)', () => {
    // Absolute.
    expect(scrubUrl('https://www.nextgamenight.app/cb#access_token=abc123')).toBe(
      `https://www.nextgamenight.app/cb#${R}`
    );
    expect(scrubUrl('https://www.nextgamenight.app/cb#abc123')).toBe(`https://www.nextgamenight.app/cb#${R}`);
    // Relative.
    expect(scrubUrl('/cb#access_token=abc123')).toBe(`/cb#${R}`);
    expect(scrubUrl('/cb#abc123')).toBe(`/cb#${R}`);
    // A fetch span description (`scrubSpanJson` sends it through `scrubUrl`).
    expect(
      scrubSpanJson({ description: 'GET https://api.x.app/cb#access_token=abc123', data: {} }).description
    ).toBe(`GET https://api.x.app/cb#${R}`);
    expect(scrubSpanJson({ description: 'GET https://api.x.app/cb#abc123', data: {} }).description).toBe(
      `GET https://api.x.app/cb#${R}`
    );
    // A double-quoted URL keeps its closing quote: the fragment ends at the quote.
    expect(scrubUrl('see "https://x/cb#access_token=abc123" here')).toBe(`see "https://x/cb#${R}" here`);
    expect(scrubUrl('see "https://x/cb#abc123" here')).toBe(`see "https://x/cb#${R}" here`);
    // CONFIRM-ONLY: the query strip runs first, so a `?…#…` URL keeps today's shape.
    expect(scrubUrl('https://www.nextgamenight.app/cb?x=1#frag')).toBe(`https://www.nextgamenight.app/cb?${R}`);
    // Scheme-less host, and a path after `,` or `:` (review r2 #104).
    expect(scrubUrl('www.nextgamenight.app/cb#access_token=abc123')).toBe(`www.nextgamenight.app/cb#${R}`);
    expect(scrubUrl('x,/cb#tok')).toBe(`x,/cb#${R}`);
    expect(scrubUrl('to:/cb#abc')).toBe(`to:/cb#${R}`);

    // Long input (review r2 #135; scoped check H-10 / M-39). The input MUST hold a `#`: without
    // one the `#` guard in `scrubUrl` short-circuits the fragment pass and this pin would go
    // green against a quadratic regex. The 500 ms ceiling sits several times below every
    // measured RED and several times above the slowest measured GREEN.
    const L = `invite ${'a'.repeat(50000)}#`;
    // (i) the fragment RULE alone, timed on the exported constant: `scrubUrl` ends in
    // `scrubString`, so timing it would also pay for EMAIL.
    let t0 = performance.now();
    expect(L.replace(URL_FRAGMENT, `$1#${R}`)).toBe(L);
    expect(performance.now() - t0, '(i) URL_FRAGMENT on a long letter run').toBeLessThan(500);
    // (ii) the EMAIL start: a long run of local-part characters with no address in it.
    const A = 'a'.repeat(50000);
    t0 = performance.now();
    expect(scrubString(A)).toBe(A);
    expect(performance.now() - t0, '(ii) scrubString on a long letter run').toBeLessThan(500);
    // A second address glued onto the end of a first by a local-part character is still
    // redacted (a run-start lookbehind on EMAIL would leak it as `[REDACTED]_c@d.com`).
    expect(scrubString('a@b.com_c@d.com')).toBe(`${R}${R}`);
    // (iii) end to end: the reachable replay path (`isUrlLike` routes any string naming
    // `invite` to `scrubUrl`).
    t0 = performance.now();
    expect(scrubUrl(L)).toBe(L);
    expect(performance.now() - t0, '(iii) scrubUrl end to end on a long letter run').toBeLessThan(500);
  });

  it('W007 NEGATIVE: a # that is not part of a URL is untouched (INP selector, click selector)', () => {
    // CONFIRM-ONLY: green before and after. An INP span description is an HTML selector, and
    // `isUrlLike` routes a replay click selector naming `invite` to `scrubUrl`.
    expect(scrubSpanJson({ description: 'body > div#__next > main > button.btn', data: {} }).description).toBe(
      'body > div#__next > main > button.btn'
    );
    const click = {
      type: 5,
      data: { tag: 'breadcrumb', payload: { category: 'ui.click', message: 'div#invite-panel > button.btn' } },
    };
    const out = scrubRecordingEvent(click) as typeof click;
    expect(out.data.payload.message).toBe('div#invite-panel > button.btn');
  });
});

// Phase 88.6.1-08 (P-10, plan 58 ledger row; threats T-88.6.1-172 / -174). Before this plan
// every family's token class ended only at `/`, `?`, `#` or whitespace, so the quote, bracket
// or comma closing a quoted or bracketed path was swallowed into `[REDACTED]`, and the
// long-hex backstop's lookahead accepted only the end, `/`, `?` or `#`, so a hex token
// followed by a quote, a bracket or a space survived WHOLE.
describe('P-10 — a token segment ends at quotes, brackets and separators (88.6.1-08)', () => {
  it('P-10: every family keeps the punctuation after its token; JSON-shaped paths and quoted siblings survive', () => {
    // Anti-vacuity: the shared list is the AC-1 describe's nine families.
    expect(SHARED_FAMILIES).toHaveLength(9);
    const CLOSERS = ['"', "'", '\x60', ')', ']', '}', '>', ',', ';'];
    for (const [prefix, token] of SHARED_FAMILIES) {
      for (const ch of CLOSERS) {
        expect(scrubString(`x /${prefix}${token}${ch} y`), `family ${prefix} closer ${ch}`).toBe(
          `x /${prefix}${R}${ch} y`
        );
      }
    }
    // JSON-shaped strings keep their structure and still redact. The list is the shape the
    // FIRST-planned rsvp lookbehind leaked whole.
    expect(scrubString(`["/a/b","/rsvp/${RSVP_TOKEN}"]`)).toBe(`["/a/b","/rsvp/${R}"]`);
    expect(scrubString(`{"from":"/a/b","to":"/invite/group/${HEX64}"}`)).toBe(
      `{"from":"/a/b","to":"/invite/group/${R}"}`
    );
    expect(scrubString(`("/rsvp/${RSVP_TOKEN}")`)).toBe(`("/rsvp/${R}")`);
    // Quoted tokenless siblings stay byte-identical.
    expect(scrubString('"/rsvp/event"')).toBe('"/rsvp/event"');
    expect(scrubString("see '/rsvp/respond', then")).toBe("see '/rsvp/respond', then");
  });

  it('P-10: the long-hex backstop ends at whitespace and closing punctuation; a .js chunk is untouched', () => {
    expect(scrubUrl(`see "https://x/unknown-future-route/${HEX64}"`)).toBe(
      `see "https://x/unknown-future-route/${R}"`
    );
    expect(scrubUrl(`https://x/unknown-future-route/${HEX64})`)).toBe(`https://x/unknown-future-route/${R})`);
    expect(scrubUrl(`https://x/unknown-future-route/${HEX64} failed`)).toBe(
      `https://x/unknown-future-route/${R} failed`
    );
    // CONFIRM-ONLY: the full stop is not in the set, so a 32-hex chunk name is untouched.
    expect(scrubUrl(`https://x/_next/static/chunks/${TRACE_ID}.js`)).toBe(
      `https://x/_next/static/chunks/${TRACE_ID}.js`
    );
  });
});

describe('AC-1 — the STANDING route-enumeration arm (the default-deny mechanism)', () => {
  it('EVERY `[token]` route directory on disk has a redacting pattern', () => {
    // `TOKEN_PATH_PATTERNS` is a default-deny credential-egress control, and until this arm
    // it had NO default-deny MECHANISM: every other assertion in this file is a literal
    // route string, so the day someone adds a `[token]` route and forgets the pattern the
    // suite goes green forever — byte-for-byte the failure AC-1 exists to repair (both
    // shipped entries were 100% dead while the shipped `toContain` tests passed).
    //
    // The set-equality arm below does not close this either: it pins this module's FE half
    // against `TOKEN_ROUTE_PREFIXES`, and BOTH lists are hand-authored, so a new route
    // updates neither. So the family list is DERIVED FROM THE FILESYSTEM at run time.
    //
    // THE BRACKET TRAP, kept with the derivation: the shell form of this enumeration is
    // `find src/app -type d -name '[[]token]'`. The UNESCAPED `-name '[token]'` is a
    // CHARACTER CLASS and matches nothing, which would make the enumeration vacuously
    // "complete" — a default-deny gate that denies nothing.
    const APP = path.resolve(__dirname, '../app');
    const tokenDirs: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === '[token]') tokenDirs.push(full);
        else walk(full);
      }
    };
    walk(APP);

    // Anti-vacuity: the walk found routes at all. Five today; the floor is what stops a
    // moved root or a bad walk from making this arm assert nothing.
    expect(tokenDirs.length).toBeGreaterThanOrEqual(5);

    for (const dir of tokenDirs) {
      // `src/app/invite/group/[token]` -> `invite/group/`
      const prefix = `${path.relative(APP, path.dirname(dir))}/`;
      expect(scrubString(`/${prefix}${ALPHA}`), `no redacting pattern for /${prefix}`).toBe(
        `/${prefix}${R}`
      );
    }
  });
});

describe('AC-1 — the FE token-route lists cannot drift apart', () => {
  it('this module\'s FE-ROUTE half EQUALS scrubFeedbackPageUrl\'s TOKEN_ROUTE_PREFIXES (set equality)', () => {
    // The two lists are INDEPENDENTLY AUTHORED — neither is derived from the other. That is
    // the whole point: under a subset assertion a drift still holds and the suite stays
    // green, and an assertion that reads the literal it guards proves nothing.
    //
    // The FE-route half is exported SEPARATELY from the API-path entries precisely so this
    // arm has a subject; collapsing the nine entries into one alternation would leave it
    // with nothing to compare.
    const fromScrub = TOKEN_PATH_PATTERNS_FE_ROUTES.map((re: RegExp) => {
      // The capture group holds the full route prefix: `(invite\/group\/)…`
      const group = re.source.slice(re.source.indexOf('(') + 1, re.source.indexOf(')'));
      return `/${group.replace(/\\\//g, '/')}`;
    }).sort();

    const fromFeedback = [...TOKEN_ROUTE_PREFIXES].sort();

    expect(
      fromScrub,
      'The FE token-route lists have drifted. A token-bearing route belongs in ALL THREE: ' +
        '`TOKEN_PATH_PATTERNS_FE_ROUTES` (sentry.scrub.js), `TOKEN_ROUTE_PREFIXES` ' +
        '(src/lib/scrubFeedbackPageUrl.ts), AND its same-named twin in the BACKEND\'s ' +
        'routes/feedback.js — which this arm CANNOT reach. There is no cross-repo verifier ' +
        'for the backend list; it is owned by Phase 91. Check it by hand.'
    ).toEqual(fromFeedback);
  });

  it('the API-path entries are NOT in the FE-route half (the split is real)', () => {
    // Anti-vacuity for the split: if someone folded the API paths back into the FE array the
    // set-equality arm above would red, but this says WHY in one line.
    expect(TOKEN_PATH_PATTERNS_API_PATHS.length).toBe(4);
    expect(TOKEN_PATH_PATTERNS_FE_ROUTES.length).toBe(5);
  });
});

describe('scrubEvent', () => {
  it('(a) redacts a token-bearing fetch breadcrumb URL and a query-string request URL', () => {
    const event = {
      message: `nav to https://x/invite/group/${HEX64}`,
      breadcrumbs: [
        {
          category: 'fetch',
          message: `GET https://x/groups/invite-preview/${ALPHA}`,
          data: { url: `https://x/groups/invite-preview/${ALPHA}` },
        },
      ],
      request: {
        url: `https://x/rsvp/${RSVP_TOKEN}?magic_token=${JWT}`,
        query_string: `magic_token=${JWT}`,
      },
    };
    const out = scrubEvent(event);

    // Real route, real token shape, exact equality — none of these can pass on the JWT rule.
    expect(out.message).toBe(`nav to https://x/invite/group/${R}`);
    expect(out.breadcrumbs[0].data.url).toBe(`https://x/groups/invite-preview/${R}`);
    expect(out.breadcrumbs[0].message).toBe(`GET https://x/groups/invite-preview/${R}`);
    expect(out.request.url).toBe(`https://x/rsvp/${R}?${R}`);
    expect(JSON.stringify(out.request)).not.toContain(JWT);
    expect(JSON.stringify(out.request)).not.toContain(RSVP_TOKEN);
  });

  it('(b) GAP2 — redacts an event.extra PII value regardless of key name', () => {
    const event = { extra: { userEmail: 'x@y.com' } };
    const out = scrubEvent(event);
    expect(out.extra.userEmail).toBe(R);
    expect(JSON.stringify(out.extra)).not.toContain('x@y.com');
  });

  it('(c) GAP2 — redacts a JWT embedded in an exception value, keeping surrounding text', () => {
    const event = { exception: { values: [{ value: `failed with ${JWT}` }] } };
    const out = scrubEvent(event);
    expect(out.exception.values[0].value).not.toContain(JWT);
    expect(out.exception.values[0].value).toContain(R);
    expect(out.exception.values[0].value).toContain('failed with');
  });

  it('(c2) redacts a TOKEN PATH in an exception value — a sink scrubUrl never reached', () => {
    const event = { exception: { values: [{ value: `POST /invites/info/${ALPHA} failed` }] } };
    const out = scrubEvent(event);
    expect(out.exception.values[0].value).toBe(`POST /invites/info/${R} failed`);
  });

  it('scrubs nested event.contexts PII by pattern', () => {
    const event = { contexts: { auth: { authorization: `Bearer ${JWT}` } } };
    const out = scrubEvent(event);
    expect(JSON.stringify(out.contexts)).not.toContain(JWT);
    expect(JSON.stringify(out.contexts)).toContain(R);
  });

  it('(e) redacts event.user email / username / ip wholesale', () => {
    const event = {
      user: { id: 'auth0|keep', email: 'x@y.com', username: 'janedoe', ip_address: '203.0.113.7' },
    };
    const out = scrubEvent(event);
    expect(out.user.email).toBe(R);
    expect(out.user.username).toBe(R);
    expect(out.user.ip_address).toBe(R);
    expect(JSON.stringify(out.user)).not.toContain('x@y.com');
    // non-PII id is preserved for debugging.
    expect(out.user.id).toBe('auth0|keep');
  });

  it('(f) redacts event.request Authorization/Cookie headers, cookies, and POST body', () => {
    const event = {
      request: {
        headers: { Authorization: `Bearer ${JWT}`, Cookie: 'appSession=secret', 'User-Agent': 'jest' },
        cookies: { appSession: 'secret' },
        data: { email: 'x@y.com', magic_token: 'tok_live_123', note: 'hi' },
      },
    };
    const out = scrubEvent(event);
    expect(out.request.headers.Authorization).toBe(R);
    expect(out.request.headers.Cookie).toBe(R);
    expect(out.request.cookies).toBe(R);
    expect(JSON.stringify(out.request)).not.toContain(JWT);
    expect(JSON.stringify(out.request)).not.toContain('x@y.com');
    expect(JSON.stringify(out.request)).not.toContain('tok_live_123');
    // non-PII header + body fields survive.
    expect(out.request.headers['User-Agent']).toBe('jest');
    expect(out.request.data.note).toBe('hi');
  });

  it('(g) deep-scrubs arbitrary breadcrumb.data fields (logger ctx / console args)', () => {
    const event = {
      breadcrumbs: [{ message: 'login', data: { actor: 'x@y.com', arguments: [`Bearer ${JWT}`] } }],
    };
    const out = scrubEvent(event);
    expect(JSON.stringify(out.breadcrumbs)).not.toContain('x@y.com');
    expect(JSON.stringify(out.breadcrumbs)).not.toContain(JWT);
    expect(JSON.stringify(out.breadcrumbs)).toContain(R);
  });
});

describe('scrubRecordingEvent (replay pipeline)', () => {
  it('(d) A1 — redacts a recorded navigation/fetch token URL', () => {
    const fetchSpan = {
      type: 5,
      data: {
        tag: 'performanceSpan',
        payload: { op: 'resource.fetch', description: `https://x/events/invite-preview/${ALPHA}` },
      },
    };
    const out = scrubRecordingEvent(fetchSpan) as typeof fetchSpan;
    expect(out.data.payload.description).toBe(`https://x/events/invite-preview/${R}`);

    const navEvent = { data: { payload: { url: `https://x/rsvp/${RSVP_TOKEN}?e=1` } } };
    const out2 = scrubRecordingEvent(navEvent) as typeof navEvent;
    expect(out2.data.payload.url).toBe(`https://x/rsvp/${R}?${R}`);
  });

  it('(d2) RELATIVE-PATH replay arms — both were unredacted before 88.6-13', () => {
    // `deepScrubRecording` routes to `scrubUrl` ONLY on `https?://`, `?` or the literal
    // `invite`. A relative `/rsvp/<token>` matches none of the three and fell through to
    // `scrubString`, which carried no token-path rule at all. Nested in an object, because
    // that is how an rrweb payload actually arrives.
    const rsvpNav = { data: { payload: { href: `/rsvp/${RSVP_TOKEN}` } } };
    const outA = scrubRecordingEvent(rsvpNav) as typeof rsvpNav;
    expect(outA.data.payload.href).toBe(`/rsvp/${R}`);

    const restoreNav = { data: { payload: { href: `/restore/group/${HEX64}` } } };
    const outB = scrubRecordingEvent(restoreNav) as typeof restoreNav;
    expect(outB.data.payload.href).toBe(`/restore/group/${R}`);
  });

  it('(d3) 4(h) — the replay walker applies KEY-BASED wholesale redaction, like the event walker', () => {
    // MEASURED ASYMMETRY, closed here: `deepScrub(value, keyHint)` redacts on the key;
    // `deepScrubRecording(value)` took NO key parameter and recursed without one, so a value
    // under an obviously sensitive key survived the REPLAY path unless it matched a value
    // rule. The payload below is the mutation-guard ALPHA — no value rule can catch it — so
    // this arm is green only if the key hint is live.
    //
    // It widens with the phase: `logger.info(msg, ctx)` becomes
    // `Sentry.addBreadcrumb({ data: ctx })` and AC-2 routes ~100 call sites there.
    const ev = { data: { payload: { magic_token: ALPHA, note: ALPHA } } };
    const out = scrubRecordingEvent(ev) as typeof ev;
    expect(out.data.payload.magic_token).toBe(R);
    // …and a harmless sibling key under the same parent is NOT redacted wholesale.
    expect(out.data.payload.note).toBe(ALPHA);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-61 (review round 2 H-1, owner ruling R2-H1-RULING). Performance payloads —
// transactions (`beforeSendTransaction`) and spans (`beforeSendSpan`, which is ALSO the only
// hook that reaches standalone INP/CLS spans) — bypassed every scrub layer: `beforeSend` never
// runs on them. These arms were shown RED against identity versions of both functions (the
// exports existed and returned their input unchanged), never against a missing import.
// ---------------------------------------------------------------------------
describe('scrubSpanJson / scrubTransaction — performance egress (R2 H-1)', () => {
  it('scrubTransaction: a token-route pageload name, request URL and query are redacted; trace ids link', () => {
    const event = {
      type: 'transaction',
      transaction: `/availability-form/${JWT}`,
      request: {
        url: `https://www.x.app/availability-form/${JWT}?magic_token=${JWT}`,
        query_string: `magic_token=${JWT}`,
      },
      contexts: { trace: { trace_id: TRACE_ID, span_id: 'a1b2c3d4e5f60718' } },
    };
    const out = scrubTransaction(event) as typeof event;
    expect(out.transaction).toBe(`/availability-form/${R}`);
    expect(JSON.stringify(out)).not.toContain('eyJ');
    expect(out.request.query_string).toBe(R);
    expect(out.contexts.trace.trace_id).toBe(TRACE_ID);
  });

  it('scrubSpanJson: a fetch span carrying a searched email in description / url / http.url is redacted', () => {
    const fetchUrl = 'https://api.x.app/friendships/search?email=bob%40example.com';
    const span = {
      description: `GET ${fetchUrl}`,
      data: { url: fetchUrl, 'http.url': fetchUrl, 'http.method': 'GET' },
      span_id: 'a1b2c3d4e5f60718',
      trace_id: TRACE_ID,
      parent_span_id: 'b1b2c3d4e5f60718',
    };
    const out = scrubSpanJson(span) as typeof span;
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('bob');
    expect(serialised).not.toContain('example.com');
    expect(out.data['http.method']).toBe('GET');
  });

  it('scrubSpanJson: an INP-shaped span carries the token pathname as its data.transaction — redacted', () => {
    // `@sentry-internal/browser-utils` inp.js: the span NAME is the HTML selector and the
    // route name (the raw pathname) rides as the `transaction` attribute.
    const span = {
      description: 'body > div > button',
      op: 'ui.interaction.click',
      data: { transaction: `/rsvp/${RSVP_TOKEN}`, 'sentry.op': 'ui.interaction.click' },
    };
    const out = scrubSpanJson(span) as typeof span;
    expect(out.data.transaction).toBe(`/rsvp/${R}`);
    expect(out.description).toBe('body > div > button');
  });

  it('scrubSpanJson: a LoAF-shaped span with a tokened code.filepath keeps neither the token nor the sub', () => {
    const span = { data: { 'code.filepath': 'https://x/invite/accept?token=abc&u=auth0|123' } };
    const out = scrubSpanJson(span) as typeof span;
    expect(out.data['code.filepath']).not.toContain('abc');
    expect(out.data['code.filepath']).not.toContain('auth0|123');
  });

  it('CONFIRM-ONLY (marker (iii)): span trace_id / span_id / parent_span_id survive byte-identical', () => {
    // Green on the identity baseline too, by design: this pins marker (iii) against a future
    // "scrub every field" edit, which would silently break FE-to-BE trace linking.
    const span = {
      description: 'GET https://api.x.app/x',
      data: {},
      trace_id: TRACE_ID,
      span_id: 'a1b2c3d4e5f60718',
      parent_span_id: 'b1b2c3d4e5f60718',
    };
    const out = scrubSpanJson(span) as typeof span;
    expect(out.trace_id).toBe(TRACE_ID);
    expect(out.span_id).toBe('a1b2c3d4e5f60718');
    expect(out.parent_span_id).toBe('b1b2c3d4e5f60718');
  });
});
