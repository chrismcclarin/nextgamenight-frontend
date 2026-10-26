// Scrubs session material out of text a Playwright error carries, before anything prints it
// (R8). Pure: no imports, no I/O. The e2e call site is e2e/support/scrubbedFetch.ts, and the
// pin is src/test-utils/scrubSessionHeaders.test.ts.
//
// DECISION Phase 88.6.2-20 (scrub): two rules, applied in this order, and nothing else.
//   1. The header-line rule. A header name from the family cookie, set-cookie, authorization,
//      proxy-authorization matches in any case when no letter, digit, underscore or hyphen
//      precedes it and an optional closing quote, optional spaces and a colon follow it. The
//      closing quote may be escaped by any number of backslashes, as in a header map that was
//      serialized twice (AMENDED code review C-IN-01, 2026-10-25). Everything after that
//      colon, up to the first ESC character or the end of the line, becomes one space plus
//      SCRUBBED. Playwright prints one call-log line per REQUEST
//      header, and it logs RESPONSE headers the same way, which is why set-cookie is in the
//      family: node_modules:playwright-core/lib/coreBundle.js ("for (const [name, value2] of Object.entries(response2.headers))").
//      proxy-authorization is in it for the same reason as authorization.
//   2. The session-pair rule, a second net for the SESSION COOKIE ONLY in any format the line
//      rule misses (prose, JSON, a header folded onto another line); a bearer token or any
//      other cookie in such a format is not caught by it (AMENDED code review C-IN-01,
//      2026-10-25: this said "any format" without naming that limit). A session cookie pair
//      anywhere becomes SCRUBBED, its NAME included, so a log grep for that name reads 0. It is keyed to the
//      @auth0/nextjs-auth0 v3 session cookie name (the ^3.8.0 dependency in package.json). An
//      SDK change that renames the session cookie (Phase 90's v4 move) must update this rule,
//      the T3 fixtures in the pin and any log grep that uses the name, in the same commit.
// Over-redaction is accepted: a matched line loses its value, never its name, so a reader
// still sees which header was sent.
// URL-borne tokens are deliberately NOT scrubbed. Playwright's call log also prints the
// request line (method and URL), and app URLs carry bearer-equivalent tokens:
// src/lib/api.ts ("?magic_token=${encodeURIComponent(token)}"), the rsvp respond link and the
// invite path tokens. In e2e the invite specs route fake constants; only the availability-form
// specs carry a CI-minted magic token. That is safe only while the ML-16 invariants hold,
// .github/workflows/ci.yml ("ML-16 OWNER RULING"): a throwaway MAGIC_TOKEN_SECRET with an
// ephemeral CI database, a CI-only AUTH0_SECRET, and FRONTEND_URL on localhost. If any one
// of them flips, this re-opens and a URL rule belongs here.
// Changing this is a decision, not a cleanup.

export const SCRUBBED = '[scrubbed]';

// Rule 1. The longer names come first in the alternation; the look-behind keeps the cookie
// inside set-cookie, and a lookalike such as x-cookie-policy, from matching on their own.
// The backslashes before the optional quote are an escaped JSON key (code review C-IN-01).
const HEADER_LINE_RE =
  /(?<![A-Za-z0-9_-])(set-cookie|proxy-authorization|cookie|authorization)(\\*["']?)([ \t]*):[^\u001b\r\n]*/gi;

// Rule 2. The name, an optional chunk suffix (.0, .1, ...), the equals sign and a value that
// runs up to a semicolon, whitespace, a quote, a comma or the end.
const SESSION_PAIR_RE = /appSession(?:\.[0-9]+)?=[^;\s"'`,]*/gi;

export function scrubSessionHeaders(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(HEADER_LINE_RE, (_match, name: string, quote: string, spaces: string) => `${name}${quote}${spaces}: ${SCRUBBED}`)
        .replace(SESSION_PAIR_RE, SCRUBBED),
    )
    .join('\n');
}

function textOf(error: unknown): string {
  try {
    return String(error);
  } catch {
    return 'a thrown value that cannot be turned into text';
  }
}

// A NEW Error: the scrubbed message, the name when it is a string, and the scrubbed stack when
// one exists. Nothing else is copied (no cause, no other own property), because each one would
// be a channel the scrub never read.
export function scrubError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(scrubSessionHeaders(textOf(error)));
  const out = new Error(scrubSessionHeaders(error.message));
  if (typeof error.name === 'string') out.name = error.name;
  if (typeof error.stack === 'string') out.stack = scrubSessionHeaders(error.stack);
  return out;
}
