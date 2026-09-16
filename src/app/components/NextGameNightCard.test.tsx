/**
 * WHAT THIS EXISTS TO CATCH
 * =========================
 * `NextGameNightCard` is the calendar sheet's hero (SPEC Req 3 + Req 4 / D-05, D-06,
 * D-07, D-08, D-14). The failures below are cheap to reintroduce and expensive to
 * notice, so each has a pin.
 *
 * CONTENT / NAVIGATION
 *
 *  1. A HOST LINE COMING BACK. Owner ruling D-14 makes the who-line `{Group name}`
 *     ALONE, because RESEARCH B-1 proved exhaustively that no host/creator/organizer
 *     field exists anywhere in the Event model or the `GET /events/user/:user_id`
 *     include list. Any future "· hosted by X" is a fabrication, not a feature — the
 *     `hosted by` sweep below is the mechanical form of that ruling.
 *
 *  2. A LEVEL-5 HEADING IN THE HERO. `UserHomePage.calendarSheet.test.tsx`'s
 *     `rowOrder()` helper reads `getAllByRole('heading', { level: 5 })` inside the
 *     dialog to assert list ORDER. A hero rendering one would silently prepend itself
 *     to that list and corrupt the pin in a DIFFERENT file — the worst kind of
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
 * RSVP (SPEC Req 4 / D-07, D-08)
 *
 *  5. A STATUS CLAIMED BEFORE IT IS KNOWN. While identity is unresolved or the read
 *     failed, the row is EMPTY — never "RSVP to this event", which asserts "you have
 *     not answered" on no evidence. This is the card-level twin of D-03's count
 *     suppression.
 *
 *  6. A DOUBLE FETCH ACROSS IDENTITY RESOLUTION. An ungated effect fires once with a
 *     null `selfUuid` and again when it resolves: two requests, and the first one's
 *     answer is unusable. Exactly one fetch, ever.
 *
 *  7. A SLOW READ CLOBBERING A FRESH WRITE. If the on-open `getEventRsvps` lands after
 *     the viewer has already tapped, its stale row must be DISCARDED, or the card
 *     silently reverts the answer the user just gave.
 *
 *  8. FOCUS DROPPED MID-SUBMIT. The native `disabled` attribute drops focus to `body`
 *     in real browsers, stranding a keyboard or switch user. The pressed button carries
 *     `aria-disabled` and an in-handler early return instead.
 *
 *  9. A SILENT FAILURE. SPEC Req 4 forbids it. A rejected write renders shared-helper
 *     copy in an assertive region AND reports to telemetry; a rejected READ stays
 *     visually silent (an unknown status is not something the viewer must act on) but
 *     is STILL reported, so it is observable.
 *
 * 10. A SECOND RSVP IDIOM. The copy and treatment come from the shared `statusConfig`;
 *     a private `{yes, no}` map here would be the third idiom `DECISION Phase 88-27`
 *     exists to prevent.
 *
 * The timezone is MOCKED TO A FIXED ZONE on purpose. The when-line is composed from
 * the shared `formatWithTzAbbr` / `formatTime` helpers, and `formatTime` APPENDS the
 * abbreviation — so a floating zone would make the assertion drift by machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, act } from '@testing-library/react';
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
      getEventRsvps: vi.fn(),
      submitRsvp: vi.fn(),
    },
  };
});

import { rsvpAPI } from '@/lib/api';
import { logger } from '@/lib/logger';

import NextGameNightCard, { NextGameNightCard as Named } from './NextGameNightCard';
import { statusConfig } from './rsvpStatusConfig';

type Mock = ReturnType<typeof vi.fn>;

const getEventRsvps = rsvpAPI.getEventRsvps as unknown as Mock;
const submitRsvp = rsvpAPI.submitRsvp as unknown as Mock;
const loggerError = logger.error as unknown as Mock;

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

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

const EMPTY_RSVPS = { rsvps: [], summary: { yes: 0, maybe: 0, no: 0 } };

const ownRsvp = (status: string) => ({
  rsvps: [
    {
      id: 'rsvp-own',
      event_id: EVENT.id,
      user_id: SELF_UUID,
      status,
      note: null,
      User: { id: SELF_UUID },
    },
  ],
  summary: { yes: status === 'yes' ? 1 : 0, maybe: 0, no: status === 'no' ? 1 : 0 },
});

/**
 * A promise the test controls. `mockClear` does NOT restore an implementation, so every
 * default is re-installed in `beforeEach` rather than relied on from the factory —
 * otherwise a `mockResolvedValueOnce` in one test leaks into the next.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getEventRsvps.mockReset();
  submitRsvp.mockReset();
  loggerError.mockClear();
  getEventRsvps.mockResolvedValue(EMPTY_RSVPS);
  submitRsvp.mockResolvedValue({ id: 'rsvp-own', status: 'yes', note: null });
});

afterEach(cleanup);

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

/** The RSVP pair, addressed by the group label that names the event. */
const rsvpGroup = () => screen.getByRole('group', { name: /^RSVP for / });
const yesButton = () => screen.getByRole('button', { name: "I'm in" });
const noButton = () => screen.getByRole('button', { name: "Can't make it" });

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

  it('opens its accessible name with its own visible text (WCAG 2.5.3 label-in-name)', () => {
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
    expect(getEventRsvps).not.toHaveBeenCalled();
  });

  it('omits the who-line rather than printing "undefined" when Group is absent', () => {
    const { container } = renderCard({ event: { ...EVENT, Group: undefined } });

    expect(screen.getByText(WHEN_LINE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });

  it('keeps the RSVP toggle a SIBLING of the navigate button, never a child (UI-SPEC A-4)', async () => {
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalled());

    const navigate = screen.getByRole('button', { name: /open event$/ });
    expect(navigate.contains(yesButton())).toBe(false);
    expect(navigate.contains(noButton())).toBe(false);
  });
});

