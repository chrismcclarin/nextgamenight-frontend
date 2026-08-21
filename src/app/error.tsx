'use client';

/**
 * Root route error boundary (Req 3 / D-20, plan 88-09).
 *
 * `'use client'` is a Next.js REQUIREMENT for `error.tsx`, not a style choice —
 * without it the build fails, so do not "tidy" it away.
 *
 * SECURITY (T-88-09-01 / ASVS V7): this boundary renders designed copy ONLY.
 * The thrown value's message, digest and stack must never reach the DOM — the
 * detail goes to Sentry here (where `sentry.scrub.js` already filters it).
 * Surfacing that detail to the user is a security regression, not a debugging
 * convenience.
 *
 * The look itself lives in `ErrorFallback` so all eleven boundaries fail into
 * the same designed screen instead of eleven hand-rolled variants.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { ErrorFallback } from '@/components/ui/ErrorFallback';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorFallback onRetry={reset} onReload={() => window.location.reload()} />
  );
}
