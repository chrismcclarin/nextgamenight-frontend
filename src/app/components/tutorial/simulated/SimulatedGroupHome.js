'use client';

import { useTour } from '@reactour/tour';
import { MOCK_EVENTS, MOCK_GAMES, MOCK_LIBRARY_GAMES } from '../mockData';

/**
 * Simulated GroupHome page for the tutorial.
 * Visually mimics the real GroupHomePage with header, tab bar, and content.
 * Tab display is driven by currentStep for automatic back-navigation support.
 * Steps 2-4 show Overview tab, steps 5-6 show Library tab.
 */
export default function SimulatedGroupHome() {
  const { currentStep, setCurrentStep } = useTour();
  const activeTab = currentStep >= 5 && currentStep <= 6 ? 'library' : 'overview';

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

      {/* Tab bar - matches real GroupHomePage tab styling */}
      <div className="flex border-b border-line mb-4">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
              : 'text-content-secondary hover:text-content-primary'
          }`}
          onClick={() => {}}
        >
          Overview
        </button>
        <button
          data-tutorial="library-tab"
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'library'
              ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
              : 'text-content-secondary hover:text-content-primary'
          }`}
          onClick={() => {
            // Action-triggered step: clicking Library tab advances the tour
            if (currentStep === 4) {
              setCurrentStep(5);
            }
          }}
        >
          Library
        </button>
      </div>

      {/* Overview tab content (steps 2-4) */}
      {activeTab === 'overview' && (
        <>
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
        </>
      )}

      {/* Library tab content (steps 5-6) */}
      {activeTab === 'library' && (
        <div data-tutorial="library-games">
          <div className="space-y-1">
            {MOCK_LIBRARY_GAMES.map((game) => (
              <div key={game.id} className="border border-line rounded-card overflow-hidden">
                <div className="w-full flex items-center gap-3 p-3 text-left" style={{ minHeight: '56px' }}>
                  <div className="w-10 h-10 bg-surface-elevated rounded flex items-center justify-center text-xl flex-shrink-0">
                    {game.imageEmoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-content-primary truncate text-sm">{game.name}</p>
                    <p className="text-xs text-content-muted truncate">
                      {game.playerCount} players &middot; {game.playTime}
                    </p>
                  </div>
                  <span className="text-xs text-content-muted flex-shrink-0 whitespace-nowrap">
                    {game.owner}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Add Game button */}
          <button
            data-tutorial="library-add-game"
            className="mt-4 w-full py-3 border-2 border-dashed border-line rounded-card text-sm font-medium text-content-secondary hover:text-content-primary hover:border-accent transition-colors"
            onClick={() => {}}
          >
            + Add Game to Library
          </button>
        </div>
      )}
    </div>
  );
}
