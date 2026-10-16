/**
 * Shared, pattern-based Sentry PII scrub (threat T-84-01 redaction layer).
 *
 * Imported by all three runtime configs (client/server/edge) and wired into
 * `Sentry.init({ beforeSend })`, plus the client `replayIntegration`'s
 * `beforeAddRecordingEvent` (because `beforeSend` does NOT run on Session Replay
 * events, and an on-error replay still uploads at the BOUNDED rate set by the
 * `replaysOnErrorSampleRate` key in `sentry.client.config.js` — corrected in Phase 88.6-13,
 * it is no longer 1.0; anchored on the KEY, never a line number, which drifts).
 *
 * FOUR SEPARATELY HOOKED EGRESS VECTORS — `beforeSend` reaches only the first:
 *   1. error events        -> `beforeSend`              -> `scrubEvent`
 *   2. Session Replay      -> `beforeAddRecordingEvent` -> `scrubRecordingEvent`
 *   3. transactions        -> `beforeSendTransaction`   -> `scrubTransaction` (88.6-61, H-1)
 *   4. spans (child spans AND standalone INP/CLS spans)
 *                          -> `beforeSendSpan`          -> `scrubSpanJson`    (88.6-61, H-1)
 * The CLIENT config wires all four. The server/edge configs wire only `beforeSend` today —
 * server init never runs (no `instrumentation.ts`); wiring 3 and 4 there is owned by Phase 90
 * (`.planning/deferred/phase-90.md`, the "Server-side Sentry never initialises" entry).
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
 * In an SDK element selector, nothing from the first aria-label, title or alt value onward
 * survives except an allowlisted static label prefix; that is redactNamedAttributes, the first
 * step of scrubString and of scrubUrl (88.6.1-76, P-09).
 */

const REDACTED = '[REDACTED]';

