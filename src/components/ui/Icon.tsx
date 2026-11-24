'use client';

/** @jsxImportSource react */
// The line above is load-bearing for e2e/primitives-large-text.spec.ts; the reason is at
// src/components/ui/Button.tsx ("DECISION Phase 89.6-06 (jsx-source)"). Removing it is a decision, not a cleanup.

/**
 * Icon — thin typed wrapper over lucide-react (PRIM-04 / D-04).
 *
 * ONE icon + accessibility contract for the app:
 *   - Decorative by default: no `title` → `aria-hidden="true"` (screen readers skip it).
 *   - Labeled path: pass `title` → `role="img"` + `aria-label={title}` (announced).
 *   - `size`/`color` map onto the wrapped svg (color flows through `currentColor`).
 *   - Inline-SVG escape hatch (`render`) for board-game glyphs lucide lacks
 *     (dice/meeple) — routed through the SAME aria contract so behavior is uniform.
 *
 * Do NOT build a bespoke icon set here — the brand icon call is Phase 88's.
 */
import * as React from 'react';
import { icons, type LucideProps } from 'lucide-react';

import { cn } from '@/lib/cn';

/** PascalCase lucide icon name (e.g. `"X"`, `"Info"`, `"Dices"`). */
export type IconName = keyof typeof icons;

/* DECISION Phase 89.6-06 (O-M4): an icon that follows the text size up to 32px is an inline min() of
   its rem size and 32px, chosen OVER px sizes (they never grow, so the gear and the × stay 20px at
   200%) and OVER an uncapped rem size (the menu icon and the dots grew without limit and would
   overflow the held box). Owner pick O-M4 = Fixed+, 2026-11-22. iconTextSize is the one formula for
   glyphs that are not an Icon (the kebab dots). Changing this is a decision, not a cleanup. */
export const ICON_TEXT_CAP_PX = 32;

/** The CSS length of an icon that is px wide at normal text, follows the text size and stops at the cap. */
export function iconTextSize(px: number): string {
  return `min(${px / 16}rem, ${ICON_TEXT_CAP_PX}px)`;
}

/** The aria + sizing props the wrapper hands to the underlying svg. */
export interface IconRenderProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
  role?: 'img';
  'aria-hidden'?: true;
  'aria-label'?: string;
  /** Present only under followText: the inline size that follows the text (it beats the size attributes). */
  style?: React.CSSProperties;
  /** Present only under followText: an empty marker a unit test can see (jsdom drops the inline min() size). */
  'data-follow-text'?: '';
}

interface IconBaseProps {
  /** svg width/height in px (or any CSS length). Defaults to lucide's own default. */
  size?: number | string;
  /** Stroke/fill color; defaults to `currentColor` via lucide. */
  color?: string;
  strokeWidth?: number;
  className?: string;
  /**
   * Accessible name. When present the icon is exposed as `role="img"` with this
   * label; when absent the icon is `aria-hidden` (decorative).
   */
  title?: string;
  /**
   * The icon follows the text size up to 32px (owner pick O-M4 = Fixed+): with a numeric size
   * the svg is sized inline by iconTextSize(size) and marked data-follow-text. Without it the svg
   * keeps its numeric size at every text size, as before. Ignored when size is not a number.
   */
  followText?: boolean;
}

interface NamedIconProps extends IconBaseProps {
  name: IconName;
  render?: never;
}

interface CustomIconProps extends IconBaseProps {
  name?: never;
  /**
   * Inline-SVG escape hatch for glyphs lucide lacks (dice/meeple). Receives the
   * resolved aria + sizing props so the accessibility contract stays uniform.
   */
  render: (props: IconRenderProps) => React.ReactNode;
}

export type IconProps = NamedIconProps | CustomIconProps;

const Icon = React.forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, render, size, color, strokeWidth, className, title, followText },
  ref
) {
  // Single source of truth for the aria contract, applied to both the lucide
  // path and the inline-SVG escape hatch.
  const aria: Pick<IconRenderProps, 'role' | 'aria-hidden' | 'aria-label'> = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': true };

  // The inline size beats lucide's width and height attributes. A computed class would not do: a
  // class name built at run time emits no CSS under Tailwind v4. No style rule reads the marker.
  const follow: Pick<IconRenderProps, 'style' | 'data-follow-text'> =
    followText && typeof size === 'number'
      ? { style: { width: iconTextSize(size), height: iconTextSize(size) }, 'data-follow-text': '' }
      : {};

  const shared: IconRenderProps = {
    size,
    color,
    strokeWidth,
    className: cn(className),
    ...aria,
    ...follow,
  };

  if (render) {
    return <>{render(shared)}</>;
  }

  const Glyph = icons[name];
  if (!Glyph) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[Icon] Unknown lucide icon name: "${String(name)}"`);
    }
    return null;
  }

  return <Glyph ref={ref} {...(shared as LucideProps)} />;
});

Icon.displayName = 'Icon';

export { Icon };
