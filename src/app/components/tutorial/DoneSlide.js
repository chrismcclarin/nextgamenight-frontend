'use client';

/**
 * Done slide for the heatmap-first tutorial (Phase 73 ONBD-04).
 *
 * Note: this slide is NOT reached in the primary handoff flow — both invited
 * and cold branches exit via onComplete() + navigation. DoneSlide is preserved
 * for the future replay-button path (TutorialProvider.replayTutorial), where
 * a user explicitly re-watches the tutorial and ends here without a navigation
 * handoff.
 *
 * Tone matches WelcomeSlide: crisp + product-led, benefit-first.
 */
export default function DoneSlide({ onComplete }) {
  return (
    <div className="bg-surface-card rounded-card p-8 max-w-md w-full text-center shadow-theme-lg">
      <h1 className="text-3xl font-bold text-content-primary mb-2">
        You&apos;re set up.
      </h1>
      <p className="text-content-muted text-base mb-8">
        Pick a night. Play more games.
      </p>

      <button
        onClick={onComplete}
        className="btn btn-primary w-full py-3 px-6 font-semibold transition-colors text-base"
      >
        Done
      </button>
    </div>
  );
}
