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
/* DECISION Phase 88.6-35 (UI-SPEC §4.5): the three simulated PRIMARY STRINGS in this file —
   the email sender name, the email CTA label and the recurring-schedule line — take 700, chosen
   OVER §4.5's emphasis outcome (400 + a colour token), which is what plan 88.6-34 took for the
   desktop nav and what this plan took for the tutorial footer's Back/Next pair.

   WHY THEY GO THE OTHER WAY. Each of these three is ink inside its OWN FILL or the SUBJECT of
   its row — §4.5's pill/chip-ink reason verbatim ("the ink must hold against its own fill") for
   the CTA, and the primary-string reason for the other two. Dropping them to 400 would flatten
   a mock whose entire job is to be recognisable as the production email and card it imitates.
   None of the three is a `.btn` element, so none of these weights was dead: this is a real
   500/600 -> 700 delta on a tutorial surface and is disclosed for `/gsd-ui-review`.

   The two EYEBROWS ("Members set their own availability", "Or send them a check-in") resolve on
   §4.5's eyebrow row — Caption 12 / 700 / uppercase / tracking — and keep their own
   `tracking-wide` rather than converging on the ratified eyebrow's tracking, which is the same
   recorded call plans 22, 28 and 29 made at their own sites. */
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
          <div className="text-xs uppercase tracking-wide font-bold text-content-muted mb-1">
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
          <div className="w-6 h-3 rounded-xs bg-green-300 border border-green-400" />
          <div className="w-6 h-3 rounded-xs bg-green-300 border border-green-400" />
          <div className="w-6 h-3 rounded-xs bg-green-300 border border-green-400" />
          <div className="w-6 h-3 rounded-xs bg-surface-elevated border border-line" />
          <div className="w-6 h-3 rounded-xs bg-surface-elevated border border-line" />
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
          <div className="text-xs uppercase tracking-wide font-bold text-content-muted mb-1">
            Or send them a check-in
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-btn-primary text-btn-primary-content flex items-center justify-center text-xs font-bold shrink-0">
              NG
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-content-primary truncate">
                Tabletop Crew
              </div>
              <div className="text-xs text-content-muted truncate">
                Wingspan — When are you available?
              </div>
            </div>
            <span className="text-xs text-content-muted shrink-0">now</span>
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
            className="text-sm font-bold text-btn-primary-content bg-btn-primary px-4 py-2 rounded-btn"
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
          <div className="w-9 h-9 rounded-btn bg-surface-elevated border border-line flex items-center justify-center shrink-0">
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
            <div className="text-sm font-bold text-content-primary">
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
