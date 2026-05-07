'use client';

import { useTimezone } from '../components/TimezoneProvider';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import HeatmapTooltip from './HeatmapTooltip';

/**
 * EventHeatmapBackground - Visual heatmap grid for group availability.
 * Shows merged availability as a color-coded grid (green = more available).
 *
 * Phase 72-02 (HUX-01): Replaced hover-only `title=` attributes with the shared
 * `HeatmapTooltip` primitive (touch-reachable + keyboard-accessible). Each cell
 * exposes availability count + responder names, and — when the *current viewer*
 * has a Google Calendar conflict for that slot — an additional "You have a
 * Google Calendar conflict at this time" line.
 *
 * Keyboard scope: Tab+focus+Esc only on this surface. Arrow-key roving-tabindex
 * is intentionally NOT provided here — see Plan 72-02 truths block. This is a
 * passive availability summary, not a primary input grid; arrow-key cell
 * navigation is provided on HeatmapGrid + MergedHeatmapGrid (the input grids).
 *
 * Drag-select coexistence: EventHeatmapBackground has no internal drag-select
 * gesture; the long-press-drag-to-select gesture from Phase 68 MOB-07 lives in
 * EventScheduler.js (a sibling in createEvent.js's visual-calendar mode). Tap-
 * to-reveal-tooltip here does not interfere.
 *
 * @param {Object} props
 * @param {Object|null} props.heatmapData - Full API response from getGroupHeatmap
 * @param {boolean} props.loading - Whether data is still being fetched
 * @param {string|null} [props.anchorDate] - Optional YYYY-MM-DD that the
 *   rendered week should contain. The component snaps it to Monday and
 *   renders that week. Used by the prompt-restricted heatmap (Phase 71.2)
 *   so a poll's slots show up even when they're not in the current week.
 *   Defaults to today.
 */
