/**
 * API Configuration and Utility Functions
 * Centralized API base URL and common fetch patterns
 */

import type { Group, GroupList, GroupMemberList, GroupInvitePreview } from './schemas/groups';
import type {
  Event,
  EventList,
  RsvpEventResponse,
  EventBringList,
  Ballot,
} from './schemas/events';
import type { EmailChangeResponse, User } from './schemas/users';
import type { AvailabilityList } from './schemas/availability';
import type { GameList, UserGameList } from './schemas/shared';
import { logger } from '@/lib/logger';
// The repo-root scrubber (imports nothing, so no cycle). This module is its first `src/`
// importer; the direction rule in src/lib/sentry.scrub.test.ts (the scrubber never imports a
// `.ts` module) is kept. Used ONLY by `capErrorText` below (88.6.1-23, W063).
import { scrubString } from '../../sentry.scrub.js';

// Absolute backend origin. Used ONLY by PUBLIC/unauthenticated callers that must
// bypass the BFF proxy (magic-link, invite-preview, public RSVP respond,
// invite-info). Authenticated calls go through apiFetch -> same-origin '/api'
// (BFF_BASE), where the catch-all route attaches the Auth0 token SERVER-SIDE
// (FSEC-01) — the raw token never reaches client JS.
export const PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// Back-compat alias for external direct-fetch callers (e.g. the public /feedback
// submit in FeedbackForm.js). Same absolute backend origin as PUBLIC_API_BASE_URL
// — NOT the same-origin BFF. New public callers should reference PUBLIC_API_BASE_URL.
export const API_BASE_URL = PUBLIC_API_BASE_URL;

// Same-origin BFF base for AUTHENTICATED apiFetch calls. The catch-all route
// handler (app/api/[...path]/route.ts) attaches the Auth0 access token
// server-side; apiFetch itself sends no bearer.
const BFF_BASE = '/api';

// -----------------------------------------------------------------------------
// ApiError seam (D-07). ALL prose-matching lives in `mapErrorToCode`. When
// BAPI-01 ships the real envelope (Phase 85/86), the swap is a one-function
// rewrite — call sites NEVER change (they only read `err.code`).
// Source: 82-RESEARCH.md Pattern 2 (verbatim).
// -----------------------------------------------------------------------------
// The full wire vocabulary. Envelope-PREFERRED (Decision A, 2026-06-30):
//   - BE registry codes (Phase 85 ERROR_REGISTRY): validation, unauthorized,
//     forbidden, not_found, rate_limited, token_invalid, prompt_closed,
//     prompt_deadline_expired, reminder_cooldown, internal.
//   - client-side codes apiFetch itself throws: `network` (fetch/connect
//     failure) and `config` (misconfiguration). These are ADDITIVE — the widen
//     over the BE registry must NOT drop them (86-04 Task 1 / MED #6).
//   - `unknown` is the terminal fallback for an unmapped status.
//   - account-deletion codes (Phase 87.2, registered in the BE ERROR_REGISTRY):
//     `owner_of_active_groups` (@409 — the caller still owns active groups and
//     must transfer/delete them first; carries a blocked-groups list nested at
//     details.groups) and `account_deleted` (@410 — repeat-DELETE / tombstone
//     refusal, terminal). Both MUST be in the union or `mapErrorToCode`'s
//     body.code preference yields a code outside ApiErrorCode.
//   - group-restore codes (Phase 88.2, registered in the BE ERROR_REGISTRY and
//     emitted by POST /groups/accept-ownership): `already_restored` (@409 — a
//     member already took the group back; the raw body carries the live
//     `group_id` so the caller can be redirected into it), plus three @410
//     terminal states — `window_expired` (the 30-day recovery window closed and
//     the data was erased), `already_used` (this nonce was already consumed) and
//     `invalid_token` (no such restore token). All four MUST be in the union:
//     `mapErrorToCode` PREFERS `body.code` and casts it verbatim, so omitting
//     them puts values outside this union onto `ApiError.code` — the exact
//     condition the note above warns must not happen — and a `err.code ===
//     'window_expired'` comparison would be TS2367 under strict.
//
//     NOTE — `invalid_token` (@410, group restore) is NOT the pre-existing
//     `token_invalid` (@400, magic-token reject). They are two different codes
//     with two different statuses, and the BE registry anchors httpStatus per
//     code, so one key cannot hold both. DO NOT "unify" or rename them: merging
//     would either break that anchoring or silently re-status the magic-token
//     path. (The FE never needs to tell `invalid_token` from `already_used` —
//     both, plus the unattributable case, map to the same weaker message.)
//     Backend contract: `utils/errors.js` ERROR_REGISTRY, Phase 88.2 plan 07.
//   - `gone` is CLIENT-SIDE ONLY: the status-mapped fallback for a CODE-LESS
//     410 body (Phase 88.2 code-review M-2). The phase's soft-delete liveness
//     gates on join-by-token and invite accept/decline return raw 410s with no
//     envelope code; without this arm they fell through to `unknown`, which is
//     retryable-once — while the four CODED 410s above are deliberately
//     non-retryable. A 410 is Gone: terminal by definition, never retried.
//     No BE registry entry emits `gone` — if one ever does, pick a real domain
//     code instead.
//   - `conflict` is CLIENT-SIDE ONLY, same shape as `gone` (88-CODE-REVIEW D2,
//     owner-ruled 2026-08-06): the status-mapped fallback for a CODE-LESS 409
//     body. The legacy conflict responses (friendships "Already friends"/
//     "Friend request already pending", availabilityPrompt "Poll is already
//     closed/converted", invites) are raw 409s with no envelope code; without
//     this arm they fell through to `unknown` — retryable-once, and unreachable
//     by the byCode copy designed for exactly these outcomes. A 409 is a
//     terminal state conflict: never retried. No BE registry entry emits
//     `conflict` — if one ever does, pick a real domain code instead.
export type ApiErrorCode =
  | 'unknown'
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'token_invalid'
  | 'prompt_closed'
  | 'prompt_deadline_expired'
  | 'reminder_cooldown'
  | 'owner_of_active_groups'
  | 'account_deleted'
  | 'already_restored'
  | 'window_expired'
  | 'already_used'
  | 'invalid_token'
  | 'gone'
  | 'conflict'
  // 88-33 Task 2 / Fork F (owner-ruled 2026-08-20): the two group-invite 409s,
  // registered BE-side in ERROR_REGISTRY by 88-34 Task 4 (`already_member` and
  // `invite_pending`, both httpStatus 409, messages = the live route strings).
  // `mapErrorToCode` passes `body.code` through VERBATIM, so a code that is not
  // in this union lands outside `ApiErrorCode` and every downstream Record keyed
  // on it silently misses. Both are terminal-state conflicts — see the D2 note
  // in queryClient.ts NON_RETRYABLE_API_CODES.
  | 'already_member'
  | 'invite_pending'
  // Phase 88.8 (BOPS-05, SPEC R7 / D-19): registered BE-side in ERROR_REGISTRY by
  // plan 07 as `not_provisioned` @404. Emitted by BOTH deletion endpoints
  // (DELETE /users/me and GET /users/me/deletion-blockers) when the caller's
  // token is valid but there is no Users row AND no deletion tombstone — i.e.
  // "you never had an account here". That is a THIRD state, distinct from
  // `account_deleted` (410, "your account was deleted") and from the generic
  // forward-compat `not_found` (404, "the thing you asked for is missing"); the
  // BE registry comment records that reusing `not_found` was rejected for
  // exactly this reason. Same VERBATIM pass-through hazard as the two 409s
  // above: `mapErrorToCode` returns `body.code` unchanged, so without this
  // member the code lands outside `ApiErrorCode` and every Record keyed on it
  // misses silently. The set moves together — union here,
  // MESSAGE_BY_CODE in useFetchErrorState.ts, NON_RETRYABLE_API_CODES in
  // queryClient.ts, and its own arm in classifyDeleteError.
  | 'not_provisioned'
  // Phase 88.8 post-merge (round 6 #11/#14/#15/#16/#17): registered BE-side in
  // ERROR_REGISTRY as `unsupported_address` @400 (utils/errors.js:104, `unsupported_address:`), returned by
  // POST /users/:user_id/email when the requested address matches the app's OWN
  // synthetic-account sentinel (the broad NIX-AUTH0 predicate). DELIBERATELY DISTINCT
  // from `validation`: that code is the shape/length/body-key verdict, and the Email
  // section overrides its copy with "reload the page to see the current state" — false
  // twice over for a typed address that will fail identically forever. Same VERBATIM
  // pass-through hazard as the members above: without this row the code lands outside
  // `ApiErrorCode` and every Record keyed on it misses silently. The set moves together
  // — union here, MESSAGE_BY_CODE in useFetchErrorState.ts, NON_RETRYABLE_API_CODES in
  // queryClient.ts, and the section's own byCode override.
  | 'unsupported_address'
  | 'internal'
  | 'network'
  | 'config';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /**
   * The BACKEND's own error string, off the DISPLAY path. Populated from the
   * legacy `error` key by `extractUpstreamMessage` (see its DECISION marker)
   * and read by NOTHING but `queryCacheOnError`'s Sentry `extra` forward.
   * [AMENDED 2026-09-28, plan 88.6-58 / review MEDLOW-13: TWO readers now, both Sentry
   * `extra` forwards — `queryCacheOnError` (query path) and `logger.error` (every
   * mutation/action path; a structural string read, since logger.ts cannot import this file).]
   * A STRING or undefined — never the parsed body, never `errorData`.
   * Rendering this anywhere is a defect, not a simplification.
   */
  readonly upstreamMessage?: string;
  /**
   * @param options the platform's own `ErrorOptions` (88.6.1-23, W062 rider MEDLOW-18), used by
   * `timedPublicFetch` to keep a transport failure's `cause`. Built without it, an ApiError has
   * NO own `cause` property (its shape is unchanged). A cause reaches Sentry only as a linked
   * exception on an EVENT (the `linkedErrors` integration's default key is `cause`), where
   * `scrubEvent` scrubs every exception value like any other; `errCtx` (name and message only)
   * never forwards it into a breadcrumb.
   */
  constructor(
    message: string,
    code: ApiErrorCode,
    status: number,
    details?: unknown,
    upstreamMessage?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.upstreamMessage = upstreamMessage;
    Object.setPrototypeOf(this, ApiError.prototype); // instanceof works post-transpile
  }
}

/**
 * Is this the same-origin BFF proxy's own CSRF refusal (not a backend 403)?
 *
 * DECISION Phase 88.6.1-07 (D-24 / MEDLOW-9): ONE structural predicate at the seam. The proxy's
 * CSRF gate (`src/app/api/[...path]/route.ts`, anchor `csrf_rejected: true`) answers an
 * unsafe-method call with a code-less 403, so `mapErrorToCode` resolves it to `'forbidden'`
 * exactly like a backend refusal. The body carries `csrf_rejected: true` as a TOP-LEVEL key, and
 * `ApiError.details` is the WHOLE parsed body (apiFetch's throw site, anchor
 * `The single throw site (D-07)`), so the key is read at `details.csrf_rejected`. Strict on the
 * instance, on the status (403, the proxy's only status for this body) and on the boolean
 * (`=== true`; a string `'true'` or a `1` is not the proxy's body).
 *
 * REJECTED (i): a type-predicate return (`err is ApiError`). The false branch would narrow every
 * non-CSRF ApiError away in typed callers.
 * REJECTED (ii): matching the prose `'Cross-origin request rejected'` (88.6-23's own "WHY NOT
 * MATCH THE PROSE": the message is display text, and the body's error key is not read here).
 * REJECTED (iii): reading through `getEnvelopeDetails`, which returns the ENVELOPE's nested
 * `details`. This key is not there; it is top-level in the body.
 * REJECTED (iv): a new `ApiErrorCode` member (88.6-23's "WHY NOT AN ENVELOPE `code`").
 *
 * Readers: `getFetchErrorMessage` (`useFetchErrorState.ts`, this plan) resolves a flagged 403's
 * MESSAGE through the `unknown` arm while `err.code` stays `'forbidden'`; the restore page's
 * direct 403 arm (plan 88.6.1-36); invite/accept's wrong-email check (plan 88.6.1-35).
 * Loosening the strict checks, or remapping the code in mapErrorToCode instead, is a decision,
 * not a cleanup.
 */
export function isCsrfRejection(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false;
  const details = err.details;
  if (typeof details !== 'object' || details === null) return false;
  return (details as { csrf_rejected?: unknown }).csrf_rejected === true;
}

/**
 * Typed accessor for the Phase 85 envelope's OWN `details` object.
 *
 * The single apiFetch throw site stores the WHOLE parsed error body as
 * `ApiError.details` (see the in-code comment at the throw site), and the BE
 * envelope shape is `{ code, message, details: { ... }, error }`. So the
 * envelope's structured payload (e.g. the owner-gate blocked-groups list) is
 * NESTED at `err.details.details`, NOT `err.details`. Consumers must read it
 * through this one seam instead of hand-casting the double-nesting — reading
 * `err.details.groups` directly is always `undefined` and renders a dead-end.
 */
export function getEnvelopeDetails<T>(err: ApiError): T | undefined {
  return (err.details as { details?: T } | undefined)?.details;
}

