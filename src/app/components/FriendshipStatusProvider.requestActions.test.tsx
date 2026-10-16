// Phase 88.6.1-66 (Req 11, SPEC Prohibition 2): the FriendshipStatusProvider's
// friend-request accept / decline list contract, rendered for real. Only the API module
// and the identity hooks are mocked; the provider, its state and its loaders are the
// shipped code.
//
// Why: a failed Accept or Decline used to take the request row off the bell AND the
// Friends page as if it had been handled, while the request was still pending on the
// server. D-54 (remove on confirm): the row leaves the list only once the server confirms.
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9: a block
// comment holding a backtick or a star-slash collects zero tests and still reports green).
import * as React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  getFetchErrorMessage,
  useFetchErrorState,
  type FetchErrorState,
} from '@/components/ui/useFetchErrorState';

// Mutable Auth0 session: later tests switch the signed-in user by changing the sub and
// re-rendering the same tree.
const mockAuth = vi.hoisted(() => ({ sub: 'auth0|self' }));

const mockApi = vi.hoisted(() => ({
  getFriends: vi.fn(),
  getSentRequests: vi.fn(),
  getReceivedRequests: vi.fn(),
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
  sendRequest: vi.fn(),
}));

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
  useUser: () => ({ user: { sub: mockAuth.sub }, isLoading: false }),
}));

// FE-TESTING-CONVENTIONS C-3: spread the real module so ApiError stays real; override only
// the friendship calls this suite drives.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: { ...actual.friendshipsAPI, ...mockApi },
  };
});

import { FriendshipStatusProvider, useFriendshipStatus } from './FriendshipStatusProvider';

interface FriendRequestRow {
  id: string;
  Requester: { id: string; username: string };
}

// The context as this suite reads it. The provider is a .js file, so its inferred default
// type is too narrow to call; this is the documented contract (88.6.1-66 must_haves).
interface Ctx {
  getStatus: (targetUserId: string) => string;
  sendRequest: (targetUserId: string) => Promise<unknown>;
  receivedRequests: FriendRequestRow[];
  acceptRequest: (friendshipId: string) => Promise<unknown>;
  declineRequest: (friendshipId: string) => Promise<unknown>;
  refreshFriendships: () => Promise<unknown>;
  loading: boolean;
  error: unknown;
  isRequestActionPending: (friendshipId: string) => boolean;
  retryFriendships: () => Promise<unknown>;
  hasLoaded: boolean;
}

const REQ: Record<1 | 2 | 3, FriendRequestRow> = {
  1: { id: 'req-1', Requester: { id: '11111111-1111-4111-8111-111111111111', username: 'Ana' } },
  2: { id: 'req-2', Requester: { id: '22222222-2222-4222-8222-222222222222', username: 'Ben' } },
  3: { id: 'req-3', Requester: { id: '33333333-3333-4333-8333-333333333333', username: 'Cal' } },
};
const L = (...n: Array<1 | 2 | 3>): FriendRequestRow[] => n.map((k) => REQ[k]);

// Fresh error objects per test: the provider may write a mark onto the rejected error,
// so one shared object would carry a mark from one test into the next.
const make500 = () => new ApiError('HTTP error! status: 500', 'internal', 500, {});
const make400 = () => new ApiError('Friend request is not pending', 'validation', 400, {});
const makeNet = () => new ApiError('Network error', 'network', 0, null);

// U1 is REQ_1's requester; U_T a fixed stranger (not self, not a requester); U_F a friend
// in the getStatus tests.
const U1 = REQ[1].Requester.id;
const U_T = '44444444-4444-4444-8444-444444444444';
const U_F = '55555555-5555-4555-8555-555555555555';

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

// getReceivedRequests answers from a per-test queue: the first entry feeds the initial
// load, each later call takes the next. An entry is a list, a held deferred, or an error
// to reject with. An exhausted queue answers its last list again, so a background load
// pulled by the provider never hangs a test.
type QueueEntry = FriendRequestRow[] | Deferred<FriendRequestRow[]> | Error;
let receivedQueue: QueueEntry[] = [];
let lastList: FriendRequestRow[] = [];
function queueReceived(...entries: QueueEntry[]) {
  receivedQueue = [...entries];
  lastList = [];
}
function answerReceived(): Promise<FriendRequestRow[]> {
  const next = receivedQueue.shift();
  if (next === undefined) return Promise.resolve(lastList);
  if (Array.isArray(next)) {
    lastList = next;
    return Promise.resolve(next);
  }
  if (next instanceof Error) return Promise.reject(next);
  return next.promise.then((list) => {
    lastList = list;
    return list;
  });
}

let ctx!: Ctx;