export default function EventHeatmapBackground({ heatmapData, loading, anchorDate = null }) {
  const { timezone } = useTimezone();
  const { user } = Auth();
  const currentUserSub = user?.sub || null;
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
          {/* Grid skeleton rows — Phase 66-01: 28 rows (14 hours × 2 half-hour slots)
              to match EventScheduler's step={30} density. */}
          {Array.from({ length: 28 }).map((_, row) => (
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

  const { slots, totalMembers, gcalConflicts = [], membersWithoutDataCount = 0, totalGroupMembers = 0 } = heatmapData;

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

  // Get 7 dates starting from Monday of the anchor week in the viewer's timezone.
  // anchorDate is YYYY-MM-DD; if absent, fall back to today in viewer-tz.
  let anchorY, anchorM, anchorD;
  if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    [anchorY, anchorM, anchorD] = anchorDate.split('-').map(Number);
  } else {
    const now = new Date();
    const nowDateStr = toTzDateStr(now);
    [anchorY, anchorM, anchorD] = nowDateStr.split('-').map(Number);
  }
  const anchorLocal = new Date(anchorY, anchorM - 1, anchorD);
  const mondayOffset = (anchorLocal.getDay() + 6) % 7; // days since Monday
  const monday = new Date(anchorY, anchorM - 1, anchorD - mondayOffset);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Phase 66-01: subdivide to 30-min rows so density matches EventScheduler's
  // step={30}. Each entry is { hour, minute, showLabel }. Backend data is
  // hourly, so both half-hour cells in a given hour share the same hourly
  // slot lookup (and therefore the same green tint).
  const slots30 = [];
  for (let h = 10; h <= 23; h++) {
    slots30.push({ hour: h, minute: 0, showLabel: true });
    slots30.push({ hour: h, minute: 30, showLabel: false });
  }

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

  // Build conflict lookup keyed by "tzDateStr_tzHour"
  const conflictMap = new Map();
  for (const c of gcalConflicts) {
    const utcDate = new Date(`${c.date}T${String(c.hour).padStart(2, '0')}:00:00Z`);
    const tzDateStr = toTzDateStr(utcDate);
    const tzHour = toTzHour(utcDate);
    const key = `${tzDateStr}_${tzHour}`;
    if (!conflictMap.has(key)) conflictMap.set(key, []);
    conflictMap.get(key).push({ user_id: c.user_id, username: c.username });
  }

  // Build per-cell tooltip JSX (Phase 72-02 HUX-01).
  // Backend gcalConflicts shape: { user_id, username, date, hour } — no event
  // title; the current-user conflict line is intentionally generic.
  // Returns null when nothing relevant to show, so HeatmapTooltip's
  // disabled-on-falsy-content path skips the wrapper for empty cells.
  function renderTooltipContent(slot, dateKey) {
    const hasAvailability = slot && slot.availableCount > 0;
    const conflicts = conflictMap.get(dateKey) || [];
    const userHasConflict = currentUserSub
      ? conflicts.some(c => c.user_id === currentUserSub)
      : false;
    const otherConflicts = conflicts.filter(c => c.user_id !== currentUserSub);

    if (!hasAvailability && !userHasConflict && otherConflicts.length === 0) {
      return null;
    }

    const names = hasAvailability
      ? (slot.availableMembers || []).map(m => m.username).join(', ')
      : '';

    return (
      <div>
        {hasAvailability && (
          <div>
            {slot.availableCount} of {totalMembers} available{names ? ` — ${names}` : ''}
          </div>
        )}
        {userHasConflict && (
          <div className="text-amber-700 mt-1">
            You have a Google Calendar conflict at this time
          </div>
        )}
        {otherConflicts.map(c => (
          <div key={c.user_id} className="text-amber-700 text-xs mt-1">
            {c.username}: said yes, calendar shows busy
          </div>
        ))}
      </div>
    );
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

        {/* Hour rows — Phase 66-01: 28 rows at 30-min density. Hour labels
            render only on the :00 row; the :30 row leaves the label column
            empty so the grid stays aligned without visual clutter. Both
            half-hour cells of a given hour share the same hourly slot data
            (backend tracks availability hourly, so both halves render with
            the same green tint and count badge). */}
        {slots30.map(s => (
          <div key={`${s.hour}-${s.minute}`} className="contents">
            {/* Hour label (only on the :00 row) */}
            {s.showLabel ? (
              <div className="flex items-center justify-end pr-1">
                <span className="text-[10px] text-content-muted font-mono">{formatHour(s.hour)}</span>
              </div>
            ) : (
              <div />
            )}
            {/* Day cells — keyed off the hourly slot, since backend data is
                hourly. Both half-hour cells (:00 and :30) wrap with the same
                tooltip content because the backend tracks availability hourly.
                The hover-only `title` attribute was removed in Plan 72-02 in
                favor of the shared HeatmapTooltip primitive. */}
            {dates.map(date => {
              const dateKey = `${date}_${s.hour}`;
              const slot = slotMap.get(dateKey);
              const count = slot?.availableCount || 0;
              const bg = getCellBg(count, totalMembers);
              const tooltipContent = renderTooltipContent(slot, dateKey);
              return (
                <HeatmapTooltip
                  key={`${date}_${s.hour}_${s.minute}`}
                  content={tooltipContent}
                  placement="top"
                  ariaLabel={`Availability for ${date} hour ${s.hour}`}
                >
                  {/* Plan 72-02 UAT hotfix: bumped minHeight from 18px to 28px
                      so the entire cell is a comfortable hover/tap target —
                      previously only the centered count badge had a meaningful
                      hit area. Badge text bumped from text-[9px] to text-[11px]
                      so the number stays readable inside the larger cell. */}
                  <div
                    className={`${bg} rounded-sm flex items-center justify-center cursor-default`}
                    style={{ minHeight: '28px' }}
                    role="gridcell"
                  >
                    {/* Show count badge once per hour (on the :00 row) so the
                        number doesn't visually duplicate. */}
                    {count > 0 && s.minute === 0 && (
                      <span className="text-[11px] text-content-secondary font-medium">{count}</span>
                    )}
                  </div>
                </HeatmapTooltip>
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
        {/* Plan 72-02: dropped the "(hover for names)" hint — interaction is no
            longer hover-only (touch + keyboard now reach the tooltip via the
            shared HeatmapTooltip primitive). Keeping the legend clean instead
            of hint-y. */}
      </div>

      {membersWithoutDataCount > 0 && (
        <p className="text-[10px] text-content-muted text-center mt-1">
          {membersWithoutDataCount} of {totalGroupMembers} members haven't shared availability yet
        </p>
      )}

      {totalMembers === 0 && totalGroupMembers > 0 && (
        <div className="text-center mt-3 px-2">
          <p className="text-xs font-medium text-content-secondary mb-1">
            No availability shared yet
          </p>
          <p className="text-[11px] text-content-muted">
            Invite members or set a schedule to see availability here.
          </p>
        </div>
      )}

      {/* gcal conflict warning */}
      {conflictNames.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 px-2 py-1 mt-2">
          Heads up: {conflictNames.join(' and ')} may have Google Calendar conflicts
        </div>
      )}
    </div>
  );
}
