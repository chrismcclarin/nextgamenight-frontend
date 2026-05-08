'use client';

import { MOCK_AVAILABILITY } from '../mockData';

/**
 * Functional data-viz colors for heatmap cells (overlap count 0-4).
 * Matches real HeatmapCell warm scale: gray → yellow → orange → red.
 * Kept as concrete Tailwind classes (not semantic tokens) — this is a
 * data visualization, not a UI surface.
 */
const HEAT_COLORS = [
  'bg-gray-200',                          // 0 - nobody
  'bg-yellow-200 border-yellow-400',      // 1 - light warm
  'bg-yellow-400 border-yellow-500',      // 2 - warm
  'bg-orange-400 border-orange-500',      // 3 - hot
  'bg-red-500 border-red-600 text-white', // 4 - hottest
];

/**
 * HeatmapReveal — staggered animated 7×6 availability grid for the tutorial.
 *
 * Stage props:
 *   0 - empty (gray cells, no numbers)
 *   1 - filling (cells transition to their HEAT_COLOR with row*80 + col*60ms stagger;
 *        numbers fade in)
 *   2 - highlight (Fri 7pm cell — the data[3][4]=4 hot spot — gets a pulsing amber ring)
 *   3 - dim (whole grid drops to opacity-30 to make room for the handoff slide)
 *
 * Why CSS-only: framer-motion is not in the stack and the effect is staggered
 * `transition-colors` + `animate-pulse`. Adding framer-motion for one
 * onboarding flash is a 50KB bundle hit (Pitfall: research confirmed CSS is
 * sufficient). All transitions are GPU-accelerated.
 *
 * Day/time labels mirror the visual grammar of MergedHeatmap so first-login
 * users recognize the real product when they arrive.
 */
export default function HeatmapReveal({ stage }) {
  const isDimmed = stage === 3;

  return (
    <div
      className={`bg-surface-card rounded-card border border-line shadow-theme-md p-4 inline-block transition-opacity duration-500 ${
        isDimmed ? 'opacity-30' : 'opacity-100'
      }`}
    >
      <div className="min-w-max">
        {/* Day headers */}
        <div className="flex">
          <div className="w-16 flex-shrink-0" />
          {MOCK_AVAILABILITY.days.map((day) => (
            <div
              key={day}
              className="w-14 flex-shrink-0 text-center text-xs font-medium text-content-secondary pb-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Heatmap rows */}
        {MOCK_AVAILABILITY.timeSlots.map((time, rowIdx) => (
          <div key={time} className="flex">
            <div className="w-16 flex-shrink-0 text-xs text-content-muted py-1.5 pr-2 text-right">
              {time}
            </div>
            {MOCK_AVAILABILITY.data[rowIdx].map((count, colIdx) => {
              // Stage 0: every cell stays gray. Stage 1+: cells transition into
              // their final HEAT_COLOR. The transitionDelay is what produces the
              // diagonal-sweep stagger.
              const cellClass =
                stage >= 1 ? HEAT_COLORS[Math.min(count, 4)] : 'bg-gray-200';
              // Stage 2: pulse ONLY on Fri 7pm (data[3][4]). Other 4-cells exist
              // but the pulse is reserved for the cultural anchor in the copy.
              const isHotSpot = rowIdx === 3 && colIdx === 4;
              const ringClass =
                stage === 2 && isHotSpot
                  ? 'ring-2 ring-amber-500 animate-pulse'
                  : '';
              const delay = rowIdx * 80 + colIdx * 60;
              return (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  className={`w-14 h-8 flex-shrink-0 flex items-center justify-center text-xs font-medium rounded-sm m-0.5 border transition-colors duration-500 ${cellClass} ${ringClass}`}
                  style={{ transitionDelay: `${delay}ms` }}
                >
                  {stage >= 1 && count > 0 ? count : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
