'use client';

import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import MergedHeatmapCell from './MergedHeatmapCell';

/**
 * PollHeatmap — POLL-01 running aggregate (D-POLL-CREATE-11).
 *
 * Reuses MergedHeatmapCell's green-gradient visual tokens (bg-availability-X
 * via getCellStyle ratio coloring) so the poll heatmap matches the
 * recurring-schedule heatmap shipped in Phase 52/63. Distinct grid layout:
 *   - MergedHeatmapGrid is hardcoded to 7 days (grid-cols-8) — fine for the
 *     recurring-schedule heatmap which is always a Monday-Sunday week.
 *   - Polls have variable date_window length (1-14 days per D-POLL-CREATE-09),
 *     so this component uses inline gridTemplateColumns to size to the poll's
 *     actual window length.
 *
 * Slot granularity mapping: PollResponse.slot_data is at 30-min granularity
 * (matches AvailabilityGrid's grid). MergedHeatmapCell renders 1-hour cells.
 * A member who's available at EITHER :00 or :30 of an hour counts as available
 * for that hour. This is the correct aggregation for "find a session start
 * time" — a member with 5:30pm-7pm availability shows green at 5pm and 6pm.
 *
 * @param {Object} poll - Poll record with .date_window_start, .date_window_end,
 *   and .PollResponses (array of { user_id, slot_data })
 * @param {number} activeMemberCount - Total active members in the group
 *   (denominator for the green-gradient ratio)
 */
// Hours rendered match AvailabilityGrid's slot range (5pm-10:30pm). The grid
// generates 30-min slots but we aggregate to hours here so each member is
// counted at most once per hour even if they marked both :00 and :30.
const HEATMAP_HOURS = [17, 18, 19, 20, 21, 22];

function formatHourLabel(hour) {
  if (hour === 12) return '12 PM';
  if (hour === 0) return '12 AM';
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

function buildDateRange(dateWindowStart, dateWindowEnd) {
  if (!dateWindowStart || !dateWindowEnd) return [];
  const start = new Date(`${dateWindowStart}T00:00:00`);
  const end = new Date(`${dateWindowEnd}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const dates = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const yyyy = cursor.getFullYear();
    const mm = String(cursor.getMonth() + 1).padStart(2, '0');
    const dd = String(cursor.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export default function PollHeatmap({ poll, activeMemberCount = 0 }) {
  const dates = useMemo(
    () => buildDateRange(poll?.date_window_start, poll?.date_window_end),
    [poll?.date_window_start, poll?.date_window_end]
  );

  // Aggregate slot_data into a Map<`${date}|${hour}`, Set<user_id>> so each
  // member is counted at most once per hour even if they marked both :00
  // and :30 within that hour.
  const tally = useMemo(() => {
    const map = new Map();
    if (!poll?.PollResponses) return map;
    for (const response of poll.PollResponses) {
      if (!response.slot_data || !Array.isArray(response.slot_data)) continue;
      for (const s of response.slot_data) {
        if (!s || !s.available || !s.slot) continue;
        // s.slot is an ISO datetime — bucket to the hour in local time so
        // the visual matches what the user picked in their AvailabilityGrid.
        const startDate = new Date(s.slot);
        if (Number.isNaN(startDate.getTime())) continue;
        const hour = startDate.getHours();
        // Use the local-date string from the user's submission directly
        // (s.date is "YYYY-MM-DD" set by PollResponseForm at submit time).
        const key = `${s.date}|${hour}`;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(response.user_id);
      }
    }
    return map;
  }, [poll]);

  if (dates.length === 0) {
    return (
      <p className="text-sm text-content-muted">
        Poll date window is missing — cannot render heatmap.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid gap-px bg-line rounded-lg overflow-hidden min-w-max"
        style={{
          gridTemplateColumns: `auto repeat(${dates.length}, minmax(56px, 1fr))`,
        }}
      >
        {/* Header row: empty corner + N day headers */}
        <div className="bg-surface-card p-2" />
        {dates.map((dateStr) => {
          const dateObj = parseISO(`${dateStr}T00:00:00`);
          return (
            <div key={dateStr} className="bg-surface-card p-2 text-center">
              <div className="text-xs font-semibold text-content-secondary">
                {format(dateObj, 'EEE')}
              </div>
              <div className="text-sm font-bold text-content-primary">
                {format(dateObj, 'M/d')}
              </div>
            </div>
          );
        })}

        {/* Body rows */}
        {HEATMAP_HOURS.map((hour) => (
          <React.Fragment key={`hour-${hour}`}>
            <div className="bg-surface-card p-2 flex items-center justify-end">
              <span className="text-xs text-content-muted font-medium whitespace-nowrap">
                {formatHourLabel(hour)}
              </span>
            </div>
            {dates.map((dateStr) => {
              const userSet = tally.get(`${dateStr}|${hour}`);
              const availableCount = userSet ? userSet.size : 0;
              return (
                <div key={`${dateStr}-${hour}`} className="bg-surface-card">
                  <MergedHeatmapCell
                    hour={hour}
                    date={dateStr}
                    dayOfWeek={0}
                    availableCount={availableCount}
                    totalMembers={activeMemberCount}
                    availableMembers={[]}
                    isSelected={false}
                    onSelect={() => { /* poll heatmap is read-only */ }}
                  />
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
