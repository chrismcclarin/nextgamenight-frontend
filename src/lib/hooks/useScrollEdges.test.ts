// useScrollEdges (Phase 89.6-21, CI-01g): which ends of a horizontal scroller hide content. jsdom
// lays nothing out, so each test stubs the scroller's scrollWidth, clientWidth and scrollLeft and
// stands in for ResizeObserver and MutationObserver. The marker is at
// src/lib/hooks/useScrollEdges.ts ("DECISION Phase 89.6-21 (scroll-edges)").
import { act, render, renderHook } from '@testing-library/react';
import { createElement, useRef, useState, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollEdges } from './useScrollEdges';

type Box = { scrollWidth: number; clientWidth: number; scrollLeft: number };

// Gives an element a measured box the hook reads; the numbers can change between reads.
function stubBox(el: HTMLElement, box: Box): Box {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => box.scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => box.clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => box.scrollLeft, set: (v: number) => (box.scrollLeft = v) });
  return box;
}

// A stand-in ResizeObserver that remembers what it watches, so a test can fire it for one element.
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  watched = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this);
  }
  observe(el: Element) {
    this.watched.add(el);
  }
  unobserve(el: Element) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  static fire(el: Element) {
    for (const observer of FakeResizeObserver.all) {
      if (observer.watched.has(el)) observer.callback([], observer as unknown as ResizeObserver);
    }
  }
  static watching(el: Element): boolean {
    return FakeResizeObserver.all.some((observer) => observer.watched.has(el));
  }
}

class FakeMutationObserver {
  static all: FakeMutationObserver[] = [];
  target: Node | null = null;
  constructor(private readonly callback: MutationCallback) {
    FakeMutationObserver.all.push(this);
  }
  observe(target: Node) {
    this.target = target;
  }
  disconnect() {
    this.target = null;
  }
  takeRecords() {
    return [];
  }
  static fire(target: Node) {
    for (const observer of FakeMutationObserver.all) {
      if (observer.target === target) observer.callback([], observer as unknown as MutationObserver);
    }
  }
}

function refTo(el: HTMLElement | null): RefObject<HTMLElement | null> {
  return { current: el };
}

describe('useScrollEdges (89.6-21, CI-01g)', () => {
  beforeEach(() => {
    FakeResizeObserver.all = [];
    FakeMutationObserver.all = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no hidden end when the content fits (scrollWidth at most clientWidth + 1)', () => {
    const el = document.createElement('div');
    stubBox(el, { scrollWidth: 301, clientWidth: 300, scrollLeft: 0 });
    const { result } = renderHook(() => useScrollEdges(refTo(el)));
    expect(result.current).toEqual({ start: false, end: false });
  });

  it('reports the end hidden while content runs past it, and the start once scrolled from 0', () => {
    const el = document.createElement('div');
    const box = stubBox(el, { scrollWidth: 549, clientWidth: 311, scrollLeft: 0 });
    const { result } = renderHook(() => useScrollEdges(refTo(el)));
    expect(result.current).toEqual({ start: false, end: true });
    act(() => {
      box.scrollLeft = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toEqual({ start: true, end: true });
    act(() => {
      box.scrollLeft = 238;
      el.dispatchEvent(new Event('scrollend'));
    });
    expect(result.current).toEqual({ start: true, end: false });
  });

  it('recomputes when the scroller resizes (ResizeObserver)', () => {
    const el = document.createElement('div');
    const box = stubBox(el, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    const { result } = renderHook(() => useScrollEdges(refTo(el)));
    expect(result.current.end).toBe(false);
    act(() => {
      box.clientWidth = 200;
      FakeResizeObserver.fire(el);
    });
    expect(result.current).toEqual({ start: false, end: true });
  });

  it('recomputes when a child widens without the scroller resizing, and watches a child added later', () => {
    const el = document.createElement('div');
    const first = document.createElement('button');
    el.appendChild(first);
    const box = stubBox(el, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    const { result } = renderHook(() => useScrollEdges(refTo(el)));
    expect(FakeResizeObserver.watching(first)).toBe(true);
    act(() => {
      box.scrollWidth = 360; // a count pill arrived in a tab
      FakeResizeObserver.fire(first);
    });
    expect(result.current.end).toBe(true);
    const second = document.createElement('button');
    act(() => {
      el.appendChild(second);
      FakeMutationObserver.fire(el);
    });
    expect(FakeResizeObserver.watching(second)).toBe(true);
  });

  it('with no ResizeObserver in the environment reports both false and throws nothing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const el = document.createElement('div');
    stubBox(el, { scrollWidth: 549, clientWidth: 311, scrollLeft: 0 });
    const { result } = renderHook(() => useScrollEdges(refTo(el)));
    expect(result.current).toEqual({ start: false, end: false });
  });

  it('removes its listeners and observers on unmount', () => {
    const el = document.createElement('div');
    stubBox(el, { scrollWidth: 549, clientWidth: 311, scrollLeft: 0 });
    const remove = vi.spyOn(el, 'removeEventListener');
    const { unmount } = renderHook(() => useScrollEdges(refTo(el)));
    unmount();
    const removed = remove.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(expect.arrayContaining(['scroll', 'scrollend']));
    expect(FakeResizeObserver.watching(el)).toBe(false);
    expect(FakeMutationObserver.all.every((observer) => observer.target === null)).toBe(true);
  });

  it('binds to the element the ref holds after a later commit, not only the first (review M026)', () => {
    let show: (on: boolean) => void = () => undefined;
    let flags = { start: false, end: false };
    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      const [on, setOn] = useState(false);
      show = setOn;
      flags = useScrollEdges(ref);
      // An early return before the scroller renders, as friends/page.js returns a loading tree.
      if (!on) return createElement('p', null, 'Loading');
      return createElement('div', {
        ref: (node: HTMLDivElement | null) => {
          if (node) stubBox(node, { scrollWidth: 549, clientWidth: 311, scrollLeft: 0 });
          ref.current = node;
        },
      });
    }
    render(createElement(Host));
    expect(flags).toEqual({ start: false, end: false });
    act(() => show(true));
    expect(flags).toEqual({ start: false, end: true });
  });

  it('an event that flips no flag does not re-render the host (review M090)', () => {
    const el = document.createElement('div');
    const box = stubBox(el, { scrollWidth: 549, clientWidth: 311, scrollLeft: 0 });
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useScrollEdges(refTo(el));
    });
    const settled = renders;
    act(() => {
      for (const left of [10, 20, 30]) {
        box.scrollLeft = left;
        el.dispatchEvent(new Event('scroll'));
      }
    });
    // The first scroll flips start to true: one render. The next two flip nothing.
    expect(renders).toBe(settled + 1);
    act(() => {
      box.scrollLeft = 40;
      el.dispatchEvent(new Event('scroll'));
      FakeResizeObserver.fire(el);
    });
    expect(renders).toBe(settled + 1);
  });
});
