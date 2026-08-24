'use client';

import { cn } from '@/lib/cn';

import { TUTORIAL_DAYS, TUTORIAL_TIME_SLOTS } from '../mockData';

/**
 * TutorialGrid — shared grid primitive for the tutorial demo steps.
 *
 * Renders a 7-day × 8-slot grid with the same visual grammar as the production
 * AvailabilityGrid and the scheduler's heatmap so users recognize the real surfaces
 * when they arrive. Each cell is rendered by the caller's `renderCell` prop
 * so the same grid serves availability painting, heatmap density, and the
 * schedule drag-select with no extra abstractions.
 *
 * @param {(row: number, col: number) => React.ReactNode} renderCell
 *   Called for each cell. Return the className string and any inner content.
 *   Signature: renderCell(rowIdx, colIdx) -> { className, content }
 */
export default function TutorialGrid({ renderCell }) {
  return (
    <div className="bg-surface-card rounded-card border border-line shadow-theme-md p-3 inline-block">
      <div className="min-w-max">
        {/* Day headers — match production AvailabilityGrid layout */}
        <div className="flex">
          <div className="w-14 shrink-0" />
          {TUTORIAL_DAYS.map((day) => (
            <div
              key={day}
              className="w-12 shrink-0 text-center text-xs font-medium text-content-secondary pb-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Time-slot rows */}
        {TUTORIAL_TIME_SLOTS.map((time, rowIdx) => (
          <div key={time} className="flex">
            <div className="w-14 shrink-0 text-[10px] text-content-muted py-1 pr-1.5 text-right">
              {time}
            </div>
            {TUTORIAL_DAYS.map((_, colIdx) => {
              const { className, content } = renderCell(rowIdx, colIdx);
              return (
                /* DECISION Phase 88-26 (D-35): the cell's own neutral is the DEFAULT and the
                   caller overrides it through `cn`, chosen OVER a plain template literal.
                   The three demos all happen to return a coloured cell today, so this site was
                   not visibly broken — but the contract did not require one, so the default was
                   the base-layer shim that plan 88-31 deletes.

                   `cn` (tailwind-merge) is LOAD-BEARING here, not a style preference. Both the
                   default and every caller value are the same CSS property (border-color), so a
                   template literal would leave the winner to stylesheet order — and in a real
                   Tailwind v4 build of this app the neutral is emitted AFTER the palette colours,
                   i.e. the default would have OVERPAINTED every caller's cell. tailwind-merge
                   drops the earlier of two conflicting colours, so the caller wins deterministically
                   and an empty caller value falls back to the neutral. Reverting to a template
                   literal repaints the entire tutorial grid. */
                <div
                  key={`${rowIdx}-${colIdx}`}
                  className={cn(
                    'w-12 h-7 shrink-0 flex items-center justify-center text-[10px] font-medium rounded-xs m-0.5 border border-line transition-all duration-300',
                    className
                  )}
                >
                  {content}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
