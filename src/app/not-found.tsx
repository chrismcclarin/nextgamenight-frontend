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

   HEADING LEVEL — gap CLOSED by 88-18 (DEF-88-09-01), keep it that way. `EmptyState`'s heading
   was a hardcoded `<h3>`, leaving this page as the app's only page with no `<h1>`. 88-18 added
   the optional `headingLevel` prop (default `h3`, so no other adopter moved) and this page
   passes `h1`. The standing warning still holds and is the reason the fix took that shape: do
   NOT "fix" a missing `<h1>` here by bolting a second heading onto the page — that trades a
   missing `<h1>` for a skipped heading level (`h1` -> `h3`), which is worse. `headingLevel="h1"`
   below is load-bearing, not decoration; `not-found.test.tsx` pins it. */

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-surface-page px-4 py-12">
      <div className="w-full max-w-md rounded-card border border-line-strong bg-surface-card p-8 shadow-lg">
        <EmptyState
          icon="Compass"
          heading="This page took a wrong turn"
          headingLevel="h1"
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
