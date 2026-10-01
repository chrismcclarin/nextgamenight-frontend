/**
 * Phase 88.6-60 (review R1 + MEDLOW-24): CalendarListView's empty states, rendered.
 *
 * SPEC R1 Acceptance / AC-1 (amended, rows 38-39) is met by BOTH CalendarListView empty states
 * converging on D2's section-tier mini-formula — one `<p>` at `text-content-muted text-sm`, the
 * string byte-unchanged — NOT by `<EmptyState>`, which `DECISION Phase 88.6-27 (W18 / D2)`
 * rejects at both sites (`CalendarListView.js`, the sheet marker above `No upcoming events</p>`
 * and its desktop twin above `No events</p>`).
 *
 * What was unpinned before this file (measured 2026-09-29):
 *   - the DESKTOP `No events` line had no assertion anywhere (`grep -rn "No events"` over
 *     `*.test.*` / `*.spec.*` finds only comments plus `EventDayModal`'s different string), and
 *     this phase changed its class `text-content-secondary` → `text-content-muted` untested;
 *   - neither arm had an E4 held-out LOADING test (UI-SPEC §9.3 "Held-out render test per
 *     adopted surface"): the guard `if (loading && (!Array.isArray(events) ||
 *     events.length === 0))` returns the skeleton before either empty line can render.
 *
 * The SHEET arm's `loading=false` string is already pinned through `UserHomePage`
 * (`UserHomePage.calendarSheet.test.tsx`, the two `findByText('No upcoming events')` cases) and
 * is NOT duplicated here — only its loading arm is.
 *
 * Rendered directly (no host), with `events=[]`: nothing past means no IntersectionObserver is
 * created, and the explicit `timezone` prop means the default TimezoneContext is never read.
 */
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CalendarListView from './CalendarListView';

const TZ = 'America/New_York';

function renderList(props: { variant: 'full' | 'compact' | 'sheet'; loading: boolean }) {
  return render(
    <CalendarListView events={[]} onEventClick={vi.fn()} timezone={TZ} {...props} />,
  );
}

afterEach(() => {
  cleanup();
});

describe('CalendarListView desktop arms — the "No events" empty line (review R1)', () => {
  // Both desktop hosts: `full` (user home) and `compact` (group home), `EventCalendar.js`.
  it.each(['full', 'compact'] as const)(
    '%s: zero events, not loading → exactly "No events" on the D2 mini-formula',
    (variant) => {
      renderList({ variant, loading: false });

      const line = screen.getByText('No events');
      // Exact string (getByText is exact by default) AND the element is the bare `<p>` of the
      // mini-formula — not an EmptyState heading, which would be an `h3` with a body.
      expect(line.tagName).toBe('P');
      expect(line).toHaveClass('text-content-muted', 'text-sm');
      // The pre-88.6 rung must not come back: the muted rung is the ruled value here.
      expect(line).not.toHaveClass('text-content-secondary');
      // The sheet's section-scoped line belongs to the sheet arm only.
      expect(screen.queryByText('No upcoming events')).toBeNull();
    },
  );
});

describe('CalendarListView — E4 held-out loading arms (UI-SPEC §9.3, review R1)', () => {
  it.each(['full', 'compact'] as const)(
    '%s: zero events WHILE loading → neither empty string renders (skeleton only)',
    (variant) => {
      renderList({ variant, loading: true });

      // The guard rendered its skeleton shell, so this is the loading branch and not a crash.
      expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeInTheDocument();
      expect(screen.queryByText('No events')).toBeNull();
      expect(screen.queryByText('No upcoming events')).toBeNull();
    },
  );

  it('sheet: zero events WHILE loading → "No upcoming events" does not render', () => {
    renderList({ variant: 'sheet', loading: true });

    expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeInTheDocument();
    expect(screen.queryByText('No upcoming events')).toBeNull();
    expect(screen.queryByText('No events')).toBeNull();
  });
});
