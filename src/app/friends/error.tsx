'use client';

/**
 * Route error boundary for `/friends` (Req 3 / D-20, plan 88-09).
 *
 * `'use client'` is a Next.js REQUIREMENT for `error.tsx` — the build fails
 * without it. Renders designed copy ONLY (T-88-09-01 / ASVS V7): the thrown
 * value's message, digest and stack go to Sentry, never to the DOM.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { ErrorFallback } from '@/components/ui/ErrorFallback';

export default function FriendsError({
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
