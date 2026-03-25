/**
 * Static mock data for tutorial simulated pages.
 * These values never change -- they exist purely for visual demonstration.
 */

export const MOCK_GROUPS = [
  {
    id: 1,
    name: 'Friday Night Games',
    memberCount: 5,
    color: '#3B82F6',
    profilePic: '🎲',
    players: ['Alex', 'Jordan', 'Sam', 'Taylor'],
    lastGame: 'Catan',
    lastGameDate: 'Mar 21, 2026',
  },
  {
    id: 2,
    name: 'The Settlers',
    memberCount: 3,
    color: '#10B981',
    profilePic: '🏰',
    players: ['Jordan', 'Riley'],
    lastGame: 'Ticket to Ride',
    lastGameDate: 'Mar 18, 2026',
  },
];

export const MOCK_PLAYERS = [
  { id: 1, name: 'Alex' },
  { id: 2, name: 'Jordan' },
  { id: 3, name: 'Sam' },
  { id: 4, name: 'Taylor' },
];

export const MOCK_GAMES = [
  { id: 1, name: 'Catan', playCount: 8, lastPlayed: 'Mar 21, 2026', rating: '4.2' },
  { id: 2, name: 'Ticket to Ride', playCount: 5, lastPlayed: 'Mar 18, 2026', rating: '4.5' },
  { id: 3, name: 'Wingspan', playCount: 3, lastPlayed: 'Mar 14, 2026', rating: '4.8' },
  { id: 4, name: 'Azul', playCount: 2, lastPlayed: 'Mar 10, 2026', rating: '3.9' },
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
