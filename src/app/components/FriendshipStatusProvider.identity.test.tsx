// Phase 87.3-06 (PR-B): behavioral net for the FriendshipStatusProvider
// self-classification ASYNC-GATING rule (FE-17, T-873-06-09). getStatus's
// self-vs-none disambiguation keys on the react-query-resolved `selfUuid`,
// which lands ASYNCHRONOUSLY. While it is unresolved (loading) OR has
// permanently errored (it stays undefined), getStatus must classify a
// not-a-friend target as loading/unknown — NEVER fall through to 'none' and
// render an "Add friend" affordance on a row that might turn out to be the
// viewer themself (a click there POSTs a self-request that 400s).
//
// The provider's getStatus is exercised through a real ClickableMemberName so
// the assertion is on the rendered affordance (the mobile "+" add-friend
// button), not on an internal return value.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Mutable self-identity mock: each test sets `mockSelf.selfUuid` before render.
const mockSelf = vi.hoisted(() => ({ selfUuid: undefined as string | undefined }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: mockSelf.selfUuid,
    self: mockSelf.selfUuid ? { id: mockSelf.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: !mockSelf.selfUuid,
  }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

// Empty friendship data — the target is never a friend/pending, so the ONLY
// thing standing between it and an "Add friend" affordance is the self-vs-none
// disambiguation that gates on selfUuid.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: vi.fn().mockResolvedValue([]),
      getSentRequests: vi.fn().mockResolvedValue([]),
      getReceivedRequests: vi.fn().mockResolvedValue([]),
      sendRequest: vi.fn().mockResolvedValue({}),
    },
  };
});

import { FriendshipStatusProvider } from './FriendshipStatusProvider';
import ClickableMemberName from './ClickableMemberName';

function renderRow(targetUuid: string) {
  return render(
    <FriendshipStatusProvider>
      <ClickableMemberName userId={targetUuid} username="Alice" />
    </FriendshipStatusProvider>
  );
}

// The mobile "+" add-friend affordance is labelled "Add {username} as a friend".
const addFriendLabel = 'Add Alice as a friend';

beforeEach(() => {
  mockSelf.selfUuid = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FriendshipStatusProvider self-classification async-gating (FE-17)', () => {
  it('withholds the Add-friend affordance while selfUuid is unresolved (loading)', async () => {
    mockSelf.selfUuid = undefined; // identity still resolving
    renderRow(OTHER_UUID);

    // Let the provider's initialLoad settle (friends/sent/received → []).
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // status is 'unknown' → plain name, NO add-friend affordance on the
    // viewer's own row OR any row, since self cannot yet be ruled out.
    expect(screen.queryByLabelText(addFriendLabel)).not.toBeInTheDocument();
  });

  it('offers Add-friend for a stranger once selfUuid resolves to a different UUID', async () => {
    mockSelf.selfUuid = SELF_UUID; // resolved, target !== self
    renderRow(OTHER_UUID);

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByLabelText(addFriendLabel)).toBeInTheDocument();
  });

  it('never offers Add-friend on the viewer own row once identity resolves to self', async () => {
    mockSelf.selfUuid = SELF_UUID; // resolved, target === self
    renderRow(SELF_UUID);

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.queryByLabelText(addFriendLabel)).not.toBeInTheDocument();
  });
});
