// Phase 88.6.1-80 (N7 / D-47, Req 11, Prohibition 2): the bell's load-failure banner, against the
// REAL FriendshipStatusProvider, UnreadNotificationProvider and FeedbackModalProvider (the app-level
// report host, plan 88.6.1-69), nested in the order src/app/layout.js nests them (the report host
// inside the two data providers). Only the API module, the identity hooks, the logger and
// next/navigation are mocked; errors are real ApiErrors (FE-TESTING-CONVENTIONS C-3).
//
// What this pins: when the bell's notifications could not be loaded and there is nothing to show,
// the open panel shows the house FULL banner titled with copy row N7 instead of the empty line;
// the provider holds ONE adapter over both sources (invites and friendships), so both bells share
// one memory of a failed retry, and its retry re-runs only the source(s) that failed.
//
// Presses clear the stale window.event after dispatch (plan 88.6.1-44's measurement, recorded in
// NotificationBell.friendProvider.test.tsx's header: jsdom keeps the last click in window.event
// after a React click handler, which no browser does in a promise continuation).
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { getFetchErrorMessage, useFetchErrorState } from '@/components/ui/useFetchErrorState';
import type { FetchErrorState } from '@/components/ui/useFetchErrorState';

const SELF = vi.hoisted(() => ({ uuid: '00000000-0000-4000-8000-0000000000aa' }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF.uuid,
    self: { id: SELF.uuid, user_id: 'auth0|self', email: 'self@example.test' },
    query: { isError: false, error: null, isPending: false, isFetching: false, refetch: () => undefined },
    isPending: false,
  }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// Each read answers from its own per-test queue: an entry is a list (resolve), an Error (reject)
// or a held promise; an exhausted queue answers its last list again ([] at the start).
type Entry = unknown[] | Error | Promise<unknown[]>;
const queues = vi.hoisted(() => ({
  invites: { queue: [] as unknown[], last: [] as unknown[] },
  friends: { queue: [] as unknown[], last: [] as unknown[] },
  sent: { queue: [] as unknown[], last: [] as unknown[] },
  received: { queue: [] as unknown[], last: [] as unknown[] },
}));

const mockApi = vi.hoisted(() => ({
  getFriends: vi.fn(),
  getSentRequests: vi.fn(),
  getReceivedRequests: vi.fn(),
  getPendingInvites: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: mockApi.getFriends,
      getSentRequests: mockApi.getSentRequests,
      getReceivedRequests: mockApi.getReceivedRequests,
    },
    invitesAPI: { ...actual.invitesAPI, getPendingInvites: mockApi.getPendingInvites },
    feedbackAPI: {
      ...actual.feedbackAPI,
      submitFeedback: vi.fn().mockResolvedValue({ success: true }),
      submitGitHubFeedback: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

import { FriendshipStatusProvider, useFriendshipStatus } from './FriendshipStatusProvider';
import { UnreadNotificationProvider, useUnreadNotificationCount } from './UnreadNotificationProvider';
import { FeedbackModalProvider } from './FeedbackModalProvider';
import NotificationBell from './NotificationBell';

type QueueKey = keyof typeof queues;

function answer(key: QueueKey): Promise<unknown> {
  const q = queues[key];
  const next = q.queue.shift() as Entry | undefined;
  if (next === undefined) return Promise.resolve(q.last);
  if (Array.isArray(next)) {
    q.last = next;
    return Promise.resolve(next);
  }
  if (next instanceof Error) return Promise.reject(next);
  return next.then((list) => {
    q.last = list;
    return list;
  });
}

function queue(key: QueueKey, ...entries: Entry[]) {
  queues[key].queue = [...entries];
  queues[key].last = [];
}

// Copy row N7 (D-47, owner-ratified 2026-10-05), straight apostrophe (D-32 R8).
const N7 = "Couldn't load your notifications";
const EMPTY_LINE = 'No pending notifications';

const make500 = () => new ApiError('HTTP error! status: 500', 'internal', 500, {});

const ANA = {
  id: 'req-ana',
  Requester: { id: '11111111-1111-4111-8111-111111111111', username: 'Ana' },
};

// The latest context value, read by tests that drive the adapter directly.
const probe: { current: FetchErrorState | null } = { current: null };
function Probe() {
  const { loadErrorState } = useUnreadNotificationCount() as { loadErrorState?: FetchErrorState | null };
  probe.current = loadErrorState ?? null;
  return null;
}

// The Requests tab's adapter shape (plan 88.6.1-72): one useFetchErrorState over the friendship
// provider's error and its joining retry.
function RequestsTabAdapter() {
  const { error, retryFriendships } = useFriendshipStatus() as {
    error: unknown;
    retryFriendships: () => Promise<unknown>;
  };
  const state = useFetchErrorState({
    isError: Boolean(error),
    error,
    refetch: retryFriendships,
  } as unknown as Parameters<typeof useFetchErrorState>[0]);
  return <p>{state.showError ? 'Requests tab failed' : 'Requests tab ok'}</p>;
}

function renderTree(extra?: React.ReactNode, bells?: React.ReactNode) {
  return render(
    <FriendshipStatusProvider>
      <UnreadNotificationProvider>
        <FeedbackModalProvider>
          <main>
            <h1>Home</h1>
            {bells ?? <NotificationBell user={{ sub: 'auth0|self' }} label={undefined} />}
            <p>Outside</p>
            <Probe />
            {extra}
          </main>
        </FeedbackModalProvider>
      </UnreadNotificationProvider>
    </FriendshipStatusProvider>,
  );
}

function clearStaleWindowEvent() {
  delete (window as unknown as { event?: unknown }).event;
}

async function click(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
  await user.click(el);
  clearStaleWindowEvent();
}

function fireVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function region() {
  return screen.getByRole('region', { name: 'Notifications', hidden: true });
}

async function openBell(user: ReturnType<typeof userEvent.setup>, name = 'Notifications') {
  await click(user, screen.getByRole('button', { name }));
  return await screen.findByRole('region', { name: 'Notifications' });
}

beforeEach(() => {
  vi.clearAllMocks();
  probe.current = null;
  queue('invites');
  queue('friends');
  queue('sent');
  queue('received');
  mockApi.getPendingInvites.mockImplementation(() => answer('invites'));
  mockApi.getFriends.mockImplementation(() => answer('friends'));
  mockApi.getSentRequests.mockImplementation(() => answer('sent'));
  mockApi.getReceivedRequests.mockImplementation(() => answer('received'));
});

afterEach(() => {
  cleanup();
  clearStaleWindowEvent();
});

describe('NotificationBell — load failure banner N7 (plan 88.6.1-80)', () => {
  it('NL-1. a failed invites load with nothing to show: the N7 banner with Try again, never the empty line, no Report this yet', async () => {
    const err = make500();
    queue('invites', err);
    const user = userEvent.setup();
    renderTree();
    const panel = await openBell(user);

    expect(await within(panel).findByText(N7)).toBeInTheDocument();
    expect(within(panel).getByText(getFetchErrorMessage(err))).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(panel).queryByText(EMPTY_LINE)).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Report this' })).toBeNull();
  });

  it('NL-2. a failed friend-request load with no invites: the N7 banner', async () => {
    queue('received', make500());
    const user = userEvent.setup();
    renderTree();
    const panel = await openBell(user);

    expect(await within(panel).findByText(N7)).toBeInTheDocument();
    expect(within(panel).queryByText(EMPTY_LINE)).toBeNull();
  });

  it('NL-3. the owner-recorded limit: invites failed but a friend request loaded, so the row shows and nothing is said', async () => {
    queue('invites', make500());
    queue('received', [ANA]);
    const user = userEvent.setup();
    renderTree();
    const panel = await openBell(user);

    expect(
      await within(panel).findByRole('button', { name: 'Accept friend request from Ana' }),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(N7)).toBeNull();
    expect(within(panel).queryByText(EMPTY_LINE)).toBeNull();
  });

  it('NL-4. Try again re-runs only the failed source(s), resolves its outcome, and joins the Requests tab on one tab return', async () => {
    // (a) only invites failed: the friendship reads are not sent again.
    queue('invites', make500(), []);
    let user = userEvent.setup();
    let view = renderTree();
    let panel = await openBell(user);
    await click(user, await within(panel).findByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText(EMPTY_LINE)).toBeInTheDocument();
    expect(mockApi.getPendingInvites).toHaveBeenCalledTimes(2);
    expect(mockApi.getFriends).toHaveBeenCalledTimes(1);
    expect(mockApi.getSentRequests).toHaveBeenCalledTimes(1);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(1);
    view.unmount();

    // (b) both failed: each runs once more.
    vi.clearAllMocks();
    queue('invites', make500(), []);
    queue('friends');
    queue('sent');
    queue('received', make500(), []);
    user = userEvent.setup();
    view = renderTree();
    panel = await openBell(user);
    await click(user, await within(panel).findByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText(EMPTY_LINE)).toBeInTheDocument();
    expect(mockApi.getPendingInvites).toHaveBeenCalledTimes(2);
    expect(mockApi.getFriends).toHaveBeenCalledTimes(2);
    expect(mockApi.getSentRequests).toHaveBeenCalledTimes(2);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);
    view.unmount();

    // (c) the adapter's retry resolves { isError } from the re-run sources.
    vi.clearAllMocks();
    queue('invites', make500(), make500(), []);
    queue('received');
    view = renderTree();
    await waitFor(() => expect(probe.current?.showError).toBe(true));
    let result: unknown;
    await act(async () => {
      result = await probe.current!.retry();
    });
    expect(result).toEqual({ isError: true });
    await act(async () => {
      result = await probe.current!.retry();
    });
    expect(result).toEqual({ isError: false });
    await waitFor(() => expect(probe.current?.showError).toBe(false));
    view.unmount();

    // (d) review #149 / #156: the bell's adapter and the Requests tab's share ONE friendship load
    // on a tab return (both through the joining retry).
    vi.clearAllMocks();
    queue('invites');
    queue('friends', make500(), []);
    view = renderTree(<RequestsTabAdapter />);
    expect(await screen.findByText('Requests tab failed')).toBeInTheDocument();
    await waitFor(() => expect(probe.current?.showError).toBe(true));
    expect(mockApi.getFriends).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireVisibility('visible');
    });
    expect(await screen.findByText('Requests tab ok')).toBeInTheDocument();
    await waitFor(() => expect(probe.current?.showError).toBe(false));
    expect(mockApi.getFriends).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('NL-5. a successful Try again lands focus on the panel heading, inside the panel, which stays open', async () => {
    queue('invites', make500(), []);
    const user = userEvent.setup();
    renderTree();
    const panel = await openBell(user);
    await click(user, await within(panel).findByRole('button', { name: 'Try again' }));

    const heading = within(panel).getByRole('heading', { name: 'Notifications' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(region()).toBeInTheDocument();
    expect(within(region()).getByText(EMPTY_LINE)).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Home' }));
  });

  it('NL-6. a failed Try again brings Report this; focus stays on Try again; the panel stays', async () => {
    queue('invites', make500(), make500());
    const user = userEvent.setup();
    renderTree();
    const panel = await openBell(user);
    const tryAgain = await within(panel).findByRole('button', { name: 'Try again' });
    await click(user, tryAgain);

    expect(await within(panel).findByRole('button', { name: 'Report this' })).toBeInTheDocument();
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Try again' }));
    expect(region()).toBeInTheDocument();
  });

  it('NL-8. the failed-retry memory survives closing the panel: reopened, Report this is there at once', async () => {
    queue('invites', make500(), make500());
    const user = userEvent.setup();
    renderTree();
    let panel = await openBell(user);
    await click(user, await within(panel).findByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByRole('button', { name: 'Report this' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Notifications' })),
    );
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();

    panel = await openBell(user);
    expect(within(panel).getByRole('button', { name: 'Report this' })).toBeInTheDocument();
  });

  it('NL-9. both bells share one memory: a retry failed in the icon bell shows Report this in the row bell', async () => {
    queue('invites', make500(), make500());
    const user = userEvent.setup();
    renderTree(
      undefined,
      <>
        <NotificationBell user={{ sub: 'auth0|self' }} label={undefined} />
        <NotificationBell user={{ sub: 'auth0|self' }} variant="row" label="Invites" />
      </>,
    );
    let panel = await openBell(user, 'Notifications');
    await click(user, await within(panel).findByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByRole('button', { name: 'Report this' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Notifications' })),
    );

    panel = await openBell(user, 'Invites notifications');
    expect(within(panel).getByRole('button', { name: 'Report this' })).toBeInTheDocument();
  });

  it('NL-11. C10: an access answer passes through unwrapped, so the banner shows the register line for a 401', async () => {
    const err401 = new ApiError('Unauthorized', 'unauthorized', 401, {});
    queue('invites', err401);
    const user = userEvent.setup();
    renderTree();
    const panel = await openBell(user);

    expect(await within(panel).findByText(N7)).toBeInTheDocument();
    expect(within(panel).getByText(getFetchErrorMessage(err401))).toBeInTheDocument();
    expect(within(panel).queryByText(getFetchErrorMessage(new Error('x')))).toBeNull();
  });
});
