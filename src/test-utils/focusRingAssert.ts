// The keyboard focus ring as it is TODAY, described once for the unit tests.
//
// FLIPPED Phase 89.6-13 (owner pick O-1 = B, 2026-11-22: "Two-colour ring, 2px: a thin inner band
// plus a darker outer ring; passes all 96"): every form is now the two-tone focus-ring utility
// (src/app/globals.css, plan 89.6-12). Only the values and bodies changed; every name, signature
// and the RingGround type are as plan 89.6-37 wrote them. Each expect also rejects the old
// box-shadow ring-CLASS tokens; it never judges a halo colour token, because hostGround.ts keeps
// emitting halos on its five consumers until plan 89.6-38.
// AMENDED Phase 89.6-38 (host-ground): halo colour tokens are now rejected too; hostGround.ts is
// deleted, so no control emits a halo.
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
// Plan 89.6-13 flipped the five constants and the four bodies in its run commit; plan 89.6-38
// deleted hostGround.ts, which this module never imported (and it imports no source scanner,
// so it owes no drift-gate-registry row). Since plan 89.6-38 every control may be read with
// expectRingGround: none takes a halo from a host any more.
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

/** The offset form: the two-tone ring, 2px outside the box (the focus-ring utility). */
export const FOCUS_RING_CLASSES: readonly string[] = ['focus-visible:focus-ring'];

/** The inset form: the two-tone ring drawn inside the box. */
export const FOCUS_RING_INSET_CLASSES: readonly string[] = ['focus-visible:focus-ring-inset'];

/** The former edge form (no offset): the codemod mapped it to the outset utility. */
export const FOCUS_RING_EDGE_CLASSES: readonly string[] = ['focus-visible:focus-ring'];

/** The peer form: the ring a focused input paints on its styled sibling. */
export const FOCUS_RING_PEER_CLASSES: readonly string[] = ['peer-focus-visible:focus-ring'];

/** The token every ring string in source carries, in every form (a substring match). */
export const FOCUS_RING_SOURCE_TOKEN = 'focus-visible:focus-ring';

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

// An old box-shadow ring-CLASS token, or a halo, on any focus-visible chain (peer-, group- and any
// lead such as dark: included). Since plan 89.6-38 the halo colour tokens (ring-offset-<colour>)
// are rejected with the widths (ring-offset-<n>): any whole token ending focus-visible:ring-offset-.
const OLD_RING_CLASS = /^(?:[^\s:]+:)*?(?:peer-|group-)?focus-visible:ring-(?:2|inset|focus-ring|ring|offset-\S+)$/;
// Any ring-offset token on a focus-visible chain, width or colour (expectRingGround's check).
const ANY_RING_OFFSET = /^(?:[^\s:]+:)*?(?:peer-|group-)?focus-visible:ring-offset-/;

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

function expectNoOldRing(tokens: string[], label?: string) {
  expectNone(tokens, (t) => OLD_RING_CLASS.test(t), 'an old box-shadow ring token or a halo is left', label);
}

/** The offset form is present, and no old ring token is. */
export function expectFocusRing(target: RingTarget, label?: string): void {
  const tokens = tokensOf(target);
  expectAll(tokens, FOCUS_RING_CLASSES, 'the focus ring', label);
  expectNoOldRing(tokens, label);
}

/**
 * The inset form is present, and no old ring token is. A focus-visible:focus-ring beside it is
 * allowed: a Button call site passing the inset form also carries the base's outset utility, cn()
 * cannot see that the two custom utilities conflict, and the inset rule wins because it is emitted
 * after the outset one (pinned by src/app/focusRingUtility.test.ts ("3. both focus-visible ring utilities")).
 */
export function expectFocusRingInset(target: RingTarget, label?: string): void {
  const tokens = tokensOf(target);
  expectAll(tokens, FOCUS_RING_INSET_CLASSES, 'the inset focus ring', label);
  expectNoOldRing(tokens, label);
}

/** The former edge form: the outset utility is present, and no old ring token is. */
export function expectFocusRingEdge(
  target: RingTarget,
  colour = 'focus-visible:ring-focus-ring',
  label?: string,
): void {
  // The colour argument is ignored since the flip: the two-tone ring has no colour token.
  void colour;
  const tokens = tokensOf(target);
  expectAll(tokens, FOCUS_RING_EDGE_CLASSES, 'the edge focus ring', label);
  expectNoOldRing(tokens, label);
}

/**
 * No ring-offset token of any kind, width or halo, whatever the ground: owner pick O-1 = B
 * retired the halo, and the codemod deleted every halo a component or call site wrote as a
 * literal. The ground stays in the failure text. Since plan 89.6-38 deleted hostGround.ts no
 * element takes a halo from its host, so this reads any control.
 */
export function expectRingGround(target: RingTarget, ground: RingGround, label?: string): void {
  expectNone(
    tokensOf(target),
    (t) => ANY_RING_OFFSET.test(t),
    `the ${ground}-ground halo (${GROUND_HALO[ground]}) is retired; a ring-offset token is left`,
    label,
  );
}
