// FSM pins for usePaintGesture (88.1-03, D-01a / Req 5).
//
// These cover the transitions of the extracted 87.8-14 machine that do NOT need layout:
// tap, slop-cancel, hold-then-drag, pointercancel, unmount cleanup, and the mouse range commit.
//
// TWO CONSTRAINTS, BOTH LOAD-BEARING — do not "improve" either away:
//
// - P7 (jsdom has no layout): no assertion here may read a measured rect, a scroll size, an
//   element width or the viewport size — they are all 0 in jsdom, so such a test passes on
//   zeroes. (The APIs are deliberately not named in this file so 88.1-03's grep gate can prove
//   they are absent.) The bounds the edge loop uses are INJECTED below for exactly that reason.
//   Real geometry and the real touch stream are Playwright's job (plan 88.1-14).
// - P5 (do not pin the threshold): every timing assertion is expressed RELATIVE to the hook's
//   own exported `LONG_PRESS_MS` (before it / after it), never against a literal number. The
//   owner ruling that fixed the threshold could be revised; these pins must survive that, and
//   must never be the reason someone "fixes" the value back to the pre-88.1 one.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LONG_PRESS_MS,
  SLOP_PX,
  usePaintGesture,
  type GesturePointerEvent,
  type PaintGestureArgs,
} from './usePaintGesture';

/** A fixed, INJECTED bounds rect — never read from the DOM (P7). */
const BOUNDS = { top: 0, left: 0, bottom: 1000, right: 1000 };
/** Coordinates comfortably inside the bounds, clear of the edge band, so no rAF loop starts. */
const MID = { x: 400, y: 400 };

/** Stub resolver: the point IS the target identity. No DOM, no geometry. */
const resolvePoint = (x: number, y: number) => `t-${x}-${y}`;

function evt(
  x: number,
  y: number,
  pointerType: 'touch' | 'mouse' = 'touch',
  pointerId = 1,
  // WR-01: OPTIONAL and OMITTED by default, deliberately. Every fixture in describes 1-6 calls
  // `evt()` without it, so leaving it undefined is what proves the hook's absent-means-primary
  // reading. Extended here rather than adding a second builder — two builders drift apart.
  button?: number
): GesturePointerEvent {
  const e: GesturePointerEvent = { pointerId, pointerType, clientX: x, clientY: y };
  if (button !== undefined) e.button = button;
  return e;
}

function renderGesture(overrides: Partial<PaintGestureArgs<string>> = {}) {
  const onEnter = vi.fn();
  const onExtend = vi.fn();
  const onCommit = vi.fn();
  const scrollVerticalBy = vi.fn();
  const args: PaintGestureArgs<string> = {
    mode: 'range',
    resolvePoint,
    onEnter,
    onExtend,
    onCommit,
    edgeScroll: { scrollVerticalBy, getBounds: () => BOUNDS },
    ...overrides,
  };
  const view = renderHook((a: PaintGestureArgs<string>) => usePaintGesture(a), {
    initialProps: args,
  });
  return { ...view, onEnter, onExtend, onCommit, scrollVerticalBy };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('usePaintGesture — 1. tap (finger up BEFORE the threshold)', () => {
  it('commits exactly once, carrying the pressed target, in range mode', () => {
    const { result, onCommit } = renderGesture();
    const target = resolvePoint(MID.x, MID.y);

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1); // still BEFORE the threshold
    result.current.handlers.onPointerUp(evt(MID.x, MID.y));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(target, target);
  });

  it('commits the one pressed target through onEnter in paint mode', () => {
    const { result, onEnter, onExtend } = renderGesture({ mode: 'paint' });
    const target = resolvePoint(MID.x, MID.y);

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    result.current.handlers.onPointerUp(evt(MID.x, MID.y));

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith(target);
    expect(onExtend).not.toHaveBeenCalled(); // range callback never fires in paint mode
  });
});

