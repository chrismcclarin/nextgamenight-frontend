'use client';

import TutorialGrid from './TutorialGrid';
import { AVAILABILITY_DRAG_PATH } from '../mockData';

/**
 * AvailabilityPromptDemo — Step 2 of 5.
 *
 * Shows how a single member fills out an availability prompt. Animates a
 * click-drag across Friday 6:00 PM - 8:30 PM (matching production's
 * pointerdown→pointerenter paint mechanic). Cells turn bg-green-300 (the
 * "preferred" preference color from the real AvailabilityGrid) one at a time
 * so the user sees the drag motion, not a flash-fill.
 *
 * Stage progression (driven by parent timer):
 *   0 - empty grid
 *   1-N - drag advances to AVAILABILITY_DRAG_PATH[N-1]
 *   AVAILABILITY_DRAG_PATH.length+1 - all painted, "Save" button highlighted
 *
 * @param {number} stage - Current animation stage. 0 = empty.
 */
export default function AvailabilityPromptDemo({ stage }) {
  // How many cells have been "painted" so far (0..AVAILABILITY_DRAG_PATH.length)
  const paintedCount = Math.min(stage, AVAILABILITY_DRAG_PATH.length);
  const allPainted = paintedCount >= AVAILABILITY_DRAG_PATH.length;

  // Set of "rowIdx-colIdx" keys for fast lookup in renderCell
  const paintedKeys = new Set(
    AVAILABILITY_DRAG_PATH.slice(0, paintedCount).map(([r, c]) => `${r}-${c}`)
  );

  // The "cursor" position — the most recently painted cell (or null if not started)
  const cursor = paintedCount > 0 ? AVAILABILITY_DRAG_PATH[paintedCount - 1] : null;

  const renderCell = (row, col) => {
    const isPainted = paintedKeys.has(`${row}-${col}`);
    const isCursor = cursor && cursor[0] === row && cursor[1] === col && !allPainted;

    if (isPainted) {
      return {
        className: 'bg-green-300 border-green-400',
        content: '',
      };
    }
    if (isCursor) {
      return {
        className: 'bg-green-200 border-green-400 ring-2 ring-green-500',
        content: '',
      };
    }
    return {
      className: 'bg-surface-elevated border-line',
      content: '',
    };
  };

  return (
    <div className="text-center">
      {/* Page header — mirrors the magic-link respond page (groups/[id]/
          availability/respond) so users recognize the surface they'll
          actually land on after tapping a check-in. */}
      <div className="bg-surface-card border border-line rounded-t-card px-4 py-3 inline-block">
        <h3 className="text-sm font-bold text-content-primary mb-0.5">
          When are you available this week?
        </h3>
        <p className="text-xs text-content-muted">Group: Tabletop Crew</p>
      </div>

      {/* Toolbar row — paint mode toggle (matches real AvailabilityGrid) */}
      <div className="bg-surface-card border-x border-line px-3 py-1.5 inline-block">
        <div className="flex items-center justify-end">
          <span className="px-2 py-0.5 bg-green-100 border border-green-400 text-green-800 rounded text-[10px] font-medium">
            Adding: Preferred
          </span>
        </div>
      </div>

      <div className="-mt-px">
        <TutorialGrid renderCell={renderCell} />
      </div>

      {/* Save button — highlighted when drag is complete */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          disabled
          className={`px-4 py-1.5 text-xs font-medium rounded-btn transition-all duration-300 ${
            allPainted
              ? 'bg-btn-primary text-btn-primary-content shadow-md scale-105'
              : 'bg-surface-elevated text-content-muted'
          }`}
        >
          Save availability
        </button>
      </div>
    </div>
  );
}
