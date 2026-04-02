'use client';

import React, { useMemo } from 'react';
import { startOfWeek, addWeeks, subWeeks, addDays, differenceInWeeks, format } from 'date-fns';
import MergedHeatmapGrid from './MergedHeatmapGrid';

const LEGEND_ITEMS = [
  { label: '0', className: 'bg-surface-elevated' },
  { label: '', className: 'bg-green-100' },
  { label: '', className: 'bg-green-200' },
  { label: '', className: 'bg-green-300' },
  { label: '', className: 'bg-green-400' },
  { label: '', className: 'bg-green-500' },
];

/**
 * Format the week label. If months differ across the week, show both months.
 */
function formatWeekLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const startMonth = format(weekStart, 'MMM');
  const endMonth = format(weekEnd, 'MMM');
  if (startMonth === endMonth) {
    return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd')}`;
  }
  return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d')}`;
}

/**
 * Format a selected slot for display, e.g. "Mon 7-8 PM"
 */
function formatSlotLabel(slot) {
  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayName = dayNames[slot.dayOfWeek] || '';
  const startHour = slot.hour;
  const endHour = slot.hour + 1;

  function fmtHour(h) {
    if (h === 12) return '12 PM';
    if (h > 12 && h < 24) return `${h - 12} PM`;
    if (h === 24) return '12 AM';
    return `${h} AM`;
  }

  return `${dayName} ${fmtHour(startHour)}-${fmtHour(endHour)}`;
}

/**
 * MergedHeatmap - Main container with week navigation, grid, legend,
 * no-data notice, loading/error states, and slot selection CTA.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object|null} props.heatmapData - Full API response with slots, meta
 * @param {boolean} props.loading - Whether data is loading
 * @param {string|null} props.error - Error message
 * @param {Date} props.selectedWeek - Currently selected Monday date
 * @param {function} props.onWeekChange - Callback when week changes
 * @param {Object|null} props.selectedSlot - Currently selected slot
 * @param {function} props.onSlotSelect - Callback when slot is selected
 */
export default function MergedHeatmap({
  groupId,
  heatmapData,
  loading,
  error,
  selectedWeek,
  onWeekChange,
  selectedSlot,
  onSlotSelect,
}) {
  const currentMonday = useMemo(
    () => startOfWeek(new Date(), { weekStartsOn: 1 }),
    []
  );

  const canGoBack = differenceInWeeks(selectedWeek, subWeeks(currentMonday, 2)) > 0;
  const canGoForward = differenceInWeeks(addWeeks(currentMonday, 4), selectedWeek) > 0;

  const handlePrevWeek = () => {
    if (canGoBack) onWeekChange(subWeeks(selectedWeek, 1));
  };

  const handleNextWeek = () => {
    if (canGoForward) onWeekChange(addWeeks(selectedWeek, 1));
  };

  const membersWithoutData = heatmapData?.membersWithoutData || [];

  return (
    <div>
      {/* Week navigation bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handlePrevWeek}
          disabled={!canGoBack}
          className="px-3 py-2 rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary font-medium"
          aria-label="Previous week"
        >
          &lt;
        </button>
        <span className="text-lg font-semibold text-content-primary">
          {formatWeekLabel(selectedWeek)}
        </span>
        <button
          onClick={handleNextWeek}
          disabled={!canGoForward}
          className="px-3 py-2 rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary font-medium"
          aria-label="Next week"
        >
          &gt;
        </button>
      </div>

      {/* Members without data notice */}
      {membersWithoutData.length > 0 && !loading && (
        <div className="bg-accent/10 border border-accent/30 rounded-card p-3 text-sm text-content-secondary mb-4 flex items-start gap-2">
          <svg
            className="w-4 h-4 mt-0.5 flex-shrink-0 text-accent"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <span className="font-medium">
              {membersWithoutData.length} member{membersWithoutData.length !== 1 ? 's have' : ' has'} no availability schedule set up:
            </span>{' '}
            {membersWithoutData.map((m) => m.username || m.user_id).join(', ')}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-8 gap-px bg-line rounded-lg overflow-hidden">
          {/* Skeleton header row */}
          <div className="bg-surface-card p-2 h-12" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`skel-h-${i}`} className="bg-surface-card p-2 h-12">
              <div className="h-4 w-8 mx-auto bg-surface-elevated rounded animate-pulse mb-1" />
              <div className="h-4 w-6 mx-auto bg-surface-elevated rounded animate-pulse" />
            </div>
          ))}
          {/* Skeleton body rows */}
          {Array.from({ length: 11 }).map((_, row) => (
            <React.Fragment key={`skel-row-${row}`}>
              <div className="bg-surface-card p-2 h-12">
                <div className="h-4 w-10 ml-auto bg-surface-elevated rounded animate-pulse" />
              </div>
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`skel-${row}-${col}`} className="bg-white p-1">
                  <div className="h-[44px] w-full bg-surface-page rounded animate-pulse" />
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="text-center text-status-error py-8 font-medium">{error}</div>
      )}

      {/* Grid */}
      {!loading && !error && heatmapData && (
        <MergedHeatmapGrid
          slots={heatmapData.slots || []}
          totalMembers={heatmapData.totalMembers || 0}
          selectedSlot={selectedSlot}
          onSlotSelect={onSlotSelect}
        />
      )}

      {/* Legend */}
      {!loading && !error && (
        <div className="flex items-center justify-center gap-1 mt-4 text-xs text-content-secondary">
          <span className="mr-1">Less available</span>
          {LEGEND_ITEMS.map((item, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-sm ${item.className}`}
              title={item.label || undefined}
            />
          ))}
          <span className="ml-1">More available</span>
        </div>
      )}

      {/* Selected slot CTA */}
      {selectedSlot && (
        <div className="bg-accent/10 border border-accent/30 rounded-card p-3 text-content-primary font-medium mt-4 flex items-center justify-between">
          <span>Plan Session at {formatSlotLabel(selectedSlot)}</span>
          <button
            onClick={() => onSlotSelect(selectedSlot)}
            className="text-accent hover:text-accent ml-3 text-lg leading-none"
            aria-label="Deselect slot"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
