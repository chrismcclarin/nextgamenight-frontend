'use client';

import { useState, useRef, useEffect } from 'react';
import MergedHeatmapTooltip from './MergedHeatmapTooltip';

/**
 * Get Tailwind color classes based on availability ratio.
 * Green gradient: darker = more members available.
 */
function getCellStyle(availableCount, totalMembers) {
  if (totalMembers === 0 || availableCount === 0) return 'bg-gray-100 text-gray-400';
  const ratio = availableCount / totalMembers;
  if (ratio <= 0.2) return 'bg-green-100 text-green-800';
  if (ratio <= 0.4) return 'bg-green-200 text-green-800';
  if (ratio <= 0.6) return 'bg-green-300 text-green-900';
  if (ratio <= 0.8) return 'bg-green-400 text-green-900';
  return 'bg-green-500 text-white';
}

/**
 * MergedHeatmapCell - Individual cell in the availability heatmap grid.
 * Shows green gradient + numeric count. Desktop hover = tooltip with names.
 * Mobile tap = inline expand with names. Click selects slot with blue ring.
 *
 * @param {Object} props
 * @param {number} props.hour - Hour (12-22)
 * @param {string} props.date - ISO date string
 * @param {number} props.dayOfWeek - ISO day (1=Mon, 7=Sun)
 * @param {number} props.availableCount - Number of available members
 * @param {number} props.totalMembers - Total group members
 * @param {Array} props.availableMembers - Array of { user_id, username }
 * @param {boolean} props.isSelected - Whether this cell is currently selected
 * @param {function} props.onSelect - Callback when cell is clicked
 */
export default function MergedHeatmapCell({
  hour,
  date,
  dayOfWeek,
  availableCount,
  totalMembers,
  availableMembers = [],
  isSelected,
  onSelect,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const cellRef = useRef(null);

  useEffect(() => {
    // Detect touch device on mount
    const touchCheck =
      'ontouchstart' in window || window.matchMedia('(hover: none)').matches;
    setIsTouchDevice(touchCheck);
  }, []);

  const colorClass = getCellStyle(availableCount, totalMembers);
  const selectionRing = isSelected ? 'ring-2 ring-blue-500' : '';

  const handleClick = () => {
    onSelect({ date, hour, dayOfWeek, availableCount, availableMembers });

    // On mobile, toggle inline expand for member names
    if (isTouchDevice && availableCount > 0) {
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <div className="relative">
      <div
        ref={cellRef}
        className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center cursor-pointer transition-shadow rounded-sm ${colorClass} ${selectionRing}`}
        onClick={handleClick}
        onMouseEnter={() => !isTouchDevice && setIsHovered(true)}
        onMouseLeave={() => !isTouchDevice && setIsHovered(false)}
      >
        <span className="text-sm font-semibold leading-none">{availableCount}</span>
      </div>

      {/* Mobile: inline expand showing member names below the count */}
      {isTouchDevice && isExpanded && availableMembers.length > 0 && (
        <div className="text-xs text-gray-700 px-1 py-0.5 leading-tight">
          {availableMembers.map((m) => m.username || m.user_id).join(', ')}
        </div>
      )}

      {/* Desktop: floating tooltip on hover */}
      {!isTouchDevice && (
        <MergedHeatmapTooltip
          members={availableMembers}
          isOpen={isHovered && availableCount > 0}
          referenceElement={cellRef.current}
        />
      )}
    </div>
  );
}
