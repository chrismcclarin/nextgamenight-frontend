'use client';

/**
 * Welcome slide for the heatmap-first tutorial (Phase 73 ONBD-04).
 *
 * Tone: crisp + product-led (Linear/Stripe filter). Lead with the benefit;
 * no humor, no game-night flavor. The headline tees up the heatmap reveal —
 * "in one glance" sets the expectation that the next screen IS the answer.
 *
 * Renders inside TutorialOverlay's dark backdrop, so we use a card surface
 * for contrast rather than a full-page bg.
 */
export default function WelcomeSlide({ onStart, onSkip }) {
  return (
    <div className="bg-surface-card rounded-card p-8 max-w-md w-full text-center shadow-theme-lg">
      <h1 className="text-3xl font-bold text-content-primary mb-2">
        Find the night your whole group is free.
      </h1>
      <p className="text-content-muted text-base mb-8">
        In one glance.
      </p>

      <button
        onClick={onStart}
        className="btn btn-primary w-full py-3 px-6 font-semibold transition-colors text-base"
      >
        Show me
      </button>

      <button
        onClick={onSkip}
        className="mt-4 text-sm text-content-muted hover:text-content-secondary transition-colors"
      >
        Skip
      </button>
    </div>
  );
}
