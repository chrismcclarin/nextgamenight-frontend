'use client';

/**
 * CheckInDemo — Step 2 of 6.
 *
 * Answers the obvious question after Step 1: "How will my group know to
 * fill out their availability?" Shows a faux SMS/email preview that
 * arrives in their inbox, plus the recurring-schedule option for groups
 * that play regularly. Frames check-ins as a low-friction message, not
 * a chore.
 *
 * Stage progression:
 *   0 - phone preview empty
 *   1 - message bubble + tap CTA fade in
 *   2 - recurring schedule card slides in below
 *   3 - both visible, settled
 */
export default function CheckInDemo({ stage }) {
  return (
    <div className="text-center">
      {/* Faux message preview — looks like a phone notification */}
      <div
        className="bg-surface-card border border-line rounded-card shadow-theme-md max-w-sm mx-auto p-4 transition-all duration-500"
        style={{
          opacity: stage >= 1 ? 1 : 0,
          transform: stage >= 1 ? 'translateY(0)' : 'translateY(8px)',
        }}
      >
        <div className="flex items-start gap-3 text-left">
          {/* Avatar circle */}
          <div className="w-10 h-10 rounded-full bg-btn-primary text-btn-primary-content flex items-center justify-center text-sm font-semibold flex-shrink-0">
            NG
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold text-content-primary">
                Nextgamenight
              </span>
              <span className="text-[10px] text-content-muted">now</span>
            </div>
            <p className="text-sm text-content-secondary mb-2">
              Hey! When are you free this week?
            </p>
            <button
              disabled
              className="text-xs font-medium text-btn-primary-content bg-btn-primary px-3 py-1.5 rounded-btn"
            >
              Tap to respond →
            </button>
          </div>
        </div>
      </div>

      {/* Recurring schedule card — slides in below */}
      <div
        className="mt-4 transition-all duration-500"
        style={{
          opacity: stage >= 2 ? 1 : 0,
          transform: stage >= 2 ? 'translateY(0)' : 'translateY(8px)',
          maxHeight: stage >= 2 ? '120px' : '0px',
          overflow: 'hidden',
        }}
      >
        <div className="bg-surface-card border border-line rounded-card max-w-sm mx-auto p-3 inline-flex items-center gap-3">
          {/* Calendar icon */}
          <div className="w-9 h-9 rounded-btn bg-surface-elevated border border-line flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-content-secondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-content-primary">
              Every Sunday · 6 PM
            </div>
            <div className="text-xs text-content-secondary">
              Auto-sends to your group
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
