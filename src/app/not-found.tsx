/**
 * Designed 404 (Req 3 / D-20, plan 88-09).
 *
 * Before this file the app had no `not-found.tsx` at all, so a wrong URL landed
 * on Next.js's unstyled default — a white page with no shell, no theme and no
 * way back. This is a server component; nothing here needs `'use client'`.
 */
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/* DECISION Phase 88-09 (D-20): the 404 composes `EmptyState` inside the SAME page frame
   `ErrorFallback` uses, chosen OVER authoring a bespoke 404 look — which is the obvious move
   and the thing a future reader will reach for when this page feels "too plain for a 404".
   D-20's contract is one error look plus one documented exception (`global-error.tsx`), and a
   missing page is a "nothing here" surface, not a failure: UI-SPEC 9.2 forbids conflating the
   two, which is why this renders `EmptyState` rather than `ErrorFallback`. Giving the 404 its
   own artwork is a decision for the illustration slot (D-17), not a cleanup for this file.

   KNOWN GAP, deliberately left rather than silently patched: `EmptyState` renders its heading
   as an `<h3>` (fixed in 88-04), so this page's only heading is an `<h3>` — it has no `<h1>`,
   unlike every shipped page and unlike `ErrorFallback`. Raising it means adding a heading-level
   prop to the shared primitive, which is outside this plan's declared files; recorded in
   `deferred-items.md` for the Req 5 a11y plan. Do not "fix" it by bolting a second heading on
   this page — that trades a missing `<h1>` for a skipped heading level. */

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-surface-page px-4 py-12">
      <div className="w-full max-w-md rounded-card border border-line-strong bg-surface-card p-8 shadow-lg">
        <EmptyState
          icon="Compass"
          heading="This page took a wrong turn"
          body="The link may be old, or the page may have moved. Head back to your groups and pick up where you left off."
          action={
            <Button asChild variant="primary">
              <Link href="/">Back to your groups</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
