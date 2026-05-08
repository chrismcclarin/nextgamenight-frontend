/**
 * Static mock data for tutorial simulated pages.
 *
 * Phase 73 (ONBD-04) rewrite: tutorial now teaches the system, not just shows
 * a pretty animation. Mock data must match production density (30-min slots,
 * green color scale) so users recognize the real heatmap when they arrive.
 *
 * Grid is intentionally smaller than production (5pm-8:30pm × 7 days = 7×8)
 * so the demo is legible inside the tutorial overlay. Density matches the
 * real AvailabilityGrid / MergedHeatmap.
 */

// 8 time slots: 5:00, 5:30, 6:00, 6:30, 7:00, 7:30, 8:00, 8:30 PM
export const TUTORIAL_TIME_SLOTS = [
  '5:00 PM',
  '5:30 PM',
  '6:00 PM',
  '6:30 PM',
  '7:00 PM',
  '7:30 PM',
  '8:00 PM',
  '8:30 PM',
];

// 7 days starting Monday
export const TUTORIAL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Single-user availability animation for Step 2 (AvailabilityPromptDemo).
 *
 * Cells the user "drags" across to mark themselves as available. This is the
 * range Fri 6:00 PM - 8:30 PM (rows 2-7, col 4). Animates as a single drag
 * gesture so users see how the click-drag paint mechanic works in production.
 *
 * Each entry: [rowIndex, colIndex] where colIndex 4 = Friday.
 */
export const AVAILABILITY_DRAG_PATH = [
  [2, 4], // Fri 6:00 PM
  [3, 4], // Fri 6:30 PM
  [4, 4], // Fri 7:00 PM
  [5, 4], // Fri 7:30 PM
  [6, 4], // Fri 8:00 PM
  [7, 4], // Fri 8:30 PM
];

/**
 * Group merged availability for Step 3 (HeatmapDemo).
 *
 * Density values 0-5 matching the real MergedHeatmap LEGEND_ITEMS scale:
 *   0 -> bg-surface-elevated (nobody)
 *   1 -> bg-green-100
 *   2 -> bg-green-200
 *   3 -> bg-green-300
 *   4 -> bg-green-400
 *   5 -> bg-green-500 (whole group available)
 *
 * Indexing: data[rowIdx][colIdx] where colIdx 4 = Friday.
 * Friday 7:00-8:00 PM (rows 4-6, col 4) is the engineered peak (5/5 available)
 * because that's the slot the schedule demo will drag across in Step 4.
 */
export const HEATMAP_DENSITY = [
  // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  [0, 0, 1, 1, 2, 1, 0], // 5:00 PM
  [0, 1, 1, 2, 3, 2, 1], // 5:30 PM
  [1, 1, 2, 3, 4, 2, 1], // 6:00 PM
  [1, 2, 3, 3, 4, 3, 2], // 6:30 PM
  [2, 3, 3, 4, 5, 3, 2], // 7:00 PM ← peak
  [2, 3, 4, 4, 5, 3, 1], // 7:30 PM ← peak
  [1, 2, 3, 3, 5, 2, 1], // 8:00 PM ← peak
  [1, 2, 2, 3, 4, 2, 0], // 8:30 PM
];

/**
 * Schedule drag path for Step 4 (ScheduleDemo).
 *
 * The user "drags" across Fri 7:00 PM - 8:00 PM (rows 4-6, col 4) on the
 * heatmap to define a 1.5-hour event window. Same drag mechanic as
 * AVAILABILITY_DRAG_PATH but on the heatmap surface and with a different
 * outcome (event creation, not availability).
 */
export const SCHEDULE_DRAG_PATH = [
  [4, 4], // Fri 7:00 PM
  [5, 4], // Fri 7:30 PM
  [6, 4], // Fri 8:00 PM
];

/**
 * Legacy export kept for backwards-compat with anything still importing it.
 * The tutorial rewrite no longer reads this — kept just in case.
 */
export const MOCK_AVAILABILITY = {
  timeSlots: TUTORIAL_TIME_SLOTS,
  days: TUTORIAL_DAYS,
  data: HEATMAP_DENSITY,
};
