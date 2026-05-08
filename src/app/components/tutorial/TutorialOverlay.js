'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import WelcomeSlide from './WelcomeSlide';
import ProblemSlide from './simulated/ProblemSlide';
import AvailabilityPromptDemo from './simulated/AvailabilityPromptDemo';
import HeatmapDemo from './simulated/HeatmapDemo';
import ScheduleDemo from './simulated/ScheduleDemo';

/**
 * TutorialOverlay — explanatory 5-step tour (Phase 73 ONBD-04 rewrite).
 *
 * All content lives inside a single bg-surface-card modal so text is always
 * legible regardless of what's behind. The dark backdrop dims the site;
 * the card provides the actual reading surface.
 *
 * Flow:
 *   1. Welcome  ("Show me how it works")
 *   2. Problem  — three pain points + the punchline (~6s)
 *   3. Availability — animated click-drag fill of an availability prompt (~4.5s)
 *   4. Heatmap   — group's merged availability with peak highlighted (~5s)
 *   5. Schedule  — drag across the peak to create an event (~4.5s)
 *   6. Handoff   — branched CTA based on signupSource (invited vs cold)
 *
 * Persistent chrome:
 *   - Step indicator (top of card): "Step N of 5"
 *   - Footer row (bottom of card): ← Back  ·  Skip tutorial  ·  Next →
 *     Skip is mid-row, near the action — not buried in a corner.
 *
 * Visual fidelity: AvailabilityPromptDemo uses bg-green-300 (matching the
 * real AvailabilityGrid's "Preferred" preference). HeatmapDemo uses
 * bg-green-100..500 (matching MergedHeatmap's LEGEND_ITEMS exactly).
 *
 * @param {Object} props
 * @param {Function} props.onComplete - Persists tutorial_version=3 to backend
 *                                       and dismisses the overlay.
 */

const DEMO_PHASES = ['problem', 'availability', 'heatmap', 'schedule', 'handoff'];

