// Phase 88.6 plan 22 task 2 — BallotSection's three action-failure announcements.
//
// WHY THIS FILE EXISTS (read before extending):
// `BallotSection.js` shipped with three bare conditional error `<p>`s — no id, no
// `aria-describedby`, no live region — and the file returned ZERO for the live-region
// grep. axe has NO rule for an unassociated error message, so no audit anywhere in this
// phase closes that; it has to be proven behaviourally, here.
//
// THE ASSERTION SHAPE IS DELIBERATE, and it is two separate claims:
//
//   1. ANNOUNCEMENT — the region is captured BEFORE the failure and asserted on as the
//      SAME NODE afterwards (`expect(after).toBe(before)`), the idiom
//      `StatusRegion.test.tsx:20-29` already uses. A presence check passes against a
//      CONDITIONALLY-mounted region, which is exactly the bug: screen readers announce a
//      CHANGE to a live region, never the conditional mount of a new one.
//   2. ASSOCIATION — the description is resolved FROM THE CHOICE BUTTON, a focusable
//      element, and the text is read back. An `aria-describedby` attribute asserted on the
//      role-less `space-y-2` wrapper would satisfy a presence check while producing zero
//      AT-observable effect, which is the outcome the plan's criterion exists to refuse.
//
// `.tsx` and this exact path are not negotiable: `vitest.config.mts:67` is
// `include: ['src/**/*.{test,spec}.{ts,tsx}']`, and `vitest run` treats a NAMED path that
// does not exist as a silent skip (exit 0) whenever another named path matches — so a
// suite written anywhere else, or spelled any other way, would evaporate with nothing
// going red.
import * as React from 'react';
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  ballotAPI: {
    getBallot: vi.fn(),
    toggleVote: vi.fn(),
    resolveTie: vi.fn(),
  },
}));

import BallotSection from './BallotSection';
import { ballotAPI } from '../../lib/api';

type Mock = ReturnType<typeof vi.fn>;

// Copy rows E12 and E13 (D-30), byte-equal to the ratified rows after the D-32 (R8) apostrophe
// normalisation.
const VOTE_FAILED = "We couldn't save your vote. Please try again.";
const WINNER_FAILED = "We couldn't set the winner. Please try again.";

const EVENT_ID = 'event-1';

const OPTIONS = [
  { id: 'opt-1', game_id: 'g1', game_name: 'Catan', user_voted: false },
  { id: 'opt-2', game_id: 'g2', game_name: 'Wingspan', user_voted: false },
];

const TIE_BREAK = {
  ballot_status: 'closed',
  rsvp_deadline: null,
  options: OPTIONS,
  winner: null,
  needs_tie_break: true,
  needs_fallback_pick: false,
  tied_options: OPTIONS,
};

const FALLBACK_PICK = { ...TIE_BREAK, needs_tie_break: false, needs_fallback_pick: true };

const OPEN_BALLOT = {
  ballot_status: 'open',
  rsvp_deadline: null,
  options: OPTIONS,
  winner: null,
  needs_tie_break: false,
  needs_fallback_pick: false,
  tied_options: [],
};

// Plan 88.6.1-31: a closed ballot whose tie the organizer has broken (the winner branch).
const WINNER = {
  ballot_status: 'closed',
  rsvp_deadline: null,
  options: OPTIONS,
  winner: { game_id: 'g1', game_name: 'Catan' },
  needs_tie_break: false,
  needs_fallback_pick: false,
  tied_options: null,
};

function renderBallot(ballot: Record<string, unknown>, props: Record<string, unknown> = {}) {
  (ballotAPI.getBallot as Mock).mockResolvedValue(ballot);
  return render(
    <BallotSection
      eventId={EVENT_ID}
      eventDate="2026-10-01"
      userRole="owner"
      userRsvpStatus="yes"
      {...props}
    />
  );
}

