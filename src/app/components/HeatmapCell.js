'use client';

import React, { memo, useState, useRef } from 'react';
import HeatmapTooltip from './HeatmapTooltip';

/**
 * Calculate color intensity based on participant count and preference weighting
 *
 * @param {number} participantCount - Total number of available participants
 * @param {number} preferredCount - Number of participants who marked as preferred
 * @param {number} totalMembers - Total group members
 * @returns {string} Tailwind CSS classes for background and border
 */
const getIntensityColor = (participantCount, preferredCount, totalMembers) => {
  // Weight preferred 1.5x for intensity calculation only
  const weightedScore = participantCount + (preferredCount * 0.5);
  const maxPossible = totalMembers * 1.5; // if all preferred
  const percentage = maxPossible > 0 ? (weightedScore / maxPossible) * 100 : 0;

  if (participantCount === 0) return 'bg-surface-elevated border-line';
  if (percentage <= 25) return 'bg-yellow-200 border-yellow-400';
  if (percentage <= 50) return 'bg-yellow-400 border-yellow-500';
  if (percentage <= 75) return 'bg-orange-400 border-orange-500';
  return 'bg-red-500 border-red-600';
};

/**
 * HeatmapCell - Individual cell in the availability heatmap
 * Displays color intensity based on participant availability
 * Shows tooltip with participant names on hover
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
}) {
  const [isHovered, setIsHovered] = useState(false);
  const cellRef = useRef(null);

  // Don't render if below threshold
  if (hidden) {
    return (
      <div className="flex items-stretch">
        {showTimeLabel && (
          <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium">
            {timeLabel}
          </div>
        )}
        <div className="w-24 sm:w-28 h-12 sm:h-14 border border-line bg-surface-elevated opacity-30" />
      </div>
    );
  }

  const colorClasses = getIntensityColor(participantCount, preferredCount, totalMembers);

  return (
    <div className="flex items-stretch">
      {/* Time label on left edge */}
      {showTimeLabel && (
        <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium">
          {timeLabel}
        </div>
      )}

      {/* Heatmap cell */}
      <div
        ref={cellRef}
        className={`
          w-24 sm:w-28 h-12 sm:h-14 border
          ${colorClasses}
          cursor-pointer
          transition-colors duration-75
          flex items-center justify-center
          text-xs sm:text-sm font-medium
          ${participantCount > 0 ? 'text-content-primary' : 'text-content-muted'}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        role="gridcell"
        aria-label={`${timeLabel}: ${participantCount} of ${totalMembers} available`}
        tabIndex={0}
      >
        {/* Show participant count in cell */}
        {participantCount > 0 && (
          <span>{participantCount}</span>
        )}
      </div>

      {/* Tooltip */}
      <HeatmapTooltip
        participants={participants}
        isOpen={isHovered}
        referenceElement={cellRef.current}
      />
    </div>
  );
});

// Named export for flexibility
export { HeatmapCell, getIntensityColor };

// Default export
export default HeatmapCell;
