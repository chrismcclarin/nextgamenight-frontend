/**
 * Static mock data for tutorial simulated pages.
 * These values never change -- they exist purely for visual demonstration.
 *
 * Phase 73 (ONBD-04) trimmed this file: the only consumer of MOCK_AVAILABILITY
 * is HeatmapReveal. SimulatedUserHome / SimulatedGroupHome / SimulatedAvailability
 * were deleted as part of the tutorial gut-and-rewrite, so the MOCK_GROUPS /
 * MOCK_PLAYERS / MOCK_GAMES / MOCK_EVENTS / MOCK_LIBRARY_GAMES exports were
 * removed with them.
 */

// Pre-filled heatmap data: 7 days x 6 time slots (4pm-9pm)
// data[rowIdx][colIdx] where colIdx 0=Mon, 1=Tue, ..., 4=Fri, ..., 6=Sun.
// data[3][4] (7pm Fri) intentionally set to 4 to anchor the reveal copy
// "Friday night, 7pm. Everyone's in." (chosen over rewriting copy because
// Friday is the cultural shorthand for game night).
export const MOCK_AVAILABILITY = {
  timeSlots: ['4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM'],
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  // Overlap counts (0-4 people available)
  data: [
    [0, 0, 1, 2, 3, 2, 1],  // 4pm
    [0, 1, 2, 3, 4, 3, 2],  // 5pm
    [1, 2, 3, 4, 4, 3, 2],  // 6pm
    [2, 3, 4, 4, 4, 2, 1],  // 7pm  -- Fri 7pm bumped 3 -> 4 (the hot spot)
    [1, 2, 3, 3, 3, 1, 0],  // 8pm  -- Fri 8pm bumped 2 -> 3 for gradient
    [0, 1, 1, 2, 1, 0, 0],  // 9pm
  ],
};
