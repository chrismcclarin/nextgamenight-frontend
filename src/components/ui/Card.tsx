'use client';

/**
 * Card — presentational surface container (PRIM-04 / D-03).
 *
 * The shared elevated surface for grouped content, in the `cn()` + `forwardRef`
 * + `displayName` idiom. Semantic tokens only (`surface-card`, `content-primary`,
 * `line`, `rounded-card`) so Phase 88 re-themes without API changes. Adopted
 * downstream (Plan 07) by the invite/availability surfaces.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-card border border-line bg-surface-card text-content-primary shadow-theme-sm',
        className
      )}
      {...props}
    />
  )
);

Card.displayName = 'Card';

export { Card };
