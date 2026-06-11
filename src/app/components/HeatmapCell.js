'use client';

import React, { memo, useMemo } from 'react';
import HeatmapTooltip from './HeatmapTooltip';
import { intensityColor as getIntensityColor } from '../../lib/availabilityColor';

/**
 * HeatmapCell - Individual cell in the availability heatmap.
 *
 * Phase 72-02 (HUX-02): Wraps the cell in the shared HeatmapTooltip primitive
 * so the participant list is reachable on touch + keyboard, not only mouse
 * hover. Local hover state and the four mouse/focus handlers are gone — the
 * primitive owns trigger/dismiss/positioning. Tooltip content (Preferred / If
 * needed groupings) is built locally from the participants prop.
 *
 * `triggerRef` and `tabIndex` are forwarded from the parent grid (HeatmapGrid)
 * so it can implement roving-tabindex arrow-key navigation across cells.
 *
 * @param {Object} props
 * @param {string} props.slotId - Unique identifier (ISO8601 UTC string)
 * @param {number} props.participantCount - Number of available participants
 * @param {number} props.preferredCount - Number of participants who marked preferred
 * @param {Array} props.participants - Array of { user_id, username, preference }
 * @param {number} props.totalMembers - Total group members
 * @param {boolean} props.hidden - Whether cell is below threshold (don't render)
 * @param {string} props.timeLabel - Formatted time (e.g., "5:00 PM")
 * @param {boolean} props.showTimeLabel - Show time label on left edge
 * @param {Function|Object} [props.triggerRef] - ref/callback exposing the cell
 *   trigger DOM element to the parent grid (for roving-tabindex focus()).
 * @param {number} [props.tabIndex] - tabIndex for the cell (parent grid sets
 *   0 for the focused cell, -1 for the rest — standard ARIA grid pattern).
 */
const HeatmapCell = memo(function HeatmapCell({
  slotId,
  participantCount = 0,
  preferredCount = 0,
  participants = [],
  totalMembers = 1,
  hidden = false,
  timeLabel,
  showTimeLabel = false,
  triggerRef,
  tabIndex = -1,
}) {
  // Group participants by preference. Promoted from the old HeatmapTooltip
  // (Phase 72-01 rewrite removed this from the primitive; consumers own
  // content shaping now).
  const grouped = useMemo(() => {
    const preferred = [];
    const ifNeeded = [];
    participants.forEach((p) => {
      if (p.preference === 'preferred') {
        preferred.push(p.username || p.user_id);
      } else {
        ifNeeded.push(p.username || p.user_id);
      }
    });
    return { preferred, ifNeeded };
  }, [participants]);

  // Don't render real content if below threshold — but still wrap the hidden
  // stub in HeatmapTooltip so the parent grid's roving-tabindex keyboard nav
  // can move focus onto empty cells too (Plan 72-01's primitive honors
  // triggerRef on the disabled pass-through path for exactly this reason).
  if (hidden) {
    return (
      <div className="flex items-stretch">
        {showTimeLabel && (
          <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium">
            {timeLabel}
          </div>
        )}
        <HeatmapTooltip content={null} triggerRef={triggerRef}>
          <div
            className="w-24 sm:w-28 h-12 sm:h-14 border border-line bg-surface-elevated opacity-30"
            role="gridcell"
            tabIndex={tabIndex}
            aria-label={`${timeLabel}: below threshold`}
          />
        </HeatmapTooltip>
      </div>
    );
  }

  const colorClasses = getIntensityColor(participantCount, preferredCount, totalMembers);

  const tooltipContent = participantCount > 0 ? (
    <>
      {grouped.preferred.length > 0 && (
        <div className="mb-1">
          <span className="text-green-400 font-medium">Preferred: </span>
          <span>{grouped.preferred.join(', ')}</span>
        </div>
      )}
      {grouped.ifNeeded.length > 0 && (
        <div>
          <span className="text-yellow-400 font-medium">If needed: </span>
          <span>{grouped.ifNeeded.join(', ')}</span>
        </div>
      )}
    </>
  ) : null;

  return (
    <div className="flex items-stretch">
      {/* Time label on left edge */}
      {showTimeLabel && (
        <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium">
          {timeLabel}
        </div>
      )}

      {/* Heatmap cell — wrapped in HeatmapTooltip. The primitive clones the
          inner div, attaches its merged ref (floating-ui setReference +
          parent triggerRef + child ref) and the hover/click/focus handlers.
          The disabled-on-falsy-content path still honors triggerRef so grid
          keyboard nav works across empty cells too. */}
      <HeatmapTooltip
        content={tooltipContent}
        ariaLabel={`${timeLabel}: ${participantCount} of ${totalMembers} available`}
        triggerRef={triggerRef}
      >
        <div
          className={`
            w-24 sm:w-28 h-12 sm:h-14 border
            ${colorClasses}
            cursor-pointer
            transition-colors duration-75
            flex items-center justify-center
            text-xs sm:text-sm font-medium
            ${participantCount > 0 ? 'text-content-primary' : 'text-content-muted'}
          `}
          role="gridcell"
          tabIndex={tabIndex}
        >
          {/* Show participant count in cell */}
          {participantCount > 0 && (
            <span>{participantCount}</span>
          )}
        </div>
      </HeatmapTooltip>
    </div>
  );
});

// Named export for flexibility
export { HeatmapCell, getIntensityColor };

// Default export
export default HeatmapCell;
