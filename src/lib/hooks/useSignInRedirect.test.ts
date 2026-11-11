// Phase 88.9-40 (SESSION-01, owner ruling 2026-11-07; SPEC A8): the seven behaviour pins of the ONE
// sign-in guard every protected page uses. The hook decides once per mount, by a ref, whether a
// signed-out or token-rejected visitor goes to sign-in (a latched window.location.replace to the
// house URL, src/lib/signIn.ts ("export function buildSignInUrl")) or, back with the latch set,
// gets the page's banner. The latch is one sessionStorage key per path + search, read and written
// fail-closed, cleared only by an answer that proves the session.
//
// WHAT THIS SUITE PINS:
//   1  signed-out → one replace with returnTo = path + search + hash; a 401 on return with the latch
//      set is 'declined' (one logger.warn, path only); a signed-out return is the banner state; a
//      hostile returnTo in the SEARCH never becomes the return address (T-88.9-135).
//   2  no decision while useUser is still loading; one replace once it settles.
//   3  two triggers in one commit replace once — the REF is the guard, not the state.
//   4  the latch fails closed: a throwing storage read or write declines, never redirects.
//   5  a proven session clears this path's latch, so a later dead session redirects once more.
//   6  a useUser error is not signed out: no replace, no hold, sessionError true.
//   7  resetDecision returns to idle without touching the latch, so a reset never rebuilds the loop.
//   8  the hold survives a sync re-render between the latch write and the 'redirecting' commit (the
//      CI race of 2026-11-10: groupHomePage painted the banner for a frame; fix(88.9-40)).
//
// The real @/lib/signIn is imported (never mocked): pin 1's fourth mount is the regression pin on
// the builder itself. The logger is mocked in the src/app/Header.test.tsx shape so pins 1 and 4 can
// read warn calls.

import { createElement, useSyncExternalStore } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { signInLatchKey, useSignInRedirect } from './useSignInRedirect';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

// The gameDetail suite's stub (src/app/gameDetail/page.test.tsx ("function stubLocation(")), with the
// pathname a parameter: the hook reads pathname + search + hash and calls replace.
function stubLocation({ pathname, search = '', hash = '' }: { pathname: string; search?: string; hash?: string }) {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      origin: 'http://localhost',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      pathname,
      search,
      hash,
      href: `http://localhost${pathname}${search}${hash}`,
      replace,
      assign: vi.fn(),
    },
  });
  return replace;
}

type Options = Parameters<typeof useSignInRedirect>[0];

function mount(initial: Options) {
  return renderHook((options: Options) => useSignInRedirect(options), { initialProps: initial });
}

const WARN_MESSAGE = '[signIn] a 401 came back after a sign-in round trip';

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
});

