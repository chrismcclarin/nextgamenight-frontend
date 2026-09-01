/**
 * WHAT THIS EXISTS TO CATCH
 * =========================
 * `NextGameNightCard` is the calendar sheet's hero (SPEC Req 3 / D-05, D-06, D-14).
 * Four failures are cheap to reintroduce and expensive to notice, so each has a pin:
 *
 *  1. A HOST LINE COMING BACK. Owner ruling D-14 makes the who-line `{Group name}`
 *     ALONE, because RESEARCH B-1 proved exhaustively that no host/creator/organizer
 *     field exists anywhere in the Event model or the `GET /events/user/:user_id`
 *     include list. Any future "· hosted by X" is a fabrication, not a feature — the
 *     `hosted by` sweep below is the mechanical form of that ruling.
 *
 *  2. A LEVEL-5 HEADING IN THE HERO. `UserHomePage.calendarSheet.test.tsx`'s
 *     `rowOrder()` helper reads `getAllByRole('heading', { level: 5 })` inside the
 *     dialog to assert list ORDER. A hero rendering an `<h5>` would silently prepend
 *     itself to that list and corrupt the pin in a DIFFERENT file — the worst kind of
 *     coupling, because the failing test would not be this one.
 *
 *  3. A SKELETON WHEN THERE IS NO EVENT. With zero upcoming there is NO hero at all
 *     (SPEC Req 3, UI-SPEC §8) — a placeholder card implies an event exists.
 *
 *  4. AN ACCESSIBLE NAME THAT DOES NOT OPEN WITH THE VISIBLE LABEL. WCAG 2.5.3
 *     (label-in-name): the button's visible content opens with the eyebrow
 *     "Next game night", so its accessible name must too, or voice control cannot
 *     address it by what the user can read.
 *
 * The timezone is MOCKED TO A FIXED ZONE on purpose. The when-line is composed from
 * the shared `formatWithTzAbbr` / `formatTime` helpers, and `formatTime` APPENDS the
 * abbreviation — so a floating zone would make the assertion drift by machine.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// `rsvpAPI` MUST be mocked even for the content pins: the component fires
// `getEventRsvps` on mount, and an unmocked `rsvpAPI` reaches the real `apiFetch`
// (a real jsdom fetch), turning every test in this file into an unhandled rejection.
// The spread keeps every other export real.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    rsvpAPI: {
      ...actual.rsvpAPI,
      getEventRsvps: vi.fn(() =>
        Promise.resolve({ rsvps: [], summary: { yes: 0, maybe: 0, no: 0 } })
      ),
      submitRsvp: vi.fn(() => Promise.resolve({ id: 'rsvp-1', status: 'yes', note: null })),
    },
  };
});

import NextGameNightCard, { NextGameNightCard as Named } from './NextGameNightCard';

const SELF_UUID = '11111111-1111-4111-8111-111111111111';

/**
 * 2026-09-04T23:00:00Z in America/New_York is Friday, Sep 4, 7:00 PM EDT — verified
 * against `Intl` before it was written down, so the expected when-line is a measured
 * value rather than a guess.
 */
const EVENT = {
  id: 'evt-1',
  start_date: '2026-09-04T23:00:00Z',
  status: 'scheduled',
  Group: { name: 'Navy Knights' },
};

const WHEN_LINE = 'Friday, Sep 4 · 7:00 PM EDT';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(overrides: Record<string, unknown> = {}) {
  const onEventClick = vi.fn();
  const utils = render(
    <NextGameNightCard
      event={EVENT}
      selfUuid={SELF_UUID}
      onEventClick={onEventClick}
      {...overrides}
    />
  );
  return { onEventClick, ...utils };
}

describe('NextGameNightCard — content and navigation (SPEC Req 3 / D-05, D-14)', () => {
  it('exports the same component named and default', () => {
    expect(Named).toBe(NextGameNightCard);
  });

  it('names the next game night: eyebrow, when-line from the shared formatters, group', () => {
    renderCard();

    // The literal string is `Next game night`; `uppercase` is a CSS treatment, so the
    // DOM text — and therefore the accessible name — stays sentence case.
    expect(screen.getByText('Next game night')).toBeInTheDocument();
    expect(screen.getByText(WHEN_LINE)).toBeInTheDocument();
    expect(screen.getByText('Navy Knights')).toBeInTheDocument();
  });

  it('carries NO host text anywhere in the rendered output (D-14)', () => {
    const { container } = renderCard();
    expect(container.textContent?.toLowerCase()).not.toContain('hosted by');
  });

  it('renders NO heading at level 5 — the sheet suite reads that level for row order', () => {
    renderCard();
    expect(screen.queryAllByRole('heading', { level: 5 })).toHaveLength(0);
  });

  it('navigates on tap: one call, with the event', async () => {
    const user = userEvent.setup();
    const { onEventClick } = renderCard();

    await user.click(screen.getByRole('button', { name: /^Next game night/ }));

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(EVENT);
  });

  it('navigates on Enter from the keyboard', async () => {
    const user = userEvent.setup();
    const { onEventClick } = renderCard();

    const navigate = screen.getByRole('button', { name: /^Next game night/ });
    navigate.focus();
    await user.keyboard('{Enter}');

    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it("opens its accessible name with its own visible text (WCAG 2.5.3 label-in-name)", () => {
    renderCard();

    const navigate = screen.getByRole('button', { name: /open event$/ });
    const name = navigate.getAttribute('aria-label') ?? navigate.textContent ?? '';
    expect(name.startsWith('Next game night')).toBe(true);
    // UI-SPEC §6.3.4 order: what the card SHOWS, then the action.
    expect(name).toContain(WHEN_LINE);
    expect(name).toContain('Navy Knights');
  });

  it('renders NOTHING without an event — no skeleton implying one exists', () => {
    const { container } = renderCard({ event: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('omits the who-line rather than printing "undefined" when Group is absent', () => {
    const { container } = renderCard({ event: { ...EVENT, Group: undefined } });

    expect(screen.getByText(WHEN_LINE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });
});
