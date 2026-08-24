// src/lib/availabilityColor.ts
//
// Phase 82 (C-009 / TEST-04): the availability-ratio→Tailwind-color logic was
// inline and DIVERGENT across two heatmap cells. Extracted here VERBATIM as two
// separate pure functions so they are unit-testable (Plan 82-03 pins the exact
// class-string outputs).
//
// Assumption A5 — do NOT converge the two color schemes. Convergence is PRIM-01's
// job in Phase 84. These are extracted as-is to preserve current behavior bit-for-bit.

/**
 * DECISION Phase 88-31 (SPEC "END-OF-PHASE DEAD-CODE GATE"): THE SECOND RAMP IS GONE.
 *
 * A yellow→orange→red intensity ramp used to live here, exported as a sibling of
 * `mergedCellColor` below. It served the OLD tutorial heatmap; the Phase 73 tutorial rewrite
 * replaced that surface with production-matching greens and orphaned it. Its only render path
 * ran through the shared read cell's DEFAULT variant, whose only caller was a legacy read-grid
 * component that nothing imported (verified 2026-07-25, and re-verified immediately before the
 * deletion — see below).
 *
 * THE DELAY WAS THE POINT, and it is worth keeping because it is the reusable part. The owner
 * ruled on 2026-07-25 to leave it in place and delete it at the END of the phase, so that a
 * full phase of design-system work ran against the cluster first and proved nothing had
 * quietly grown a dependency on it. Deleting on the day it was identified would have proved
 * only that nothing imported it that morning.
 *
 * Re-verified before deleting rather than trusted from the 2026-07-25 note: the census was run
 * WORD-BOUNDED, because the SPEC's own bare pattern is a substring of the LIVE
 * `MergedHeatmapGrid` (itself live at the time; DELETED by plan 88.1-16) and matches ~10 live
 * files. Every surviving hit was a comment, a type arm
 * or a test mention; not one was a live import or call.
 *
 * Deleted together, as one commit, because they only typecheck together: this function, its
 * `describe` block in `availabilityColor.test.ts`, the legacy read-grid component and its test,
 * the read cell's default/intensity branch and the intensity arm of its props union, and — the
 * item the SPEC's own list missed — the matching arm of `WeekGrid`'s read-data union.
 *
 * THE CANONICAL AVAILABILITY RAMP IS `mergedCellColor` BELOW — 5 steps, green-100 → green-500
 * (owner decision 2026-07-25). Re-introducing a second ramp is a design decision, not a
 * convenience; the whole point of PRIM-01 was that two divergent ramps existed and one had to
 * win.
 */

/**
 * ★ CANONICAL AVAILABILITY RAMP — 5 steps, green-100 → green-500 (owner decision 2026-07-25).
 *
 * This is THE standard for "how many of the group is available in this slot?". Three surfaces
 * already agree on it: this function, `EventHeatmapBackground`'s legend swatches (:289-293,
 * hardcoded), and the tutorial's demo heatmap — matched deliberately in Phase 73 so that moving
 * from tutorial to product keeps one visual grammar.
 *
 * `EventScheduler.js` used to be a fourth ramp: 4 steps of ONE green at four alpha levels, cut at
 * 25/50/75%, applied inline. Plan 88-23 moved it onto these 5 steps, these thresholds and this hue
 * — as the `calendarWashColor` VARIANT below, which keeps transparency (owner ruling 2026-08-05;
 * the wash sits behind gridlines and event blocks). The step count was a real visual change, not
 * cosmetic — 4 buckets cut at 25/50/75%, 5 at 20/40/60/80%, so identical data renders a different
 * shade than it did before Phase 88.
 *
 * The transparency question that used to be flagged open here is now CLOSED — see the
 * `DECISION Phase 88-23` block on `calendarWashColor`. Its interaction with Phase 88.3 (light
 * mode) still stands as a thing to re-test there: opaque pale greens and alpha-over-background
 * behave very differently across themes, and the calendar is now the alpha case.
 *
 * Also note: these are RAW palette classes, not semantic tokens. Phase 88 Req 2's "semantic
 * tokens only" rule implicates this function itself, not just EventScheduler's rgba() literals.
 *
 * ---
 * Get Tailwind color classes based on availability ratio.
 * Green gradient: darker = more members available.
 * Extracted VERBATIM from MergedHeatmapCell.js `getCellStyle`.
 *
 * @param availableCount - Number of available members
 * @param totalMembers - Total group members
 * @returns Tailwind CSS classes for background and text
 */