describe('usePaintGesture — 2. slop before the threshold (plain drag scrolls natively)', () => {
  it('commits nothing and clears the pending timer', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, onEnter, onExtend, onCommit } = renderGesture();

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    // Move further than the slop radius while the gesture is still PENDING.
    result.current.handlers.onPointerMove(evt(MID.x + SLOP_PX * 3, MID.y));

    expect(clearSpy).toHaveBeenCalled();

    // Advancing past the threshold must not resurrect the gesture, and the finger lifting
    // afterwards must not commit either — the browser owned the pan the whole time.
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    result.current.handlers.onPointerUp(evt(MID.x + SLOP_PX * 3, MID.y));

    expect(onEnter).not.toHaveBeenCalled();
    expect(onExtend).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('usePaintGesture — 3. hold past the threshold, then drag', () => {
  it('enters on the hold, extends on each new target, and commits once on release', () => {
    const { result, onExtend, onCommit } = renderGesture();
    const anchor = resolvePoint(MID.x, MID.y);
    const next = resolvePoint(MID.x, MID.y + 100);

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    expect(onExtend).not.toHaveBeenCalled(); // nothing happens before the hold completes

    vi.advanceTimersByTime(LONG_PRESS_MS); // threshold reached — ENGAGE
    expect(onExtend).toHaveBeenCalledTimes(1);
    expect(onExtend).toHaveBeenLastCalledWith(anchor, anchor);

    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 100));
    expect(onExtend).toHaveBeenCalledTimes(2);
    expect(onExtend).toHaveBeenLastCalledWith(anchor, next);

    // The same target again must NOT re-report (the rAF loop re-resolves every frame).
    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 100));
    expect(onExtend).toHaveBeenCalledTimes(2);

    result.current.handlers.onPointerUp(evt(MID.x, MID.y + 100));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(anchor, next);
  });

  it('reports each newly-entered target in paint mode instead of a pair', () => {
    const { result, onEnter } = renderGesture({ mode: 'paint' });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 100));

    expect(onEnter.mock.calls).toEqual([
      [resolvePoint(MID.x, MID.y)],
      [resolvePoint(MID.x, MID.y + 100)],
    ]);
  });
});

describe('usePaintGesture — 4. pointercancel commits nothing', () => {
  it('in the PENDING state (before the threshold)', () => {
    const { result, onExtend, onCommit } = renderGesture();

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    result.current.handlers.onPointerCancel(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onExtend).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('in the ACTIVE state (after the threshold, mid-drag)', () => {
    const { result, onExtend, onCommit } = renderGesture();

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 100));
    result.current.handlers.onPointerCancel(evt(MID.x, MID.y + 100));

    expect(onExtend).toHaveBeenCalled(); // the live highlight did happen
    expect(onCommit).not.toHaveBeenCalled(); // the browser took the gesture — no commit
  });
});

describe('usePaintGesture — 5. unmount leaves no timer or rAF handle behind (T-88.1-06)', () => {
  it('clears a pending long-press timer', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderGesture();

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    clearSpy.mockClear();
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('cancels a live edge-scroll rAF loop', () => {
    const RAF_HANDLE = 4242;
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => RAF_HANDLE));
    vi.stubGlobal('cancelAnimationFrame', cancel);

    const { result, unmount } = renderGesture();
    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    // Move into the top edge band of the INJECTED bounds — starts the loop.
    result.current.handlers.onPointerMove(evt(MID.x, BOUNDS.top + 1));

    unmount();

    expect(cancel).toHaveBeenCalledWith(RAF_HANDLE);
  });
});

describe('usePaintGesture — 6. mouse enters immediately and commits a RANGE (P6 guard)', () => {
  it('anchors on pointerdown with no hold, extends on move, commits the pair on release', () => {
    const { result, onExtend, onCommit } = renderGesture();
    const anchor = resolvePoint(MID.x, MID.y);
    const end = resolvePoint(MID.x, MID.y + 200);

    result.current.handlers.onPointerDown(evt(MID.x, MID.y, 'mouse'));
    // No timer is advanced anywhere in this test: the mouse arm's entry condition is the
    // pointerdown itself. That difference in ENTRY is the only difference between the arms.
    expect(onExtend).toHaveBeenCalledWith(anchor, anchor);

    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 200, 'mouse'));
    result.current.handlers.onPointerUp(evt(MID.x, MID.y + 200, 'mouse'));

    // A PAIR, not a per-cell paint: this is what react-big-calendar's onSelectSlot supplied and
    // what WeekGrid's paint path cannot express.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(anchor, end);
    expect(anchor).not.toEqual(end);
  });
});