describe('useSignInRedirect (88.9-40, SESSION-01)', () => {
  it('SESSION-01 (88.9): signed-out → /api/auth/login?returnTo=<path> once; a 401 on return shows the banner, never a 2nd redirect', () => {
    // First visit: signed out, latch clear → one replace, latch written before navigating.
    const replace = stubLocation({ pathname: '/groupHomePage', search: '?id=7', hash: '#members' });
    const first = mount({ authLoading: false, signedOut: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/api/auth/login?returnTo=%2FgroupHomePage%3Fid%3D7%23members');
    expect(first.result.current.decision).toBe('redirecting');
    expect(first.result.current.holding).toBe(true);
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
    expect(logger.warn).not.toHaveBeenCalled();
    first.unmount();

    // Back with the latch set and a live cookie whose token the backend rejects: declined, one warn.
    const second = mount({ authLoading: false, signedOut: false, unauthorized: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(second.result.current.decision).toBe('declined');
    expect(second.result.current.holding).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(WARN_MESSAGE, { path: '/groupHomePage' });
    second.unmount();

    // Back with the latch set and no session at all: the page's banner state, no second warn.
    const third = mount({ authLoading: false, signedOut: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(third.result.current.decision).toBe('declined');
    expect(third.result.current.signedOutErrorState.showError).toBe(true);
    expect(third.result.current.signedOutErrorState.code).toBe('unauthorized');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    third.unmount();

    // T-88.9-135: a returnTo in the SEARCH rides inside the encoded page path and is never read.
    window.sessionStorage.clear();
    const hostileSearch = '?id=7&returnTo=https%3A%2F%2Fevil.example';
    const replace4 = stubLocation({ pathname: '/groupHomePage', search: hostileSearch });
    mount({ authLoading: false, signedOut: true });
    expect(replace4).toHaveBeenCalledTimes(1);
    const target = replace4.mock.calls[0][0] as string;
    expect(target).toBe('/api/auth/login?returnTo=' + encodeURIComponent('/groupHomePage' + hostileSearch));
    const params = new URL(target, 'https://www.nextgamenight.app').searchParams.getAll('returnTo');
    expect(params).toEqual(['/groupHomePage?id=7&returnTo=https%3A%2F%2Fevil.example']);
    expect(params).toHaveLength(1);
  });

  it('SESSION-01 (88.9): no decision while useUser is still loading; one replace once it settles', () => {
    const replace = stubLocation({ pathname: '/friends' });
    const { result, rerender } = mount({ authLoading: true, signedOut: true });
    expect(replace).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
    expect(result.current.decision).toBe('idle');
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBeNull();

    rerender({ authLoading: false, signedOut: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Ffriends');
    expect(result.current.decision).toBe('redirecting');
  });

  it('SESSION-01 (88.9): two triggers in one commit replace once and stay redirecting', () => {
    const replace = stubLocation({ pathname: '/groupPlanning', search: '?groupId=3' });
    const { result, rerender } = mount({ authLoading: true, signedOut: true });
    // The signed-out arm's effect and a page's own direct call land in the same flush: the ref,
    // not the committed state, must be the guard, or the second caller would find the latch
    // already written and overwrite 'redirecting' with 'declined'.
    act(() => {
      rerender({ authLoading: false, signedOut: true });
      result.current.requestSignIn();
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.current.decision).toBe('redirecting');
    expect(result.current.holding).toBe(true);
    act(() => {
      result.current.requestSignIn();
      result.current.requestSignIn('signedOut');
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.current.decision).toBe('redirecting');
  });

  it('SESSION-01 (88.9): the latch fails closed — a throwing storage read or write declines, never redirects', () => {
    const replace = stubLocation({ pathname: '/userProfile' });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const unreadable = mount({ authLoading: false, signedOut: true });
    expect(replace).not.toHaveBeenCalled();
    expect(unreadable.result.current.decision).toBe('declined');
    expect(unreadable.result.current.holding).toBe(false);
    expect(unreadable.result.current.signedOutErrorState.showError).toBe(true);
    unreadable.unmount();
    getItem.mockRestore();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const unwritable = mount({ authLoading: false, unauthorized: true });
    expect(replace).not.toHaveBeenCalled();
    expect(unwritable.result.current.decision).toBe('declined');
    expect(unwritable.result.current.holding).toBe(false);
    // A storage failure is not a round trip: nothing is filed.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('SESSION-01 (88.9): a proven session clears this path’s latch, so a later dead session redirects once more', () => {
    const replace = stubLocation({ pathname: '/groupHomePage', search: '?id=9' });
    const key = signInLatchKey(window.location);
    window.sessionStorage.setItem(key, '1');
    const { result, rerender } = mount({ authLoading: false, sessionProven: true });
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(result.current.decision).toBe('idle');
    expect(replace).not.toHaveBeenCalled();

    // The session dies mid-visit: the next 401 redirects once more.
    rerender({ authLoading: false, sessionProven: false, unauthorized: true });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/api/auth/login?returnTo=%2FgroupHomePage%3Fid%3D9');
    expect(result.current.decision).toBe('redirecting');
    expect(window.sessionStorage.getItem(key)).toBe('1');
  });

  it('SESSION-01 (88.9): a useUser error is not signed out — no replace, no hold, sessionError true', () => {
    const replace = stubLocation({ pathname: '/friends' });
    for (const status of [0, 500]) {
      const authError = Object.assign(new Error('me failed'), { status });
      const { result, unmount } = mount({ authLoading: false, signedOut: true, authError });
      expect(replace).not.toHaveBeenCalled();
      expect(result.current.decision).toBe('idle');
      expect(result.current.holding).toBe(false);
      expect(result.current.sessionError).toBe(true);
      expect(result.current.signedOutErrorState.showError).toBe(false);
      expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBeNull();
      unmount();
    }
    // Still loading: not yet an error either.
    const loading = mount({
      authLoading: true,
      signedOut: true,
      authError: Object.assign(new Error('me failed'), { status: 500 }),
    });
    expect(loading.result.current.sessionError).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('SESSION-01 (88.9): resetDecision returns to idle without touching the latch, so a reset never rebuilds the loop', () => {
    const replace = stubLocation({ pathname: '/gameDetail', search: '?event_id=e1' });
    const key = signInLatchKey(window.location);
    window.sessionStorage.setItem(key, '1');
    const { result, rerender } = mount({ authLoading: false, unauthorized: true });
    expect(result.current.decision).toBe('declined');
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      result.current.resetDecision();
    });
    expect(result.current.decision).toBe('idle');
    expect(window.sessionStorage.getItem(key)).toBe('1');
    expect(replace).not.toHaveBeenCalled();

    rerender({ authLoading: false, unauthorized: false });
    rerender({ authLoading: false, unauthorized: true });
    expect(result.current.decision).toBe('declined');
    expect(replace).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(key)).toBe('1');
  });
});

// 8 — the race CI reproduced on 51cfae4 (quality red on runs 42792174654 / 42792183100): requestSignIn
// writes the latch and the ref synchronously, then queues setDecision('redirecting') at the default
// lane. A SyncLane re-render in that window (the group page sits on a useSyncExternalStore store that
// TanStack notifies on a zero-delay macrotask) rendered with decision still 'idle' and the latch SET,
// so a hold computed from the latch alone dropped, and the page-load banner painted for a frame —
// exactly the flash the hold exists to prevent. The harness forces that SyncLane render outside act:
// the store drives `unauthorized` (tick 1 arms the hook, its effect runs synchronously after the
// sync commit), then tick 2 re-renders at SyncLane before the default-lane update has flushed.
describe('useSignInRedirect — the hold survives a sync re-render before the redirecting commit (fix 88.9-40)', () => {
  it('SESSION-01 (88.9): a sync re-render between the latch write and the redirecting commit still holds', async () => {
    const replace = stubLocation({ pathname: '/groupHomePage', search: '?id=7' });
    let tick = 0;
    const listeners = new Set<() => void>();
    const store = {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getSnapshot: () => tick,
      set: (n: number) => {
        tick = n;
        listeners.forEach((l) => l());
      },
    };
    const frames: Array<{ tick: number; decision: string; holding: boolean }> = [];
    function Harness() {
      const t = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const r = useSignInRedirect({ authLoading: false, unauthorized: t >= 1 });
      frames.push({ tick: t, decision: r.decision, holding: r.holding });
      return null;
    }
    render(createElement(Harness));
    expect(frames.at(-1)).toEqual({ tick: 0, decision: 'idle', holding: false });

    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const savedActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      // tick 1: arm. The SyncLane render holds (latch clear); its passive effect runs at the end of
      // the sync commit, writes the latch, calls replace and QUEUES 'redirecting' at the default lane.
      store.set(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
      const armedFrame = frames.find((f) => f.tick === 1);
      expect(armedFrame).toEqual({ tick: 1, decision: 'idle', holding: true });

      // tick 2: a SyncLane re-render inside the window — the default-lane update is not yet
      // committed, so decision still reads 'idle' and the latch is already set.
      store.set(2);
      await Promise.resolve();
      await Promise.resolve();
      const raceFrame = frames.find((f) => f.tick === 2);
      expect(raceFrame, 'the sync re-render happened').toBeDefined();
      expect(raceFrame!.holding, 'the hold must survive the frame before the redirecting commit').toBe(true);

      // the default lane flushes on a macrotask: the committed state catches up.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(frames.at(-1)!.decision).toBe('redirecting');
      expect(frames.at(-1)!.holding).toBe(true);
      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = savedActEnv;
    }
  });
});
