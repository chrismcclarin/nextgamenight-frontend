'use client';

import { Button } from '../../../components/ui/Button';
import { Heading } from '../../../components/ui/Heading';

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
      <Heading level={1} size="display" className="text-content-primary mb-2">
        Find the night your whole group is free.
      </Heading>
      <p className="text-content-secondary text-base mb-8">
        In one glance.
      </p>

      {/* DECISION Phase 88.6-35 (UI-SPEC §3.2, §3.4 rule 3): the file's ONE `.btn` element.
          `py-3 px-6` (padding, globals.css:2202), `font-semibold` (weight `:2200`) and
          `text-base` (font-size `:2201`) are all DEAD under unlayered `.btn` and go;
          `transition-colors` goes with them, because `.btn` declares
          `transition: var(--theme-transition)` unlayered at `:2203`. `w-full` STAYS — `.btn`
          declares no width, so it was never dead. */}
      <Button variant="primary" onClick={onStart} className="w-full">
        Show me how it works
      </Button>
    </div>
  );
}
