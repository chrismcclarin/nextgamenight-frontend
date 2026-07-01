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

const bannerVariants = cva(
  'flex items-start gap-3 rounded-card border border-l-4 px-4 py-3 text-sm bg-surface-elevated text-content-primary',
  {
    variants: {
      tone: {
        info: 'border-line',
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
