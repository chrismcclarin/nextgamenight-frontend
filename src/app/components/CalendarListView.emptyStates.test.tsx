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
 *
 * AMENDED Phase 88.9-61 (X25a + X29 A; owner 2026-11-14: "Past section shouldn't have No upcoming
 * events wording. It should just say no events"): the two per-arm lines became ONE line inside
 * the open Upcoming section on every arm. No nights at all reads No events (the sheet used to say
 * No upcoming events there); No upcoming events shows only when past nights exist; nothing in or
 * under Past says either. The sheet's zero-events string is therefore pinned HERE now, with the
 * desktop arms, and the past-only case below is new.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CalendarListView from './CalendarListView';

const TZ = 'America/New_York';

function renderList(props: { variant: 'full' | 'compact' | 'sheet'; loading: boolean; events?: unknown[] }) {
  const { events = [], ...rest } = props;
  return render(
    <CalendarListView events={events} onEventClick={vi.fn()} timezone={TZ} {...rest} />,
  );
}

// Two nights in 2020: past on any clock this suite will ever run under, so no Date pin is needed.
const PAST_ONLY = [
  { id: 'p1', group_id: 'g1', game_id: 'game-1', start_date: '2020-03-10T23:00:00.000Z', status: 'completed', Game: { name: 'Wingspan' }, Group: { name: 'Alpha' }, EventParticipations: [] },
  { id: 'p2', group_id: 'g1', game_id: 'game-2', start_date: '2020-03-03T23:00:00.000Z', status: 'completed', Game: { name: 'Azul' }, Group: { name: 'Alpha' }, EventParticipations: [] },
];

afterEach(() => {
  cleanup();
});

describe('CalendarListView — the "No events" empty line on every arm (review R1; 88.9-61 X29 A)', () => {
  // Every host: the phone sheet, `full` (user home) and `compact` (group home), `EventCalendar.js`.
  it.each(['sheet', 'full', 'compact'] as const)(
    '%s: zero events, not loading → the open Upcoming header and exactly No events, no Past header (owner 2026-11-14: It should just say no events)',
    (variant) => {
      renderList({ variant, loading: false });

      // The line sits under the open Upcoming header (a folding button, X25a), and there is no
      // Past header at all when nothing is past.
      const header = screen.getByRole('button', { name: 'Upcoming events' });
      expect(header).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('button', { name: /past events/i })).toBeNull();

      const line = screen.getByText('No events');
      expect(header.closest('section')?.contains(line), 'the line is inside the Upcoming section').toBe(true);
      // Exact string (getByText is exact by default) AND the element is the bare `<p>` of the
      // mini-formula — not an EmptyState heading, which would be an `h3` with a body.
      expect(line.tagName).toBe('P');
      expect(line).toHaveClass('text-content-muted', 'text-sm');
      // The pre-88.6 rung must not come back: the muted rung is the ruled value here.
      expect(line).not.toHaveClass('text-content-secondary');
      // No nights at all is never "No upcoming events", on any arm (owner 2026-11-14).
      expect(screen.queryByText('No upcoming events')).toBeNull();
    },
  );

  it('X25a / X29 (88.9): with only past nights every arm shows No upcoming events inside the open Upcoming section, then the rule and a closed Past events (N) header, and no empty line under Past', () => {
    for (const variant of ['sheet', 'full', 'compact'] as const) {
      renderList({ variant, loading: false, events: PAST_ONLY });

      const upcoming = screen.getByRole('button', { name: 'Upcoming events' });
      expect(upcoming, `${variant}: Upcoming is open`).toHaveAttribute('aria-expanded', 'true');
      const line = screen.getByText('No upcoming events');
      expect(line.tagName).toBe('P');
      expect(line).toHaveClass('text-content-muted', 'text-sm');
      expect(upcoming.closest('section')?.contains(line), `${variant}: the line is inside the Upcoming section`).toBe(true);
      expect(screen.queryByText('No events'), `${variant}: past nights exist, so not No events`).toBeNull();

      const past = screen.getByRole('button', { name: 'Past events (2)' });
      expect(past, `${variant}: Past is closed`).toHaveAttribute('aria-expanded', 'false');
      const pastSection = past.closest('section') as HTMLElement;
      expect(pastSection.className.split(/\s+/), `${variant}: the rule above Past`).toEqual(
        expect.arrayContaining(['border-t', 'border-line']),
      );
      expect(pastSection.contains(line), `${variant}: the empty line is not under Past`).toBe(false);

      // Open Past: its rows show, and still nothing in or under Past says either empty string.
      fireEvent.click(past);
      expect(past).toHaveAttribute('aria-expanded', 'true');
      expect(pastSection.querySelectorAll('[role="button"]'), `${variant}: the two past rows`).toHaveLength(2);
      expect(pastSection.textContent, `${variant}: no empty line under Past`).not.toMatch(/No upcoming events|No events/);
      expect(screen.getAllByText(/^No (upcoming )?events$/), `${variant}: one empty line in the whole list`).toHaveLength(1);
      cleanup();
    }
  });
});

describe('CalendarListView — E4 held-out loading arms (UI-SPEC §9.3, review R1)', () => {
  it.each(['full', 'compact'] as const)(
    '%s: zero events WHILE loading → neither empty string renders (skeleton only)',
    (variant) => {
      renderList({ variant, loading: true });

      // The guard rendered its skeleton shell, so this is the loading branch and not a crash.
      expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeInTheDocument();
      // 88.9-61: a plain heading while loading — there is nothing to fold yet, so no button.
      expect(screen.queryByRole('button', { name: 'Upcoming events' })).toBeNull();
      expect(screen.queryByText('No events')).toBeNull();
      expect(screen.queryByText('No upcoming events')).toBeNull();
    },
  );

  it('sheet: zero events WHILE loading → "No upcoming events" does not render', () => {
    renderList({ variant: 'sheet', loading: true });

    expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upcoming events' })).toBeNull();
    expect(screen.queryByText('No upcoming events')).toBeNull();
    expect(screen.queryByText('No events')).toBeNull();
  });
});
