// Phase 88.6.1 plan 09 (D-16): the contract of the ONE phone-viewport hook, plus the census that
// keeps it the only one.
//
// WHAT THIS SUITE PINS:
//   VP-1  the first render (server and client) is the desktop arm even when the query MATCHES —
//         DECISION Phase 88.1-11's SSR parity, which is why the read cannot move into a lazy
//         state initialiser;
//   VP-2  the mount-time read of the current match;
//   VP-3  the change subscription, in both directions;
//   VP-4  cleanup removes the SAME handler it added (no listener accumulates per open/close);
//   VP-5  the legacy listener pair, used when the list has no modern listener API;
//   VP-6  no media API at all: false, and mounting does not throw;
//   VP-7  the exact query string;
//   VP-C1 every code-level media-query call under src is on an owned roster (a fourth copy of
//         the subscription fails here and names the hook to call instead);
//   VP-C2 the phone breakpoint literal appears in code only where the roster says.
//
// THE MEDIA LIST IS FAKED. jsdom implements no media queries (its global stub in vitest.setup.ts
// answers false for everything), and P7 forbids reading layout in a unit test, so no element
// box, viewport size or timer is consulted anywhere in this file — the arm is chosen by the
// fake list's `matches`, exactly as consumers' tests choose it with a stub installed before
// render. Those APIs are described here in words only: the acceptance grep for this plan counts
// their names, comments included (the usePaintGesture.test.ts convention).

import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PHONE_MEDIA_QUERY, usePhoneViewport } from './usePhoneViewport';
import { sourceFiles, withoutComments } from '@/test-utils/sourceScan';
import { assertExactCounts, assertRosterShape, type ExemptionRoster } from '@/test-utils/exemption';

type ChangeHandler = (event: MediaQueryListEvent) => void;

interface FakeMediaList {
  list: MediaQueryList;
  addEventListener: Mock;
  removeEventListener: Mock;
  addListener: Mock;
  removeListener: Mock;
  // Deliver a change to whichever handler the hook registered (modern or legacy).
  fire: (matches: boolean) => void;
}

// A controllable fake list. legacy: true builds one WITHOUT the modern listener API, the shape
// Safari before 14 hands back, so the hook must take its addListener / removeListener path.
function makeFakeList(matches: boolean, { legacy = false }: { legacy?: boolean } = {}): FakeMediaList {
  let handler: ChangeHandler | null = null;
  const addEventListener = vi.fn((_type: string, fn: ChangeHandler) => {
    handler = fn;
  });
  const removeEventListener = vi.fn();
  const addListener = vi.fn((fn: ChangeHandler) => {
    handler = fn;
  });
  const removeListener = vi.fn();
  const shape: Record<string, unknown> = {
    matches,
    media: PHONE_MEDIA_QUERY,
    onchange: null,
    dispatchEvent: () => false,
    addListener,
    removeListener,
  };
  if (!legacy) {
    shape.addEventListener = addEventListener;
    shape.removeEventListener = removeEventListener;
  }
  return {
    list: shape as unknown as MediaQueryList,
    addEventListener,
    removeEventListener,
    addListener,
    removeListener,
    fire: (next: boolean) => {
      handler?.({ matches: next } as MediaQueryListEvent);
    },
  };
}

