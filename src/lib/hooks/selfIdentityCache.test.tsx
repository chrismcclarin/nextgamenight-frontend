/**
 * Self-row cache-coherence contract (Phase 87.3-07, D-02).
 *
 * The plan-07 migrated mutation paths (updateUsername, timezone, tutorial
 * completion, phone verify/remove, notification preferences) route their success
 * through patchSelfCache / replaceSelfCache / invalidateSelfCache. Because the
 * shared ['users','self'] query is staleTime: Infinity, the immortal cache would
 * otherwise re-serve the PRE-mutation row on the next remount. These tests prove
 * a freshly-mounted useSelfIdentity consumer (the "remount") reads POST-mutation
 * data — never the stale row — for each helper.
 *
 * Only the network seam (usersAPI.getUser), the Auth0 session, and browser-TZ
 * detection are mocked; the react-query cache is REAL.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, usersAPI: { getUser: vi.fn() } };
});

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|abc123' }, isLoading: false }),
}));

vi.mock('@/lib/datetime', () => ({
  detectBrowserTimezone: () => 'America/New_York',
}));

import { usersAPI } from '@/lib/api';
import { useSelfIdentity } from './useSelfIdentity';
import { patchSelfCache, replaceSelfCache, invalidateSelfCache } from './selfIdentityCache';

const mockGetUser = usersAPI.getUser as ReturnType<typeof vi.fn>;

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const PRE_ROW = { id: SELF_UUID, user_id: 'auth0|abc123', username: 'old', timezone: 'UTC' };

function makeSharedClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue(PRE_ROW);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: vi.fn(), href: '' },
    writable: true,
  });
});

afterEach(() => cleanup());

describe('self-row cache coherence (SELF_IDENTITY_KEY contract)', () => {
  it('patchSelfCache: a remounted consumer reads the patched field without refetching', async () => {
    const { client, wrapper } = makeSharedClient();

    // First mount resolves the pre-mutation row into the immortal cache.
    const first = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(first.result.current.self?.username).toBe('old'));
    first.unmount();

    // A username mutation succeeds and patches the cache (no network).
    mockGetUser.mockClear();
    patchSelfCache(client, { username: 'new' });

    // Remount: the fresh consumer must see 'new', and staleTime Infinity means
    // NO duplicate getUser fires — proving it reads the patched cache, not stale.
    const second = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(second.result.current.self?.username).toBe('new'));
    expect(mockGetUser).not.toHaveBeenCalled();
    // Untouched fields are preserved by the merge.
    expect(second.result.current.self?.timezone).toBe('UTC');
  });

  it('replaceSelfCache: a remounted consumer reads the server-returned row wholesale', async () => {
    const { client, wrapper } = makeSharedClient();

    const first = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(first.result.current.self?.username).toBe('old'));
    first.unmount();

    mockGetUser.mockClear();
    replaceSelfCache(client, { id: SELF_UUID, user_id: 'auth0|abc123', username: 'renamed', timezone: 'Europe/Paris' });

    const second = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(second.result.current.self?.username).toBe('renamed'));
    expect(second.result.current.self?.timezone).toBe('Europe/Paris');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('invalidateSelfCache: an active observer refetches the fresh server row', async () => {
    const { client, wrapper } = makeSharedClient();

    const hook = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(hook.result.current.self?.username).toBe('old'));

    // The mutation could not return the full row, so the authoritative post-
    // mutation state must come from the server on invalidation.
    mockGetUser.mockResolvedValue({ ...PRE_ROW, username: 'server-fresh' });
    await invalidateSelfCache(client);

    await waitFor(() => expect(hook.result.current.self?.username).toBe('server-fresh'));
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });
});
