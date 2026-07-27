// Phase 88.2 plan 09 — component-level net over the rewritten Danger Zone.
//
// Pins three things that are easy to break silently:
//   SPEC-REQ-5  the real blast radius renders, sourced from the dedicated
//               endpoint (D-06), with a route to the transfer flow;
//   SPEC-REQ-6  the type-the-group-name gate and the native browser
//               confirmation are behaviorally unchanged, and NO new gate exists;
//   SPEC-REQ-7  nothing in the flow claims the delete is permanent — including
//               on the degraded path where the impact fetch failed.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's jsx-in-js transform hook handles the `.js` component under test.
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Read-only schedule panel does its own fetching and is irrelevant here.
vi.mock('@/app/components/PromptScheduleReadOnly', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      getGroupMembers: vi.fn(),
      getDeletionImpact: vi.fn(),
      deleteGroup: vi.fn(),
      leaveGroup: vi.fn(),
      updateGroupSettings: vi.fn(),
    },
  };
});

import GroupSettings from './GroupSettings';
import { groupsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_NAME = 'Tuesday Night Crew';

// Three members so `isOnlyMember` is false and the owner sees the normal
// (non-degenerate) Leave/Danger sections.
const ROSTER = [
  { id: 'a', user_id: 'auth0|owner', username: 'Owner', UserGroup: { role: 'owner' } },
  { id: 'b', user_id: 'auth0|b', username: 'Bee', UserGroup: { role: 'member' } },
  { id: 'c', user_id: 'auth0|c', username: 'Cee', UserGroup: { role: 'member' } },
];

const IMPACT = { member_count: 6, event_count: 37, recovery_window_days: 30 };

/** The three strings SPEC-REQ-7 forbids anywhere in the group-delete flow. */
const FORBIDDEN = ['cannot be undone', 'permanently remove', 'permanently delete'];

function renderSettings(
  overrides: Record<string, unknown> = {},
  group: Record<string, unknown> = { id: GROUP_ID, name: GROUP_NAME }
) {
  return render(
    <GroupSettings
      group={group}
      user={{ sub: 'auth0|owner' }}
      userRole="owner"
      onClose={vi.fn()}
      onUpdate={vi.fn()}
      onGroupDeleted={vi.fn()}
      onOpenManageMembers={vi.fn()}
      {...overrides}
    />
  );
}

/** The Danger Zone section element (the heading's containing block). */
function dangerZone(): HTMLElement {
  return screen.getByRole('heading', { name: 'Danger Zone' }).parentElement as HTMLElement;
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (groupsAPI.getDeletionImpact as Mock).mockResolvedValue(IMPACT);
  (groupsAPI.deleteGroup as Mock).mockResolvedValue({});
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SPEC-REQ-5 — the Danger Zone states the real blast radius', () => {
  it('renders the endpoint-supplied member count, event count and recovery window', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('6'));
    const text = dangerZone().textContent ?? '';
    expect(text).toContain('6');
    expect(text).toContain('37');
    expect(text).toContain('30 days');
  });

  it('offers transfer as the better path and routes to the transfer flow', async () => {
    const onOpenManageMembers = vi.fn();
    renderSettings({ onOpenManageMembers });
    const transfer = await within(dangerZone()).findByRole('button', {
      name: /transfer ownership instead/i,
    });
    fireEvent.click(transfer);
    // NOTE: this proves the COMPONENT, not the wiring. It passes even when a
    // call site forgets the prop — the call-site enumeration is task 2b's
    // criterion, not this test's. Do not read this green as coverage of it.
    expect(onOpenManageMembers).toHaveBeenCalledTimes(1);
  });

  it('degrades without the numbers when the impact fetch fails, but never disables delete', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockRejectedValue(new Error('boom'));
    renderSettings();
    const deleteBtn = await screen.findByRole('button', { name: 'Delete Group' });

    const text = dangerZone().textContent ?? '';
    expect(text).not.toMatch(/undefined|NaN/);
    expect(deleteBtn).toBeEnabled();

    // The recoverability half is UNCONDITIONAL. If the copy is written as one
    // block gated on the fetch, the degraded owner is told neither that the
    // delete is final nor that it is recoverable — and asserting only the
    // absence of undefined/NaN would let exactly that ship.
    expect(text).toContain('30 days');
    expect(text).toMatch(/change your mind/i);
    expect(text).toMatch(/emailed a link/i);
  });
});

