'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { useTimezone } from '../components/TimezoneProvider';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import ReadCell from './heatmap/ReadCell';
import { slotCellName } from './heatmap/slotCellName';
import { SPOKEN_DAY_NAME_FORMAT } from './SchedulerWeekStrip';

// The grid's screen-reader name (owner ruling #178, 2026-10-13, option A). Screen-reader only.
const HEATMAP_GRID_LABEL = 'Group availability';

// Phase 66-01: subdivide to 30-min rows so density matches EventScheduler's
// step={30}. Each entry is { hour, minute, showLabel }. Backend data is
// hourly, so both half-hour cells in a given hour share the same hourly
// slot lookup (and therefore the same green tint). Static, so it lives at
// module scope (plan 88.6.1-24): the names memo below reads it without a dependency.
const slots30 = [];
for (let h = 10; h <= 23; h++) {
  slots30.push({ hour: h, minute: 0, showLabel: true });
  slots30.push({ hour: h, minute: 30, showLabel: false });
}

// Helper: format Date to "YYYY-MM-DD" in the viewer's timezone
function toTzDateStr(d, timezone) {
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
function toTzHour(d, timezone) {
  if (timezone) {
    return parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: 'numeric', hour12: false,
    }).format(d), 10);
  }
  return d.getHours();
}

/**
 * Plan 88.6.1-24 (review #137): the ONE derivation of the rendered week - the slot and conflict
 * lookups, the seven column dates and every cell's screen-reader name - run inside a single
 * `useMemo` keyed on [heatmapData, anchorDate, timezone]. The header, the lookup and the names
 * all read THIS result, so they can never describe two different weeks: with no `anchorDate` the
 * week comes from today, and a second copy computed per render would move to the next week after
 * Sunday midnight while memoized names stayed on the old one. No data yields an empty table.
 */
