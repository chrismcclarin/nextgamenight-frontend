'use client';

import { TUTORIAL_DAYS, TUTORIAL_TIME_SLOTS } from '../mockData';

/**
 * TutorialGrid — shared grid primitive for the tutorial demo steps.
 *
 * Renders a 7-day × 8-slot grid with the same visual grammar as the production
 * AvailabilityGrid and MergedHeatmap so users recognize the real surfaces
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
          <div className="w-14 flex-shrink-0" />
          {TUTORIAL_DAYS.map((day) => (
            <div
              key={day}
              className="w-12 flex-shrink-0 text-center text-xs font-medium text-content-secondary pb-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Time-slot rows */}
        {TUTORIAL_TIME_SLOTS.map((time, rowIdx) => (
          <div key={time} className="flex">
            <div className="w-14 flex-shrink-0 text-[10px] text-content-muted py-1 pr-1.5 text-right">
              {time}
            </div>
            {TUTORIAL_DAYS.map((_, colIdx) => {
              const { className, content } = renderCell(rowIdx, colIdx);
              return (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  className={`w-12 h-7 flex-shrink-0 flex items-center justify-center text-[10px] font-medium rounded-sm m-0.5 border transition-all duration-300 ${className}`}
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
