'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '../../../components/ui/Button';
import { usePhoneViewport } from '../../../lib/hooks/usePhoneViewport';

import WelcomeSlide from './WelcomeSlide';
import ProblemSlide from './simulated/ProblemSlide';
import CheckInDemo from './simulated/CheckInDemo';
import AvailabilityPromptDemo from './simulated/AvailabilityPromptDemo';
import HeatmapDemo from './simulated/HeatmapDemo';
import ScheduleDemo from './simulated/ScheduleDemo';

/**
 * TutorialOverlay — explanatory tour (Phase 73 ONBD-04 rewrite): a welcome scene, then six
 * steps — five demo scenes the indicator numbers `Step 1 of 6` to `Step 5 of 6`, and the
 * handoff, which it labels "Last step".
 *
 * All content lives inside a single `bg-surface-page` card so text is always
 * legible regardless of what's behind. The dark backdrop dims the site;
 * the card provides the actual reading surface.
 *
 * Flow:
 *   1. Welcome  ("Show me how it works")
 *   2. Problem  — three pain points + the punchline (~6s)
 *   3. Check-in — faux message preview + recurring schedule card (~5s)
 *   4. Availability — animated click-drag fill of an availability check-in (~4.5s)
 *   5. Heatmap   — group's merged availability with peak highlighted (~5s)
 *   6. Schedule  — drag across the peak to create an event (~4.5s)
 *   7. Handoff   — branched CTA based on signupSource (invited vs cold)
 *
 * Persistent chrome:
 *   - Step indicator (top of card): "Welcome", then `Step N of 6`, then "Last step"
 *   - Footer row (bottom of card): ← Back  ·  Skip tutorial  ·  Next →
 *     Skip is mid-row, near the action — not buried in a corner.
 *
 * Visual fidelity: AvailabilityPromptDemo uses bg-green-300 (matching the
 * real AvailabilityGrid's "Preferred" preference). HeatmapDemo uses
 * bg-green-100..500 (matching the canonical availability ramp exactly — `mergedCellColor` in
 * `lib/availabilityColor.ts`. This used to name MergedHeatmap's LEGEND_ITEMS; that component was
 * DELETED by plan 88.1-16 and its legend was the same ramp, so the anchor moved to the ramp
 * itself rather than being left pointing at nothing).
 *
 * @param {Object} props
 * @param {Function} props.onComplete - Persists tutorial_version=3 to backend
 *                                       and dismisses the overlay.
 */

const DEMO_PHASES = ['problem', 'checkin', 'availability', 'heatmap', 'schedule', 'handoff'];

// The gesture lines, one constant per arm (D-30 placement; R8 straight apostrophes).
// Copy row T2 (D-30), phone arm.
const AVAILABILITY_HINT_PHONE = "Tap a time, or press and hold then drag across the times you're available — takes 30 seconds.";
// Availability hint, desktop — unchanged (D-16).
const AVAILABILITY_HINT_DESKTOP = "Click and drag across the times you're available — takes 30 seconds.";
// Copy row T3 (D-30), phone arm.
const SCHEDULE_LEAD_PHONE = "Press and hold, then drag across the peak to schedule.";
// Schedule lead, desktop — unchanged (D-16).
const SCHEDULE_LEAD_DESKTOP = "Drag across the peak to schedule.";
// Copy row T4 (D-30), phone arm.
const SCHEDULE_HINT_PHONE = "Press and hold, then drag to set the time window — same gesture as availability.";
// Schedule hint, desktop — unchanged (D-16).
const SCHEDULE_HINT_DESKTOP = "Click and drag to set the time window — same gesture as availability.";

