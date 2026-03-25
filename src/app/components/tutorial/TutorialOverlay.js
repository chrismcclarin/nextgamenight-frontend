'use client';

import { useState, useCallback, useEffect } from 'react';
import { TourProvider, useTour } from '@reactour/tour';
import WelcomeSlide from './WelcomeSlide';
import DoneSlide from './DoneSlide';
import { getTutorialSteps } from './steps';
import SimulatedUserHome from './simulated/SimulatedUserHome';
import SimulatedGroupHome from './simulated/SimulatedGroupHome';
import SimulatedAvailability from './simulated/SimulatedAvailability';

/**
 * Mapping from tour step index to the simulated page component to display.
 * Steps 0-1: SimulatedUserHome (create group + QR mention)
 * Steps 2-4: SimulatedGroupHome (event creation + plan session + prompt schedule)
 * Steps 5-6: SimulatedAvailability (heatmap view + interactive slots)
 */
function getPageForStep(stepIndex) {
  if (stepIndex <= 1) return SimulatedUserHome;
  if (stepIndex <= 4) return SimulatedGroupHome;
  return SimulatedAvailability;
}

/**
 * Inner component that renders the correct simulated page based on current tour step.
 * Must be a child of TourProvider to access useTour().
 */
function TourContent({ onTourFinish, onSkip }) {
  const { currentStep, steps, setIsOpen, setCurrentStep } = useTour();
  const PageComponent = getPageForStep(currentStep);
  const isLastStep = currentStep === steps.length - 1;

  // Open the tour when this component mounts
  useEffect(() => {
    setIsOpen(true);
  }, [setIsOpen]);

  // Detect when user clicks "Next" on the last step
  // We use a custom nextButton to intercept the last-step action
  return (
    <div className="w-full h-full overflow-auto">
      <PageComponent />
    </div>
  );
}

/**
 * TutorialOverlay -- Full-screen overlay managing the 3-phase tutorial:
 * 1. Welcome: full-screen slide with Get Started / Skip
 * 2. Tour: @reactour/tour with simulated pages
 * 3. Done: completion slide with Go to Home
 *
 * @param {Object} props
 * @param {Function} props.onComplete - Called when tutorial finishes (skip, done, or complete)
 */
export default function TutorialOverlay({ onComplete }) {
  const [phase, setPhase] = useState('welcome'); // 'welcome' | 'tour' | 'done'

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleStart = useCallback(() => {
    setPhase('tour');
  }, []);

  const handleTourFinish = useCallback(() => {
    setPhase('done');
  }, []);

  const handleDone = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Generate steps with skip callback injected
  const steps = getTutorialSteps(handleSkip);

  if (phase === 'welcome') {
    return <WelcomeSlide onStart={handleStart} onSkip={handleSkip} />;
  }

  if (phase === 'done') {
    return <DoneSlide onComplete={handleDone} />;
  }

  // Tour phase
  return (
    <div className="fixed inset-0 z-[9998] bg-[#fef9ef] overflow-hidden">
      <TourProvider
        steps={steps}
        defaultOpen={false}
        showNavigation={true}
        showDots={false}
        showBadge={false}
        showCloseButton={false}
        disableInteraction={false}
        scrollSmooth={true}
        onClickMask={() => {}}
        padding={{ mask: 8, popover: [6, 10] }}
        styles={{
          maskWrapper: (base) => ({ ...base, zIndex: 9999, opacity: 0.7 }),
          popover: (base) => ({
            ...base,
            zIndex: 10000,
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          }),
          maskArea: (base) => ({ ...base, rx: 8 }),
          highlightedArea: (base) => ({
            ...base,
            display: 'block',
            rx: 8,
          }),
        }}
        onClickHighlighted={(e, clickProps) => {
          // Allow clicks on highlighted elements for interactive steps
          // stepInteraction per-step already controls this
        }}
        nextButton={({ currentStep, stepsLength, setCurrentStep, setIsOpen }) => {
          const isLast = currentStep === stepsLength - 1;
          return (
            <button
              onClick={() => {
                if (isLast) {
                  setIsOpen(false);
                  handleTourFinish();
                } else {
                  setCurrentStep((s) => Math.min(s + 1, stepsLength - 1));
                }
              }}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 px-3 py-1"
            >
              {isLast ? 'Done' : 'Next \u203A'}
            </button>
          );
        }}
        prevButton={({ currentStep, setCurrentStep }) => (
          <button
            onClick={() => {
              if (currentStep === 0) {
                setPhase('welcome');
              } else {
                setCurrentStep((s) => Math.max(s - 1, 0));
              }
            }}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-1"
          >
            {'\u2039 Back'}
          </button>
        )}
      >
        <TourContent
          onTourFinish={handleTourFinish}
          onSkip={handleSkip}
        />
      </TourProvider>
    </div>
  );
}
