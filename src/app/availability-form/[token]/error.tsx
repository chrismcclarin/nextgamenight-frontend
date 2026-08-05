'use client';

/**
 * Route error boundary for the magic-link availability form (Req 3 / D-20,
 * plan 88-09).
 *
 * `'use client'` is a Next.js REQUIREMENT for `error.tsx` — the build fails
 * without it. Renders designed copy ONLY (T-88-09-01 / ASVS V7): the thrown
 * value's message, digest and stack go to Sentry, never to the DOM. That
 * matters twice over here — this route is reached from an SMS/email link by
 * people who may not have an account, so a raw dump would be shown to the
 * least-trusted audience the app has.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { ErrorFallback } from '@/components/ui/ErrorFallback';

export default function AvailabilityFormError({
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
