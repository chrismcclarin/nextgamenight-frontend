// Phase 88.6.1-44 Task 4 (Req 11, SPEC Prohibition 2): the provider half of copy row N7. A failed
// invites load is remembered as the caught error until a later load succeeds, and the provider's
// retry (refetch) reports whether it worked, resolving { isError } and never rejecting: the same
// shape plan 88.6.1-66 gives the friendship provider. The bell's N7 banner that reads it is mounted
// by plan 88.6.1-80, through one adapter over this error and the friendship provider's.
//
// The real UnreadNotificationProvider is rendered; only the API module, the Auth0 hook and the
// friendship hook are mocked. Comments in this file are line comments only
// (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  getFetchErrorMessage,
  useFetchErrorState,
  type FetchErrorState,
} from '@/components/ui/useFetchErrorState';

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

const mockApi = vi.hoisted(() => ({ getPendingInvites: vi.fn() }));

// FE-TESTING-CONVENTIONS C-3: spread the real module so ApiError stays real.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    invitesAPI: { ...actual.invitesAPI, getPendingInvites: mockApi.getPendingInvites },
  };
});

vi.mock('./FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({ receivedRequests: [] }),
}));

import { UnreadNotificationProvider, useUnreadNotificationCount } from './UnreadNotificationProvider';

interface Invite {
  id: string;
}

// The context as this suite reads it (the provider is a .js file).
interface Ctx {
  invites: Invite[];
  loading: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// getPendingInvites answers from a per-test queue: a list, a held deferred, or an error to reject
// with; an exhausted queue answers its last LIST again.
let queue: unknown[] = [];
let lastList: Invite[] = [];
function answer(): Promise<unknown> {
  const next = queue.shift();
  if (next === undefined) return Promise.resolve(lastList);
  if (Array.isArray(next)) {
    lastList = next as Invite[];
    return Promise.resolve(next);
  }
  if (next instanceof Error) return Promise.reject(next);
  return (next as Deferred<Invite[]>).promise.then((list) => {
    lastList = list;
    return list;
  });
}

const INV_1: Invite = { id: 'inv-1' };
const errNet = new ApiError('Network error', 'network', 0, null);
const err500 = new ApiError('HTTP error! status: 500', 'internal', 500, {});

let ctx!: Ctx;

function Probe() {
  const value = useUnreadNotificationCount() as unknown as Ctx;
  ctx = value;
  return (
    <div>
      <p data-testid="unread-error">{value.error ? 'error' : 'none'}</p>
      <ul aria-label="Invites">
        {value.invites.map((invite) => (
          <li key={invite.id}>{invite.id}</li>
        ))}
      </ul>
    </div>
  );
}

// The single-source adapter shape plan 88.6.1-80's combined adapter builds on, run with the REAL
// hook. Each render records the context's refetch, so the test can check it keeps one reference.
let adapter!: FetchErrorState;
let retryRefs: unknown[] = [];

function AdapterProbe() {
  const { error, refetch } = useUnreadNotificationCount() as unknown as Ctx;
  retryRefs.push(refetch);
  adapter = useFetchErrorState({
    isError: Boolean(error),
    error,
    refetch,
  } as unknown as UseQueryResult);
  return null;
}

function renderProvider(withAdapter = false) {
  return render(
    <UnreadNotificationProvider>
      <Probe />
      {withAdapter ? <AdapterProbe /> : null}
    </UnreadNotificationProvider>,
  );
}

async function settleOnError() {
  await waitFor(() => expect(screen.getByTestId('unread-error')).toHaveTextContent('error'));
}

// Awaits a promise inside act and reports how it settled.
async function capture(promise: Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> {
  let out: { value?: unknown; error?: unknown } = {};
  await act(async () => {
    try {
      out = { value: await promise };
    } catch (error) {
      out = { error };
    }
  });
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  queue = [];
  lastList = [];
  retryRefs = [];
  mockApi.getPendingInvites.mockImplementation(answer);
  // Keep the run's output readable. (Since the 88.6.1 code review A-38 the provider's catch reports through the
  // logger, not the console; the spy stays for any React console noise.)
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Phase 88.6.1-44 — the invites provider keeps its load error and its retry reports the outcome (N7 provider half)', () => {
  it('UN-1. a failed load stores the caught error object; loading ends; the list is empty', async () => {
    queue = [errNet];
    renderProvider();
    await settleOnError();
    expect(ctx.error).toBe(errNet);
    expect(ctx.loading).toBe(false);
    expect(ctx.invites).toEqual([]);
  });

  it('UN-2. a successful retry clears the error and resolves { isError: false }', async () => {
    queue = [errNet, [INV_1]];
    renderProvider();
    await settleOnError();

    const r = await capture(ctx.refetch());
    expect(r.value).toEqual({ isError: false });
    expect(screen.getByTestId('unread-error')).toHaveTextContent('none');
    expect(ctx.error).toBeNull();
    expect(screen.getByText('inv-1')).toBeInTheDocument();
  });

  it('UN-3. a failed retry keeps an error, stores the NEW one, resolves { isError: true } and never rejects', async () => {
    queue = [errNet, err500];
    renderProvider();
    await settleOnError();

    const r = await capture(ctx.refetch());
    expect('value' in r).toBe(true);
    expect('error' in r).toBe(false);
    expect(r.value).toEqual({ isError: true });
    expect(ctx.error).toBe(err500);
  });

  it('UN-4. the error is never cleared while a retry is in flight', async () => {
    const held = deferred<Invite[]>();
    queue = [errNet, held];
    renderProvider();
    await settleOnError();

    let pending!: Promise<unknown>;
    act(() => {
      pending = ctx.refetch();
    });
    // GUARD: the retry is running and the error is still there.
    expect(screen.getByTestId('unread-error')).toHaveTextContent('error');

    await act(async () => {
      held.resolve([INV_1]);
      await pending;
    });
    expect(screen.getByTestId('unread-error')).toHaveTextContent('none');
  });

  it('UN-5. the single-source adapter over the real useFetchErrorState: the code and message follow the stored error, retry hands back { isError }, and refetch keeps one reference', async () => {
    queue = [errNet, err500, [INV_1]];
    renderProvider(true);
    await settleOnError();

    expect(adapter.showError).toBe(true);
    expect(adapter.code).toBe('network');
    expect(adapter.message).toBe(getFetchErrorMessage(errNet));

    const first = await capture(adapter.retry());
    expect(first.value).toEqual({ isError: true });
    expect(adapter.code).toBe('internal');

    const second = await capture(adapter.retry());
    expect(second.value).toEqual({ isError: false });
    expect(adapter.showError).toBe(false);

    expect(retryRefs.length).toBeGreaterThan(1);
    for (const ref of retryRefs) expect(ref).toBe(retryRefs[0]);
  });
});
