// Phase 88-33 Task 2 (WI-F2) — draft participant integrity in the Create Event modal.
//
// Covers the four things the walk broke on: M5 (you could not type through a
// member's name), stable row identity (a middle-row removal donated its typed
// state to its neighbour), undo-on-remove (fork 4), and the duplicate-name hint
// (triage A1 — non-blocking by ruling).
//
// The modal's scheduling half is stubbed out: this file is about the
// participants list, and EventScheduler/heatmap pull in react-big-calendar.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// `vi.hoisted`: the vi.mock factory below is hoisted above module-level consts.
const fixtures = vi.hoisted(() => ({
  members: [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Alice', email: 'alice@example.com' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'Bob', email: 'bob@example.com' },
  ],
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', browserTimezone: 'America/New_York' }),
}));

// Scheduling surface — out of scope here and heavy to mount.
vi.mock('@/app/components/EventScheduler', () => ({ default: () => <div>scheduler</div> }));
vi.mock('@/app/components/EventHeatmapBackground', () => ({ default: () => null }));
vi.mock('@/app/components/GameComboInput', () => ({ default: () => <div>game input</div> }));
vi.mock('@/app/components/QuickSuggestions', () => ({ default: () => null }));
vi.mock('@/app/components/BallotOptionsEditor', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/useSwipeNavigation', () => ({ default: () => ({}) }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      ...actual.groupsAPI,
      getGroupMembers: vi.fn().mockResolvedValue(fixtures.members),
    },
    gamesAPI: { ...actual.gamesAPI, searchAll: vi.fn().mockResolvedValue([]) },
    eventsAPI: { ...actual.eventsAPI, createEvent: vi.fn().mockResolvedValue({}) },
    ballotAPI: { ...actual.ballotAPI, getBallot: vi.fn().mockResolvedValue(null) },
    availabilityAPI: {
      ...actual.availabilityAPI,
      getGroupHeatmap: vi.fn().mockResolvedValue({ slots: [], totalMembers: 0 }),
    },
    promptAPI: { ...actual.promptAPI, getPromptHeatmap: vi.fn().mockResolvedValue(null) },
  };
});

import CreateEvent from './createEvent';

/** Every visible participant-name input, in DOM order. */
function nameInputs(): HTMLInputElement[] {
  return screen.getAllByLabelText('Participant Name') as HTMLInputElement[];
}

/** The Remove button belonging to the Nth participant row. */
function removeButtons(): HTMLElement[] {
  return screen.getAllByTitle('Remove participant');
}

/** Row count. Member rows render read-only (no name input), so rows are counted
 *  by the per-row Score control, which every row carries. */
function rowCount(): number {
  return screen.getAllByLabelText('Score').length;
}

async function renderModal() {
  const view = render(
    <CreateEvent
      group_id="group-1"
      modal
      modaltoggle={vi.fn()}
      onEventCreated={vi.fn()}
      user={{ sub: 'auth0|self' }}
      hideVisualCalendar
      userRole="owner"
    />
  );
  // The member rows arrive with the group-members fetch.
  await screen.findByText('Alice');
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M5 — typing through a member name (UAT row 497)', () => {
  it('accepts the LAST character of an exact member name', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));

    const guest = nameInputs().find(i => i.value === '')!;
    expect(guest).toBeTruthy();

    // The walk's exact failure: "I type in Alic and then it won't let me type
    // the last e". Each keystroke replays the whole value, as a real input does.
    for (const value of ['A', 'Al', 'Ali', 'Alic', 'Alice']) {
      fireEvent.change(guest, { target: { value } });
    }
    expect(guest.value).toBe('Alice');

    // ...and then STRAIGHT THROUGH the boundary into a member-adjacent name.
    fireEvent.change(guest, { target: { value: 'Alice1' } });
    expect(guest.value).toBe('Alice1');
  });

  it('lets a second same-named guest be created (fork 3: duplicates allowed)', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const first = nameInputs().find(i => i.value === '')!;
    fireEvent.change(first, { target: { value: 'Bob' } });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const second = nameInputs().find(i => i.value === '')!;
    fireEvent.change(second, { target: { value: 'Bob' } });

    expect(nameInputs().filter(i => i.value === 'Bob')).toHaveLength(2);
  });
});

