// Phase 88-33 Task 1 — M1 DIAGNOSIS + REGRESSION PINS (backend unreachable).
//
// WHY A SECOND FRIENDS TEST FILE: `page.test.tsx` MOCKS `useSelfIdentity`
// wholesale (its `h.selfUuid` handle), so the identity query's real PENDING
// window — the one M1 lives in — is unreachable from there. This file mounts
// the page over the REAL hook, a REAL `useQuery`, the REAL `shouldRetry`
// predicate and REAL `useFetchErrorState`, which is the only configuration that
// can observe what a person sees while the backend is unreachable.
//
// ROOT CAUSE (re-diagnosed 2026-08-20 per the Fork A ruling; the earlier
// "connection-refused never terminalizes" claim was FALSE):
//   1. The friends + sent fetchers fire on `[user]` (page.js:77-81), NOT on
//      identity, so with the backend unreachable they FAIL FAST and
//      `friendsErrorState.showError` is already true within a tick.
//   2. But the D-09 identity gate at page.js:522 (`if (!selfUuid)`) renders a
//      bare, unlabeled, full-page spinner ABOVE those banners — so for the
//      whole identity-resolution window nothing that already knows the backend
//      is down can render, and the spinner carries no accessible name at all
//      (hence the walk's "header+footer around a permanently empty main").
//   3. That window is ~60s, not ~1s: every attempt goes through the BFF proxy,
//      whose own `PROXY_TIMEOUT_MS` is 30_000 (app/api/[...path]/route.ts:22),
//      and `shouldRetry` grants one retry — 2 x 30s. The walk's "observed
//      30-60s" / "60+s" is that arithmetic, not a missing terminal state.
//
// The pins below were RED against pre-fix code (blocking spinner, no name).
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { shouldRetry } from '@/lib/queryClient';

// STABLE reference, per the DECISION marker in page.test.tsx: friends/page.js
// keys its mount fetch on the `user` OBJECT, so an inline object is a new
// identity every render and the mount effect re-fires forever (each re-fire
// clears `friendsLoadError` back to null). Inlining it is a hang, not a tidy-up.
const auth = vi.hoisted(() => ({
  user: { sub: 'auth0|self', name: 'Self', email: 'self@example.com' },
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: auth.user, isLoading: false }),
}));

vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({
    receivedRequests: [],
    acceptRequest: vi.fn(),
    declineRequest: vi.fn(),
    loading: false,
    getStatus: () => 'none',
  }),
}));

// `usersAPI.getUser` NEVER SETTLES — the faithful analogue of an in-flight BFF
// proxy attempt against a dead backend (up to 30s per attempt). Everything the
// page fetches directly REJECTS immediately, exactly as it does live.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  const netErr = () =>
    new actual.ApiError('Network error: Could not connect to the server.', 'network', 0);
  return {
    ...actual,
    usersAPI: {
      ...actual.usersAPI,
      getUser: vi.fn(() => new Promise(() => {})),
    },
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: vi.fn(() => Promise.reject(netErr())),
      getSentRequests: vi.fn(() => Promise.reject(netErr())),
      searchUserByEmail: vi.fn(() => Promise.reject(netErr())),
    },
    groupsAPI: {
      ...actual.groupsAPI,
      getUserGroups: vi.fn(() => Promise.reject(netErr())),
      getGroupMembers: vi.fn(() => Promise.reject(netErr())),
    },
    invitesAPI: { ...actual.invitesAPI, sendFriendInvite: vi.fn() },
  };
});

import FriendsPage from './page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      // The REAL predicate — not `retry: false`. Retry classification is part of
      // what the diagnosis had to rule in or out.
      queries: { retry: shouldRetry, retryDelay: 0, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M1 — /friends while identity is still resolving and the backend is unreachable', () => {
  it('tells the person the load failed instead of rendering a silent blank main', async () => {
    renderWithClient(<FriendsPage />);

    expect(await screen.findByText("Couldn't load your friends")).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('never claims the person has no friends while the fetch has failed', async () => {
    renderWithClient(<FriendsPage />);
    await screen.findByText("Couldn't load your friends");

    expect(screen.queryByRole('heading', { name: 'No friends yet' })).not.toBeInTheDocument();
  });
});

describe('M1 — the identity-pending window is a NAMED status, not a silent div', () => {
  it('announces what is loading while identity resolves and nothing has failed yet', async () => {
    // Everything pends: no fetch has failed, so the page is legitimately still
    // loading — but it must SAY so.
    const api = await import('@/lib/api');
    (api.friendshipsAPI.getFriends as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    (api.friendshipsAPI.getSentRequests as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    renderWithClient(<FriendsPage />);

    const status = await screen.findByRole('status', { name: /loading your friends/i });
    expect(status).toBeInTheDocument();
  });
});