export function mergedCellColor(availableCount: number, totalMembers: number): string {
  if (totalMembers === 0 || availableCount === 0) return 'bg-surface-elevated text-content-muted';
  const ratio = availableCount / totalMembers;
  if (ratio <= 0.2) return 'bg-green-100 text-green-800';
  if (ratio <= 0.4) return 'bg-green-200 text-green-800';
  if (ratio <= 0.6) return 'bg-green-300 text-green-900';
  if (ratio <= 0.8) return 'bg-green-400 text-green-900';
  return 'bg-green-500 text-white';
}

/**
 * DECISION Phase 88-23 DES-02: the calendar keeps a TRANSLUCENT wash, derived from the canonical
 * ramp — rejected alternative: consuming `mergedCellColor` directly (fully opaque `bg-green-100..500`).
 *
 * WHY the rejected option was rejected: in `EventScheduler` the availability shading is a wash
 * painted BEHIND react-big-calendar's gridlines and event blocks. Opaque pale greens cover both at
 * ---
 * ALLOW-LISTED PROSE (Phase 88.1-16, SPEC Req 9): plan 88.1-16 removed react-big-calendar from
 * the tree, and this block's two mentions of it were DELIBERATELY LEFT IN PLACE. The name is what
 * carries the reason — "translucent, because it was painted behind THOSE gridlines and event
 * blocks" — and the rejected alternative (consuming `mergedCellColor`'s opaque
 * `bg-green-100..500` directly) is unintelligible without it. Req 9's literal `grep 'rbc-'` = 0
 * acceptance was rewritten rather than satisfied by erasing this; the executable allow-list is
 * `src/app/reactBigCalendarRemoval.test.ts` and it names this file with this reason. Deleting the
 * word to make a grep go green is the anti-pattern that gate exists to prevent — and this file's
 * own banner already says re-unifying the ramps is "a design decision, not a convenience."
 * The successor surface is WeekGrid, which has gridlines of its own, so the property still holds.
 * ---
 * the darker steps, turning a background signal into a fill that hides the very events the user is
 * scheduling around. Transparency is a deliberate property of a calendar surface here, not drift.
 * Owner ruling 2026-08-05 (Task 1 of plan 88-23), option-a.
 *
 * This is therefore a recorded VARIANT of the canonical ramp, not a fourth ramp: it converges on
 * the two things Req 2 (DES-02) is actually about — the HUE and the STEP COUNT/THRESHOLDS. What it
 * does NOT converge on is opacity. **Do not "unify" this onto `mergedCellColor` as a cleanup.**
 *
 * Derivation (so the five alphas are reproducible, not hand-picked):
 *   1. Take the canonical ramp's own RGB values, green-100 → green-500, as `CANONICAL_GREEN_RAMP_RGB`
 *      below. The wash hue is the LAST entry of that same array (green-500), so the wash cannot
 *      drift to a different green than the one `mergedCellColor` ends on.
 *   2. Measure each step's darkness against white as `255 - luma`, using Rec. 709 luma coefficients.
 *      This is the ramp's own perceptual spacing — green-100 → green-200 is a small step, green-300
 *      → green-400 a large one, and the wash inherits that shape rather than a flat linear ladder.
 *   3. Normalize so green-100 → 0 and green-500 → 1.
 *   4. Map that onto the SHIPPED alpha window [0.15, 0.55]. Both endpoints are retained on purpose:
 *      0.15 is the shipped lightest and is known to be visible over the calendar background, and
 *      0.55 is the shipped darkest and is known to still let an event block read through it. A
 *      naive "green-500 = alpha 1.0" derivation would have made the top step fully opaque, which
 *      is exactly the outcome the owner rejected.
 *
 * Yields: 0.15, 0.21, 0.29, 0.42, 0.55 (deltas 0.06 / 0.08 / 0.13 / 0.13 — monotonic, and tighter
 * at the low end than the old 4-step ladder because five steps now share the same alpha window).
 *
 * Replaces (plan 88-23, Task 2) EventScheduler's private inline 4-step ladder of green-500 at
 * alpha .15/.25/.4/.55 cut at 25/50/75%. Identical data therefore renders a different shade than
 * it did before — that is the intended, recorded consequence of moving 4 buckets to 5.
 *
 * Exact output strings are pinned by tests — do NOT reformat the `rgba(...)` spacing.
 */
const CANONICAL_GREEN_RAMP_RGB = [
  [220, 252, 231], // green-100 #dcfce7
  [187, 247, 208], // green-200 #bbf7d0
  [134, 239, 172], // green-300 #86efac
  [74, 222, 128], // green-400 #4ade80
  [34, 197, 94], // green-500 #22c55e — also the wash hue
] as const;