function deriveWeek(heatmapData, anchorDate, timezone) {
  if (!heatmapData) return { slotMap: new Map(), conflictMap: new Map(), dates: [], dayNames: [], names: [] };
  const { slots, totalMembers, gcalConflicts = [] } = heatmapData;

  // Build a lookup keyed by viewer-timezone date and hour (backend returns UTC dates/hours)
  const slotMap = new Map();
  for (const slot of slots) {
    const utcDate = new Date(`${slot.date}T${String(slot.hour).padStart(2, '0')}:00:00Z`);
    const tzDateStr = toTzDateStr(utcDate, timezone);
    const tzHour = toTzHour(utcDate, timezone);
    slotMap.set(`${tzDateStr}_${tzHour}`, slot);
  }

  // Get 7 dates starting from Monday of the anchor week in the viewer's timezone.
  // anchorDate is YYYY-MM-DD; if absent, fall back to today in viewer-tz.
  let anchorY, anchorM, anchorD;
  if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    [anchorY, anchorM, anchorD] = anchorDate.split('-').map(Number);
  } else {
    const now = new Date();
    const nowDateStr = toTzDateStr(now, timezone);
    [anchorY, anchorM, anchorD] = nowDateStr.split('-').map(Number);
  }
  const anchorLocal = new Date(anchorY, anchorM - 1, anchorD);
  const mondayOffset = (anchorLocal.getDay() + 6) % 7; // days since Monday
  const monday = new Date(anchorY, anchorM - 1, anchorD - mondayOffset);

  const dates = [];
  // Each column header's spoken name ("Monday 29", "Wednesday 1"), from the SAME local `Date` whose
  // day number the header prints (88.6.1-85 Task 2).
  const dayNames = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    dayNames.push(format(d, SPOKEN_DAY_NAME_FORMAT));
  }

  // Build conflict lookup keyed by "tzDateStr_tzHour"
  const conflictMap = new Map();
  for (const c of gcalConflicts) {
    const utcDate = new Date(`${c.date}T${String(c.hour).padStart(2, '0')}:00:00Z`);
    const tzDateStr = toTzDateStr(utcDate, timezone);
    const tzHour = toTzHour(utcDate, timezone);
    const key = `${tzDateStr}_${tzHour}`;
    if (!conflictMap.has(key)) conflictMap.set(key, []);
    conflictMap.get(key).push({ user_id: c.user_id, username: c.username });
  }

  // names[row][col]: the cell's wall clock is the column's OWN date string plus the row's hour and
  // minute - the values its header day number and hour label print - never the UTC wire slot (that
  // conversion already happened above, keyed on the viewer's profile zone).
  const names = slots30.map((s) =>
    dates.map((date) => {
      const [y, m, d] = date.split('-').map(Number);
      const count = slotMap.get(`${date}_${s.hour}`)?.availableCount || 0;
      return slotCellName(new Date(y, m - 1, d, s.hour, s.minute), count, totalMembers);
    })
  );

  return { slotMap, conflictMap, dates, dayNames, names };
}

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
 * navigation is provided on the input grids — since plan 88.1-16 that means WeekGrid and
 * anything built on the shared primitive. Two legacy read-grids used to be named here as well
 * (one deleted by plan 88-31, then MergedHeatmapGrid by plan 88.1-16); this sentence is
 * corrected each time rather than left dangling at a file that no longer exists.
 *
 * Drag-select coexistence: EventHeatmapBackground has no internal drag-select
 * gesture; the long-press-drag-to-select gesture from Phase 68 MOB-07 lives in
 * EventScheduler.tsx (a sibling in createEvent.js's visual-calendar mode). Tap-
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
  // 87.4 PR-2 (D-02): the sub arm is dropped. The BE emits UUID conflict
  // user_ids (Plan 08), so the is-me compare is UUID-only against selfUuid (the
  // caller's resolved Users.id from useSelfIdentity).
  const { selfUuid } = useSelfIdentity();
  // Review #137: declared ABOVE the early returns so hook order never changes. Keyed on the props
  // and context the week derives from - never on a per-render array, or it would never hit.
  const { slotMap, conflictMap, dates, dayNames, names } = useMemo(
    () => deriveWeek(heatmapData, anchorDate, timezone),
    [heatmapData, anchorDate, timezone]
  );
  // No-data state: render nothing
  if (!heatmapData && !loading) return null;

  // Loading skeleton
  if (loading) {
    return (
      <div className="select-none">
        <div className="grid gap-px" style={{ gridTemplateColumns: '28px repeat(7, 1fr)' }}>
          {/* Header row skeleton */}
          <div />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`hdr-${i}`} className="h-6 bg-surface-elevated rounded-sm animate-pulse" />
          ))}
          {/* Grid skeleton rows — Phase 66-01: 28 rows (14 hours × 2 half-hour slots)
              to match EventScheduler's step={30} density. */}
          {Array.from({ length: 28 }).map((_, row) => (
            <div key={`row-${row}`} className="contents">
              <div className="h-5 w-5 bg-surface-elevated rounded-sm animate-pulse" />
              {Array.from({ length: 7 }).map((_, col) => (
                <div key={`cell-${row}-${col}`} className="h-5 bg-surface-page rounded-sm animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { totalMembers, gcalConflicts = [], membersWithoutDataCount = 0, totalGroupMembers = 0 } = heatmapData;

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Format hour label compactly
  function formatHour(h) {
    if (h === 0 || h === 12) return '12p';
    if (h < 12) return `${h}a`;
    return `${h - 12}p`;
  }

  // Color now comes from the shared ReadCell (variant="merged" -> mergedCellColor),
  // which produces the SAME bg-* ramp the local getCellBg fork used to (84-10
  // convergence: the per-grid color fork is retired; background bytes unchanged).

  // Build per-cell tooltip JSX (Phase 72-02 HUX-01).
  // Backend gcalConflicts shape: { user_id, username, date, hour } — no event
  // title; the current-user conflict line is intentionally generic.
  // Returns null when nothing relevant to show, so HeatmapTooltip's
  // disabled-on-falsy-content path skips the wrapper for empty cells.
  function renderTooltipContent(slot, dateKey) {
    const hasAvailability = slot && slot.availableCount > 0;
    const conflicts = conflictMap.get(dateKey) || [];
    // ONE predicate shared by both the positive "is this conflict mine" compare
    // and the adjacent negative "other members" filter, so they cannot drift
    // apart. UUID-only post-PR-2 emission flip (87.4 D-02).
    const isMe = (id) => id != null && id === selfUuid;
    const userHasConflict = conflicts.some(c => isMe(c.user_id));
    const otherConflicts = conflicts.filter(c => !isMe(c.user_id));

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
      {/* Grid. 87.8-13 walkthrough F-2: the label gutter is sized to fit the widest compact
          label ("12p") at the label's own size — the old 40px read as dead left padding at 375px.
          DECISION Phase 88.6-26 (D-01 / delta V-7): 24px -> 28px, chosen OVER dropping the label's
          `font-mono` and OVER shrinking `pr-1`. F-2's 24px was measured against "12p" at 10px mono
          (18.06px against the 20px content box a 24px gutter with pr-1 leaves). D-01 folds that
          label up to the 12px floor, where the SAME string measures 21.69px in Chromium at 375px —
          1.69px WIDER than the box, so it bled left out of the gutter column. This is the reflow
          V-7 names, found by measuring rather than by assuming. 28px restores F-2's own rule (the
          gutter fits the widest compact label) at the new size with 2.31px to spare; it costs each
          day column 0.56px (38.56 -> 38.00 at 375px) and no row height. Dropping `font-mono` would
          have been a look change with no ruling, and pr-0.5 would have left 0.31px of margin.
          Widening this back to 40px re-opens F-2; narrowing it below 26px re-opens the bleed. */}
      {/* DECISION Phase 88.6.1-24 (D-34, required context; review #178): the grid role here and
          the row role on the header row and on every body row's `contents` wrapper, mirroring WeekGrid
          - chosen OVER (a) leaving the cells orphaned (ReadCell claims `gridcell` on every cell, and
          an engine that repairs an orphan gridcell to generic drops its aria-label, so a cell whose
          count child is now hidden could go silent) and (b) changing ReadCell's role (the shared
          primitive this file deliberately leaves unedited). Roles ONLY: no keyboard model is added,
          so the docstring's Tab+focus+Esc scope (Plan 72-02 / D1 Opt 1) stands; adding arrow keys
          would reverse 72-02, not complete this. `contents` adds no box, so nothing moves.
          NAMED "Group availability" (HEATMAP_GRID_LABEL; owner ruling #178, 2026-10-13, option A,
          screen-reader only) OVER option B, a labelled-by reference to the visible "Week of ..."
          caption in createEvent.js: REJECTED because the caption says WHEN (the week), not WHAT
          (whose availability), and it is mode-dependent (two exclusive caption sites). The scheduler's own
          grid keeps its longer "Group availability by day and time".
          Changing this is a decision, not a cleanup. */}
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: '28px repeat(7, 1fr)' }}
        role="grid"
        aria-label={HEATMAP_GRID_LABEL}
      >
        {/* Header row: day labels with date numbers. The corner labels no column, so it is
            presentation (the scheduler's SEAM 6 choice on WeekGrid). */}
        <div className="contents" role="row">
          <div role="presentation" />
          {dates.map((date, i) => {
            const dayNum = parseInt(date.split('-')[2], 10);
            // DECISION Phase 88.6.1-85 Task 2 (owner ruling 2026-10-18, the P-94 sibling): CHOSEN -
            // the full weekday and day number spoken via `aria-label` on this columnheader, the
            // visible letter and number unchanged (the owner's words: the visual reads "M/T/W", the
            // reader reads "Monday, Tuesday, Wednesday"). The name comes from the one `deriveWeek`
            // derivation, so the header can never speak a different week than the cells (plan
            // 88.6.1-24's rule, above `deriveWeek`); the format is the shared SPOKEN_DAY_NAME_FORMAT,
            // so this header, the time picker's header and the phone strip speak alike. REJECTED:
            // (a) visually hidden text inside the header - on iOS a clipped text child is what
            // VoiceOver lands on instead of the name (research APPENDIX-AT.md AT-1), and it changes
            // the header's textContent; (b) a per-render `new Date(...)` from the `date` string here
            // - a second derivation of the week, which plan 88.6.1-24 retired; (c) changing the
            // letters - the owner kept them. DECISION Phase 88.6-26 (the weight, below) is not
            // touched. Changing this is a decision, not a cleanup.
            return (
              <div key={date} role="columnheader" aria-label={dayNames[i]} className="text-center">
                {/* DECISION Phase 88.6-26 (D-03 / W35): weight 700 here, chosen OVER 400 and over
                    keeping today's 500. D-03 would fold this to 400 on the stated ground that the
                    emphasis is "already carried by COLOUR" — that is FALSE at this cell: this weekday
                    letter and the date number directly below it carry the IDENTICAL ink token
                    (text-content-muted), and this plan folds that number up from 10px to the 12px
                    floor, so SIZE stops separating them as well. Weight is the only hierarchy the
                    header cell has left once its two spans converge on one size and one ink. 500 has
                    no rung on the phase's two-weight scale, so the retained differentiator is 700.
                    Dropping this to 400 flattens a weekday header into its own datum: a decision, not
                    a cleanup. */}
                <span className="text-xs font-bold text-content-muted block leading-tight">
                  {dayLabels[i]}
                </span>
                <span className="text-xs text-content-muted">{dayNum}</span>
              </div>
            );
          })}
        </div>

        {/* Hour rows — Phase 66-01: 28 rows at 30-min density. Hour labels
            render only on the :00 row; the :30 row leaves the label column
            empty so the grid stays aligned without visual clutter. Both
            half-hour cells of a given hour share the same hourly slot data
            (backend tracks availability hourly, so both halves render with
            the same green tint and count badge). */}
        {slots30.map((s, rowIndex) => (
          <div key={`${s.hour}-${s.minute}`} className="contents" role="row">
            {/* Hour label (only on the :00 row) */}
            {s.showLabel ? (
              <div className="flex items-center justify-end pr-1">
                <span className="text-xs text-content-muted font-mono">{formatHour(s.hour)}</span>
              </div>
            ) : (
              <div />
            )}
            {/* Day cells — keyed off the hourly slot, since backend data is
                hourly. Both half-hour cells (:00 and :30) wrap with the same
                tooltip content because the backend tracks availability hourly.
                The hover-only `title` attribute was removed in Plan 72-02 in
                favor of the shared HeatmapTooltip primitive. */}
            {dates.map((date, colIndex) => {
              const dateKey = `${date}_${s.hour}`;
              const slot = slotMap.get(dateKey);
              const count = slot?.availableCount || 0;
              const tooltipContent = renderTooltipContent(slot, dateKey);
              // PASSIVE read overlay (locked 72-02 / D1 Opt 1): ReadCell with
              // roving={false} converges on the shared cell for COLOR + aria
              // ONLY — it owns no focused-coordinate state, no focus-ref map, and
              // no nav-key handler. Tab+focus+Esc model preserved (not an input grid).
              // minHeight 28px keeps the whole cell a comfortable hover/tap
              // target (Plan 72-02 UAT); the count badge repeats on both the
              // :00 and :30 rows for parity with EventScheduler's density.
              return (
                <ReadCell
                  key={`${date}_${s.hour}_${s.minute}`}
                  variant="merged"
                  roving={false}
                  row={0}
                  col={0}
                  rows={1}
                  cols={1}
                  availableCount={count}
                  totalMembers={totalMembers}
                  // The count is folded in HERE, at the call site, and the shared ReadCell is
                  // deliberately NOT edited. ReadCell puts this prop on an explicit `aria-label`
                  // (ReadCell.tsx, anchor `aria-label={ariaLabel}`), and the tooltip's
                  // `aria-describedby` (HeatmapTooltip.js, anchor `aria-describedby`) exists only
                  // while the tooltip is open, so the RESTING name is where the level must live.
                  // CORRECTED by plan 88.6.1-24 (this comment used to say an explicit aria-label
                  // OVERRIDES child text, so the count span was invisible to a screen reader): that
                  // holds for the accessible-name algorithm and macOS, but iOS VoiceOver lands on a
                  // cell's accessible CHILD whenever it has one (research AT-1, the WebKit leaf
                  // rule) and spoke the bare count. So the count span below is now aria-hidden and
                  // this name carries the count.
                  // DECISION Phase 88.6.1-24 (D-34, copy row C1): CHOSEN - the scheduler's template
                  // through the shared `slotCellName` ("Monday, October 5 at 10:00 AM, 1 of 4
                  // available"; empty cells plain), so Create Event's two grids name cells one way.
                  // REJECTED (a) keeping this grid's own ISO-date-and-hour name (two shapes in one
                  // modal; the owner ruled C1 for both, D-34); (b) visually hidden text inside the
                  // cell (it adds a child, research AT-1); (c) "0 of N available" on empty cells
                  // (C1's ratified note; an empty cell has no wash level, so no colour-only cue).
                  // Changing this is a decision, not a cleanup.
                  ariaLabel={names[rowIndex][colIndex]}
                  tooltipContent={tooltipContent}
                  fill={false}
                  style={{ minHeight: '28px' }}
                  className="rounded-xs flex items-center justify-center cursor-default"
                >
                  {count > 0 && (
                    /* DECISION Phase 88.6-26 (D-03 / W35): weight 700, chosen OVER 400, because the
                       fill/ink pairing needs the weight. This count is the mandatory NON-COLOUR cue
                       for the cell's green wash: small ink on a coloured fill at fixed geometry
                       (28px minimum cell height), where 400 at 12px on a tinted fill loses the
                       legibility the weight is carrying — and the cue is a colour-vision-deficiency
                       requirement (~8% of men), not decoration. UI-SPEC 4.5's table has no family
                       for it, so a mechanical read would send it to 400. Settled at 700 alongside
                       its two siblings, the strip aggregate (SchedulerWeekStrip.tsx) and the
                       scheduler badge (EventScheduler.tsx), so one cue does not end this phase at
                       three different weights. */
                    <span aria-hidden="true" className="text-xs text-green-900 font-bold">{count}</span>
                  )}
                </ReadCell>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend strip */}
      <div className="flex items-center justify-center gap-1 mt-2">
        <span className="text-xs text-content-muted">Less</span>
        <div className="w-3 h-3 bg-surface-elevated rounded-xs" />
        <div className="w-3 h-3 bg-green-100 rounded-xs" />
        <div className="w-3 h-3 bg-green-200 rounded-xs" />
        <div className="w-3 h-3 bg-green-300 rounded-xs" />
        <div className="w-3 h-3 bg-green-400 rounded-xs" />
        <div className="w-3 h-3 bg-green-500 rounded-xs" />
        <span className="text-xs text-content-muted">More available</span>
        {/* Plan 72-02: dropped the "(hover for names)" hint — interaction is no
            longer hover-only (touch + keyboard now reach the tooltip via the
            shared HeatmapTooltip primitive). Keeping the legend clean instead
            of hint-y. */}
      </div>

      {membersWithoutDataCount > 0 && (
        <p className="text-xs text-content-muted text-center mt-1">
          {membersWithoutDataCount} of {totalGroupMembers} members haven't shared availability yet
        </p>
      )}

      {totalMembers === 0 && totalGroupMembers > 0 && (
        <div className="text-center mt-3 px-2">
          {/* 12 -> 14 and the weight deleted. This is the primary line of an empty state, which is
              NOT one of UI-SPEC 4.2's enumerated Caption roles, so 12px here is the "12px misuse
              moves UP to 14" case rather than the dense-grid-cell case the rest of this file is.
              The weight takes 4.5's EMPHASIS outcome: this line already carries
              text-content-secondary against the helper's text-content-muted below it, so the
              hierarchy is colour-carried and does not need a second signal. */}
          <p className="text-sm text-content-secondary mb-1">
            No availability shared yet
          </p>
          <p className="text-xs text-content-muted">
            Invite members or set a schedule to see availability here.
          </p>
        </div>
      )}

      {/* gcal conflict warning */}
      {conflictNames.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm text-xs text-amber-700 px-2 py-1 mt-2">
          Heads up: {conflictNames.join(' and ')} may have Google Calendar conflicts
        </div>
      )}
    </div>
  );
}
