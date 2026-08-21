'use client';

/**
 * Route error boundary for the magic-link RSVP flow (Req 3 / D-20, plan 88-09).
 *
 * `'use client'` is a Next.js REQUIREMENT for `error.tsx` — the build fails
 * without it. Renders designed copy ONLY (T-88-09-01 / ASVS V7): the thrown
 * value's message, digest and stack go to Sentry, never to the DOM. This route
 * is reached from an SMS/email link by unauthenticated recipients, so a raw
 * dump here would be shown to the least-trusted audience the app has.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { ErrorFallback } from '@/components/ui/ErrorFallback';

export default function RsvpError({
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