/**
 * The GET /users/me/deletion-blockers pre-flight shape (Phase 87.2). Resolves
 * 200 for a PROVISIONED authenticated caller — `groups` is empty when not
 * blocked and non-empty (each group's TOTAL member count) when the caller owns
 * active groups. AMENDED Phase 88.8 (round 3 #15): it now also rejects with
 * 404 `not_provisioned` (valid token, no Users row, no tombstone) and 410
 * `account_deleted` (tombstone present) — three outcomes, not one. `memberCount` is the group's whole-membership count (pinned in plan
 * 87.2-04) — render it as the member count, NOT an "others" count. This
 * endpoint NEVER rejects with `owner_of_active_groups`; that code arrives only
 * on the DELETE response (the server-side TOCTOU re-check, D-10).
 */
export interface DeletionBlockerGroup {
  id: string;
  name: string;
  memberCount: number;
}
export interface DeletionBlockers {
  groups: DeletionBlockerGroup[];
}

/**
 * The DELETE /users/me 409 `owner_of_active_groups` envelope `details` shape
 * (read via getEnvelopeDetails, i.e. nested at err.details.details).
 * `google_access_revoked` is a fixed FE/BE contract key: the backend sets it
 * (true) ONLY when the deletion was blocked at the last-moment in-transaction
 * owner re-check, AFTER the user's Google Calendar integration was already
 * irreversibly revoked (WR-02) — the FE must tell the user to reconnect.
 */
export interface DeleteAccountBlockedDetails {
  groups?: DeletionBlockerGroup[];
  google_access_revoked?: boolean;
}

/**
 * GET /groups/:group_id/deletion-impact (Phase 88.2 / SPEC-REQ-5, D-06). Owner-
 * only; 404 for a soft-deleted group, 403 for a live group the caller does not
 * own. Keys are taken VERBATIM from the route's `res.json` (88.2-06-SUMMARY.md)
 * — the service layer is camelCase internally and only the route converts, so a
 * hand-written type cannot be typechecked against the wire.
 *
 * `member_count` INCLUDES the acting owner (it answers "how many people lose
 * access"), so it is exactly one greater than the number of ownership-offer
 * emails sent. That is intended — do not subtract the owner.
 *
 * `recovery_window_days` is served so the Danger Zone copy reads the window from
 * the server instead of hard-coding 30 in a second place.
 */
export interface DeletionImpact {
  member_count: number;
  event_count: number;
  recovery_window_days: number;
}

/**
 * GET /groups/restore-preview/:token (Phase 88.2 / SPEC-REQ-9, AF-9). PUBLIC.
 *
 * A discriminated union on `status`, NOT an optional-field bag: the caller must
 * narrow before reading. The success arm declares `status?: undefined`
 * deliberately — the backend's success body carries `group_name` and
 * `purge_after` and NO `status` key at all, so without the optional-undefined
 * member TypeScript rejects `payload.status` outright (the property would not
 * exist on the first member) and the narrowing the restore page depends on is a
 * compile error instead. The optional-`undefined` tag is the standard idiom for
 * discriminating a union whose default arm carries no tag.
 *
 * Do NOT "fix" this by asking the backend to add `status: 'ok'` — that changes
 * the wire shape and contradicts plan 07's exact-key-set acceptance criterion
 * for no gain the frontend cannot get locally.
 *
 * `purge_after` serializes as an ISO date string. Every genuine failure (bad
 * nonce, revoked token, purged group, past deadline) is a byte-identical 404,
 * so it surfaces as an ApiError, never as a variant here.
 */
export type RestorePreview =
  | { status?: undefined; group_name: string; purge_after: string }
  | { status: 'already_restored'; group_name: string; group_id: string };

/**
 * POST /groups/accept-ownership 200 body (Phase 88.2 / SPEC-REQ-9). Exactly
 * three keys, snake_case, taken verbatim from 88.2-07-SUMMARY.md's wire table.
 * Failures arrive as ApiError with `code` one of `already_restored` (409, raw
 * body carries `group_id`), `window_expired` / `already_used` / `invalid_token`
 * (410) or a bare 403 with no code.
 */
export interface AcceptOwnershipResult {
  success: boolean;
  group_id: string;
  group_name: string;
}

// HTTP-status -> code fallback for routes NOT yet emitting the envelope `code`.
// ~497 BE routes still return a raw `{ error }` (no `code`) until Phase 93 /
// BAPI-03 converts them; this gives them a sensible code (and therefore correct
// retry classification) in the meantime. Mirrors the BE ERROR_REGISTRY httpStatus
// map so a status-mapped 429 lands on `rate_limited` (non-retryable) etc.
function statusToCode(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  // M-2: code-less 410s (88.2's join-by-token + invite accept/decline liveness
  // gates) must classify as terminal, matching the phase's coded 410s.
  if (status === 410) return 'gone';
  // 88-CODE-REVIEW D2: code-less 409s are terminal-state conflicts (see the
  // `conflict` union note) — without this arm they classified as `unknown`.
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal';
  return 'unknown';
}

// ENVELOPE-PREFERRED (Decision A, 2026-06-30). Consume the Phase 85 envelope
// `body.code` when present; OTHERWISE map the HTTP status to a code so
// unconverted raw-`{ error }` routes still get a real code. Never throws on a
// raw `{ error }` body. Call sites NEVER change — they only read err.code.
export function mapErrorToCode(body: any, status: number): ApiErrorCode {
  if (body && typeof body.code === 'string') return body.code as ApiErrorCode; // PREFERRED: envelope code
  // Validation hint, CANONICAL SHAPE ONLY. Phase 88.6 plan 42 moved this arm off
  // the TOP-LEVEL `errors[]` legacy mirror onto the sanctioned Phase 85/86
  // `details.errors`. BEHAVIOUR-NEUTRAL for the unconverted producers measured
  // 2026-09-17 — routes/invites.js:216 and routes/friendships.js:278 (both
  // `res.status(400).json({ errors: errors.array() })`) and routes/availability.js:55-64
  // (`errors: errors.array().map`) all emit their top-level `errors[]` on a 400,
  // and statusToCode(400) already returns 'validation'. The Array.isArray guard
  // stays: a malformed `details.errors` must not produce 'validation' and must
  // not throw (AC-9).
  if (body?.details?.errors && Array.isArray(body.details.errors)) return 'validation';
  return statusToCode(status); // FALLBACK: HTTP-status -> code
}

// Envelope-ONLY human message: the envelope `body.message`, else the bare status
// template. Phase 88.6 plan 42 DROPPED the legacy alias arm — the FE no longer
// derives `ApiError.message` from the backend's raw `error` key on any path.
// The dropped string is not lost: `extractUpstreamMessage` below carries it on a
// NON-RENDERED `ApiError` field for Sentry. Both self-constructed non-JSON error
// bodies (publicFetch and apiFetch) were reshaped onto `message` in the SAME
// commit, so a proxy/gateway failure still surfaces its text here.
// [AMENDED Phase 88.6.1-23 (W063): the same envelope-only value is now coerced with `String`
// (exactly as `Error`'s constructor would coerce a non-string) and passed through
// `capErrorText`, so a JSON envelope message is redacted and then capped at 200 characters
// where it is BUILT, like the non-JSON text below. No alias arm is added.]
function extractErrorMessage(body: any, status: number): string {
  return capErrorText(String(body?.message ?? `HTTP error! status: ${status}`));
}

// DECISION Phase 88.6-42 (AC-4): the backend's own error string is retained on a
// NON-RENDERED `ApiError` field and forwarded to Sentry `extra` — over a clean
// delete (arm B), which would have dropped that string from the event ENTIRELY
// for the ~455 unconverted raw-`{ error }` routes until Phase 93, leaving only
// "HTTP error! status: N" to read. GROUPING is unchanged either way: that capture
// (src/lib/queryClient.ts ("Sentry.captureException(error, upstreamMessage")) carries tags and no Sentry fingerprint (measured 2026-09-17: the
// three grep hits for that word under src/ are all prose), and Sentry's default
// grouping does not key on extra — so the field buys per-event READABILITY, not
// issue separation. `ApiError.message` is the display contract and does NOT read
// this field; the single by-name roster exemption in errorEnvelopeReads.test.ts
// is what keeps AC-9 exact. Owner ruling 2026-09-09 (AC-4 a). Rendering this
// field anywhere is a defect, not a simplification.
//
// T-84-01 RECONCILIATION (so a later sweep finds the answer, not the conflict):
// this MOVES a string that already egresses today, it opens no channel. Before
// this plan `extractErrorMessage` already returned `body.message ?? body.error`
// (api.ts:308-309 pre-edit), that message was already thrown (api.ts:441
// pre-edit) and `queryCacheOnError`'s capture (src/lib/queryClient.ts) already captured it. Arm A relocates it off
// the display path onto a non-rendered field — same string, same destination,
// narrower blast radius. The bound on it is sentry.scrub.js's `deepScrub`, which
// deep-scrubs `event.extra`; the shape mirrored is the T-84-05 {path, code}
// forward in `queryCacheOnError`'s ZodError branch (src/lib/queryClient.ts, anchor
// `T-84-05: NEVER forward the raw ZodError`).
//
// This is the ONE sanctioned legacy-key read left in this module's apiFetch path
// and the ONE by-name exemption in the R9 roster. It returns a STRING or
// undefined and NOTHING else: never `errorData`, never the parsed body, never a
// widened payload. Widening it is a different change with a different threat
// model.
function extractUpstreamMessage(body: any): string | undefined {
  return typeof body?.error === 'string' ? body.error : undefined;
}

// Envelope-ONLY validation field-errors: `body.details.errors` (the sanctioned
// Phase 85/86 envelope shape). Phase 88.6 plan 42 DROPPED the second arm, the
// top-level legacy `body.errors[]` mirror. No consumer reads either shape for
// control flow, and mapErrorToCode still yields 'validation' for a 400 via
// statusToCode, so nothing downstream loses a kind.
function extractFieldErrors(body: any): any[] | undefined {
  const fieldErrors = body?.details?.errors;
  return Array.isArray(fieldErrors) ? fieldErrors : undefined;
}

/**
 * One field-error entry rendered as text, or '' when it can render none.
 *
 * D25 / T-88.6-119: the old inline `err.message || \`${err.field}: ${err.msg}\``
 * turned a `details.errors` of `[{}]` into the literal string
 * "undefined: undefined". An entry with NEITHER a usable `message` NOR a
 * `field`/`msg` pair now contributes NOTHING, and the formatter falls through
 * to extractErrorMessage.
 */
function fieldErrorText(err: any): string {
  // The param is deliberately named `err`, the name fetchErrorTreatment's
  // RAW_MESSAGE_READ scanner matches: this IS a raw upstream read and it stays
  // VISIBLE to that gate as one roster site. Renaming it to dodge the scanner is
  // the anti-pattern logger.ts's errCtx docblock names by hand.
  if (typeof err?.message === 'string' && err.message) return err.message;
  return err?.field != null && err?.msg != null ? `${err.field}: ${err.msg}` : '';
}

/* DECISION Phase 88.6-62 (review round 2 #3, T-84-01): a NON-JSON error body is capped at
   ERROR_TEXT_CAP characters WHERE IT IS RESHAPED, through this ONE helper, at BOTH
   reshape sites (publicFetch and apiFetch). Plan 42 keyed that text onto `message`
   (T-88.6-118) so a gateway failure still surfaces it — which made it `ApiError.message`, and
   that reaches TWO sinks: every `errCtx(err)` breadcrumb (logger.ts `errCtx`, name + message)
   and the Sentry exception value (`logger.error` / `queryCacheOnError` capture the ApiError).
   Capping where the value is BUILT bounds both at once.
   REJECTED: editing `errCtx` (the owner-ruled #3 disposition leaves it untouched,
   R2-FIXNOW-SET-RULING 2026-09-29; `grep -rn "errCtx(" src` outside tests = 92 lines across
   28 files, comments included, measured 2026-09-29). REJECTED: capping only publicFetch's
   site, which the review first named — apiFetch carries nearly every errCtx consumer, so one
   site bounds neither sink for them. 200 keeps a gateway page's diagnostic first line.
   Raising the cap or dropping a site is a decision, not a cleanup.
   [AMENDED Phase 88.6.1-23 (W063): the cap is now ONE exported helper, `capErrorText` below,
   that REDACTS (scrubString) before it cuts, applied at every builder of a body-derived error
   message in BOTH files: this module (the non-JSON reshape, the JSON envelope message through
   `extractErrorMessage`, apiFetch's joined field errors, and the two prefill throws) and
   AvailabilityForm.js's submit guard. The constant is renamed ERROR_TEXT_CAP, because it no
   longer caps only non-JSON text (its former non-JSON-only name described only that). Every
   other sentence above stands, the decline of an `errCtx` edit included.] */
const ERROR_TEXT_CAP = 200;