// Plan 88.6.1-31: queue one getBallot answer per entry, in order. A Promise entry is HELD until
// the test settles it; a function entry is called when the request is made (so a rejection is
// created only when it is consumed); a plain object resolves at once. Once the queue is spent,
// getBallot resolves undefined (the reset in beforeEach), which renders nothing.
type Answer = Record<string, unknown> | Promise<unknown> | (() => Promise<unknown>);
function queueBallots(answers: Answer[]) {
  const get = ballotAPI.getBallot as Mock;
  for (const answer of answers) {
    if (typeof answer === 'function') get.mockImplementationOnce(answer);
    else if (answer instanceof Promise) get.mockImplementationOnce(() => answer);
    else get.mockResolvedValueOnce(answer);
  }
}
function renderBallotSequence(answers: Answer[], props: Record<string, unknown> = {}) {
  queueBallots(answers);
  return render(
    <BallotSection
      eventId={EVENT_ID}
      eventDate="2026-10-01"
      userRole="owner"
      userRsvpStatus="yes"
      {...props}
    />
  );
}

// A promise the test settles by hand.
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Resolve a control's description the way assistive technology does, and read it back. */
function describedTextOf(control: Element): string {
  const ids = control.getAttribute('aria-describedby');
  if (!ids) return '';
  return ids
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Plan 88.6.1-31: clearAllMocks keeps implementations and queued Once answers, so a held or
  // unspent answer from one case would leak into the next. Every case sets what it needs.
  (ballotAPI.getBallot as Mock).mockReset();
  (ballotAPI.toggleVote as Mock).mockReset();
  (ballotAPI.resolveTie as Mock).mockReset();
});

afterEach(cleanup);

describe('BallotSection — the three action failures are announced and associated (88.6-22)', () => {
  it('mounts all three regions EMPTY and sr-only (no layout), each with its branch margin, one per branch', async () => {
    // Each branch renders exactly ONE of the three, so they are checked branch by branch.
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [TIE_BREAK, 'ballot-tiebreak-error', 'mb-2'],
      [FALLBACK_PICK, 'ballot-fallback-error', 'mb-2'],
      [OPEN_BALLOT, 'ballot-vote-error', 'mb-3'],
    ];
    for (const [ballot, id, margin] of cases) {
      renderBallot(ballot);
      await screen.findByRole('heading', { name: 'Game Vote' });
      const region = document.getElementById(id);
      expect(region, `${id} must be mounted before any failure`).not.toBeNull();
      expect(region).toHaveAttribute('role', 'status');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'true');
      expect(region).toHaveTextContent('');
      // Plan 88.6.1-31 (D-22): the empty region takes plan 06's srOnlyWhenEmpty, so it is out of
      // flow and adds NO visible space; its margin is now unconditional (the per-site ternary
      // is gone) and applies only once the region is visible.
      expect(region).toHaveClass('sr-only');
      expect(region).toHaveClass(margin);
      // These are ACTION failures, not field validation — no `aria-invalid` anywhere.
      expect(document.querySelectorAll('[aria-invalid]')).toHaveLength(0);
      cleanup();
    }
  });

  it('tie-break: injects the failure into the SAME node and the choice button resolves it', async () => {
    (ballotAPI.resolveTie as Mock).mockRejectedValue(new Error('boom'));
    renderBallot(TIE_BREAK);
    const choice = await screen.findByRole('button', { name: 'Catan' });
    const before = document.getElementById('ballot-tiebreak-error');
    expect(before).toHaveTextContent('');
    expect(choice).not.toHaveAttribute('aria-describedby');

    fireEvent.click(choice);

    await waitFor(() =>
      expect(document.getElementById('ballot-tiebreak-error')).toHaveTextContent(
        WINNER_FAILED
      )
    );
    const after = document.getElementById('ballot-tiebreak-error');
    expect(after).toBe(before); // node identity — never remounted
    expect(after).toHaveClass('mb-2');
    expect(after).not.toHaveClass('sr-only');

    // RESOLVED from the FOCUSABLE control, not asserted on a role-less wrapper.
    const described = screen.getByRole('button', { name: 'Catan' });
    expect(describedTextOf(described)).toContain(WINNER_FAILED);
    expect(described).not.toHaveAttribute('aria-invalid');
  });

  it('fallback pick: injects the failure into the SAME node and the choice button resolves it', async () => {
    (ballotAPI.resolveTie as Mock).mockRejectedValue(new Error('boom'));
    renderBallot(FALLBACK_PICK);
    const choice = await screen.findByRole('button', { name: 'Wingspan' });
    const before = document.getElementById('ballot-fallback-error');
    expect(before).toHaveTextContent('');

    fireEvent.click(choice);

    await waitFor(() =>
      expect(document.getElementById('ballot-fallback-error')).toHaveTextContent(
        WINNER_FAILED
      )
    );
    expect(document.getElementById('ballot-fallback-error')).toBe(before);
    expect(before).toHaveClass('mb-2');
    expect(before).not.toHaveClass('sr-only');
    expect(describedTextOf(screen.getByRole('button', { name: 'Wingspan' }))).toContain(
      WINNER_FAILED
    );
  });

  it('open ballot: a failed vote toggle announces on the SAME node and the option resolves it', async () => {
    (ballotAPI.toggleVote as Mock).mockRejectedValue(new Error('boom'));
    renderBallot(OPEN_BALLOT);
    const choice = await screen.findByRole('button', { name: 'Catan' });
    const before = document.getElementById('ballot-vote-error');
    expect(before).toHaveTextContent('');

    fireEvent.click(choice);

    await waitFor(() =>
      expect(document.getElementById('ballot-vote-error')).toHaveTextContent(
        VOTE_FAILED
      )
    );
    const after = document.getElementById('ballot-vote-error');
    expect(after).toBe(before);
    expect(after).toHaveClass('mb-3');
    expect(after).not.toHaveClass('sr-only');
    expect(describedTextOf(screen.getByRole('button', { name: 'Catan' }))).toContain(
      VOTE_FAILED
    );
  });
});

