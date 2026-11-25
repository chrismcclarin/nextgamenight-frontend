import * as React from 'react';

import { cn } from '@/lib/cn';

import { Heading } from './Heading';

// DECISION Phase 88.9-66 (X64, X70a, X70b; owner 2026-11-14): ONE frame for a page-replacing banner, the group page's centred column at the UI-SPEC phone gutter (16px, 24px from md), chosen OVER the group page's 24px at 375 and OVER per-page wrappers (they drifted: none on planning, top-aligned on Profile).
// AMENDED Phase 89.6-23 (frame): the banner is centred in the space between the header and the footer, not in a screen-tall box below the header. The owner's X06 'Fine' (2026-11-22) was on the old centring; he then picked this change from a rendered comparison, owner pick DT-3 = Move, 2026-11-23: 'Dt-3 : move it so it doesn't scroll at normal text. Change is approved.' Measured on Friends signed out at 375 by 667: the banner rises 96.5px and the page stops scrolling (860 to 667); at 320 with doubled text nothing changes.
// DECISION Phase 89.6-23 (frame): the frame fills what main leaves between the header and the footer (flex-1, with main a column only when the frame is its direct child), chosen OVER min-h-screen (a full screen tall starting under the 64px header: the banner sat low and a one-banner page scrolled by the header plus the footer, 193px at 375 by 667, register FL-07; owner pick DT-3 = Move, 2026-11-23) and OVER making every main a column (a child with a max width and auto side margins would shrink to its content on every page). The column rule is src/app/globals.css ("FL-07 (89.6-23): main is a column only when the banner frame"). Changing this is a decision, not a cleanup.

/**
 * The frame a page uses when ONE banner replaces its whole body (the signed-out return, the
 * session-expired return, a group that could not load). The outer box is a full-height column
 * that centres its child both ways and keeps the page gutter; the inner box caps the banner's
 * width. `ref`, `className` and every other prop go to the INNER box, so a page that moves focus
 * to its frame (`tabIndex={-1}` plus a ref) lands on the box whose first text is the banner title.
 */
export interface CentredPageFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The page's name, rendered as ONE level-1 heading that only screen readers get. */
  srHeading?: string;
}

/* DECISION Phase 88.9-52 (A-04 / A-38): a page whose whole body is replaced by one banner keeps a
   level-1 heading naming the page, visually hidden, chosen OVER a visible heading (the owner ruled
   the banner-only look, 88.9-66 X70b; the page heading left with the older prompt as a side effect,
   not by ruling) and OVER making the banner title a heading (the title names the failure, not the
   page, and Banner is shared with in-page notices). It sits in the OUTER box, before the inner
   one, chosen OVER inside the inner box: a page that moves focus to the inner box must still land
   on a box whose first text is the banner title. The house sr-only class takes it out of the
   layout, so the centring and the gutter are unchanged.
   AMENDED Phase 88.9-52 (R3, owner 2026-11-16): each page passes srHeading from the ONE constant
   that also feeds its visible page name (FRIENDS_PAGE_TITLE, PLAN_PAGE_TITLE, PROFILE_PAGE_NAME,
   GROUP_PAGE_NAME), chosen OVER a typed word at the mount; a hand-typed srHeading fails that
   page's R3 test. */

const CentredPageFrame = React.forwardRef<HTMLDivElement, CentredPageFrameProps>(
  ({ className, children, srHeading, ...props }, ref) => (
    <div data-page-frame="" className="flex flex-1 flex-col items-center justify-center p-edge-page md:p-edge-wide">
      {srHeading ? (
        <Heading level={1} className="sr-only">
          {srHeading}
        </Heading>
      ) : null}
      {/* DECISION Phase 88.9-52 (W1, owner at the after-build look page: give the banner the house
          ring): a frame a page moves focus to (Profile, session expired) shows the house ring — a
          2px ring over a 2px halo of the page ground, on the banner's own corner radius — chosen
          OVER the browser's outline (square corners, hugging the box; the look the owner flagged)
          and OVER hiding the outline as main does (X20: main is the floor of a whole page; this
          box is one banner, and a ring round it shows where focus went). The classes sit on every
          frame and paint only while the box holds focus, which needs the host's tabIndex. Ring on
          the page ground: light 5.97:1, dark 10.13:1 (floor 3.0). */}
      <div
        ref={ref}
        data-slot="page-frame"
        className={cn(
          'w-full max-w-xl rounded-card focus:outline-hidden focus-visible:focus-ring',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
);

CentredPageFrame.displayName = 'CentredPageFrame';

export { CentredPageFrame };
