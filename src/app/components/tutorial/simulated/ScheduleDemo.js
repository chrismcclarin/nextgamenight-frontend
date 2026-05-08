'use client';

import TutorialGrid from './TutorialGrid';
import { HEATMAP_DENSITY, SCHEDULE_DRAG_PATH } from '../mockData';

/**
 * ScheduleDemo — Step 4 of 5.
 *
 * Same heatmap as Step 3, but now a click-drag selects the peak slot range
 * (Fri 7:00-8:00 PM) to define an event window. Selected cells get a strong
 * blue selection ring on top of their density color so users see exactly
 * what the gesture produces. After the drag completes, a mini "create event"
 * confirmation card slides in to communicate the outcome.
 *
 * The same drag mechanic that fed the heatmap (Step 2) now consumes the
 * heatmap to produce an event — the system loop closes.
 *
 * Stage progression:
 *   0 - heatmap visible (same as end of Step 3), no selection
 *   1..N - drag advances to SCHEDULE_DRAG_PATH[N-1]
 *   SCHEDULE_DRAG_PATH.length+1 - all selected, "Create event" card visible
 */
const HEAT_COLORS = [
  'bg-surface-elevated border-line',
  'bg-green-100 border-green-200',
  'bg-green-200 border-green-300',
  'bg-green-300 border-green-400',
  'bg-green-400 border-green-500',
  'bg-green-500 border-green-600 text-white',
];

export default function ScheduleDemo({ stage }) {
  const selectedCount = Math.min(stage, SCHEDULE_DRAG_PATH.length);
  const allSelected = selectedCount >= SCHEDULE_DRAG_PATH.length;

  const selectedKeys = new Set(
    SCHEDULE_DRAG_PATH.slice(0, selectedCount).map(([r, c]) => `${r}-${c}`)
  );
  const cursor = selectedCount > 0 ? SCHEDULE_DRAG_PATH[selectedCount - 1] : null;

  const renderCell = (row, col) => {
    const density = HEATMAP_DENSITY[row][col];
    const baseClass = HEAT_COLORS[density];
    const isSelected = selectedKeys.has(`${row}-${col}`);
    const isCursor = cursor && cursor[0] === row && cursor[1] === col && !allSelected;

    if (isSelected) {
      return {
        className: `${baseClass} ring-2 ring-blue-500 ring-offset-1 ring-offset-surface-card`,
        content: density > 0 ? density : '',
      };
    }
    if (isCursor) {
      return {
        className: `${baseClass} ring-2 ring-blue-400`,
        content: density > 0 ? density : '',
      };
    }
    return {
      className: baseClass,
      content: density > 0 ? density : '',
    };
  };

  return (
    <div className="text-center">
      <div className="bg-surface-card rounded-t-card border border-line border-b-0 px-3 py-2 inline-block">
        <span className="text-xs text-content-secondary">
          Drag to schedule across the peak
        </span>
      </div>

      <div className="-mt-px">
        <TutorialGrid renderCell={renderCell} />
      </div>

      {/* "Event created" card — slides in once the drag completes */}
      <div
        className="mt-3 transition-all duration-500"
        style={{
          opacity: allSelected ? 1 : 0,
          transform: allSelected ? 'translateY(0)' : 'translateY(8px)',
          maxHeight: allSelected ? '120px' : '0px',
          overflow: 'hidden',
        }}
      >
        <div className="bg-surface-card border border-green-400 rounded-card p-3 inline-block shadow-theme-md">
          <div className="flex items-center gap-3 text-left">
            <div className="w-2 h-10 bg-green-500 rounded-full flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-content-primary">
                Game Night
              </div>
              <div className="text-xs text-content-secondary">
                Friday, 7:00 – 8:30 PM · 5 going
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
