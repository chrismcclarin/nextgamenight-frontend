import * as React from 'react';

import { cn } from '@/lib/cn';

// DECISION Phase 88.9-66 (X64, X70a, X70b; owner 2026-11-14): ONE frame for a page-replacing banner, the group page's centred column at the UI-SPEC phone gutter (16px, 24px from md), chosen OVER the group page's 24px at 375 and OVER per-page wrappers (they drifted: none on planning, top-aligned on Profile).

/**
 * The frame a page uses when ONE banner replaces its whole body (the signed-out return, the
 * session-expired return, a group that could not load). The outer box is a full-height column
 * that centres its child both ways and keeps the page gutter; the inner box caps the banner's
 * width. `ref`, `className` and every other prop go to the INNER box, so a page that moves focus
 * to its frame (`tabIndex={-1}` plus a ref) lands on the box whose first text is the banner title.
 */
export type CentredPageFrameProps = React.HTMLAttributes<HTMLDivElement>;

const CentredPageFrame = React.forwardRef<HTMLDivElement, CentredPageFrameProps>(
  ({ className, children, ...props }, ref) => (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 md:p-6">
      <div ref={ref} data-slot="page-frame" className={cn('w-full max-w-xl', className)} {...props}>
        {children}
      </div>
    </div>
  )
);

CentredPageFrame.displayName = 'CentredPageFrame';

export { CentredPageFrame };