// DECISION Phase 88.6.1-23 (W063 / AC-34): CHOSEN — one cap where every body-derived error
// message is BUILT. In this module: the non-JSON reshape, the JSON envelope message (apiFetch,
// publicFetch and validateToken, through `extractErrorMessage`), the joined field errors, and
// the two prefill throws (`prefillFromGcal`, `prefillFromSaved`; plain Errors, r2 #28). Outside
// it: AvailabilityForm.js's submit guard (r2 #158), which is why this helper is exported. This
// extends 88.6-62's own rule ("capping where the value is BUILT bounds both at once") to the
// JSON path.
// CHOSEN — redact-then-cut (r2 #108). `scrubString` runs on the whole text first, so an email
// or a token is replaced whole, and only then is the text cut.
// REJECTED (a): editing `errCtx`. It is owner-ruled (`R2-FIXNOW-SET-RULING`, 2026-09-29), and
// on the merits it cannot tell a body-derived message from this module's own diagnostics.
// REJECTED (b): capping in the ApiError constructor. That truncates this module's own long
// hand-built diagnostics (the HTML-branch configuration message runs past 200 characters) and
// every caller-built ApiError.
// REJECTED (c): capping `details`. Consumers read structured fields off it, and it never
// reaches `errCtx`.
// REJECTED (d): capping `upstreamMessage`. Not this sink: it rides only to Sentry `extra` on an
// event (the owner's AC-4 ruling), which the scrubber deep-walks.
// REJECTED (e): the blind cut (cut, and leave redaction to `beforeSend`). The pattern scrubber
// matches whole patterns only (EMAIL needs the TLD, JWT needs three segments), so a cut that
// lands inside one leaves a fragment neither rule can match, and the fragment reaches
// breadcrumbs and Sentry unredacted.
// REJECTED (f): the whitespace back-off (cut at the last whitespace before character 200). It
// would turn the #3 gateway text (`HUGE` in api.test.ts) into a marker-only string and lose the
// gateway diagnostic the 88.6-62 cap keeps on purpose. Redact-then-cut leaves #3 and the W063
// repeated-letter arms byte-unchanged, because they carry no PII.
// ' [truncated]' is not user-facing: no surface renders `ApiError.message` (the tree-wide
// "never displayed" test in fetchErrorTreatment.test.ts). Idempotent: an already-capped string
// comes back identical.
// Raising the cap, dropping a builder, or cutting before redacting is a decision, not a cleanup.
export function capErrorText(text: string): string {
  const scrubbed: string = scrubString(text);
  return scrubbed.length > ERROR_TEXT_CAP
    ? `${scrubbed.slice(0, ERROR_TEXT_CAP)} [truncated]`
    : scrubbed;
}

/** The self-constructed error body for a non-JSON error response (keyed `message`, capped). */
function nonJsonErrorBody(responseText: string, status: number): { message: string } {
  const capped = capErrorText(responseText);
  return { message: capped || `HTTP error! status: ${status}` };
}

/**
 * Direct-to-backend fetch for PUBLIC/unauthenticated callers (invite-preview,
 * invite-info, and other no-Auth0 flows). Targets the absolute backend origin
 * (PUBLIC_API_BASE_URL) so a logged-out caller NEVER hits the BFF proxy's
 * server-side getAccessToken(). Mirrors apiFetch's JSON-parse + ApiError throw
 * contract via the shared ApiError/mapErrorToCode seam, so callers converted
 * from apiFetch keep their exact return/error shape.
 */
export async function publicFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${PUBLIC_API_BASE_URL}${endpoint}`;
  // Merge headers LAST so a caller's custom headers extend (not replace) the
  // defaults — `{ ...defaults, ...options }` alone would clobber the merged
  // headers object with the caller's raw one, silently dropping Content-Type.
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers: mergedHeaders });
  } catch (error) {
    const errName = error instanceof Error ? error.name : '';
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errName === 'TypeError' && errMessage.includes('fetch')) {
      throw new ApiError(
        'Network error: Could not connect to the server. Please check if the backend is running.',
        'network',
        0
      );
    }
    throw error;
  }

  const responseText = await response.text();
  if (!response.ok) {
    let errorData: any;
    try {
      errorData = JSON.parse(responseText);
    } catch {
      // Keyed 'message', not 'error' (Phase 88.6 plan 42, T-88.6-118): the moment
      // extractErrorMessage stopped reading the legacy alias, a self-constructed body
      // keyed 'error' would have silently discarded its text and rendered only the
      // status fallback for every proxy/gateway failure. Reshaped in the SAME commit
      // as the drop. [Capped at 200 characters 2026-09-29, plan 88.6-62 — see the
      // DECISION marker on nonJsonErrorBody.]
      errorData = nonJsonErrorBody(responseText, response.status);
    }
    const msg = extractErrorMessage(errorData, response.status);
    throw new ApiError(
      msg,
      mapErrorToCode(errorData, response.status),
      response.status,
      errorData,
      extractUpstreamMessage(errorData)
    );
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    return responseText as unknown as T;
  }
}

/**
 * Generic fetch wrapper with error handling.
 *
 * FSEC-01: authenticated calls go to the same-origin BFF ('/api/...'). The
 * catch-all route handler (app/api/[...path]/route.ts) attaches the Auth0 access
 * token SERVER-SIDE — apiFetch sends NO bearer and the token never reaches
 * client JS. PUBLIC/unauthenticated callers must NOT use apiFetch; they bypass
 * the proxy via PUBLIC_API_BASE_URL (see publicFetch / the magic-link helpers).
 */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BFF_BASE}${endpoint}`;

  // Merge headers LAST so a caller's custom headers extend (not replace) the
  // defaults (same rationale as publicFetch).
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  try {
    const response = await fetch(url, { ...options, headers: mergedHeaders });
    
    // Read response as text first (can only be read once)
    const responseText = await response.text();
    
    // Check if response is HTML (means we're hitting the wrong endpoint)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      // AC-2 WIDENED (owner 2026-09-09; LEVEL amended 2026-09-13, D2): ONE
      // logger.info breadcrumb, message kept verbatim in substance. The ctx carries
      // the BFF-RELATIVE path, which IS the whole diagnosis on this branch (WHICH
      // call got HTML back) and cannot embed a magic-link token -- BFF_BASE is
      // '/api' and every token-bearing helper in this module BYPASSES apiFetch.
      // The third console line printed API_BASE_URL, the BACKEND origin this
      // request never dialled; it is DROPPED rather than converted.
      logger.info('API Error: Received HTML instead of JSON. This usually means NEXT_PUBLIC_API_URL is incorrect.', { url });
      // Phase 88.6-57 (CR-501): the MESSAGE carries the path only -- it becomes the Sentry
      // exception value via queryCacheOnError, and a query can carry a third party's
      // email. The `{ url }` ctx above is safe as-is: key `url` goes through scrubUrl.
      throw new ApiError(
        `API configuration error: the same-origin BFF route handler (app/api/[...path]/route.ts) returned HTML instead of JSON for ${url.split('?')[0]}. Check the NEXT_PUBLIC_API_URL environment variable that route resolves its upstream from.`,
        'config',
        response.status
      );
    }

    if (!response.ok) {
      let errorData: any;
      try {
        // Try to parse as JSON
        errorData = JSON.parse(responseText);
      } catch (jsonError) {
        // If not JSON, use the text as the envelope MESSAGE. Keyed 'message', not
        // 'error' (Phase 88.6 plan 42, T-88.6-118) -- see the twin comment in
        // publicFetch. Reshaped in the SAME commit as the alias drop; split across
        // two commits the repo is broken in between. [Capped at 200 characters
        // 2026-09-29, plan 88.6-62 — the SAME helper as publicFetch's site.]
        errorData = nonJsonErrorBody(responseText, response.status);
      }

      // The single throw site (D-07). mapErrorToCode is envelope-PREFERRED;
      // the message/field-error reads prefer the envelope and fall back to the
      // legacy aliases (retained until Phase 93). ApiError.details carries the
      // WHOLE body, so envelope `details` is nested at err.details.details.
      // If there are validation errors, format them nicely for the message.
      const fieldErrors = extractFieldErrors(errorData);
      if (fieldErrors && fieldErrors.length > 0) {
        // 88.6.1-23 (W063): the joined text is a second builder of a body-derived message, so
        // it is capped where it is built too; an empty join still falls through below.
        const errorMessages = capErrorText(
          fieldErrors
            .map(fieldErrorText)
            .filter(Boolean)
            .join('. ')
        );
        const msg = errorMessages || extractErrorMessage(errorData, response.status);
        throw new ApiError(
          msg,
          mapErrorToCode(errorData, response.status),
          response.status,
          errorData,
          extractUpstreamMessage(errorData)
        );
      }

      const msg = extractErrorMessage(errorData, response.status);
      throw new ApiError(
        msg,
        mapErrorToCode(errorData, response.status),
        response.status,
        errorData,
        extractUpstreamMessage(errorData)
      );
    }

    // Parse successful response as JSON
    try {
      return JSON.parse(responseText) as T;
    } catch (jsonError) {
      // If response is not JSON, return the text
      return responseText as unknown as T;
    }
  } catch (error) {
    // DECISION Phase 88.6-42 (AC-2 / D2): a BREADCRUMB at the fetch boundary, not
    // Sentry.captureException -- chosen OVER an event here, and OVER deleting the log
    // entirely. An event at this catch fires for every expected 401/404/410 (it sees
    // every ApiError this module throws) and duplicates QueryCache.onError
    // (`queryCacheOnError`, src/lib/queryClient.ts ("export function queryCacheOnError("); its capture at src/lib/queryClient.ts ("Sentry.captureException(error, upstreamMessage")). AC-2's convert-on-touch level is logger.info phase-wide as
    // of the owner ruling of 2026-09-13, so this is the RULE rather than an exception to
    // it -- but it was independently the right call here and the reasoning is kept for
    // whoever revisits the fetch boundary. If an event is ever wanted here it must be
    // FILTERED (status >= 500), never blanket. Changing this to logger.error is a
    // decision, not a cleanup.
    //
    // AND: plan 13's shared errCtx(err) helper is DECLINED at THIS ONE SITE, deliberately.
    // errCtx returns the caught error name AND MESSAGE, and for the ApiError this module
    // throws that message is extractErrorMessage output -- which, after this same commit
    // reshaped the non-JSON bodies onto the message key, is the ENTIRE RAW RESPONSE TEXT
    // on a non-JSON error response. Forwarding it would put a whole response body into a
    // Sentry BREADCRUMB: a T-84-01 violation (logger.ts:8-13, `Info-Disclosure threat T-84-01`). So this call carries the
    // endpoint, the error NAME and -- when it is an ApiError -- its status and code, and
    // NOTHING derived from the response body. The full url is not carried either
    // (T-88.6-124, defence in depth complementing AC-1 beforeSend scrub, never a
    // substitute for it).
    // [AMENDED 2026-09-29, plan 88.6-62 (review round 2 #3): "the ENTIRE RAW RESPONSE TEXT"
    // is now AT MOST 200 characters (plus " [truncated]") — `nonJsonErrorBody` caps it at
    // both reshape sites, which bounds the errCtx breadcrumbs every CONSUMER files and the
    // captured exception value. The decline of errCtx at THIS site STANDS: 200 characters
    // of a response body are still body text, and this breadcrumb needs none of it.]
    // [AMENDED Phase 88.6.1-23 (W063): "bounds the errCtx breadcrumbs every CONSUMER files"
    // was true only of NON-JSON text until this plan; a JSON envelope message and the joined
    // field errors rode uncapped. From this plan on every body-derived message is redacted and
    // then capped where it is built (`capErrorText`), so the sentence holds for both. The
    // decline of errCtx at THIS site still STANDS.]
    //
    // AMENDED Phase 88.6-57 (CR-501, 88.6-REVIEW.md, 2026-09-28): "the full url is not
    // carried" was true of the ORIGIN and FALSE of the QUERY STRING until this plan --
    // `endpoint` is the url minus `/api`, so `friendshipsAPI.searchUserByEmail`'s
    // `?email=bob%40example.com` rode into both the message and the ctx on every 404 (the
    // invite-by-email flow's normal path). The endpoint is now PATH-ONLY in both, and the
    // beforeSend EMAIL rule (sentry.scrub.js) additionally catches `%40`. Scope, stated
    // honestly: this closes the breadcrumb and exception sinks only; the GET-query
    // CONTRACT (Sentry transactions, backend request logs) is routed to Phase 93 (G13).
    // Re-adding the query here is a decision, not a cleanup.
    //
    // NOT A PRECEDENT AGAINST THE AC-4 FIELD ABOVE: that field is a STRING forwarded to
    // Sentry extra on an EVENT that already egresses today and is deep-scrubbed at
    // sentry.scrub.js's `deepScrub`. This site would carry the raw response TEXT into a
    // breadcrumb that does not egress today. Different site, different payload, different
    // existing baseline -- both rules stand, and neither licenses the other. Restoring
    // errCtx here is a decision, not a consistency fix.
    const apiErr = error instanceof ApiError ? error : undefined;
    const path = endpoint.split('?')[0];
    logger.info(`API Error (${path})`, { endpoint: path, error: error instanceof Error ? error.name : typeof error, status: apiErr?.status, code: apiErr?.code });
    // Re-throw with more context if it's a network error. ANY TypeError thrown
    // by fetch() is a network-level failure per the spec, but the message text
    // is engine-specific — Chrome throws "Failed to fetch", Safari throws
    // "Load failed" — so match on the type alone, never the message (WR-04).
    // Abort/timeout rejections are DOMExceptions, not TypeErrors, and fall
    // through to the raw rethrow below.
    if (error instanceof TypeError) {
      throw new ApiError(
        'Network error: Could not connect to the server. Please check if the backend is running and NEXT_PUBLIC_API_URL is set correctly.',
        'network',
        0
      );
    }
    throw error;
  }
}

