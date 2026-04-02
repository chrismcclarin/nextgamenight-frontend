'use client';

import { MOCK_GROUPS } from '../mockData';

/**
 * Simulated UserHome page for the tutorial.
 * Visually mimics the real UserHomePage + GroupList layout with static mock data.
 * Uses Tailwind classes matching the real GroupList component. All buttons are inert.
 */
export default function SimulatedUserHome() {
  return (
    <div className="user-home-container flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 min-h-[500px]">
      {/* Group list sidebar - matches real GroupList structure */}
      <div className="w-full md:w-auto md:flex-shrink-0 md:flex-[0_0_400px]">
        <div className="w-full max-w-[400px] bg-surface-page rounded-card p-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
            <h2 className="text-xl font-bold text-content-primary">Your Groups</h2>
            <button
              data-tutorial="create-group-btn"
              className="btn btn-primary text-sm whitespace-nowrap"
              onClick={() => {}}
            >
              + Create New Group
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 pb-8 flex flex-col gap-4">
            {MOCK_GROUPS.map((group) => (
              <div
                key={group.id}
                className="bg-surface-card rounded-card p-4 pl-5 shadow-theme-sm cursor-default transition-all duration-200 border border-line border-l-4 border-l-accent relative"
                style={{ backgroundColor: group.color }}
              >
                <div className="relative z-[1]">
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      {group.profilePic && (
                        <div className="w-10 h-10 rounded-full bg-surface-elevated flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
                          <span>{group.profilePic}</span>
                        </div>
                      )}
                      <h3 className="text-[1.1rem] font-semibold flex-1 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: '#fff' }}>{group.name}</h3>
                    </div>
                    <span className="bg-btn-primary text-btn-primary-text px-2.5 py-0.5 rounded-xl text-xs font-semibold ml-2">{group.memberCount} players</span>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    {group.players.map((player, i) => (
                      <span key={i} className="bg-surface-card-hover text-content-secondary px-2 py-1 rounded-md text-[0.8rem] border border-line">{player}</span>
                    ))}
                  </div>

                  <div className="border-t border-line pt-3">
                    <div className="text-sm mb-1" style={{ color: '#fff' }}>
                      <strong style={{ color: '#fff' }}>Last Game:</strong> {group.lastGame}
                    </div>
                    <div className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {group.lastGameDate}
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3 relative z-[2]">
                    <button
                      className="btn btn-primary text-sm flex-1 shadow-md"
                      onClick={() => {}}
                    >
                      Invite Member
                    </button>
                    <button
                      className="px-3 py-1 bg-surface-elevated text-content-primary rounded-btn hover:bg-surface-card-hover text-sm flex-shrink-0"
                      onClick={() => {}}
                    >
                      ⚙️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Invite friends area */}
          <div
            data-tutorial="invite-friends"
            className="mx-4 mb-4 p-3 border border-dashed border-line rounded-lg bg-surface-elevated"
          >
            <p className="text-sm font-medium text-content-secondary mb-2">Invite Friends</p>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">👥</span>
              <p className="text-xs text-content-secondary">Add from your friends list</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg">📱</span>
              <p className="text-xs text-content-secondary">Share a QR code to invite them</p>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar placeholder */}
      <div className="hidden md:block flex-1 min-w-0">
        <div className="bg-surface-card rounded-card shadow-theme-md border border-line p-4 h-full">
          <h3 className="text-lg font-semibold text-content-primary mb-3">Upcoming Events</h3>
          <div className="space-y-2">
            <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg">
              <p className="text-sm font-medium text-content-primary">Game Night - Friday 7pm</p>
              <p className="text-xs text-content-secondary">Catan with Alex, Jordan, Sam</p>
            </div>
            <div className="p-3 bg-status-success/10 border border-status-success/30 rounded-lg">
              <p className="text-sm font-medium text-content-primary">Weekend Boardgames</p>
              <p className="text-xs text-content-secondary">Wingspan with Taylor, Alex</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs text-content-muted py-1">
                {day}
              </div>
            ))}
            {Array.from({ length: 28 }).map((_, i) => (
              <div
                key={i}
                className={`text-center text-xs py-2 rounded ${
                  i === 11 || i === 13
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-content-secondary'
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
