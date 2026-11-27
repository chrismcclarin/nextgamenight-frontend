import { expect, type Locator, type Page } from '@playwright/test';

import { describeRing, focusRingMeasurement } from './contrast';
import { settleAnimations } from './inFlight';

// expectFocusRingClearOfText(page, control, text, label) — for a control that sits to the RIGHT of
// a run of text: give the control a real keyboard focus, let its ring finish painting, and assert
// that the ring box (the border box plus whatever the ring paints OUTSIDE it) starts at or right of
// the text's last glyph.
//
// How the ring box is found: the shared ring reader (focusRingMeasurement in e2e/support/contrast.ts)
// reads the two-tone ring the browser painted, an outline over a band, and returns its reach: the
// outline's offset plus its width for the outset ring (4px), 0 for the inset ring, or the widest
// outward box-shadow spread if that is larger. The reader THROWS on any other shape (no outline,
// the browser's own outline, the pre-89.6 box-shadow ring), which is the failure here too.
//
// The text box is a Range over the text element's contents, i.e. the glyphs themselves, not the
// element's box: a heading or paragraph box can be wider than its text, and a long name wraps.
//
// The 0.5px tolerance absorbs subpixel rounding only. The defect it guards (V-1a) is 4px: the house
// ring's 2px offset plus its 2px width, painted over the last letter of the username.
//
// DECISION Phase 88.6.1-53 (V-1a / AC-23): the ring box is DERIVED from the box-shadow the browser
// painted and compared with a Range over the glyphs. REJECTED: (a) comparing the button box with the
// heading box — the pencil's -m-2 box touches the heading by construction, so that check cannot tell
// an outset ring from an inset one; (b) a screenshot diff — font- and theme-fragile, and it would
// capture personal data on a signed-in page. ONE helper, shared by e2e/profile-pencil-ring.spec.ts
// (the Edit-username pencil) and e2e/profile-pressed-controls.spec.ts (the SMS banner's Dismiss); a
// second copy is rejected by the milestone's duplication tenet. Changing the measurement is a
// decision, not a cleanup.
// AMENDED Phase 89.6-14 (O-1 B): the ring is an outline over a band, so the ring box is the border box plus the outline's offset and width (the reader's reach), not the largest box-shadow spread; the single shared reader is kept.

interface BoxRead {
  focusVisible: boolean;
  rect: { left: number; right: number; top: number; bottom: number };
  textRect: { left: number; right: number; width: number };
}

export async function expectFocusRingClearOfText(
  page: Page,
  control: Locator,
  text: Locator,
  label: string,
): Promise<void> {
  // The reader focuses by keyboard, waits for the control's transitions and throws on a non-house shape.
  const ring = await focusRingMeasurement(page, control, label);
  await settleAnimations(control);
  const outward = ring.reach;

  const textHandle = await text.elementHandle();
  expect(textHandle, `${label}: the text element did not resolve`).not.toBeNull();

  const read: BoxRead = await control.evaluate((el, textEl) => {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(textEl as Node);
    const t = range.getBoundingClientRect();

    return {
      focusVisible: el.matches(':focus-visible'),
      rect: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      textRect: { left: t.left, right: t.right, width: t.width },
    };
  }, textHandle);

  const measured = `${JSON.stringify(read)}; ${describeRing(label, ring)}`;
  expect(read.focusVisible, `${label}: the control never matched :focus-visible (${measured})`).toBe(true);
  // Anti-vacuity: the reader resolving proves a house ring is painted (it throws otherwise).
  expect(read.textRect.width, `${label}: the text box is empty (${measured})`).toBeGreaterThan(0);
  expect(
    read.rect.left - outward,
    `${label}: the focus ring paints ${outward}px outside the control and its left edge ` +
      `(${read.rect.left - outward}px) is left of the text's last glyph (${read.textRect.right}px), ` +
      `so it covers the text (${measured})`,
  ).toBeGreaterThanOrEqual(read.textRect.right - 0.5);
}

// readRingRoom(page, control, label) — the geometry half of the one ring rule (outline rule 10,
// owner pick O-1 B, 2026-11-22): G1, the ring's corners are rounded; G2, a standalone text control
// keeps room between its own ink and the ring. It focuses the control by keyboard through the
// shared ring reader (which throws on any ring that is not the house ring) and returns:
//   radius     the smallest of the four computed corner radii, in px (0 is a square ring);
//   inkToRing  per side, (ink edge to border-box edge) + the outline's offset: how far the ring's
//              inner edge is from the control's own ink. For the outset ring the offset is +2; for
//              the inset ring it is negative, so the same sum holds;
//   box, ink   the two rects the sums came from, for failure messages.
// The ink rect is the union of the control's drawn text (a Range per text node, so a box wider
// than its glyphs does not count) and its svg / img descendants wider than 1px. Text that is not
// drawn is skipped: a visually hidden span (a 1px clipped box), display none, visibility hidden.
// A control with no ink at all throws, unless the caller passes allowNoInk (Phase 89.6-31: the
// half-star hit zones draw nothing of their own); the box then stands in for the ink.
//
// Added by Phase 89.6-43 for the chrome's text controls (e2e/chrome-ring-geometry.spec.ts); plan
// 89.6-31 reuses it for the ring census. ONE read, beside expectFocusRingClearOfText: a spec never
// carries its own copy.