function Probe() {
  const value = useFriendshipStatus() as unknown as Ctx;
  ctx = value;
  return (
    <div>
      <ul aria-label="Received requests">
        {value.receivedRequests.map((r, i) => (
          <li key={`${r.id}:${i}`}>{r.id}</li>
        ))}
      </ul>
      <p data-testid="provider-error">{value.error ? 'error' : 'none'}</p>
    </div>
  );
}

// The banner adapter plans 88.6.1-72 and -80 write, run with the REAL hook:
// useFetchErrorState({ isError: Boolean(error), error, refetch: retryFriendships }).
// Each instance stores its state under its name and records the context's two retry
// functions on every render, so a test can check they keep one reference.
const adapters: Record<string, FetchErrorState> = {};
let retryRefs: unknown[] = [];
let refreshRefs: unknown[] = [];

function AdapterProbe({ name }: { name: string }) {
  const { error, retryFriendships, refreshFriendships } = useFriendshipStatus() as unknown as Ctx;
  retryRefs.push(retryFriendships);
  refreshRefs.push(refreshFriendships);
  adapters[name] = useFetchErrorState({
    isError: Boolean(error),
    error,
    refetch: retryFriendships,
  } as unknown as UseQueryResult);
  return null;
}

function tree(adapterNames: string[] = []) {
  return (
    <FriendshipStatusProvider>
      <Probe />
      {adapterNames.map((name) => (
        <AdapterProbe key={name} name={name} />
      ))}
    </FriendshipStatusProvider>
  );
}

// How a render settles, always on a POSITIVE signal (FE-TESTING-CONVENTIONS CF-26):
// 'list' a request row appears; 'error' provider-error reads error; 'probe' only the
// Probe's provider-error node exists; 'loaded' ctx.loading is false.
type Settle = 'list' | 'error' | 'probe' | 'loaded';

async function settleOn(settle: Settle) {
  if (settle === 'list') await screen.findAllByRole('listitem');
  else if (settle === 'error')
    await waitFor(() => expect(screen.getByTestId('provider-error')).toHaveTextContent('error'));
  else if (settle === 'probe') await screen.findByTestId('provider-error');
  else await waitFor(() => expect(ctx.loading).toBe(false));
}

// Renders the real provider and settles positively; returns the render result so a test
// can re-render the same tree after switching the signed-in user.
async function renderProvider(
  opts: { settle?: Settle; adapters?: string[] } = {}
) {
  const utils = render(tree(opts.adapters));
  await settleOn(opts.settle ?? 'list');
  return utils;
}

