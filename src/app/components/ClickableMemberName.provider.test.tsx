// Phase 88.6.1-37 (Req 5 / Req 11): ClickableMemberName under the REAL FriendshipStatusProvider,
// as plan 88.6.1-66 left it. What it pins:
//   - a 409 the provider swallows is followed by the newest friendship load, which can move this
//     row's status off 'none'; copy row X3 never shows for it (the server holds the request), and
//     focus follows to the node that replaced the pressed +;
//   - a thrown failure shows X3 and pulls no load;
//   - the + exists only after the first friendship load settles (confirm-only once plan 66 is in).
// The indicator suite pins the same component against a mocked context; this one proves the
// mocked shapes are the ones the real provider produces.
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Copy row X3 (D-30), straight apostrophe (D-32 R8).
const X3 = "We couldn't send that request.";

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

// ApiError stays REAL through importOriginal (the provider's 409 swallow reads its status).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: vi.fn(),
      getSentRequests: vi.fn(),
      getReceivedRequests: vi.fn(),
      sendRequest: vi.fn(),
    },
  };
});

import { ApiError, friendshipsAPI } from '@/lib/api';
import { FriendshipStatusProvider } from './FriendshipStatusProvider';
import ClickableMemberName from './ClickableMemberName';

const api = friendshipsAPI as unknown as {
  getFriends: ReturnType<typeof vi.fn>;
  getSentRequests: ReturnType<typeof vi.fn>;
  getReceivedRequests: ReturnType<typeof vi.fn>;
  sendRequest: ReturnType<typeof vi.fn>;
};

const plusName = 'Add Alice as a friend';

function renderRow() {
  return render(
    <FriendshipStatusProvider>
      <ClickableMemberName userId={OTHER_UUID} username="Alice" />
    </FriendshipStatusProvider>,
  );
}

beforeEach(() => {
  for (const fn of [api.getFriends, api.getSentRequests, api.getReceivedRequests, api.sendRequest]) {
    fn.mockReset();
  }
  api.getFriends.mockResolvedValue([]);
  api.getSentRequests.mockResolvedValue([]);
  api.getReceivedRequests.mockResolvedValue([]);
});

afterEach(cleanup);

describe('ClickableMemberName under the real FriendshipStatusProvider (Phase 88.6.1-37)', () => {
  it('P1. a 409 that resolves to pending_received: no X3, focus follows to Pending', async () => {
    api.getReceivedRequests
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ Requester: { id: OTHER_UUID } }]);
    api.sendRequest.mockRejectedValueOnce(new ApiError('HTTP error! status: 409', 'conflict', 409));
    renderRow();
    const plus = await screen.findByRole('button', { name: plusName });
    plus.focus();
    fireEvent.click(plus);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('⏳ Pending')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(X3)).toBeNull();
    expect(api.getReceivedRequests).toHaveBeenCalledTimes(2);
  });

  it('P2. a 409 that resolves to accepted: no X3, focus follows to the Friend indicator', async () => {
    api.getFriends.mockResolvedValueOnce([]).mockResolvedValueOnce([{ friend: { id: OTHER_UUID } }]);
    api.sendRequest.mockRejectedValueOnce(new ApiError('HTTP error! status: 409', 'conflict', 409));
    renderRow();
    const plus = await screen.findByRole('button', { name: plusName });
    plus.focus();
    fireEvent.click(plus);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('✓ Friend')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(X3)).toBeNull();
  });

  it('P3. a thrown failure shows X3 and pulls no friendship load', async () => {
    api.sendRequest.mockRejectedValueOnce(new ApiError('HTTP error! status: 500', 'unknown', 500));
    renderRow();
    fireEvent.click(await screen.findByRole('button', { name: plusName }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(X3);
    expect(alert.textContent).toBe(X3);
    expect(api.getSentRequests).toHaveBeenCalledTimes(1);
  });

  it('P4. confirm-only: no + and no name button until the first friendship load settles', async () => {
    let release!: (v: unknown[]) => void;
    api.getFriends.mockReturnValueOnce(
      new Promise<unknown[]>((res) => {
        release = res;
      }),
    );
    renderRow();
    expect(screen.queryByRole('button', { name: plusName })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Alice' })).toBeNull();
    await act(async () => {
      release([]);
    });
    expect(await screen.findByRole('button', { name: plusName })).toBeInTheDocument();
  });
});
