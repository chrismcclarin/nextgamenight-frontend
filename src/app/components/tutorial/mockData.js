/**
 * Static mock data for tutorial simulated pages.
 * These values never change -- they exist purely for visual demonstration.
 */

export const MOCK_GROUPS = [
  { id: 1, name: 'Friday Night Games', memberCount: 5, color: '#3B82F6' },
  { id: 2, name: 'The Settlers', memberCount: 3, color: '#10B981' },
];

export const MOCK_PLAYERS = [
  { id: 1, name: 'Alex' },
  { id: 2, name: 'Jordan' },
  { id: 3, name: 'Sam' },
  { id: 4, name: 'Taylor' },
];

export const MOCK_GAMES = [
  { id: 1, name: 'Catan', playerCount: '3-4' },
  { id: 2, name: 'Ticket to Ride', playerCount: '2-5' },
  { id: 3, name: 'Wingspan', playerCount: '1-5' },
  { id: 4, name: 'Azul', playerCount: '2-4' },
];

export const MOCK_EVENTS = [
  { id: 1, title: 'Game Night - Friday 7pm', game: 'Catan', date: 'This Friday', participants: ['Alex', 'Jordan', 'Sam'] },
  { id: 2, title: 'Weekend Boardgames', game: 'Wingspan', date: 'Saturday 2pm', participants: ['Taylor', 'Alex'] },
];

// Pre-filled heatmap data: 7 days x 6 time slots (4pm-10pm)
export const MOCK_AVAILABILITY = {
  timeSlots: ['4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM'],
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  // Overlap counts (0-4 people available)
  data: [
    [0, 0, 1, 2, 3, 2, 1],  // 4pm
    [0, 1, 2, 3, 4, 3, 2],  // 5pm
    [1, 2, 3, 4, 4, 3, 2],  // 6pm
    [2, 3, 4, 4, 3, 2, 1],  // 7pm
    [1, 2, 3, 3, 2, 1, 0],  // 8pm
    [0, 1, 1, 2, 1, 0, 0],  // 9pm
  ],
};
