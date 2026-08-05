'use client';

/**
 * EmptyState — the one "nothing here yet" surface (Req 6 / D-15..D-18, UI-SPEC §9.1).
 *
 * A lucide line glyph at ~56px inside a 96px accent-tinted circle, a warm 20px/700
 * heading, one 16px body line carrying the next step, and at most one caller-owned
 * CTA. Six shipped hand-rolled empty surfaces adopt it in later Phase-88 plans.
 *
 * The heading ELEMENT is `h3` by default and overridable via `headingLevel`
 * (88-18 / DEF-88-09-01) — its 20px/700 type role never changes with it.
 *
 * The `illustration` slot (D-17) is the whole point of the shape: real artwork
 * drops into the SAME position later and the layout does not move. `Icon.tsx`'s
 * `render` escape hatch is the documented seam for a bespoke inline SVG (D-18)
 * and stays deliberately unused this phase.
 *
 * What it deliberately does NOT do:
 * - **No error copy.** `EmptyState` is "nothing here yet"; a failed load is
 *   `FetchErrorBanner`/`FetchErrorState`. UI-SPEC §9.2 forbids conflating them —
 *   that conflation is a shipped walkthrough finding, not a hypothetical.
 * - **No CTA gating.** `action` is a ReactNode so the call site keeps its own
 *   permission shape (e.g. GroupGamesList's `userRole && userRole !== 'pending'`).
 * - **No horizontal padding.** It renders INSIDE a card at depth 3; adding `px-*`
 *   here would eat the phone padding budget (87.8 nesting ladder).
 * - **No `title` on the Icon**, so the glyph is `aria-hidden` by the shipped Icon
 *   contract (Icon.tsx:70-72). The heading carries the meaning.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Per-surface lucide glyph (D-16) — the visual signals WHICH thing is empty. */
  icon: IconName;
  /** Warm, specific headline. Rendered at the 20px/700 Heading role. */
  heading: string;
  /**
   * Heading ELEMENT for the headline (DEF-88-09-01). Defaults to `h3` — the
   * designed context is "inside a card at depth 3", so every in-page adopter
   * stays exactly where it was. Pass `h1` ONLY where `EmptyState` IS the page
   * and nothing else supplies the document heading (`not-found.tsx`).
   *
   * The 20px/700 type role is FIXED and does not follow the element — the level
   * is a document-outline fact, not a size.
   */
  headingLevel?: 'h1' | 'h2' | 'h3';
  /** One line carrying the next step. */
  body: string;
  /** Optional single primary CTA — caller-owned so gating stays at the call site. */
  action?: React.ReactNode;
  /**
   * D-17's illustration slot. When present it REPLACES the icon circle at the
   * same position (same box, same spacing), so future artwork needs no layout
   * change here or at any adopting call site.
   */
  illustration?: React.ReactNode;
}

/* DECISION Phase 88-04 (D-17): `illustration` REPLACES the circle in the same slot element,
   rather than rendering as a second variant branch with its own wrapper or being appended
   alongside the glyph. Chosen OVER the obvious "render both, hide one" — which is what a reader
   is most likely to refactor this into — because a hidden-but-mounted lucide glyph would still
   be in the a11y tree on some AT, and because keeping ONE slot element is what guarantees the
   drop-in promise: the artwork inherits the exact position and spacing the glyph had. Changing
   this to two branches is a decision, not a cleanup. */

/* DECISION Phase 88-18 (DEF-88-09-01): the heading LEVEL is a prop while the heading's
   20px/700 type role stays hardcoded — chosen OVER the obvious "add a `size` variant alongside
   it", which is what a reader adding a second surface will reach for. Level and size are
   different facts: the level answers "where does this sit in the document outline" (a page-level
   `EmptyState` needs `h1`, an in-card one needs `h3`), the size answers "how loud is it" (§9.1
   fixes that at one value for every adopter). Coupling them would let a caller silently demote
   the 404's type by asking for the right outline. Default stays `h3` so no shipped call site
   moves. Splitting size back out of this prop is a decision, not a cleanup. */

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
      icon,
      heading,
      headingLevel: HeadingTag = 'h3',
      body,
      action,
      illustration,
      className,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn('flex flex-col items-center py-8 text-center', className)}
      {...props}
    >
      <div
        data-slot="empty-state-media"
        className={cn(
          'flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden',
          // The circle + accent glyph are the ICON path only; artwork brings its own shape.
          !illustration && 'rounded-full bg-surface-accent-subtle text-accent'
        )}
      >
        {illustration ?? <Icon name={icon} size={56} strokeWidth={1.5} />}
      </div>

      <HeadingTag className="mt-4 text-xl font-bold leading-tight text-content-primary">
        {heading}
      </HeadingTag>

      <p className="mt-2 max-w-[60ch] text-base text-content-secondary">
        {body}
      </p>

      {action && (
        <div data-slot="empty-state-action" className="mt-6">
          {action}
        </div>
      )}
    </div>
  )
);

EmptyState.displayName = 'EmptyState';

export { EmptyState };
