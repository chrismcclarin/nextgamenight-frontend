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
 * The previous version was a cinematic heatmap reveal that taught nothing.
 * This rewrite walks the user through the system that produces the heatmap:
 *
 *   1. Welcome slide ("Show me how it works")
 *   2. Problem  — three pain points + the punchline (~6s)
 *   3. Availability — animated click-drag fill of an availability prompt (~6s)
 *   4. Heatmap   — group's merged availability with peak highlighted (~5s)
 *   5. Schedule  — drag across the peak to create an event (~6s)
 *   6. Handoff   — branched CTA based on signupSource (invited vs cold)
 *
 * Persistent chrome surrounds every demo step:
 *   - Step indicator (top-left): "Step N of 5"
 *   - Skip Tutorial button (top-right): always high-contrast
 *   - Back / Next buttons (bottom): manual pacing for users who want to skim
 *     or re-watch. Each demo also auto-advances after its timer completes.
 *
 * Visual fidelity: AvailabilityPromptDemo uses bg-green-300 (matching the
 * real AvailabilityGrid's "Preferred" preference). HeatmapDemo uses
 * bg-green-100..500 (matching MergedHeatmap's LEGEND_ITEMS exactly).
 * ScheduleDemo overlays a blue selection ring on the same heatmap.
 *
 * @param {Object} props
 * @param {Function} props.onComplete - Persists tutorial_version=3 to backend
 *                                       and dismisses the overlay.
 */

// Total demo phases (excludes welcome). Used for the "Step N of 5" indicator.
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
  // can also manually click Next to skip ahead, or Back to revisit. Each
  // demo's auto-advance triggers the next phase only if the user hasn't
  // already moved on.
  useEffect(() => {
    if (phase === 'welcome' || phase === 'handoff') return;

    let timeouts = [];

    if (phase === 'problem') {
      // 4 stages of fade-in (3 pain points + payoff), then auto-advance
      [800, 1800, 2800, 4000, 6000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 4) setStage(i + 1);
            else setPhase('availability');
          }, ms)
        );
      });
    } else if (phase === 'availability') {
      // 6-cell drag at 500ms per cell, then 1.5s pause, then auto-advance
      [400, 800, 1200, 1600, 2000, 2400, 4000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 6) setStage(i + 1);
            else setPhase('heatmap');
          }, ms)
        );
      });
    } else if (phase === 'heatmap') {
      // Stage 1 fills cells, stage 2 highlights peak, then auto-advance
      [400, 2500, 5000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 2) setStage(i + 1);
            else setPhase('schedule');
          }, ms)
        );
      });
    } else if (phase === 'schedule') {
      // 3-cell drag at 600ms per cell, then 2s pause to show event card
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

  // Manual nav — Next/Back let the user pace the tutorial themselves.
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
  const isDemoPhase = phase !== 'welcome' && phase !== 'handoff';

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex flex-col p-4">
      {/* Persistent top chrome — step indicator + prominent skip */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-white/70 text-sm font-medium">
          {phase === 'welcome'
            ? 'Welcome'
            : phase === 'handoff'
            ? 'Last step'
            : `Step ${stepNumber} of 5`}
        </div>
        <button
          onClick={skip}
          className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-btn border border-white/20 transition-colors"
          aria-label="Skip tutorial"
        >
          Skip tutorial
        </button>
      </div>

      {/* Main scene area — vertically centered */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        {phase === 'welcome' && (
          <WelcomeSlide onStart={() => setPhase('problem')} onSkip={skip} />
        )}

        {phase === 'problem' && (
          <div className="text-center">
            <ProblemSlide stage={stage} />
          </div>
        )}

        {phase === 'availability' && (
          <div className="max-w-3xl text-center">
            <p className="text-white text-lg mb-4 font-medium">
              Each member marks when they&apos;re free.
            </p>
            <AvailabilityPromptDemo stage={stage} />
            <p className="text-white/70 text-sm mt-4">
              Click and drag across the times you&apos;re available — takes 30 seconds.
            </p>
          </div>
        )}

        {phase === 'heatmap' && (
          <div className="max-w-3xl text-center">
            <p className="text-white text-lg mb-4 font-medium">
              Their availability lights up your group&apos;s heatmap.
            </p>
            <HeatmapDemo stage={stage} />
            <p className="text-white/70 text-sm mt-4">
              Darker green = more people free.
              {stage >= 2 && (
                <span className="text-amber-300">
                  {' '}
                  Friday 7–8 PM is the peak — everyone&apos;s in.
                </span>
              )}
            </p>
          </div>
        )}

        {phase === 'schedule' && (
          <div className="max-w-3xl text-center">
            <p className="text-white text-lg mb-4 font-medium">
              Drag across the peak to schedule.
            </p>
            <ScheduleDemo stage={stage} />
            <p className="text-white/70 text-sm mt-4">
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
            onSkip={skip}
          />
        )}
      </div>

      {/* Persistent bottom chrome — Back / Next on demo phases only */}
      {isDemoPhase && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={goBack}
            className="px-4 py-2 text-white/70 hover:text-white text-sm transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={goNext}
            className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-btn border border-white/20 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * HandoffSlide — terminal scene before the user is dropped into a real surface.
 * Branches on signupSource:
 *   - invited: single primary CTA "Set my availability"
 *   - cold:    primary "Invite your group" + secondary "I'll add availability first"
 */
function HandoffSlide({ signupSource, onPrimary, onSecondary, onSkip }) {
  const isInvited = signupSource === 'invited';
  return (
    <div className="bg-surface-card rounded-card p-8 max-w-md text-center shadow-theme-lg">
      <p className="text-content-primary text-xl font-semibold mb-2">
        {isInvited
          ? "You're in. Mark when you're free — the heatmap fills in for everyone."
          : "Ready? Send your group the invite — the heatmap needs them to fill in."}
      </p>
      <p className="text-content-muted text-sm mb-6">
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