describe('BallotSection — focus and the in-flight gate (88.6-22)', () => {
  const HOUSE_RING = 'focus-visible:ring-2';

  it('every button in the file carries the house focus string', async () => {
    // Measured baseline at HEAD before this sweep: 3 `<button>` elements, 0 `focus-visible`.
    // This is a CONVERGENCE gap, not a WCAG failure — no global outline reset exists in this
    // codebase, so the UA ring still painted. One rationale for all three.
    for (const ballot of [TIE_BREAK, FALLBACK_PICK, OPEN_BALLOT]) {
      renderBallot(ballot);
      await screen.findByRole('heading', { name: 'Game Vote' });
      const buttons = Array.from(document.querySelectorAll('button'));
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) {
        expect(b.className, `${b.textContent} carries no focus-visible ring`).toContain(
          HOUSE_RING
        );
        expect(b.className).toContain('focus:outline-hidden');
        expect(b.className).toContain('focus-visible:ring-focus-ring');
        expect(b.className).toContain('focus-visible:ring-offset-2');
      }
      cleanup();
    }
  });

  it('the PRESSED option keeps focus while its own vote is in flight; its siblings do not', async () => {
    let release: (value: unknown) => void = () => {};
    (ballotAPI.toggleVote as Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );
    const user = userEvent.setup();
    renderBallot(OPEN_BALLOT);
    const pressed = await screen.findByRole('button', { name: /Catan/ });

    await user.click(pressed);

    // The rule of POSITION: the control the user is standing on stays in the focus order.
    expect(pressed).toHaveAttribute('aria-disabled', 'true');
    expect(pressed).not.toHaveAttribute('disabled');
    expect(pressed).toBeInTheDocument();
    expect(document.activeElement).toBe(pressed);

    // Its siblings — which nobody is standing on — keep the native attribute.
    const sibling = screen.getByRole('button', { name: /Wingspan/ });
    expect(sibling).toBeDisabled();
    expect(sibling).not.toHaveAttribute('aria-disabled');

    // The shipped in-flight cue is unchanged.
    expect(pressed.className).toContain('opacity-70');
    expect(sibling.className).toContain('opacity-50');

    // `handleToggleVote`'s existing synchronous refusal still holds.
    fireEvent.click(pressed);
    fireEvent.click(pressed);
    expect(ballotAPI.toggleVote).toHaveBeenCalledTimes(1);

    release({});
    await waitFor(() => expect(screen.getByRole('button', { name: /Catan/ })).not.toBeDisabled());
  });
});

