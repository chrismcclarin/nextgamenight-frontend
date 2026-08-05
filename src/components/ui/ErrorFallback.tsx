'use client';

/**
 * ErrorFallback — the ONE error look (Req 3 / D-20).
 *
 * Extracted verbatim from `AppErrorBoundary`'s shipped fallback JSX so the 8 route
 * `error.tsx` files plus the root boundary render the same, already-designed screen
 * (plan 88-09) instead of nine hand-rolled variants.
 *
 * SECURITY (T-88-04-01 / ASVS V7): this component renders **designed copy only**. It
 * takes no `error`, and it must never be given one — no `error.message`, no
 * `error.digest`, no stack trace and no backend message may reach the DOM here. A
 * thrown error's detail goes to Sentry at the boundary (`global-error.tsx` and
 * `AppErrorBoundary` already model that), never to the user.
 *
 * What it deliberately does NOT do:
 * - **It does not own the reset-loop counter.** `AppErrorBoundary` holds
 *   `resetAttempts` ABOVE the boundary on purpose, so the count survives a reset;
 *   the primitive only receives the already-computed `loopGuardTripped`.
 * - **It does not use the `Button` primitive.** See the DECISION marker below.
 * - **It does not replace `global-error.tsx`.** That boundary replaces
 *   `<html>`/`<body>` and renders with no shell, theme or fonts, so it stays
 *   deliberately inline-styled.
 */
import * as React from 'react';

export interface ErrorFallbackProps {
  /** Retry handler (a boundary's `reset`/`resetError`). Omit to render no retry. */
  onRetry?: () => void;
  /** Reload handler. Defaults to a full page reload. */
  onReload?: () => void;
  /** Caller-computed: the same error keeps re-throwing, so hide retry. */
  loopGuardTripped?: boolean;
  /** Designed heading. NEVER an error message. */
  title?: string;
  /** Designed body. NEVER an error message, digest or stack. */
  body?: React.ReactNode;
}

/* DECISION Phase 88-04 (D-20): the two affordances stay as raw <button>s carrying the SHIPPED
   utility classes, chosen OVER swapping them for the new `Button` primitive (88-02) — which is
   exactly the "consistency cleanup" a later reader will reach for. D-20's contract is "one error
   look, already designed and shipped": this JSX is what production renders today, and 88-09 fans
   it out to 9 boundaries. Converting to `Button` here would fold in `.btn`'s geometry, the phone
   44px floor and a different ring token in the same change that is supposed to be a pure
   extraction, making any visual regression across those 9 surfaces unattributable. Converging
   onto `Button` is a decision for an adoption plan, not a cleanup for this file.

   ONE thing WAS changed during the extraction, deliberately: both `border-strong` classes became
   `border-line-strong`. There is no `--color-strong` token (the bridge
   declares `--color-line-strong`), so `border-strong` emitted nothing and the borders were being
   painted by the base-layer shim, which is not theme-aware — a near-white hairline in dark mode.
   Fixing it at extraction is what stops the defect shipping x8. */

const ErrorFallback = React.forwardRef<HTMLDivElement, ErrorFallbackProps>(
  (
    {
      onRetry,
      onReload,
      loopGuardTripped = false,
      title = 'Something went wrong',
      body,
    },
    ref
  ) => {
    const showRetry = Boolean(onRetry) && !loopGuardTripped;
    const handleReload = onReload ?? (() => window.location.reload());

    return (
      <div
        ref={ref}
        role="alert"
        aria-live="assertive"
        className="flex min-h-screen items-center justify-center bg-surface-page px-4"
      >
        <div className="w-full max-w-md rounded-card border border-line-strong bg-surface-card p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-content-primary">{title}</h1>
          <p className="mt-2 text-sm text-content-secondary">
            {body ?? (
              <>
                An unexpected error interrupted the page.{' '}
                {loopGuardTripped
                  ? 'The problem is still happening — please reload the page.'
                  : 'You can try again, or reload the page.'}
              </>
            )}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {showRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center rounded-btn bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={handleReload}
              className="inline-flex items-center justify-center rounded-btn border border-line-strong bg-surface-card px-5 py-2.5 text-sm font-medium text-content-primary transition-colors hover:bg-surface-card-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
);

ErrorFallback.displayName = 'ErrorFallback';

export { ErrorFallback };
