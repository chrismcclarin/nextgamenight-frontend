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
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/userProfile',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { useFetchErrorState } from './useFetchErrorState';
import type { FetchErrorState } from './useFetchErrorState';
import { FetchErrorBanner } from './FetchErrorBanner';
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
