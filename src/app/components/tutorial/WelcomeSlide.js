'use client';

/**
 * Welcome slide for the explanatory tutorial (Phase 73 ONBD-04).
 *
 * Tone: crisp + product-led (Linear/Stripe filter). Lead with the benefit;
 * no humor, no game-night flavor. The headline tees up the heatmap reveal —
 * "in one glance" sets the expectation that the rest of the tutorial shows
 * how the system gets you there.
 *
 * Renders inside TutorialOverlay's dark backdrop, so we use a card surface
 * for contrast. Skip is handled by the persistent overlay chrome, not here.
 */
export default function WelcomeSlide({ onStart }) {
  return (
    <div className="max-w-md w-full text-center">
      <h1 className="text-3xl font-bold text-content-primary mb-2">
        Find the night your whole group is free.
      </h1>
      <p className="text-content-secondary text-base mb-8">
        In one glance.
      </p>

      <button
        onClick={onStart}
        className="btn btn-primary w-full py-3 px-6 font-semibold transition-colors text-base"
      >
        Show me how it works
      </button>
    </div>
  );
}
