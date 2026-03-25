'use client';

import { MOCK_GROUPS } from '../mockData';

/**
 * Simulated UserHome page for the tutorial.
 * Visually mimics the real UserHomePage + GroupList layout with static mock data.
 * Uses the same CSS class names (.group-list-sidebar, .group-card, etc.) from GroupList.css
 * which is globally loaded. All buttons are inert -- no real functionality.
 */
export default function SimulatedUserHome() {
  return (
    <div className="user-home-container flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 min-h-[500px]">
      {/* Group list sidebar - matches real GroupList structure */}
      <div className="w-full md:w-auto md:flex-shrink-0 md:flex-[0_0_400px]">
        <div className="group-list-sidebar" style={{ height: 'auto' }}>
          <div className="sidebar-header">
            <h2>Your Groups</h2>
            <button
              data-tutorial="create-group-btn"
              className="create-group-btn"
              onClick={() => {}}
            >
              + Create New Group
            </button>
          </div>

          <div className="groups-container">
            {MOCK_GROUPS.map((group) => (
              <div
                key={group.id}
                className="group-card"
                style={{
                  backgroundColor: group.color,
                  cursor: 'default',
                }}
              >
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="group-header">
                    <div className="flex items-center gap-2">
                      {group.profilePic && (
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
                          <span>{group.profilePic}</span>
                        </div>
                      )}
                      <h3 className="group-name" style={{ color: '#fff' }}>{group.name}</h3>
                    </div>
                    <span className="player-count">{group.memberCount} players</span>
                  </div>

                  <div className="group-players">
                    {group.players.map((player, i) => (
                      <span key={i} className="player-tag">{player}</span>
                    ))}
                  </div>

                  <div className="last-game-info">
                    <div className="last-game" style={{ color: '#fff' }}>
                      <strong style={{ color: '#fff' }}>Last Game:</strong> {group.lastGame}
                    </div>
                    <div className="last-game-date" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {group.lastGameDate}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3" style={{ position: 'relative', zIndex: 2 }}>
                    <button
                      className="add-member-btn flex-1"
                      onClick={() => {}}
                      style={{
                        backgroundColor: '#28a745',
                        color: '#ffffff',
                        fontWeight: '600',
                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                      }}
                    >
                      Invite Member
                    </button>
                    <button
                      className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm flex-shrink-0"
                      onClick={() => {}}
                    >
                      ⚙️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* QR code join area */}
          <div
            data-tutorial="qr-join"
            className="mx-4 mb-4 p-3 border border-dashed border-gray-300 rounded-lg text-center bg-gray-50"
          >
            <div className="text-2xl mb-1">📱</div>
            <p className="text-sm text-gray-600">
              Have a QR code? Scan it to instantly join a group.
            </p>
          </div>
        </div>
      </div>

      {/* Calendar placeholder */}
      <div className="hidden md:block flex-1 min-w-0">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 h-full">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Upcoming Events</h3>
          <div className="space-y-2">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-900">Game Night - Friday 7pm</p>
              <p className="text-xs text-blue-700">Catan with Alex, Jordan, Sam</p>
            </div>
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-medium text-green-900">Weekend Boardgames</p>
              <p className="text-xs text-green-700">Wingspan with Taylor, Alex</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs text-gray-400 py-1">
                {day}
              </div>
            ))}
            {Array.from({ length: 28 }).map((_, i) => (
              <div
                key={i}
                className={`text-center text-xs py-2 rounded ${
                  i === 11 || i === 13
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'text-gray-600'
                }`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
