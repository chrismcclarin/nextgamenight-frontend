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

/* DECISION Phase 88-09 (D-20): this file stays DELIBERATELY inline-styled and deliberately
   OFF the shared error-look primitive in `src/components/ui/` — the one the eleven route
   `error.tsx` files added in 88-09 all render. Routing this file through it too is the
   REJECTED alternative, and it is exactly the "one error look, converge everything" cleanup a
   later reader will reach for, because every other boundary in the app now renders that
   primitive. (The identifier is spelled out nowhere below on purpose: this file must never
   import it, and 88-09's own gate asserts that by name-grepping the whole file.)

   WHY THE CONVERGENCE LOSES: `global-error.tsx` REPLACES `<html>`/`<body>`, so it is the one
   boundary that renders with no guarantee that the app's stylesheet, theme variables or fonts
   ever loaded — a throw inside the root layout is precisely the case where they did not. The
   shared primitive is built entirely on Tailwind utilities and semantic tokens
   (`bg-surface-page`, `border-line-strong`, `text-content-primary`), so importing it here would
   trade a plain-but-readable last-resort screen for an unstyled one at the exact moment the app
   is already broken. Inline styles are the point, not an oversight.

   CONSEQUENCE FOR REQ 2's RAW-HEX GREP GATE: the 6 raw hex values below (`#555`, `#111` x2,
   `#fff` x2, `#ccc`) are a PERMANENT, justified exemption from that gate, on the same
   scoped-rationale footing as D-27's `lib/colorUtils.js` entry — never a bare allowlist line.
   They cannot be tokenized for the reason above: a CSS custom property resolves to nothing if
   the stylesheet that declares it never loaded, which would leave this screen with no colours
   at all. The gate added in plan 88-29 MUST name `src/app/global-error.tsx` in its exemption
   list and carry this rationale with it. If a future pass "fixes" these hexes, it has broken
   the last-resort net without any test noticing — that is a decision, not a cleanup. */

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