// -----------------------------------------------------------------------------
// TRANSPORT FOR THE FIVE apiFetch-BYPASSING PUBLIC HELPERS (T-88.6-122) — SIX since 88.6-58
// -----------------------------------------------------------------------------
/* DECISION Phase 88.6-42 (R8 §3 / §7 / §12): the five public helpers that BYPASS apiFetch
   -- rsvpPublicAPI.respondViaToken, magicAuthAPI.validateToken,
   availabilityFormAPI.submitResponse, prefillFromGcal and prefillFromSaved -- are hardened
   IN PLACE at the TRANSPORT level, chosen OVER (a) rostering them for Phase 93, and OVER
   (b) retrofitting a default timeout into apiFetch itself.

   (a) is rejected because this is the only 88.6 plan that may legally edit this file, so
   deferring means the next legal window is a BACKEND phase while the change is the same
   five call sites either way. (b) is THE FENCE, and it matters: once the honest cause is
   stated, a default at the shared boundary looks like the "proper" fix -- and it would
   change EVERY fetch in the app, at wave 8, with no census and no owner.

   THE HONEST CAUSE, because the wrong one invites the wrong fix: these helpers lack a
   timeout NOT because they bypass apiFetch but because NOTHING in this module had one,
   apiFetch included. (Measured 2026-09-17: the only AbortController/AbortSignal/timeout
   token in this file before this plan was a COMMENT in apiFetch's catch.) The bypass is
   why they ALSO lacked res.ok and a guarded success parse. The app-wide absence is an
   OWNED RESIDUAL with Phase 93 named in .planning/deferred/phase-93.md.

   WHY THIS IS NOT COSMETIC: AvailabilityForm.js marks a pre-fill in flight BEFORE the
   await (prefillSource names the running source, and the prefillInFlightRef latch is set)
   and clears both ONLY in finally. While they are set, the PRESSED pre-fill button is
   aria-disabled (it keeps focus, and the latch refuses its presses) and the OTHER button is
   natively disabled. A request that never settles leaves BOTH PRE-FILL BUTTONS PERMANENTLY
   UNUSABLE on the SMS/email magic-link flow, with no recovery short of a reload, on the
   phone-primary surface. An AbortError that is SWALLOWED re-creates exactly that state,
   which is why it is MAPPED to a rejection here and never absorbed.
   (Corrected in place by plan 88.6.1-49, 2026-10-16 Pacific: this paragraph named the
   boolean flag plan 88.6.1-26 replaced with prefillSource, and said both buttons were
   disabled on it. The mechanism changed; the conclusion did not.)

   BINDING CONSTRAINT -- NO res.ok THROW is added to any of the five, and no resolved body
   SHAPE changes. Every consumer reads the parsed body's fields directly
   (rsvp/[token]/page.js branches on result.error === 'event_cancelled';
   AvailabilityForm.js reads response.error), and the owner's D62 branch-B ruling
   (2026-09-09) KEEPS those reads. An res.ok throw would strand them -- that is branch A,
   which the owner rejected. Adding one here is a decision, not a hardening.
   [AMENDED IN PLACE 2026-09-29 — DECISION Phase 88.6-62 (review round 2 cluster A #1/#7/#12,
   owner ruling `R2-FIXNOW-SET-RULING: yes`): the constraint above HOLDS for five of the six
   helpers and `magicAuthAPI.validateToken` is its ONE scoped exception — it now throws a coded
   `ApiError` for every non-OK status EXCEPT 400. The exception is sound because its only
   consumer reads NO error discriminant off the body: the page's `validation.error` read was
   deleted by plan 42 (availability-form/[token]/page.js records the deletion beside its
   `!validation.valid` guard), and it reads `.valid` plus success-body fields only. 400 is kept
   resolving because that is the backend's `token_invalid` answer (Sonnet/routes/magicAuth.js
   `sendError(res, 'token_invalid', …)`), which the page's invalid-link branch owns. Where D62
   branch B genuinely BINDS is the SUBMIT path (`submitResponse`, and `respondViaToken` for the
   RSVP page): a CONSEQUENCE constraint — an res.ok throw there strands the `response.error` /
   `result.error` reads those consumers still make (the availability form's became a
   `success: true` gate plus a Sentry-only `upstreamMessage` read in task 3 of this plan — the
   constraint still binds; see the note on `submitResponse`). `getExistingResponse` and the two prefill
   helpers also keep their resolved shapes. Every transport failure out of all six is now an
   `ApiError('network')` and every unparseable body an `ApiError('internal')` (see
   `timedPublicFetch` / `guardedJson` below).]
   [AMENDED Phase 88.6.1-23 (R3-M7/M9): "every non-OK status EXCEPT 400" and "400 is kept
   resolving" now read by CODE: validateToken throws for every non-OK answer whose code
   (`mapErrorToCode`) is not `token_invalid`, and resolves a `token_invalid` answer whatever its
   status. The page's invalid-link branch still owns exactly the backend's `token_invalid`
   answer; a second 400 on the route no longer renders as a dead link. See the DECISION Phase
   88.6.1-23 (R3-M7/M9) marker in validateToken.]

   [AMENDED Phase 88.6.1-23 (R9 mechanism, owner ruling 2026-10-05): `respondViaToken` is a
   SECOND scoped exception, 5xx ONLY — a status of 500 or above rejects `ApiError('internal')`
   before the parse (and before any body read: its timedPublicFetch call skips a 5xx body), and
   every status below 500 still resolves its parsed body unchanged. The binding constraint above
   is a CONSEQUENCE constraint for the bodies a consumer reads; the RSVP page reads only 403 and
   410 discriminants, and no 5xx body carries one. What it fixes: the app's own JSON 500 on
   `/rsvp/respond` RESOLVED and fell to the page's generic copy, which tells the person to tap
   a single-use link the backend may already have consumed; the owner ruled that a server error
   shows R9 (plan 88.6.1-36's `internal` arm). "ONE scoped exception" in the bracket above now
   reads: validateToken is the one helper that throws on a 4xx, and respondViaToken throws on
   5xx only. See the DECISION Phase 88.6.1-23 (R9 mechanism) marker at the guard.]
   [AMENDED 2026-10-19 (88.6.1 code review A-80): since plan 88.6.1-87 (close ruling P-77, owner
   ruling D4 "Option A") respondViaToken ALSO rejects `ApiError('not_found')` for a parsed 404
   whose body carries the backend token `event_not_found`; every other status below 500 still
   resolves its parsed body. So the bracket above reads: respondViaToken rejects `internal` for a
   status of 500 or above, and `not_found` for that one token-keyed 404; the 4xx throws are
   validateToken's (by code) and respondViaToken's one token-keyed 404. The four 403 / 410 reads
   the page depends on still resolve. See the 88.6.1-87 amendment at respondViaToken's guard.]

   AMENDED IN PLACE 2026-09-28 — DECISION Phase 88.6-58 (review MEDLOW-2, owner ruling
   `FIX-NOW-SET-RULING: as-recommended`): the census above was FIVE and is SIX. The sixth,
   `availabilityFormAPI.getExistingResponse`, was MISSED — a raw `fetch(...).then(res =>
   res.ok ? res.json() : null)` with no timer, no signal, no guarded parse and an unencoded
   `promptId`. Its one consumer (availability-form/[token]/page.js, the `await
   availabilityFormAPI.getExistingResponse(` inside the validate try) awaits it BEFORE
   `setPageState(PAGE_STATES.READY)`, so a stalled GET was the same "spun forever" class this
   marker claims closed. It now uses `timedPublicFetch` + `guardedJson` like the other five,
   keeps its `object | null` resolved contract (non-2xx and unparseable 2xx both resolve
   `null`; only a transport failure rejects), and encodes `promptId`. The binding constraint
   above still holds for it: no res.ok THROW and no body-shape change. */
const PUBLIC_TRANSPORT_TIMEOUT_MS = 20_000;

/**
 * `fetch` AND the body read under ONE timeout whose abort is MAPPED to a rejection, never
 * swallowed.
 *
 * Every rejection out of `fetch` is a transport-level failure (a network error, an abort,
 * a DNS failure), and every consumer of these five helpers renders ONE failure outcome for
 * all of them, so they are collapsed onto `failureMessage` rather than discriminated here.
 * Telling a transport failure apart from a genuine token rejection needs a backend `code`
 * these routes do not carry -- an owned residual with Phase 93 named.
 * [AMENDED 2026-09-29, plan 88.6-62 (review round 2 cluster A, #4/#13): the paragraph above
 * is superseded in two ways. (1) A failure is now an `ApiError(failureMessage, 'network', 0)`
 * (and an unparseable body, via `guardedJson`, an `ApiError(failureMessage, 'internal',
 * status)`), so consumers CAN tell a transport failure from a token rejection — the backend
 * already sends `token_invalid` for the latter; the premise "needs a backend code these
 * routes do not carry" was false for the validate route. (2) The body is read INSIDE the
 * deadline, so a response whose headers arrive and whose body then stalls rejects at 20 s
 * instead of hanging; the helper therefore returns `{ res, text }`.]
 * [AMENDED Phase 88.6.1-23 (MEDLOW-18): "they are collapsed onto `failureMessage` rather than
 * discriminated here" now has ONE exception — a timeout (this helper's own deadline fired)
 * carries the suffix " (timed out after 20000 ms)" — and every failure keeps the caught value
 * as the ApiError's platform `cause`. See the DECISION Phase 88.6.1-23 (W062 rider MEDLOW-18)
 * marker at the catch.]
 *
 * DECISION Phase 88.6-62 (review round 2 #4/#13): the body read is FOLDED into this timed
 * helper (the review's first-named option) and the timer is still cleared in `finally`, so
 * the deadline spans headers + body and no timer outlives its request. REJECTED: leaving the
 * timer armed after headers (a timer that outlives every successful call and that nothing
 * clears). REJECTED: `AbortSignal.timeout` (a second deadline mechanism beside the controller
 * the six helpers already share). Reading the body outside this helper again is a decision,
 * not a cleanup — it re-opens the stalled-body hang on the magic-link critical path.
 * [AMENDED Phase 88.6.1-23 (R3-M3 / D-26): every sentence above stands. The helper gains ONE
 * opt-in, `skipErrorBody` (a boolean, or a predicate over the status), so a caller that
 * DISCARDS a non-OK body is not held by it.]
 *
 * DECISION Phase 88.6.1-23 (R3-M3 / D-26): CHOSEN — one opt-in, a boolean or a per-status
 * predicate, that lets a caller which DISCARDS a non-OK body (for every status, or for the
 * statuses the predicate names) skip reading it. When it says skip, the helper never reads the
 * body, cancels it through this helper's own controller and returns `{ res, text: '' }`. The
 * read still exists only in this helper, so the 88.6-62 rule above ("reading the body outside
 * this helper again is a decision") is honoured, not bypassed. `getExistingResponse` passes
 * the boolean (it returns `null` for every non-OK answer), and `respondViaToken` passes a
 * predicate that is true for 500 and above only (nothing reads its 5xx body; see its
 * DECISION Phase 88.6.1-23 (R9 mechanism) marker).
 * REJECTED (a): a fetch-then-read split under the same controller at the call site (the
 * register's second option). It puts a second body-handling path outside this helper, which is
 * what 88.6-62 forbids.
 * REJECTED (b): leaving the unread body un-cancelled. Nothing would ever drain it, and it can
 * hold the connection.
 * REJECTED (c): `res.body.cancel()`. A second cancellation mechanism beside the controller, and
 * `body` can be null.
 * REJECTED (d): skipping a body a helper READS. `respondViaToken` reads `result.error` off its
 * 403 / 410 bodies and the prefill helpers read their error copy off a non-OK body (DECISION
 * Phase 88.6-42's D62 branch B), so none of them takes the boolean form; respondViaToken's
 * predicate stays false below 500, so its 403 / 410 bodies are still read.
 * Turning the opt-in on for another helper or another status, or reading the body outside this
 * helper, is a decision, not a cleanup.
 */
