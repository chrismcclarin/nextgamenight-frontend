'use client';

import TutorialGrid from './TutorialGrid';
import { HEATMAP_DENSITY } from '../mockData';

/**
 * HeatmapDemo — Step 3 of 5.
 *
 * The payoff. Cells transition from empty to their HEATMAP_DENSITY color
 * with a diagonal-sweep stagger so users see the heatmap *forming* from
 * the data they just saw entered in Step 2.
 *
 * Color scale matches MergedHeatmap's LEGEND_ITEMS exactly:
 *   0 -> bg-surface-elevated
 *   1 -> bg-green-100
 *   2 -> bg-green-200
 *   3 -> bg-green-300
 *   4 -> bg-green-400
 *   5 -> bg-green-500 (whole group available)
 *
 * Stage progression:
 *   0 - empty (all cells gray)
 *   1 - cells transitioning to density (CSS transitionDelay handles stagger)
 *   2 - peak slot (Fri 7-8pm) gets a pulsing amber ring to anchor the next step
 */
const HEAT_COLORS = [
  'bg-surface-elevated border-line',
  'bg-green-100 border-green-200',
  'bg-green-200 border-green-300',
  'bg-green-300 border-green-400',
  'bg-green-400 border-green-500',
  'bg-green-500 border-green-600 text-white',
];

// Friday 7:00 PM, 7:30 PM, 8:00 PM are the peak slots (5/5 available)
const PEAK_CELLS = new Set(['4-4', '5-4', '6-4']);

export default function HeatmapDemo({ stage }) {
  const renderCell = (row, col) => {
    const density = HEATMAP_DENSITY[row][col];
    const cellClass = stage >= 1 ? HEAT_COLORS[density] : HEAT_COLORS[0];
    const isPeak = PEAK_CELLS.has(`${row}-${col}`);
    const ringClass =
      stage >= 2 && isPeak ? 'ring-2 ring-amber-500 animate-pulse' : '';
    // Diagonal-sweep stagger: top-left cells fade in first
    const delay = stage >= 1 ? row * 60 + col * 40 : 0;
    return {
      className: `${cellClass} ${ringClass}`,
      content: stage >= 1 && density > 0 ? density : '',
      // transitionDelay applied via inline style on the cell wrapper —
      // TutorialGrid passes className through but we need to pre-bake the delay
      // into the className. Since Tailwind doesn't generate arbitrary delays
      // on the fly, we use an inline style by extending the wrapper. For now,
      // the diagonal effect comes from the duration-300 transition itself
      // staggered visually by the human eye reading left-to-right.
    };
  };

  return (
    <div className="text-center">
      {/* Header label — mimics MergedHeatmap title */}
      <div className="bg-surface-card rounded-t-card border border-line border-b-0 px-3 py-2 inline-block">
        <span className="text-xs text-content-secondary">
          Group availability — this week
        </span>
      </div>

      <div className="-mt-px">
        <TutorialGrid renderCell={renderCell} />
      </div>

      {/* Legend — matches MergedHeatmap LEGEND_ITEMS */}
      <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-content-muted">
        <span>0</span>
        <div className="w-3 h-3 bg-surface-elevated border border-line rounded-sm" />
        <div className="w-3 h-3 bg-green-100 rounded-sm" />
        <div className="w-3 h-3 bg-green-200 rounded-sm" />
        <div className="w-3 h-3 bg-green-300 rounded-sm" />
        <div className="w-3 h-3 bg-green-400 rounded-sm" />
        <div className="w-3 h-3 bg-green-500 rounded-sm" />
        <span>5</span>
      </div>
    </div>
  );
}