// Install the fake as the window's media API; vi.restoreAllMocks puts the original back.
function installFake(fake: FakeMediaList) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(() => fake.list);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePhoneViewport — the hook contract (88.6.1-09, D-16)', () => {
  it('VP-1. the server render is the desktop arm even while the phone query matches (SSR parity)', () => {
    installFake(makeFakeList(true));
    // Effects do not run in renderToString, so this is exactly the first render — the one the
    // client must hydrate against. A lazy initialiser that read the query would say 'phone'.
    function Probe() {
      return createElement('span', null, usePhoneViewport() ? 'phone' : 'desktop');
    }
    expect(renderToString(createElement(Probe))).toBe('<span>desktop</span>');
  });

  it('VP-2. the mount effect reads the current match, true and false', () => {
    installFake(makeFakeList(true));
    const phone = renderHook(() => usePhoneViewport());
    expect(phone.result.current).toBe(true);
    phone.unmount();

    vi.restoreAllMocks();
    installFake(makeFakeList(false));
    const desktop = renderHook(() => usePhoneViewport());
    expect(desktop.result.current).toBe(false);
  });

  it('VP-3. a change event flips the value both ways', () => {
    const fake = makeFakeList(false);
    installFake(fake);
    const { result } = renderHook(() => usePhoneViewport());
    expect(result.current).toBe(false);

    act(() => fake.fire(true));
    expect(result.current).toBe(true);

    act(() => fake.fire(false));
    expect(result.current).toBe(false);
  });

  it('VP-4. unmount removes the SAME change handler it added, once', () => {
    const fake = makeFakeList(false);
    installFake(fake);
    const { unmount } = renderHook(() => usePhoneViewport());
    expect(fake.addEventListener).toHaveBeenCalledTimes(1);
    const [addedType, added] = fake.addEventListener.mock.calls[0];
    expect(addedType).toBe('change');
    expect(fake.removeEventListener).not.toHaveBeenCalled();

    unmount();

    expect(fake.removeEventListener).toHaveBeenCalledTimes(1);
    const [removedType, removed] = fake.removeEventListener.mock.calls[0];
    expect(removedType).toBe('change');
    expect(removed).toBe(added);
  });

  it('VP-5. a list without the modern listener API gets the legacy pair, same handler both ends', () => {
    const fake = makeFakeList(false, { legacy: true });
    installFake(fake);
    const { result, unmount } = renderHook(() => usePhoneViewport());
    expect(fake.addListener).toHaveBeenCalledTimes(1);
    const [added] = fake.addListener.mock.calls[0];

    act(() => fake.fire(true));
    expect(result.current).toBe(true);

    unmount();
    expect(fake.removeListener).toHaveBeenCalledTimes(1);
    expect(fake.removeListener.mock.calls[0][0]).toBe(added);
  });

  it('VP-6. with no media API on the window the hook returns false and mounting does not throw', () => {
    const original = window.matchMedia;
    try {
      (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
      let current: boolean | undefined;
      expect(() => {
        const { result } = renderHook(() => usePhoneViewport());
        current = result.current;
      }).not.toThrow();
      expect(current).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('VP-7. it asks for exactly PHONE_MEDIA_QUERY, which is the md-and-below line', () => {
    const spy = installFake(makeFakeList(false));
    renderHook(() => usePhoneViewport());
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(call).toEqual([PHONE_MEDIA_QUERY]);
    }
    expect(PHONE_MEDIA_QUERY).toBe('(max-width: 767px)');
  });
});

// ---------------------------------------------------------------------------------------------
// Census: one phone-viewport mechanism. Counts are EXACT in both directions (exemption.ts), so
// a new media-query site fails AND a removed one fails until its roster entry shrinks.
// ---------------------------------------------------------------------------------------------

const SRC = path.resolve(__dirname, '../..');

const MARKER = 'DECISION Phase 88.6.1-09 (D-16)';

// Per-file count of a pattern over the comment-blanked source, keyed app/... relative to src.
function measure(pattern: RegExp): { counts: Record<string, number>; scanned: number } {
  const files = sourceFiles(SRC);
  const counts: Record<string, number> = {};
  for (const file of files) {
    const code = withoutComments(fs.readFileSync(file, 'utf8'));
    const n = (code.match(pattern) ?? []).length;
    if (n > 0) counts[path.relative(SRC, file).split(path.sep).join('/')] = n;
  }
  return { counts, scanned: files.length };
}

const MATCH_MEDIA_SITES: ExemptionRoster = {
  'lib/hooks/usePhoneViewport.ts': {
    sites: 1,
    why: 'the ONE viewport subscription every phone/desktop render fork reads; a second one is a copy',
    owner: { kind: 'decision', marker: MARKER },
  },
  'app/components/createEvent.js': {
    sites: 1,
    why: 'subscribes to (hover: none), input modality that gates swipe, a different media feature from the viewport width this hook owns',
    owner: { kind: 'decision', marker: MARKER },
  },
  'app/gameDetail/page.js': {
    sites: 2,
    why: 'one-shot reads inside the game title\'s two expand click handlers; a subscription would re-render the page for a value read only on click',
    owner: { kind: 'decision', marker: MARKER },
  },
};

const PHONE_QUERY_LITERAL_SITES: ExemptionRoster = {
  'lib/hooks/usePhoneViewport.ts': {
    sites: 1,
    why: 'the exported PHONE_MEDIA_QUERY constant, the one place the breakpoint is written for a subscription',
    owner: { kind: 'decision', marker: MARKER },
  },
  'app/gameDetail/page.js': {
    sites: 2,
    why: 'the two click-time reads of the game title expand write the breakpoint inline; they are not subscriptions',
    owner: { kind: 'decision', marker: MARKER },
  },
};

describe('one phone-viewport mechanism (88.6.1-09, D-16)', () => {
  it('VP-C1. every code-level media-query call under src is on the owned roster, exactly', () => {
    const { counts, scanned } = measure(/matchMedia\s*\(/g);
    // Anti-vacuity: a wrong SRC root would scan nothing and every count would read zero.
    expect(scanned).toBeGreaterThan(100);
    expect(assertRosterShape(MATCH_MEDIA_SITES)).toEqual([]);
    expect(
      assertExactCounts(MATCH_MEDIA_SITES, counts),
      'A new media-query site: if it branches on the phone viewport, call usePhoneViewport() from ' +
        '@/lib/hooks/usePhoneViewport instead of adding a subscription. Otherwise add an owned, ' +
        'counted entry with its reason.',
    ).toEqual([]);
  });

  it('VP-C2. the phone breakpoint literal appears in code only on the owned roster, exactly', () => {
    const { counts, scanned } = measure(/max-width:\s*767px/g);
    expect(scanned).toBeGreaterThan(100);
    expect(assertRosterShape(PHONE_QUERY_LITERAL_SITES)).toEqual([]);
    expect(
      assertExactCounts(PHONE_QUERY_LITERAL_SITES, counts),
      'The phone breakpoint written inline: import PHONE_MEDIA_QUERY (or call usePhoneViewport()) ' +
        'from @/lib/hooks/usePhoneViewport rather than re-typing it.',
    ).toEqual([]);
  });
});