export default function TutorialOverlay({ onComplete }) {
  const router = useRouter();
  /* DECISION Phase 88.6.1-51 (D-16): CHOSEN — the four gesture lines (copy rows T2, T3, T4 here;
     R4 in ScheduleDemo) fork on the shared usePhoneViewport hook (plan 88.6.1-09), the event time
     picker's model; desktop keeps today's sentences (the copy table's Tutorial note).

     REJECTED: (a) one sentence for both widths — the desktop sentence names a mouse gesture a
     phone does not have, and a touch-neutral sentence would be new words the owner has not
     ratified (D-31); (b) both strings in the DOM, switched by responsive classes — DECISION Phase
     88.1-11's reason: jsdom applies no stylesheet, so no unit pin could tell the arms apart;
     (c) a copy of the hook's subscription here — the duplication tenet; plan 09's census fails
     on it.

     FIRST PAINT: the hook starts false and flips after mount, and every opening starts on the
     welcome step (the `useState('welcome')` below), which carries no gesture words — so a phone
     never paints a desktop gesture line. Moving a gesture line onto the welcome step, or opening
     the tour on another step, is a decision, not a cleanup.

     INHERITED LIMIT: a tablet 768px or wider reads the desktop sentences — the hook is a viewport
     proxy (DECISION Phase 88.1-11, in the hook's file). The answer is read ONCE here and handed to
     ScheduleDemo as its isPhoneViewport prop (that file's marker says why). */
  const isPhoneViewport = usePhoneViewport();
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

  // Atomic phase change — resets stage in the same React batch so the new
  // demo never renders with the previous phase's stage value. UAT bug:
  // without atomic reset, the deferred `useEffect(() => setStage(0))`
  // ran AFTER the first render, so demo cards flashed at full opacity
  // then transitioned out before the new animation started.
  const transitionTo = useCallback((nextPhase) => {
    setPhase(nextPhase);
    setStage(0);
  }, []);

  // Per-phase animation timers. Stage advances on a fixed cadence; the user
  // can also manually click Next to skip ahead, or Back to revisit.
  useEffect(() => {
    if (phase === 'welcome' || phase === 'handoff') return;

    const timeouts = [];

    if (phase === 'problem') {
      // Faster line cadence (~700ms apart) so the bullets feel snappy,
      // then ~3.5s dwell on the payoff so users have time to read it
      // before the transition to Step 2.
      [500, 1200, 1900, 2700, 6200].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 4) setStage(i + 1);
            else transitionTo('checkin');
          }, ms)
        );
      });
    } else if (phase === 'checkin') {
      // Extended dwell — message bubble enters at 1s with a slow 700ms fade,
      // gets ~5s of solo reading time, then the recurring card joins for
      // another ~5s before advancing. Auto-advance fires the realistic
      // email/SMS preview entrance.
      [1000, 6000, 11000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 2) setStage(i + 1);
            else transitionTo('availability');
          }, ms)
        );
      });
    } else if (phase === 'availability') {
      [400, 800, 1200, 1600, 2000, 2400, 4000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 6) setStage(i + 1);
            else transitionTo('heatmap');
          }, ms)
        );
      });
    } else if (phase === 'heatmap') {
      [400, 2500, 5000].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 2) setStage(i + 1);
            else transitionTo('schedule');
          }, ms)
        );
      });
    } else if (phase === 'schedule') {
      [600, 1200, 1800, 4500].forEach((ms, i) => {
        timeouts.push(
          setTimeout(() => {
            if (i < 3) setStage(i + 1);
            else transitionTo('handoff');
          }, ms)
        );
      });
    }

    return () => timeouts.forEach(clearTimeout);
  }, [phase, transitionTo]);

  const skip = useCallback(() => onComplete(), [onComplete]);

  const goNext = useCallback(() => {
    if (phase === 'welcome') {
      transitionTo('problem');
      return;
    }
    const idx = DEMO_PHASES.indexOf(phase);
    if (idx >= 0 && idx < DEMO_PHASES.length - 1) {
      transitionTo(DEMO_PHASES[idx + 1]);
    }
  }, [phase, transitionTo]);

  const goBack = useCallback(() => {
    if (phase === 'problem') {
      transitionTo('welcome');
      return;
    }
    const idx = DEMO_PHASES.indexOf(phase);
    if (idx > 0) {
      transitionTo(DEMO_PHASES[idx - 1]);
    }
  }, [phase, transitionTo]);

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
    /* DECISION Phase 88-27 (D-32 bucket D): the scrim reuses `--color-bg-overlay` — the property
       `.modal-overlay` already paints every other modal in the app with — chosen OVER restoring
       the raw `bg-black/85` that 87.7 stripped from here. A raw literal is not theme-aware and
       would have made the tutorial the one modal whose scrim ignores the theme. Referenced as an
       arbitrary value rather than a new theme key because D-32 says bucket D mints NO token.
       Until now this modal has had no scrim at all — that is the visible change. */
    <div className="fixed inset-0 z-60 bg-[var(--color-bg-overlay)] flex items-center justify-center p-4">
      <div className="bg-surface-page rounded-card shadow-theme-lg max-w-3xl w-full max-h-[92vh] flex flex-col border border-line">
        {/* Header — step indicator */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between">
          <div className="text-content-muted text-sm">
            {isWelcome
              ? 'Welcome'
              : isHandoff
              ? 'Last step'
              : `Step ${stepNumber} of 6`}
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

        {/* DECISION Phase 88.6-35 (UI-SPEC §4.3 residue clause, SPEC P4): the four scene lead
            lines below (`text-xl` / 700, one per demo phase) are PSEUDO-HEADINGS and stay
            `<p>` elements — chosen OVER promoting them to `<Heading level={N}>`, which is the
            obvious move once they are wearing the Heading rung's size and weight.

            WHY. They have no semantic outline position to state. This overlay renders inside a
            hand-rolled full-screen surface with no dialog semantics and no heading of its own,
            so any level chosen for them would be INVENTED — and P4's whole content is that
            this phase preserves levels rather than minting them. §4.3 rules them explicitly:
            non-heading `text-lg`/`text-2xl` residue resolves to `text-xl` / 700, not to the
            primitive. `ProblemSlide.js`'s payoff line is the fifth member of the same set.

            Promoting these to `<Heading>` is a decision (it changes the document outline of
            every tutorial step), not a cleanup. */}
        {/* Main scene area — scrollable on small viewports */}
        {/* DECISION Phase 88.6.1-51 (#213, owner 2026-10-13): CHOSEN — safe centring on the
            scene's scroll box, so content taller than the box falls back to start alignment and
            its top line can be scrolled to. REJECTED: keeping plain centring under D-49's v2.1
            accept — centred content taller than its scroll box sits above the scroll origin and
            its top line cannot be reached (the phone schedule step is estimated taller than the
            box at 375x667). D-49's accept still covers the dialog role, Escape and focus trap,
            which stay struck. The overlay root above keeps plain centring: it is not a scroll
            box. Going back to plain centring here is a decision, not a cleanup. */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex items-center-safe justify-center">
          {phase === 'welcome' && (
            <WelcomeSlide onStart={() => transitionTo('problem')} />
          )}

          {phase === 'problem' && <ProblemSlide stage={stage} />}

          {phase === 'checkin' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-xl mb-4 font-bold">
                Two ways to fill the heatmap.
              </p>
              <CheckInDemo stage={stage} />
              <p className="text-content-secondary text-sm mt-4">
                {stage >= 2
                  ? 'Set a recurring check-in and it sends itself every week.'
                  : 'Members can set their availability themselves, or you can send them a check-in.'}
              </p>
            </div>
          )}

          {phase === 'availability' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-xl mb-4 font-bold">
                Each member marks when they&apos;re free.
              </p>
              <AvailabilityPromptDemo stage={stage} />
              <p className="text-content-secondary text-sm mt-4">
                {isPhoneViewport ? AVAILABILITY_HINT_PHONE : AVAILABILITY_HINT_DESKTOP}
              </p>
            </div>
          )}

          {phase === 'heatmap' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-xl mb-4 font-bold">
                Their availability lights up your group&apos;s heatmap.
              </p>
              <HeatmapDemo stage={stage} />
              <p className="text-content-secondary text-sm mt-4">
                Darker green = more people free.
                {stage >= 2 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {' '}
                    Friday 7–8 PM is the peak — everyone&apos;s in.
                  </span>
                )}
              </p>
            </div>
          )}

          {phase === 'schedule' && (
            <div className="w-full text-center">
              <p className="text-content-primary text-xl mb-4 font-bold">
                {isPhoneViewport ? SCHEDULE_LEAD_PHONE : SCHEDULE_LEAD_DESKTOP}
              </p>
              <ScheduleDemo stage={stage} isPhoneViewport={isPhoneViewport} />
              <p className="text-content-secondary text-sm mt-4">
                {stage >= 3
                  ? 'Event created. Your group gets RSVP and game-vote notifications.'
                  : (isPhoneViewport ? SCHEDULE_HINT_PHONE : SCHEDULE_HINT_DESKTOP)}
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

        {/* Footer — Back / Skip / Next. Back and Next are symmetric peer
            controls (same button styling). Skip is the lighter text link
            in between because it's a different kind of action. */}
        {/* DECISION Phase 88.6-35 (UI-SPEC §4.5 emphasis row): Back and Next lost their
            `font-medium` (500) and take 400, chosen OVER promoting the pair to 700 under the
            hierarchy row. They are MIGRATED AS A PAIR in one edit, because the comment above
            makes their symmetry a stated design property — resolving one of them differently
            from the other is the failure this note exists to prevent.

            WHY 400 AND NOT 700. These are secondary step-navigation controls in a footer, and
            what separates them from the surface is already doing the work: a border, an
            elevated fill and a hover wash. 700 would render them louder than the scene lead
            line they sit under. §4.5's emphasis outcome is "400 + a colour token", and both
            already carry theirs (`text-content-primary` / `text-content-muted`). The same call
            was taken on the desktop nav in plan 88.6-34 and on the step indicator above.

            Neither is a `.btn` element — they wear `rounded-btn` only — so this weight was
            ALIVE, not dead, and deleting it is a real 500 -> 400 delta rather than a no-op. */}
        <div className="border-t border-line px-6 py-3 flex items-center justify-between gap-3">
          {/* DECISION Phase 88-27 (D-32 buckets B/D): this button carried THREE stripped alpha
              tokens — a 40% muted text, a 40% elevated surface and a 40% neutral border, all on
              the `isWelcome` branch. Because the element also carries `disabled={isWelcome}`, that
              branch IS the disabled state, so the dimming moves onto `disabled:opacity-50`
              (the app's shipped idiom: KebabMenu, ResponseDashboard's Remind, friends' Remove)
              rather than being re-expressed as three separate 40% values. Chosen OVER re-adding
              per-property alphas, which is the forbidden mechanism, and OVER hand-picking three
              more `-subtle` values for a single disabled control. The branch keeps
              `text-content-muted` (bucket D's text-alpha rule, verbatim) and the same
              `bg-surface-elevated` as its enabled twin, so only the dimming distinguishes them.
              WCAG 1.4.3 exempts disabled controls from the contrast minimum. */}
          <button
            onClick={goBack}
            disabled={isWelcome}
            className={`px-4 py-1.5 text-sm border border-line rounded-btn transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isWelcome
                ? 'text-content-muted bg-surface-elevated'
                : 'text-content-primary bg-surface-elevated hover:bg-surface-hover border-line'
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
            <div className="w-[88px]" aria-hidden="true" />
          ) : (
            <button
              onClick={goNext}
              className="px-4 py-1.5 text-sm text-content-primary bg-surface-elevated hover:bg-surface-hover border border-line rounded-btn transition-colors"
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
      <p className="text-content-primary text-xl font-bold mb-2">
        {isInvited
          ? "You're in. Mark when you're free — the heatmap fills in for everyone."
          : 'First, get your group on board. Once they join, send a check-in to start filling the heatmap.'}
      </p>
      <p className="text-content-secondary text-sm mb-6">
        Once you&apos;ve got a night, your group RSVPs and votes on the game.
      </p>
      <div className="flex flex-col gap-2">
        {/* DECISION Phase 88.6-35 (UI-SPEC §3.2, §3.4 rule 3): this is the file's ONE `.btn`
            element — measured, not inherited. The active progress dot's `bg-btn-primary` is a
            TOKEN, and the footer's Back and Next controls carry `rounded-btn` only; none of
            the three wears `.btn`, so none of them is migrated here and their utilities are all
            alive. `px-6 py-3` are deleted as dead under unlayered `.btn` padding
            (the `.btn` rule's `padding: 0.5rem 1rem;` in globals.css); nothing else on this
            element survived to move. */}
        <Button
          variant="primary"
          onClick={onPrimary}
        >
          {isInvited ? 'Set my availability' : 'Invite your group'}
        </Button>
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