function ids(): Array<string | null> {
  return within(screen.getByRole('list', { name: 'Received requests' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Captured {
  value?: unknown;
  error?: unknown;
}

// Awaits a call inside act and returns { value } or { error }: a rejection is always caught.
async function capture(call: Promise<unknown> | (() => Promise<unknown>)): Promise<Captured> {
  let out: Captured = {};
  await act(async () => {
    try {
      out = { value: await (typeof call === 'function' ? call() : call) };
    } catch (error) {
      out = { error };
    }
    await flush();
  });
  return out;
}

// Starts a call inside a synchronous act and keeps it running; the returned promise never
// rejects (its outcome is captured), so a held call can be settled later without an
// unhandled rejection.
function start(call: () => Promise<unknown>): Promise<Captured> {
  let settled!: Promise<Captured>;
  act(() => {
    settled = call().then(
      (value) => ({ value }),
      (error) => ({ error })
    );
  });
  return settled;
}

async function finish(running: Promise<Captured>): Promise<Captured> {
  let out!: Captured;
  await act(async () => {
    out = await running;
    await flush();
  });
  return out;
}

// Settles something the test holds (a deferred) inside act, then lets the provider land it.
async function settleHeld(fn: () => void) {
  await act(async () => {
    fn();
    await flush();
  });
}

beforeEach(() => {
  mockAuth.sub = 'auth0|self';
  queueReceived();
  retryRefs = [];
  refreshRefs = [];
  for (const name of Object.keys(adapters)) delete adapters[name];
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.getFriends.mockResolvedValue([]);
  mockApi.getSentRequests.mockResolvedValue([]);
  mockApi.getReceivedRequests.mockImplementation(answerReceived);
  mockApi.acceptRequest.mockResolvedValue({});
  mockApi.declineRequest.mockResolvedValue({});
  mockApi.sendRequest.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

describe('friend-request accept / decline (Req 11, D-54 remove on confirm)', () => {
  it('RA-1. a failed accept (500) keeps the row at its original index, once, and rejects with the same error', async () => {
    queueReceived(L(1, 2, 3), L(1, 2, 3));
    const err500 = make500();
    mockApi.acceptRequest.mockRejectedValue(err500);
    await renderProvider();

    const r = await capture(() => ctx.acceptRequest('req-2'));

    expect(r.error).toBe(err500);
    expect(ids()).toEqual(['req-1', 'req-2', 'req-3']);
    // The initial load, then the one reconcile read.
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);
  });

  it('RA-2. while an accept is in flight the row stays; success removes it after the confirm, before the refresh lands', async () => {
    const refresh = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2, 3), refresh);
    const d = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(d.promise);
    await renderProvider();

    const running = start(() => ctx.acceptRequest('req-2'));
    expect(ids()).toEqual(['req-1', 'req-2', 'req-3']);

    d.resolve({});
    const r = await finish(running);
    expect(r.value).toEqual({ alreadyAccepted: false });
    // The refresh is still held: the removal does not wait for it.
    expect(ids()).toEqual(['req-1', 'req-3']);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);

    await settleHeld(() => refresh.resolve(L(1, 3)));
    expect(ids()).toEqual(['req-1', 'req-3']);
  });

  it('RA-3. a stale accept (the backend 400 "not pending") is reconciled away: the server no longer lists it', async () => {
    queueReceived(L(1, 2, 3), L(1, 3), L(1, 3));
    const err400 = make400();
    mockApi.acceptRequest.mockRejectedValue(err400);
    await renderProvider();

    const r = await capture(() => ctx.acceptRequest('req-2'));

    expect(r.error).toBe(err400);
    expect(ids()).toEqual(['req-1', 'req-3']);
    // The initial load, the reconcile read, then the load the reconcile pulls.
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(3);
  });

  it('RA-11. the rejection says whether the reconcile removed the row (requestRowRemoved on the same error)', async () => {
    // Arm (a), removed: the backend committed the accept, then failed to answer; the
    // reconcile read no longer lists req-2.
    queueReceived(L(1, 2), L(1), L(1));
    const errA = make500();
    mockApi.acceptRequest.mockRejectedValue(errA);
    await renderProvider();
    const a = await capture(() => ctx.acceptRequest('req-2'));
    expect(a.error).toBe(errA);
    expect((errA as unknown as { requestRowRemoved?: unknown }).requestRowRemoved).toBe(true);
    expect(ids()).toEqual(['req-1']);

    // Arm (b), kept: the server still lists req-2, so nothing is marked.
    cleanup();
    queueReceived(L(1, 2), L(1, 2));
    const errB = make500();
    mockApi.acceptRequest.mockRejectedValue(errB);
    await renderProvider();
    const b = await capture(() => ctx.acceptRequest('req-2'));
    expect(b.error).toBe(errB);
    expect(errB).not.toHaveProperty('requestRowRemoved');
    expect(ids()).toEqual(['req-1', 'req-2']);

    // Arm (c), the reconcile read itself fails: nothing is known, so nothing is marked.
    cleanup();
    queueReceived(L(1, 2), makeNet());
    const errC = make500();
    mockApi.acceptRequest.mockRejectedValue(errC);
    await renderProvider();
    const c = await capture(() => ctx.acceptRequest('req-2'));
    expect(c.error).toBe(errC);
    expect(errC).not.toHaveProperty('requestRowRemoved');
    expect(ids()).toEqual(['req-1', 'req-2']);
  });

  it('RA-4. a failed decline (network) keeps the row at its original index and rejects with the same error', async () => {
    queueReceived(L(1, 2, 3), L(1, 2, 3));
    const errNet = makeNet();
    mockApi.declineRequest.mockRejectedValue(errNet);
    await renderProvider();

    const r = await capture(() => ctx.declineRequest('req-3'));

    expect(r.error).toBe(errNet);
    expect(ids()).toEqual(['req-1', 'req-2', 'req-3']);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);
  });

  it('RA-5. while a decline is in flight the row stays; success removes it after the confirm and pulls the newest load', async () => {
    const refresh = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2, 3), refresh);
    const d = deferred<unknown>();
    mockApi.declineRequest.mockReturnValueOnce(d.promise);
    await renderProvider();

    const running = start(() => ctx.declineRequest('req-1'));
    expect(ids()).toEqual(['req-1', 'req-2', 'req-3']);

    d.resolve({});
    const r = await finish(running);
    expect(r.value).toEqual({ alreadyDeclined: false });
    // The refresh is still held: the removal does not wait for it.
    expect(ids()).toEqual(['req-2', 'req-3']);
    // The initial load, then the load the confirmed decline starts (so no load begun
    // before the decline can land last and put the row back).
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);

    await settleHeld(() => refresh.resolve(L(2, 3)));
    expect(ids()).toEqual(['req-2', 'req-3']);
  });

  it('RA-6. GUARD: the 404 "already handled" arms remove the row at once, pull a load and resolve already*', async () => {
    // Arm (a): accept.
    const heldA = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2, 3), heldA);
    mockApi.acceptRequest.mockRejectedValue(
      new ApiError('Friendship not found', 'not_found', 404, {})
    );
    await renderProvider();
    const a = await capture(() => ctx.acceptRequest('req-2'));
    expect(a.value).toEqual({ alreadyAccepted: true });
    // While the refresh is still held.
    expect(ids()).toEqual(['req-1', 'req-3']);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);

    // Arm (b): decline, detected through the message half of the unchanged line.
    cleanup();
    mockApi.getReceivedRequests.mockClear();
    const heldB = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2, 3), heldB);
    mockApi.declineRequest.mockRejectedValue(new Error('HTTP error! status: 404'));
    await renderProvider();
    const b = await capture(() => ctx.declineRequest('req-1'));
    expect(b.value).toEqual({ alreadyDeclined: true });
    expect(ids()).toEqual(['req-2', 'req-3']);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);
  });

  it('RA-7. GUARD (SPEC Edge R11 ordering): a background refresh during the flight neither duplicates nor resurrects the row', async () => {
    // Arm (a): the server still lists req-1 throughout.
    queueReceived(L(1, 2), L(1, 2), L(1, 2));
    const dA = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(dA.promise);
    await renderProvider();
    const runningA = start(() => ctx.acceptRequest('req-1'));
    await capture(() => ctx.refreshFriendships());
    dA.reject(make500());
    const a = await finish(runningA);
    expect(a.error).toBeInstanceOf(ApiError);
    expect(ids()).toEqual(['req-1', 'req-2']);

    // Arm (b): the refresh shows the server dropped req-1; the failure must not bring it back.
    cleanup();
    queueReceived(L(1, 2), L(2), L(2));
    const dB = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(dB.promise);
    await renderProvider();
    const runningB = start(() => ctx.acceptRequest('req-1'));
    await capture(() => ctx.refreshFriendships());
    dB.reject(make500());
    const b = await finish(runningB);
    expect(b.error).toBeInstanceOf(ApiError);
    expect(ids()).toEqual(['req-2']);
  });

  it('RA-8. SPEC Edge R11 concurrency: an accept on one row and a decline on another, both in flight', async () => {
    // The accept's own refresh is held, so the assertion after its confirm reads the
    // provider's write, not a later load that happens to list the same rows.
    const acceptRefresh = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2, 3), acceptRefresh, L(2, 3));
    const dA = deferred<unknown>();
    const dD = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(dA.promise);
    mockApi.declineRequest.mockReturnValueOnce(dD.promise);
    await renderProvider();

    const accepting = start(() => ctx.acceptRequest('req-1'));
    const declining = start(() => ctx.declineRequest('req-3'));

    dA.resolve({});
    await finish(accepting);
    // The accept removed only its row; the decline's row is still in flight, so it stays.
    expect(ids()).toEqual(['req-2', 'req-3']);
    await settleHeld(() => acceptRefresh.resolve(L(2, 3)));

    const err500 = make500();
    dD.reject(err500);
    const r = await finish(declining);
    expect(r.error).toBe(err500);
    expect(ids()).toEqual(['req-2', 'req-3']);
  });

  it('RA-9. SPEC Edge R11 ordering: the reconcile touches only its own row and never resurrects another', async () => {
    const R = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2), R, L(1));
    const err500 = make500();
    mockApi.acceptRequest.mockImplementation((id: string) =>
      id === 'req-1' ? Promise.reject(err500) : Promise.resolve({})
    );
    await renderProvider();

    const first = start(() => ctx.acceptRequest('req-1'));
    // Let req-1's failure reach its reconcile read (held on R).
    await settleHeld(() => undefined);
    expect(mockApi.getReceivedRequests).toHaveBeenCalledTimes(2);

    const second = await capture(() => ctx.acceptRequest('req-2'));
    expect(second.value).toEqual({ alreadyAccepted: false });
    expect(ids()).toEqual(['req-1']);

    // The reconcile's read was sent before req-2 was accepted, so it still lists req-2.
    R.resolve(L(1, 2));
    const r = await finish(first);
    expect(r.error).toBe(err500);
    expect(ids()).toEqual(['req-1']);
  });

  it('RA-10. a reconcile whose own read fails writes nothing: the row stays and the load-error flag stays unset', async () => {
    queueReceived(L(1, 2), makeNet());
    const err500 = make500();
    mockApi.acceptRequest.mockRejectedValue(err500);
    await renderProvider();

    const r = await capture(() => ctx.acceptRequest('req-2'));

    expect(r.error).toBe(err500);
    expect(ids()).toEqual(['req-1', 'req-2']);
    expect(screen.getByTestId('provider-error')).toHaveTextContent('none');
    expect(ctx.error).toBeFalsy();
  });

  it('RA-12. one request per row at a time, whichever surface presses; the in-flight fact is exposed and released', async () => {
    // Arm (a), the same kind twice: one request, one shared outcome.
    queueReceived(L(1, 2), L(2));
    const dA = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(dA.promise);
    await renderProvider();
    const one = start(() => ctx.acceptRequest('req-1'));
    const two = start(() => ctx.acceptRequest('req-1'));
    expect(mockApi.acceptRequest).toHaveBeenCalledTimes(1);
    dA.resolve({});
    const r1 = await finish(one);
    const r2 = await finish(two);
    expect(r1.value).toEqual({ alreadyAccepted: false });
    expect(r2.value).toEqual({ alreadyAccepted: false });
    expect(r2.value).toBe(r1.value);

    // Arm (b), the other kind while one is in flight: refused, never joined, no request.
    cleanup();
    mockApi.acceptRequest.mockReset();
    queueReceived(L(1, 2), L(2));
    const dB = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(dB.promise);
    await renderProvider();
    const accepting = start(() => ctx.acceptRequest('req-1'));
    // Started, not awaited: a decline wrongly joined to the held accept would otherwise
    // hang here instead of failing on the assertion below.
    const declining = start(() => ctx.declineRequest('req-1'));
    expect(mockApi.declineRequest).not.toHaveBeenCalled();
    dB.resolve({});
    const accepted = await finish(accepting);
    const refused = await finish(declining);
    expect(accepted.value).toEqual({ alreadyAccepted: false });
    // Refused, never joined: it did not resolve the accept's outcome as its own.
    expect(refused).not.toHaveProperty('value');
    expect(refused.error).toBeInstanceOf(Error);

    // Arm (c), the exposed fact and its release: a retry after a failure goes through.
    cleanup();
    mockApi.acceptRequest.mockReset();
    mockApi.acceptRequest.mockResolvedValue({});
    queueReceived(L(1, 2), L(1, 2), L(1, 2));
    const dC = deferred<unknown>();
    mockApi.acceptRequest.mockReturnValueOnce(dC.promise);
    await renderProvider();
    const failing = start(() => ctx.acceptRequest('req-1'));
    expect(ctx.isRequestActionPending('req-1')).toBe(true);
    expect(ctx.isRequestActionPending('req-2')).toBe(false);
    dC.reject(make500());
    const failed = await finish(failing);
    expect(failed.error).toBeInstanceOf(ApiError);
    expect(ctx.isRequestActionPending('req-1')).toBe(false);
    const retried = await capture(() => ctx.acceptRequest('req-1'));
    expect(retried.value).toEqual({ alreadyAccepted: false });
    expect(mockApi.acceptRequest).toHaveBeenCalledTimes(2);
  });
});