async function timedPublicFetch(
  url: string,
  init: RequestInit,
  failureMessage: string,
  { skipErrorBody = false }: { skipErrorBody?: boolean | ((status: number) => boolean) } = {}
): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLIC_TRANSPORT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const skip =
      !res.ok && (typeof skipErrorBody === 'function' ? skipErrorBody(res.status) : skipErrorBody);
    if (skip) {
      // Cancel the unread body through the one mechanism this helper owns (REJECTED (b), (c)).
      controller.abort();
      return { res, text: '' };
    }
    const text = await res.text();
    return { res, text };
  } catch (caught) {
    // DECISION Phase 88.6.1-23 (W062 rider MEDLOW-18): CHOSEN — keep the caught value as the
    // platform `cause`, and tell a timeout apart by its MESSAGE, keyed on this helper's own
    // deadline (its controller's signal is aborted; the skip path above returns and never
    // throws, so the timer is the only thing that can have aborted it). The message is built
    // from constants only: the helper's failure constant and PUBLIC_TRANSPORT_TIMEOUT_MS.
    // REJECTED (a): a distinct `name`. `name` is fixed at 'ApiError', consumers branch on
    // instanceof, and the 'ApiError — shape' test pins it (APPENDIX-DF :164).
    // REJECTED (b): a new ApiErrorCode such as a timeout code. Every consumer renders the same
    // `network` copy for both, `shouldRetry` and the Sentry tags key on `network`, and plan
    // 88.6.1-36 keys the RSVP timeout state on `network`.
    // REJECTED (c): classifying by the caught error's own name or text. Engines differ and a
    // test double can fake it; the helper's own signal is the one source of truth.
    // REJECTED (d): splicing the caught text into the message. An engine's TypeError can quote
    // the request URL, `respondViaToken` and `getExistingResponse` carry the magic token in the
    // query, and the message reaches breadcrumbs through `errCtx`.
    // REJECTED (e): a cause on `guardedJson`'s `internal` rejection. A JSON SyntaxError's text
    // can quote the response body (SPEC Prohibition 5).
    // Honest limit: CORS, DNS and offline failures stay one class. The browser reports them as
    // the same TypeError on purpose; the cause carries whatever the browser said.
    // Putting the caught text into the message, or a cause on the parse failure, is a decision,
    // not a cleanup.
    const timedOut = controller.signal.aborted;
    throw new ApiError(
      timedOut
        ? `${failureMessage} (timed out after ${PUBLIC_TRANSPORT_TIMEOUT_MS} ms)`
        : failureMessage,
      'network',
      0,
      undefined,
      undefined,
      { cause: caught }
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse an already-read body as JSON, or REJECT with `ApiError(failureMessage, 'internal',
 * status)`.
 *
 * The gap this closes: `return res.json()` on the SUCCESS path threw an unhandled
 * `SyntaxError` for a non-JSON 200 -- a proxy or gateway HTML page -- while the error path
 * beside it was already guarded. The status is deliberately NOT inspected (see the binding
 * constraint above): this reads the body the caller asked for and nothing else.
 * [AMENDED 2026-09-29, plan 88.6-62: takes the TEXT `timedPublicFetch` read under its deadline
 * (plus the status, for the ApiError) instead of reading the body itself, and throws a coded
 * `ApiError('internal')` instead of a plain Error. Same name, so every marker naming it holds.]
 */
function guardedJson(text: string, status: number, failureMessage: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(failureMessage, 'internal', status);
  }
}

/**
 * A prefill helper's non-OK body as an object for its `err.error` read: the parsed JSON when
 * it is an object, else `{}` (a non-JSON body, or a JSON `null` / scalar). Replaces
 * `res.json().catch(() => ({}))` now that `timedPublicFetch` has already read the text
 * (plan 88.6-62); the `{}` for `null` also closes a `null.error` TypeError that form allowed.
 */
function objectBodyOrEmpty(text: string): any {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * API functions for Groups
 */
export const groupsAPI = {
  // Get all groups for a user
  getUserGroups: (user_id: string) =>
    apiFetch<GroupList>(`/groups/user/${encodeURIComponent(user_id)}`),

  // Get a single group by ID
  getGroup: (group_id: string) =>
    apiFetch<Group>(`/groups/${group_id}`),

  // Get all users in a group
  getGroupMembers: (group_id: string) =>
    apiFetch<GroupMemberList>(`/groups/${group_id}/users`),

  // Create a new group
  createGroup: (groupData: Record<string, unknown>) =>
    apiFetch<Group>('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData),
    }),

  // Update user role in group (owner only)
  updateUserRole: (group_id: string, target_user_id: string, role: string) =>
    apiFetch(`/groups/${group_id}/users/${target_user_id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  // Remove user from group (owner or admin). Authz derives the caller from the
  // Auth0 token (FSEC-02) — no client-supplied caller identity in the body.
  removeUserFromGroup: (group_id: string, target_user_id: string) =>
    apiFetch(`/groups/${group_id}/users/${target_user_id}`, {
      method: 'DELETE',
    }),

  // Update group settings (profile picture, background)
  updateGroupSettings: (group_id: string, settings: Record<string, unknown>) =>
    apiFetch(`/groups/${group_id}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        ...settings,
      }),
    }),

  // Delete group (owner only)
  deleteGroup: (group_id: string) =>
    apiFetch(`/groups/${group_id}`, {
      method: 'DELETE',
    }),

  // Blast radius for the Danger Zone (Phase 88.2 / SPEC-REQ-5, D-06). Owner-only
  // and AUTHENTICATED — the counts are computed server-side precisely so the
  // client never states a number that is merely its own guess at the moment a
  // destructive decision is made.
  getDeletionImpact: (group_id: string) =>
    apiFetch<DeletionImpact>(`/groups/${group_id}/deletion-impact`),

  // Approve a pending member (owner/admin only)
  approveMember: (group_id: string, target_user_id: string) =>
    apiFetch(`/groups/${group_id}/users/${encodeURIComponent(target_user_id)}/approve`, {
      method: 'POST',
    }),

  // Reject a pending member (owner/admin only)
  rejectMember: (group_id: string, target_user_id: string) =>
    apiFetch(`/groups/${group_id}/users/${encodeURIComponent(target_user_id)}/reject`, {
      method: 'POST',
    }),

  // Leave a group (self-removal, non-owner only)
  leaveGroup: (group_id: string) =>
    apiFetch(`/groups/${group_id}/leave`, {
      method: 'POST',
    }),

  // Transfer group ownership to another active member (owner only)
  transferOwnership: (group_id: string, new_owner_user_id: string) =>
    apiFetch(`/groups/${group_id}/transfer-ownership`, {
      method: 'POST',
      body: JSON.stringify({ new_owner_user_id }),
    }),

  // Get (or lazy-generate) group invite token
  getInviteToken: (group_id: string) =>
    apiFetch(`/groups/${group_id}/invite-token`),

  // Reset group invite token (owner/admin only)
  resetInviteToken: (group_id: string) =>
    apiFetch(`/groups/${group_id}/reset-invite-token`, { method: 'POST' }),

  // Join group by invite token (authenticated)
  joinByToken: (token: string) =>
    apiFetch('/groups/join-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get group invite preview (public, no auth needed) — runs BEFORE the auth
  // check on logged-out invite pages, so it MUST bypass the BFF proxy.
  getInvitePreview: (token: string) =>
    publicFetch<GroupInvitePreview>(`/groups/invite-preview/${token}`),

  // Preview a soft-deleted group from an emailed restore token (Phase 88.2).
  // PUBLIC, like getInvitePreview directly above: /restore/group/[token] renders
  // for a logged-out recipient, so it runs BEFORE the auth check and MUST bypass
  // the BFF proxy. Using apiFetch here is the one mistake that will not surface
  // in local dev — the authenticated path fails only for the logged-out case.
  //
  // DECISION Phase 88.2-09: encodeURIComponent HERE but not in the sibling
  // getInvitePreview above — a deliberate divergence, not an inconsistency to
  // "converge". publicFetch targets the backend origin DIRECTLY, so it never
  // passes through the BFF catch-all where this codebase's path-traversal guard
  // (isSafePathSegment) lives. The token comes straight off the route params and
  // is fully caller-controlled, so a bare interpolation lets a crafted value
  // reshape the request path. Follow getUserGroups/approveMember (which encode),
  // not getInvitePreview. The two pre-existing unencoded previews are recorded as
  // a follow-up in 88.2-09-SUMMARY.md rather than changed here.
  getRestorePreview: (token: string) =>
    publicFetch<RestorePreview>(`/groups/restore-preview/${encodeURIComponent(token)}`),

  // Accept ownership of a soft-deleted group and restore it (Phase 88.2).
  // AUTHENTICATED, and the structural twin of joinByToken above: the token rides
  // in the BODY, not the path. The session identifies the person; the token
  // identifies the group.
  acceptGroupOwnership: (token: string) =>
    apiFetch<AcceptOwnershipResult>('/groups/accept-ownership', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get the group's shared game library (all members' games, deduplicated with owners)
  getGroupLibrary: (group_id: string) =>
    apiFetch<GameList>(`/groups/${group_id}/library`),
};

/**
 * API functions for Events
 */
