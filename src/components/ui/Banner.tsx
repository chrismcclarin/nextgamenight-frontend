'use client';

/**
 * Banner — presentational status/notice banner (PRIM-04 / D-03).
 *
 * The first `cva` consumer in the repo. Tone variants (info/success/warning/error)
 * are driven by semantic `status-*` tokens layered onto the `cn()` + `forwardRef`
 * + `displayName` idiom, so Phase 88 can re-theme without touching the API.
 *
 * Backed by a live region: the message renders inside a {@link StatusRegion} so
 * adopters (e.g. FetchErrorBanner, Plan 03) get an announcement for free —
 * error/warning tones announce assertively, info/success politely.
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
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
};

export interface BannerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bannerVariants> {
  /** Optional bold heading rendered above the message. */
  title?: string;
  /** Override the tone's default lucide icon, or `false` to omit it. */
  icon?: IconName | false;
}

const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  ({ tone = 'info', title, icon, className, children, ...props }, ref) => {
    const resolvedTone: BannerTone = tone ?? 'info';
    const assertive = resolvedTone === 'error' || resolvedTone === 'warning';
    const glyph = icon === false ? null : (icon ?? toneIcon[resolvedTone]);

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
        <StatusRegion
          politeness={assertive ? 'assertive' : 'polite'}
          className="flex-1"
        >
          {title && <span className="block font-semibold">{title}</span>}
          {children}
        </StatusRegion>
      </div>
    );
  }
);

Banner.displayName = 'Banner';

export { Banner, bannerVariants };
