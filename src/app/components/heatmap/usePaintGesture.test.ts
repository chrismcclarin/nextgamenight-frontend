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
  pointerId = 1
): GesturePointerEvent {
  return { pointerId, pointerType, clientX: x, clientY: y };
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
