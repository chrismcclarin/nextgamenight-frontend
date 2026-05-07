'use client';

import { useEffect, useState } from 'react';
import HeatmapTooltip from './HeatmapTooltip';

/**
 * useHoverNone — true on devices that report `(hover: none)` (touch). Updates
 * live if the user toggles environments mid-session (e.g. Chrome devtools
 * mobile-emulation flip). Inlined here because the codebase doesn't have a
 * shared useMediaQuery hook yet and we need exactly one boolean.
 */
function useHoverNone() {
  const [isHoverNone, setIsHoverNone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(hover: none)');
    setIsHoverNone(mq.matches);
    const handler = (event) => setIsHoverNone(event.matches);
    // Modern browsers: addEventListener('change', ...). Older Safari falls
    // back to addListener — supported via a one-line guard.
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);
  return isHoverNone;
}

/**
 * Get Tailwind color classes based on availability ratio.
 * Green gradient: darker = more members available.
 */
function getCellStyle(availableCount, totalMembers) {
  if (totalMembers === 0 || availableCount === 0) return 'bg-surface-elevated text-content-muted';
  const ratio = availableCount / totalMembers;
  if (ratio <= 0.2) return 'bg-green-100 text-green-800';
  if (ratio <= 0.4) return 'bg-green-200 text-green-800';
  if (ratio <= 0.6) return 'bg-green-300 text-green-900';
  if (ratio <= 0.8) return 'bg-green-400 text-green-900';
  return 'bg-green-500 text-white';
}

/**
 * MergedHeatmapCell - Individual cell in the merged availability heatmap.
 *
 * Phase 72-02 (HUX-03): Wraps the cell in the shared HeatmapTooltip primitive
 * so the desktop tooltip and the mobile expand are symmetric — same content +
 * ordering, only chrome differs (`tone='mobile'` vs `tone='default'`). The
 * primitive owns hover/tap/focus/dismiss; this cell only owns selection state.
 *
 * `triggerRef` and `tabIndex` are forwarded from the parent MergedHeatmapGrid
 * for roving-tabindex arrow-key navigation.
 *
 * onSelect chaining: HeatmapTooltip's mergeProps helper chains the child's
 * onClick (handleClick — calls onSelect) with floating-ui's tap-to-toggle
 * onClick, so both fire on a single tap. We removed the separate "if mobile,
 * also toggle expand" branch because the primitive handles tooltip toggle.
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
 * @param {Function|Object} [props.triggerRef] - ref/callback exposing the cell
 *   trigger DOM element to the parent grid (roving-tabindex focus()).
 * @param {number} [props.tabIndex] - tabIndex for the cell (parent grid sets
 *   0 for the focused cell, -1 for the rest).
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
  triggerRef,
  tabIndex = -1,
}) {
  const isHoverNone = useHoverNone();
  const tone = isHoverNone ? 'mobile' : 'default';

  const colorClass = getCellStyle(availableCount, totalMembers);
  const selectionRing = isSelected ? 'ring-2 ring-accent' : '';

  const handleClick = () => {
    onSelect({ date, hour, dayOfWeek, availableCount, availableMembers });
  };

  // Same content + ordering on desktop and mobile (CONTEXT D: "same information
  // in same ordering"). Container chrome differs via the primitive's `tone`
  // prop. null content lets HeatmapTooltip's disabled pass-through path skip
  // wrapping for empty cells while still honoring triggerRef.
  const tooltipContent = availableCount > 0 ? (
    <div>{availableMembers.map((m) => m.username || m.user_id).join(', ')}</div>
  ) : null;

  return (
    <HeatmapTooltip
      content={tooltipContent}
      tone={tone}
      ariaLabel={`${date} ${hour}:00, ${availableCount} available`}
      triggerRef={triggerRef}
    >
      <div
        className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center cursor-pointer transition-shadow rounded-sm ${colorClass} ${selectionRing}`}
        onClick={handleClick}
        role="gridcell"
        tabIndex={tabIndex}
      >
        <span className="text-sm font-semibold leading-none">{availableCount}</span>
      </div>
    </HeatmapTooltip>
  );
}