describe('usePaintGesture — 7. non-primary mouse buttons are ignored (WR-01)', () => {
  // The defect: a RIGHT-CLICK on a slot opened the context menu AND wrote the event's start
  // time. `onPointerDown` had no button check, and `onPointerUp` commits for any button once a
  // gesture is live, so the press anchored and the release committed.
  it('a right-button press commits nothing', () => {
    const { result, onEnter, onExtend, onCommit } = renderGesture();

    result.current.handlers.onPointerDown(evt(MID.x, MID.y, 'mouse', 1, 2));
    result.current.handlers.onPointerUp(evt(MID.x, MID.y, 'mouse', 1, 2));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();
    expect(onExtend).not.toHaveBeenCalled();
  });

  it('a middle-button press commits nothing', () => {
    const { result, onEnter, onExtend, onCommit } = renderGesture();

    result.current.handlers.onPointerDown(evt(MID.x, MID.y, 'mouse', 1, 1));
    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 200, 'mouse', 1, 1));
    result.current.handlers.onPointerUp(evt(MID.x, MID.y + 200, 'mouse', 1, 1));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();
    expect(onExtend).not.toHaveBeenCalled();
  });

  it('the PRIMARY button still anchors, extends and commits', () => {
    const { result, onExtend, onCommit } = renderGesture();
    const anchor = resolvePoint(MID.x, MID.y);
    const end = resolvePoint(MID.x, MID.y + 200);

    result.current.handlers.onPointerDown(evt(MID.x, MID.y, 'mouse', 1, 0));
    expect(onExtend).toHaveBeenCalledWith(anchor, anchor);

    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 200, 'mouse', 1, 0));
    result.current.handlers.onPointerUp(evt(MID.x, MID.y + 200, 'mouse', 1, 0));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(anchor, end);
  });

  it('an event with NO button field still engages — absent means primary', () => {
    // Touch contact reports `button: 0`, and every synthetic fixture in this file omits the
    // field entirely. A filter that treated absent as non-primary would kill BOTH.
    const { result, onExtend, onCommit } = renderGesture();
    const anchor = resolvePoint(MID.x, MID.y);

    const down = evt(MID.x, MID.y, 'mouse');
    expect(down.button).toBeUndefined();

    result.current.handlers.onPointerDown(down);
    expect(onExtend).toHaveBeenCalledWith(anchor, anchor);

    result.current.handlers.onPointerUp(evt(MID.x, MID.y, 'mouse'));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a right-button press MID-DRAG neither cancels nor re-anchors the live gesture', () => {
    // The filter is at `onPointerDown` only. A second, non-primary press arriving while a
    // primary drag is live must be a no-op: the stale-gesture `teardown()` sits BELOW the
    // filter, so it is never reached, and the original anchor survives to commit.
    const { result, onCommit } = renderGesture();
    const anchor = resolvePoint(MID.x, MID.y);
    const end = resolvePoint(MID.x, MID.y + 200);

    result.current.handlers.onPointerDown(evt(MID.x, MID.y, 'mouse', 1, 0));
    result.current.handlers.onPointerMove(evt(MID.x, MID.y + 200, 'mouse', 1, 0));

    // Right button goes down mid-drag.
    result.current.handlers.onPointerDown(evt(MID.x, MID.y + 200, 'mouse', 2, 2));

    result.current.handlers.onPointerUp(evt(MID.x, MID.y + 200, 'mouse', 1, 0));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(anchor, end);
  });
});

