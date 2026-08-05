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
 *
 * The fallback's LOOK now lives in `@/components/ui/ErrorFallback` (Phase 88 D-20)
 * so the route `error.tsx` boundaries render the same screen. Only the look moved:
 * this file still owns the Sentry boundary, MAX_RESET_ATTEMPTS and the
 * `resetAttempts` counter, which must stay above the boundary to survive a reset.
 */

import * as Sentry from '@sentry/nextjs';
import { useState } from 'react';

import { ErrorFallback } from '@/components/ui/ErrorFallback';

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
        <ErrorFallback
          loopGuardTripped={loopGuardTripped}
          onRetry={() => {
            setResetAttempts((n) => n + 1);
            resetError();
          }}
        />
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
