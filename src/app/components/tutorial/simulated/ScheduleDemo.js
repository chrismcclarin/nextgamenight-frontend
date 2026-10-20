'use client';

import TutorialGrid from './TutorialGrid';
import { HEATMAP_DENSITY, SCHEDULE_DRAG_PATH } from '../mockData';

/**
 * ScheduleDemo — the schedule step, `Step 5 of 6` on the tutorial's indicator.
 *
 * Same heatmap as Step 4, but now a drag selects the peak slot range
 * (Fri 7:00-8:00 PM) to define an event window. Selected cells get a strong
 * blue selection ring on top of their density color so users see exactly
 * what the gesture produces. After the drag completes, a mini "create event"
 * confirmation card slides in to communicate the outcome.
 *
 * The same drag mechanic that fed the heatmap (the availability drag of Step 3)
 * now consumes the heatmap to produce an event — the system loop closes.
 *
 * The badge above the grid names the gesture, and its wording forks on the
 * `isPhoneViewport` prop the overlay passes (see the DECISION Phase 88.6.1-51
 * marker above the component).
 *
 * Stage progression:
 *   0 - heatmap visible (as Step 4 left it), no selection
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

// Badge wording, one constant per arm (D-30 placement).
// R4 (D-32), phone arm.
const SCHEDULE_BADGE_PHONE = "Press and hold, then drag to schedule across the peak";
// Badge, desktop — unchanged (D-16).
const SCHEDULE_BADGE_DESKTOP = "Drag to schedule across the peak";

/* DECISION Phase 88.6.1-51 (D-16, R4): CHOSEN — the badge's arm arrives as the overlay's
   isPhoneViewport prop (TutorialOverlay reads the shared usePhoneViewport hook once).
   REJECTED: calling the shared hook here — a hook instance mounted with the schedule step starts
   false, so a phone would paint the desktop badge for one frame and then re-wrap it to two lines.
   Plan 88.6.1-09 expected each consumer to call the hook, but nothing depends on that: its census
   counts viewport reads, not hook calls. Re-adding a viewport read here is a decision, not a
   cleanup. */
export default function ScheduleDemo({ stage, isPhoneViewport = false }) {
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
          {isPhoneViewport ? SCHEDULE_BADGE_PHONE : SCHEDULE_BADGE_DESKTOP}
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
            <div className="w-2 h-10 bg-green-500 rounded-full shrink-0" />
            <div>
              {/* DECISION Phase 88.6-35 (UI-SPEC §4.5 hierarchy row): 600 -> 700 on the
                  simulated event card's TITLE, chosen OVER the emphasis outcome (400 + a
                  colour token). It is the one primary string of this card and the payoff the
                  whole step builds to; the `text-xs` detail line directly beneath it is what
                  the weight distinguishes it from, and at 400 the two would be separated by
                  size alone. Not a `.btn`, so the weight was ALIVE — a real 600 -> 700 delta
                  on a tutorial surface. */}
              <div className="text-sm font-bold text-content-primary">
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
