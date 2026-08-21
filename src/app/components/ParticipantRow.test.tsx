// Phase 88-33 Task 2 (WI-F2) — ParticipantRow's own contract.
//
// The M5 clobber had TWO halves: a stale-closure parent AND a row that fired two
// updates in one tick. createEvent.participants.test.tsx pins the user-visible
// outcome; this file pins the row's half of the mechanism directly, so a future
// refactor that re-splits the atomic patch fails HERE with a precise message
// rather than as a mysterious typing bug two files away.
import * as React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ParticipantRow from './ParticipantRow';

const MEMBERS = [
  { id: 'uuid-alice', username: 'Alice', email: 'alice@example.com' },
  { id: 'uuid-bob', username: 'Bob', email: 'bob@example.com' },
];

function renderRow(overrides: Record<string, unknown> = {}) {
  const onParticipantChange = vi.fn();
  const onToggleParticipant = vi.fn();
  render(
    <ParticipantRow
      participant={{ user_id: '', username: '', score: null, faction: '', isFromGroup: false }}
      index={2}
      groupMembers={MEMBERS}
      onParticipantChange={onParticipantChange}
      onToggleParticipant={onToggleParticipant}
      {...overrides}
    />
  );
  return { onParticipantChange, onToggleParticipant };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('name edits are ONE atomic patch (M5 mechanism)', () => {
  it('emits a single call carrying username AND the resolved user_id on a member match', () => {
    const { onParticipantChange } = renderRow();
    fireEvent.change(screen.getByLabelText('Participant Name'), { target: { value: 'Alice' } });

    expect(onParticipantChange).toHaveBeenCalledTimes(1);
    expect(onParticipantChange).toHaveBeenCalledWith(2, {
      username: 'Alice',
      user_id: 'uuid-alice',
    });
  });

  it('also emits a SINGLE call on the no-match branch (it double-fired too)', () => {
    const { onParticipantChange } = renderRow({
      participant: { user_id: 'uuid-alice', username: 'Alice', isFromGroup: false },
    });
    fireEvent.change(screen.getByLabelText('Participant Name'), { target: { value: 'Alice1' } });

    expect(onParticipantChange).toHaveBeenCalledTimes(1);
    expect(onParticipantChange).toHaveBeenCalledWith(2, { username: 'Alice1', user_id: '' });
  });

  it('still emits field-shaped calls for the other controls', () => {
    const { onParticipantChange } = renderRow();
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '7' } });
    expect(onParticipantChange).toHaveBeenCalledWith(2, 'score', '7');
  });
});

describe('duplicate-name hint (triage A1)', () => {
  it('renders the hint and wires it as the input description', () => {
    renderRow({
      participant: { user_id: '', username: 'Gary', isFromGroup: false },
      duplicateOfName: 'Gary',
    });
    const hint = screen.getByText("Heads up: there's already a participant named Gary.");
    expect(hint).toBeInTheDocument();
    expect(screen.getByLabelText('Participant Name')).toHaveAttribute(
      'aria-describedby',
      hint.id
    );
  });

  it('keeps the live region mounted-but-empty when there is no duplicate', () => {
    renderRow();
    // Empty-first contract (StatusRegion.tsx): a region that mounts WITH its
    // message announces nothing.
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByLabelText('Participant Name')).not.toHaveAttribute('aria-describedby');
  });
});

describe('the dead invite affordance is gone (step 4b disposition)', () => {
  it('renders no Invite-to-group control even for a guest row', () => {
    renderRow({
      participant: { user_id: '', username: 'Gina', is_guest: true, isFromGroup: false },
    });
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

// 88-33 Task 6 (fork 2, RULED 2026-08-17): entry-time cap + wrap-not-truncate layout.
describe('name cap + long-name layout (WI-F6)', () => {
  const FIFTY = 'A'.repeat(50);

  it('caps the participant name input at 50 characters (fork 2 — person cap)', () => {
    renderRow();
    expect(screen.getByLabelText('Participant Name')).toHaveAttribute('maxlength', '50');
  });

  it('renders a max-length member name in FULL — inline flow, no truncation class', () => {
    renderRow({
      participant: {
        user_id: 'uuid-alice',
        username: FIFTY,
        is_guest: true,
        isFromGroup: true,
      },
    });
    const nameNode = screen.getByText(FIFTY, { exact: false });
    // Wrap-in-full, never truncate: the display container breaks words and
    // carries NO truncate/ellipsis class anywhere up the chain.
    const container = nameNode.closest('div')!;
    expect(container.className).toContain('break-words');
    expect(container.className).not.toContain('truncate');
    // Inline flow (not flex): the Guest pill is a text-flow sibling that rides
    // after the last word instead of dropping to its own flex line.
    expect(container.className).not.toContain('flex');
    const pill = screen.getByText('Guest');
    expect(pill.parentElement).toBe(container);
    expect(pill.className).toContain('align-middle');
  });

  it('the action cluster meets the 44px floor (min-h-11 — same-plan consistency with Task 5)', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Remove' }).className).toContain('min-h-11');
  });
});
