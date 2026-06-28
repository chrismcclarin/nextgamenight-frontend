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
 */
import * as Sentry from '@sentry/nextjs';

export interface Logger {
  /** Route an error to Sentry.captureException. Forwards `err` (or a synthesized
   *  Error(msg) when omitted); `msg` is recorded in `extra.msg`. */
  error(msg: string, err?: unknown): void;
  /** Route a warning to Sentry.captureMessage at `warning` level; `ctx` -> extra. */
  warn(msg: string, ctx?: Record<string, unknown>): void;
  /** Record an info breadcrumb via Sentry.addBreadcrumb; `ctx` -> breadcrumb data. */
  info(msg: string, ctx?: Record<string, unknown>): void;
}

export const logger: Logger = {
  error(msg, err) {
    Sentry.captureException(err ?? new Error(msg), { extra: { msg } });
  },
  warn(msg, ctx) {
    Sentry.captureMessage(msg, { level: 'warning', extra: ctx });
  },
  info(msg, ctx) {
    Sentry.addBreadcrumb({ message: msg, level: 'info', data: ctx });
  },
};