// --- shared regex set -------------------------------------------------------
// DECISION Phase 88.6-57 (CR-501, 88.6-REVIEW.md, dated 2026-09-28): the separator is
// `@` OR `%40`. `encodeURIComponent` is what every query-string producer in `src/lib/api.ts`
// runs (e.g. `friendshipsAPI.searchUserByEmail`), so a searched address reached Sentry as
// `bob%40example.com` and this rule — literal `@` only — let it through. The scrubber is the
// layer that must fail INDEPENDENTLY of any one call site, so it matches the encoded form
// itself. Chosen OVER a `decodeURIComponent` pre-pass in `scrubString` (REJECTED: it throws
// `URIError` on a malformed `%` sequence and would crash `beforeSend`, dropping the whole
// event). Only the separator widened — the local-part and dotted-domain shape still bound it
// (pinned by the over-redaction negatives in `src/lib/sentry.scrub.test.ts`).
// AMENDED Phase 88.6.1-08 (EMAIL start, scoped check M-39): the local part is now bounded to 64
// characters (RFC 5321's local-part limit), because without a bound a long run with no address
// in it was re-scanned from every position (about 3.8 s for 50,000 letters, 9.9 s for 40,000
// a- pairs, on the main thread, in every scrub sink; 6.3 s for the 50,000 letters on the
// executor's machine, 2026-10-15). CHOSEN over (a) leaving it, which keeps a main-thread stall
// reachable from any replay string naming invite, and (b) a run-start lookbehind in front of the
// local part, which is also linear but leaks a second address glued onto the end of a first by
// a local-part character (a@b.com_c@d.com came out as [REDACTED]_c@d.com). ACCEPTED COST: a
// local part longer than 64 characters, which no deliverable mailbox has, is redacted only from
// its 64th-from-last character, so its head stays in clear. The over-redaction negatives (a bare
// %40 alone, /games?q=50%40off) and every email positive in the suite are unchanged.
// Widening or removing the 64-character bound is a decision, not a cleanup.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// JWT: three base64url segments separated by dots, starting with the `eyJ` header.
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
// DECISION Phase 88.6.1-08 (W007, AC-34): secret/auth/password key=value (or key: value) pairs
// in free text and query strings. The key group is CHOSEN as a bounded word prefix plus a
// camelCase run in front of `token` / `secret` / `password`: up to three `word_` / `word-`
// prefixes, then any run of letters and digits running straight into the keyword. That catches
// `access_token`, `id_token`, `refresh_token`, `client_secret`, `x-auth-token`, `accessToken`
// and `idToken` (`magic_token` is now one of them, so its separate alternative is gone). One
// optional quote on each side of the separator catches a quoted pair (`"refresh_token":"v1"`,
// `refresh_token: "v1"`); `scrubString` re-emits the quote whose partner sat outside the
// match, so the quotes stay balanced. The `\b` after the key keeps `token_count`, `tokens`,
// `password_reset`, `passwordless` and `mytokens` out (pinned by the W007 NEGATIVE case in
// `src/lib/sentry.scrub.test.ts`). REJECTED, each for a reason:
//  - listing the three OAuth keys: a key list is what the module header says this layer is
//    NOT, and it misses `client_secret` / `csrf_token`;
//  - an unbounded `*` repeat on the word-prefix group: `scrubString` is the replay leaf
//    (marker (v) below) and the `{0,3}` bound keeps it linear. ACCEPTED COST: a snake key of
//    four or more words before the keyword (`a_b_c_d_token=`) is out of scope;
//  - the review's leading-delimiter capture: it consumes the delimiter unless re-emitted, and
//    `\b` already supplies the boundary;
//  - separator-only matching, as first planned: a quoted key or value (JSON, `key: "value"`)
//    passed whole, and opaque refresh tokens are not caught by the JWT rule;
//  - narrowing the value side so prose survives (owner ruling #10, 2026-10-13, accepted cost,
//    kept fail-safe): the rule eats ONE word after a `<word>-token:` (or `_token:`, camelCase)
//    colon followed by prose, so `Invalid refresh-token: expired session` reads
//    `Invalid [REDACTED] session` (pinned). Our own three messages that end in `token:`
//    (`src/app/components/ManageMembers.js:358`, `src/app/components/FriendInvitePanel.js:397`,
//    `src/app/gameDetail/page.js:854`; anchor `invite token:', errCtx(err)` at all three) pass
//    the error as structured context through `errCtx` (`src/lib/logger.ts:89`, anchor
//    `export function errCtx`; name and message only), never concatenated, so the message ends
//    at the colon and this rule matches nothing there. Any narrowing that spared the prose word
//    (a minimum value length, requiring a digit or a non-letter) would also spare short or
//    all-letter real tokens (`x-auth-token: abc`), so the fail-safe direction is kept.
// Widening or unbounding the prefix is a decision, not a cleanup.
// DECISION Phase 88.6.1-76 (escaped quotes, carry-in from 88.6.1-08's deferred item): text that
// is serialised a SECOND time puts a backslash before every quote, and the pair leaked
// (refresh_token: \"v1x\" came back with v1x in it; the JSON-in-JSON pair came back whole).
// CHOSEN: each optional quote may carry ONE leading backslash, and a backslash ends the value
// only when it escapes a quote. So the escaped pair redacts to the same shape as the plain
// one, escapes kept: \"[REDACTED]\" and {\"[REDACTED]\"}. The key group is untouched, so no
// new KEY is matched; the only new matches are pairs this rule already names, written with
// escaped quotes. Both value alternatives start on disjoint characters, so the rule stays
// linear. REJECTED: dropping the backslash from the value class outright. A value that holds a
// bare backslash (password=ab\cd) would then leave its tail behind, which narrows a credential
// control. REJECTED: leaving the value class as it was. It ate the escaping backslash of the
// closing quote, so the output read \"[REDACTED]" with its closing quote half-escaped.
// Removing the backslash allowance or the quote-escape exception is a decision, not a cleanup.
const SECRET_KV =
  /\b((?:[a-z0-9]+[_-]){0,3}[a-z0-9]*(?:token|secret|password)|authorization|api[_-]?key)\b(\\?["'])?\s*[=:]\s*(\\?["'])?(?:[^&\s"'\\]|\\(?!["']))+/gi;
// long digit runs (phone numbers, etc.).
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w.])/g;
// DECISION Phase 88.6-59 (review MEDLOW-11, dated 2026-09-29): Auth0 subs —
// `<connection>|<id>` or its `encodeURIComponent` form `<connection>%7C<id>`. The one apiFetch
// path that carries a sub is `usersAPI.getUser(user?.sub …)` (`src/lib/hooks/useSelfIdentity.ts`)
// -> `/users/${encodeURIComponent(sub)}`, so a failed self-lookup put `auth0%7C<id>` into the
// `API Error (…)` breadcrumb message and its `data.endpoint`, and NEITHER form was redacted (a
// hex `auth0|<id>` survived even unencoded; an all-numeric Google id was caught only by accident,
// by PHONE). SEPARATOR-GUARDED on purpose, twice over: the literal `|` / `%7C` is REQUIRED by the
// pattern AND checked with `indexOf` before the regex runs in `scrubString`, so it stays cheap on
// the replay leaf (marker (v) below) and can never widen onto a bare hex id such as Sentry's own
// `trace_id` (marker (iii) below). The `\b` keeps a connection name from matching mid-word
// (`timeline|x`). Applied BEFORE `PHONE` so a numeric Google id is redacted by THIS rule, keeping
// its connection prefix readable, not by accident. Chosen OVER stripping ids from the `endpoint`
// breadcrumb inside `apiFetch` (REJECTED: the scrubber is the layer that must fail INDEPENDENTLY
// of any one call site, and the fetch/console breadcrumb channels carried the same URL before
// this phase). Removing the guard or the ordering is a decision, not a cleanup.
const AUTH0_SUB =
  /\b((?:[a-z0-9-]+-oauth2|auth0|email|sms|windowslive|facebook|twitter|github|apple|line))(?:\||%7C)([A-Za-z0-9._-]+)/gi;

// key names whose VALUES should be redacted wholesale (regex, not exact-match).
const SECRET_KEY_RE = /token|email|phone|secret|password|authorization|api[_-]?key/i;

// DECISION Phase 88.6.1-08 (P-10, token segment end): ONE definition of where a token segment
// ends. CHOSEN: this constant is what the nine families' token classes, the rsvp sibling
// terminator and the long-hex terminator are all built from (with `new RegExp`). The rsvp
// nested-path lookbehind is the one exception, on purpose: its parent segment is a
// path-character ALLOWLIST (see the W012 marker on the rsvp entry), because a parent segment
// built from this set lets a query value pose as a parent and leaks the whole token.
// WHY THESE CHARACTERS: slash, query, hash, whitespace, both quote marks, the backtick, all three
// bracket pairs, both angle brackets, comma and semicolon. Each is punctuation that closes or
// separates text around a path, and the backend mints only hex
// (`routes/groups.js:601`, `routes/events.js:1274`, `routes/invites.js:404`,
// `services/groupRecoveryService.js:175`, each `randomBytes(32).toString('hex')`), base64url
// (`routes/rsvp.js:100`, `.digest('base64url')`) and a JWT
// (`services/magicTokenService.js:38`, `jwt.sign(`), all in periodictabletopbackend_v2/Sonnet,
// none of which contains any of them, so ending there cannot cut a token short.
// REJECTED (a): editing the class in eleven places; copying one class into nine literals is how
// one swallowing class shipped in every family at once (plan 58 ledger row P-10).
// REJECTED (b): narrowing the class to the token alphabet (letters, digits, dot, underscore,
// hyphen). A future token format with one more character would leave its tail behind, and a
// credential control must fail safe.
// REJECTED (c): adding the full stop. It is in the JWT alphabet. ACCEPTED COST: a sentence-final
// full stop right after a token is still swallowed into the placeholder.
// Colon and exclamation mark stay out: they are legal path characters and were not in the
// recorded LOW. It is raw text for `new RegExp`, so the whitespace class, the backtick escape
// and the escaped closing square bracket reach the regex engine unchanged.
// Removing a character from this set, or giving one family its own class again, is a decision,
// not a cleanup.
const TOKEN_SEGMENT_END = String.raw`/?#\s"'\x60()[\]{}<>,;`;

// DECISION Phase 88.6.1-76 (P-09, names in element selectors).
// WHAT. Sentry writes every DOM selector with htmlTreeAsString, which always appends the
// aria-label, type, name, title and alt attributes with the RAW, unescaped value
// (@sentry/core 8.55.2 build/esm/utils-hoist/browser.js:114 allowedAttrs, written at :118). In
// this app those values hold group and member names (src/app/components/ManageMembers.js:619
// "Role for", src/app/components/ClickableMemberName.js:544 "Add", src/app/friends/page.js:955
// "Select", src/app/components/grouplist.js:501 alt={group.name}), and this phase adds D-19's
// gear name and the N8 bell names.
// CHOSEN. From the FIRST aria-label, title or alt opener, drop everything to the end of the
// string, except an allowlisted static label prefix (the owner's ask of 2026-10-05: "when
// sending to Sentry, send customize"). Everything before that opener stays: the tags, ids and
// classes of the chain up to and including the element that carries the name, normally the
// clicked control, so a breadcrumb still says which control was clicked
// (div.card > button.btn[aria-label="Customize [REDACTED]"]).
// WHY BLANK TO THE END. The SDK writes values unescaped, so the END of a name cannot be found
// from the string: a crafted name can close the value, inject a fake element and reopen an
// attribute. The START of the value is real; its end is not. So the rule keeps only what is
// certainly the app's: the text before the opener, and an allowlisted prefix. Planner probe
// 2026-10-05 on real SDK output: the rule that tried to find the end let an injected class
// through on all four crafted trees.
// COST, written down so nobody "fixes" it back. When an ANCESTOR in the captured chain carries
// a name-bearing attribute, the clicked control inside it is dropped too (sentry.scrub.test.ts,
// P-09 battery pair 4). The clicked control's own type and name attributes are dropped, and so
// is the rest of an exception sentence that embeds a selector. Replay still records the
// clicked element in its attribute map, and the 80-character channels rarely capture an
// ancestor at all. Recovering the dropped descendants is possible at the source: the SDK
// prints a static data-sentry-element value IN PLACE of an element's attributes
// (browser.js:79-85). That is a per-site markup choice for the owner, not needed for privacy.
// THE PREFIX LIST is the app's own static label text, so keeping it reveals no user text: a
// crafted name can only make one of these twelve phrases appear. A label whose text drifts
// from the list costs debugging only, never privacy. Add a prefix when a templated label is
// added.
// WHERE, and why both entry points. The selector reaches Sentry five ways and every one ends
// in scrubString or scrubUrl: (1) error-event ui.* breadcrumbs, through scrubEvent; (2)
// replay's own click and keyDown breadcrumbs (@sentry-internal/replay 8.55.2
// build/npm/esm/index.js:4777), through deepScrubRecording; (3) INP, CLS and interaction span
// names, through the scrubSpanJson description; (4) LCP and CLS attributes on the pageload
// root span, through scrubTransaction into scrubEvent's contexts walk; (5) a serialized DOM
// Event target under extra, through deepScrub. scrubUrl's query strip would otherwise cut a
// selector at a question mark inside a name before scrubString saw it, so the rule runs first
// in both. It is idempotent, so the scrubUrl-then-scrubString double pass changes nothing.
// THE INVARIANT. Tags, ids, classes and type / name values carry no user text in this app,
// because text before the first opener is kept. The P-09 INVARIANT case in
// sentry.scrub.test.ts scans the source for the day one does.
// REJECTED (a): beforeBreadcrumb in Sentry.init. It reaches only core breadcrumbs (@sentry/core
// build/esm/breadcrumbs.js:30, before replay's hook at :36); it never sees replay's own click
// breadcrumbs (index.js:4777, added straight to the recording), nor the INP, CLS or LCP
// selectors, so it would be a second mechanism for one channel in five.
// REJECTED (b): breadcrumbsIntegration({ dom: false }). It drops every click breadcrumb and
// reaches neither replay nor spans.
// REJECTED (c): dom.serializeAttribute. It can only ADD attributes: it replaces the id and
// classes and still appends the five (browser.js:92-120).
// REJECTED (d): blanking the whole selector. That loses which control was clicked.
// REJECTED (e): finding where each value ends (the first version of this rule). A crafted name
// fakes the end (probe, all four crafted trees).
// REJECTED (f): (e) plus a strict-grammar check that blanks a record that does not parse. In
// the probe the grammar (HTML tags only, a type enum, the app's name shapes, the SDK attribute
// order, at most five elements) accepted every crafted output: the injected text rides in a
// fake element's class, so only an allowlist of every class and id token in the app would
// close it, and that cannot be maintained.
// REJECTED (g): making every name quote-free at the source, so a value would end at the first
// quote. There is no choke point (61 dynamic name-bearing attribute lines), a scan cannot
// follow 25 prop-spread lines, and a visible title tooltip would show a typographic quote.
// KEY RULE. NAME_ATTRIBUTE_KEYS applies in the REPLAY walker only, to replay's attribute map
// (index.js:4748), as a second control beside the snapshot mask sentry.client.config.js sets
// in maskAttributes. It is NOT in deepScrub: error-event click breadcrumbs carry only
// ui.component_name (@sentry/browser 8.55.2 build/npm/esm/integrations/breadcrumbs.js:127),
// and title is an ordinary key in log context. It is an ADDITIVE key rule of the same kind as
// SECRET_KEY_RE; the module header's pattern-first rule stands.
// Keeping anything after the first name-bearing opener other than an allowlisted prefix,
// removing an attribute from the list, moving this out of scrubString or scrubUrl, or
// narrowing it to one channel is a decision, not a cleanup.
// No flags on purpose: it matches only the FIRST opener, and the SDK writes attribute names in
// lower case.
const FIRST_NAMED_ATTRIBUTE = /\[(aria-label|title|alt)="([\s\S]*)$/;
const NAMED_ATTRIBUTE_PREFIXES = Object.freeze([
  // The bell's friend and invite rows (copy row N8; plan 88.6.1-44).
  'Accept friend request from ',
  'Decline friend request from ',
  'Accept invite to ',
  'Decline invite to ',
  // The group card (D-19; plan 88.6.1-54).
  'Invite member to ',
  'Customize ',
  // Existing templated labels: createEvent.js:1408, BallotOptionsEditor.js:71,
  // ManageMembers.js:619, NextGameNightCard.tsx:464, friends/page.js:955,
  // ClickableMemberName.js:544 (all under src/app).
  'Dismiss undo for ',
  'Remove game option ',
  'Role for ',
  'RSVP for ',
  'Select ',
  'Add ',
]);
const NAME_ATTRIBUTE_KEYS = new Set(['aria-label', 'title', 'alt']);

function redactNamedAttributes(str) {
  // The replay-leaf guard (marker (v)): these string functions run on every replay Custom
  // event, so a string with no attribute value in it returns at once.
  if (str.indexOf('="') === -1) return str;
  return str.replace(FIRST_NAMED_ATTRIBUTE, (_m, attr, value) => {
    let keep = '';
    for (const prefix of NAMED_ATTRIBUTE_PREFIXES) {
      if (prefix.length > keep.length && value.startsWith(prefix)) keep = prefix;
    }
    return `[${attr}="${keep}${REDACTED}"]`;
  });
}

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
       * [CORRECTED 2026-09-29 — plan 88.6-60, review MEDLOW-23 / N1: the SCOPE stated above
       * is FALSE; the guard itself stands. `beforeAddRecordingEvent` does NOT visit every rrweb
       * event. In the installed `@sentry-internal/replay` 8.55.2 it runs ONLY on Custom events:
       * `maybeApplyCallback` gates the call on `isCustomEvent(event)`
       * (`build/npm/esm/index.js:6015`; `isCustomEvent` at `:5886`). Custom events are the
       * replay's breadcrumb and performance entries (navigation, fetch, click), so THOSE are
       * what reach `deepScrubRecording` and this leaf. It never sees rrweb FullSnapshot,
       * IncrementalSnapshot or Meta events. Two consequences:
       *   - the cost premise the old text implied is false: inlined stylesheets and DOM
       *     mutations never reach this function, so the slash guard is cheap insurance, not a
       *     hot-path necessity. It STAYS (harmless; removing it is still a decision).
       *   - NOT COVERED BY THIS LAYER: the Meta event's `href: window.location.href`
       *     (`index.js:3927`) and DOM `href` attributes in snapshots. `maskAttributes`
       *     defaults to `['title', 'placeholder']` (`:9454`) and `maskAllText` masks text
       *     nodes only. So on a replay-sampled session that lands on a token route, the
       *     tokened URL is outside this hook. Whether one has actually reached a replay is
       *     OPEN: owner check `R-7` (`88.6-CODE-REVIEW-work/RULINGS.md`; review N1).
       * DECISION Phase 88.6-60 (review N1): the FE-only mitigation (route-gated replay init
       * plus `maskAttributes` including `href`) is deliberately NOT added here, chosen OVER
       * adding it pre-emptively, because N1 is an owner check first (`R-7`). Its absence is
       * a pending decision, not an oversight. It is not a claimed leak either.]
       * [SHIPPED 2026-09-29 — `R-7-RULING: fix-now` (owner check: no token-route replay in
       * 90 days; ruling on the mechanism, not on a capture). The mitigation lives in
       * `sentry.client.config.js` (replay not registered when `isTokenBearingPath` is true;
       * `maskAttributes` gains `href`) and the predicate in `src/lib/scrubFeedbackPageUrl.ts`
       * reuses `TOKEN_ROUTE_PREFIXES` plus a new `TOKEN_QUERY_ROUTES` for `/invite/accept`.
       * Pinned by `src/lib/sentryClientReplayGate.test.ts`. THIS leaf is unchanged.]
       * [CORRECTED 2026-10, 88.6.1-76: the href mask is inert in 8.55.2 (rrweb returns href
       * before the mask function); token-route links are blocked by selector in
       * sentry.client.config.js instead.]

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
  // [AMENDED 2026-10, 88.6.1-08, P-10: the segment now ends at TOKEN_SEGMENT_END, which also
  // covers both quote marks, the backtick, all three bracket pairs, both angle brackets, comma
  // and semicolon, because a quoted or bracketed path lost its closing character into the
  // placeholder (plan 58 ledger row P-10). No minted token contains any of them (the backend
  // generator cites are in the P-10 marker on TOKEN_SEGMENT_END). Each entry below is a
  // `new RegExp` over that one constant, with its capture group still FIRST in the source.]
  new RegExp(String.raw`(availability-form\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  new RegExp(String.raw`(restore\/group\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  new RegExp(String.raw`(invite\/group\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  new RegExp(String.raw`(invite\/game\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  // `rsvp` is the ONE GREEDY FAMILY and carries a tokenless-sibling exclusion.
  // `src/app/rsvp/` contains only `[token]`, so the full route prefix is the bare `rsvp/` —
  // and bare `rsvp/` eats two LIVE authenticated siblings, `/rsvp/event/<id>` (api.ts:1087,
  // `/rsvp/event/${event_id}`) and `/rsvp/respond?...` (api.ts:1109, `/rsvp/respond?token=`),
  // producing `/rsvp/[REDACTED]/<id>`. That is the
  // same route-identity destruction the flat `invite/` entry caused, through a different
  // door. The exclusion is written NARROWLY — it matches only when the next segment is
  // EXACTLY `event` or `respond` — because a redaction control gets widened into
  // uselessness one convenience at a time. The 43-char base64url positive control in the
  // test file is what holds it narrow, and it STAYS.
  //
  // DECISION Phase 88.6.1-08 (W012): CHOSEN, two narrowings that stay fail-safe.
  //  - The sibling lookahead ends at TOKEN_SEGMENT_END, so a sibling word followed by prose
  //    (`rsvp/event is broken`) or by closing punctuation (a quoted `"/rsvp/event"`) survives.
  //  - A NESTED `<char>/<seg>/rsvp/` is not the token route: the lookbehind AFTER the capture
  //    group rejects a match whose `rsvp/` follows a path character, a slash and a segment made
  //    ONLY of path characters (letters, digits, dot, underscore, tilde, percent, hyphen). That
  //    parent segment is a POSITIVE allowlist, so any other character (a quote, comma, `&`,
  //    `=`, `|`, `:`, `+`, `@`, a bracket, whitespace, a non-ASCII letter) breaks the exclusion
  //    and the token is redacted.
  // WHY IT IS SAFE: the FE route `src/app/rsvp/[token]` is a ROOT route (it is the only rsvp
  // directory under `src/app`, with no route group or parallel segment above it), and no
  // `api.ts` path carries an rsvp token in its PATH (respond carries it in the query,
  // api.ts:1109). The positive battery in `src/lib/sentry.scrub.test.ts` (W012 "narrows nothing
  // it must catch") covers every first-segment shape, and the standing `[token]`-directory arm
  // would red a future NESTED token route.
  // REJECTED: (a) leaving nested paths over-redacted, which loses diagnostic text, is named by
  // the SPEC edge row R13 and is fixable safely; (b) a leading lookbehind before the capture
  // group, which breaks the set-equality arm's parser (it reads the text between the source's
  // first open and close paren); (c) two other parent-segment definitions, each of which leaked
  // the whole token: "any non-slash, non-space run", which let a JSON-listed previous path pose
  // as a parent segment (P-10 case D1), and the negated end-set, which let a query value (`&`,
  // `=`) or a parent holding `|`, `:` or a non-ASCII letter pose as one (plan review r1 D14,
  // W012 battery). A negated set turns every unforeseen separator into a leak; an allowlist
  // turns it into a redaction. Brackets and the colon are legal path characters but stay out
  // of the allowlist: brackets reopen `/a/[b]/rsvp/<t>` and the colon reopens
  // `https://x.app/a/b:/rsvp/<t>` (both pinned).
  // Moving the lookbehind before the capture group, widening its parent-segment allowlist
  // beyond path characters, or widening the sibling list, is a decision, not a cleanup.
  new RegExp(
    String.raw`(rsvp\/)(?<![A-Za-z0-9._~%-]\/[A-Za-z0-9._~%-]+\/rsvp\/)(?!(?:event|respond)(?:[${TOKEN_SEGMENT_END}]|$))[^${TOKEN_SEGMENT_END}]+`,
    'gi'
  ),
];

const TOKEN_PATH_PATTERNS_API_PATHS = [
  new RegExp(String.raw`(groups\/invite-preview\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  new RegExp(String.raw`(groups\/restore-preview\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  new RegExp(String.raw`(events\/invite-preview\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
  new RegExp(String.raw`(invites\/info\/)[^${TOKEN_SEGMENT_END}]+`, 'gi'),
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
   entries already cover.

   [AMENDED 2026-10, 88.6.1-08, P-10: the terminator is now the shared TOKEN_SEGMENT_END set, so
   a hex segment followed by whitespace, a quote or a bracket is caught; the slash requirement
   is unchanged, and the trace_id control still holds.] */
const LONG_HEX_PATH_SEGMENT = new RegExp(String.raw`(\/)[0-9a-f]{32,}(?=$|[${TOKEN_SEGMENT_END}])`, 'g');

// DECISION Phase 88.6.1-08 (W007 fragments): CHOSEN, a URL-anchored fragment strip, applied in
// `scrubUrl` only. A `#` starts a fragment only inside a run that begins with `scheme://`, or
// with a dotted host followed by a slash (`www.nextgamenight.app/`), or with a slash at the
// string start or after whitespace, `(`, a quote, `=`, `,` or `:`. The run and the fragment both
// end at whitespace, a double quote, `<`, `>` or a backtick: exactly the WHATWG "fragment
// percent-encode set" (C0 controls, space, double quote, `<`, `>`, backtick;
// https://url.spec.whatwg.org/, read 2026-10-05), so a real fragment never holds them raw and a
// quoted URL keeps its closing quote. It deliberately does NOT end at a single quote,
// parentheses, comma or semicolon: a real fragment can hold those, and stopping there would
// leave a fragment credential's tail behind. That is why it has its own set and not
// TOKEN_SEGMENT_END: a fragment's content is not app-minted (it carries third-party OAuth
// text), so only the encoding rule is safe evidence. REJECTED:
//  - stripping every `#…`: an INP span description (`body > div#__next > …`) and every click
//    selector carrying an id would read `#[REDACTED]`, because `scrubSpanJson` sends
//    `span.description` through `scrubUrl` and `isUrlLike` sends any string naming invite there
//    (pinned by the W007 NEGATIVE fragment case);
//  - placing it in `scrubString`: that over-redacts prose anchors, and query stripping is
//    likewise `scrubUrl`-only;
//  - ending the fragment at any whitespace only, as first planned: a double-quoted URL lost its
//    closing quote;
//  - unanchored starts, as first planned: the scheme alternative was re-tried from every letter
//    of a run, quadratic on the replay leaf (seconds on the main thread for an 80,000-letter
//    string). Each of the three starts carries a start-anchor lookbehind, so a match is
//    attempted only where a scheme, host or path run BEGINS, and `scrubUrl` skips the replace
//    when the string holds no `#`; the fragment rule is linear on its own (the long-input
//    case times this constant). `scrubUrl` as a whole is linear on these runs only because the
//    EMAIL local part is ALSO bounded, by a different mechanism: the `{1,64}` cap (the 88.6.1-08
//    amendment on the EMAIL marker), not a start anchor;
//  - a scheme or a slash start only: a scheme-less host (`www.nextgamenight.app/cb#…`) and a
//    path after `,` or `:` kept their fragment whole.
// ACCEPTED COSTS: navigation breadcrumbs lose in-page anchors such as `#vote`, and a dotted
// non-host run before a slash (`a.b/c#d`, `v1.2/x#y`) is over-redacted, failing safe
// (diagnostic only; threat T-88.6.1-171).
// Removing a start anchor or the # guard, or dropping a start alternative, is a decision, not a
// cleanup.
const URL_FRAGMENT =
  /((?:(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/|(?<![a-z0-9.-])[a-z0-9-]+(?:\.[a-z0-9-]+)+\/|(?:^|(?<=[\s("'=,:]))\/)[^\s#"<>\x60]*)#[^\s"<>\x60]*/gi;

/**
 * Redact PII patterns within a free-text string. Surrounding non-PII text is
 * preserved (so an exception message keeps its prose, only the JWT is redacted).
 */
function scrubString(str, opts) {
  if (typeof str !== 'string' || str.length === 0) return str;
  // 88.6.1-76 (P-09): the named-attribute rule runs FIRST, before every value rule.
  let out = redactNamedAttributes(str)
    .replace(JWT, REDACTED)
    .replace(BEARER, REDACTED)
    // The whole pair goes; a quote whose partner sat OUTSIDE the match is re-emitted, so the
    // quotes stay balanced (`{"k":"v"}` -> `{"[REDACTED]"}`, `k: "v"` -> `"[REDACTED]"`). See
    // the W007 marker on SECRET_KV.
    .replace(SECRET_KV, (_m, _key, keyQuote, valueQuote) =>
      (valueQuote && !keyQuote ? valueQuote : '') + REDACTED + (keyQuote && !valueQuote ? keyQuote : '')
    )
    .replace(EMAIL, REDACTED);
  // Auth0 subs — BEFORE PHONE, and only when a separator is present (see the AUTH0_SUB marker).
  // `%7` covers both `%7C` and `%7c`; the pattern itself still requires the full separator.
  // `opts.keepAuth0Sub` is passed by ONE caller only — `scrubEvent`'s `event.user.id` (see there).
  if (!(opts && opts.keepAuth0Sub) && (out.indexOf('|') !== -1 || out.indexOf('%7') !== -1)) {
    out = out.replace(AUTH0_SUB, `$1|${REDACTED}`);
  }
  out = out.replace(PHONE, REDACTED);

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
 *
 * 88.6.1-76 (P-09): the named-attribute rule runs FIRST here, before the query strip; see the
 * P-09 marker.
 */
function scrubUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  // 88.6.1-76 (P-09): BEFORE the query strip, which would otherwise cut a selector at a
  // question mark inside a name, and before the fragment strip. See the P-09 marker.
  let out = redactNamedAttributes(url);
  // Strip the query string entirely (it routinely carries magic_token/token).
  const qIndex = out.indexOf('?');
  if (qIndex !== -1) {
    out = `${out.slice(0, qIndex)}?${REDACTED}`;
  }
  // 88.6.1-08 (W007 fragments): AFTER the query strip, so a `?…#…` URL keeps `?[REDACTED]`,
  // and BEFORE the hex backstop. The `#` guard keeps a string with no fragment from ever
  // running the regex (see the URL_FRAGMENT marker; removing it is a decision).
  if (out.indexOf('#') !== -1) {
    out = out.replace(URL_FRAGMENT, `$1#${REDACTED}`);
  }
  // The generic long-hex backstop lives HERE ONLY, never in `scrubString` — Sentry's own
  // `trace_id` is a bare 32-hex string. See the constant's own note.
  out = out.replace(LONG_HEX_PATH_SEGMENT, `$1${REDACTED}`);
  // The token-prefix loop, the JWT/email/phone rules, and the slash guard all live in
  // `scrubString`. One redaction path, not two, except the named-attribute rule, which runs
  // here first and again in scrubString (idempotent).
  return scrubString(out);
}

/**
 * THE one URL-like predicate: an absolute URL, anything with a query, or anything naming an
 * invite route. Such strings get `scrubUrl` (which strips the whole query); everything else
 * gets `scrubString`. Extracted from `deepScrubRecording` in 88.6-61 so the span walker
 * (`scrubSpanJson`) routes values by the SAME rule — one predicate, not a second copy.
 */
function isUrlLike(value) {
  return /https?:\/\//.test(value) || value.includes('?') || /invite/i.test(value);
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
    const userId = event.user.id;
    deepScrub(event.user);
    /* DECISION Phase 88.6-59 (review MEDLOW-11): `event.user.id` is EXEMPT from the AUTH0_SUB
       rule ONLY — every other rule still runs on it, exactly as before this plan. Chosen to
       PRESERVE the Phase 84 T-84-01 decision (`4bf2884`, pinned by the `(e)` case in
       `src/lib/sentry.scrub.test.ts`: "non-PII id is preserved for debugging") — Sentry's
       structured user slot is the ONE place a pseudonymous id is kept on purpose — OVER letting
       the new free-text rule silently reverse it. The review finding was about the sub leaking
       through breadcrumb TEXT; it never weighed this slot. Nothing in the app calls
       `Sentry.setUser` today, so this is latent. Whether the slot should be redacted too is an
       OWNER call (raised in 88.6-59-SUMMARY.md), not a cleanup. */
    if (typeof userId === 'string') event.user.id = scrubString(userId, { keepAuth0Sub: true });
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
 * [VERIFIED 2026-10, 88.6.1-08: read in the installed @sentry-internal/replay 8.55.2,
 * build/npm/esm/index.js. Replay forwards a breadcrumb only when it has a category
 * (beforeAddBreadcrumb at :6175, isBreadcrumbWithCategory at :6263-6264), and it drops the
 * ui.*, fetch and xhr ones (normalizeBreadcrumb, :6186-6201). logger.info sets no category
 * (src/lib/logger.ts:53), so its data never reaches this walker; it leaves only on an error
 * event, through scrubEvent (pinned end to end through the wired beforeSend by the 88.6.1-08
 * tracer in src/lib/sentryClientReplayGate.test.ts). Console breadcrumbs DO carry a category
 * and reach replay, so the key-hint fix stands.]
 * [88.6.1-76, P-09: the replay walker ALSO redacts values under the exact keys aria-label,
 * title and alt, which is replay's attribute map. The event walker deliberately does not; see
 * the P-09 marker.]
 */
function deepScrubRecording(value, keyHint) {
  if (typeof value === 'string') {
    // NAME_ATTRIBUTE_KEYS: replay's attribute map (88.6.1-76, P-09; this walker ONLY, see the marker).
    if (keyHint && (SECRET_KEY_RE.test(keyHint) || NAME_ATTRIBUTE_KEYS.has(keyHint))) return REDACTED;
    // Treat URL-looking strings (and anything with a query or token segment) via
    // scrubUrl; everything else via scrubString.
    if (isUrlLike(value)) {
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

/* DECISION Phase 88.6-61 (review round 2 H-1, owner ruling R2-H1-RULING): performance payloads
   get their own two hooks because `beforeSend` never runs on them.
   - `scrubSpanJson` WALKS EVERY STRING VALUE of `span.data`, chosen OVER a key allowlist
     (REJECTED): the attribute names are SDK-owned and change between versions — fetch spans
     carry `url` / `http.url`, INP spans carry the route as `transaction`, LoAF spans carry
     `code.filepath`, and the `http.query` key the review's remedy named does not exist in
     8.55.2 at all. A value walk catches a leak under a key nobody listed; an allowlist misses it.
   - `scrubUrl` on `span.description` because fetch span names are `METHOD <full url>`
     (`@sentry/core` 8.55.2 build/cjs/fetch.js:61-67), query string included.
   - `trace_id` / `span_id` / `parent_span_id` (and every other top-level key) are NEVER touched —
     marker (iii): scrubbing them kills FE-to-BE trace linking. Pinned by the CONFIRM-ONLY case.
   - `beforeSendSpan` is the ONLY hook that reaches standalone INP/CLS web-vital spans
     (`@sentry/core` 8.55.2 build/cjs/envelope.js:104-107); they never become transactions.
   - It never returns `null`: a null from `beforeSendSpan` DROPS the span and warns
     (`@sentry/core` 8.55.2 build/cjs/baseclient.js:792-800).
   - `scrubTransaction` does NOT walk `event.spans`: `beforeSendSpan` has already processed them
     before `beforeSendTransaction` runs (baseclient.js:792-795 precedes :805), and it does NOT
     re-implement `request.url` / `request.query_string` — `scrubEvent` already does both, and a
     second copy is what the duplication tenet forbids.
   AMENDED 2026-10 (88.6.1-76, R3-M5): the value walk is UNCHANGED; a key-name DENY rule is
   ADDED beside it (SECRET_KEY_RE, so a string, or each string element of an array, under a
   matching key becomes the placeholder, and a nested object goes through deepScrub with its
   key). That is not the allowlist rejected above, and it makes this walker match deepScrub and
   deepScrubRecording. REJECTED: staying value-only, because the first Sentry.startSpan with
   attributes would bypass a rule the module header calls universal.
   Narrowing the walk to named keys is a decision, not a cleanup. */
function scrubSpanJson(span) {
  if (!span || typeof span !== 'object') return span;
  if (typeof span.description === 'string') {
    span.description = scrubUrl(span.description);
  }
  if (span.data && typeof span.data === 'object') {
    for (const k of Object.keys(span.data)) {
      const v = span.data[k];
      // 88.6.1-76 (R3-M5): the key-name rule the other two walkers apply (see the AMENDED
      // sentence of the 88.6-61 marker above).
      const secretKey = SECRET_KEY_RE.test(k);
      if (typeof v === 'string') {
        span.data[k] = secretKey ? REDACTED : scrubSpanDataString(v);
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i += 1) {
          if (typeof v[i] === 'string') v[i] = secretKey ? REDACTED : scrubSpanDataString(v[i]);
        }
      } else if (v && typeof v === 'object') {
        // A nested object goes through the event walker, as the R3-M5 fix text says.
        deepScrub(v, k);
      }
      // numbers / booleans are left untouched.
    }
  }
  return span;
}

function scrubSpanDataString(value) {
  return isUrlLike(value) ? scrubUrl(value) : scrubString(value);
}

function scrubTransaction(event) {
  if (!event || typeof event !== 'object') return event;
  if (typeof event.transaction === 'string') {
    event.transaction = scrubUrl(event.transaction);
  }
  return scrubEvent(event);
}

export {
  scrubString,
  scrubUrl,
  scrubEvent,
  scrubRecordingEvent,
  scrubSpanJson,
  scrubTransaction,
  REDACTED,
  // Exported for the 88.6.1-08 long-input timing pin only, as REDACTED is; no runtime config
  // imports it.
  URL_FRAGMENT,
  // Exported SEPARATELY from the API-path entries so the set-equality arm in
  // `src/lib/sentry.scrub.test.ts` has an FE-ROUTE subject to compare against
  // `TOKEN_ROUTE_PREFIXES`. The cross-module import lives in the TEST, never here — this
  // module's docblock promises pure functions safe to unit-test in isolation, and it must
  // not import a `.ts` module.
  TOKEN_PATH_PATTERNS_FE_ROUTES,
  TOKEN_PATH_PATTERNS_API_PATHS,
};
