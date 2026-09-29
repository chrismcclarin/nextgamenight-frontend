/**
 * console -> Sentry logging helper (PRIM-06 / SPEC Req-5).
 *
 * Centralizes the ad-hoc `console.error` + `Sentry.captureException` routing that
 * lives at the fetch boundary (see api.ts). Call sites use `logger.*` instead of
 * raw `console.*` (enforced by the `no-console: error` ESLint rule).
 *
 * Info-Disclosure threat T-84-01: this helper forwards ONLY the caller-supplied
 * `msg`/`ctx` and the error object itself into the Sentry payload — it never
 * spreads raw API response bodies, tokens, or PII into `extra`/`data`. The
 * final-line redaction layer (sentry.scrub.js `beforeSend` + replay scrub,
 * Task 4) normalizes anything that does reach Sentry through this helper or
 * QueryCache.onError before egress.
 *
 * AMENDED 2026-09-28 (plan 88.6-58, review MEDLOW-13): `logger.error`'s `extra` ALSO carries
 * the backend's own error string when the thrown value has a string `upstreamMessage`
 * (`ApiError`'s off-display-path field). That is the same bound AC-4 already relies on for
 * `queryCacheOnError`'s forward: a STRING, never the parsed body, and `extra` is deep-scrubbed
 * by sentry.scrub.js on the way out.
 */
import * as Sentry from '@sentry/nextjs';

export interface Logger {
  /** Route an error to Sentry.captureException. Forwards `err` (or a synthesized
   *  Error(msg) when omitted); `msg` is recorded in `extra.msg`, and a string
   *  `err.upstreamMessage` (ApiError) in `extra.upstreamMessage`. */
  error(msg: string, err?: unknown): void;
  /** Route a warning to Sentry.captureMessage at `warning` level; `ctx` -> extra. */
  warn(msg: string, ctx?: Record<string, unknown>): void;
  /** Record an info breadcrumb via Sentry.addBreadcrumb; `ctx` -> breadcrumb data. */
  info(msg: string, ctx?: Record<string, unknown>): void;
}

export const logger: Logger = {
  error(msg, err) {
    // DECISION Phase 88.6-58 (review MEDLOW-13, AC-4 arm A): the backend's own error string
    // (`ApiError.upstreamMessage`) is forwarded ONCE, here — chosen OVER per-site `extra` at
    // the 15 `logger.error` call sites, and OVER an `instanceof ApiError` check (api.ts
    // imports this module, so importing api.ts back is a cycle). STRING-ONLY structural read:
    // anything else on that key (an object, a parsed body) is NOT forwarded (T-88.6-G30).
    const upstreamMessage =
      typeof (err as { upstreamMessage?: unknown } | null | undefined)?.upstreamMessage === 'string'
        ? (err as { upstreamMessage: string }).upstreamMessage
        : undefined;
    Sentry.captureException(err ?? new Error(msg), {
      extra: upstreamMessage ? { msg, upstreamMessage } : { msg },
    });
  },
  warn(msg, ctx) {
    Sentry.captureMessage(msg, { level: 'warning', extra: ctx });
  },
  info(msg, ctx) {
    Sentry.addBreadcrumb({ message: msg, level: 'info', data: ctx });
  },
};

/**
 * The caught error's NAME and MESSAGE as a plain object, for a `logger.*` call's `ctx`.
 *
 * DECISION Phase 88.6-13 (D8/D11/D16): ONE helper, chosen OVER ~100 hand-written ctx
 * literals at the AC-2 conversion sites in plans 15/17/18/19/21/22/42. Two reasons, and
 * the second is the load-bearing one:
 *
 *  1. Duplication. One implementation instead of a hundred is this project's standing
 *     anti-duplication tenet, and it is the only place the T-84-01 rule below has to hold.
 *  2. IT KEEPS THE `message:` KEY OFF THE CALL SITE. `fetchErrorTreatment.test.ts`'s R1
 *     gate scans line by line and its `USER_FACING_SINK` pattern ends in a bare `message:`
 *     arm — so the most NATURAL spelling of AC-2's mandate,
 *     `logger.info('…', { name: err.name, message: err.message })`, matches the sink
 *     pattern AND the raw-message pattern on one line and DEFEATS the developer-log
 *     exemption. A correct conversion would red a gate it never touched. Nothing in the FE
 *     enforces a print width and the house `logger.*(msg, ctx)` idiom is routinely written
 *     over four lines (`GroupSettings.js:332-335`, `:389-393`) including inside a
 *     conversion target (`gameDetail/page.js:685-688`), so a call site that spells the key
 *     itself is gate-safe only by formatting accident.
 *
 * REJECTED, by name, so neither is re-proposed as a fix when the gate reds:
 *  - a `CONTROL_FLOW_ALLOWED` entry for a converted log line — those are not control-flow
 *    reads, and that list is reserved for genuine control flow with a stated reason;
 *  - dropping the error's message from the ctx — that guts the diagnostic payload the
 *    conversion exists to preserve.
 *
 * T-84-01: NAME AND MESSAGE ONLY. Never a response body, a token, a URL or any other field
 * off the error — `ApiError` carries more than this and the extra is exactly what must not
 * egress. Widening the returned shape is a decision, not a cleanup.
 *
 * `logger`'s three members above are byte-unchanged by the plan that added this.
 */
export function errCtx(err: unknown): { name: string; message: string } {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof e?.name === 'string' ? e.name : typeof err;
  // This raw read is the SANCTIONED one — the designed destination for the error text is
  // the developer log, and this value never reaches a user-facing sink. It is carried as a
  // named entry in `fetchErrorTreatment.test.ts`'s allow-list rather than hidden by naming
  // the local something the R1 scanner does not match.
  const message = typeof e?.message === 'string' ? e.message : String(err);
  return { name, message };
}
