/**
 * Req 6 / UI-SPEC §9.2 — `GroupGamesList`'s empty state, the one row the owner
 * re-approved (E-25).
 *
 * This surface gets its own file rather than a block in `emptyStates.split.test.tsx`
 * because what needs pinning here is different: the other five surfaces are guarded
 * against a fetch failure being dressed up as "nothing here yet", whereas this one
 * takes its list as a PROP and has no fetch of its own. What it needs guarding
 * against is the COPY drifting back to the shelf wording that UI-SPEC §9.2 carried
 * before the owner's ruling — copy that described `GroupLibrary`'s feature, not this
 * one. So the negative assertions below are the load-bearing half: they fail if
 * either the pre-88-18 hand-rolled line OR the rejected shelf row is restored.
 */
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));

import GroupGamesList from './GroupGamesList';

// Untyped JS component: spread a typed-any bag so JSX does not demand the
// unrelated props it destructures.
const anyProps = (p: Record<string, unknown>): any => p;

afterEach(cleanup);

describe('GroupGamesList empty state (§9.2, owner-ruled E-25)', () => {
  it('renders the owner-approved history copy, not the rejected shelf copy', () => {
    render(<GroupGamesList {...anyProps({ games: [], groupId: 'g1' })} />);

    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Log a night you played and the group's history builds up here."
      )
    ).toBeInTheDocument();

    // The pre-88-18 hand-rolled lines are gone.
    expect(screen.queryByText('No games played yet')).toBeNull();
    expect(screen.queryByText('Start tracking your game sessions!')).toBeNull();

    // E-25: the contract row this surface was originally given belonged to
    // GroupLibrary. If it ever lands here, that is the regression.
    expect(screen.queryByText('No games on the shelf yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });

  it('shows the CTA for an active member and wires it to onAddEvent', () => {
    const onAddEvent = vi.fn();
    render(
      <GroupGamesList
        {...anyProps({ games: [], groupId: 'g1', userRole: 'member', onAddEvent })}
      />
    );

    screen.getByRole('button', { name: 'Log a game night' }).click();
    expect(onAddEvent).toHaveBeenCalledTimes(1);
  });

  it('hides the CTA for a pending member and for a role-less viewer, keeping the copy', () => {
    const { rerender } = render(
      <GroupGamesList
        {...anyProps({
          games: [],
          groupId: 'g1',
          userRole: 'pending',
          onAddEvent: vi.fn(),
        })}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();

    // No role resolved yet — same gate, same outcome.
    rerender(
      <GroupGamesList
        {...anyProps({ games: [], groupId: 'g1', onAddEvent: vi.fn() })}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();
  });

  it('does not render the empty state when the group has played games', () => {
    render(
      <GroupGamesList
        {...anyProps({
          games: [{ id: 'game-1', name: 'Wingspan', play_count: 2 }],
          groupId: 'g1',
          userRole: 'member',
          onAddEvent: vi.fn(),
        })}
      />
    );

    expect(
      screen.queryByRole('heading', { name: 'No game nights logged yet' })
    ).toBeNull();
    expect(screen.getByRole('heading', { name: 'Group Games' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });
});
