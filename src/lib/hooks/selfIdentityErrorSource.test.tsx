/**
 * selfIdentityErrorSource — "identity failed" means failed AND no row held (Phase 88.6.1-79, AC-29).
 *
 * E1/E2 pin the pure rule and the source it builds. E3-E5 run it against the REAL TanStack
 * query behind the REAL `useSelfIdentity`: a refetch that fails over a resolved row keeps
 * `data` and reports `isError` (query-core `queryObserver.js`, `isRefetchError: isError && hasData`),
 * which is the state the raw flag misreads as "nothing loaded".
 *
 * The mocks and `makeWrapper` are copied from `useSelfIdentity.test.tsx` (not imported): only the
 * network call, the Auth0 session seam and browser-TZ detection are mocked; ApiError stays real.
 *
 * Plan 88.6.1-63 appends its census to this file.
 */
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

vi.mock('@/lib/datetime', () => ({
  detectBrowserTimezone: () => 'America/New_York',
}));

import { usersAPI, ApiError } from '@/lib/api';
import { useSelfIdentity } from './useSelfIdentity';
import { invalidateSelfCache } from './selfIdentityCache';
import { selfIdentityErrorSource, selfIdentityFailedWithNoRow } from './selfIdentityErrorSource';

const mockGetUser = usersAPI.getUser as ReturnType<typeof vi.fn>;

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const SUB = 'auth0|abc123';
const ROW = { id: SELF_UUID, user_id: SELF_UUID, email: 'self@example.com' };

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
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignSpy, href: '' },
    writable: true,
  });
});

afterEach(cleanup);

describe('selfIdentityErrorSource — failed AND no row (88.6.1-79, AC-29)', () => {
  it('E1: the rule is true only when the query errored AND no row is held', () => {
    expect(selfIdentityFailedWithNoRow({ isError: true }, undefined)).toBe(true);
    expect(selfIdentityFailedWithNoRow({ isError: true }, 'u-1')).toBe(false);
    expect(selfIdentityFailedWithNoRow({ isError: false }, undefined)).toBe(false);
    expect(selfIdentityFailedWithNoRow(undefined, undefined)).toBe(false);
    expect(selfIdentityFailedWithNoRow({ isError: true }, null)).toBe(true);
  });

  it('E2: the source carries the rule as isError and passes error and refetch through by reference', () => {
    const error = new ApiError('Server error', 'internal', 500);
    const refetch = vi.fn();
    const q = { isError: true, error, refetch };

    const held = selfIdentityErrorSource(q, 'u-1');
    expect(held.isError).toBe(false);
    expect(held.error).toBe(error);
    expect(held.refetch).toBe(refetch);

    const none = selfIdentityErrorSource(q, undefined);
    expect(none.isError).toBe(true);
    expect(none.error).toBe(error);
    expect(none.refetch).toBe(refetch);
  });

  it('E3 (real TanStack): a refetch that fails over a resolved row keeps the row, so the rule is false', async () => {
    mockGetUser.mockResolvedValueOnce(ROW);
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(result.current.selfUuid).toBe(SELF_UUID));

    mockGetUser.mockRejectedValue(new ApiError('Server error', 'internal', 500));
    await act(async () => {
      await invalidateSelfCache(client);
    });

    await waitFor(() => expect(result.current.query.isError).toBe(true));
    // The premise: TanStack keeps `data` after a failed refetch.
    expect(result.current.selfUuid).toBe(SELF_UUID);
    expect(selfIdentityFailedWithNoRow(result.current.query, result.current.selfUuid)).toBe(false);
  });

  it('E4 (real TanStack): a first load that fails holds no row, so the rule is true', async () => {
    mockGetUser.mockRejectedValue(new ApiError('Server error', 'internal', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });

    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.selfUuid).toBeUndefined();
    expect(selfIdentityFailedWithNoRow(result.current.query, result.current.selfUuid)).toBe(true);
  });

  it('E5 (real TanStack, D-10 guard): a 410 on a refetch over a held row still routes to the goodbye path', async () => {
    mockGetUser.mockResolvedValueOnce(ROW);
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useSelfIdentity(), { wrapper });
    await waitFor(() => expect(result.current.selfUuid).toBe(SELF_UUID));

    mockGetUser.mockRejectedValue(new ApiError('gone', 'account_deleted', 410));
    await act(async () => {
      await invalidateSelfCache(client);
    });

    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith('/api/auth/logout?returnTo=/goodbye')
    );
    // The row is still held: the 410 routing reads the RAW error, never the no-row rule.
    expect(result.current.selfUuid).toBe(SELF_UUID);
  });
});