export const eventsAPI = {
  // Get all events for a user across all groups
  getUserEvents: (user_id: string, { includeRsvpSummary = false } = {}) =>
    apiFetch<EventList>(`/events/user/${encodeURIComponent(user_id)}${includeRsvpSummary ? '?include_rsvp_summary=true' : ''}`),

  // Get all events for a group
  getGroupEvents: (group_id: string, { includeRsvpSummary = false } = {}) =>
    apiFetch<EventList>(`/events/group/${group_id}${includeRsvpSummary ? '?include_rsvp_summary=true' : ''}`),

  // Get a single event by ID
  getEvent: (event_id: string) =>
    apiFetch<Event>(`/events/${event_id}`),
  
  // Create a new event
  createEvent: (eventData: Record<string, unknown>) => 
    apiFetch('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    }),
  
  // Update an event (requires owner/admin)
  updateEvent: (event_id: string, eventData: Record<string, unknown>) =>
    apiFetch(`/events/${event_id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...eventData }),
    }),

  // Delete an event (requires owner/admin). Authz derives the caller from the
  // Auth0 token (FSEC-02) — no client-supplied caller identity in the body.
  deleteEvent: (event_id: string) =>
    apiFetch(`/events/${event_id}`, {
      method: 'DELETE',
    }),

  // Remove a single participant from an event (owner/admin only).
  // EVT-08: hard-destroys the EventParticipation row + writes an audit
  // log entry so a subsequent QR re-join is silent (no welcome email).
  // participation_user_id is the User.id (UUID), not the Auth0 string.
  removeParticipation: (event_id: string, participation_user_id: string) =>
    apiFetch(`/events/${event_id}/participations/${participation_user_id}`, {
      method: 'DELETE',
    }),

  // Phase 71.1 GAMP-04 — game-only participant self-leave.
  // Backend DELETE /events/:event_id/participations/:user_id was extended in
  // Plan 71.1-01 to allow self-leave (caller's User.id === participationUserId).
  // user_db_id is the User.id UUID (NOT Auth0 string). Resolved frontend-side
  // from the groupMembers roster (Plan 01 guarantees caller's own row is in
  // the response with UserGroup=null for game-only callers). Distinct helper
  // name from removeParticipation even though the underlying endpoint is
  // shared — semantically leaveEvent is self-action, removeParticipation is
  // admin-action; backend authz decides whether the caller is allowed.
  leaveEvent: (event_id: string, user_db_id: string) =>
    apiFetch(`/events/${event_id}/participations/${user_db_id}`, {
      method: 'DELETE',
    }),

  // Get (or lazy-generate) event invite token
  getEventInviteToken: (event_id: string) =>
    apiFetch(`/events/${event_id}/invite-token`),

  // Join game by invite token (authenticated)
  joinGameByToken: (token: string) =>
    apiFetch('/events/join-game-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get event invite preview (public, no auth needed) — runs BEFORE the auth
  // check on logged-out invite pages, so it MUST bypass the BFF proxy.
  getEventInvitePreview: (token: string) =>
    publicFetch(`/events/invite-preview/${token}`),
};

/**
 * API functions for RSVPs (event responses: yes/no/maybe)
 */
export const rsvpAPI = {
  // Create or update an RSVP for an event.
  //
  // DECISION Phase 88.5 (Owner Ruling 1a): an omitted/`undefined` `note` argument
  // is DROPPED from the serialized body by JSON.stringify — the request carries no
  // `note` key at all, NOT `note: null` and NOT `note: undefined`. That dropped-key
  // behaviour is load-bearing, not incidental: post-88.5 the backend
  // (routes/rsvp.js POST /) treats an ABSENT `note` key as "preserve the existing
  // note" and a PRESENT one (including `null`/`""`) as "write this value" — which
  // is what lets a status-only tap (the hero card, plan 88.5-05) change status
  // without wiping the member's saved note. Do NOT "normalize" this by always
  // sending `note: note ?? null`; that would re-introduce the wipe the backend fix
  // exists to close. Pinned by a test in api.test.ts.
  // `note?: string | null` — null is a LEGITIMATE wire value (explicit clear:
  // RsvpSection's Save note sends `note || null`). Narrowing this to `string`
  // would make the TS conversion of RsvpSection "fix" `note || null` into
  // `note || undefined`, silently breaking note deletion (adversarial review
  // 2026-09-01, ML4). Pinned in api.test.ts (explicit-null case).
  submitRsvp: (event_id: string, status: string, note?: string | null) =>
    apiFetch('/rsvp', {
      method: 'POST',
      body: JSON.stringify({ event_id, status, note }),
    }),
  // Get all RSVPs for an event (includes summary counts).
  //
  // DECISION Phase 88.5 (RESEARCH B-2): this was typed apiFetch-of-RsvpList — an
  // ARRAY — which was simply wrong. The route returns an OBJECT,
  // `{ rsvps, summary }` (periodictabletopbackend_v2/Sonnet/routes/rsvp.js, anchor
  // `return res.json({ rsvps: shapedRsvps, summary });`).
  // The wrong type survived because every consumer was `.js` (src/app/components/RsvpSection.js:166-167,
  // `setRsvps(data.rsvps || [])`; src/app/gameDetail/page.js:723 and :977, `rsvpAPI.getEventRsvps(`;
  // lines read at 88.6.1-07) so TS never checked it; all three already read
  // `data.rsvps` / `data.summary`, i.e. they always treated it as the object. Do not
  // revert to RsvpList.
  getEventRsvps: (event_id: string) =>
    apiFetch<RsvpEventResponse>(`/rsvp/event/${event_id}`),
};

/**
 * API functions for public RSVP (magic link, no Auth0 required)
 * Uses direct fetch without Auth0 token injection
 */
const RSVP_RESPOND_TRANSPORT_FAILURE = 'rsvp respond request did not complete';
// Plan 88.6.1-87 (close ruling P-77): the message of the not_found rejection below. A log
// message only, never rendered: the RSVP page renders its copy by page state.
const RSVP_RESPOND_EVENT_GONE = 'rsvp respond: the event no longer exists';

export const rsvpPublicAPI = {
  // Respond to RSVP via magic link token (no auth required) — direct-to-backend
  // (PUBLIC_API_BASE_URL), never the BFF proxy.
  //
  // T-88.6-123 (#103, routed here from plan 24 by D41): `eventId` and `status` are now
  // percent-encoded like the `token` and `userId` arms beside them, which always were.
  // DEFENCE-IN-DEPTH, not a live hole — verified at source: Sonnet/routes/rsvp.js (anchor
  // `['yes', 'maybe', 'no'].includes(status)`) allow-lists the status and the anchor
  // `const expectedToken = generateRsvpToken(eventId, userId, status);` recomputes the HMAC over (eventId, userId, status)
  // and 403s on mismatch. The asymmetry is closed because a reader would otherwise tidy it
  // the WRONG way, by dropping the two encodings that are there.
  respondViaToken: async (token: string, eventId: string, userId: string, status: string) => {
    const { res, text } = await timedPublicFetch(
      `${PUBLIC_API_BASE_URL}/rsvp/respond?token=${encodeURIComponent(token)}&e=${encodeURIComponent(eventId)}&u=${encodeURIComponent(userId)}&s=${encodeURIComponent(status)}`,
      {},
      RSVP_RESPOND_TRANSPORT_FAILURE,
      { skipErrorBody: (s) => s >= 500 }
    );
    // DECISION Phase 88.6.1-23 (R9 mechanism; owner ruling 2026-10-05, copy key R9): CHOSEN — a
    // status of 500 or above rejects `internal` at headers, before any body read (the status
    // predicate on timedPublicFetch's skip opt-in above) and before the parse; every status
    // below 500 still resolves its parsed body. `internal` is the code this module already gives
    // every 5xx (`statusToCode`), and the RSVP page's `internal` arm (plan 88.6.1-36) shows R9,
    // which is true whether or not the single-use token was spent (the backend consumes it
    // before the work that can 500, BE `routes/rsvp.js` `consumeByNonce`).
    // WHY DECISION Phase 88.6-42's no-throw rule does not bind here: it is a CONSEQUENCE
    // constraint that protects the bodies the page reads, the 403 and 410 discriminants. The
    // backend's 5xx body carries none of them and the page never reads it, so this throw
    // strands no read.
    // REJECTED (a): a full res.ok throw. That is branch A (owner, 2026-09-09): it strands the
    // four 403 / 410 reads.
    // REJECTED (b): telling the 500 apart on the page by its text. Backend prose is never a
    // discriminant here (the error-envelope roster pins this page's reads at four), and a
    // resolved body carries no status.
    // REJECTED (c): attaching the 5xx body as `details` or `upstreamMessage`. Nothing reads it,
    // and a raw backend body must not ride a diagnostic (SPEC Prohibition 5).
    // REJECTED (d): reading the 5xx body and checking the status afterwards (the first draft of
    // this guard). Nothing reads that body, so the page would wait for it, and a 5xx whose body
    // stalls would hold the person for the full 20 s and then reject `network` instead of
    // `internal`. Also rejected: a second body path outside timedPublicFetch to check the
    // status first (DECISION Phase 88.6-62 forbids it), and the boolean form of the skip, which
    // would also drop the 403 / 410 bodies. The per-status predicate skips only the body
    // nothing reads.
    // Widening this below 500, or reading the 5xx body, is a decision, not a cleanup.
    // AMENDED Phase 88.6.1-87 (close ruling P-77, owner 2026-10-18; key per owner ruling D4 Option A):
    // the app's own JSON 404 carrying the token event_not_found (BE
    // `periodictabletopbackend_v2/Sonnet/routes/rsvp.js` GET /respond, plan 88.6.1-87 Task 1, sent
    // after the token is consumed) now rejects `not_found`, read only after the parse so an HTML
    // 404 stays `internal`. The TOKEN is what is required, not the parse: Railway's edge answers a
    // detached or misrouted domain with its own JSON 404 (probed 2026-10-18,
    // `x-railway-fallback: true`, no `error` key), and that must never tell anyone a game night
    // was cancelled. The reasoning above holds: the only 404 that throws carries the token the
    // page now keys on, and the four reads are the 403 and 410 bodies, which still resolve. The
    // same 404 also answers an event soft-deleted with its group and restorable for 30 days,
    // owner-accepted 2026-10-18 ("a") under the detail's hedge, with the BE improvement routed to
    // Phase 93 (`.planning/deferred/phase-93.md`, entry
    // `GET /rsvp/respond: the 404 for a missing event`).
    // REJECTED (a): keying on the 404 parsing (Railway's fallback above). REJECTED (b): reading
    // the 404 body's prose (a backend string is never a discriminant). REJECTED (c): accepting
    // both bodies while the BE deploys (D4: the BE deploys first, and until then the case keeps
    // today's card). REJECTED (d): a status field on the resolved body (a body-shape change the
    // binding constraint above forbids).
    // [AMENDED 2026-10-19 (88.6.1 code review IN-14): the 5xx rejection carries the message every
    // other helper's server error carries (`extractErrorMessage` with no body read, "HTTP error!
    // status: N") over RSVP_RESPOND_TRANSPORT_FAILURE, which describes a request that did NOT
    // complete; this one completed with a server error, and the page's breadcrumb read like a
    // network drop. Code and status are unchanged.]
    if (res.status >= 500) throw new ApiError(extractErrorMessage(null, res.status), 'internal', res.status);
    // NO res.ok throw — rsvp/[token]/page.js reads `result.error` off the parsed 410 body
    // to tell "cancelled" from "already happened", and D62 branch B keeps that read.
    // [AMENDED Phase 88.6.1-23 (R9 mechanism): except a status of 500 or above, which rejects
    // internal above — no 5xx body carries a discriminant the page reads.]
    // [AMENDED Phase 88.6.1-87 (P-77): and except a parsed 404 carrying the backend token
    // event_not_found, which rejects not_found below; every other 404 resolves as before.]
    const body = guardedJson(text, res.status, RSVP_RESPOND_TRANSPORT_FAILURE);
    if (res.status === 404 && body?.error === 'event_not_found') throw new ApiError(RSVP_RESPOND_EVENT_GONE, 'not_found', 404);
    return body;
  },
};

/**
 * API functions for Event Brings (who is bringing which games)
 */
export const eventBringsAPI = {
  getEventBrings: (event_id: string) => apiFetch<EventBringList>(`/event-brings/event/${event_id}`),
  updateMyBrings: (event_id: string, game_ids: unknown[]) => apiFetch(`/event-brings/event/${event_id}/my-brings`, {
    method: 'PUT',
    body: JSON.stringify({ game_ids }),
  }),
};

/**
 * API functions for Users
 */
export const usersAPI = {
  // Get user by user_id (Auth0 identifier).
  // Phase 78 / TZ-01: Optional detectedTimezone is forwarded as ?timezone=...
  // so the backend's GET /:user_id auto-create handler can persist it on first
  // creation OR backfill it for an existing null-timezone user.
  // Pass null/undefined/empty -> the query param is omitted entirely (matching
  // CONTEXT D-Frontend: "On detection failure, omit the field. Do NOT send
  // 'UTC', do NOT send null, do NOT send a placeholder").
  getUser: (user_id: string, detectedTimezone: string | null = null) => {
    const path = `/users/${encodeURIComponent(user_id)}`;
    if (typeof detectedTimezone === 'string' && detectedTimezone.length > 0) {
      return apiFetch<User>(`${path}?timezone=${encodeURIComponent(detectedTimezone)}`);
    }
    return apiFetch<User>(path);
  },
  
  // Update user's username
  updateUsername: (user_id: string, username: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/username`, {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),
  
  // Mark tutorial as completed (with version tracking)
  completeTutorial: (user_id: string, version = 2) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/tutorial`, {
      method: 'PUT',
      body: JSON.stringify({ version }),
    }),

  // Reset tutorial for replay
  resetTutorial: (user_id: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/tutorial`, {
      method: 'DELETE',
    }),

  // Update notification preferences
  updateNotificationPreferences: (user_id: string, preferences: Record<string, unknown>) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/notification-preferences`, {
      method: 'PATCH',
      body: JSON.stringify({ preferences }),
    }),

  // Update user's timezone
  updateTimezone: (user_id: string, timezone: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/timezone`, {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    }),

  // Save phone number and initiate verification
  savePhone: (user_id: string, phone: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/phone`, {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  // Verify phone with SMS code
  verifyPhone: (user_id: string, code: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/phone/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // Remove phone number — backend cascades sms_enabled and all 4
  // notification_preferences[type].sms toggles to false in one transaction
  // per CONTEXT D-PHONE-02. Returns the updated user record.
  removePhone: (user_id: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/phone`, {
      method: 'DELETE',
    }),

  // Account-deletion pre-flight (Phase 87.2 / D-11). Resolves 200 { groups }
  // for a PROVISIONED caller — empty array when nothing blocks deletion,
  // non-empty (owned active groups + TOTAL member counts) when the owner gate
  // would fire; rejects 404 `not_provisioned` / 410 `account_deleted` for a
  // caller with no row (Phase 88.8 R7 — see the DeletionBlockerGroup docblock). NEVER rejects with owner_of_active_groups; that arrives only on
  // the DELETE (the server-side TOCTOU re-check). Caller derives from the Auth0
  // token server-side — no user_id in the path (self-scoped /users/me).
  getDeletionBlockers: () =>
    apiFetch<DeletionBlockers>('/users/me/deletion-blockers'),

  // Hard-delete the authenticated account (Phase 87.2). The BFF proxy forwards
  // DELETE with same-origin CSRF checks; caller identity comes from the Auth0
  // token server-side. On success the caller MUST navigate to logout IMMEDIATELY
  // (no toast-then-wait) so no authenticated fetch re-provisions a JIT ghost row.
  //
  // The OPTIONAL `signal` is hosted HERE rather than in plan 88.6-30, which threads a client
  // timeout into this call but does not declare src/lib/api.ts (D41 / cluster C): two wave-8
  // plans writing one file with no declared ordering is the sequencing hazard D41 exists to
  // prevent. SIGNATURE-ONLY — no default timeout is introduced, no call site changes, and all
  // three existing sites (DangerZoneDeleteAccount.tsx and its two mocks) are unaffected.
  // apiFetch itself needs no change: it spreads {...options} into fetch, and its catch
  // converts ONLY TypeError, rethrowing everything else raw — so an abort/timeout rejection
  // (a DOMException) falls through to classifyDeleteError's non-ApiError branch and the
  // 'ambiguous' lane, which already exists and is currently unreachable.
  deleteAccount: (signal?: AbortSignal) =>
    apiFetch<{ message: string }>('/users/me', { method: 'DELETE', signal }),

  // ── Email change (Phase 88.8 plan 13, SPEC R12 / D-09 as re-ruled) ─────────
  //
  // All five go through the AUTHENTICATED client. The public direct-to-backend
  // helper is deliberately NOT used by this feature: the original design's
  // public verification PAGE is retired (the mail carries a code, not a link),
  // and a function here reaching for `publicFetch` would be the tell that the
  // retired design had crept back.
  //
  // Shape follows the shipped `savePhone` above: the function takes SCALARS and
  // builds the JSON body HERE, in api.ts. The request key is `email` (and
  // `code` on verify) and it is PINNED ON BOTH SIDES — the backend refuses a
  // body carrying any other key (`routes/users.js`, the `keys[0] !== 'email'` /
  // `keys[0] !== 'code'` guards in the request and verify handlers — cite the SYMBOL,
  // the line numbers drifted twice in one phase),
  // and `src/lib/api.test.ts` asserts the exact serialised key set by stubbing
  // `fetch` and calling the REAL function. A mock-level assertion would prove
  // nothing: these take scalars, so a module-boundary mock never sees a body at
  // all, and the line below would never execute. Neither repo's CI can see the
  // other; those two assertions are the whole contract.
  //
  // All five answer the SAME 200 body (`EmailChangeResponse`). Resend, cancel
  // and revert take NO body — each is its own route precisely so a destructive
  // or re-sending intent cannot ride in on an address-shaped payload.
  requestEmailChange: (user_id: string, email: string) =>
    apiFetch<EmailChangeResponse>(`/users/${encodeURIComponent(user_id)}/email`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyEmailChange: (user_id: string, code: string) =>
    apiFetch<EmailChangeResponse>(`/users/${encodeURIComponent(user_id)}/email/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  resendEmailChangeCode: (user_id: string) =>
    apiFetch<EmailChangeResponse>(`/users/${encodeURIComponent(user_id)}/email/resend`, {
      method: 'POST',
    }),

  cancelEmailChange: (user_id: string) =>
    apiFetch<EmailChangeResponse>(`/users/${encodeURIComponent(user_id)}/email/cancel`, {
      method: 'POST',
    }),

  revertEmailToSignIn: (user_id: string) =>
    apiFetch<EmailChangeResponse>(`/users/${encodeURIComponent(user_id)}/email/revert`, {
      method: 'POST',
    }),
};

/**
 * API functions for Games
 */
export const gamesAPI = {
  // getGames (GET /games) DELETED — 87.5 review SW-02: zero product callers and
  // the BE route was removed (its ?group_id arm leaked group reviews
  // unauthenticated). Use searchAll / listsAPI.getGroupGames.

  // Get a single game by ID
  getGame: (game_id: string) => 
    apiFetch(`/games/${game_id}`),
  
  // Search BGG for games
  searchBGG: (query: string) => 
    apiFetch(`/games/bgg/search?query=${encodeURIComponent(query)}`),
  
  // Import game from BGG
  importFromBGG: (bgg_id: string) => 
    apiFetch(`/games/import-bgg/${bgg_id}`, {
      method: 'POST',
    }),
  
  // Search all games (local custom + BGG) for combo input
  searchAll: (query: string, groupId: string, userId: string) => {
    const params = new URLSearchParams({ query });
    if (groupId) params.append('group_id', groupId);
    if (userId) params.append('user_id', userId);
    return apiFetch(`/games/search-all?${params.toString()}`);
  },

  // Resolve a game name to an existing or new custom game
  resolveGame: (name: string) =>
    apiFetch('/games/resolve', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
};

/**
 * API functions for User Owned Games
 */
export const userGamesAPI = {
  // Get all games owned by a user
  getOwnedGames: (user_id: string) =>
    apiFetch<UserGameList>(`/user-games/user/${encodeURIComponent(user_id)}`),
  
  // Add game to user's collection
  addOwnedGame: (user_id: string, game_id: string) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/game/${game_id}`, {
      method: 'POST',
    }),
  
  // Remove game from user's collection
  removeOwnedGame: (user_id: string, game_id: string) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/game/${game_id}`, {
      method: 'DELETE',
    }),
  
  // Import entire BGG collection
  importBGGCollection: (user_id: string, bgg_username: string) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/import-bgg-collection`, {
      method: 'POST',
      body: JSON.stringify({ bgg_username }),
    }),
};

/**
 * API functions for Lists (sorted/filtered game lists)
 */
export const listsAPI = {
  // Get games for a group with sorting options
  // sort: 'name' | 'play_count' | 'last_played' | 'rating'
  // order: 'asc' | 'desc'
  getGroupGames: (group_id: string, user_id: string, sort = 'last_played', order = 'desc') => {
    const params = new URLSearchParams({ sort, order });
    return apiFetch(`/lists/games/${group_id}/${encodeURIComponent(user_id)}?${params.toString()}`);
  },
  
};

/**
 * API functions for Game Reviews
 */
export const gameReviewsAPI = {
  // Get reviews for a game in a group
  getGameReviews: (game_id: string, group_id: string, user_id: string | null = null) => {
    const params = user_id ? `?user_id=${encodeURIComponent(user_id)}` : '';
    return apiFetch(`/game-reviews/game/${game_id}/group/${group_id}${params}`);
  },
  
  // Create or update a review
  submitReview: (reviewData: Record<string, unknown>) =>
    apiFetch('/game-reviews', {
      method: 'POST',
      body: JSON.stringify(reviewData),
    }),
};

/**
 * API functions for Feedback
 */
export const feedbackAPI = {
  // Submit bug report or suggestion. Uses publicFetch (direct PUBLIC_API_BASE_URL,
  // not the authenticated BFF) because FeedbackForm mounts in the root layout and
  // must work logged-out; /api/feedback is a public route and the codebase forbids
  // public callers going through apiFetch/BFF. publicFetch shares the ApiError /
  // mapErrorToCode seam, so error/return shape and toast text are preserved for the
  // route's current {error}-shaped responses.
  submitFeedback: (feedbackData: Record<string, unknown>) =>
    publicFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify(feedbackData),
    }),

  // Submit feedback as a GitHub Issue (contextual feedback button)
  submitGitHubFeedback: (data: Record<string, unknown>) =>
    apiFetch('/feedback/github', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

/**
 * API functions for Google Calendar
 */
export const googleCalendarAPI = {
  // Get Google Calendar connection status
  getStatus: (user_id: string) => 
    apiFetch(`/auth/google/status/${encodeURIComponent(user_id)}`),
  
  // Disconnect Google Calendar
  disconnect: (user_id: string) => 
    apiFetch('/auth/google/disconnect', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
};

/**
 * API functions for Availability and Planning
 */
export const availabilityAPI = {
  // Get user's availability patterns (for editing/deleting)
  getUserPatterns: (user_id: string) =>
    apiFetch<AvailabilityList>(`/availability/user/${encodeURIComponent(user_id)}/patterns`),
  
  // Create recurring availability schedule
  createRecurringPattern: (user_id: string, patternData: Record<string, unknown>) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/recurring`, {
      method: 'POST',
      body: JSON.stringify(patternData),
    }),
  
  // Create specific date/time override
  createOverride: (user_id: string, overrideData: Record<string, unknown>) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/override`, {
      method: 'POST',
      body: JSON.stringify(overrideData),
    }),
  
  // Delete availability pattern/override
  deleteAvailability: (availability_id: string) => 
    apiFetch(`/availability/${availability_id}`, {
      method: 'DELETE',
    }),
  
  // Get merged availability heatmap for a group (1-hour bucketed, 12pm-11pm)
  getGroupHeatmap: (group_id: string, weekStart: string, timezone: string = 'UTC') => {
    const params = new URLSearchParams({ timezone });
    if (weekStart) params.append('week_start', weekStart);
    return apiFetch(`/availability/group/${group_id}/heatmap?${params.toString()}`);
  },
};

/**
 * API functions for Magic Auth (no Auth0 required)
 * These use direct fetch without Auth0 token injection
 */
const MAGIC_VALIDATE_TRANSPORT_FAILURE = 'magic-auth validate request did not complete';

export const magicAuthAPI = {
  // Validate a magic token (returns user info, prompt_id, expiry).
  //
  // The FIRST call the availability magic-link page makes, and its consumer catches
  // EVERYTHING this throws to render "This link is no longer valid. Please request a new
  // one from your group organizer." — so before this hardening a hung request spun forever
  // and a proxy HTML page told the user their link was permanently dead via an unhandled
  // SyntaxError. The residual is named, not implied: a transport failure and a genuine
  // token rejection still render the SAME copy, because telling them apart needs a backend
  // `code` these rejects do not carry. Phase 93 owns it.
  // [AMENDED 2026-09-29, plan 88.6-62 (review round 2 cluster A; the remaining half of
  // 88.6.1 W002): that residual's premise was FALSE — Sonnet/routes/magicAuth.js answers a bad
  // token with a 400 `token_invalid` envelope (`sendError(res, 'token_invalid', …)`); the raw
  // 500 in its catch is the one code-less body. It is now RESOLVED here, FE-only: a transport
  // failure rejects `ApiError('network')`, an unparseable body `ApiError('internal')`, and any
  // non-OK status except 400 a coded ApiError (429 → rate_limited, the raw 500 → internal),
  // while the 400 still RESOLVES into the page's invalid-link branch. See the DECISION Phase
  // 88.6-42 binding-constraint amendment for why this one helper may throw on status.]
  // [AMENDED Phase 88.6.1-23 (R3-M7/M9): "while the 400 still RESOLVES" is now "while the
  // `token_invalid` answer still RESOLVES": the discriminator is the backend's CODE, not the
  // status. A non-OK answer resolves only when its code is `token_invalid` (whatever its
  // status); every other non-OK answer, a 400 with any other code or none included, throws the
  // coded ApiError. See the DECISION Phase 88.6.1-23 (R3-M7/M9) marker at the guard.]
  validateToken: async (token: string, formLoadedAt = null) => {
    const { res, text } = await timedPublicFetch(
      `${PUBLIC_API_BASE_URL}/magic-auth/validate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, formLoadedAt }),
      },
      MAGIC_VALIDATE_TRANSPORT_FAILURE
    );
    const body = guardedJson(text, res.status, MAGIC_VALIDATE_TRANSPORT_FAILURE);
    // One of TWO scoped exceptions to the DECISION Phase 88.6-42 binding constraint (see its
    // 2026-09-29 amendment and its 88.6.1-23 R9 bracket): validateToken throws on any non-OK
    // answer whose code is not `token_invalid` (a 4xx included), and respondViaToken throws on a
    // status of 500 or above and, since plan 88.6.1-87 (P-77), on a parsed 404 carrying the
    // backend token `event_not_found` (AMENDED 2026-10-19, 88.6.1 code review A-80). Here, a coded ApiError means a 400 that is not a dead link, a
    // 429 or a 5xx renders the register's validation / rate_limited / internal line instead of
    // the invalid-link copy. No new `.error` read: the upstream string rides on
    // `extractUpstreamMessage`, the one sanctioned read (errorEnvelopeReads assertion 6).
    //
    // DECISION Phase 88.6.1-23 (R3-M7/M9): CHOSEN — the backend's own code decides. A non-OK
    // answer resolves only when its code is `token_invalid` (the fix text of
    // `.planning/deferred/phase-88.6.1.md:225`).
    // REJECTED (a): the HTTP status alone (the old rule). A future second 400 on the route would
    // render as a dead link.
    // REJECTED (b): status 400 AND the code. It keeps the other drift the register names: a
    // `token_invalid` moved off 400 would render "Something went wrong" for a dead link.
    // REJECTED (c): reading the code off the body directly. `mapErrorToCode` is the module's one
    // code seam, and its value is the code the throw carries.
    // No production behaviour changes today: the route's only 400s are `token_invalid` (BE
    // `routes/magicAuth.js:98`, `:115`). Pair with Phase 93's consumer sweep when it touches
    // `utils/errors.js`.
    // Keying this on the status again is a decision, not a cleanup.
    if (!res.ok) {
      const code = mapErrorToCode(body, res.status);
      if (code !== 'token_invalid') {
        throw new ApiError(
          extractErrorMessage(body, res.status),
          code,
          res.status,
          body,
          extractUpstreamMessage(body)
        );
      }
    }
    return body;
  },
};

/**
 * API functions for Availability Form submission (magic token auth, no Auth0)
 * These use direct fetch without Auth0 token injection
 */
const AVAILABILITY_SUBMIT_TRANSPORT_FAILURE = 'availability response submission did not complete';
const AVAILABILITY_EXISTING_TRANSPORT_FAILURE = 'availability existing-response lookup did not complete';
const GCAL_PREFILL_FAILURE = 'Failed to import from Google Calendar';
const SAVED_PREFILL_FAILURE = 'Failed to use saved availability';

export const availabilityFormAPI = {
  // Submit availability response via magic token.
  //
  // NO res.ok check is added (D62 branch B, owner 2026-09-09): AvailabilityForm.js
  // distinguishes a rejected submit from a successful one SOLELY by reading
  // `response.error` off the parsed body, and that read deliberately SURVIVES this phase.
  // Adding an res.ok throw here is branch A, which the owner rejected.
  // [AMENDED 2026-09-29, plan 88.6-62 task 3 (review round 2 #11): AvailabilityForm.js now
  // decides success by the body's POSITIVE `success: true`, not by `response.error`; its one
  // surviving `.error` read is the coded throw's `upstreamMessage` (Sentry only). The rule
  // above is unchanged: this helper still resolves the parsed body whatever the status — an
  // res.ok throw here would re-code a code-less 400 as `validation` and bypass the form's
  // body-code throw (see the 88.6-58 paragraph of DECISION Phase 88.6-25 in that file).]
  submitResponse: async (data: Record<string, unknown>) => {
    const { res, text } = await timedPublicFetch(
      `${PUBLIC_API_BASE_URL}/availability-responses`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      AVAILABILITY_SUBMIT_TRANSPORT_FAILURE
    );
    return guardedJson(text, res.status, AVAILABILITY_SUBMIT_TRANSPORT_FAILURE);
  },

  // Get existing response for pre-fill (if user returns to edit).
  //
  // The SIXTH apiFetch-bypassing helper (plan 88.6-58, review MEDLOW-2) — see the
  // `DECISION Phase 88.6-42` transport marker, amended to say six. The resolved contract is
  // UNCHANGED: the parsed body on a 2xx, `null` otherwise — a non-2xx AND an unparseable 2xx
  // both mean "nothing to pre-fill" to the one consumer. A TRANSPORT failure (incl. the 20s
  // timeout) REJECTS, and the consumer's own catch treats it as optional pre-fill and proceeds
  // to READY; before this, a stalled GET held the page on "Loading" forever.
  // [AMENDED Phase 88.6.1-23 (R3-M3): a non-2xx now resolves `null` WITHOUT waiting for its
  // body — this is the one caller that passes `timedPublicFetch`'s `skipErrorBody` opt-in in
  // its boolean form, because it discards every non-OK body. Only a transport failure
  // (including the 20 s timeout) still rejects. See DECISION Phase 88.6.1-23 (R3-M3 / D-26) on
  // that helper.]
  getExistingResponse: async (promptId: string, token: string) => {
    const { res, text } = await timedPublicFetch(
      `${PUBLIC_API_BASE_URL}/availability-responses/${encodeURIComponent(promptId)}?magic_token=${encodeURIComponent(token)}`,
      { headers: { 'Content-Type': 'application/json' } },
      AVAILABILITY_EXISTING_TRANSPORT_FAILURE,
      { skipErrorBody: true }
    );
    if (!res.ok) return null;
    try {
      return guardedJson(text, res.status, AVAILABILITY_EXISTING_TRANSPORT_FAILURE);
    } catch {
      return null;
    }
  },

  // Phase 81 Plan 02 (CHKIN-05) — pre-fill the grid from the magic-token user's
  // Google Calendar. Returns { slot_ids: ["ISO datetime", ...], count } for
  // 30-min slots where the user is FREE in the requested week. Magic-token
  // authenticated via body (no Auth0 bearer).
  prefillFromGcal: async ({
    magicToken,
    startDate,
    numDays,
    timezone,
  }: {
    magicToken: string;
    startDate: string;
    numDays: number;
    timezone: string;
  }) => {
    const { res, text } = await timedPublicFetch(
      `${PUBLIC_API_BASE_URL}/availability-prefill/gcal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magic_token: magicToken,
          start_date: startDate,
          num_days: numDays,
          timezone,
        }),
      },
      GCAL_PREFILL_FAILURE
    );
    if (!res.ok) {
      // RETAINED under D62 branch B (owner, 2026-09-09): availabilityPrefill.js emits
      // { error: string } with NO code and NO message at every one of its eight error
      // branches (re-opened at source 2026-09-17: :187, :190, :194, :197, :203-206, :213,
      // :216, :241), so a mechanical conversion to body.code/body.message here produces an
      // EMPTY message. Phase 93 owns the backend code; this read goes when that lands.
      const err = objectBodyOrEmpty(text);
      throw new Error(capErrorText(String(err.error || GCAL_PREFILL_FAILURE)));
    }
    // An unparseable 200 (a proxy or gateway HTML page) now surfaces the SAME failure the
    // error branch above produces, instead of an unhandled SyntaxError. The resolved SHAPE
    // is unchanged — { slot_ids, count } — so AvailabilityForm's destructuring is untouched.
    return guardedJson(text, res.status, GCAL_PREFILL_FAILURE);
  },

  // Phase 81 Plan 03 (CHKIN-06) — pre-fill the grid from the magic-token
  // user's saved availability (recurring patterns + specific overrides,
  // override-beats-recurring). Returns { slot_ids: ["ISO datetime", ...],
  // count }. Backend filters source:'default' so users with zero saved
  // patterns get an empty array, NOT the whole grid (research Pitfall 3).
  prefillFromSaved: async ({
    magicToken,
    startDate,
    numDays,
    timezone,
  }: {
    magicToken: string;
    startDate: string;
    numDays: number;
    timezone: string;
  }) => {
    const { res, text } = await timedPublicFetch(
      `${PUBLIC_API_BASE_URL}/availability-prefill/saved`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magic_token: magicToken,
          start_date: startDate,
          num_days: numDays,
          timezone,
        }),
      },
      SAVED_PREFILL_FAILURE
    );
    if (!res.ok) {
      // RETAINED under D62 branch B — see the twin comment in prefillFromGcal above.
      const err = objectBodyOrEmpty(text);
      throw new Error(capErrorText(String(err.error || SAVED_PREFILL_FAILURE)));
    }
    // Same guard, same reason, same unchanged { slot_ids, count } shape.
    return guardedJson(text, res.status, SAVED_PREFILL_FAILURE);
  },
};

