'use client';

/**
 * Banner — presentational status/notice banner (PRIM-04 / D-03).
 *
 * The first `cva` consumer in the repo. Tone variants (info/success/warning/error)
 * are driven by semantic `status-*` tokens layered onto the `cn()` + `forwardRef`
 * + `displayName` idiom, so Phase 88 can re-theme without touching the API.
 *
 * Backed by a live region: the title and message render inside a {@link StatusRegion} —
 * error/warning tones assertive (`role="alert"`), info/success polite (`role="status"`). An
 * INSERTED error/warning Banner that arrives with its text is announced (`role="alert"`,
 * Phase 88.6.1 D-42); an inserted info/success one is not, and a text CHANGE to a mounted
 * region is announced at either politeness. Controls belong in `actions`, never in
 * `children`: `children` sit inside the aria-atomic region, so a label change there re-reads
 * the whole region. `FetchErrorBanner` keeps its Banner mounted (visually hidden while
 * healthy), so its failure text arrives as a change to a mounted assertive region.
 *
 * Presentational only (T-86-08): children/message render as auto-escaped React
 * nodes; no `dangerouslySetInnerHTML`. Reach for Radix only if the Banner later
 * becomes interactive (e.g. dismissible) — not now.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';
import { StatusRegion } from './StatusRegion';

/* DECISION Phase 88-26 (D-35): the base carries an EXPLICIT NEUTRAL colour, chosen OVER leaving
   the three non-accent sides to the base-layer shim (which is what shipped, and which plan 88-31
   deletes). Only `info` named a colour before this; on success/warning/error the accent utility
   colours the LEFT edge and the top/right/bottom edges were falling through to the shim's
   `--color-gray-200` (#e5e7eb) — a near-white hairline measuring 11.19:1 against the dark page.
   Every non-info Banner in the app was glowing on three sides in dark mode.

   Rejected: adding the neutral to each of the four tone variants instead. It reads as four
   independent choices when it is one, and a fifth tone would silently reacquire the defect.

   THE ACCENT STILL WINS ON THE LEFT, and that is a cascade fact, not a hope — verified against a
   real Tailwind v4 build of this stylesheet: `.border-l-status-*` (border-left-color) is emitted
   AFTER the neutral's shorthand rule, and equal specificity means source order decides.
   `tailwind-merge` also keeps both (a shorthand does not conflict-eat a longhand). If you ever
   see the accent stripe go neutral, that ordering is what changed. */
const bannerVariants = cva(
  'flex items-start gap-3 rounded-card border border-line border-l-4 px-4 py-3 text-sm bg-surface-elevated text-content-primary',
  {
    variants: {
      tone: {
        // `info`'s 4px left edge is deliberately the same neutral as the other three sides —
        // "no accent stripe" is the design, not a missing token.
        info: 'border-l-line',
        success: 'border-l-status-success',
        warning: 'border-l-status-warning',
        error: 'border-l-status-error',
      },
    },
    defaultVariants: { tone: 'info' },
  }
);

type BannerTone = NonNullable<VariantProps<typeof bannerVariants>['tone']>;

/** Default leading glyph per tone (lucide names). */
const toneIcon: Record<BannerTone, IconName> = {
  info: 'Info',
  success: 'CircleCheck',
  warning: 'TriangleAlert',
  error: 'CircleAlert',
};

/** Icon color per tone (semantic tokens; Icon inherits via currentColor). */
const toneIconColor: Record<BannerTone, string> = {
  info: 'text-content-secondary',
  success: 'text-content-status-success',
  warning: 'text-content-status-warning',
  error: 'text-content-status-error',
};

export interface BannerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bannerVariants> {
  /** Optional bold heading rendered above the message. */
  title?: string;
  /** Override the tone's default lucide icon, or `false` to omit it. */
  icon?: IconName | false;
  /* DECISION Phase 88.6.1-21 (AC-11 / D-42): an additive, default-off `actions` slot, chosen so
     FetchErrorBanner's buttons leave its atomic alert with ONE copy of the text in the DOM.
     REJECTED: (a) a non-live Banner option plus a separate sr-only copy of the title and message
     — it duplicates the text, and 29 text queries in 13 consumer suites would find two matches;
     (b) moving the buttons below the box — a look change; (c) making Banner non-live for
     everyone — its other two mounts (EmailAddressSection, AutoPromptBehaviorBanner) rely on its
     region. Omitting the prop renders the original markup. AMENDED 2026-10-19 (88.6.1 code review
     A-71): AutoPromptBehaviorBanner now passes `actions` too (its "Got it" button left the atomic
     region); EmailAddressSection is the one mount that still omits the prop. */
  /**
   * Controls rendered inside the box, below the message, OUTSIDE the live region — a control
   * inside an `aria-atomic` region re-announces the whole region when its label changes.
   * Passing the prop, even as `null`, selects the column layout; omitting it keeps the
   * original markup byte-for-byte.
   */
  actions?: React.ReactNode;
}

const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  ({ tone = 'info', title, icon, actions, className, children, ...props }, ref) => {
    const resolvedTone: BannerTone = tone ?? 'info';
    const assertive = resolvedTone === 'error' || resolvedTone === 'warning';
    const glyph = icon === false ? null : (icon ?? toneIcon[resolvedTone]);
    const politeness = assertive ? 'assertive' : 'polite';

    // The title span and its marker are written ONCE; both layouts render this same node.
    const body = (
      <>
        {/* DECISION Phase 88.6-36 (D-03 / UI-SPEC §4.5): the title is 700, chosen OVER the
            shipped 600 and OVER §4.5's other outcome (400 plus a colour token). This is the
            HIERARCHY case and not the emphasis one: the title is the only thing distinguishing
            itself from the message directly beneath it — same ink, same rung, same box — so
            dropping to 400 would erase the distinction rather than re-carry it. 600 is a
            prohibition outside `Button` (§4.2), and this is the last 600 in this primitive.
            The banner BODY stays at `text-sm` (the cva base above): that rung is a ruled
            question for the whole banner family, not this sweep's to answer. */}
        {title && <span className="block font-bold">{title}</span>}
        {children}
      </>
    );

    return (
      <div
        ref={ref}
        className={cn(bannerVariants({ tone: resolvedTone }), className)}
        {...props}
      >
        {glyph && (
          <Icon
            name={glyph}
            size={18}
            className={cn('mt-0.5 shrink-0', toneIconColor[resolvedTone])}
          />
        )}
        {actions === undefined ? (
          <StatusRegion politeness={politeness} className="flex-1">
            {body}
          </StatusRegion>
        ) : (
          <div className="flex-1">
            <StatusRegion politeness={politeness}>{body}</StatusRegion>
            {actions}
          </div>
        )}
      </div>
    );
  }
);

Banner.displayName = 'Banner';

export { Banner, bannerVariants };
