// The keyboard focus ring as it is TODAY, described once for the unit tests.
//
// Every unit test that asserts a keyboard ring (outside the mechanism tests plan 89.6-13 owns)
// reads its ring tokens from this module instead of writing them as literals. Five forms:
//   - the offset form (the Button base and most controls): FOCUS_RING_CLASSES, expectFocusRing;
//   - the inset form (tiles and rows whose ring sits inside the box): FOCUS_RING_INSET_CLASSES,
//     expectFocusRingInset;
//   - the edge form (a ring with no offset; its colour token is the expect's argument):
//     FOCUS_RING_EDGE_CLASSES, expectFocusRingEdge;
//   - the peer form (a ring drawn on a sibling of a focused input): FOCUS_RING_PEER_CLASSES;
//   - the source token every ring string in source carries today, all forms:
//     FOCUS_RING_SOURCE_TOKEN (source scans count or look for it).
// Plus expectRingGround(target, ground): which halo (the ring-offset colour) an element wears.
//
// Plan 89.6-13 flips the five constants and the four bodies in its run commit; plan 89.6-38
// deletes hostGround.ts, so this module never imports it (and it imports no source scanner,
// so it owes no drift-gate-registry row).
//
// Never apply expectRingGround to an element whose halo comes from hostGroundHalo: those halos
// are plan 89.6-38's, and their tests keep their raw lines until then.
//
// Absence checks (plan review M054): a test that means "no ring at this site" writes
// .not.toContain(FOCUS_RING_SOURCE_TOKEN), or iterates a whole constant
// (for (const t of FOCUS_RING_CLASSES) expect(x).not.toContain(t)). NEVER index into a
// constant: after plan 89.6-13 shrinks the arrays an index past the end is undefined, and
// not.toContain(undefined) passes, a silent loss of the guard.
//
// DECISION Phase 89.6-37 (ring-helper): one test helper describing today's ring, flipped once
// by plan 89.6-13, OVER re-pinning about 120 assertion lines in 43 files inside the flip commit
// (a straggler there blocks the run) and OVER either-form predicates (each could pass vacuously
// mid-way). Changing this is a decision, not a cleanup.
import { expect } from 'vitest';

/** The ground an element's halo is painted for. */
export type RingGround = 'card' | 'page' | 'elevated' | 'muted' | 'warning' | 'group' | 'hero';

/** An element, a class string, or a list of class tokens (each entry may hold several). */
type RingTarget = Element | string | readonly string[];

/** The offset form: a 2px focus-ring-coloured ring, 2px outside the box. */
export const FOCUS_RING_CLASSES: readonly string[] = [
  'focus-visible:ring-2',
  'focus-visible:ring-focus-ring',
  'focus-visible:ring-offset-2',
];

/** The inset form: the same ring drawn inside the box. */
export const FOCUS_RING_INSET_CLASSES: readonly string[] = [
  'focus-visible:ring-2',
  'focus-visible:ring-inset',
  'focus-visible:ring-focus-ring',
];

/** The edge form: a ring with no offset; its colour is expectFocusRingEdge's argument. */
export const FOCUS_RING_EDGE_CLASSES: readonly string[] = ['focus-visible:ring-2'];

/** The peer form: the ring a focused input paints on its styled sibling. */
export const FOCUS_RING_PEER_CLASSES: readonly string[] = ['peer-focus-visible:ring-2'];

/** The token every ring string in source carries today, in every form (a substring match). */
export const FOCUS_RING_SOURCE_TOKEN = 'focus-visible:ring-2';

// Ground to halo colour. Held here OVER importing HOST_GROUND_HALO: plan 89.6-38 deletes
// hostGround.ts, and the landing hero ground is not in that map.
const GROUND_HALO: Record<RingGround, string> = {
  card: 'surface-card',
  page: 'surface-page',
  elevated: 'surface-elevated',
  muted: 'surface-muted',
  warning: 'status-warning-subtle',
  group: 'surface-group-halo',
  hero: 'surface-hero',
};

const OUTSIDE_OFFSET = /^focus-visible:ring-offset-[1-9][0-9]*$/;
const HALO_COLOUR = /^focus-visible:ring-offset-(?![0-9]+$).+$/;

// A class string may be a slice of SOURCE text (a source scan hands over a whole open tag), so
// quotes, backticks and braces split tokens as whitespace does: className="a b" reads as a, b.
const TOKEN_SPLIT = /[\s"'\x60{}]+/;

function tokensOf(target: RingTarget): string[] {
  if (typeof target === 'string') return target.split(TOKEN_SPLIT).filter(Boolean);
  if (typeof (target as Element).getAttribute === 'function') {
    return ((target as Element).getAttribute('class') ?? '').split(TOKEN_SPLIT).filter(Boolean);
  }
  return (target as readonly string[]).flatMap((t) => t.split(TOKEN_SPLIT)).filter(Boolean);
}

function expectAll(tokens: string[], wanted: readonly string[], what: string, label?: string) {
  const missing = wanted.filter((t) => !tokens.includes(t));
  expect(missing, `${label ?? 'element'}: ${what} is missing ${missing.join(', ')}`).toEqual([]);
}

function expectNone(tokens: string[], bad: (t: string) => boolean, what: string, label?: string) {
  const found = tokens.filter(bad);
  expect(found, `${label ?? 'element'}: ${what} (${found.join(', ')})`).toEqual([]);
}

/** The offset form is present in full. */
export function expectFocusRing(target: RingTarget, label?: string): void {
  expectAll(tokensOf(target), FOCUS_RING_CLASSES, 'the focus ring', label);
}

/** The inset form is present in full, with no outside offset (ring-offset-0 is allowed). */
export function expectFocusRingInset(target: RingTarget, label?: string): void {
  const tokens = tokensOf(target);
  expectAll(tokens, FOCUS_RING_INSET_CLASSES, 'the inset focus ring', label);
  expectNone(tokens, (t) => OUTSIDE_OFFSET.test(t), 'an inset ring carries an outside offset', label);
}

/** The edge form and its colour are present, with no inset and no outside offset. */
export function expectFocusRingEdge(
  target: RingTarget,
  colour = 'focus-visible:ring-focus-ring',
  label?: string,
): void {
  const tokens = tokensOf(target);
  expectAll(tokens, [...FOCUS_RING_EDGE_CLASSES, colour], 'the edge focus ring', label);
  expectNone(
    tokens,
    (t) => t === 'focus-visible:ring-inset' || OUTSIDE_OFFSET.test(t),
    'an edge ring carries an inset or an outside offset',
    label,
  );
}

/**
 * The halo for this ground is present and no other un-prefixed halo colour is (a dark: variant
 * is not judged here). Never for an element whose halo comes from hostGroundHalo.
 */
export function expectRingGround(target: RingTarget, ground: RingGround, label?: string): void {
  const tokens = tokensOf(target);
  const want = `focus-visible:ring-offset-${GROUND_HALO[ground]}`;
  expectAll(tokens, [want], `the ${ground}-ground halo`, label);
  expectNone(
    tokens,
    (t) => HALO_COLOUR.test(t) && t !== want,
    `another halo beside the ${ground}-ground one`,
    label,
  );
}
