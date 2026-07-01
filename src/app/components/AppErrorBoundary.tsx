'use client';

/**
 * GUARD-01 (Plan 86-08, D-07): in-`<body>` app error boundary.
 *
 * Wraps the provider stack with the already-installed `Sentry.ErrorBoundary`
 * (`@sentry/nextjs`). Because it sits INSIDE `<body>` (below the shell/theme/
 * fonts), a render-time throw in a provider renders a STYLED fallback rather
 * than a white screen, and auto-reports the error to Sentry (built-in).
 *
 * layout.js must remain a server component (it exports `metadata` and uses
 * `next/font`), and the fallback needs event handlers — so the boundary +
 * fallback are extracted here as a `'use client'` island (analog: providers.tsx).
 *
 * Reset-loop guard (D-07): "Try again" re-mounts the subtree via `resetError`.
 * If the same error keeps re-throwing, `resetAttempts` (held ABOVE the boundary,
 * so it survives resets) trips after MAX_RESET_ATTEMPTS and we hide "Try again",
 * leaving only the "Reload page" escape hatch — no infinite re-throw loop.
 */

import * as Sentry from '@sentry/nextjs';
import { useState } from 'react';

const MAX_RESET_ATTEMPTS = 2;

export default function AppErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const [resetAttempts, setResetAttempts] = useState(0);
  const loopGuardTripped = resetAttempts >= MAX_RESET_ATTEMPTS;

  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div
          role="alert"
          aria-live="assertive"
          className="flex min-h-screen items-center justify-center bg-surface-page px-4"
        >
          <div className="w-full max-w-md rounded-card border border-strong bg-surface-card p-8 text-center shadow-lg">
            <h1 className="text-xl font-semibold text-content-primary">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-content-secondary">
              An unexpected error interrupted the page.{' '}
              {loopGuardTripped
                ? 'The problem is still happening — please reload the page.'
                : 'You can try again, or reload the page.'}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              {!loopGuardTripped && (
                <button
                  type="button"
                  onClick={() => {
                    setResetAttempts((n) => n + 1);
                    resetError();
                  }}
                  className="inline-flex items-center justify-center rounded-btn bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center rounded-btn border border-strong bg-surface-card px-5 py-2.5 text-sm font-medium text-content-primary transition-colors hover:bg-surface-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