const WASH_ALPHA_FLOOR = 0.15;
const WASH_ALPHA_CEILING = 0.55;

/** Rec. 709 luma of an sRGB triple, 0-255. */
function luma([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The five wash colours, lightest → darkest, derived from `CANONICAL_GREEN_RAMP_RGB`.
 *
 * Exported so the EventScheduler legend can render its swatches FROM the same array the ramp
 * indexes into. A legend built from hand-copied literals is free to desync from the ramp it
 * claims to describe, and no grep gate can see that — the previous 4-swatch legend was correct
 * only by coincidence of maintenance.
 */
export const CALENDAR_WASH_RAMP: readonly string[] = (() => {
  const darkness = CANONICAL_GREEN_RAMP_RGB.map((rgb) => 255 - luma(rgb));
  const lightest = darkness[0];
  const darkest = darkness[darkness.length - 1];
  const [hueR, hueG, hueB] = CANONICAL_GREEN_RAMP_RGB[CANONICAL_GREEN_RAMP_RGB.length - 1];

  return darkness.map((d) => {
    const normalized = (d - lightest) / (darkest - lightest);
    const alpha = WASH_ALPHA_FLOOR + (WASH_ALPHA_CEILING - WASH_ALPHA_FLOOR) * normalized;
    return `rgba(${hueR}, ${hueG}, ${hueB}, ${Math.round(alpha * 100) / 100})`;
  });
})();

/**
 * Get the calendar wash background for an availability ratio — the translucent sibling of
 * `mergedCellColor`, same 5 steps and same 20/40/60/80% thresholds.
 *
 * Returns a CSS colour string rather than Tailwind classes because the consumer WAS
 * react-big-calendar's `slotPropGetter`, which took an inline `style` object. Since the
 * Phase 88.1 rebuild the consumer is WeekGrid's read-cell style (via `EventScheduler`'s
 * `getCell`), which takes the same shape — so the return type survived the swap unchanged
 * and this is still not a place to hand back Tailwind classes. Returns
 * `undefined` (not a colour) for the empty case, preserving EventScheduler's existing behaviour
 * of applying NO `backgroundColor` at all when nobody is available — an explicit transparent
 * fill would still stack a paint layer over the gridlines.
 *
 * @param availableCount - Number of available members
 * @param totalMembers - Total group members
 * @returns an `rgba()` string, or `undefined` when there is nothing to shade
 */
export function calendarWashColor(
  availableCount: number,
  totalMembers: number
): string | undefined {
  if (totalMembers <= 0 || availableCount <= 0) return undefined;
  const ratio = availableCount / totalMembers;
  if (ratio <= 0.2) return CALENDAR_WASH_RAMP[0];
  if (ratio <= 0.4) return CALENDAR_WASH_RAMP[1];
  if (ratio <= 0.6) return CALENDAR_WASH_RAMP[2];
  if (ratio <= 0.8) return CALENDAR_WASH_RAMP[3];
  return CALENDAR_WASH_RAMP[4];
}

/**
 * Get the write-cell background class for an availability preference enum (D-05).
 * Lifted VERBATIM from TimeSlotCell.js `getBackgroundColor` (the `preferred`,
 * `if-need-be`, and null branches) so the single source of truth for write-grid
 * colors lives here. The disabled branch returns the FULL UI-SPEC string
 * (`bg-surface-elevated opacity-50 cursor-not-allowed`) — TimeSlotCell historically
 * applied the opacity/cursor classes separately in element styling; consolidating
 * them here means the write cell consumes one class string (WriteCell wiring in 84-05).
 *
 * Byte-identical output is pinned by tests — do NOT route these strings through
 * `tailwind-merge`/`cn` (it would reorder/dedupe and break the pinned strings).
 *
 * @param preference - 'preferred' | 'if-need-be' | null (unselected)
 * @param disabled - when true, returns the disabled string regardless of preference
 * @returns Tailwind CSS background/state classes for the write cell
 */
export function preferenceColor(
  preference: 'preferred' | 'if-need-be' | null,
  disabled = false
): string {
  if (disabled) return 'bg-surface-elevated opacity-50 cursor-not-allowed';
  if (preference === 'preferred') return 'bg-green-300';
  if (preference === 'if-need-be') return 'bg-yellow-300';
  return 'bg-surface-elevated hover:bg-surface-card-hover';
}
