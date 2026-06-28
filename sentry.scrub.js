/**
 * Shared, pattern-based Sentry PII scrub (threat T-84-01 redaction layer).
 *
 * Imported by all three runtime configs (client/server/edge) and wired into
 * `Sentry.init({ beforeSend })`, plus the client `replayIntegration`'s
 * `beforeAddRecordingEvent` (because `beforeSend` does NOT run on Session Replay
 * events, and `replaysOnErrorSampleRate: 1.0` uploads a replay on every error).
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

// token-bearing URL path segments (magic-link / invite tokens).
const TOKEN_PATH_PATTERNS = [
  /(invite-preview\/info\/)[^/?#]+/gi,
  /(invite\/)[^/?#]+/gi,
];

/**
 * Redact PII patterns within a free-text string. Surrounding non-PII text is
 * preserved (so an exception message keeps its prose, only the JWT is redacted).
 */
function scrubString(str) {
  if (typeof str !== 'string' || str.length === 0) return str;
  return str
    .replace(JWT, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(SECRET_KV, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED);
}

/**
 * Strip a URL's query string entirely and redact known token path segments.
 * Shared by the event-request scrub and the replay-recording scrub.
 */
function scrubUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  let out = url;
  // Strip the query string entirely (it routinely carries magic_token/token).
  const qIndex = out.indexOf('?');
  if (qIndex !== -1) {
    out = `${out.slice(0, qIndex)}?${REDACTED}`;
  }
  // Redact known token path segments.
  for (const re of TOKEN_PATH_PATTERNS) {
    out = out.replace(re, `$1${REDACTED}`);
  }
  // Catch any JWT/email left in the path itself.
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

function deepScrubRecording(value) {
  if (typeof value === 'string') {
    // Treat URL-looking strings (and anything with a query or token segment) via
    // scrubUrl; everything else via scrubString.
    if (/https?:\/\//.test(value) || value.includes('?') || /invite/i.test(value)) {
      return scrubUrl(value);
    }
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = deepScrubRecording(value[i]);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      value[k] = deepScrubRecording(value[k]);
    }
    return value;
  }
  return value;
}

export { scrubString, scrubUrl, scrubEvent, scrubRecordingEvent, REDACTED };