describe('load-error recovery', () => {
  it('LE-1. a failed load stores the caught error object; getStatus withholds', async () => {
    const errNet = makeNet();
    queueReceived(errNet);
    await renderProvider({ settle: 'error' });

    expect(ctx.error).toBe(errNet);
    expect(ctx.loading).toBe(false);
    expect(ctx.getStatus(U1)).toBe('unknown');
  });

  it('LE-2. a successful retry clears the flag and resolves { isError: false }', async () => {
    queueReceived(makeNet(), L(1, 2));
    await renderProvider({ settle: 'error' });

    const r = await capture(() => ctx.refreshFriendships());

    expect(r.value).toEqual({ isError: false });
    expect(screen.getByTestId('provider-error')).toHaveTextContent('none');
    expect(ctx.error).toBeNull();
    expect(ids()).toEqual(['req-1', 'req-2']);
    expect(ctx.getStatus(U1)).toBe('pending_received');
  });

  it('LE-3. a failed retry keeps the flag, stores the NEW error, resolves { isError: true } and never rejects', async () => {
    const err500 = make500();
    queueReceived(makeNet(), err500);
    await renderProvider({ settle: 'error' });

    const r = await capture(() => ctx.refreshFriendships());

    expect(r).toHaveProperty('value');
    expect(r).not.toHaveProperty('error');
    expect(r.value).toEqual({ isError: true });
    expect(ctx.error).toBe(err500);
    expect(screen.getByTestId('provider-error')).toHaveTextContent('error');
  });

  it('LE-4. the flag is never cleared while a retry is in flight; it clears when the success lands', async () => {
    const R = deferred<FriendRequestRow[]>();
    queueReceived(makeNet(), R);
    await renderProvider({ settle: 'error' });

    const retrying = start(() => ctx.refreshFriendships());
    // GUARD half: a banner keyed on the flag stays mounted through its own Retry.
    expect(screen.getByTestId('provider-error')).toHaveTextContent('error');

    R.resolve(L(1));
    await finish(retrying);
    expect(screen.getByTestId('provider-error')).toHaveTextContent('none');
  });

  it('LE-5. the mount path clears the flag too (a change of signed-in user runs the one loader)', async () => {
    queueReceived(makeNet(), L(1));
    const { rerender } = await renderProvider({ settle: 'error' });

    mockAuth.sub = 'auth0|other';
    rerender(tree());
    await waitFor(() => expect(ids()).toEqual(['req-1']));

    expect(screen.getByTestId('provider-error')).toHaveTextContent('none');
  });

  it('LE-6. the banner adapter (real useFetchErrorState) reads the error code and the retry outcome', async () => {
    const errNet = makeNet();
    queueReceived(errNet, make500(), L(1));
    await renderProvider({ settle: 'error', adapters: ['banner'] });

    expect(adapters.banner.showError).toBe(true);
    expect(adapters.banner.code).toBe('network');
    // Compared with the register function's own output: no copy literal in this test.
    expect(adapters.banner.message).toBe(getFetchErrorMessage(errNet));

    const failed = await capture(() => adapters.banner.retry());
    expect(failed.value).toEqual({ isError: true });
    expect(adapters.banner.code).toBe('internal');

    const recovered = await capture(() => adapters.banner.retry());
    expect(recovered.value).toEqual({ isError: false });
    expect(adapters.banner.showError).toBe(false);

    // One reference per signed-in user for both, so the hook's refetch keeps its identity.
    expect(retryRefs.length).toBeGreaterThan(1);
    for (const ref of retryRefs) expect(ref).toBe(retryRefs[0]);
    for (const ref of refreshRefs) expect(ref).toBe(refreshRefs[0]);
  });
});

