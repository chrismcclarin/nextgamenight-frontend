'use client';

/**
 * StatusRegion — shared aria-live region (PRIM-04 / D-05).
 *
 * Codifies the ad-hoc `aria-live` scattered across the codebase
 * (ThresholdSlider.js:56-57, StarRatingPicker.js:95) into ONE contract:
 *
 *   - EMPTY-FIRST: the live container is always mounted; text is injected on
 *     change. Screen readers announce *changes* to a live region, not the
 *     conditional mount of a new one — so callers keep the region rendered and
 *     just swap `message`/`children`.
 *   - Politeness variants: `polite` (default) → `role="status"` + `aria-live="polite"`;
 *     `assertive` (urgent) → `role="alert"` + `aria-live="assertive"`.
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
}

const StatusRegion = React.forwardRef<HTMLDivElement, StatusRegionProps>(
  ({ message, politeness = 'polite', className, children, ...props }, ref) => {
    const assertive = politeness === 'assertive';
    const content = message ?? children;

    return (
      <div
        ref={ref}
        role={assertive ? 'alert' : 'status'}
        aria-live={assertive ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={cn('text-sm', className)}
        {...props}
      >
        {content}
      </div>
    );
  }
);

StatusRegion.displayName = 'StatusRegion';

export { StatusRegion };
