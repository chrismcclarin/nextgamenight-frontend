'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import WelcomeSlide from './WelcomeSlide';
import DoneSlide from './DoneSlide';
import HeatmapReveal from './simulated/HeatmapReveal';

/**
 * TutorialOverlay -- 4-phase scene machine for the heatmap-first onboarding reveal
 * (Phase 73 ONBD-04).
 *
 * Phases: 'welcome' → 'reveal' → 'handoff' → 'done'.
 *
 *   - welcome: WelcomeSlide. Click "Show me" → reveal.
 *   - reveal: HeatmapReveal staggered cell fill (~14s) with progressive
 *     copy reveal. revealStage drives 0=empty, 1=filling, 2=highlight Fri 7pm,
 *     3=dim. After stage 3 we transition to handoff (no Done slide in primary
 *     flow — both handoff branches dismiss via onComplete and navigate).
 *   - handoff: branch on signupSource (read once on mount from sessionStorage).
 *     Invited users get "Set my availability" → router.push to availability
 *     section on /userProfile. Cold users get "Invite your group" → window
 *     event so app/page.js opens the existing CreateGroup modal it owns.
 *     Both primary CTAs call onComplete() FIRST so the tutorial is persisted
 *     as v=3 before navigation.
 *   - done: DoneSlide kept for future replay-button wiring (not reached in the
 *     primary handoff flow this phase).
 *
 * Why the cold branch dispatches a window event instead of lifting state:
 * modaltoggle is owned by app/page.js. Mirrors the existing 'nggroups:refresh'
 * idiom in that file so we don't reach across component trees.
 *
 * Why no third-party tour library: dropped in Phase 73. The new flow is a
 * single overlay with internal scene state — a step-on-real-DOM tour library
 * was the wrong shape. Removing it saves ~10KB.
 *
 * @param {Object} props
 * @param {Function} props.onComplete - Persists tutorial_version=3 to backend
 *                                       and dismisses the overlay.
 */
export default function TutorialOverlay({ onComplete }) {
  const router = useRouter();
  const [phase, setPhase] = useState('welcome'); // 'welcome' | 'reveal' | 'handoff' | 'done'
  const [revealStage, setRevealStage] = useState(0); // 0 empty, 1 filling, 2 highlight, 3 dim
  const [signupSource, setSignupSource] = useState('cold'); // 'invited' | 'cold'

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

  // Reveal scene timer — total ~14.5s before handoff.
  // Stage 0 (empty) → 1 (filling) at 2s
  // → 2 (highlight Fri 7pm) at 10s → 3 (dim) at 14s → handoff at 14.5s.
  useEffect(() => {
    if (phase !== 'reveal') return;
    const t1 = setTimeout(() => setRevealStage(1), 2000);
    const t2 = setTimeout(() => setRevealStage(2), 10000);
    const t3 = setTimeout(() => setRevealStage(3), 14000);
    const t4 = setTimeout(() => setPhase('handoff'), 14500);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, [phase]);

  const skip = () => onComplete();

  // Invited primary: persist completion FIRST (so the user doesn't re-trigger
  // the tutorial when they land back on /), then route to availability section.
  // Cold primary: persist + dispatch window event so app/page.js opens the
  // CreateGroup modal it owns (modaltoggle is not directly accessible here).
  const handlePrimaryHandoff = () => {
    onComplete();
    if (signupSource === 'invited') {
      router.push('/userProfile?section=availability');
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ngtutorial:openCreateGroup'));
    }
  };

  // Cold-branch secondary: same destination as the invited primary so neither
  // branch leaves the user on a no-op surface.
  const handleSecondaryHandoff = () => {
    onComplete();
    router.push('/userProfile?section=availability');
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4">
      <button
        onClick={skip}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-sm transition-colors"
        aria-label="Skip tutorial"
      >
        Skip
      </button>

      {phase === 'welcome' && (
        <WelcomeSlide onStart={() => setPhase('reveal')} onSkip={skip} />
      )}

      {phase === 'reveal' && (
        <div className="max-w-2xl w-full text-center">
          <HeatmapReveal stage={revealStage} />
          <p
            className="mt-6 text-white text-xl transition-opacity duration-700"
            style={{ opacity: revealStage >= 1 ? 1 : 0 }}
          >
            When does your group have time to play?
          </p>
          <p
            className="mt-2 text-white/80 text-base transition-opacity duration-700"
            style={{ opacity: revealStage >= 2 ? 1 : 0 }}
          >
            Friday night, 7pm. Everyone&apos;s in.
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

      {phase === 'done' && <DoneSlide onComplete={onComplete} />}
    </div>
  );
}

/**
 * HandoffSlide — terminal scene before the user is dropped into a real surface.
 * Branches on signupSource:
 *   - invited: single primary CTA "Set my availability"
 *   - cold:    primary "Invite your group" + secondary "I'll add availability first"
 * Both branches show a one-line RSVP seed so the user knows there's more
 * downstream than the heatmap.
 */
function HandoffSlide({ signupSource, onPrimary, onSecondary, onSkip }) {
  const isInvited = signupSource === 'invited';
  return (
    <div className="bg-surface-card rounded-card p-8 max-w-md text-center shadow-theme-lg">
      <p className="text-content-primary text-xl font-semibold mb-2">
        {isInvited
          ? "You're in. Mark when you're free — the heatmap fills in for everyone."
          : 'This works best with your group. Send them in.'}
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
        <button
          onClick={onSkip}
          className="text-content-muted hover:text-content-secondary text-sm mt-2 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
