// Phase 88.6.1-44 (H9, D-04; Req 5): the bell's friend-request paths against the REAL
// FriendshipStatusProvider and UnreadNotificationProvider. Only the API module, the identity hooks
// and the logger are mocked; the providers, their state and their loaders are the shipped code.
//
// What this pins that the mocked suite (NotificationBell.test.tsx) cannot: plan 88.6.1-66's
// provider removes a friend-request row only when the server confirms (the request resolved, or
// its 404 arm), and after any other failure re-reads the list once and removes the row only if the
// server no longer lists it, marking the rethrown error requestRowRemoved. The bell therefore arms
// its focus recovery on the line after the provider call resolves, and in the catch only on that
// mark. NF-1 proves the ORDER: the provider's removal is a default-lane update (a setState with no
// current window.event, node_modules/react-dom/cjs/react-dom.development.js, anchor
// "function getCurrentEventPriority() {"), committed in a Scheduler task AFTER the bell's await
// continuation has armed. So NF-1 resolves the held request OUTSIDE act: inside act React queues
// that work and flushes it on act's own schedule (same file, anchor
// "function scheduleCallback$1(priorityLevel, callback) {"), a test-only order.
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const SELF = vi.hoisted(() => ({ uuid: '00000000-0000-4000-8000-0000000000aa' }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF.uuid,
    self: { id: SELF.uuid, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: () => undefined },
    isPending: false,
  }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

interface FriendRequestRow {
  id: string;
  Requester: { id: string; username: string };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

// getReceivedRequests answers from a per-test queue (plan 88.6.1-66's idea): the first entry
// feeds the mount load, each later call takes the next. An entry is a list, a held deferred, or an
// error to reject with; an exhausted queue answers its last LIST again.
const received = vi.hoisted(() => {
  const state = {
    queue: [] as unknown[],
    last: [] as unknown[],
  };
  return state;
});

const mockApi = vi.hoisted(() => ({
  getFriends: vi.fn(),
  getSentRequests: vi.fn(),
  getReceivedRequests: vi.fn(),
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
  getPendingInvites: vi.fn(),
}));

// FE-TESTING-CONVENTIONS C-3: spread the real module so ApiError stays real.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: mockApi.getFriends,
      getSentRequests: mockApi.getSentRequests,
      getReceivedRequests: mockApi.getReceivedRequests,
      acceptRequest: mockApi.acceptRequest,
      declineRequest: mockApi.declineRequest,
    },
    invitesAPI: { ...actual.invitesAPI, getPendingInvites: mockApi.getPendingInvites },
  };
});

import { FriendshipStatusProvider } from './FriendshipStatusProvider';
import { UnreadNotificationProvider } from './UnreadNotificationProvider';
import NotificationBell from './NotificationBell';
import { logger } from '@/lib/logger';

type Mock = ReturnType<typeof vi.fn>;
const loggerError = () => logger.error as unknown as Mock;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function answerReceived(): Promise<unknown> {
  const next = received.queue.shift();
  if (next === undefined) return Promise.resolve(received.last);
  if (Array.isArray(next)) {
    received.last = next;
    return Promise.resolve(next);
  }
  if (next instanceof Error) return Promise.reject(next);
  return (next as Deferred<unknown[]>).promise.then((list) => {
    received.last = list;
    return list;
  });
}

function queueReceived(...entries: unknown[]) {
  received.queue = [...entries];
  received.last = [];
}

const R1: FriendRequestRow = {
  id: 'req-ana',
  Requester: { id: '11111111-1111-4111-8111-111111111111', username: 'Ana' },
};
const R2: FriendRequestRow = {
  id: 'req-ben',
  Requester: { id: '22222222-2222-4222-8222-222222222222', username: 'Ben' },
};

// Fresh error objects per test: the provider writes its mark onto the rejected error.
const make500 = () => new ApiError('HTTP error! status: 500', 'internal', 500, {});
const make400 = () => new ApiError('Friend request is not pending', 'validation', 400, {});

function renderTree() {
  return render(
    <FriendshipStatusProvider>
      <UnreadNotificationProvider>
        <main>
          <h1>Home</h1>
          <NotificationBell user={{ sub: 'auth0|self' }} label={undefined} />
          <p>Outside</p>
        </main>
      </UnreadNotificationProvider>
    </FriendshipStatusProvider>,
  );
}

async function openBell() {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  // Positive settle: both providers have loaded and the friend rows render.
  expect(await screen.findByText('Friend Requests')).toBeInTheDocument();
}

