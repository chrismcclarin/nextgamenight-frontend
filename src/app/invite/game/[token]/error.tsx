'use client';

/**
 * Route error boundary for the game-night invite landing (Req 3 / D-20,
 * plan 88-09).
 *
 * `'use client'` is a Next.js REQUIREMENT for `error.tsx` — the build fails
 * without it. Renders designed copy ONLY (T-88-09-01 / ASVS V7): the thrown
 * value's message, digest and stack go to Sentry, never to the DOM. This route
 * is reached from a shared link or a scanned QR code, so the audience is
 * untrusted by construction.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { ErrorFallback } from '@/components/ui/ErrorFallback';

export default function InviteGameError({
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
