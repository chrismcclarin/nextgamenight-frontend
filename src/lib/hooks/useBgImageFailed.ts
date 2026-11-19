'use client';

/**
 * useBgImageFailed — the ONE load probe for every picture ground (plan 88.9-60, X6, owner F1).
 *
 * A group picture is painted as a CSS background-image, which reports nothing when its URL fails
 * to load, so a dead picture used to keep the photo text treatment over a ground that showed only
 * the group tint. This hook answers "did this picture fail to load?" for a VALIDATED style (the
 * output of src/lib/safeBgImageStyle.ts ("export function safeBgImageStyle(")), from one module
 * store shared by every consumer on the page.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { isAllowedImageUrl } from '../safeBgImageStyle';

type Listener = (failedHref: string) => void;

/* DECISION Phase 88.9-60 (X6, owner F1, 2026-11-11): ONE load probe for every picture ground,
   chosen OVER a per-element hook (cards, tiles and rows render inside maps) and OVER reading the
   raw URL (groupColourRendering 29, 31). While pending the photo arm paints, chosen OVER
   no-picture first (it re-styles every working photo on every fresh load) and OVER hiding text; a
   failed URL flips once per page load, then is cached. The drain effect has no dependency array,
   chosen OVER subscribe-once (an href first seen on a re-render would never be probed); a failure
   notifies only consumers that looked that URL up, chosen OVER notifying every consumer (every
   list row and both group pages would re-render); the looked-up set is published in an isomorphic
   layout effect, chosen OVER publishing it in the passive effect (a failure landing after commit
   but before the passive effect would be dropped and the dead picture keep the photo arm). Never
   probes outside the allow-list; never writes on the server. */

/** Failed hrefs. Immutable: a failure REPLACES the set, so the snapshot identity changes. */
let failedHrefs: ReadonlySet<string> = new Set<string>();
/** The constant server (and hydration) snapshot: nothing has failed before the client looks. */
const NOTHING_FAILED: ReadonlySet<string> = new Set<string>();
const listeners = new Set<Listener>();
/** Hrefs looked up during a render and not yet handed to a probe. */
const queued = new Set<string>();
/** One Image per href, held until it settles. */
const inFlight = new Map<string, HTMLImageElement>();
/** How each probed href ended; a settled href is never probed again in this page load. */
const settled = new Map<string, 'loaded' | 'failed'>();

// A layout effect on the client, a plain effect on the server, where effects never run and a bare
// layout effect logs React 18's warning on every server-rendered page. The house idiom:
// src/components/ui/useFetchErrorState.ts ("const useIsomorphicLayoutEffect = typeof window").
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const VALIDATED_URL = /^url\("(.*)"\)$/;

/** The href inside a validated style, or null for no style and anything the allow-list rejects. */
function hrefOf(style: CSSProperties | undefined): string | null {
  const image = style?.backgroundImage;
  if (typeof image !== 'string') return null;
  const match = VALIDATED_URL.exec(image);
  if (!match) return null;
  return isAllowedImageUrl(match[1]) ? match[1] : null;
}

function settle(href: string, image: HTMLImageElement, outcome: 'loaded' | 'failed'): void {
  image.onload = null;
  image.onerror = null;
  inFlight.delete(href);
  settled.set(href, outcome);
  if (outcome !== 'failed') return;
  const next = new Set(failedHrefs);
  next.add(href);
  failedHrefs = next;
  for (const listener of [...listeners]) listener(href);
}

/** Start one probe per queued href. Idempotent: an in-flight or settled href is skipped. */
function drain(): void {
  if (typeof window === 'undefined') return;
  for (const href of [...queued]) {
    queued.delete(href);
    if (inFlight.has(href) || settled.has(href)) continue;
    const image = new Image();
    inFlight.set(href, image);
    image.onload = () => settle(href, image, 'loaded');
    image.onerror = () => settle(href, image, 'failed');
    image.src = href;
  }
}

function getSnapshot(): ReadonlySet<string> {
  return failedHrefs;
}

function getServerSnapshot(): ReadonlySet<string> {
  return NOTHING_FAILED;
}

/**
 * Call ONCE at a component's top level, then ask the returned function about each validated
 * picture style during render (inside a map is fine). It answers true only after that picture's
 * load has failed; a pending or loaded picture, no style, and a URL outside the allow-list all
 * answer false.
 */
export function useBgImageFailed(): (style: CSSProperties | undefined) => boolean {
  // The hrefs THIS render looked up. A fresh set per render, published at commit below, so a
  // failure wakes this consumer only for a picture it is showing now.
  const seenThisRender = new Set<string>();
  const published = useRef<ReadonlySet<string>>(NOTHING_FAILED);

  const subscribe = useCallback((onStoreChange: () => void) => {
    const listener: Listener = (failedHref) => {
      if (published.current.has(failedHref)) onStoreChange();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const failed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // No dependency array on either effect: both run after every commit. See the marker above.
  useIsomorphicLayoutEffect(() => {
    published.current = seenThisRender;
  });
  useEffect(() => {
    drain();
  });

  return (style) => {
    const href = hrefOf(style);
    if (href === null) return false;
    seenThisRender.add(href);
    if (typeof window !== 'undefined' && !inFlight.has(href) && !settled.has(href)) queued.add(href);
    return failed.has(href);
  };
}

/** Test-only: the store's state between tests. Never called by production code. */
export const bgImageProbeForTests = {
  reset(): void {
    for (const image of inFlight.values()) {
      image.onload = null;
      image.onerror = null;
    }
    failedHrefs = new Set<string>();
    queued.clear();
    inFlight.clear();
    settled.clear();
  },
  listenerCount(): number {
    return listeners.size;
  },
};
