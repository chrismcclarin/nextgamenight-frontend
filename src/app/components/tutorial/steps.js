'use client';

/**
 * Tutorial tour step definitions.
 * Each step targets a [data-tutorial] attribute on the simulated pages.
 * The skip callback is injected at runtime via getTutorialSteps().
 */

export const CURRENT_TUTORIAL_VERSION = 2;

const STEP_TEXTS = [
  // SimulatedUserHome (steps 0-1)
  {
    selector: '[data-tutorial="create-group-btn"]',
    text: 'Start here \u2014 create a group for your game nights.',
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="invite-friends"]',
    text: 'Invite friends from your friends list or share a QR code.',
    position: 'bottom',
    stepInteraction: false,
  },
  // SimulatedGroupHome - Overview tab (steps 2-4)
  {
    selector: '[data-tutorial="create-event"]',
    text: 'Log a game night by adding an event with a date, time, and game.',
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="plan-session"]',
    text: "Need to find a time? Plan a session to see when everyone's free.",
    position: 'bottom',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="library-tab"]',
    text: "Your group's game library lives here. Tap the Library tab to check it out.",
    position: 'bottom',
    stepInteraction: true,
    actionTriggered: true,
  },
  // SimulatedGroupHome - Library tab (steps 5-6)
  {
    selector: '[data-tutorial="library-games"]',
    text: 'Browse games your group owns. Anyone can add games from their collection.',
    position: 'top',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="library-add-game"]',
    text: 'Add a game to the group library from your personal collection.',
    position: 'bottom',
    stepInteraction: false,
  },
  // SimulatedAvailability (steps 7-9)
  {
    selector: '[data-tutorial="availability-heatmap"]',
    text: 'See when everyone\'s free at a glance. Warmer colors mean more people available.',
    position: 'top',
    stepInteraction: false,
  },
  {
    selector: '[data-tutorial="availability-slots"]',
    text: 'Tap time slots to share when you\'re free.',
    position: 'top',
    stepInteraction: true,
  },
  {
    selector: '[data-tutorial="prompt-schedule"]',
    text: 'Set up automatic reminders so your group never forgets to schedule.',
    position: 'bottom',
    stepInteraction: false,
  },
];

export { STEP_TEXTS };

/**
 * Generates step content JSX with skip link.
 * Progress is now handled by @reactour/tour's badgeContent prop.
 */
export const makeStepContent = (text, stepIndex, totalSteps, onSkip) => {
  // eslint-disable-next-line react/display-name
  return () => (
  <div className="p-1">
    <p className="text-content-secondary text-sm mb-3">{text}</p>
    <div className="flex justify-end">
      <button onClick={onSkip} className="text-xs text-content-muted hover:text-content-secondary underline">
        Skip tutorial
      </button>
    </div>
  </div>
  );
};

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

export const TOTAL_SLIDES = 12; // welcome (1) + tour steps (10) + done (1)
