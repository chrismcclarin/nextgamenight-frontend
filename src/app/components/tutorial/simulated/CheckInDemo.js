'use client';

/**
 * CheckInDemo — Step 2 of 6: "Two ways to fill the heatmap."
 *
 * Shows the two flows for getting availability data into the heatmap:
 *   A. Members set it themselves (self-serve via app or magic link)
 *   B. You send a check-in (email — SMS is opt-in for select users so
 *      it's left out of onboarding)
 *
 * Then a recurring-schedule card slides in to communicate the automation
 * available for the second flow.
 *
 * Email mock content mirrors production exactly:
 *   Subject: "{Group} - {Game} - When are you available?"
 *   Body:    "{Group} is planning a {Game} session. Let us know when
 *             you're free this week."
 *   CTA:     "When Can You Play?"
 *
 * Stage progression:
 *   0 - all hidden
 *   1 - both path cards (self-serve + check-in) fade in
 *   2 - recurring schedule card slides in below
 *   3 - settled (timer-driven advance handled by parent)
 */
export default function CheckInDemo({ stage }) {
  return (
    <div className="text-center space-y-3">
      {/* Path A: Member self-serve.
          Mocks a tiny availability-grid header so users see "members can
          do this on their own" as a peer to the check-in path, not just a
          consequence of one. */}
      <div
        className="bg-surface-card border border-line rounded-card shadow-theme-md max-w-md mx-auto text-left transition-all duration-700"
        style={{
          opacity: stage >= 1 ? 1 : 0,
          transform: stage >= 1 ? 'translateY(0)' : 'translateY(6px)',
        }}
      >
        <div className="px-4 pt-3 pb-1 border-b border-line">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-content-muted mb-1">
            Members set their own availability
          </div>
          <div className="text-sm font-bold text-content-primary">
            When are you available?
          </div>
          <div className="text-xs text-content-muted mb-2">
            Group: Tabletop Crew
          </div>
        </div>
        {/* Tiny grid hint — three colored cells suggest the paint UI without
            re-rendering the full grid (that's Step 3). */}
        <div className="px-4 py-2 flex items-center gap-1.5">
          <div className="w-6 h-3 rounded-sm bg-green-300 border border-green-400" />
          <div className="w-6 h-3 rounded-sm bg-green-300 border border-green-400" />
          <div className="w-6 h-3 rounded-sm bg-green-300 border border-green-400" />
          <div className="w-6 h-3 rounded-sm bg-surface-elevated border border-line" />
          <div className="w-6 h-3 rounded-sm bg-surface-elevated border border-line" />
          <span className="text-xs text-content-muted ml-2">in the app, anytime</span>
        </div>
      </div>

      {/* Path B: Send a check-in.
          Email preview matching production AvailabilityPrompt template
          and promptInvitationService subject line. SMS removed (currently
          opt-in for select users only — leaving it in misrepresents the
          default product experience). */}
      <div
        className="bg-surface-card border border-line rounded-card shadow-theme-md max-w-md mx-auto text-left transition-all duration-700"
        style={{
          opacity: stage >= 1 ? 1 : 0,
          transform: stage >= 1 ? 'translateY(0)' : 'translateY(6px)',
          transitionDelay: stage >= 1 ? '200ms' : '0ms',
        }}
      >
        <div className="px-4 pt-3 pb-1 border-b border-line">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-content-muted mb-1">
            Or send them a check-in
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-btn-primary text-btn-primary-content flex items-center justify-center text-[10px] font-bold flex-shrink-0">
              NG
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-content-primary truncate">
                Tabletop Crew
              </div>
              <div className="text-xs text-content-muted truncate">
                Wingspan — When are you available?
              </div>
            </div>
            <span className="text-xs text-content-muted flex-shrink-0">now</span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm text-content-primary leading-snug mb-3">
            Hey Sarah!{' '}
            <span className="text-content-secondary">
              Tabletop Crew is planning a Wingspan session. Let us know when you&apos;re free this week.
            </span>
          </p>
          <button
            disabled
            className="text-sm font-medium text-btn-primary-content bg-btn-primary px-4 py-2 rounded-btn"
          >
            When Can You Play?
          </button>
        </div>
      </div>

      {/* Recurring schedule card — slides in below as the third beat to
          frame the automation around Path B. */}
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
