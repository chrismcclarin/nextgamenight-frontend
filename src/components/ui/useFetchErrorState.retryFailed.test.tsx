// retryFailed — the HOST remembers that a retry the person started has failed (plan 88.6.1-69,
// owner ruling 2026-10-05, "c everywhere"): on every full FetchErrorBanner, Try again is always
// there, and Report this appears only after a retry has failed, then stays for as long as that
// failure persists.
//
// Why the memory lives in useFetchErrorState and not in the banner: at a never-loaded TanStack
// query the caller removes the banner at the PRESS (the refetch commits status pending with no
// data, so isError reads false) and re-inserts it when the retry fails. Anything the banner kept
// would die with it. H1 is the tracer for exactly that shape.
//
// Every banner here renders inside FeedbackModalProvider, the app-level host every page has
// (src/app/layout.js mounts it around the whole app). Comments in this file are line comments
// only (conventions CF-9).
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/userProfile',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { useFetchErrorState } from './useFetchErrorState';
import type { FetchErrorState } from './useFetchErrorState';
import { FetchErrorBanner, RefreshFailedNotice, RETRY_OUTCOME_WINDOW_MS } from './FetchErrorBanner';
import { FeedbackModalProvider } from '@/app/components/FeedbackModalProvider';
import { ApiError } from '@/lib/api';

afterEach(() => cleanup());

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The house test-client idiom (PromptScheduleSection.test.tsx): no silent retry, no cache life.
function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// A queryFn the test drives: each call takes the next deferred from the queue.
function drivenQueryFn() {
  const runs: Array<ReturnType<typeof deferred<string[]>>> = [];
  const queryFn = vi.fn(() => {
    const d = deferred<string[]>();
    runs.push(d);
    return d.promise;
  });
  return { runs, queryFn };
}

const LIST_TITLE = "Couldn't load the list";

// The caller-gated, never-loaded host: the banner renders only while showError is true, and a
// pending query shows its loading line instead (the shape of every full mount, plan 21 census).
function NeverLoadedHost({
  queryFn,
  probe,
  refetchResults,
  stateRef,
}: {
  queryFn: () => Promise<string[]>;
  probe: Array<boolean | undefined>;
  refetchResults?: Array<Promise<unknown>>;
  stateRef?: { current: FetchErrorState | null };
}) {
  const query = useQuery({ queryKey: ['retryFailed', 'list'], queryFn });
  const { refetch } = query;
  // Records the very promise TanStack's refetch returned, so H3 can compare identity.
  const recordingRefetch = React.useCallback(
    (...args: Parameters<typeof refetch>) => {
      const p = refetch(...args);
      refetchResults?.push(p);
      return p;
    },
    [refetch, refetchResults]
  );
  const state = useFetchErrorState({ ...query, refetch: recordingRefetch } as typeof query);
  probe.push(state.retryFailed);
  if (stateRef) stateRef.current = state;
  return (
    <main>
      <h1>Page</h1>
      {state.showError ? (
        <FetchErrorBanner state={state} title={LIST_TITLE} />
      ) : query.isPending ? (
        <p>Loading the list</p>
      ) : (
        <p>ok</p>
      )}
    </main>
  );
}

function renderNeverLoaded(extra: { refetchResults?: Array<Promise<unknown>>; stateRef?: { current: FetchErrorState | null } } = {}) {
  const { runs, queryFn } = drivenQueryFn();
  const probe: Array<boolean | undefined> = [];
  const client = testClient();
  render(
    <QueryClientProvider client={client}>
      <FeedbackModalProvider>
        <NeverLoadedHost queryFn={queryFn} probe={probe} {...extra} />
      </FeedbackModalProvider>
    </QueryClientProvider>
  );
  return { runs, queryFn, probe };
}

function boom(label: string) {
  return new ApiError(label, 'network', 0);
}

