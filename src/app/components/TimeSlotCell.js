'use client';

import React, { memo } from 'react';

/**
 * TimeSlotCell - Individual time slot in the availability grid
 * Memoized to prevent re-renders during drag operations
 *
 * @param {Object} props
 * @param {string} props.slotId - Unique identifier (ISO8601 UTC string)
 * @param {string|null} props.preference - null | 'preferred' | 'if-need-be'
 * @param {string} props.timeLabel - Formatted time (e.g., "5:00 PM")
 * @param {boolean} props.showTimeLabel - Show time label on left edge
 * @param {function} props.onPointerDown - Handler for pointer down
 * @param {function} props.onPointerEnter - Handler for pointer enter (drag)
 * @param {boolean} props.disabled - Disable interactions
 */
const TimeSlotCell = memo(function TimeSlotCell({
  slotId,
  preference,
  timeLabel,
  showTimeLabel,
  onPointerDown,
  onPointerEnter,
  disabled,
}) {
  // Determine background color based on preference
  const getBackgroundColor = () => {
    if (disabled) return 'bg-gray-200';
    if (preference === 'preferred') return 'bg-green-300';
    if (preference === 'if-need-be') return 'bg-yellow-300';
    return 'bg-gray-100 hover:bg-gray-200';
  };

  // Handle pointer down event
  const handlePointerDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    onPointerDown?.(slotId);
  };

  // Handle pointer enter event (during drag)
  const handlePointerEnter = (e) => {
    if (disabled) return;
    onPointerEnter?.(slotId);
  };

  return (
    <div className="flex items-stretch">
      {/* Time label on left edge */}
      {showTimeLabel && (
        <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-gray-600 font-medium">
          {timeLabel}
        </div>
      )}

      {/* Time slot cell */}
      <div
        className={`
          w-full h-12 sm:h-14 border border-gray-300
          ${getBackgroundColor()}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          transition-colors duration-75
        `}
        style={{
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        role="button"
        aria-label={`${timeLabel} - ${preference || 'not selected'}`}
        aria-pressed={!!preference}
        tabIndex={disabled ? -1 : 0}
      />
    </div>
  );
});

// Named export for flexibility
export { TimeSlotCell };

// Default export
export default TimeSlotCell;
