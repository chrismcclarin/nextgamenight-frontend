/**
 * Shared, pattern-based Sentry PII scrub (threat T-84-01 redaction layer).
 *
 * Imported by all three runtime configs (client/server/edge) and wired into
 * `Sentry.init({ beforeSend })`, plus the client `replayIntegration`'s
 * `beforeAddRecordingEvent` (because `beforeSend` does NOT run on Session Replay
 * events, and an on-error replay still uploads at the BOUNDED rate set at
 * `sentry.client.config.js:28` — corrected in Phase 88.6-13, it is no longer 1.0).
 *
 * Redaction is REGEX/PATTERN-based (email, JWT/bearer token, secret/auth/password,
 * long digit runs) — NOT a hardcoded key list — so PII is caught regardless of the
 * key it travels under. Pure functions; safe to unit-test in isolation.
 *
 * scrubEvent covers every standard Sentry PII vector: event.message, exception
 * values, breadcrumb message + full breadcrumb.data, event.user (email/username/ip
 * redacted wholesale), event.request (url, query_string, Authorization/Cookie
 * headers, cookies, and the POST body), and a deep-scrub of event.extra +
 * event.contexts. This holds even if sendDefaultPii / Sentry.setUser are enabled.
 */

const REDACTED = '[REDACTED]';

// --- shared regex set -------------------------------------------------------
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// JWT: three base64url segments separated by dots, starting with the `eyJ` header.
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
// secret/auth/password key=value (or key: value) pairs in free text/query strings.
const SECRET_KV =
  /\b(token|magic_token|secret|password|authorization|api[_-]?key)\b\s*[=:]\s*[^&\s"']+/gi;
// long digit runs (phone numbers, etc.).
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w.])/g;

// key names whose VALUES should be redacted wholesale (regex, not exact-match).
const SECRET_KEY_RE = /token|email|phone|secret|password|authorization|api[_-]?key/i;

