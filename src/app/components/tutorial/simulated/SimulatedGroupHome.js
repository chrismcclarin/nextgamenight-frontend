'use client';

import { MOCK_EVENTS, MOCK_GAMES } from '../mockData';

/**
 * Simulated GroupHome page for the tutorial.
 * Visually mimics the real GroupHomePage with header, calendar, and games list.
 * All elements are visual only -- no real functionality.
 */
export default function SimulatedGroupHome() {
  return (
    <div className="p-3 md:p-6 min-h-[500px]">
      {/* Breadcrumbs - matches real GroupHomePage */}
      <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
        <span className="text-accent font-medium">Home</span>
        <span className="text-content-muted mx-2">{'>'}</span>
        <span className="text-content-primary font-semibold">Friday Night Games</span>
      </nav>

      {/* Header - matches real GroupHomePage with dark gray default bg */}
      <div
        className="mb-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4 p-4 md:p-6 rounded-lg"
        style={{ backgroundColor: 'var(--color-surface-elevated)', minHeight: '120px' }}
      >
        <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface-card flex items-center justify-center text-2xl md:text-4xl flex-shrink-0 border-2 md:border-4 border-line shadow-lg">
            🎲
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-content-primary truncate">Friday Night Games</h1>
            <p className="text-content-secondary mt-1">4 games played &bull; 5 members</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full md:w-auto flex-shrink-0">
          <button
            className="btn btn-primary px-4 py-2 md:px-6 md:py-3 text-sm md:text-base whitespace-nowrap"
            onClick={() => {}}
          >
            Invite Member
          </button>
          <button
            data-tutorial="plan-session"
            className="btn btn-primary px-4 py-2 md:px-6 md:py-3 text-sm md:text-base whitespace-nowrap"
            onClick={() => {}}
          >
            Plan Game Session
          </button>
          <button
            data-tutorial="create-event"
            className="btn btn-primary px-4 py-2 md:px-6 md:py-3 text-sm md:text-base whitespace-nowrap"
            onClick={() => {}}
          >
            Add New Game Event
          </button>
        </div>
      </div>

      {/* Prompt Schedule section - matches real PromptScheduleSection collapsed state */}
      <div data-tutorial="prompt-schedule" className="mb-4">
        <button
          className="flex items-center gap-2 text-sm font-medium text-content-secondary"
          onClick={() => {}}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Prompt Schedule
        </button>
      </div>

      {/* Calendar section - compact like real GroupHomePage */}
      <div className="mb-6 bg-surface-card rounded-card shadow-theme-md border border-line p-4">
        <h3 className="text-lg font-semibold text-content-primary mb-3">Calendar</h3>
        <div className="space-y-2">
          {MOCK_EVENTS.map((event) => (
            <div
              key={event.id}
              className="flex justify-between items-start p-3 bg-surface-elevated rounded-lg border border-line"
            >
              <div>
                <h4 className="font-medium text-content-primary text-sm">{event.title}</h4>
                <p className="text-xs text-content-secondary mt-1">
                  🎮 {event.game} &mdash; {event.participants.join(', ')}
                </p>
              </div>
              <span className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-full whitespace-nowrap">
                {event.participants.length} going
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Group Games section - matches real GroupGamesList */}
      <div>
        <h2 className="text-2xl font-bold text-content-primary mb-4">Group Games</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MOCK_GAMES.map((game) => (
            <div
              key={game.id}
              className="block bg-surface-card border border-line rounded-card p-4 hover:shadow-theme-lg transition-shadow cursor-default"
            >
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-surface-elevated rounded flex items-center justify-center text-2xl flex-shrink-0">
                  🎲
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-content-primary mb-1 truncate">{game.name}</h3>
                  <div className="text-sm text-content-secondary space-y-1">
                    <p>Played <span className="font-semibold">{game.playCount}</span> {game.playCount === 1 ? 'time' : 'times'}</p>
                    <p>Last played: {game.lastPlayed}</p>
                    <p>Rating: <span className="font-semibold text-status-warning">{game.rating}/5</span></p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
