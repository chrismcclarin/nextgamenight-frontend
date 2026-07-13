/**
 * useSelfIdentity behavior (Phase 87.3-02, D-01 / D-10).
 *
 * Proves the shared self-identity primitive:
 *   - resolves the caller's Users.id UUID exactly once (queryKey SELF_IDENTITY_KEY),
 *   - never fires while logged out (enabled = Boolean(user?.sub)),
 *   - forwards the detected browser timezone as getUser's 2nd arg (TZ-01),
 *   - routes a 410 account_deleted to the logout/goodbye path (D-10),
 *   - honors the invalidation contract: invalidating SELF_IDENTITY_KEY refetches
 *     and a consumer observes the FRESH row, never the stale pre-mutation one.
 *
 * ApiError stays REAL; only the network call (usersAPI.getUser), the Auth0
 * session seam, and browser-TZ detection are mocked.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Keep ApiError REAL; mock only the network call.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    usersAPI: { getUser: vi.fn() },
  };
});

// Auth0 session seam — mutable per test.
let mockUser: { sub?: string } | undefined;
vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: mockUser, isLoading: false }),
}));

// Browser-TZ detection seam — mutable per test.
let mockDetected: string | null;
vi.mock('@/lib/datetime', () => ({
  detectBrowserTimezone: () => mockDetected,
}));

import { usersAPI, ApiError } from '@/lib/api';
import { useSelfIdentity, SELF_IDENTITY_KEY } from './useSelfIdentity';

const mockGetUser = usersAPI.getUser as ReturnType<typeof vi.fn>;

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const SUB = 'auth0|abc123';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { sub: SUB };
  mockDetected = 'America/New_York';
  assignSpy = vi.fn();
  // Deterministic navigation seam: replace window.location with a spy-able stub.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignSpy, href: '' },
    writable: true,
  });
});

afterEach(cleanup);

describe('useSelfIdentity — key + contract', () => {
  it('exports SELF_IDENTITY_KEY as ["users","self"]', () => {
    expect(SELF_IDENTITY_KEY).toEqual(['users', 'self']);
  });
});

describe('useSelfIdentity — resolution', () => {
  it('resolves the self UUID once for a logged-in user', async () => {
    mockGetUser.mockResolvedValue({ id: SELF_UUID, user_id: SUB, username: 'me' });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() => expect(result.current.selfUuid).toBe(SELF_UUID));
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it('does not fire the query while logged out (enabled guard)', async () => {
    mockUser = undefined;
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    // Give react-query a scheduling tick — the disabled query must stay idle.
    await Promise.resolve();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(result.current.selfUuid).toBeUndefined();
  });

  it('forwards the detected browser timezone to getUser as the second arg (TZ-01)', async () => {
    mockGetUser.mockResolvedValue({ id: SELF_UUID, user_id: SUB });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() => expect(result.current.selfUuid).toBe(SELF_UUID));
    expect(mockGetUser).toHaveBeenCalledWith(SUB, 'America/New_York');
  });

  it('calls getUser with the sub alone when timezone detection returns null', async () => {
    mockDetected = null;
    mockGetUser.mockResolvedValue({ id: SELF_UUID, user_id: SUB });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() => expect(result.current.selfUuid).toBe(SELF_UUID));
    expect(mockGetUser).toHaveBeenCalledWith(SUB, null);
  });
});

describe('useSelfIdentity — D-10 account_deleted', () => {
  it('routes a 410 account_deleted to the logout/goodbye path', async () => {
    mockGetUser.mockRejectedValue(new ApiError('gone', 'account_deleted', 410));
    const { wrapper } = makeWrapper();
    renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith('/api/auth/logout?returnTo=/goodbye')
    );
  });

  it('does NOT route a plain network error to logout', async () => {
    mockGetUser.mockRejectedValue(new ApiError('offline', 'network', 0));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe('useSelfIdentity — invalidation contract', () => {
  it('refetches and serves the fresh row after SELF_IDENTITY_KEY is invalidated', async () => {
    mockGetUser
      .mockResolvedValueOnce({ id: SELF_UUID, user_id: SUB, username: 'old' })
      .mockResolvedValueOnce({ id: SELF_UUID, user_id: SUB, username: 'new' });
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() => expect(result.current.self?.username).toBe('old'));

    // Simulate a post-mutation invalidation of the self row — the immortal
    // (staleTime Infinity) cache MUST refetch, not re-serve the stale row.
    await client.invalidateQueries({ queryKey: SELF_IDENTITY_KEY });

    await waitFor(() => expect(result.current.self?.username).toBe('new'));
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });
});
