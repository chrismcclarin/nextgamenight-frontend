// Phase 88.6.1 plan 61 (Req 11) — the PREMISE pin for the Profile settings-overwrite fix.
//
// WHAT IT PINS: the input the Profile page's one-shot init effect receives after a failed
// refetch of the self row and a remount (`src/app/userProfile/page.js`, the effect under
// `DECISION Phase 88.6.1-61 (Req 11, identity init)`). TanStack keeps the row through a failed
// refetch and reports `status: 'error'` beside it (its own name for the case is
// `isRefetchError`), and a remount over that invalidated entry refetches while the error stays
// reported. The page used to read that error as "no identity" and show default settings over a
// real row with the save path open.
//
// CONFIRM-ONLY: this is library behaviour, green before and after plan 61. It exists so a
// TanStack upgrade that changes the premise fails HERE, by name, rather than silently making the
// page's fix moot or wrong.
//
// `retry: false` only shortens the run. The app's predicate retries a transient failure once
// (`src/lib/queryClient.ts:121`, `export function shouldRetry`), which changes how many failures
// it takes to reach the error state, not the end state.
//
// The mock block and `makeWrapper` are copied from `useSelfIdentity.test.tsx` (ApiError stays
// REAL; only the network call, the Auth0 session seam and browser-timezone detection are mocked).
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    usersAPI: { getUser: vi.fn() },
  };
});

let mockUser: { sub?: string } | undefined;
vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: mockUser, isLoading: false }),
}));

let mockDetected: string | null;
vi.mock('@/lib/datetime', () => ({
  detectBrowserTimezone: () => mockDetected,
}));

import { usersAPI } from '@/lib/api';
import { useSelfIdentity } from './useSelfIdentity';
import { invalidateSelfCache } from './selfIdentityCache';

const mockGetUser = usersAPI.getUser as ReturnType<typeof vi.fn>;

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'auth0|abc123',
  username: 'RealName',
  notification_preferences: { event_created: { email: false, sms: false } },
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { sub: 'auth0|abc123' };
  mockDetected = 'America/New_York';
});

afterEach(cleanup);

describe('useSelfIdentity — a failed refetch keeps the row (88.6.1-61 premise)', () => {
  it('keeps the row through a failed refetch, reports the error beside it, and a remount refetches with both still set', async () => {
    const { client, wrapper } = makeWrapper();
    mockGetUser.mockResolvedValueOnce(ROW);
    const first = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(first.result.current.self).toEqual(ROW));

    // The email section's locally-initiated invalidation, answered by a failure.
    mockGetUser.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await invalidateSelfCache(client);
    });
    // TanStack notifies observers in a batch scheduled after the refetch settles.
    await waitFor(() => expect(first.result.current.query.isError).toBe(true));
    expect(first.result.current.query.isRefetchError).toBe(true);
    expect(first.result.current.self).toEqual(ROW);

    // The user leaves Profile and comes back in the same tab: the remount refetches the
    // invalidated entry, and the refetch is still in flight when the page reads it.
    first.unmount();
    mockGetUser.mockReturnValueOnce(new Promise(() => {}));
    const seen: Array<{ isError: boolean; hasRow: boolean }> = [];
    renderHook(
      () => {
        const r = useSelfIdentity();
        seen.push({ isError: r.query.isError, hasRow: r.self !== undefined });
        return r;
      },
      { wrapper },
    );
    expect(seen[0]).toEqual({ isError: true, hasRow: true });
    await waitFor(() => expect(mockGetUser).toHaveBeenCalledTimes(3));
    expect(seen[seen.length - 1]).toEqual({ isError: true, hasRow: true });
  });
});