/**
 * API functions for Prompt Settings
 */
export const promptSettingsAPI = {
  // Get prompt settings for a group (includes schedules array)
  getGroupPromptSettings: (group_id: string) =>
    apiFetch(`/groups/${group_id}/prompt-settings`),

  // Create a new schedule
  createSchedule: (group_id: string, scheduleData: Record<string, unknown>) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules`, {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    }),

  // Update an existing schedule
  updateSchedule: (group_id: string, schedule_id: string, scheduleData: Record<string, unknown>) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}`, {
      method: 'PATCH',
      body: JSON.stringify(scheduleData),
    }),

  // Soft delete a schedule
  deleteSchedule: (group_id: string, schedule_id: string) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}`, {
      method: 'DELETE',
    }),

  // Toggle schedule active status (pause/resume)
  toggleSchedule: (group_id: string, schedule_id: string) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}/toggle`, {
      method: 'PATCH',
    }),
};

/**
 * API functions for Availability Prompts (respondent tracking, reminders)
 */
export const promptAPI = {
  // Get respondent list for a prompt
  getRespondents: (promptId: string) =>
    apiFetch(`/prompts/${promptId}/respondents`),

  // Send reminder to non-respondent (admin only)
  sendReminder: (promptId: string, userId: string) =>
    apiFetch(`/prompts/${promptId}/remind/${userId}`, {
      method: 'POST',
    }),

  // Fetch the most recent active/pending prompt for a group
  getActivePrompt: (groupId: string) =>
    apiFetch(`/groups/${groupId}/prompts/active`),

  // Fetch a specific prompt by ID regardless of status (used for closed prompts from email links)
  getPromptById: (promptId: string) =>
    apiFetch(`/prompts/${promptId}`),

  // Phase 71.2 / D-UI-02 — list ALL open prompts for a group (manual + auto)
  // with Creator info, GroupPromptSettings.template_name (for "From [schedule name]"),
  // and a per-requester `can_close` flag derived server-side.
  getOpenPrompts: (groupId: string) =>
    apiFetch(`/groups/${groupId}/prompts/open`),

  // Phase 71.2 / D-CLOSE-05 — soft-close a poll. Backend gates to creator OR
  // group owner/admin; frontend should hide the action when can_close === false.
  closePrompt: (promptId: string) =>
    apiFetch(`/availability-prompts/${promptId}/close`, {
      method: 'PATCH',
    }),

  // Phase 71.2 / Plan 03 hotfix — fetch a heatmap shape derived ONLY from this
  // prompt's submitted responses (not group-wide availability). Used by the
  // createEvent modal when arriving via the close-notification CTA so the
  // visual time picker shows poll results instead of standard availability.
  getPromptHeatmap: (promptId: string) =>
    apiFetch(`/prompts/${promptId}/heatmap`),
};

