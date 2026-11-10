'use client';

/* DECISION Phase 88.9-39 N1: one joined pill of raw button segments (role=group, aria-pressed) chosen OVER two .btn Buttons — the unlayered .btn radius rule beats a rounded-l / rounded-r utility on a .btn, so a joined shape needs non-.btn elements; ALSO REJECTED: role=tablist, which promises tabpanels this switch does not own. Unpressed paints the secondary button tokens; pressed paints the toggle-on pair (88.9-RULINGS.md R-P3b, 2026-11-08), which is the primary button values in light but its own dark arm — purple-400 fill, warm-900 ink, purple-300 hover: 4.02:1 against the unpressed segment and 4.93:1 against the card — chosen OVER pressed = primary in both themes, which reads 1.99:1 against the unpressed segment in dark (2.45 against the card), under WCAG 1.4.11's 3:1 while the fill is the only pressed cue; ALSO REJECTED: a check glyph on the pressed segment and an amber inset bar. Shared with the Browse More sort pair (plan 88.9-44, O12a). Changing this is a decision, not a cleanup. */

/**
 * SegmentedToggle — a joined Month | List style switch: a `role="group"` named by `label`,
 * holding one raw `<button type="button">` per option with `aria-pressed` on the current value.
 *
 * - Every segment is at least 44x44 (`min-h-11 min-w-11`, stated inline so controlSizeFloor's tag
 *   scan reads it) and carries the house focus ring on the card halo. No ground prop: both
 *   calendar mounts sit on the card, and plan 88.9-44 measured the Browse More toolbar as bg-card
 *   too (so the sort pair needs none either).
 * - Whole class literals only (Tailwind v4 emits nothing for an interpolated class): the position
 *   and state strings come from two typed lookups, never from template interpolation.
 * - `groupRef` is a plain prop rather than `forwardRef`, which would drop the generic `V` under
 *   React 18's typings.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

/* DECISION Phase 88.9-44 O12a: an optional per-option ariaLabel set on the segment button itself, chosen OVER visible words in the segment (the Browse More sort pair keeps its arrow glyphs) and OVER an aria-hidden glyph plus an sr-only span inside it (two elements for one name, where aria-label on the focusable button replaces the glyph in one attribute; the iPhone measurement of 2026-10-20 covered standalone sr-only spans and container aria-labels, not an sr-only span inside a button). Unset, the segment's own text is its name, as the Month | List switch uses it. Changing this is a decision, not a cleanup. */
export interface SegmentedToggleOption<V extends string> {
  value: V;
  label: string;
  ariaLabel?: string;
}

export interface SegmentedToggleProps<V extends string> {
  /** The group's accessible name (e.g. "Calendar view"). */
  label: string;
  options: ReadonlyArray<SegmentedToggleOption<V>>;
  value: V;
  onChange: (next: V, event: React.MouseEvent<HTMLButtonElement>) => void;
  groupRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

type SegmentPosition = 'only' | 'first' | 'middle' | 'last';

const SEGMENT_POSITION: Record<SegmentPosition, string> = {
  only: 'rounded-full',
  first: 'rounded-l-full',
  middle: '-ml-px',
  last: 'rounded-r-full -ml-px',
};

// MED-78 (88.9-RULINGS.md R-P3b, 2026-11-08): pressed = the toggle-on keys (globals.css), unpressed =
// the secondary button tokens. Two whole literals, one per state.
const SEGMENT_STATE: Record<'pressed' | 'unpressed', string> = {
  pressed: 'bg-toggle-on text-toggle-on-text hover:bg-toggle-on-hover',
  unpressed: 'bg-btn-secondary text-btn-secondary-text hover:bg-btn-secondary-hover',
};

function positionOf(index: number, count: number): SegmentPosition {
  if (count <= 1) return 'only';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

export function SegmentedToggle<V extends string>({
  label,
  options,
  value,
  onChange,
  groupRef,
  className,
}: SegmentedToggleProps<V>) {
  return (
    <div ref={groupRef} role="group" aria-label={label} className={cn('inline-flex', className)}>
      {options.map((option, index) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            aria-label={option.ariaLabel}
            onClick={(event) => onChange(option.value, event)}
            className={cn(
              'relative inline-flex items-center justify-center min-h-11 min-w-11 px-4 text-sm font-bold border border-line focus:outline-hidden focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
              SEGMENT_POSITION[positionOf(index, options.length)],
              SEGMENT_STATE[pressed ? 'pressed' : 'unpressed'],
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
