'use client';

/**
 * CheckInDemo — Step 2 of 6.
 *
 * Answers the obvious question after Step 1: "How will my group know to
 * fill out their availability?" Shows the actual email format Nextgamenight
 * sends — subject line, body, "When Can You Play?" CTA — alongside a
 * sample SMS preview to communicate that members can opt for either
 * channel. Then slides in a recurring-schedule card to show the
 * automation.
 *
 * Mock content mirrors production exactly:
 *   Email subject:  "{Group} - {Game} - When are you available?"
 *   Email body:     "{Group} is planning a {Game} session! Let us know
 *                    when you're free this week."
 *   Email CTA:      "When Can You Play?"
 *   SMS template:   "NextGameNight: {Group} wants to schedule a game.
 *                    Share your availability: {url}"
 *
 * Stage progression:
 *   0 - all hidden
 *   1 - email + SMS previews fade in
 *   2 - recurring schedule card slides in below
 *   3 - settled (timer-driven advance handled by parent)
 */
export default function CheckInDemo({ stage }) {
  return (
    <div className="text-center space-y-4">
      {/* Email preview — matches production AvailabilityPrompt template */}
      <div
        className="bg-surface-card border border-line rounded-card shadow-theme-md max-w-md mx-auto text-left transition-all duration-700"
        style={{
          opacity: stage >= 1 ? 1 : 0,
          transform: stage >= 1 ? 'translateY(0)' : 'translateY(6px)',
        }}
      >
        {/* Email header — sender + subject */}
        <div className="px-4 py-3 border-b border-line flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-btn-primary text-btn-primary-content flex items-center justify-center text-xs font-bold flex-shrink-0">
            NG
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-content-primary truncate">
                Tabletop Crew
              </span>
              <span className="text-xs text-content-muted flex-shrink-0">now</span>
            </div>
            <div className="text-xs text-content-muted truncate">
              Wingspan — When are you available?
            </div>
          </div>
        </div>

        {/* Email body */}
        <div className="px-4 py-3">
          <p className="text-sm text-content-primary leading-snug mb-3">
            Hey Sarah! <span className="text-content-secondary">Tabletop Crew is planning a Wingspan session. Let us know when you&apos;re free this week.</span>
          </p>
          <button
            disabled
            className="text-sm font-medium text-btn-primary-content bg-btn-primary px-4 py-2 rounded-btn"
          >
            When Can You Play?
          </button>
        </div>
      </div>

      {/* SMS preview — matches production smsService availability_prompt template.
          Sits beside the email in copy: "or via text — they pick the channel". */}
      <div
        className="max-w-md mx-auto transition-all duration-700"
        style={{
          opacity: stage >= 1 ? 1 : 0,
          transform: stage >= 1 ? 'translateY(0)' : 'translateY(6px)',
          transitionDelay: stage >= 1 ? '200ms' : '0ms',
        }}
      >
        <div className="bg-surface-card-hover border border-line rounded-card px-4 py-3 text-left">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-content-primary">SMS</span>
            <span className="text-xs text-content-muted">now</span>
          </div>
          <p className="text-sm text-content-primary leading-snug">
            <span className="font-medium">NextGameNight:</span>{' '}
            Tabletop Crew wants to schedule a game. Share your availability: <span className="text-content-link">nxt.gn/wHk2A</span>
          </p>
        </div>
      </div>

      {/* Recurring schedule card — slides in below. Frames the automation. */}
      <div
        className="transition-all duration-500"
        style={{
          opacity: stage >= 2 ? 1 : 0,
          transform: stage >= 2 ? 'translateY(0)' : 'translateY(8px)',
          maxHeight: stage >= 2 ? '120px' : '0px',
          overflow: 'hidden',
        }}
      >
        <div className="bg-surface-card border border-line rounded-card max-w-md mx-auto p-3 inline-flex items-center gap-3">
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
