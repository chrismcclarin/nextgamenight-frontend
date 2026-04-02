'use client';

import { useTimezone } from '../components/TimezoneProvider';

/**
 * EventHeatmapBackground - Visual heatmap grid for group availability.
 * Shows merged availability as a color-coded grid (green = more available).
 * Hover over cells to see who is available.
 *
 * @param {Object} props
 * @param {Object|null} props.heatmapData - Full API response from getGroupHeatmap
 * @param {boolean} props.loading - Whether data is still being fetched
 */
export default function EventHeatmapBackground({ heatmapData, loading }) {
  const { timezone } = useTimezone();
  // No-data state: render nothing
  if (!heatmapData && !loading) return null;

  // Loading skeleton
  if (loading) {
    return (
      <div className="select-none">
        <div className="grid gap-px" style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}>
          {/* Header row skeleton */}
          <div />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`hdr-${i}`} className="h-6 bg-surface-elevated rounded animate-pulse" />
          ))}
          {/* Grid skeleton rows */}
          {Array.from({ length: 13 }).map((_, row) => (
            <div key={`row-${row}`} className="contents">
              <div className="h-5 w-8 bg-surface-elevated rounded animate-pulse" />
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`cell-${row}-${col}`} className="h-5 bg-surface-page rounded animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { slots, totalMembers, gcalConflicts = [] } = heatmapData;

  // Helper: format Date to "YYYY-MM-DD" in the viewer's timezone
  function toTzDateStr(d) {
    if (timezone) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(d);
      const get = (type) => parts.find(p => p.type === type)?.value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Helper: get hour in the viewer's timezone
  function toTzHour(d) {
    if (timezone) {
      return parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour: 'numeric', hour12: false,
      }).format(d), 10);
    }
    return d.getHours();
  }

  // Build a lookup keyed by viewer-timezone date and hour (backend returns UTC dates/hours)
  const slotMap = new Map();
  for (const slot of slots) {
    const utcDate = new Date(`${slot.date}T${String(slot.hour).padStart(2, '0')}:00:00Z`);
    const tzDateStr = toTzDateStr(utcDate);
    const tzHour = toTzHour(utcDate);
    slotMap.set(`${tzDateStr}_${tzHour}`, slot);
  }

  // Get 7 dates starting from Monday of the current week in the viewer's timezone
  const now = new Date();
  const nowDateStr = toTzDateStr(now);
  const [ny, nm, nd] = nowDateStr.split('-').map(Number);
  const nowLocal = new Date(ny, nm - 1, nd);
  const mondayOffset = (nowLocal.getDay() + 6) % 7; // days since Monday
  const monday = new Date(ny, nm - 1, nd - mondayOffset);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Hours 10-22 in viewer's timezone (matching display range)
  const hours = [];
  for (let h = 10; h <= 22; h++) hours.push(h);

  // Format hour label compactly
  function formatHour(h) {
    if (h === 0 || h === 12) return '12p';
    if (h < 12) return `${h}a`;
    return `${h - 12}p`;
  }

  // Color gradient based on availability ratio
  function getCellBg(availableCount, total) {
    if (total === 0 || availableCount === 0) return 'bg-surface-elevated';
    const ratio = availableCount / total;
    if (ratio <= 0.2) return 'bg-green-100';
    if (ratio <= 0.4) return 'bg-green-200';
    if (ratio <= 0.6) return 'bg-green-300';
    if (ratio <= 0.8) return 'bg-green-400';
    return 'bg-green-500';
  }

  // Build hover tooltip text
  function getTooltip(slot) {
    if (!slot || slot.availableCount === 0) return '';
    const names = (slot.availableMembers || []).map(m => m.username).join(', ');
    return `${slot.availableCount}/${totalMembers} available: ${names}`;
  }

  // Group gcal conflicts by username for the warning
  const conflictNames = [...new Set(gcalConflicts.map(c => c.username))];

  return (
    <div className="select-none">
      {/* Grid */}
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}
      >
        {/* Header row: day labels with date numbers */}
        <div />
        {dates.map((date, i) => {
          const dayNum = parseInt(date.split('-')[2], 10);
          return (
            <div key={date} className="text-center">
              <span className="text-xs font-medium text-content-muted block leading-tight">
                {dayLabels[i]}
              </span>
              <span className="text-[10px] text-content-muted">{dayNum}</span>
            </div>
          );
        })}

        {/* Hour rows */}
        {hours.map(hour => (
          <div key={hour} className="contents">
            {/* Hour label */}
            <div className="flex items-center justify-end pr-1">
              <span className="text-[10px] text-content-muted font-mono">{formatHour(hour)}</span>
            </div>
            {/* Day cells */}
            {dates.map(date => {
              const slot = slotMap.get(`${date}_${hour}`);
              const count = slot?.availableCount || 0;
              const bg = getCellBg(count, totalMembers);
              const tip = getTooltip(slot);
              return (
                <div
                  key={`${date}_${hour}`}
                  title={tip}
                  className={`${bg} rounded-sm flex items-center justify-center cursor-default`}
                  style={{ minHeight: '18px' }}
                >
                  {count > 0 && (
                    <span className="text-[9px] text-content-secondary font-medium">{count}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend strip */}
      <div className="flex items-center justify-center gap-1 mt-2">
        <span className="text-[9px] text-content-muted">Less</span>
        <div className="w-3 h-3 bg-surface-elevated rounded-sm" />
        <div className="w-3 h-3 bg-green-100 rounded-sm" />
        <div className="w-3 h-3 bg-green-200 rounded-sm" />
        <div className="w-3 h-3 bg-green-300 rounded-sm" />
        <div className="w-3 h-3 bg-green-400 rounded-sm" />
        <div className="w-3 h-3 bg-green-500 rounded-sm" />
        <span className="text-[9px] text-content-muted">More available</span>
        <span className="text-[9px] text-content-muted ml-1">(hover for names)</span>
      </div>

      {/* gcal conflict warning */}
      {conflictNames.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 px-2 py-1 mt-2">
          Heads up: {conflictNames.join(' and ')} may have Google Calendar conflicts
        </div>
      )}
    </div>
  );
}
