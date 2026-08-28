// Phase 88.3 code-adversarial-review run 3, H1 (owner ruling (a), 2026-08-28).
// The day-modal event row contains a native "Share Game QR" <button>. When the
// row's keyboard handler lived on the CARD (2c37a4e), Enter on that button
// bubbled up, was preventDefault()ed, and navigated to the event instead of
// opening the QR — and `role="button"` on the card hid the nested button from
// AT. These tests pin the corrected shape: the TITLE BLOCK is the keyboard
// target; the Share button is its own, exposed control.
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getEventInviteToken: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: { ...actual.eventsAPI, getEventInviteToken: h.getEventInviteToken },
  };
});

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/app/components/QRCodeModal', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));

import EventDayModal from './EventDayModal';

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const upcomingEvent = {
  id: 'evt-1',
  start_date: future.toISOString(),
  duration_minutes: 90,
  Game: { name: 'Catan' },
  Group: { name: 'Tuesday Crew', background_color: null },
};
const selectedDay = { date: future, events: [upcomingEvent] };
// The row's accessible name is computed from content (no aria-label): game, group AND time.
const rowName = /Catan.*Tuesday Crew.*\d{1,2}:\d{2}/;

describe('EventDayModal — nested Share Game QR button vs the keyboard-operable row (88.3 H1)', () => {
  beforeEach(() => {
    h.getEventInviteToken.mockReset();
    h.getEventInviteToken.mockResolvedValue({ invite_url: 'https://example.test/i/abc' });
  });
  afterEach(cleanup);

  function renderModal() {
    const onEventClick = vi.fn();
    render(<EventDayModal selectedDay={selectedDay} onClose={vi.fn()} onEventClick={onEventClick} />);
    return { onEventClick };
  }

  it('exposes BOTH controls to AT: the row (by its label) and the nested Share button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: rowName })).toBeTruthy();
    expect(screen.getByRole('button', { name: /share game qr/i })).toBeTruthy();
  });

  it('Enter on "Share Game QR" fetches the invite token and does NOT open the event', async () => {
    const { onEventClick } = renderModal();
    const user = userEvent.setup();
    const share = screen.getByRole('button', { name: /share game qr/i });
    share.focus();
    expect(document.activeElement).toBe(share);
    await act(async () => { await user.keyboard('{Enter}'); });
    expect(h.getEventInviteToken).toHaveBeenCalledTimes(1);
    expect(h.getEventInviteToken).toHaveBeenCalledWith('evt-1');
    expect(onEventClick).not.toHaveBeenCalled();
  });

  it('Space on "Share Game QR" likewise does NOT open the event', async () => {
    const { onEventClick } = renderModal();
    const user = userEvent.setup();
    screen.getByRole('button', { name: /share game qr/i }).focus();
    await act(async () => { await user.keyboard(' '); });
    expect(onEventClick).not.toHaveBeenCalled();
  });

  it('Enter on the row (title block) opens the event and does NOT fetch a QR', async () => {
    const { onEventClick } = renderModal();
    const user = userEvent.setup();
    screen.getByRole('button', { name: rowName }).focus();
    await act(async () => { await user.keyboard('{Enter}'); });
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(upcomingEvent);
    expect(h.getEventInviteToken).not.toHaveBeenCalled();
  });

  it('the Share button is NOT a descendant of the role="button" row (children-presentational guard)', () => {
    renderModal();
    const row = screen.getByRole('button', { name: rowName });
    const share = screen.getByRole('button', { name: /share game qr/i });
    expect(row.contains(share)).toBe(false);
  });
});
