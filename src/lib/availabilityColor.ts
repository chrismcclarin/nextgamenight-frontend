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