// DECISION Phase 88.6.1-49 (Req 14, SUGGESTION-CARD-RULING: retire): the frontend client for
// POST /suggestions/:suggestionId/convert is DELETED with its only caller, the retired
// SuggestionCard.js. Chosen OVER keeping an uncalled client beside the still-live backend route.
// The route's removal is Phase 91.1's rider (.planning/deferred/phase-91.1.md, "The suggestion
// → event convert path has no caller"); the close-notification email is the feature that
// replaced the card. Not to be confused with the plural game-suggestions client further down
// this file, which is live. Re-adding a suggestion-to-event client is a product decision, not a
// cleanup.

/**
 * API functions for Group Invites
 */
export const invitesAPI = {
  // Send a group invite by email (typed-email flow)
  sendInvite: (group_id: string, email: string) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, email }),
    }),

  // Send a group invite to an existing friend by user_id. The friend's email is
  // resolved server-side (behind an accepted-friendship gate) — the client never
  // handles friend emails (preserves Phase 83-06 PII default-deny).
  sendFriendInvite: (group_id: string, friend_user_id: string) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, friend_user_id }),
    }),

  // Invite a guest who played in one of the group's events to join the group.
  // `participant_user_id` is a User.id UUID (EventParticipation.user_id). Email is
  // resolved server-side, bound to the group's event participants and gated on the
  // caller being owner/admin (preserves Phase 83-06 PII default-deny). [83.3 SEAM-01]
  sendParticipantInvite: (group_id: string, participant_user_id: string) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, participant_user_id }),
    }),

  // Get current user's pending invites
  getPendingInvites: () =>
    apiFetch('/invites/pending'),

  // Accept a pending invite by invite ID
  acceptInvite: (invite_id: string) =>
    apiFetch(`/invites/${invite_id}/accept`, { method: 'POST' }),

  // Decline a pending invite by invite ID
  declineInvite: (invite_id: string) =>
    apiFetch(`/invites/${invite_id}/decline`, { method: 'POST' }),

  // Accept invite by token (from email link)
  acceptInviteByToken: (token: string) =>
    apiFetch('/invites/accept-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get pending invites for a group (admin view)
  getGroupPendingInvites: (group_id: string) =>
    apiFetch(`/invites/group/${group_id}/pending`),

  // Get invite info by token (public, no auth required) — consumed LOGGED-OUT on
  // invite/accept/page.js, so it MUST bypass the BFF proxy (direct-to-backend).
  getInviteInfo: (token: string) =>
    publicFetch(`/invites/info/${token}`),
};

/**
 * API functions for Friendships (Social Graph)
 */
export const friendshipsAPI = {
  // Get accepted friends for current user
  getFriends: () =>
    apiFetch('/friendships?status=accepted'),

  // Get received pending friend requests
  getReceivedRequests: () =>
    apiFetch('/friendships?status=pending&direction=received'),

  // Get sent pending friend requests
  getSentRequests: () =>
    apiFetch('/friendships?status=pending&direction=sent'),

  // Search for a user by exact email (local DB only, no auto-create)
  searchUserByEmail: (email: string) =>
    apiFetch(`/friendships/search?email=${encodeURIComponent(email)}`),

  // Send a friend request by user_id
  sendRequest: (addressee_user_id: string) =>
    apiFetch('/friendships/request', {
      method: 'POST',
      body: JSON.stringify({ addressee_user_id }),
    }),

  // Accept a pending friend request
  acceptRequest: (friendship_id: string) =>
    apiFetch(`/friendships/${friendship_id}/accept`, { method: 'POST' }),

  // Decline a pending friend request
  declineRequest: (friendship_id: string) =>
    apiFetch(`/friendships/${friendship_id}/decline`, { method: 'POST' }),

  // Remove a friend (unfriend - hard delete)
  removeFriend: (friendship_id: string) =>
    apiFetch(`/friendships/${friendship_id}`, { method: 'DELETE' }),
};

/**
 * API functions for Game Suggestions (smart game recommendations)
 */
interface SuggestionParams {
  playerCount?: string;
  maxPlayTime?: string;
  minWeight?: string;
  maxWeight?: string;
  sort?: string;
}

export const suggestionsAPI = {
  // Get suggestions for a specific event (uses RSVP player count)
  getEventSuggestions: (eventId: string, params: SuggestionParams = {}) => {
    const query = new URLSearchParams();
    if (params.maxPlayTime) query.set('maxPlayTime', params.maxPlayTime);
    if (params.minWeight) query.set('minWeight', params.minWeight);
    if (params.maxWeight) query.set('maxWeight', params.maxWeight);
    if (params.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return apiFetch(`/suggestions/event/${eventId}${qs ? '?' + qs : ''}`);
  },
  // Get suggestions for a group (requires playerCount)
  getGroupSuggestions: (groupId: string, params: SuggestionParams = {}) => {
    const query = new URLSearchParams();
    if (params.playerCount) query.set('playerCount', params.playerCount);
    if (params.maxPlayTime) query.set('maxPlayTime', params.maxPlayTime);
    if (params.minWeight) query.set('minWeight', params.minWeight);
    if (params.maxWeight) query.set('maxWeight', params.maxWeight);
    if (params.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return apiFetch(`/suggestions/group/${groupId}${qs ? '?' + qs : ''}`);
  },
};

/**
 * API functions for Game Voting Ballots
 */
export const ballotAPI = {
  // Get ballot for an event (options, vote state, winner)
  getBallot: (eventId: string) =>
    apiFetch<Ballot>(`/ballot/${eventId}`),

  // Update ballot options (organizer only, before close)
  updateBallotOptions: (eventId: string, options: unknown[]) =>
    apiFetch(`/ballot/${eventId}/options`, {
      method: 'PUT',
      body: JSON.stringify({ options }),
    }),

  // Toggle vote on an option (approval voting: add or remove)
  toggleVote: (eventId: string, optionId: string) =>
    apiFetch(`/ballot/${eventId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    }),

  // Resolve a tie or no-vote scenario (organizer picks winner)
  resolveTie: (eventId: string, optionId: string) =>
    apiFetch(`/ballot/${eventId}/resolve-tie`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    }),
};

