// Phase 88.2 fix-commit re-review R-8 — the net over the bell's L-8 fix.
//
// L-8 shipped two things with zero coverage: the 410 dead-group handling on
// invite Accept/Decline (a group soft-deleted under a pending invite now
// returns 410 from the liveness gate), and the confirmation refactor from a
// bare string to `{ text, tone }` so the "no longer available" notice does not
// render in success-green. Both regress silently without this file: a revert
// to the string shape renders an EMPTY banner (`confirmation.text` is
// undefined) while every other suite stays green.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's jsx-in-js transform hook handles the `.js` component under test.
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    invitesAPI: {
      acceptInvite: vi.fn(),
      declineInvite: vi.fn(),
    },
  };
});

const { unreadState, setInvitesMock } = vi.hoisted(() => ({
  unreadState: {
    invites: [] as Array<Record<string, unknown>>,
    friendRequests: [] as Array<Record<string, unknown>>,
    totalCount: 0,
    loading: false,
  },
  setInvitesMock: vi.fn(),
}));

vi.mock('./UnreadNotificationProvider', () => ({
  useUnreadNotificationCount: () => ({
    invites: unreadState.invites,
    friendRequests: unreadState.friendRequests,
    totalCount: unreadState.totalCount,
    loading: unreadState.loading,
    setInvites: setInvitesMock,
  }),
}));

vi.mock('./FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({
    acceptRequest: vi.fn(),
    declineRequest: vi.fn(),
  }),
}));

import NotificationBell from './NotificationBell';
import { invitesAPI, ApiError } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const acceptInvite = () => invitesAPI.acceptInvite as unknown as Mock;
const declineInvite = () => invitesAPI.declineInvite as unknown as Mock;

const GROUP_NAME = 'Tuesday Night Crew';
const INVITE = { id: 'inv-1', Group: { name: GROUP_NAME }, Inviter: { username: 'Bee' } };

/** The 88.2 liveness-gate rejection: the group was soft-deleted under the invite. */
function deadGroupError() {
  return new ApiError('This group is no longer available.', 'gone', 410, {
    error: 'This group is no longer available.',
  });
}

/**
 * The component is untyped JS, so tsc infers `label` (defaulted only at the
 * use site) as required — pass it explicitly. Icon variant ignores it.
 */
function renderBell() {
  return render(<NotificationBell user={{ sub: 'auth0|me' }} label={undefined} />);
}

async function openBell() {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(await screen.findByText('Group Invites')).toBeInTheDocument();
}

/** Apply the functional updater handed to setInvites and return the result. */
function applyLastUpdater(prev: Array<Record<string, unknown>>) {
  const updater = setInvitesMock.mock.calls.at(-1)?.[0] as
    | ((p: Array<Record<string, unknown>>) => Array<Record<string, unknown>>)
    | undefined;
  expect(typeof updater).toBe('function');
  return updater!(prev);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  unreadState.invites = [INVITE];
  unreadState.friendRequests = [];
  unreadState.totalCount = 1;
  unreadState.loading = false;
});

afterEach(() => {
  cleanup();
});

describe('L-8 — a dead-group 410 on the pending invite', () => {
  it('Accept: drops the invite and shows the muted "no longer available" notice', async () => {
    acceptInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    const notice = await screen.findByText(`${GROUP_NAME} is no longer available.`);
    // The tone half of the refactor: a dead group is NOT a success. Muted
    // styling, never success-green.
    expect(notice.className).toContain('text-content-muted');
    // Both token names are asserted, not just the current one: after the Phase 88.3 Req 6
    // sweep the destination is `text-content-status-success`, and pinning ONLY that would
    // leave a revert to the legacy class passing this test.
    expect(notice.className).not.toContain('text-content-status-success');
    expect(notice.className).not.toContain('text-status-success');

    // The dead row is dropped optimistically instead of leaving a button that
    // visibly does nothing until the next refetch INNER-JOINs it out.
    expect(applyLastUpdater([INVITE])).toEqual([]);

    // A failed join must not fire the joined-a-group refresh signal.
    expect(sessionStorage.getItem('nggroups:refresh')).toBeNull();
  });

  it('Decline: drops the invite silently — removal is what the user asked for', async () => {
    declineInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());
    expect(applyLastUpdater([INVITE])).toEqual([]);
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });

  it('a non-410 failure removes nothing and shows no notice', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    acceptInvite().mockRejectedValue(new ApiError('boom', 'internal', 500, { error: 'boom' }));
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    // A transient failure must NOT eat the row — the user can retry.
    expect(setInvitesMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    consoleError.mockRestore();
  });
});

describe('the { text, tone } confirmation shape', () => {
  it('a successful Accept renders the success-toned confirmation with the group name', async () => {
    acceptInvite().mockResolvedValue({ success: true });
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    // A revert to the bare-string confirmation renders an empty banner here —
    // `confirmation.text` is undefined — so this line is the shape pin.
    const confirmation = await screen.findByText(`Joined ${GROUP_NAME}!`);
    expect(confirmation.className).toContain('text-content-status-success');
    expect(applyLastUpdater([INVITE])).toEqual([]);
    expect(sessionStorage.getItem('nggroups:refresh')).toBe('1');
  });
});