export interface SideRoom {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RingRoom {
  /** The smallest computed corner radius, px. */
  radius: number;
  /** Ink edge to the ring's inner edge, per side, px. */
  inkToRing: SideRoom;
  /** The control's border box. */
  box: SideRoom;
  /** The union of its drawn text and svg / img descendants. */
  ink: SideRoom;
  outlineOffset: number;
  /** One line for a failure message. */
  summary: string;
}

export async function readRingRoom(page: Page, control: Locator, label: string, options: { allowNoInk?: boolean } = {}): Promise<RingRoom> {
  // The reader focuses by keyboard, waits for the control's transitions and throws on a non-house shape.
  const ring = await focusRingMeasurement(page, control, label);
  await settleAnimations(control);
  const read = await control.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // A computed corner radius is "<x>px" or "<x>px <y>px" (elliptical) or a percentage of the box.
    const corner = (value: string): number => {
      const parts = value.trim().split(/\s+/).map((part, index) => {
        const n = Number.parseFloat(part);
        if (!Number.isFinite(n)) return 0;
        return part.endsWith('%') ? (n / 100) * (index === 0 ? box.width : box.height) : n;
      });
      return Math.min(...(parts.length > 0 ? parts : [0]));
    };
    const radius = Math.min(
      corner(style.borderTopLeftRadius),
      corner(style.borderTopRightRadius),
      corner(style.borderBottomRightRadius),
      corner(style.borderBottomLeftRadius),
    );

    // Drawn or not: every element from the node's parent up to the control.
    const drawn = (from: Element | null): boolean => {
      for (let a = from; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility !== 'visible') return false;
        if (a !== el) {
          const r = a.getBoundingClientRect();
          const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
          if (clips && (r.width <= 1 || r.height <= 1)) return false;
        }
        if (a === el) break;
      }
      return true;
    };
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue;
      if (!drawn(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) rects.push(r);
    }
    for (const media of Array.from(el.querySelectorAll('svg, img'))) {
      if (!drawn(media)) continue;
      const r = media.getBoundingClientRect();
      if (r.width > 1 && r.height > 0) rects.push(r);
    }
    if (rects.length === 0) return { radius, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, ink: null };
    const ink = {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    return {
      radius,
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      ink,
    };
  });
  // A control that draws nothing of its own (a transparent hit zone over a picture) has no ink to
  // keep room from: its box stands in for the ink, only for a caller that says so (allowNoInk).
  if (!read.ink && !options.allowNoInk) throw new Error(`${label}: the control draws no text, svg or img to measure ring room from`);
  const ink = read.ink ?? read.box;
  const offset = ring.outlineOffset;
  const inkToRing: SideRoom = {
    left: ink.left - read.box.left + offset,
    right: read.box.right - ink.right + offset,
    top: ink.top - read.box.top + offset,
    bottom: read.box.bottom - ink.bottom + offset,
  };
  const two = (n: number) => n.toFixed(2);
  const summary =
    `radius ${two(read.radius)}px, ink to ring left ${two(inkToRing.left)} right ${two(inkToRing.right)} ` +
    `top ${two(inkToRing.top)} bottom ${two(inkToRing.bottom)}px (outline offset ${offset}px)`;
  return { radius: read.radius, inkToRing, box: read.box, ink, outlineOffset: offset, summary };
}

// readRingClip(control, reach) — is the ring of a focused control cut off, and by what? The ring
// box is the control's border box grown by reach on every side (reach comes from the shared ring
// reader: focusRingMeasurement in e2e/support/contrast.ts). It returns null when the ring is drawn
// whole, or the FIRST thing that cuts it, with how far the ring passes that thing's padding box per
// side: a clipping ancestor (overflow-x or overflow-y not visible) or the screen edge (sideways
// only: the page scrolls down to anything below the fold; and where the page scrolls sideways, the
// edge is the end of that scroll).
//
// Callers: the geometry record (e2e/focus-ring-geometry.spec.ts: readRing and measureRow) and
// expectRingWhole (e2e/support/largeTextSurfaces/home.ts), which the Home sweep row and the chrome
// ring spec use. Plan 89.6-45 (the whole-tree ring census) is the next caller.
//
// DECISION Phase 89.6-31 (one-clip-read): one clip read in ringGeometry.ts called by the geometry record and expectRingWhole OVER the two ancestor walks plans 88.9-66 and 89.6-16 left — the same rule read twice drifts (the spec stopped at body, the sweep at html). Only containing-block ancestors are read, and body only when its overflow is its own, chosen OVER every ancestor with overflow set (an absolute or fixed control is not clipped by a non-containing ancestor, and an open dialog's scroll lock puts overflow hidden on body, which clips nothing while html is visible; either would read a false cut and send Task 2 to an unneeded inset ring). Changing this is a decision, not a cleanup.
//
// The containing-block chain, as CSS defines what can clip a box: from a position absolute element
// the next element is its containing block (the first ancestor that is positioned, or that has a
// transform, a filter, a perspective, or contain paint / layout / strict / content); from a position
// fixed element it is the first ancestor with a transform, a filter, a perspective or that contain
// (none: only the screen clips it); from any other element it is the parent. Each element reached
// this way is judged, then becomes the element whose containing block is sought. html is never
// judged (its overflow belongs to the screen) and body is skipped while html's overflow-x and
// overflow-y are both visible (body's overflow is then handed to the screen too).

