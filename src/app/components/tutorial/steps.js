'use client';

/**
 * Tutorial tour step definitions.
 * Each step targets a [data-tutorial] attribute on the simulated pages.
 * The skip callback is injected at runtime via getTutorialSteps().
 */

const STEP_TEXTS = [
  {
    selector: '[data-tutorial="create-group-btn"]',
    text: 'Tap Create Group to start a new group for your game nights.',
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="qr-join"]',
    text: 'You can also join groups by scanning a QR code shared by a friend.',
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="create-event"]',
    text: 'Log a game night by creating an event. Pick a date, time, and game.',
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="plan-session"]',
    text: 'Ready to plan a game night? This takes you to scheduling where everyone shares when they\'re free.',
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="availability-heatmap"]',
    text: 'See when everyone is free. Darker, warmer cells mean more people are available.',
    position: 'top',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="availability-slots"]',
    text: 'Tap a few time slots below to share when you\'re free.',
    position: 'top',
    stepInteraction: true,
  },
];

/**
 * Generates step content JSX with skip link and progress dots.
 */
export const makeStepContent = (text, stepIndex, totalSteps, onSkip) => () => (
  <div className="p-1">
    <p className="text-gray-700 text-sm mb-3">{text}</p>
    <div className="flex justify-between items-center">
      <button onClick={onSkip} className="text-xs text-gray-400 hover:text-gray-600 underline">
        Skip tutorial
      </button>
      <div className="flex gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={`w-2 h-2 rounded-full ${i <= stepIndex ? 'bg-blue-600' : 'bg-gray-300'}`}
          />
        ))}
      </div>
    </div>
  </div>
);

/**
 * Returns the full steps array with content functions pre-bound with skip callback.
 * @param {Function} onSkip - Called when user clicks "Skip tutorial" within a tooltip
 * @returns {Array} Steps array compatible with @reactour/tour
 */
export function getTutorialSteps(onSkip) {
  const totalSteps = STEP_TEXTS.length;

  return STEP_TEXTS.map((step, index) => ({
    selector: step.selector,
    position: step.position,
    stepInteraction: step.stepInteraction,
    content: makeStepContent(step.text, index, totalSteps, onSkip),
  }));
}

export const TOTAL_SLIDES = 8; // welcome (1) + tour steps (6) + done (1)
