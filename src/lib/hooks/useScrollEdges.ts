'use client';

/**
 * useScrollEdges — which ends of a horizontal scroller hide content (Phase 89.6-21, CI-01g).
 *
 * Returns `{ start, end }`: `end` while content runs past the scroller's end, `start` once it is
 * scrolled from 0. Both are false when the content fits (scrollWidth at most clientWidth + 1),
 * on the server, and wherever ResizeObserver is missing (no cue rather than a wrong one).
 *
 * It re-measures on scroll and scrollend, when the scroller resizes, when any direct child
 * resizes (a tab's count pill arriving widens the content without resizing the scroller), and
 * when the child list changes (a MutationObserver re-observes the children).
 *
 * It binds to whatever element `ref.current` holds after each commit, not only the first: a
 * consumer calls it above its early returns (friends/page.js returns a loading tree before the
 * strip renders), so the element can appear on a later render (review M026).
 */

/* DECISION Phase 89.6-21 (scroll-edges): ONE hook reports which ends of a horizontal scroller
   hide content, chosen OVER a CSS scroll-shadow (it vanishes on the dark page ground) and OVER
   per-strip listeners (the group strip, plan 89.6-17, needs the same). Two primitive state
   booleans, each set only when it changes (a ref holds the last pair), so an event that changes
   neither causes no re-render of the host page (review M090);
   the binding effect has NO dependency array and compares the element it last bound, because an
   effect keyed on the ref object never re-runs (a ref keeps its identity). Changing this is a
   decision, not a cleanup. */

import { useEffect, useRef, useState, type RefObject } from 'react';

export function useScrollEdges(ref: RefObject<HTMLElement | null>): { start: boolean; end: boolean } {
  const [start, setStart] = useState(false);
  const [end, setEnd] = useState(false);
  const bound = useRef<{ el: HTMLElement; unbind: () => void } | null>(null);
  // The flags last set: a state setter is called only when its flag changes (review M090).
  const last = useRef({ start: false, end: false });
  const show = (next: { start: boolean; end: boolean }) => {
    if (next.start !== last.current.start) setStart(next.start);
    if (next.end !== last.current.end) setEnd(next.end);
    last.current = next;
  };

  // Runs after every commit: binds a new element, unbinds a gone one, and does nothing otherwise.
  useEffect(() => {
    const el = ref.current;
    if (bound.current?.el === el) return;
    bound.current?.unbind();
    bound.current = null;
    if (!el || typeof ResizeObserver === 'undefined') {
      show({ start: false, end: false });
      return;
    }

    const measure = () => {
      const overflowing = el.scrollWidth > el.clientWidth + 1;
      show({ start: overflowing && el.scrollLeft > 0, end: overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    };

    const resize = new ResizeObserver(measure);
    resize.observe(el);
    let children = Array.from(el.children);
    for (const child of children) resize.observe(child);
    const mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            for (const child of children) resize.unobserve(child);
            children = Array.from(el.children);
            for (const child of children) resize.observe(child);
            measure();
          });
    mutation?.observe(el, { childList: true });
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('scrollend', measure);
    measure();

    bound.current = {
      el,
      unbind: () => {
        el.removeEventListener('scroll', measure);
        el.removeEventListener('scrollend', measure);
        resize.disconnect();
        mutation?.disconnect();
      },
    };
  });

  // The unmount cleanup removes whatever is bound.
  useEffect(
    () => () => {
      bound.current?.unbind();
      bound.current = null;
    },
    [],
  );

  return { start, end };
}

/**
 * Bring a tab that has just taken keyboard focus into view inside its scrolling strip: clear of
 * the two edge cues (each w-8, 2rem) when it fits between them, else centred in the strip.
 * Lifted by Phase 89.6-17 out of the Friends page's tab onFocus (plan 89.6-21), so the group
 * page's strip and the Friends strip share one copy. At normal text nothing overflows, so nothing
 * scrolls.
 */
/* 89.6-21 (strip-cue): chosen OVER scrollIntoView nearest, which left a focused tab flush with one
   edge and a whole cue over it (64px of Requests at 320 / 200%, CI run 45706391242); centred, each
   cue covers half the overflow, the least the geometry allows, and a tab no wider than the strip
   stays wholly inside it, so a pressed-tab scroll moves nothing. The browser itself scrolls a
   focused tab only when it is wholly hidden, which is why the focus handler exists at all. */
export function revealTabInStrip(strip: HTMLElement, tab: HTMLElement): void {
  const box = strip.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  const cue = 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (rect.width <= box.width - 2 * cue) {
    if (rect.left < box.left + cue) strip.scrollLeft -= box.left + cue - rect.left;
    else if (rect.right > box.right - cue) strip.scrollLeft += rect.right - (box.right - cue);
  } else {
    strip.scrollLeft += rect.left + rect.width / 2 - (box.left + box.width / 2);
  }
}