describe('NextGameNightCard — inline RSVP (SPEC Req 4 / D-07, D-08)', () => {
  it('reads the viewer status with ONE getEventRsvps for the hero event', async () => {
    renderCard();

    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));
    expect(getEventRsvps).toHaveBeenCalledWith(EVENT.id);
  });

  it('does not fetch at all while identity is unresolved, and fetches ONCE when it resolves', async () => {
    const onEventClick = vi.fn();
    const { rerender } = render(
      <NextGameNightCard event={EVENT} selfUuid={null} onEventClick={onEventClick} />
    );

    // Not "not yet" — not at all. A fetch here would be answered for nobody.
    expect(getEventRsvps).not.toHaveBeenCalled();

    rerender(
      <NextGameNightCard event={EVENT} selfUuid={SELF_UUID} onEventClick={onEventClick} />
    );

    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));
    // One TOTAL — never one before resolution and a second after.
    expect(getEventRsvps).toHaveBeenCalledTimes(1);
  });

  it('renders the persisted status: own row `yes` reads from statusConfig and presses `I\'m in`', async () => {
    getEventRsvps.mockResolvedValue(ownRsvp('yes'));
    renderCard();

    expect(await screen.findByText(statusConfig.yes.label)).toBeInTheDocument();
    // The ruled copy itself, pinned once so a config edit cannot silently reword it.
    expect(statusConfig.yes.label).toBe("You're going!");
    expect(yesButton()).toHaveAttribute('aria-pressed', 'true');
    expect(noButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('matches on the nested User.id UUID — another member\'s row is not the viewer\'s', async () => {
    getEventRsvps.mockResolvedValue({
      rsvps: [
        {
          id: 'rsvp-other',
          event_id: EVENT.id,
          user_id: OTHER_UUID,
          status: 'yes',
          note: null,
          User: { id: OTHER_UUID },
        },
      ],
      summary: { yes: 1, maybe: 0, no: 0 },
    });
    renderCard();

    expect(await screen.findByText('RSVP to this event')).toBeInTheDocument();
    expect(yesButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves the status row EMPTY while identity is unresolved — never "RSVP to this event"', async () => {
    renderCard({ selfUuid: undefined });

    // Give any (incorrect) fetch a chance to land before asserting the absence.
    await waitFor(() => expect(screen.getByRole('group', { name: /^RSVP for / })).toBeInTheDocument());
    expect(screen.queryByText('RSVP to this event')).toBeNull();
    expect(screen.queryByText(statusConfig.yes.label)).toBeNull();
    expect(screen.queryByText(statusConfig.no.label)).toBeNull();
  });

  it('round-trips yes -> no through the ONE shipped mutation, with asserted arguments', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    await user.click(yesButton());

    await waitFor(() => expect(screen.getByText(statusConfig.yes.label)).toBeInTheDocument());
    expect(submitRsvp).toHaveBeenCalledTimes(1);
    expect(submitRsvp).toHaveBeenCalledWith(EVENT.id, 'yes');
    // NOTE-LESS, and pinned as such: a third `note` argument would re-open the wipe
    // plan 88.5-01's backend patch closed.
    expect(submitRsvp.mock.calls[0]).toHaveLength(2);

    await user.click(noButton());

    await waitFor(() => expect(screen.getByText(statusConfig.no.label)).toBeInTheDocument());
    expect(statusConfig.no.label).toBe("You're not going");
    expect(submitRsvp).toHaveBeenCalledTimes(2);
    expect(submitRsvp).toHaveBeenNthCalledWith(2, EVENT.id, 'no');
  });

  it('treats a same-status re-tap as a no-op, not a second mutation', async () => {
    getEventRsvps.mockResolvedValue(ownRsvp('yes'));
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(statusConfig.yes.label);

    await user.click(yesButton());

    expect(submitRsvp).not.toHaveBeenCalled();
    expect(screen.getByText(statusConfig.yes.label)).toBeInTheDocument();
  });

  it('discards a getEventRsvps result that lands AFTER a submit has completed', async () => {
    // The read is still in flight when the viewer answers — the slow answer is stale
    // the moment the fast one is written.
    const read = deferred<unknown>();
    getEventRsvps.mockReturnValue(read.promise);
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    await user.click(yesButton());
    await waitFor(() => expect(screen.getByText(statusConfig.yes.label)).toBeInTheDocument());

    await act(async () => {
      read.resolve(ownRsvp('no'));
      await read.promise;
    });

    expect(screen.getByText(statusConfig.yes.label)).toBeInTheDocument();
    expect(screen.queryByText(statusConfig.no.label)).toBeNull();
  });

  it('keeps DOM focus on the pressed button through the submit, via aria-disabled not disabled', async () => {
    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const pressed = yesButton();
    await user.click(pressed);

    // In flight: soft-disabled, still focusable, still focused.
    expect(pressed).toHaveAttribute('aria-disabled', 'true');
    expect(pressed).not.toBeDisabled();
    expect(document.activeElement).toBe(pressed);
    // Re-tapping in flight is a no-op via the in-handler early return.
    await user.click(pressed);
    expect(submitRsvp).toHaveBeenCalledTimes(1);

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'yes', note: null });
      await write.promise;
    });

    expect(document.activeElement).toBe(yesButton());
    expect(yesButton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('surfaces a failed write in an assertive region AND reports it, leaving both buttons usable', async () => {
    submitRsvp.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    await user.click(yesButton());

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent?.trim()).not.toBe(''));
    // The copy comes from the shared helper, never a hand-rolled string.
    expect(alert.textContent).toMatch(/could not save your rsvp|something went wrong|connection/i);
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError.mock.calls[0][1]).toBeInstanceOf(Error);

    // Retryable: neither button is left dead.
    expect(yesButton()).not.toBeDisabled();
    expect(noButton()).not.toBeDisabled();
    expect(yesButton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('CLEARS the failure banner when the hero FLIPS to a different event (W45/#33)', async () => {
    /*
     * THE BUG THIS PINS: the eventId effect resets the card's identity (`eventIdRef`), its
     * stale-guard and its status — and used to clear NEITHER message, while `handleRsvp`'s
     * `eventIdRef.current !== submittedFor` early return is exactly what leaves the previous
     * event's outcome standing. So a user who answered event A and whose hero then flipped to
     * event B (A's start time passed and a re-render reselected) was left with A's failure
     * banner sitting under B's buttons — a claim about a request that has nothing to do with
     * the control beside it. A flip needs no further interaction, which is why the clear has to
     * live in the effect and not at the top of `handleRsvp`.
     *
     * The assertion runs on the SAME node across the flip (identity, not a re-query): a live
     * region that is unmounted and remounted empty would satisfy a re-query while announcing
     * nothing, and the region's own contract is that it is always mounted.
     */
    submitRsvp.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    const { rerender } = render(
      <NextGameNightCard event={EVENT} selfUuid={SELF_UUID} onEventClick={vi.fn()} />
    );
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const region = screen.getByRole('alert');
    expect(region.textContent?.trim()).toBe('');

    // POSITIVE settle signal first: drive the failure and wait for the banner to actually carry
    // text. Asserting emptiness later without this passes on the first tick and observes nothing.
    await user.click(yesButton());
    await waitFor(() => expect(region.textContent?.trim()).not.toBe(''));

    // The flip. A NEW event id, nothing else touched.
    const NEXT_EVENT = { ...EVENT, id: 'evt-2' };
    rerender(
      <NextGameNightCard event={NEXT_EVENT} selfUuid={SELF_UUID} onEventClick={vi.fn()} />
    );

    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledWith('evt-2'));
    expect(screen.getByRole('alert')).toBe(region); // same node — never remounted
    await waitFor(() => expect(region.textContent?.trim()).toBe(''));
  });

  it('stays visually silent on a failed READ but still reports it to telemetry', async () => {
    getEventRsvps.mockRejectedValue(new Error('read failed'));
    renderCard();

    await waitFor(() => expect(loggerError).toHaveBeenCalledTimes(1));
    // An unknown status is not a failure the viewer must act on: empty row, no banner.
    expect(screen.queryByText('RSVP to this event')).toBeNull();
    expect(screen.getByRole('alert').textContent?.trim()).toBe('');
  });

  it('mounts the assertive region EMPTY-FIRST and keeps it mounted after a successful write', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    // Present before anything happens — a live region announces CHANGES, not its own mount.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent?.trim()).toBe('');

    await user.click(yesButton());
    await waitFor(() => expect(screen.getByText(statusConfig.yes.label)).toBeInTheDocument());

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent?.trim()).toBe('');
  });

  it('is exactly two buttons in a labelled group — no Maybe, no note field', async () => {
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const group = rsvpGroup();
    expect(group).toHaveAttribute('aria-label', expect.stringContaining(WHEN_LINE));
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    // `maybe` and notes stay on the event page by owner ruling — the tap-through is
    // DESIGNED, not missing.
    expect(screen.queryByRole('button', { name: /maybe/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

// W45(a) — THE HERO RSVP-SUCCESS ANNOUNCEMENT (owner ruling 2026-09-16, ARM A).
//
// WHAT THIS EXISTS TO CATCH
// -------------------------
// 11. A SILENT SUCCESS. The card announced FAILURE (assertive) and nothing at all on
//     success, so a screen-reader user had no confirmation their answer was saved.
//
// 12. ONLY THE FIRST SUCCESS BEING AUDIBLE. A live region announces CHANGES. Re-setting
//     an IDENTICAL string into an unchanged region is a React bail-out — no DOM mutation,
//     no announcement — and the ratified string is FIXED ("Response saved"), so without a
//     clear at the START of `handleRsvp` every success after the first is silent. The
//     same-status early return blocks only a repeat of the SAME status, so yes -> no ->
//     yes is an ordinary flow, not an edge case.
//
// 13. THE REGION BEING CREATED BY THE EVENT IT ANNOUNCES. A region mounted at the moment
//     of the announcement announces nothing. PRESENCE cannot prove this: a presence
//     assertion passes against an implementation that announces exactly once. The proof
//     below is NODE IDENTITY across two consecutive successes — the region node is
//     captured ONCE, before any RSVP, and never re-queried.
//
// 14. TWO REGIONS CLAIMING CONTRADICTORY OUTCOMES. Success and failure must clear each
//     other, so "Response saved" and "Could not save your RSVP" can never stand together.
//
// 15. A STALE CONFIRMATION SURVIVING A HERO FLIP. Worse than the stale error this plan
//     already closed: it claims a response the user never gave for the event now on screen.
const SUCCESS_COPY = 'Response saved';

describe('NextGameNightCard — the RSVP success announcement (W45(a) / V-20)', () => {
  it('announces EVERY success, proven by NODE IDENTITY across two consecutive successes', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    // Captured ONCE, before anything happens, and never re-queried. Re-querying between
    // the steps below would defeat the proof: it would pass against a region that is
    // unmounted and remounted per announcement, which is the defect being pinned.
    const region = screen.getByRole('status');
    expect(region.textContent?.trim()).toBe('');

    // FIRST success.
    await user.click(yesButton());
    await waitFor(() => expect(region.textContent?.trim()).toBe(SUCCESS_COPY));
    expect(screen.getByRole('status')).toBe(region);

    // SECOND success, a DIFFERENT status so the same-status early return does not block it.
    // Deferred so the in-flight window is observable: the region must be EMPTY while the
    // second request is still in flight, which is what proves the clear happened at the
    // START of the handler rather than only alongside the set.
    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);

    await user.click(noButton());
    expect(region.textContent?.trim()).toBe('');

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'no', note: null });
      await write.promise;
    });

    await waitFor(() => expect(region.textContent?.trim()).toBe(SUCCESS_COPY));
    // The SAME node carried both announcements — never remounted.
    expect(screen.getByRole('status')).toBe(region);
  });

  it('CLEARS the success when a later write FAILS — the two regions cannot contradict', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const success = screen.getByRole('status');
    const failure = screen.getByRole('alert');

    // POSITIVE settle signal first: a success actually lands before the absence is asserted.
    await user.click(yesButton());
    await waitFor(() => expect(success.textContent?.trim()).toBe(SUCCESS_COPY));

    submitRsvp.mockRejectedValue(new Error('network down'));
    await user.click(noButton());

    await waitFor(() => expect(failure.textContent?.trim()).not.toBe(''));
    expect(success.textContent?.trim()).toBe('');
  });

  it('CLEARS the failure when a later write SUCCEEDS — the two regions cannot contradict', async () => {
    submitRsvp.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const success = screen.getByRole('status');
    const failure = screen.getByRole('alert');

    await user.click(yesButton());
    await waitFor(() => expect(failure.textContent?.trim()).not.toBe(''));

    submitRsvp.mockResolvedValue({ id: 'rsvp-own', status: 'no', note: null });
    await user.click(noButton());

    await waitFor(() => expect(success.textContent?.trim()).toBe(SUCCESS_COPY));
    expect(failure.textContent?.trim()).toBe('');
  });

  it('CLEARS the confirmation when the hero FLIPS to a different event', async () => {
    // A stale CONFIRMATION is worse than the stale error already closed in this plan: it
    // claims a response the user never gave for the event now on screen. The flip needs no
    // further interaction at all, which is why the clear lives in the eventId effect.
    const user = userEvent.setup();
    const { rerender } = render(
      <NextGameNightCard event={EVENT} selfUuid={SELF_UUID} onEventClick={vi.fn()} />
    );
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const region = screen.getByRole('status');
    expect(region.textContent?.trim()).toBe('');

    await user.click(yesButton());
    await waitFor(() => expect(region.textContent?.trim()).toBe(SUCCESS_COPY));

    const NEXT_EVENT = { ...EVENT, id: 'evt-2' };
    rerender(
      <NextGameNightCard event={NEXT_EVENT} selfUuid={SELF_UUID} onEventClick={vi.fn()} />
    );

    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledWith('evt-2'));
    expect(screen.getByRole('status')).toBe(region); // same node — never remounted
    await waitFor(() => expect(region.textContent?.trim()).toBe(''));
  });

  it('adds NO idle layout: the two regions share one parent, outside the spaced stack', async () => {
    // WHAT THIS PIN CAN AND CANNOT PROVE, stated rather than implied. jsdom computes no
    // layout, so rendered HEIGHT at 375px is NOT measurable here (registered as
    // `unrun-verify` in WINDOWS.md). What IS structural, and is the whole idle-delta risk:
    // the outer stack is `space-y-2`, whose `> * + *` rule would add an 8px margin to a
    // SECOND direct child even while that child is empty and zero-height. Both regions
    // therefore live inside ONE un-spaced wrapper, so the stack sees exactly one child and
    // the idle card is byte-identical to the shipped one.
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const success = screen.getByRole('status');
    const failure = screen.getByRole('alert');

    expect(success.textContent?.trim()).toBe('');
    expect(success.parentElement).toBe(failure.parentElement);
    expect(success.parentElement?.className ?? '').not.toMatch(/space-y|gap-|mt-|my-/);
  });

  it('renders the ratified copy VISIBLY — never sr-only (owner ruling 2026-09-14, arm 2)', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    const region = screen.getByRole('status');
    await user.click(yesButton());
    await waitFor(() => expect(region.textContent?.trim()).toBe(SUCCESS_COPY));

    // The rejected arm was `sr-only` for all three of the phase's new polite regions.
    expect(region).not.toHaveClass('sr-only');
    // And it is NOT re-inked to the error region's red — that ink is the failure's carrier.
    expect(region.className).not.toContain('text-content-status-error');
  });
});