// Plan 88.6.1-31 Task 1 (W013 / D-35, E14, Req 5). The pick buttons in the tie-break and the
// fallback lists both call one handler. What these cases prove about E14 is the pick's
// accessible NAME while it saves, which is what a screen reader reads when focus arrives on the
// pick or the user re-reads it. Whether a screen reader speaks the rename UNPROMPTED while focus
// already sits on the pick is NOT measured here (jsdom has no speech); that is owed to plan
// 88.6.1-57's VoiceOver walk (review #191).
//
// jsdom never blurs a disabled element (FE-TESTING-CONVENTIONS C-11), so the RED half of T1a and
// T1b is the attributes and the request count, never document.activeElement. T1e and T1f ARE
// focus tests, because there the focused control is REMOVED, which jsdom does observe.
describe('BallotSection — one pick per press, the heard in-flight name, and focus after the pick (88.6.1-31)', () => {
  it('T1a: a tie-break pick in flight keeps its place (aria-disabled, never native), is NAMED "Catan, saving", and a second and third press send nothing', async () => {
    const hold = deferred();
    (ballotAPI.resolveTie as Mock).mockImplementationOnce(() => hold.promise);
    const user = userEvent.setup();
    renderBallot(TIE_BREAK);
    const catan = await screen.findByRole('button', { name: 'Catan' });
    const wingspan = screen.getByRole('button', { name: 'Wingspan' });

    await user.click(catan);

    expect(catan).toHaveAttribute('aria-disabled', 'true');
    expect(catan).not.toHaveAttribute('disabled');
    expect(catan).toBeInTheDocument();
    expect(catan).toHaveAccessibleName('Catan, saving');
    expect(wingspan).toBeDisabled();
    expect(wingspan).not.toHaveAttribute('aria-disabled');

    fireEvent.click(catan);
    fireEvent.click(catan);
    expect(ballotAPI.resolveTie).toHaveBeenCalledTimes(1);
    expect(catan).toHaveAttribute('aria-disabled', 'true');
    expect(catan).toHaveAccessibleName('Catan, saving');

    await act(async () => {
      hold.resolve({ winner: { game_id: 'g1', game_name: 'Catan' } });
    });
    await waitFor(() => expect(catan).not.toHaveAttribute('aria-disabled'));
    expect(catan).not.toHaveAttribute('disabled');
    expect(catan).not.toHaveAttribute('aria-label');
    expect(catan).toHaveAccessibleName('Catan');
    expect(wingspan).not.toBeDisabled();
    expect(wingspan).toHaveAccessibleName('Wingspan');
  });

  it('T1b: a fallback pick in flight keeps its place (aria-disabled, never native), is NAMED "Wingspan, saving", and a second and third press send nothing', async () => {
    const hold = deferred();
    (ballotAPI.resolveTie as Mock).mockImplementationOnce(() => hold.promise);
    const user = userEvent.setup();
    renderBallot(FALLBACK_PICK);
    const wingspan = await screen.findByRole('button', { name: 'Wingspan' });
    const catan = screen.getByRole('button', { name: 'Catan' });

    await user.click(wingspan);

    expect(wingspan).toHaveAttribute('aria-disabled', 'true');
    expect(wingspan).not.toHaveAttribute('disabled');
    expect(wingspan).toBeInTheDocument();
    expect(wingspan).toHaveAccessibleName('Wingspan, saving');
    expect(catan).toBeDisabled();
    expect(catan).not.toHaveAttribute('aria-disabled');

    fireEvent.click(wingspan);
    fireEvent.click(wingspan);
    expect(ballotAPI.resolveTie).toHaveBeenCalledTimes(1);
    expect(wingspan).toHaveAttribute('aria-disabled', 'true');
    expect(wingspan).toHaveAccessibleName('Wingspan, saving');

    await act(async () => {
      hold.resolve({ winner: { game_id: 'g2', game_name: 'Wingspan' } });
    });
    await waitFor(() => expect(wingspan).not.toHaveAttribute('aria-disabled'));
    expect(wingspan).not.toHaveAttribute('disabled');
    expect(wingspan).toHaveAccessibleName('Wingspan');
    expect(catan).not.toBeDisabled();
    expect(catan).toHaveAccessibleName('Catan');
  });

  it('T1c: two presses dispatched inside ONE act send ONE resolveTie (the latch is a ref, not state)', async () => {
    const hold = deferred();
    (ballotAPI.resolveTie as Mock).mockImplementation(() => hold.promise);
    renderBallot(TIE_BREAK);
    const catan = await screen.findByRole('button', { name: 'Catan' });

    // No re-render runs between these two dispatches, so the second press runs the SAME
    // closure as the first: a state-only first-line check cannot refuse it.
    act(() => {
      catan.click();
      catan.click();
    });
    expect(ballotAPI.resolveTie).toHaveBeenCalledTimes(1);

    await act(async () => {
      hold.resolve({});
    });
  });

  it('T1d: two vote presses dispatched inside ONE act send ONE toggleVote (probe: RED on the state-only guard, so the toggle takes a ref latch)', async () => {
    const hold = deferred();
    (ballotAPI.toggleVote as Mock).mockImplementation(() => hold.promise);
    renderBallot(OPEN_BALLOT);
    const catan = await screen.findByRole('button', { name: 'Catan' });

    act(() => {
      catan.click();
      catan.click();
    });
    expect(ballotAPI.toggleVote).toHaveBeenCalledTimes(1);

    await act(async () => {
      hold.resolve({ voted: true });
    });
  });

  it('T1e: a successful pick moves focus to the winner card only AFTER the refetch removes the pick, never to <body> (Req 5, R5 ordering backstop)', async () => {
    const refetch = deferred();
    (ballotAPI.resolveTie as Mock).mockResolvedValueOnce({ winner: { game_id: 'g1', game_name: 'Catan' } });
    const user = userEvent.setup();
    renderBallotSequence([TIE_BREAK, refetch.promise]);
    const catan = await screen.findByRole('button', { name: 'Catan' });

    await user.click(catan);
    await waitFor(() => expect(ballotAPI.getBallot).toHaveBeenCalledTimes(2));

    // resolveTie has resolved; the refetch is held. Nothing has moved yet.
    expect(document.activeElement).toBe(catan);
    expect(catan).toHaveAttribute('aria-disabled', 'true');
    expect(catan).toHaveAccessibleName('Catan, saving');

    await act(async () => {
      refetch.resolve(WINNER);
    });
    await waitFor(() => {
      const active = document.activeElement;
      expect(active).not.toBe(document.body);
      expect(active?.textContent).toContain('Winner');
      expect(active?.textContent).toContain('Catan');
    });
    expect(catan).not.toBeInTheDocument();
  });

  it('T1f: a failed vote whose refetch shows the tie-break moves focus to the Game Vote heading, never <body> (Req 5, R5 empty)', async () => {
    (ballotAPI.toggleVote as Mock).mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderBallotSequence([OPEN_BALLOT, TIE_BREAK]);
    const option = await screen.findByRole('button', { name: 'Catan' });

    await user.click(option);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Game Vote' }))
    );
    expect(option).not.toBeInTheDocument();
    // Extension (review #193): the branch change IS the outcome. E12 must not land in the
    // tie-break region, which the picks name as their description.
    expect(document.getElementById('ballot-tiebreak-error')?.textContent).toBe('');
    for (const pick of screen.getAllByRole('button')) {
      expect(pick).not.toHaveAttribute('aria-describedby');
    }
  });

  it('T1h: a pick pressed by a click that does not focus it (Safari) still lands focus on the winner card (contract (1), from: the pressed control)', async () => {
    // fireEvent.click dispatches the click WITHOUT focusing the button, as Safari does for a
    // mouse click. The arm is seeded from the pressed control itself, so the removal is still
    // recovered. Without that seed the hook watches nothing and focus stays on <body>.
    const refetch = deferred();
    (ballotAPI.resolveTie as Mock).mockResolvedValueOnce({ winner: { game_id: 'g1', game_name: 'Catan' } });
    renderBallotSequence([TIE_BREAK, refetch.promise]);
    const catan = await screen.findByRole('button', { name: 'Catan' });
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(catan);
    await waitFor(() => expect(ballotAPI.getBallot).toHaveBeenCalledTimes(2));
    await act(async () => {
      refetch.resolve(WINNER);
    });
    await waitFor(() => {
      const active = document.activeElement;
      expect(active).not.toBe(document.body);
      expect(active?.textContent).toContain('Winner');
    });
  });

  it('T1g: a game name holding quotes and an emoji is NAMED exactly "{name}, saving" while in flight, and its visible text is unchanged', async () => {
    const fancy = { id: 'opt-3', game_id: 'g3', game_name: 'Ticket to Ride: "Europe" 🚂', user_voted: false };
    const hold = deferred();
    (ballotAPI.resolveTie as Mock).mockImplementationOnce(() => hold.promise);
    const user = userEvent.setup();
    renderBallot({ ...TIE_BREAK, options: [fancy, OPTIONS[1]], tied_options: [fancy, OPTIONS[1]] });
    const pick = await screen.findByRole('button', { name: 'Ticket to Ride: "Europe" 🚂' });

    await user.click(pick);

    expect(pick).toHaveAttribute('aria-label', 'Ticket to Ride: "Europe" 🚂, saving');
    expect(pick).toHaveAccessibleName('Ticket to Ride: "Europe" 🚂, saving');
    expect(pick.textContent).toBe('Ticket to Ride: "Europe" 🚂');

    await act(async () => {
      hold.resolve({});
    });
  });
});

