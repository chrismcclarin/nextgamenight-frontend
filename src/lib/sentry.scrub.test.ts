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
  TOKEN_PATH_PATTERNS_FE_ROUTES,
  TOKEN_PATH_PATTERNS_API_PATHS,
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

describe('scrubString / scrubUrl — the shipped value rules', () => {
  it('scrubString redacts emails and JWT-looking tokens', () => {
    expect(scrubString('mail me at alice@example.com')).toContain(R);
    expect(scrubString('mail me at alice@example.com')).not.toContain('alice@example.com');
    expect(scrubString(`token=${JWT}`)).not.toContain(JWT);
  });

  it('scrubUrl strips the query string entirely', () => {
    const out = scrubUrl(`https://x/rsvp/${RSVP_TOKEN}?magic_token=${JWT}`);
    expect(out).not.toContain(JWT);
    expect(out).toContain(R);
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
    // `api.ts:722` — an authenticated event lookup by UUID.
    expect(scrubString('/rsvp/event/f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(
      '/rsvp/event/f47ac10b-58cc-4372-a567-0e02b2c3d479'
    );
    // `api.ts:734` — the public respond endpoint. Its QUERY carries the token and `scrubUrl`
    // strips the whole query string, but the PATH must survive readable.
    expect(scrubUrl('https://x/rsvp/respond?token=abc&e=1')).toBe(`https://x/rsvp/respond?${R}`);
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