/* DECISION Phase 88.6-13 (D3 / review accept-candidate AC-1, RULINGS.md).
   THE AC's NAMESPACE, spelled out because this phase uses `AC-n` in two senses: this is the
   REVIEW's accept-candidate register in `88.6-PLAN-REVIEW-work/RULINGS.md`, NOT the SPEC's
   acceptance criteria. A future reader following the Evidence Rule must be able to resolve
   this marker to the right criterion without guessing.

   (i) A PATTERN LIST HERE, chosen OVER per-sink redaction at the magic-link pages (owner
       ruling 2026-09-09). ** THIS IS NOT THE APP'S ONLY TOKEN-ROUTE LIST, and a maintainer
       who believes it is will publish a live credential. ** There are THREE, named by SYMBOL
       and FILE — never by line number and never with a count, because both go stale:
         - `TOKEN_PATH_PATTERNS`, here, guarding Sentry egress;
         - `TOKEN_ROUTE_PREFIXES` in `src/lib/scrubFeedbackPageUrl.ts`, and
         - its same-named twin in the backend's `routes/feedback.js`,
       the latter two independently guarding the feedback -> GitHub-issue sink (87.8-05
       round-3 security). A token-bearing route belongs in ALL THREE. Adding it here alone
       still publishes the credential into an issue body. The two FE lists are held together
       mechanically by the set-equality arm in `src/lib/sentry.scrub.test.ts`; the BACKEND
       twin has NO cross-repo verifier and is owned by Phase 91.

   (ii) THE PREFIX LOOP LIVES IN `scrubString`, DELIBERATELY — moved there from `scrubUrl`.
        `scrubUrl` is NOT the shared point every sink reaches, which is the belief that let
        this gap ship: `deepScrubRecording` routes to `scrubUrl` only on `https?://`, `?` or
        the literal `invite`, so a relative `/rsvp/<token>` never reached it, and
        `event.message`, `exception.values[].value`, `breadcrumb.message` and all of
        `extra`/`contexts` bypass it entirely. `scrubString` IS that point. Moving it back is
        a decision, not a cleanup.

   (iii) THE GENERIC LONG-HEX BACKSTOP IS DELIBERATELY **NOT** HERE. It lives in `scrubUrl`
         only and is slash-REQUIRED, because Sentry attaches `contexts.trace` to every event
         and its `trace_id` is a bare 32-char lowercase hex string that `SECRET_KEY_RE` does
         not catch. Hoisting the hex rule into `scrubString` redacts Sentry's own trace id
         and silently kills error-to-transaction and FE-to-BE trace linking on every FE
         error. A `trace_id` negative control in the test file pins that.

   (iv) THE FAMILY LIST IS RE-DERIVED, NOT EDITED. Two commands reproduce it:
          find src/app -type d -name '[[]token]'        <- the FE routes.
              THE BRACKET MUST BE ESCAPED. The unescaped `-name '[token]'` is a CHARACTER
              CLASS and matches nothing, which makes the enumeration vacuously "complete".
          grep -nE '(publicFetch|apiFetch).(backtick)/' src/lib/api.ts   <- the API paths,
              i.e. every publicFetch/apiFetch template literal that interpolates a token
              into the PATH. The backtick is SPELLED OUT rather than written: a literal
              backtick inside this block comment makes the oxc lexer treat the rest of the
              file as a template literal and the module fails to parse — the same class of
              hazard plan 88.6-11 hit with a nested comment delimiter. Do not "fix" this
              by writing the character.
        A standing filesystem-derived assertion in the test file re-runs the first one at
        RUN TIME, so a new `[token]` route added without its pattern turns the suite RED
        rather than leaving it green forever.

   (v) THE TOKEN STEP IS SLASH-GUARDED **BECAUSE THIS FUNCTION IS THE REPLAY LEAF** —
       `scrubString` is the fall-through of `deepScrubRecording`, which is wired as
       `beforeAddRecordingEvent`, so it visits every string in every rrweb event on the
       browser MAIN THREAD for the always-on session sample. A route prefix cannot match a
       string containing no `/`, and under `maskAllText: true` that is most of them.
       REMOVING THE GUARD IS A DECISION, NOT A CLEANUP.

   REJECTED, recorded so it is not re-proposed: collapsing these entries into ONE
   alternation. It has no FE-route half to export, so the set-equality arm loses its
   subject, and it contradicts the one-entry-per-live-family rule that makes the list
   readable against the routes.

   REPLACED WHOLESALE in 88.6-13, not appended to. Both previous entries were measured DEAD
   against the live tree: `invite-preview/info/` exists in neither repo, and the flat
   `invite/` entry ATE the `group`/`game` segment so the token SURVIVED
   (`/invite/group/<hex>` -> `/invite/[REDACTED]/<hex>`) while the tokenless `/invite/accept`
   was over-redacted. Appending would have reproduced exactly that: first, and the token
   survives; last, and the route identity is destroyed. */