export default function TutorialOverlay({ onComplete }) {
  const router = useRouter();
  const [phase, setPhase] = useState('welcome');
  const [stage, setStage] = useState(0);
  const [signupSource, setSignupSource] = useState('cold');

  // Read sessionStorage signal once on mount. Falsy → cold.
  // Set by /invite/group/[token]/page.js post-join (after Auth0 round-trip).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const invited = sessionStorage.getItem('ngtutorial:invitedSource');
    if (invited === '1') {
      setSignupSource('invited');
      sessionStorage.removeItem('ngtutorial:invitedSource');
    }
  }, []);

  // Reset stage whenever phase changes — each demo runs its own animation.
  useEffect(() => {
    setStage(0);
  }, [phase]);

  // Per-phase animation timers. Stage advances on a fixed cadence; the user
  // can also manually click Next to skip ahead, or Back to revisit.
  useEffect(() => {
    if (phase === 'welcome' || phase === 'handoff') return;

    const timeouts = [];

    if (phase === 'problem') {
      [800, 1800, 2800, 4000, 6000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 4) setStage(i + 1);
            else setPhase('availability');
          }, ms)
        );
      });
    } else if (phase === 'availability') {
      [400, 800, 1200, 1600, 2000, 2400, 4000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 6) setStage(i + 1);
            else setPhase('heatmap');
          }, ms)
        );
      });
    } else if (phase === 'heatmap') {
      [400, 2500, 5000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 2) setStage(i + 1);
            else setPhase('schedule');
          }, ms)
        );
      });
    } else if (phase === 'schedule') {
      [600, 1200, 1800, 4500].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 3) setStage(i + 1);
            else setPhase('handoff');
          }, ms)
        );
      });
    }

    return () => timeouts.forEach(clearTimeout);
  }, [phase]);

  const skip = useCallback(() => onComplete(), [onComplete]);

  const goNext = useCallback(() => {
    if (phase === 'welcome') {
      setPhase('problem');
      return;
    }
    const idx = DEMO_PHASES.indexOf(phase);
    if (idx >= 0 && idx < DEMO_PHASES.length - 1) {
      setPhase(DEMO_PHASES[idx + 1]);
    }
  }, [phase]);

  const goBack = useCallback(() => {
    if (phase === 'problem') {
      setPhase('welcome');
      return;
    }
    const idx = DEMO_PHASES.indexOf(phase);
    if (idx > 0) {
      setPhase(DEMO_PHASES[idx - 1]);
    }
  }, [phase]);

  // Handoff actions — persist completion FIRST so re-trigger is impossible,
  // then route. Mirrors the prior implementation's wiring.
  const handlePrimaryHandoff = () => {
    onComplete();
    if (signupSource === 'invited') {
      router.push('/userProfile?section=availability');
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ngtutorial:openCreateGroup'));
    }
  };

  const handleSecondaryHandoff = () => {
    onComplete();
    router.push('/userProfile?section=availability');
  };

  const stepNumber =
    phase === 'welcome' ? 0 : DEMO_PHASES.indexOf(phase) + 1;
  const isWelcome = phase === 'welcome';
  const isHandoff = phase === 'handoff';

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4">
      <div className="bg-surface-page rounded-card shadow-theme-lg max-w-3xl w-full max-h-[92vh] flex flex-col border border-line">
        {/* Header — step indicator */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between">
          <div className="text-content-muted text-sm font-medium">
            {isWelcome
              ? 'Welcome'
              : isHandoff
              ? 'Last step'
              : `Step ${stepNumber} of 5`}
          </div>
          {/* Progress dots — visual companion to the step indicator */}
          {!isWelcome && (
            <div className="flex items-center gap-1.5">
              {DEMO_PHASES.map((p, i) => {
                const active = i === DEMO_PHASES.indexOf(phase);
                const past = i < DEMO_PHASES.indexOf(phase);
                return (
                  <div
                    key={p}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      active
                        ? 'w-6 bg-btn-primary'
                        : past
                        ? 'w-1.5 bg-content-secondary'
                        : 'w-1.5 bg-line'
                    }`}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Main scene area — scrollable on small viewports */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex items-center justify-center">
          {phase === 'welcome' && (
            <WelcomeSlide onStart={() => setPhase('problem')} />
          )}

          {phase === 'problem' && <ProblemSlide stage={stage} />}

          {phase === 'availability' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-lg mb-4 font-semibold">
                Each member marks when they&apos;re free.
              </p>
              <AvailabilityPromptDemo stage={stage} />
              <p className="text-content-secondary text-sm mt-4">
                Click and drag across the times you&apos;re available — takes 30 seconds.
              </p>
            </div>
          )}

          {phase === 'heatmap' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-lg mb-4 font-semibold">
                Their availability lights up your group&apos;s heatmap.
              </p>
              <HeatmapDemo stage={stage} />
              <p className="text-content-secondary text-sm mt-4">
                Darker green = more people free.
                {stage >= 2 && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {' '}
                    Friday 7–8 PM is the peak — everyone&apos;s in.
                  </span>
                )}
              </p>
            </div>
          )}

          {phase === 'schedule' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-lg mb-4 font-semibold">
                Drag across the peak to schedule.
              </p>
              <ScheduleDemo stage={stage} />
              <p className="text-content-secondary text-sm mt-4">
                {stage >= 3
                  ? 'Event created. Your group gets RSVP and game-vote notifications.'
                  : 'Click and drag to set the time window — same gesture as availability.'}
              </p>
            </div>
          )}

          {phase === 'handoff' && (
            <HandoffSlide
              signupSource={signupSource}
              onPrimary={handlePrimaryHandoff}
              onSecondary={handleSecondaryHandoff}
            />
          )}
        </div>

        {/* Footer — Back / Skip / Next. Skip is mid-row, near the action. */}
        <div className="border-t border-line px-6 py-3 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            disabled={isWelcome}
            className={`text-sm transition-colors ${
              isWelcome
                ? 'text-content-muted/40 cursor-not-allowed'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            ← Back
          </button>
          <button
            onClick={skip}
            className="text-sm text-content-muted hover:text-content-secondary transition-colors underline-offset-2 hover:underline"
          >
            Skip tutorial
          </button>
          {isHandoff ? (
            <div className="w-16" />
          ) : (
            <button
              onClick={goNext}
              className="px-4 py-1.5 text-sm font-medium text-content-primary bg-surface-elevated hover:bg-surface-card-hover border border-line rounded-btn transition-colors"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * HandoffSlide — terminal scene before the user is dropped into a real surface.
 * Renders inside the modal card (no nested card bg).
 */
function HandoffSlide({ signupSource, onPrimary, onSecondary }) {
  const isInvited = signupSource === 'invited';
  return (
    <div className="max-w-md text-center">
      <p className="text-content-primary text-xl font-semibold mb-2">
        {isInvited
          ? "You're in. Mark when you're free — the heatmap fills in for everyone."
          : "Ready? Send your group the invite — the heatmap needs them to fill in."}
      </p>
      <p className="text-content-secondary text-sm mb-6">
        Once you&apos;ve got a night, your group RSVPs and votes on the game.
      </p>
      <div className="flex flex-col gap-2">
        <button
          onClick={onPrimary}
          className="btn btn-primary px-6 py-3"
        >
          {isInvited ? 'Set my availability' : 'Invite your group'}
        </button>
        {!isInvited && (
          <button
            onClick={onSecondary}
            className="text-content-muted hover:text-content-secondary text-sm transition-colors"
          >
            I&apos;ll add availability first
          </button>
        )}
      </div>
    </div>
  );
}