describe('one guarded load', () => {
  it('SQ-1. an older load that lands later is ignored (the lists) and resolves to the newest outcome', async () => {
    const dA = deferred<FriendRequestRow[]>();
    const dB = deferred<FriendRequestRow[]>();
    queueReceived(L(1), dA, dB);
    await renderProvider();
    expect(ids()).toEqual(['req-1']);

    const pA = start(() => ctx.refreshFriendships());
    const pB = start(() => ctx.refreshFriendships());

    dB.resolve(L(2));
    expect((await finish(pB)).value).toEqual({ isError: false });
    expect(ids()).toEqual(['req-2']);

    dA.resolve(L(1, 3));
    expect((await finish(pA)).value).toEqual({ isError: false });
    expect(ids()).toEqual(['req-2']);
  });

  it('SQ-2. an older load that lands later is ignored (the flag, both directions)', async () => {
    // Arm (a): the newer load succeeds, the older one fails later.
    const dA = deferred<FriendRequestRow[]>();
    const dB = deferred<FriendRequestRow[]>();
    queueReceived(L(1), dA, dB);
    await renderProvider();
    const pA = start(() => ctx.refreshFriendships());
    const pB = start(() => ctx.refreshFriendships());
    dB.resolve(L(1));
    await finish(pB);
    dA.reject(makeNet());
    const a = await finish(pA);
    expect(screen.getByTestId('provider-error')).toHaveTextContent('none');
    expect(ctx.error).toBeNull();
    expect(a.value).toEqual({ isError: false });

    // Arm (b): the newer load fails, the older one succeeds later.
    cleanup();
    const errNet = makeNet();
    const dA2 = deferred<FriendRequestRow[]>();
    const dB2 = deferred<FriendRequestRow[]>();
    queueReceived(L(1), dA2, dB2);
    await renderProvider();
    const pA2 = start(() => ctx.refreshFriendships());
    const pB2 = start(() => ctx.refreshFriendships());
    dB2.reject(errNet);
    expect((await finish(pB2)).value).toEqual({ isError: true });
    dA2.resolve(L(1, 2));
    const b = await finish(pA2);
    expect(ids()).toEqual(['req-1']);
    expect(ctx.error).toBe(errNet);
    expect(screen.getByTestId('provider-error')).toHaveTextContent('error');
    expect(b.value).toEqual({ isError: true });
  });

  it('SQ-3. a load begun before a confirmed ACCEPT never puts the accepted row back', async () => {
    const dA = deferred<FriendRequestRow[]>();
    const dB = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2), dA, dB);
    await renderProvider();
    expect(ids()).toEqual(['req-1', 'req-2']);

    // A background load whose snapshot predates the accept.
    const pA = start(() => ctx.refreshFriendships());
    // The confirm removes the row and starts the accept's own load, which takes dB.
    await capture(() => ctx.acceptRequest('req-1'));

    await settleHeld(() => dA.resolve(L(1, 2)));
    expect(ids()).toEqual(['req-2']);

    await settleHeld(() => dB.resolve(L(2)));
    await finish(pA);
    expect(ids()).toEqual(['req-2']);
  });

  it('SQ-4. a load begun before a confirmed DECLINE never puts the declined row back', async () => {
    const dA = deferred<FriendRequestRow[]>();
    const dB = deferred<FriendRequestRow[]>();
    queueReceived(L(1, 2), dA, dB);
    await renderProvider();

    const pA = start(() => ctx.refreshFriendships());
    await capture(() => ctx.declineRequest('req-1'));

    await settleHeld(() => dA.resolve(L(1, 2)));
    expect(ids()).toEqual(['req-2']);

    await settleHeld(() => dB.resolve(L(2)));
    await finish(pA);
    expect(ids()).toEqual(['req-2']);
  });

  it('SQ-5. a sent request is not erased by an older load (the send is followed by the newest load)', async () => {
    const dA = deferred<FriendRequestRow[]>();
    queueReceived([], dA, []);
    mockApi.getSentRequests
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'sent-1', Addressee: { id: U_T } }]);
    mockApi.sendRequest.mockResolvedValue({ id: 'sent-1' });
    await renderProvider({ settle: 'loaded' });

    // A background load whose snapshot (an empty sent list) predates the send.
    const pA = start(() => ctx.refreshFriendships());
    await capture(() => ctx.sendRequest(U_T));
    expect(ctx.getStatus(U_T)).toBe('pending_sent');

    dA.resolve([]);
    await finish(pA);
    expect(ctx.getStatus(U_T)).toBe('pending_sent');
  });

  it('SQ-6. GUARD: the previous user\'s late load writes nothing (a user switch; a sign-out)', async () => {
    // Arm (a), a user switch.
    const dA = deferred<FriendRequestRow[]>();
    queueReceived(dA, L(2));
    const { rerender } = await renderProvider({ settle: 'probe' });
    mockAuth.sub = 'auth0|other';
    rerender(tree());
    await waitFor(() => expect(ids()).toEqual(['req-2']));
    await settleHeld(() => dA.resolve(L(1)));
    expect(ids()).toEqual(['req-2']);

    // Arm (b), a sign-out: the signed-out call takes a generation and loads nothing.
    cleanup();
    mockAuth.sub = 'auth0|self';
    const dA2 = deferred<FriendRequestRow[]>();
    queueReceived(dA2);
    const second = await renderProvider({ settle: 'probe' });
    mockAuth.sub = '';
    second.rerender(tree());
    await settleHeld(() => dA2.resolve(L(1)));
    expect(ids()).toEqual([]);
  });

  it('SQ-7. loading turns false only from the newest load', async () => {
    const dM = deferred<FriendRequestRow[]>();
    const dB = deferred<FriendRequestRow[]>();
    queueReceived(dM, dB);
    await renderProvider({ settle: 'probe' });
    expect(ctx.loading).toBe(true);

    const pB = start(() => ctx.refreshFriendships());
    await settleHeld(() => dM.resolve(L(1)));
    expect(ctx.loading).toBe(true);
    expect(ids()).toEqual([]);

    dB.resolve(L(2));
    await finish(pB);
    expect(ctx.loading).toBe(false);
    expect(ids()).toEqual(['req-2']);
  });

  it('SQ-8. erroring banners share ONE retry load on one return to the tab (retryFriendships joins)', async () => {
    const dR = deferred<FriendRequestRow[]>();
    queueReceived(makeNet(), dR);
    await renderProvider({ settle: 'error', adapters: ['requests', 'bell'] });
    expect(adapters.requests.showError).toBe(true);
    expect(adapters.bell.showError).toBe(true);
    const before = mockApi.getFriends.mock.calls.length;

    // The hook's refocus effect fires only while the document reads visible.
    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(mockApi.getFriends.mock.calls.length).toBe(before + 1);

      await settleHeld(() => dR.resolve(L(1)));
      expect(adapters.requests.showError).toBe(false);
      expect(adapters.bell.showError).toBe(false);
      expect(ids()).toEqual(['req-1']);
    } finally {
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  });
});

