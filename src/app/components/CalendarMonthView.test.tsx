// 88.3 code-adversarial-review run 4, M1 (2026-08-28): the COMPACT month tile —
// the variant the group page mounts and the surface the owner tests on a phone —
// was pinned only by Gate B's source-string scans. This is the behavioural pin:
// a regression that keeps the attribute strings but breaks the handler, drops the
// RSVP suffix from the name, or leaks the keypress into the day cell reds here.
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CalendarMonthView from './CalendarMonthView';

const day = new Date();
day.setDate(15);
day.setHours(12, 0, 0, 0);
const future = new Date(day.getTime() + 365 * 24 * 60 * 60 * 1000);
const y = future.getFullYear(), m = String(future.getMonth() + 1).padStart(2, '0'), d = String(future.getDate()).padStart(2, '0');

const tintedEvent = {
  id: 'evt-tinted',
  start_date: `${y}-${m}-${d}T19:00:00`,
  Game: { name: 'Catan' },
  Group: { name: 'Tuesday Crew', background_color: '#722f37' },
  rsvp_summary: { yes: 3, maybe: 1, no: 2 },
};
const plainEvent = {
  id: 'evt-plain',
  start_date: `${y}-${m}-${d}T20:00:00`,
  Game: { name: 'Wingspan' },
  Group: { name: 'Plain Group', background_color: null },
  rsvp_summary: null,
};

function renderCompact() {
  const onEventClick = vi.fn();
  const onDayClick = vi.fn();
  render(
    <CalendarMonthView
      days={[{ date: future, isCurrentMonth: true }]}
      activeEvents={[tintedEvent, plainEvent]}
      currentDate={future}
      variant="compact"
      onDayClick={onDayClick}
      onEventClick={onEventClick}
      onNavigateMonth={vi.fn()}
      onGoToday={vi.fn()}
      monthNames={['January','February','March','April','May','June','July','August','September','October','November','December']}
      tzLegend={null}
    />,
  );
  return { onEventClick, onDayClick };
}

describe('CalendarMonthView compact tile — keyboard + accessible name (88.3-cr4 M1)', () => {
  afterEach(cleanup);

  it('names the tinted tile with game, group AND the RSVP counts', () => {
    renderCompact();
    expect(screen.getByRole('button', { name: /Catan - Tuesday Crew, 3 going, 1 maybe, 2 can't/ })).toBeTruthy();
  });

  it('Enter on the tile calls onEventClick once with the event and does NOT open the day cell', async () => {
    const { onEventClick, onDayClick } = renderCompact();
    const user = userEvent.setup();
    screen.getByRole('button', { name: /Catan - Tuesday Crew/ }).focus();
    await act(async () => { await user.keyboard('{Enter}'); });
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(tintedEvent);
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('Space on the tile likewise fires the event, not the day cell', async () => {
    const { onEventClick, onDayClick } = renderCompact();
    const user = userEvent.setup();
    screen.getByRole('button', { name: /Catan - Tuesday Crew/ }).focus();
    await act(async () => { await user.keyboard(' '); });
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('only the tinted tile carries the group ground custom property', () => {
    renderCompact();
    const tinted = screen.getByRole('button', { name: /Catan - Tuesday Crew/ }) as HTMLElement;
    const plain = screen.getByRole('button', { name: /Wingspan - Plain Group/ }) as HTMLElement;
    expect(tinted.style.getPropertyValue('--group-ground')).toBe('#722f37');
    expect(plain.style.getPropertyValue('--group-ground')).toBe('');
  });
});
