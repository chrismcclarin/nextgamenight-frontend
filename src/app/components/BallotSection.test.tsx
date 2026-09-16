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
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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
});

afterEach(cleanup);

describe('BallotSection — the three action failures are announced and associated (88.6-22)', () => {
  it('mounts all three regions EMPTY, with no margin, one per branch', async () => {
    // Each branch renders exactly ONE of the three, so they are checked branch by branch.
    const cases: Array<[Record<string, unknown>, string]> = [
      [TIE_BREAK, 'ballot-tiebreak-error'],
      [FALLBACK_PICK, 'ballot-fallback-error'],
      [OPEN_BALLOT, 'ballot-vote-error'],
    ];
    for (const [ballot, id] of cases) {
      renderBallot(ballot);
      await screen.findByRole('heading', { name: 'Game Vote' });
      const region = document.getElementById(id);
      expect(region, `${id} must be mounted before any failure`).not.toBeNull();
      expect(region).toHaveAttribute('role', 'status');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'true');
      expect(region).toHaveTextContent('');
      // The empty region must add NO visible space: the shipped `mb-2`/`mb-3` applies
      // only when filled.
      expect(region).not.toHaveClass('mb-2');
      expect(region).not.toHaveClass('mb-3');
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
        'Could not set the winner. Please try again.'
      )
    );
    const after = document.getElementById('ballot-tiebreak-error');
    expect(after).toBe(before); // node identity — never remounted
    expect(after).toHaveClass('mb-2');

    // RESOLVED from the FOCUSABLE control, not asserted on a role-less wrapper.
    const described = screen.getByRole('button', { name: 'Catan' });
    expect(describedTextOf(described)).toContain('Could not set the winner. Please try again.');
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
        'Could not set the winner. Please try again.'
      )
    );
    expect(document.getElementById('ballot-fallback-error')).toBe(before);
    expect(describedTextOf(screen.getByRole('button', { name: 'Wingspan' }))).toContain(
      'Could not set the winner. Please try again.'
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
        'Could not save your vote. Please try again.'
      )
    );
    const after = document.getElementById('ballot-vote-error');
    expect(after).toBe(before);
    expect(after).toHaveClass('mb-3');
    expect(describedTextOf(screen.getByRole('button', { name: 'Catan' }))).toContain(
      'Could not save your vote. Please try again.'
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
