'use client';

/**
 * RouteFallback — the ONE route-level loading look (Req 3 / D-19, UI-SPEC §8.8).
 *
 * Centred on the `bg-surface-page` ground, an accent spinner arc, and one 16px
 * secondary line naming what is loading. The 9 route `loading.tsx` files re-export
 * this in plan 88-09 instead of hand-rolling nine spinners (the shipped idiom it
 * codifies: `availability-form/[token]/page.js:163-167`).
 *
 * Announced, not silent (AR R1-M18): the root is a `role="status"` live region with
 * an explicit `aria-label`. The label is spelled out rather than inferred from the
 * text because `status` takes its name from the author, not from content — without
 * it a screen-reader user gets a nameless region while the route loads.
 *
 * What it deliberately does NOT do:
 * - **No per-route skeleton content (D-21).** `loading.tsx` unmounts as soon as the
 *   server segment resolves, which is BEFORE client data lands, so a detailed
 *   skeleton here is largely wasted and would collide with Phase 89's skeleton-guard
 *   work. Phase 89 owns skeletons; do not add block placeholders to this file.
 * - **No reduced-motion kill-switch on the spinner.** See the DECISION marker below.
 * - **No horizontal padding of its own** beyond the centring box — it is a route
 *   surface, and its callers own page padding.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

export interface RouteFallbackProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** What is loading, in the user's words — e.g. "Getting your groups...". */
  label: string;
}

/* DECISION Phase 88-04 (D-19 / UI-SPEC §7.1): the spinner carries NO reduced-motion
   animation kill-switch (the `motion-reduce` variant), deliberately — and this is the exact line a future
   reduced-motion pass will try to "fix", because every decorative animation in this
   phase DOES get stopped. Rejected here because the spinner is a FUNCTIONAL status
   indicator, not decoration: a frozen spinner reads as a hung app, which is a worse
   outcome for the same user. If reduced motion must be honoured, SLOW it (a longer
   duration), never stop it. Stopping it is a decision, not a cleanup. */

const RouteFallback = React.forwardRef<HTMLDivElement, RouteFallbackProps>(
  ({ label, className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-label={label}
      className={cn(
        'flex min-h-[60vh] flex-col items-center justify-center bg-surface-page text-center',
        className
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="h-12 w-12 animate-spin rounded-full border-b-2 border-accent"
      />
      <p className="mt-4 text-base text-content-secondary">{label}</p>
    </div>
  )
);

RouteFallback.displayName = 'RouteFallback';

export { RouteFallback };
