'use client';

/**
 * Tutorial version constant — used by TutorialProvider for re-trigger gating.
 *
 * Bumped from 2 → 3 in Phase 73 (ONBD-04) for the heatmap-first gut-and-rewrite.
 * Existing users with tutorial_version=2 in the DB will see the new reveal once
 * on their next / visit. Skip persists v=3 so it doesn't reappear.
 *
 * The previous 10-step coachmark machinery (STEP_TEXTS, getTutorialSteps,
 * makeStepContent) was removed when the third-party tour library was dropped —
 * the new flow is a 4-phase scene machine in TutorialOverlay, not a per-element
 * tooltip tour.
 */
export const CURRENT_TUTORIAL_VERSION = 3;
