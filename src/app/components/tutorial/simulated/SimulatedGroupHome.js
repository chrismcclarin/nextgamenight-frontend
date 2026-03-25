'use client';

import { MOCK_EVENTS, MOCK_GAMES } from '../mockData';

/**
 * Simulated GroupHome page for the tutorial.
 * Visually mimics the real GroupHomePage with event list and ballot section.
 * All elements are visual only -- no real functionality.
 */
export default function SimulatedGroupHome() {
  // Fake vote tallies for the ballot
  const votingGames = [
    { ...MOCK_GAMES[0], votes: 3 },
    { ...MOCK_GAMES[1], votes: 2 },
    { ...MOCK_GAMES[2], votes: 4 },
    { ...MOCK_GAMES[3], votes: 1 },
  ];

  return (
    <div className="p-3 md:p-6 min-h-[500px]">
      {/* Breadcrumbs */}
      <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
        <span className="text-blue-400 font-medium">Home</span>
        <span className="text-gray-400 mx-2">{'>'}</span>
        <span className="text-white font-semibold">Friday Night Games</span>
      </nav>

      {/* Header */}
      <div
        className="mb-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4 p-4 md:p-6 rounded-lg"
        style={{ backgroundColor: '#3B82F6', minHeight: '100px' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-2xl border-4 border-white shadow-lg">
            🎲
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Friday Night Games</h1>
            <p className="text-blue-100 mt-1">4 games played -- 5 members</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            data-tutorial="create-event"
            className="bg-blue-800 text-white px-4 py-2 md:px-6 md:py-3 rounded-lg font-semibold hover:bg-blue-900 transition-colors text-sm md:text-base whitespace-nowrap border-2 border-white"
            style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)' }}
            onClick={() => {}}
          >
            Add New Game Event
          </button>
        </div>
      </div>

      {/* Events list */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Upcoming Events</h3>
        <div className="space-y-3">
          {MOCK_EVENTS.map((event) => (
            <div
              key={event.id}
              className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium text-gray-900">{event.title}</h4>
                  <p className="text-sm text-gray-600 mt-1">
                    🎮 {event.game} -- {event.date}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {event.participants.join(', ')}
                  </p>
                </div>
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                  {event.participants.length} going
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ballot / Game Voting section */}
      <div
        data-tutorial="game-voting"
        className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Game Vote</h3>
          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
            Active
          </span>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          What should we play this Friday?
        </p>
        <div className="space-y-2">
          {votingGames
            .sort((a, b) => b.votes - a.votes)
            .map((game) => (
              <div key={game.id} className="flex items-center gap-3">
                <div className="flex-1 bg-gray-50 rounded-lg overflow-hidden">
                  <div
                    className="bg-blue-500 text-white text-xs px-3 py-2 rounded-lg font-medium"
                    style={{ width: `${(game.votes / 5) * 100}%`, minWidth: 'fit-content' }}
                  >
                    {game.name}
                  </div>
                </div>
                <span className="text-sm text-gray-600 font-medium w-8 text-right">
                  {game.votes}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