// A hand-built failed state, the shape 16 test doubles across the tree use (no retryFailed).
function failedState(over: Partial<FetchErrorState> = {}): FetchErrorState {
  return {
    showError: true,
    message: 'boom',
    code: 'unknown',
    retry: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('retryFailed — the host remembers a failed retry (plan 88.6.1-69, owner ruling 2026-10-05)', () => {
  it('H1. a never-loaded caller-gated banner offers only Try again, then Report this on the re-inserted banner after the retry fails', async () => {
    const user = userEvent.setup();
    const { runs, probe } = renderNeverLoaded();

    // First load fails.
    await act(async () => {
      runs[0].reject(boom('first'));
    });
    const tryAgain = await screen.findByRole('button', { name: 'Try again' });
    expect(tryAgain).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this' }), 'no report link at the first failure').toBeNull();
    expect(probe[probe.length - 1]).toBe(false);

    // The press: the caller swaps the banner out (pending, no data).
    await user.click(tryAgain);
    await screen.findByText('Loading the list');
    expect(screen.queryByRole('button', { name: 'Try again' }), 'the banner left at the press').toBeNull();
    expect(runs).toHaveLength(2);

    // The retry fails: the caller re-inserts the banner, and the host remembered.
    await act(async () => {
      runs[1].reject(boom('second'));
    });
    const report = await screen.findByRole('button', { name: 'Report this' });
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(again.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING, 'Report this follows Try again').toBeTruthy();
    expect(probe[probe.length - 1]).toBe(true);
  });

  it('H2. a retry that succeeds never raises the flag and the content renders', async () => {
    const user = userEvent.setup();
    const { runs, probe } = renderNeverLoaded();
    await act(async () => {
      runs[0].reject(boom('first'));
    });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    const pressedAt = probe.length;
    await act(async () => {
      runs[1].resolve(['a']);
    });
    await screen.findByText('ok');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const after = probe.slice(pressedAt);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((v) => v === false), `every render after the press: ${JSON.stringify(after)}`).toBe(true);
  });

  it('H3. state.retry() resolves the very object TanStack refetch resolved, isError matching the outcome', async () => {
    const refetchResults: Array<Promise<unknown>> = [];
    const stateRef: { current: FetchErrorState | null } = { current: null };
    const { runs } = renderNeverLoaded({ refetchResults, stateRef });
    await act(async () => {
      runs[0].reject(boom('first'));
    });
    await screen.findByRole('button', { name: 'Try again' });

    let retried!: Promise<unknown>;
    act(() => {
      retried = stateRef.current!.retry();
    });
    await act(async () => {
      runs[1].reject(boom('second'));
    });
    const result = await retried;
    expect(refetchResults).toHaveLength(1);
    expect(result).toBe(await refetchResults[0]);
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it('R1. the render rule: no Report this without retryFailed; with it, Report this follows Try again outside every live region', () => {
    const { unmount } = render(
      <FeedbackModalProvider>
        <FetchErrorBanner state={failedState()} title={LIST_TITLE} />
      </FeedbackModalProvider>
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this' }), 'absent field reads as no failed retry').toBeNull();
    unmount();

    render(
      <FeedbackModalProvider>
        <FetchErrorBanner state={failedState({ retryFailed: true })} title={LIST_TITLE} />
      </FeedbackModalProvider>
    );
    const again = screen.getByRole('button', { name: 'Try again' });
    const report = screen.getByRole('button', { name: 'Report this' });
    expect(again.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(report.closest('[aria-live]'), 'in the actions slot, outside every live region').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 2: every adapter shape the app has (plan 88.6.1-69). A hand-rolled adapter holds its
// error in useState (reference-stable between renders, as every production adapter does) and its
// refetch is the test's `impl`, swapped per step. The probe records retryFailed on EVERY render,
// so "never true before X" is checkable.

type Impl = (setError: (e: unknown) => void) => unknown;

function adapterQuery(error: unknown, refetch: () => unknown): UseQueryResult {
  return { isError: Boolean(error), error, refetch } as unknown as UseQueryResult;
}

function makeAdapter(initialError: unknown) {
  const ctl = {
    impl: (() => undefined) as Impl,
    calls: 0,
    setError: (_e: unknown) => {},
    state: null as FetchErrorState | null,
    probe: [] as Array<boolean | undefined>,
  };
  function AdapterHost({ withBanner = false }: { withBanner?: boolean }) {
    const [error, setError] = React.useState<unknown>(initialError);
    ctl.setError = setError;
    // Stable, as every adapter's comment requires (the hook keys retry and its refocus effect on it).
    const refetch = React.useCallback(() => {
      ctl.calls += 1;
      return ctl.impl(setError);
    }, []);
    const state = useFetchErrorState(adapterQuery(error, refetch));
    ctl.probe.push(state.retryFailed);
    ctl.state = state;
    return (
      <main>
        <h1>Page</h1>
        {withBanner && state.showError ? <FetchErrorBanner state={state} title={LIST_TITLE} /> : null}
      </main>
    );
  }
  function renderHost(withBanner = false) {
    return render(
      <FeedbackModalProvider>
        <AdapterHost withBanner={withBanner} />
      </FeedbackModalProvider>
    );
  }
  // The person's press, through the hook's wrapper (the banner's latch is not under test here).
  function press(): Promise<unknown> {
    let p!: Promise<unknown>;
    act(() => {
      p = ctl.state!.retry();
    });
    return p;
  }
  const last = () => ctl.probe[ctl.probe.length - 1];
  const mark = () => ctl.probe.length;
  return { ctl, renderHost, press, last, mark };
}

// One macrotask, so any commit a settled promise scheduled has landed before the next assertion.
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Dispatch a visibilitychange with the document visible (the hook's tab-return re-attempt). */
function fireVisible() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// A person retry that fails with a NEW error and says so: the flag is earned.
async function earnTheFlag(a: ReturnType<typeof makeAdapter>, label = 'earned') {
  a.ctl.impl = (setError) => {
    setError(boom(label));
    return { isError: true };
  };
  const p = a.press();
  await act(async () => {
    await p;
  });
  expect(a.last(), 'a failed person retry raises the flag').toBe(true);
}

describe('retryFailed — every adapter shape (plan 88.6.1-69)', () => {
  it('H4. an isError adapter that keeps its error: a failed run raises the flag, a clearing run lowers it', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    const d = deferred();
    a.ctl.impl = (setError) =>
      d.promise.then(() => {
        setError(boom('second'));
        return { isError: true };
      });
    let p = a.press();
    await act(async () => {
      d.resolve(undefined);
      await p;
    });
    expect(a.last()).toBe(true);

    const d2 = deferred();
    a.ctl.impl = (setError) =>
      d2.promise.then(() => {
        setError(null);
        return { isError: false };
      });
    p = a.press();
    await act(async () => {
      d2.resolve(undefined);
      await p;
    });
    expect(a.last()).toBe(false);
  });

  it('H5. an awaited loader resolving nothing that stores a new error before it resolves raises the flag', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    const d = deferred();
    a.ctl.impl = async (setError) => {
      await d.promise;
      setError(boom('second'));
    };
    const p = a.press();
    await act(async () => {
      d.resolve(undefined);
      await p;
    });
    expect(a.last()).toBe(true);
  });

  it('H6. a no-op retry (resolves nothing, same error object, still erroring) is not counted', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    const d = deferred();
    a.ctl.impl = async () => {
      await d.promise;
    };
    const from = a.mark();
    const p = a.press();
    await act(async () => {
      d.resolve(undefined);
      await p;
    });
    await flushFrame();
    const seen = a.ctl.probe.slice(from);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false), JSON.stringify(seen)).toBe(true);
  });

  it('H7. a resolve-before-fetch adapter that keeps its error never shows the flag while its run is out (Prohibition 2)', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost(true);
    const run = deferred();
    a.ctl.impl = (setError) => {
      run.promise.then(
        () => setError(null),
        (e) => setError(e)
      );
      return Promise.resolve();
    };
    const from = a.mark();
    const p = a.press();
    await act(async () => {
      await p;
    });
    await flushFrame();
    const held = a.ctl.probe.slice(from);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((v) => v === false), `while the run is out: ${JSON.stringify(held)}`).toBe(true);
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();

    await act(async () => {
      run.reject(boom('second'));
    });
    expect(a.last(), 'the new failure committed').toBe(true);
    expect(await screen.findByRole('button', { name: 'Report this' })).toBeInTheDocument();
  });

  it('H8. a resolve-before-fetch adapter whose run succeeds never raises the flag', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    const run = deferred();
    a.ctl.impl = (setError) => {
      run.promise.then(
        () => setError(null),
        (e) => setError(e)
      );
      return Promise.resolve();
    };
    const from = a.mark();
    const p = a.press();
    await act(async () => {
      await p;
    });
    await flushFrame();
    await act(async () => {
      run.resolve(undefined);
    });
    await flushFrame();
    const seen = a.ctl.probe.slice(from);
    expect(a.ctl.state!.showError).toBe(false);
    expect(seen.every((v) => v === false), JSON.stringify(seen)).toBe(true);
  });

  it('H9. an awaited run that clears its error at the start (the friends shape) neither lowers the flag in flight nor misses the new failure', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    await earnTheFlag(a);
    const d = deferred();
    a.ctl.impl = async (setError) => {
      setError(null);
      try {
        await d.promise;
      } catch (e) {
        setError(e);
      }
    };
    const from = a.mark();
    const p = a.press();
    await flushFrame();
    expect(a.ctl.state!.showError, 'isError is false while the run is out').toBe(false);
    const inFlight = a.ctl.probe.slice(from);
    expect(inFlight.every((v) => v === true), `in flight: ${JSON.stringify(inFlight)}`).toBe(true);
    await act(async () => {
      d.reject(boom('second'));
      await p;
    });
    expect(a.ctl.state!.showError).toBe(true);
    expect(a.last()).toBe(true);
  });

  it('H10. the tab-return re-attempt never counts: it never raises the flag, never ends the episode in flight, and a success lowers it', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    // A tab return while errored re-attempts once and fails with a new error.
    a.ctl.impl = async (setError) => {
      setError(boom('tab-1'));
    };
    const from = a.mark();
    await act(async () => {
      fireVisible();
    });
    await flushFrame();
    expect(a.ctl.calls).toBe(1);
    const auto = a.ctl.probe.slice(from);
    expect(auto.every((v) => v === false), `automatic: ${JSON.stringify(auto)}`).toBe(true);

    // The person's retry fails.
    await earnTheFlag(a, 'person');

    // A tab return on a never-loaded-shaped adapter: isError is false while it is in flight,
    // and it fails again. The flag the person earned stands at every render.
    const held = deferred();
    a.ctl.impl = async (setError) => {
      setError(null);
      try {
        await held.promise;
      } catch (e) {
        setError(e);
      }
    };
    const from2 = a.mark();
    await act(async () => {
      fireVisible();
    });
    await flushFrame();
    expect(a.ctl.state!.showError, 'in flight, nothing shows').toBe(false);
    await act(async () => {
      held.reject(boom('tab-2'));
    });
    await flushFrame();
    expect(a.ctl.state!.showError).toBe(true);
    const kept = a.ctl.probe.slice(from2);
    expect(kept.every((v) => v === true), `kept: ${JSON.stringify(kept)}`).toBe(true);

    // A tab return that succeeds ends the failure, and the flag with it.
    a.ctl.impl = async (setError) => {
      setError(null);
      return { isError: false };
    };
    await act(async () => {
      fireVisible();
    });
    await flushFrame();
    expect(a.ctl.state!.showError).toBe(false);
    expect(a.last()).toBe(false);
  });

  it('H11. a newer press supersedes an older one: only the newest decides', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    const d1 = deferred();
    const d2 = deferred();
    a.ctl.impl = (setError) =>
      d1.promise.then(() => {
        setError(boom('late failure of the first press'));
        return { isError: true };
      });
    const from = a.mark();
    const p1 = a.press();
    // The second press resolves a success; its clear commits later (the TanStack order).
    a.ctl.impl = () => d2.promise.then(() => ({ isError: false }));
    const p2 = a.press();
    await act(async () => {
      d2.resolve(undefined);
      await p2;
    });
    await act(async () => {
      d1.resolve(undefined);
      await p1;
    });
    await flushFrame();
    await act(async () => {
      a.ctl.setError(null);
    });
    await flushFrame();
    const seen = a.ctl.probe.slice(from);
    expect(seen.every((v) => v === false), JSON.stringify(seen)).toBe(true);
    expect(a.last()).toBe(false);
  });

  it('H12. a key change (TanStack-shaped pending, no retry in flight) lowers the flag; the new key failing does not raise it', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost(true);
    await earnTheFlag(a);
    expect(await screen.findByRole('button', { name: 'Report this' })).toBeInTheDocument();
    // The new key with no data: isError false, error null.
    await act(async () => {
      a.ctl.setError(null);
    });
    expect(a.last(), 'lowered at the pending commit').toBe(false);
    await act(async () => {
      a.ctl.setError(boom('the new key failed'));
    });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(a.last()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();
  });

  it('H13. the failure ends with no retry, then a fresh failure: the flag stays down and no Report this', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost(true);
    await earnTheFlag(a);
    await act(async () => {
      a.ctl.setError(null);
    });
    expect(a.last()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await act(async () => {
      a.ctl.setError(boom('a fresh failure'));
    });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(a.last()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();
  });

  it('H14. a rejecting refetch makes retry() reject with the same error; the flag waits for a new committed error', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    const rejection = boom('rejected');
    a.ctl.impl = () => Promise.reject(rejection);
    const p = a.press();
    await act(async () => {
      await expect(p).rejects.toBe(rejection);
    });
    await flushFrame();
    expect(a.last(), 'no new committed error yet').toBe(false);
    await act(async () => {
      a.ctl.setError(boom('the failure commits'));
    });
    expect(a.last()).toBe(true);
  });

  it('H15. an error built fresh on every render cannot crash the host or claim a failure while a retry is held (review #77)', async () => {
    const d = deferred();
    const refetch = vi.fn(() => d.promise);
    const seen: Array<boolean | undefined> = [];
    const { result, rerender } = renderHook(() => {
      const s = useFetchErrorState(adapterQuery(new ApiError('boom', 'network', 0), refetch));
      seen.push(s.retryFailed);
      return s;
    });
    rerender();
    rerender();
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.retry();
    });
    rerender();
    rerender();
    await flushFrame();
    expect(seen.length).toBeGreaterThan(4);
    expect(seen.every((v) => v === false), `while held: ${JSON.stringify(seen)}`).toBe(true);
    await act(async () => {
      d.resolve(undefined);
      await p;
    });
  });

  it('H16. an untracked re-failure on the SAME query (error kept through the refetch) keeps the flag and the link (review #78)', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost(true);
    await earnTheFlag(a);
    const from = a.mark();
    // A reconnect refetch, then an invalidation, each failing again: new error objects, no press.
    await act(async () => {
      a.ctl.setError(boom('reconnect re-fail'));
    });
    await act(async () => {
      a.ctl.setError(boom('invalidation re-fail'));
    });
    const seen = a.ctl.probe.slice(from);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === true), JSON.stringify(seen)).toBe(true);
    expect(screen.getByRole('button', { name: 'Report this' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 4: the ruling is about the FULL banner. The compact notice and plan 70's RF1 notice carry
// no report link, before or after a failed retry.

describe('the small notices carry no report link (plan 88.6.1-69)', () => {
  it('R5. the compact notice after a failed retry renders no Report this (a stub state, then a real hook-driven failed retry)', async () => {
    const { unmount } = render(
      <FeedbackModalProvider>
        <FetchErrorBanner compact state={failedState({ retryFailed: true })} />
      </FeedbackModalProvider>
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();
    unmount();

    // The real hook: a person retry fails, so retryFailed is true, and the compact row still has
    // no report link.
    const a = makeAdapter(boom('first'));
    function CompactHost() {
      const [error, setError] = React.useState<unknown>(boom('first'));
      a.ctl.setError = setError;
      const refetch = React.useCallback(() => {
        setError(boom('second'));
        return { isError: true };
      }, []);
      const state = useFetchErrorState(adapterQuery(error, refetch));
      a.ctl.state = state;
      a.ctl.probe.push(state.retryFailed);
      return state.showError ? <FetchErrorBanner compact state={state} /> : null;
    }
    const user = userEvent.setup();
    render(
      <FeedbackModalProvider>
        <CompactHost />
      </FeedbackModalProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Some personal controls are still unavailable.', { selector: 'span' });
    expect(a.last(), 'the hook recorded the failed retry').toBe(true);
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();
  });

  it('R6. RefreshFailedNotice showing RF1 with retryFailed true renders no Report this', () => {
    render(
      <FeedbackModalProvider>
        <RefreshFailedNotice state={failedState({ code: 'network', retryFailed: true })} retained />
      </FeedbackModalProvider>
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 88.6.1 code review A-77 / A-78 (IN-16): a tab return must not cancel the person's held retry at
// a query that holds data, and a settled verdict the committed state never confirms expires.

function RetainedHost({
  queryFn,
  probe,
  stateRef,
  queryRef,
}: {
  queryFn: () => Promise<string[]>;
  probe: Array<boolean | undefined>;
  stateRef: { current: FetchErrorState | null };
  queryRef: { current: UseQueryResult<string[]> | null };
}) {
  const query = useQuery({ queryKey: ['retryFailed', 'retained'], queryFn });
  queryRef.current = query;
  const state = useFetchErrorState(query);
  probe.push(state.retryFailed);
  stateRef.current = state;
  return <main>{query.data ? <p>{query.data.join(',')}</p> : null}</main>;
}

describe('retryFailed — tab return and settled-verdict expiry (88.6.1 code review A-77, A-78)', () => {
  it('H17. a tab return during the person\'s held retry at a query holding data joins it: the retry succeeds and the flag never rises', async () => {
    const { runs, queryFn } = drivenQueryFn();
    const probe: Array<boolean | undefined> = [];
    const stateRef: { current: FetchErrorState | null } = { current: null };
    const queryRef: { current: UseQueryResult<string[]> | null } = { current: null };
    render(
      <QueryClientProvider client={testClient()}>
        <RetainedHost queryFn={queryFn} probe={probe} stateRef={stateRef} queryRef={queryRef} />
      </QueryClientProvider>
    );
    await act(async () => {
      runs[0].resolve(['a']);
    });
    await screen.findByText('a');
    // A background refetch fails over the held data: isError true, data kept.
    await act(async () => {
      void queryRef.current!.refetch();
    });
    await act(async () => {
      runs[1].reject(boom('refresh'));
    });
    await flushFrame();
    expect(stateRef.current!.showError).toBe(true);
    expect(screen.getByText('a')).toBeInTheDocument();

    // The person retries; the request is held.
    const from = probe.length;
    let retried!: Promise<unknown>;
    act(() => {
      retried = stateRef.current!.retry();
    });
    expect(runs).toHaveLength(3);
    // They leave and come back while it is in flight.
    await act(async () => {
      fireVisible();
    });
    await flushFrame();
    expect(queryFn, 'the tab return joined the held fetch instead of starting another').toHaveBeenCalledTimes(3);
    // The held request succeeds.
    await act(async () => {
      runs[2].resolve(['b']);
      await retried;
    });
    await flushFrame();
    expect(stateRef.current!.showError).toBe(false);
    const seen = probe.slice(from);
    expect(seen.every((v) => v === false), `every render after the press: ${JSON.stringify(seen)}`).toBe(true);
  });

  it('H18. an awaitFailed the committed state contradicts expires: a later, unrelated failure does not raise the flag', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    // The result says failed while the committed state clears (the disagreement).
    a.ctl.impl = (setError) => {
      setError(null);
      return { isError: true };
    };
    const p = a.press();
    await act(async () => {
      await p;
    });
    await flushFrame();
    expect(a.ctl.state!.showError).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, RETRY_OUTCOME_WINDOW_MS + 100));
    });
    // A fresh failure arrives with no press.
    const from = a.mark();
    await act(async () => {
      a.ctl.setError(boom('unrelated'));
    });
    await flushFrame();
    expect(a.ctl.state!.showError).toBe(true);
    const seen = a.ctl.probe.slice(from);
    expect(seen.every((v) => v === false), `after the unrelated failure: ${JSON.stringify(seen)}`).toBe(true);
  });

  it('H19. an awaitSucceeded the committed state contradicts expires: a later tab return is tracked and keeps the earned flag', async () => {
    const a = makeAdapter(boom('first'));
    a.renderHost();
    await earnTheFlag(a, 'person');
    // The result says succeeded while the error stays (the disagreement).
    a.ctl.impl = () => ({ isError: false });
    const p = a.press();
    await act(async () => {
      await p;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, RETRY_OUTCOME_WINDOW_MS + 100));
    });
    expect(a.last(), 'the earned flag stands while the failure persists').toBe(true);
    // A never-loaded-shaped tab return: isError false while in flight, then it fails again.
    const held = deferred();
    a.ctl.impl = async (setError) => {
      setError(null);
      try {
        await held.promise;
      } catch (e) {
        setError(e);
      }
    };
    const from = a.mark();
    await act(async () => {
      fireVisible();
    });
    await flushFrame();
    await act(async () => {
      held.reject(boom('tab'));
    });
    await flushFrame();
    expect(a.ctl.state!.showError).toBe(true);
    const kept = a.ctl.probe.slice(from);
    expect(kept.every((v) => v === true), `kept: ${JSON.stringify(kept)}`).toBe(true);
  });
});