describe('getStatus during the first load', () => {
  beforeEach(() => {
    mockApi.getFriends.mockResolvedValue([{ friend: { id: U_F } }]);
  });

  it('GS-1. before the first load a known friend reads unknown (not none); after it, accepted', async () => {
    const dM = deferred<FriendRequestRow[]>();
    queueReceived(dM);
    await renderProvider({ settle: 'probe' });

    expect(ctx.loading).toBe(true);
    expect(ctx.getStatus(U_F)).toBe('unknown');
    expect(ctx.getStatus(U_T)).toBe('unknown');

    await settleHeld(() => dM.resolve([]));
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.getStatus(U_F)).toBe('accepted');
    expect(ctx.getStatus(U_T)).toBe('none');
  });

  it('GS-2. a later refresh never flips a resolved status back', async () => {
    const dR = deferred<FriendRequestRow[]>();
    queueReceived([], dR);
    await renderProvider({ settle: 'loaded' });
    expect(ctx.getStatus(U_F)).toBe('accepted');

    const pR = start(() => ctx.refreshFriendships());
    expect(ctx.loading).toBe(false);
    expect(ctx.getStatus(U_F)).toBe('accepted');

    dR.resolve([]);
    await finish(pR);
    expect(ctx.getStatus(U_F)).toBe('accepted');
  });

  it('GS-3. the window ends when the NEWEST load settles, even when the mount load is superseded', async () => {
    const dM = deferred<FriendRequestRow[]>();
    queueReceived(dM, []);
    await renderProvider({ settle: 'probe' });
    expect(ctx.getStatus(U_F)).toBe('unknown');

    await capture(() => ctx.refreshFriendships());
    // The mount load is still held.
    expect(ctx.loading).toBe(false);
    expect(ctx.getStatus(U_F)).toBe('accepted');

    await settleHeld(() => dM.resolve([]));
    expect(ctx.getStatus(U_F)).toBe('accepted');
  });
});

