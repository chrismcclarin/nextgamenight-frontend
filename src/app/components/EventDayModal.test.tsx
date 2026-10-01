// Phase 88.3 code-adversarial-review run 3, H1 (owner ruling (a), 2026-08-28).
// The day-modal event row contains a native "Share Game QR" <button>. When the
// row's keyboard handler lived on the CARD (2c37a4e), Enter on that button
// bubbled up, was preventDefault()ed, and navigated to the event instead of
// opening the QR — and `role="button"` on the card hid the nested button from
// AT. These tests pin the corrected shape: the TITLE BLOCK is the keyboard
// target; the Share button is its own, exposed control.
import * as React from 'react';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
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

// Phase 88.6-27 (W16): the two channels the QR failure now uses. Spied rather than stubbed
// away, because WHICH channel carries what is the assertion.
const toastSpies = vi.hoisted(() => ({ error: vi.fn() }));
const loggerSpies = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastSpies.error } }));
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  // `errCtx` is the REAL one: the ctx shape assertion below is about what the call site
  // passes, and stubbing the helper would assert the stub instead.
  return { ...actual, logger: { ...actual.logger, info: loggerSpies.info } };
});

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

// Phase 88.6-27 — W16 (D-31, UI-SPEC §12 A-4): the silent QR failure now SPEAKS, and the
// speaking is cancelled-generation guarded.
//
// Before this plan `handleShowGameQR` failed with `console.error` only: a user tapped
// "Share Game QR", nothing happened, and nothing told them why. Two halves are pinned here,
// and the second is the one with a trap in it.
describe('EventDayModal — W16: the QR failure speaks, and stops speaking after unmount', () => {
  beforeEach(() => {
    h.getEventInviteToken.mockReset();
    toastSpies.error.mockClear();
    loggerSpies.info.mockClear();
  });
  afterEach(cleanup);

  it('a failed token fetch fires a ratified toast AND reports through the house logger', async () => {
    h.getEventInviteToken.mockRejectedValue(new Error('boom'));
    render(<EventDayModal selectedDay={selectedDay} onClose={vi.fn()} onEventClick={vi.fn()} />);
    const user = userEvent.setup();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /share game qr/i }));
    });

    expect(toastSpies.error).toHaveBeenCalledTimes(1);
    // The RATIFIED `unknown` string, from `getFetchErrorMessage` with no fallback — no new copy
    // is authored at this site. Asserted as non-empty prose rather than as a literal, so the
    // ratified wording can be re-ruled without reding a test that is about the CHANNEL.
    const [message] = toastSpies.error.mock.calls[0];
    expect(typeof message).toBe('string');
    expect((message as string).length).toBeGreaterThan(0);

    // The developer half: `logger.info` (a breadcrumb — the level the owner amended AC-2 to on
    // 2026-09-13), with the error's NAME and MESSAGE in the ctx object and the raw `Error`
    // never passed. `checkJs: false` means typecheck cannot catch that mistake in a `.js`
    // file, which is why it is asserted here.
    expect(loggerSpies.info).toHaveBeenCalledTimes(1);
    const [msg, ctx] = loggerSpies.info.mock.calls[0];
    expect(msg).toBe('Failed to get game invite token');
    expect(ctx).toEqual({ name: 'Error', message: 'boom' });
    expect(ctx).not.toBeInstanceOf(Error);
  });

  it('a rejection that settles AFTER the modal is gone fires NO toast', async () => {
    // THE MECHANISM THIS PINS, stated because the intuitive guard does not work: the component
    // IS unmounted by its host (`EventCalendar.js:242`), and the toast lands anyway because
    // `toast.error` is a module-level imperative call reached from the SURVIVING promise
    // continuation. A comparison against `selectedDay` or any component state is unreachable
    // post-unmount. Only the unmount-invalidated ref stops it.
    let rejectIt: (err: unknown) => void = () => {};
    h.getEventInviteToken.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectIt = reject;
      })
    );
    const { unmount } = render(
      <EventDayModal selectedDay={selectedDay} onClose={vi.fn()} onEventClick={vi.fn()} />
    );
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /share game qr/i }));
    });
    expect(h.getEventInviteToken).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      rejectIt(new Error('late'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastSpies.error).not.toHaveBeenCalled();
    // ...and the developer log STILL fires: a breadcrumb is not context, so it is deliberately
    // outside the guard. Asserting it is what stops a future "fix" from moving the whole catch
    // inside the ref check and silently losing the report.
    expect(loggerSpies.info).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-44 (R7 / AC-7, UI-SPEC §7.5) — the composed axe audit, after this surface's LAST
// migration commit. Ordering confirmed at execution: `git log -1 -- EventDayModal.js` is
// `a41df05` (plan 88.6-41's W49 convergence, an ancestor of HEAD), NOT plan 27's sweep commit —
// so the tree audited here is the final migrated one. THIS SURFACE HAS NO `matchMedia` FORK:
// neither `EventDayModal.js` nor anything it renders calls `matchMedia` (`QRCodeModal` and
// `TimezoneNudgeBanner` are stubbed above; neither calls it either) — measured 2026-09-22. One
// tree, one run per rule set, no resize. This surface has no form controls, so there is no
// house-rule check here.
// ---------------------------------------------------------------------------
import { axe } from 'vitest-axe';

const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

/** A real trigger + the consumer's shape (`EventCalendar.js:362`: `{selectedDay && <EventDayModal …>}`). */
function AuditHost() {
  const [day, setDay] = React.useState<typeof selectedDay | null>(null);
  return (
    <>
      <button type="button" onClick={() => setDay(selectedDay)}>
        Open day
      </button>
      {day && <EventDayModal selectedDay={day} onClose={() => setDay(null)} onEventClick={vi.fn()} />}
    </>
  );
}

describe('EventDayModal — R7 composed axe audit + focus contract (88.6-44)', () => {
  beforeEach(() => {
    h.getEventInviteToken.mockReset();
    h.getEventInviteToken.mockResolvedValue({ invite_url: 'https://example.test/i/abc' });
  });
  afterEach(cleanup);

  it('1. the POPULATED day (an event row) passes WCAG 4.1.2 and heading-order', async () => {
    render(<EventDayModal selectedDay={selectedDay} onClose={vi.fn()} onEventClick={vi.fn()} />);
    await screen.findByRole('button', { name: rowName });
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the EMPTY day and the "+ New event" (group calendar) branches pass the same two rules', async () => {
    // JS component: `onCreateEventOnDay = null` infers as `null | undefined`; cast to pass the
    // callback the group calendar passes (the createGroup.test / formLabels.audit idiom).
    const EventDayModalAny = EventDayModal as unknown as React.ComponentType<Record<string, unknown>>;
    render(
      <EventDayModalAny
        selectedDay={{ date: future, events: [] }}
        onClose={vi.fn()}
        onEventClick={vi.fn()}
        onCreateEventOnDay={vi.fn()}
      />
    );
    await screen.findByText('No events on this day.');
    await screen.findByRole('button', { name: '+ New event on this day' });
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('3. focus: on OPEN the header Close control (no initialFocusRef is passed); on CLOSE the NAMED trigger', async () => {
    const user = userEvent.setup();
    render(<AuditHost />);
    const trigger = screen.getByRole('button', { name: 'Open day' });
    trigger.focus();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await screen.findByRole('button', { name: rowName });
    // DERIVED BEFORE WRITING: `EventDayModal.js` passes no `initialFocusRef`, so `Modal.tsx`'s
    // documented default stands — the first focusable node, `<Modal.Header>`'s
    // `DialogClose aria-label="Close"`. Opening on Close rather than on the first event row is
    // ACCEPTED (recorded in 88.6-44-SUMMARY.md). NAMED target; containment is the second check.
    const close = screen.getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // NAMED identity, never "not body".
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