export interface RingClip {
  /** What cuts the ring: tag, id and classes of the ancestor, or "the screen edge". */
  by: string;
  /** How far the ring passes the clipping box per side, px (0 on a side that is whole). */
  over: SideRoom;
}

export async function readRingClip(control: Locator, reach: number): Promise<RingClip | null> {
  return control.evaluate((el, grow) => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const rect = el.getBoundingClientRect();
    const ring = { left: rect.left - grow, top: rect.top - grow, right: rect.right + grow, bottom: rect.bottom + grow };
    const doc = document.documentElement;
    const body = document.body;

    // Does this element establish a containing block for fixed (and absolute) descendants?
    // (Tailwind v4 writes translate-*, rotate-* and scale-* as the translate, rotate and scale
    // properties, which make a containing block just as transform does.)
    const containsFixed = (style: CSSStyleDeclaration): boolean =>
      style.transform !== 'none' ||
      style.translate !== 'none' ||
      style.rotate !== 'none' ||
      style.scale !== 'none' ||
      style.filter !== 'none' ||
      style.backdropFilter !== 'none' ||
      style.perspective !== 'none' ||
      /\b(paint|layout|strict|content)\b/.test(style.contain) ||
      /\b(transform|translate|rotate|scale|filter|perspective)\b/.test(style.willChange);
    const next = (from: Element): Element | null => {
      const position = getComputedStyle(from).position;
      if (position !== 'absolute' && position !== 'fixed') return from.parentElement;
      for (let up = from.parentElement; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (containsFixed(style)) return up;
        if (position === 'absolute' && style.position !== 'static') return up;
      }
      return null;
    };
    const htmlStyle = getComputedStyle(doc);
    const bodyClips = htmlStyle.overflowX !== 'visible' || htmlStyle.overflowY !== 'visible';

    for (let up = next(el); up; up = next(up)) {
      if (up === doc) break;
      if (up === body && !bodyClips) continue;
      const style = getComputedStyle(up);
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      // The padding box: clipping starts inside the border and inside a scrollbar's gutter.
      const box = up.getBoundingClientRect();
      const left = box.left + up.clientLeft;
      const top = box.top + up.clientTop;
      const right = left + up.clientWidth;
      const bottom = top + up.clientHeight;
      const over = {
        left: clipsX ? round(Math.max(0, left - ring.left)) : 0,
        right: clipsX ? round(Math.max(0, ring.right - right)) : 0,
        top: clipsY ? round(Math.max(0, top - ring.top)) : 0,
        bottom: clipsY ? round(Math.max(0, ring.bottom - bottom)) : 0,
      };
      if (over.left > 0.5 || over.right > 0.5 || over.top > 0.5 || over.bottom > 0.5) {
        const classes = String(up.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).join('.');
        return { by: `${up.tagName.toLowerCase()}${up.id ? `#${up.id}` : ''}${classes ? `.${classes}` : ''}`, over };
      }
    }
    // The screen edge, sideways only. Where the page itself scrolls sideways (the screen's overflow-x
    // is html's, or body's while html's is visible), the edge is the end of that scroll, not the
    // window: a ring a sideways scroll brings into view is not cut. With no sideways scroll the two
    // are the same line.
    const bodyStyle = body ? getComputedStyle(body) : null;
    const screenOverflowX = htmlStyle.overflowX !== 'visible' ? htmlStyle.overflowX : (bodyStyle?.overflowX ?? 'visible');
    const scrollsSideways = screenOverflowX === 'visible' || screenOverflowX === 'auto' || screenOverflowX === 'scroll';
    const edgeLeft = scrollsSideways ? -window.scrollX : 0;
    const edgeRight = scrollsSideways ? Math.max(doc.clientWidth, doc.scrollWidth - window.scrollX) : doc.clientWidth;
    const over = {
      left: round(Math.max(0, edgeLeft - ring.left)),
      right: round(Math.max(0, ring.right - edgeRight)),
      top: 0,
      bottom: 0,
    };
    if (over.left > 0.5 || over.right > 0.5) return { by: 'the screen edge', over };
    return null;
  }, reach);
}
