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
/* DECISION Phase 88.6-35 (D-01 / UI-SPEC §4.2): the day header, the time-gutter label and the
   cell content all sit at `text-xs` (12) and STAY there — 12 is the Caption rung and
   "dense-grid cells (month tile, week strip, heatmap legend)" is an ENUMERATED Caption role.
   A `text-xs` in a simulated grid is CORRECT; sweeping it up to 14 under §4.2's 12px-misuse
   clause would be the misreading this note exists to stop, and it would widen a grid whose
   columns are fixed `w-12` boxes.

   The gutter and cell arrived here by FOLDING UP from `text-[10px]`, which is off the rung set
   by definition. MEASURED in Chromium at 375px over the compiled `globals.css` and the app's
   own Plus Jakarta Sans latin subset, rather than assumed: the `w-14` gutter holds "5:00 PM" at
   40.16px -> 48.19px inside a 56px box (0 overflow, +1px line box), and the `w-12 h-7` cell is
   48 x 28 in both arms with its digit at 6.16px -> 7.38px. No fixed box overflowed, nothing
   wrapped, and the document scrollWidth stayed 375 in both arms.

   The weights go 500 -> 700, not 500 -> 400: the day header is the hierarchy label of its
   column and the cell digit is ink inside its own density FILL, which is §4.5's pill/chip-ink
   reason. The production surface this grid imitates already renders its equivalents at
   `text-xs font-bold` (`EventHeatmapBackground.js:241`, `:318`), so 700 is also what keeps the
   simulation recognisable as the real thing — which is this component's whole stated purpose. */
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
              className="w-12 shrink-0 text-center text-xs font-bold text-content-secondary pb-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Time-slot rows */}
        {TUTORIAL_TIME_SLOTS.map((time, rowIdx) => (
          <div key={time} className="flex">
            <div className="w-14 shrink-0 text-xs text-content-muted py-1 pr-1.5 text-right">
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
                    'w-12 h-7 shrink-0 flex items-center justify-center text-xs font-bold rounded-xs m-0.5 border border-line transition-all duration-300',
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
