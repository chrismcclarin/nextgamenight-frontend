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
 * ⚠️ DEAD CODE — DELETE AT END OF PHASE 88 (owner decision 2026-07-25).
 *
 * This yellow→orange→red ramp has NO live render path. It is reachable only through
 * `ReadCell`'s DEFAULT variant, and the sole caller of that default is
 * `app/components/HeatmapGrid.js` — which **nothing imports**. Verified 2026-07-25.
 *
 * Origin: it served the OLD tutorial heatmap. The Phase 73 tutorial rewrite replaced that
 * surface with production-matching greens (green-100..500) and orphaned this ramp.
 *
 * It is being left in place rather than removed now, deliberately: a full phase of Phase 88
 * work runs against it first, so nothing can be silently depending on it. **Delete at the end
 * of Phase 88** — see 88-SPEC.md "END-OF-PHASE DEAD-CODE GATE". The cluster to remove:
 *   - this function + its `describe` block in `availabilityColor.test.ts`
 *   - `app/components/HeatmapGrid.js` + `HeatmapGrid.test.tsx`
 *   - `ReadCell`'s default/intensity branch + the `IntensityReadCellProps` arm of its union
 *
 * DO NOT adopt this ramp for anything new. The canonical availability ramp is
 * `mergedCellColor` below — 5 steps, green-100 → green-500 (owner decision 2026-07-25).
 *
 * ---
 * Calculate color intensity based on participant count and preference weighting.
 * Extracted VERBATIM from HeatmapCell.js `getIntensityColor`.
 *
 * @param participantCount - Total number of available participants
 * @param preferredCount - Number of participants who marked as preferred
 * @param totalMembers - Total group members
 * @returns Tailwind CSS classes for background and border
 */
export function intensityColor(
  participantCount: number,
  preferredCount: number,
  totalMembers: number
): string {
  // Weight preferred 1.5x for intensity calculation only
  const weightedScore = participantCount + preferredCount * 0.5;
  const maxPossible = totalMembers * 1.5; // if all preferred
  const percentage = maxPossible > 0 ? (weightedScore / maxPossible) * 100 : 0;

  if (participantCount === 0) return 'bg-surface-elevated border-line';
  if (percentage <= 25) return 'bg-yellow-200 border-yellow-400';
  if (percentage <= 50) return 'bg-yellow-400 border-yellow-500';
  if (percentage <= 75) return 'bg-orange-400 border-orange-500';
  return 'bg-red-500 border-red-600';
}

/**
 * ★ CANONICAL AVAILABILITY RAMP — 5 steps, green-100 → green-500 (owner decision 2026-07-25).
 *
 * This is THE standard for "how many of the group is available in this slot?". Three surfaces
 * already agree on it: this function, `EventHeatmapBackground`'s legend swatches (:289-293,
 * hardcoded), and the tutorial's demo heatmap — matched deliberately in Phase 73 so that moving
 * from tutorial to product keeps one visual grammar.
 *
 * `EventScheduler.js:360-363` is the sole outlier: a 4-step ramp of ONE green at four alpha
 * levels, applied inline. Phase 88 moves it onto these 5 steps and these values. Note the step
 * count is a real visual change, not cosmetic — 4 buckets cut at 25/50/75%, 5 at 20/40/60/80%,
 * so identical data renders a different shade.
 *
 * Open question for Phase 88 planning, deliberately NOT decided here: EventScheduler is a
 * calendar, so availability is a wash BEHIND event blocks and gridlines, which its alpha ramp
 * lets show through — opaque `bg-green-300` would cover them. Whether the calendar keeps some
 * transparency is a visual call, and it interacts with Phase 88.3 (light mode), since opaque pale
 * greens and alpha-over-background behave very differently across themes.
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