const TOKEN_PATH_PATTERNS_FE_ROUTES = [
  // Longest prefix first. The FULL route prefix is INSIDE the capture group and there is
  // NO leading path separator outside it — a separator outside the group is EATEN by the
  // replacement, turning `https://x/invite/group/<tok>` into `https://xinvite/[REDACTED]`.
  //
  // THE TOKEN SEGMENT EXCLUDES WHITESPACE (`\s`) as well as `/?#`. The shipped patterns did
  // not, which was harmless while this loop lived in `scrubUrl` — its input is a whole URL
  // with no trailing prose. Moving it into `scrubString` (marker (ii)) changes that: the
  // free-text sinks it now covers are SENTENCES, and without `\s` the matcher runs past the
  // token and eats the rest of the line. Measured: `POST /invites/info/<tok> failed` came
  // back as `POST /invites/info/[REDACTED]`, silently destroying the diagnostic prose this
  // module's own docblock promises to preserve. A token never contains whitespace, so the
  // exclusion costs nothing. Found by this plan's own (c2) arm, not by reading.
  /(availability-form\/)[^/?#\s]+/gi,
  /(restore\/group\/)[^/?#\s]+/gi,
  /(invite\/group\/)[^/?#\s]+/gi,
  /(invite\/game\/)[^/?#\s]+/gi,
  // `rsvp` is the ONE GREEDY FAMILY and carries a tokenless-sibling exclusion.
  // `src/app/rsvp/` contains only `[token]`, so the full route prefix is the bare `rsvp/` —
  // and bare `rsvp/` eats two LIVE authenticated siblings, `/rsvp/event/<id>` (api.ts:722)
  // and `/rsvp/respond?...` (api.ts:734), producing `/rsvp/[REDACTED]/<id>`. That is the
  // same route-identity destruction the flat `invite/` entry caused, through a different
  // door. The exclusion is written NARROWLY — it matches only when the next segment is
  // EXACTLY `event` or `respond` — because a redaction control gets widened into
  // uselessness one convenience at a time. The 43-char base64url positive control in the
  // test file is what holds it narrow, and it STAYS.
  /(rsvp\/)(?!(?:event|respond)(?:[/?#]|$))[^/?#\s]+/gi,
];

const TOKEN_PATH_PATTERNS_API_PATHS = [
  /(groups\/invite-preview\/)[^/?#\s]+/gi,
  /(groups\/restore-preview\/)[^/?#\s]+/gi,
  /(events\/invite-preview\/)[^/?#\s]+/gi,
  /(invites\/info\/)[^/?#\s]+/gi,
];

// token-bearing URL path segments (magic-link / invite tokens), all live families.
const TOKEN_PATH_PATTERNS = [
  ...TOKEN_PATH_PATTERNS_API_PATHS,
  ...TOKEN_PATH_PATTERNS_FE_ROUTES,
];

/* The generic long-hex backstop. NEW in 88.6-13 — no hex rule of ANY width existed here
   before (`grep -nE '0-9a-f\]\{|a-f0-9\]\{'` over this module returned nothing).

   SLASH-REQUIRED, and pinned in characters rather than described, because the three
   candidate readings are not equivalent and two of them BREAK Sentry's own tracing:
     /[0-9a-f]{32,}/gi          -> redacts a bare `trace_id`. BREAKS tracing.
     /(^|\/)[0-9a-f]{32,}/g     -> a bare string is a whole segment. BREAKS tracing.
     /(\/)[0-9a-f]{32,}(?=...)/ -> only inside a PATH. SAFE. <- this one.
   Sentry attaches `contexts.trace` to every event (`@sentry/core baseclient.js:524-527`)
   and its `trace_id` is a bare 32-char lowercase hex (`utils-hoist/misc.js:12-19`) that
   `SECRET_KEY_RE` does not catch, so it reaches the string scrubbers. Breaking it kills
   error-to-transaction and FE-to-BE trace linking on every FE error, and NONE of the
   over-redaction negative controls would catch that — which is why this ships with its own
   positive control AND a `trace_id` negative control in the test file.

   IT IS A BY-CONSTRUCTION BACKSTOP, NOT THE `rsvp` MITIGATION. Token formats were derived
   from the backend before this was written: `rsvp` is a 43-char base64url HMAC
   (`routes/rsvp.js:95-100`) and `availability-form` is a JWT
   (`services/magicTokenService.js:37-52`, already caught by the JWT rule above) — NEITHER
   IS HEX. The AC-1 ruling assumed a 32+-hex floor would cover the routes it named; it does
   not. This rule buys only `restore/group` plus the four API paths, all of which the prefix
   entries already cover. */
const LONG_HEX_PATH_SEGMENT = /(\/)[0-9a-f]{32,}(?=$|[/?#])/g;

/**
 * Redact PII patterns within a free-text string. Surrounding non-PII text is
 * preserved (so an exception message keeps its prose, only the JWT is redacted).
 */
function scrubString(str) {
  if (typeof str !== 'string' || str.length === 0) return str;
  let out = str
    .replace(JWT, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(SECRET_KV, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED);

  // The token-path step, moved here from `scrubUrl` in 88.6-13 — see marker (ii). This is
  // the ONE path every sink reaches: `event.message`, every `exception.values[].value`,
  // every `breadcrumb.message`, all of `extra`/`contexts` via `deepScrub`, AND the replay
  // relative-path branch. SLASH-GUARDED — see marker (v); removing the guard is a decision,
  // not a cleanup.
  if (out.indexOf('/') === -1) return out;
  // Prefix-PRESERVING: `$1` keeps the route identity and only the token segment goes. Do
  // NOT fold these into the flat `.replace(X, REDACTED)` chain above — that yields
  // `https://x/[REDACTED]`, destroys the route identity, and still passes both a
  // `not.toContain(JWT)` and a redaction-placeholder `toContain` assertion.
  for (const re of TOKEN_PATH_PATTERNS) {
    out = out.replace(re, `$1${REDACTED}`);
  }
  return out;
}

/**
 * Strip a URL's query string entirely, apply the long-hex path backstop, then delegate.
 * Shared by the event-request scrub and the replay-recording scrub.
 *
 * 88.6-13: the token-prefix loop MOVED OUT of here into `scrubString` (marker (ii)), which
 * this function already ended by calling — so this function's observable behaviour on a
 * token-bearing URL is unchanged, while every non-URL sink gained the coverage.
 */
function scrubUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  let out = url;
  // Strip the query string entirely (it routinely carries magic_token/token).
  const qIndex = out.indexOf('?');
  if (qIndex !== -1) {
    out = `${out.slice(0, qIndex)}?${REDACTED}`;
  }
  // The generic long-hex backstop lives HERE ONLY, never in `scrubString` — Sentry's own
  // `trace_id` is a bare 32-hex string. See the constant's own note.
  out = out.replace(LONG_HEX_PATH_SEGMENT, `$1${REDACTED}`);
  // The token-prefix loop, the JWT/email/phone rules, and the slash guard all live in
  // `scrubString`. One redaction path, not two.
  return scrubString(out);
}

/**
 * Deep-walk an arbitrary object, redacting string values. If a key name matches
 * SECRET_KEY_RE its value is redacted wholesale; otherwise string values are
 * pattern-scrubbed (so PII is caught by VALUE even when the key looks innocent).
 * Mutates in place and returns the same reference.
 */
function deepScrub(value, keyHint) {
  if (typeof value === 'string') {
    if (keyHint && SECRET_KEY_RE.test(keyHint)) return REDACTED;
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = deepScrub(value[i], keyHint);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      value[k] = deepScrub(value[k], k);
    }
    return value;
  }
  return value;
}

/**
 * The Sentry `beforeSend` redaction layer. Mutates and returns the event.
 */
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (typeof event.message === 'string') {
    event.message = scrubString(event.message);
  }

  if (event.exception && Array.isArray(event.exception.values)) {
    for (const ex of event.exception.values) {
      if (ex && typeof ex.value === 'string') ex.value = scrubString(ex.value);
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const bc of event.breadcrumbs) {
      if (!bc) continue;
      if (typeof bc.message === 'string') bc.message = scrubString(bc.message);
      if (bc.data && typeof bc.data === 'object') {
        // URL-bearing fields get the stronger scrubUrl (strips the whole query
        // string); everything else (console-arg captures, logger ctx forwarded
        // via Sentry.addBreadcrumb({data})) is deep-scrubbed by value/key so PII
        // is caught regardless of the key it travels under.
        for (const field of ['url', 'from', 'to']) {
          if (typeof bc.data[field] === 'string') {
            bc.data[field] = scrubUrl(bc.data[field]);
          }
        }
        deepScrub(bc.data);
      }
    }
  }

  // event.user: email / username / ip are identifying PII. Redact them wholesale
  // (plain usernames won't trip the value patterns), then deep-scrub the rest.
  if (event.user && typeof event.user === 'object') {
    for (const field of ['email', 'username', 'ip_address']) {
      if (typeof event.user[field] === 'string') event.user[field] = REDACTED;
    }
    deepScrub(event.user);
  }

  if (event.request && typeof event.request === 'object') {
    if (typeof event.request.url === 'string') {
      event.request.url = scrubUrl(event.request.url);
    }
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = REDACTED;
    }
    // Authorization / Cookie headers carry bearer JWTs and the Auth0 session —
    // redact those keys wholesale, then deep-scrub remaining header values.
    if (event.request.headers && typeof event.request.headers === 'object') {
      for (const h of Object.keys(event.request.headers)) {
        if (/authorization|cookie/i.test(h)) event.request.headers[h] = REDACTED;
      }
      deepScrub(event.request.headers);
    }
    // Cookies carry the Auth0 session wholesale.
    if (typeof event.request.cookies !== 'undefined') {
      event.request.cookies = REDACTED;
    }
    // The POST body can carry magic-link / verify tokens and credential payloads.
    if (typeof event.request.data !== 'undefined') {
      event.request.data = deepScrub(event.request.data);
    }
  }

  if (event.extra && typeof event.extra === 'object') {
    deepScrub(event.extra);
  }
  if (event.contexts && typeof event.contexts === 'object') {
    deepScrub(event.contexts);
  }

  return event;
}

/**
 * Session Replay recording-event scrub (A1). `beforeSend` does NOT fire on replay
 * events, so recorded navigation/fetch URLs need their own redaction before the
 * replay uploads. Deep-walks the recording event and redacts any URL-bearing or
 * PII-bearing string. Mutates and returns the event.
 */
function scrubRecordingEvent(replayEvent) {
  if (!replayEvent || typeof replayEvent !== 'object') return replayEvent;
  return deepScrubRecording(replayEvent);
}

/*
 * 88.6-13 item 4(h): this walker now takes a `keyHint` and applies the SAME key-based
 * wholesale redaction the event walker has always applied at `deepScrub`.
 *
 * THE ASYMMETRY IT CLOSES, measured 2026-09-15: `deepScrub(value, keyHint)` redacts on the
 * key; `deepScrubRecording(value)` took NO key parameter at all and its object branch
 * recursed WITHOUT passing the key. So on the replay egress path a value sitting under an
 * obviously sensitive key survived unless it matched JWT/BEARER/SECRET_KV/EMAIL/PHONE BY
 * VALUE. That widens with this phase: `logger.info(msg, ctx)` becomes
 * `Sentry.addBreadcrumb({ data: ctx })` (`src/lib/logger.ts`) and AC-2 routes ~100 call
 * sites there.
 *
 * This does NOT contradict marker (ii)'s "the URL router needs no edit" — it does not. The
 * router is the `https?://` / `?` / `invite` branch below and is untouched; the key hint is
 * a different branch. Arrays pass the hint THROUGH (the elements share the parent's key);
 * objects replace it with their own, exactly as `deepScrub` does.
 *
 * NOT VERIFIED BY EXECUTION: that Sentry's Session Replay actually routes breadcrumb `data`
 * objects through `beforeAddRecordingEvent`. That is reasoned from the SDK's documented
 * behaviour. If replay does not carry breadcrumb `data`, the phase-widening argument above
 * weakens — the code asymmetry and the fix stand either way.
 */
function deepScrubRecording(value, keyHint) {
  if (typeof value === 'string') {
    if (keyHint && SECRET_KEY_RE.test(keyHint)) return REDACTED;
    // Treat URL-looking strings (and anything with a query or token segment) via
    // scrubUrl; everything else via scrubString.
    if (/https?:\/\//.test(value) || value.includes('?') || /invite/i.test(value)) {
      return scrubUrl(value);
    }
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = deepScrubRecording(value[i], keyHint);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      value[k] = deepScrubRecording(value[k], k);
    }
    return value;
  }
  return value;
}

export {
  scrubString,
  scrubUrl,
  scrubEvent,
  scrubRecordingEvent,
  REDACTED,
  // Exported SEPARATELY from the API-path entries so the set-equality arm in
  // `src/lib/sentry.scrub.test.ts` has an FE-ROUTE subject to compare against
  // `TOKEN_ROUTE_PREFIXES`. The cross-module import lives in the TEST, never here — this
  // module's docblock promises pure functions safe to unit-test in isolation, and it must
  // not import a `.ts` module.
  TOKEN_PATH_PATTERNS_FE_ROUTES,
  TOKEN_PATH_PATTERNS_API_PATHS,
};
