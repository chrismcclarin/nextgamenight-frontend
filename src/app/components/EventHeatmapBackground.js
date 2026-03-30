'use client';

/**
 * EventHeatmapBackground - Visual-only heatmap grid rendered behind the Create Event form.
 * Shows merged group availability as a color-coded grid (green = more available).
 * Purely decorative -- no click handlers or selection.
 *
 * @param {Object} props
 * @param {Object|null} props.heatmapData - Full API response from getGroupHeatmap
 * @param {boolean} props.loading - Whether data is still being fetched
 */
export default function EventHeatmapBackground({ heatmapData, loading }) {
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
            <div key={`hdr-${i}`} className="h-6 bg-gray-200 rounded animate-pulse" />
          ))}
          {/* Grid skeleton rows */}
          {Array.from({ length: 13 }).map((_, row) => (
            <div key={`row-${row}`} className="contents">
              <div className="h-5 w-8 bg-gray-200 rounded animate-pulse" />
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`cell-${row}-${col}`} className="h-5 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { slots, totalMembers, gcalConflicts = [] } = heatmapData;

  // Build a lookup: "date_hour" -> slot
  const slotMap = new Map();
  for (const slot of slots) {
    slotMap.set(`${slot.date}_${slot.hour}`, slot);
  }

  // Get unique dates (columns) in order
  const dates = [...new Set(slots.map(s => s.date))].sort();
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Hours 10-22 (rows)
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
    if (total === 0 || availableCount === 0) return 'bg-gray-100';
    const ratio = availableCount / total;
    if (ratio <= 0.2) return 'bg-green-100';
    if (ratio <= 0.4) return 'bg-green-200';
    if (ratio <= 0.6) return 'bg-green-300';
    if (ratio <= 0.8) return 'bg-green-400';
    return 'bg-green-500';
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
              <span className="text-xs font-medium text-gray-500 block leading-tight">
                {dayLabels[i]}
              </span>
              <span className="text-[10px] text-gray-400">{dayNum}</span>
            </div>
          );
        })}

        {/* Hour rows */}
        {hours.map(hour => (
          <div key={hour} className="contents">
            {/* Hour label */}
            <div className="flex items-center justify-end pr-1">
              <span className="text-[10px] text-gray-400 font-mono">{formatHour(hour)}</span>
            </div>
            {/* Day cells */}
            {dates.map(date => {
              const slot = slotMap.get(`${date}_${hour}`);
              const count = slot?.availableCount || 0;
              const bg = getCellBg(count, totalMembers);
              return (
                <div
                  key={`${date}_${hour}`}
                  className={`${bg} rounded-sm flex items-center justify-center`}
                  style={{ minHeight: '18px' }}
                >
                  {count > 0 && (
                    <span className="text-[9px] text-gray-600 font-medium">{count}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend strip */}
      <div className="flex items-center justify-center gap-1 mt-2">
        <span className="text-[9px] text-gray-400">Less</span>
        <div className="w-3 h-3 bg-gray-100 rounded-sm" />
        <div className="w-3 h-3 bg-green-100 rounded-sm" />
        <div className="w-3 h-3 bg-green-200 rounded-sm" />
        <div className="w-3 h-3 bg-green-300 rounded-sm" />
        <div className="w-3 h-3 bg-green-400 rounded-sm" />
        <div className="w-3 h-3 bg-green-500 rounded-sm" />
        <span className="text-[9px] text-gray-400">More available</span>
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