// Plan 88.6.1-31 Task 2 (W005 / D-26). On a phone the most common vote failure is "no network",
// so the follow-up refetch fails too. A failed refetch keeps the ballot already on screen ONLY
// when it was loaded for the same eventId; a superseded request (a newer load started, or its
// eventId is no longer current) touches no state at all.
const rejectOffline = () => Promise.reject(new Error('offline'));

// A second event's tie-break, whose option names (and ids) differ from event-1's.
const EVENT2_OPTIONS = [
  { id: 'opt-9', game_id: 'g9', game_name: 'Azul', user_voted: false },
  { id: 'opt-8', game_id: 'g8', game_name: 'Root', user_voted: false },
];
const EVENT2_TIE_BREAK = { ...TIE_BREAK, options: EVENT2_OPTIONS, tied_options: EVENT2_OPTIONS };

function ballotProps(eventId: string, extra: Record<string, unknown> = {}) {
  return { eventId, eventDate: '2026-10-01', userRole: 'owner', userRsvpStatus: 'yes', ...extra };
}

describe('BallotSection — a failed vote keeps the card, and a late answer changes nothing (88.6.1-31 W005)', () => {
  it('T2a: a vote that fails while its refetch fails too keeps the card, shows the option unvoted, and says E12 on the SAME region', async () => {
    (ballotAPI.toggleVote as Mock).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderBallotSequence([OPEN_BALLOT, rejectOffline]);
    const option = await screen.findByRole('button', { name: 'Catan' });
    const before = document.getElementById('ballot-vote-error');
    expect(before).not.toBeNull();

    await user.click(option);

    await waitFor(() =>
      expect(document.getElementById('ballot-vote-error')).toHaveTextContent(VOTE_FAILED)
    );
    expect(document.getElementById('ballot-vote-error')).toBe(before);
    expect(screen.getByRole('heading', { name: 'Game Vote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Catan/ }).textContent).not.toContain('Voted');
  });

  it('T2b: a pick the server stored, whose refetch fails, shows the server winner, no picks, and no E13', async () => {
    (ballotAPI.resolveTie as Mock).mockResolvedValueOnce({ winner: { game_id: 'g2', game_name: 'Wingspan' } });
    const user = userEvent.setup();
    renderBallotSequence([TIE_BREAK, rejectOffline]);
    const wingspan = await screen.findByRole('button', { name: 'Wingspan' });

    await user.click(wingspan);

    await screen.findByText('Winner');
    expect(screen.getByText('Wingspan')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/We couldn't set the winner/)).toBeNull();
  });

  it('T2c (confirm-only): a failed load for a DIFFERENT eventId never shows the previous event ballot', async () => {
    queueBallots([OPEN_BALLOT, rejectOffline]);
    const { rerender } = render(<BallotSection {...ballotProps('event-1')} />);
    await screen.findByRole('heading', { name: 'Game Vote' });

    rerender(<BallotSection {...ballotProps('event-2')} />);

    await waitFor(() => expect(ballotAPI.getBallot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Game Vote' })).toBeNull());
    expect(screen.queryByRole('button', { name: /Catan/ })).toBeNull();
  });

  it('T2d (held-out backstop): the same failure twice is a real text mutation on the SAME region node', async () => {
    (ballotAPI.resolveTie as Mock).mockRejectedValue(new Error('boom'));
    renderBallot(TIE_BREAK);
    fireEvent.click(await screen.findByRole('button', { name: 'Catan' }));
    await waitFor(() =>
      expect(document.getElementById('ballot-tiebreak-error')).toHaveTextContent(WINNER_FAILED)
    );
    const region = document.getElementById('ballot-tiebreak-error') as HTMLElement;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    fireEvent.click(screen.getByRole('button', { name: 'Catan' }));

    await waitFor(() => expect(ballotAPI.resolveTie).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(records.some((r) => r.type === 'childList' || r.type === 'characterData')).toBe(true)
    );
    await waitFor(() => expect(region).toHaveTextContent(WINNER_FAILED));
    expect(document.getElementById('ballot-tiebreak-error')).toBe(region);
    observer.disconnect();
  });

  it('T2e: a superseded load that FAILS last never wipes the current event ballot (review #141)', async () => {
    const first = deferred();
    queueBallots([first.promise, TIE_BREAK]);
    const { rerender } = render(<BallotSection {...ballotProps('event-1')} />);
    rerender(<BallotSection {...ballotProps('event-2')} />);
    await screen.findByRole('button', { name: 'Catan' });

    await act(async () => {
      first.reject(new Error('late failure'));
    });

    expect(screen.getByRole('heading', { name: 'Game Vote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the game vote")).toBeNull();
  });

  it('T2f: a superseded load that SUCCEEDS last never replaces the current event ballot (review #141)', async () => {
    const first = deferred();
    queueBallots([first.promise, TIE_BREAK]);
    const { rerender } = render(<BallotSection {...ballotProps('event-1')} />);
    rerender(<BallotSection {...ballotProps('event-2')} />);
    await screen.findByRole('button', { name: 'Catan' });

    await act(async () => {
      first.resolve(EVENT2_TIE_BREAK);
    });

    expect(screen.queryByRole('button', { name: 'Azul' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('T2g: a free-text pick (game_id null) whose refetch fails shows NO winner the server never kept, keeps the picks, and claims no E13 (review #129)', async () => {
    (ballotAPI.resolveTie as Mock).mockResolvedValueOnce({ winner: { game_id: null, game_name: 'Catan' } });
    const user = userEvent.setup();
    renderBallotSequence([TIE_BREAK, rejectOffline]);
    const catan = await screen.findByRole('button', { name: 'Catan' });

    await user.click(catan);

    await waitFor(() => expect(ballotAPI.getBallot).toHaveBeenCalledTimes(2));
    // Positive signal first: the sibling pick is re-enabled once the flight settles.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Wingspan' })).not.toBeDisabled());
    expect(screen.queryByText('Winner')).toBeNull();
    expect(screen.getByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(document.getElementById('ballot-tiebreak-error')?.textContent).toBe('');
  });

  it('T2h: when a vote saves but its refetch fails, the option shows the vote the SERVER took (review #131)', async () => {
    (ballotAPI.toggleVote as Mock).mockResolvedValueOnce({ voted: false });
    const user = userEvent.setup();
    renderBallotSequence([OPEN_BALLOT, rejectOffline]);
    const option = await screen.findByRole('button', { name: 'Catan' });

    await user.click(option);

    await waitFor(() => expect(ballotAPI.getBallot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /Wingspan/ })).not.toBeDisabled());
    expect(screen.getByRole('heading', { name: 'Game Vote' })).toBeInTheDocument();
    const pressed = screen.getByRole('button', { name: /Catan/ });
    expect(pressed.textContent).not.toContain('Voted');
  });

  it('T2i: a pick pressed on event-1 never paints onto event-2 when the event changes mid-pick (review r3 M-23)', async () => {
    const hold = deferred();
    (ballotAPI.resolveTie as Mock).mockImplementationOnce(() => hold.promise);
    // The default first, then the queue: any getBallot after the two queued answers would
    // paint WINNER, which is what the stale-closure refetch must never get to do.
    (ballotAPI.getBallot as Mock).mockResolvedValue(WINNER);
    queueBallots([TIE_BREAK, EVENT2_TIE_BREAK]);
    const user = userEvent.setup();
    const { rerender } = render(<BallotSection {...ballotProps('event-1')} />);
    await user.click(await screen.findByRole('button', { name: 'Catan' }));

    rerender(<BallotSection {...ballotProps('event-2')} />);
    await screen.findByRole('button', { name: 'Azul' });

    await act(async () => {
      hold.resolve({ winner: { game_id: 'g1', game_name: 'Catan' } });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Azul' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument();
    expect(screen.queryByText('Winner')).toBeNull();
    expect(document.getElementById('ballot-tiebreak-error')?.textContent).toBe('');
    // The stale-closure refetch for event-1 sends no GET.
    expect(ballotAPI.getBallot).toHaveBeenCalledTimes(2);
  });
});
