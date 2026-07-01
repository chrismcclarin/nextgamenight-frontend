'use client';

/**
 * GUARD-01 (Plan 86-08, D-07): last-resort error net.
 *
 * Next.js `global-error.tsx` is the ONLY boundary that catches throws from the
 * root layout itself. It REPLACES `<html>`/`<body>`, so it renders bare (no
 * shell/theme/fonts) and only runs in production — that is why the in-`<body>`
 * `Sentry.ErrorBoundary` (AppErrorBoundary) is the primary, styled UX and this
 * file is intentionally minimal. It still reports the error to Sentry.
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '1rem',
          margin: 0,
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: '0.5rem', color: '#555' }}>
            An unexpected error occurred. Please try again or reload the page.
          </p>
          <div
            style={{
              marginTop: '1.5rem',
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                background: '#111',
                color: '#fff',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #ccc',
                background: '#fff',
                color: '#111',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