describe('duplicate-name hint (triage A1 — informational, never blocking)', () => {
  it('appears when a typed name collides and never disables submit', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const guest = nameInputs().find(i => i.value === '')!;
    fireEvent.change(guest, { target: { value: 'Alice' } });

    expect(
      await screen.findByText("Heads up: there's already a participant named Alice.")
    ).toBeInTheDocument();
    // Non-blocking: the field still holds the value and submit stays enabled.
    expect(guest.value).toBe('Alice');
    expect(screen.getByRole('button', { name: /Create Event/i })).not.toBeDisabled();
  });

  it('is absent for a unique name', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const guest = nameInputs().find(i => i.value === '')!;
    fireEvent.change(guest, { target: { value: 'Zonker' } });

    expect(screen.queryByText(/Heads up: there's already a participant/)).not.toBeInTheDocument();
  });
});

describe('stable row identity + undo (UAT rows 510, 557)', () => {
  it('removing a MIDDLE row leaves the survivors\' typed state attached to the right people', async () => {
    await renderModal();
    // Two guests after the two members: [Alice, Bob, G1, G2]
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    fireEvent.change(nameInputs().find(i => i.value === '')!, { target: { value: 'Gina' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    fireEvent.change(nameInputs().find(i => i.value === '')!, { target: { value: 'Hal' } });

    const scores = screen.getAllByLabelText('Score') as HTMLInputElement[];
    fireEvent.change(scores[2], { target: { value: '11' } }); // Gina
    fireEvent.change(scores[3], { target: { value: '22' } }); // Hal

    // Remove Bob (a MIDDLE row).
    fireEvent.click(removeButtons()[1]);

    await waitFor(() => expect(rowCount()).toBe(3));
    const after = screen.getAllByLabelText('Score') as HTMLInputElement[];
    // Gina and Hal keep THEIR scores — with index keys, Gina inherited Bob's row.
    expect(after[1].value).toBe('11');
    expect(after[2].value).toBe('22');
  });

  it('offers Undo, restores the row with its typed data, and puts focus on the control', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    fireEvent.change(nameInputs().find(i => i.value === '')!, { target: { value: 'Gina' } });
    const scores = screen.getAllByLabelText('Score') as HTMLInputElement[];
    fireEvent.change(scores[2], { target: { value: '11' } });
    const factions = screen.getAllByLabelText('Faction') as HTMLInputElement[];
    fireEvent.change(factions[2], { target: { value: 'Reds' } });

    fireEvent.click(removeButtons()[2]);

    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByText('Gina removed')).toBeInTheDocument();
    await waitFor(() => expect(undo).toHaveFocus());

    fireEvent.click(undo);

    await waitFor(() =>
      expect(nameInputs().some(i => i.value === 'Gina')).toBe(true)
    );
    const restoredScores = screen.getAllByLabelText('Score') as HTMLInputElement[];
    const restoredFactions = screen.getAllByLabelText('Faction') as HTMLInputElement[];
    expect(restoredScores[2].value).toBe('11');
    expect(restoredFactions[2].value).toBe('Reds');
    // Offer consumed.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('does NOT offer undo when the keep-at-least-one guard blocks the removal', async () => {
    await renderModal();
    // Drop to a single row, then try to remove it.
    fireEvent.click(removeButtons()[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss undo for Alice' }));
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.click(removeButtons()[0]);

    expect(rowCount()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('announces the removal politely', async () => {
    await renderModal();
    fireEvent.click(removeButtons()[1]);

    await waitFor(() => {
      const regions = screen.getAllByRole('status');
      expect(regions.some(r => r.textContent === 'Bob removed. Undo is available.')).toBe(true);
    });
  });
});
