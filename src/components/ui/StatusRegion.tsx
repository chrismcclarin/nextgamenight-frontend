'use client';

/**
 * StatusRegion — shared aria-live region (PRIM-04 / D-05).
 *
 * Codifies the ad-hoc `aria-live` scattered across the codebase (src/app/components/StarRatingPicker.js ("text-content-muted tabular-nums"); ThresholdSlider.js,
 * deleted as dead code in Phase 88.6.1-82 — AMENDED Phase 88.6.1-82) into ONE contract:
 *
 *   - EMPTY-FIRST: the live container is always mounted; text is injected on
 *     change. For polite / status regions, screen readers announce *changes* to
 *     a live region, not the conditional mount of a new one — so callers keep the
 *     region rendered and just swap `message`/`children`. An inserted
 *     `role="alert"` that arrives with its text IS announced (ARIA 1.2 `alert`;
 *     TetraLogical 2024 matrix incl. VoiceOver iOS; corrected Phase 88.6.1 per
 *     D-42). The assertive variant still mounts empty-first for two other
 *     reasons: node identity is assertable, and a clear-then-set makes an
 *     identical repeat re-announce.
 *   - Politeness variants: `polite` (default) → `role="status"` + `aria-live="polite"`;
 *     `assertive` (urgent) → `role="alert"` + `aria-live="assertive"`.
 *   - Opt-in `srOnlyWhenEmpty` (D-22): visually hidden only while there is nothing
 *     to say; see the DECISION marker on the prop.
 *
 * Presentational + color-neutral: consumers (e.g. Banner) own the visual tone.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

export type StatusPoliteness = 'polite' | 'assertive';

export interface StatusRegionProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Text/content to announce. Omit (or empty) to keep the region mounted-but-empty. */
  message?: React.ReactNode;
  /** `polite` (role=status, default) or `assertive` (role=alert). */
  politeness?: StatusPoliteness;
  // DECISION Phase 88.6.1-06 (D-22): ONE house shape for an empty status region.
  // CHOSEN: opt-in (default off); emptiness decided from the rendered content VALUE
  // (isEmptyRegionContent below); `sr-only` appended as the LAST class so tailwind-merge
  // keeps it. REJECTED: per-site class ternaries (the duplication D-22 retires);
  // `display:none` / `empty:hidden` (the node leaves the accessibility tree, and a
  // populated polite region shown again is not announced, AT-5); a `contents` wrapper
  // (WebKit registers no live region for a node without a renderer, AT-4); default-on
  // (it would change the 22 non-adopting instantiations); emptiness from children
  // truthiness (a keyed empty span is truthy). LIMIT: the prop does not remove the
  // previous sibling's margin-block-end when the region is the last child of a space-y
  // stack (Tailwind 4.3.3 targets `:where(& > :not(:last-child))`); such a site moves the
  // region out of the stack (NextGameNightCard, 88.6.1-06) or records an accepted cost.
  // CAVEAT for adopters: `sr-only` is position:absolute with no offsets, so an empty
  // region sits at its static position and its containing block is the nearest
  // POSITIONED ancestor, not the nearest scroller. An adopter inside an unpositioned
  // overflow container must confirm that its containing block clips the 1px region, or
  // position the scroller; otherwise the region's static position can extend the page's
  // scrollable overflow. ParticipantRow's hint meets this: its containing block is the
  // dialog's fixed, overflow-hidden content. Changing any of this is a decision, not a
  // cleanup.
  /**
   * Opt-in (default `false`). While the region has nothing to say — its rendered
   * content is null, undefined, a boolean or `''` — it is visually hidden with
   * `sr-only`, so its own margin costs no layout. Whenever it holds content it is
   * visible. The node, its `role` and its live attributes never change between
   * the two states.
   */
  srOnlyWhenEmpty?: boolean;
}

/**
 * True only for content that renders nothing: null, undefined, a boolean, or `''`.
 * Everything else counts as content (fail-visible): any string with a character
 * (whitespace included), any number (0 included), elements and arrays.
 */
function isEmptyRegionContent(content: React.ReactNode): boolean {
  return (
    content === null ||
    content === undefined ||
    typeof content === 'boolean' ||
    content === ''
  );
}

const StatusRegion = React.forwardRef<HTMLDivElement, StatusRegionProps>(
  (
    {
      message,
      politeness = 'polite',
      srOnlyWhenEmpty = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const assertive = politeness === 'assertive';
    const content = message ?? children;

    return (
      <div
        ref={ref}
        role={assertive ? 'alert' : 'status'}
        aria-live={assertive ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={cn(
          'text-sm',
          className,
          srOnlyWhenEmpty && isEmptyRegionContent(content) && 'sr-only'
        )}
        {...props}
      >
        {content}
      </div>
    );
  }
);

StatusRegion.displayName = 'StatusRegion';

export { StatusRegion };

/**
 * How long a polite region stays EMPTY before it may take text — moved here from
 * `FetchErrorBanner.tsx` (plan 88.6.1-21's constant) by plan 88.6.1-82, so the live-region
 * primitive owns the one declaration and every consumer imports it. AT-4
 * (planning:.planning/phases/88.6.1-non-look-a11y-and-correctness-residuals-from-88-6/research/APPENDIX-AT.md ("**The same message twice.**"), failure condition 4, "The same message twice"): WebKit's
 * live-region manager re-announces text identical to the last announcement only after the region
 * has stayed empty for `emptyRegionSettleDelay { 100_ms }` (planning:.planning/phases/88.6.1-non-look-a11y-and-correctness-residuals-from-88-6/research/APPENDIX-AT.md ("the clear must also stay empty for at least 100ms")),
 * and a synchronous clear-then-set is dropped. The value is the engine's constant, not a guess.
 * It is also the house's minimum empty time before a region mounted on page arrival takes its
 * first text (plan 88.6.1-82, the removed-from-group notice). It sits LAST in this file so the
 * line cites into the component above stay valid.
 */
export const REGION_EMPTY_DWELL_MS = 100;