describe('SPEC-REQ-7 — no permanence claim survives', () => {
  it('the rendered Danger Zone and the confirmation string make no permanence claim', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    const text = (dangerZone().textContent ?? '').toLowerCase();
    for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));
    fireEvent.change(screen.getByPlaceholderText('Type group name to confirm'), {
      target: { value: GROUP_NAME },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    const confirmArg = String(confirmSpy.mock.calls[0][0]).toLowerCase();
    for (const phrase of FORBIDDEN) expect(confirmArg).not.toContain(phrase);
  });

  it('the DEGRADED path is also clean, and still makes a recoverability claim', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockRejectedValue(new Error('boom'));
    renderSettings();
    await screen.findByRole('button', { name: 'Delete Group' });

    const text = (dangerZone().textContent ?? '').toLowerCase();
    for (const phrase of FORBIDDEN) expect(text).not.toContain(phrase);
    // Silent on BOTH permanence and recoverability is the failure mode here.
    expect(text).toMatch(/change your mind|bring it all back|take over the group/);
  });
});

describe('D-06 — counts come from the endpoint, once, and only for the owner', () => {
  it('fetches exactly once on render for an owner, and survives a re-render', async () => {
    const { rerender } = renderSettings();
    await waitFor(() => expect(groupsAPI.getDeletionImpact as Mock).toHaveBeenCalledTimes(1));
    expect(groupsAPI.getDeletionImpact as Mock).toHaveBeenCalledWith(GROUP_ID);

    // A FRESH object identity with the SAME id — what a parent re-render
    // produces. A `[group, userRole]` dependency array refetches here; a
    // `[group?.id, userRole]` one does not.
    rerender(
      <GroupSettings
        group={{ id: GROUP_ID, name: GROUP_NAME }}
        user={{ sub: 'auth0|owner' }}
        userRole="owner"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onGroupDeleted={vi.fn()}
        onOpenManageMembers={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeInTheDocument());
    expect(groupsAPI.getDeletionImpact as Mock).toHaveBeenCalledTimes(1);
  });

  it('never fetches for a member — the Danger Zone does not render at all', async () => {
    renderSettings({ userRole: 'member' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Danger Zone' })).toBeNull();
    expect(groupsAPI.getDeletionImpact as Mock).not.toHaveBeenCalled();
  });
});

describe('SPEC-REQ-6 — the existing friction is preserved, and nothing is added', () => {
  it('the confirm button unlocks only on an exact group-name match', async () => {
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('37'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));

    const input = screen.getByPlaceholderText('Type group name to confirm');
    const confirmBtn = screen.getByRole('button', { name: 'Delete Group' });

    expect(confirmBtn).toBeDisabled(); // empty
    fireEvent.change(input, { target: { value: 'Tuesday Night Crw' } });
    expect(confirmBtn).toBeDisabled(); // near miss
    fireEvent.change(input, { target: { value: GROUP_NAME } });
    expect(confirmBtn).toBeEnabled(); // exact

    // ...and the native confirmation is still the second gate: a refusal there
    // must stop the delete dead.
    confirmSpy.mockReturnValue(false);
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(groupsAPI.deleteGroup as Mock).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(groupsAPI.deleteGroup as Mock).toHaveBeenCalledWith(GROUP_ID));
  });

  it('a many-member group needs no extra acknowledgement step', async () => {
    (groupsAPI.getDeletionImpact as Mock).mockResolvedValue({
      member_count: 50,
      event_count: 12,
      recovery_window_days: 30,
    });
    renderSettings();
    await waitFor(() => expect(dangerZone().textContent).toContain('50'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));

    const zone = dangerZone();
    // Exactly one input (the name field) and no checkbox / extra acknowledgement.
    expect(within(zone).getAllByRole('textbox')).toHaveLength(1);
    expect(within(zone).queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText('Type group name to confirm'), {
      target: { value: GROUP_NAME },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));
    await waitFor(() => expect(groupsAPI.deleteGroup as Mock).toHaveBeenCalledWith(GROUP_ID));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
