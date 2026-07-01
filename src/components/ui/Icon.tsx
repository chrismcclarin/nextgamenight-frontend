'use client';

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

/** The aria + sizing props the wrapper hands to the underlying svg. */
export interface IconRenderProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
  role?: 'img';
  'aria-hidden'?: true;
  'aria-label'?: string;
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
  { name, render, size, color, strokeWidth, className, title },
  ref
) {
  // Single source of truth for the aria contract, applied to both the lucide
  // path and the inline-SVG escape hatch.
  const aria: Pick<IconRenderProps, 'role' | 'aria-hidden' | 'aria-label'> = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': true };

  const shared: IconRenderProps = {
    size,
    color,
    strokeWidth,
    className: cn(className),
    ...aria,
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