describe('hasLoaded', () => {
  it('HL-1. a list that loaded EMPTY has loaded (never a row count)', async () => {
    queueReceived([]);
    await renderProvider({ settle: 'loaded' });

    expect(ctx.hasLoaded).toBe(true);
    expect(ids()).toEqual([]);
  });

  it('HL-2. a failed FIRST load has not loaded although loading is over; the first success sets it', async () => {
    queueReceived(makeNet(), []);
    await renderProvider({ settle: 'error' });

    expect(ctx.loading).toBe(false);
    expect(ctx.hasLoaded).toBe(false);

    const r = await capture(() => ctx.refreshFriendships());
    expect(r.value).toEqual({ isError: false });
    expect(ctx.hasLoaded).toBe(true);
  });

  it('HL-3. a failed refresh after an EMPTY load keeps it (D-50: a loaded-empty list is retained)', async () => {
    const err500 = make500();
    queueReceived([], err500);
    await renderProvider({ settle: 'loaded' });
    expect(ctx.hasLoaded).toBe(true);

    const r = await capture(() => ctx.refreshFriendships());
    expect(r.value).toEqual({ isError: true });

    expect(ctx.hasLoaded).toBe(true);
    expect(ctx.error).toBe(err500);
    expect(ids()).toEqual([]);
  });

  it('HL-4. keyed on the signed-in user through the mount effect reset; the previous user\'s rows leave', async () => {
    const dA = deferred<FriendRequestRow[]>();
    queueReceived(L(1), dA);
    const { rerender } = await renderProvider();
    expect(ids()).toEqual(['req-1']);
    expect(ctx.hasLoaded).toBe(true);

    mockAuth.sub = 'auth0|other';
    rerender(tree());
    // While the new user's first load is held.
    expect(ctx.hasLoaded).toBe(false);
    expect(ids()).toEqual([]);

    await settleHeld(() => dA.resolve([]));
    await waitFor(() => expect(ctx.hasLoaded).toBe(true));
    expect(ids()).toEqual([]);

    // A sign-out.
    mockAuth.sub = '';
    rerender(tree());
    expect(ctx.hasLoaded).toBe(false);
  });

  it('HL-5. only the newest load writes it: a superseded success does not', async () => {
    const dM = deferred<FriendRequestRow[]>();
    const dB = deferred<FriendRequestRow[]>();
    queueReceived(dM, dB);
    await renderProvider({ settle: 'probe' });

    const pB = start(() => ctx.refreshFriendships());
    dB.reject(makeNet());
    expect((await finish(pB)).value).toEqual({ isError: true });
    expect(ctx.hasLoaded).toBe(false);

    await settleHeld(() => dM.resolve(L(1)));
    expect(ctx.hasLoaded).toBe(false);
    expect(ids()).toEqual([]);
  });
});