// ---------------------------------------------------------------------------
// PLAN 88.6-39 ADDITIONS (W52 / D-18) — `onActiveChange`.
//
// THE IMPLEMENTATION IS ONE GUARDED EMIT; THE COVERAGE IS FOUR PATHS. `teardown()` is the hook's
// single shared exit and it is reached from four call sites — `finish()` (which both the commit
// route and the `pointercancel` route funnel through), the stale-gesture safety in
// `onPointerDown`, the slop-cancel in `onPointerMove`, and the unmount cleanup. One "it fires
// false eventually" test cannot tell WHICH of those is wired, so each gets its own case.
//
// TWO OF THE FOUR MUST NOT FIRE, and that is not a gap in the coverage — it is the point. The
// slop-cancel path is every scroll that begins over the grid; it never engaged, so an emit there
// would be a `false` with no preceding `true`. The same is true of the TAP arm, which sets
// `state.active` inline immediately before tearing down without ever passing through `engage()` —
// which is why the guard is a flag set beside the `true` emit and NOT a bare `active` read.
// ---------------------------------------------------------------------------
describe('usePaintGesture — 8. onActiveChange: the four teardown paths through ONE emit', () => {
  it('(:409, commit route) a held drag reports true once on engage and false once on release', () => {
    const onActiveChange = vi.fn();
    const { result } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    expect(onActiveChange).not.toHaveBeenCalled(); // pending is not active

    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onActiveChange.mock.calls).toEqual([[true]]);

    result.current.handlers.onPointerMove(evt(MID.x + 20, MID.y + 20));
    result.current.handlers.onPointerUp(evt(MID.x + 20, MID.y + 20));

    // Exactly ONCE — not once from `finish` and again from `teardown`.
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it('(:409, pointercancel route) an ACTIVE gesture taken by the browser still reports false', () => {
    const onActiveChange = vi.fn();
    const { result } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.handlers.onPointerCancel(evt(MID.x, MID.y));

    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it('(:432, stale-gesture safety) a second pointerdown settles the first gesture with a false', () => {
    const onActiveChange = vi.fn();
    const { result } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onActiveChange.mock.calls).toEqual([[true]]);

    // A NEW press while the first gesture is still live. `onPointerDown` tears the stale one
    // down before building its own state, so the pair closes before the next one opens.
    result.current.handlers.onPointerDown(evt(MID.x + 5, MID.y + 5, 'touch', 2));

    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it('(:470, slop-cancel — THE SCROLL PATH) a pan that never engaged reports NOTHING', () => {
    const onActiveChange = vi.fn();
    const { result } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    // Past the slop distance while still UNDER the long-press threshold: the browser takes the
    // pan. This is the single most frequent way a pointer sequence over this grid ends, and an
    // unguarded emit here would fire an unpaired `false` on every scroll.
    result.current.handlers.onPointerMove(evt(MID.x, MID.y + SLOP_PX + 10));

    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('(:537, unmount) unmounting mid-drag reports false so no consumer is left frozen', () => {
    const onActiveChange = vi.fn();
    const { result, unmount } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    onActiveChange.mockClear();

    unmount();

    expect(onActiveChange.mock.calls).toEqual([[false]]);
  });
});

describe('usePaintGesture — 9. onActiveChange: the cases that must NOT fire', () => {
  it('a sub-threshold TAP emits no unpaired false, even though it sets `active` inline', () => {
    const onActiveChange = vi.fn();
    const { result, onCommit } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1); // still BEFORE the threshold
    result.current.handlers.onPointerUp(evt(MID.x, MID.y));

    // The tap DID commit — this is the real tap path, not a no-op fixture.
    expect(onCommit).toHaveBeenCalledTimes(1);
    // …and it reported nothing: a bare `state.active` guard would have fired `[false]` here,
    // because `finish()`'s tap arm sets `active = true` immediately before tearing down.
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('a settle with NO gesture in flight fires ZERO times', () => {
    const onActiveChange = vi.fn();
    const { result } = renderGesture({ onActiveChange });

    // The hook installs `pointerup`/`pointercancel` on `document` for the whole mount, so this
    // arrives routinely with nothing down.
    result.current.handlers.onPointerUp(evt(MID.x, MID.y));
    result.current.handlers.onPointerCancel(evt(MID.x, MID.y));

    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('true fires exactly ONCE per engage, however many moves the drag makes', () => {
    const onActiveChange = vi.fn();
    const { result } = renderGesture({ onActiveChange });

    result.current.handlers.onPointerDown(evt(MID.x, MID.y));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    for (let i = 1; i <= 6; i++) {
      result.current.handlers.onPointerMove(evt(MID.x + i * 4, MID.y + i * 4));
    }

    expect(onActiveChange.mock.calls.filter(([v]) => v === true)).toHaveLength(1);
  });
});