function rowFor(name: string) {
  const row = screen.getByText(name).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getFriends.mockResolvedValue([]);
  mockApi.getSentRequests.mockResolvedValue([]);
  mockApi.getReceivedRequests.mockImplementation(answerReceived);
  mockApi.getPendingInvites.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('Phase 88.6.1-44 — the bell over the REAL friendship and unread providers (H9 on plan 88.6.1-66\'s remove-on-confirm)', () => {
  it('NF-1. arm-on-resolve ordering: the row stays while its Accept works, and focus lands on the next request\'s Accept once the provider removes the row', async () => {
    const user = userEvent.setup();
    queueReceived([R1, R2], [R2]);
    const dA = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValue(dA.promise);
    renderTree();
    await openBell();

    const acceptAna = within(rowFor('Ana')).getByRole('button', { name: 'Accept friend request from Ana' });
    await user.click(acceptAna);
    expect(rowFor('Ana')).toBeInTheDocument();
    expect(acceptAna).toHaveAccessibleName('Accepting...');

    // Resolved OUTSIDE act, on the line directly before the wait (see the header).
    dA.resolve({});
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept friend request from Ben' })),
    );
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Accepted friend request!')).toBeInTheDocument();
  });

  it('NF-2. a 500 the reconcile still lists keeps the row and arms nothing: a later outside press moves nobody to the page heading', async () => {
    const user = userEvent.setup();
    queueReceived([R1, R2], [R1, R2]);
    const err500 = make500();
    mockApi.acceptRequest.mockRejectedValue(err500);
    renderTree();
    await openBell();

    const acceptAna = within(rowFor('Ana')).getByRole('button', { name: 'Accept friend request from Ana' });
    await user.click(acceptAna);
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));

    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(within(region).getAllByRole('listitem')[0]).toBe(rowFor('Ana'));
    expect(acceptAna).toHaveAccessibleName('Accept friend request from Ana');
    expect(acceptAna).not.toHaveAttribute('aria-disabled');
    // CONFIRM-ONLY in jsdom (C-11).
    expect(document.activeElement).toBe(acceptAna);
    // Mount load + the one reconcile read; the reconcile still listed the row, so no reload.
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);
    expect((err500 as unknown as { requestRowRemoved?: boolean }).requestRowRemoved).toBeUndefined();

    fireEvent.mouseDown(screen.getByText('Outside'));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Home' });
    expect(document.activeElement).not.toBe(h1);
    expect(h1).not.toHaveAttribute('tabindex');
  });

  it('NF-3. the stale 400 (RECORDED): the server no longer lists the request, the row leaves and focus moves to the next request\'s Accept', async () => {
    const user = userEvent.setup();
    queueReceived([R1, R2], [R2], [R2]);
    const err400 = make400();
    mockApi.acceptRequest.mockRejectedValue(err400);
    renderTree();
    await openBell();

    await user.click(within(rowFor('Ana')).getByRole('button', { name: 'Accept friend request from Ana' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept friend request from Ben' })),
    );
    expect(screen.queryByText('Ana')).toBeNull();
    expect((err400 as unknown as { requestRowRemoved?: boolean }).requestRowRemoved).toBe(true);
  });

  it('NF-4. a decline on the last request lands focus on the panel\'s Notifications heading, inside the still-open panel', async () => {
    const user = userEvent.setup();
    // The mount load answers [R1]; the reload the provider pulls after the confirmed decline answers
    // the empty list the server now holds (an exhausted queue would answer [R1] again).
    queueReceived([R1], []);
    mockApi.declineRequest.mockResolvedValue({});
    renderTree();
    await openBell();

    await user.click(within(rowFor('Ana')).getByRole('button', { name: 'Decline friend request from Ana' }));
    const region = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(region).getByRole('heading', { name: 'Notifications' })),
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toBe(region);
  });

  it('NF-5. a 500 the reconcile removes (the backend committed, then failed to answer) still moves focus to the next request — the arm follows the provider\'s row-removed mark, not the status', async () => {
    const user = userEvent.setup();
    queueReceived([R1, R2], [R2], [R2]);
    const err500 = make500();
    mockApi.acceptRequest.mockRejectedValue(err500);
    renderTree();
    await openBell();

    await user.click(within(rowFor('Ana')).getByRole('button', { name: 'Accept friend request from Ana' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept friend request from Ben' })),
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByText('Ana')).toBeNull();
    expect((err500 as unknown as { requestRowRemoved?: boolean }).requestRowRemoved).toBe(true);
  });
});
