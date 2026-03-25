'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { usePathname } from 'next/navigation';
import { usersAPI } from '../../../lib/api';
import TutorialOverlay from './TutorialOverlay';

/**
 * TutorialContext provides tutorial lifecycle state and actions to the app.
 *
 * - showTutorial: whether the tutorial overlay is currently visible
 * - completeTutorial: dismiss + persist completion to backend
 * - replayTutorial: re-show tutorial (from any page, no pathname restriction)
 */
const TutorialContext = createContext({
  showTutorial: false,
  completeTutorial: () => {},
  replayTutorial: () => {},
});

export function useTutorial() {
  return useContext(TutorialContext);
}

/**
 * TutorialProvider -- Global context provider managing tutorial lifecycle.
 *
 * Auto-trigger logic:
 *   - Only fires when user is on / (home page pathname gate)
 *   - Checks backend tutorial_completed flag via usersAPI.getUser
 *   - If tutorial_completed is false, shows tutorial overlay
 *   - Fail-open: if API check fails, do not block the app
 *
 * Replay logic:
 *   - replayTutorial() works from any page (no pathname restriction)
 *   - Explicitly triggered by user action (Replay button in Plan 03)
 *
 * Persistence:
 *   - Uses backend API only (no localStorage per user decision)
 *   - Optimistic dismissal: overlay hides immediately, persist async
 */
export default function TutorialProvider({ children }) {
  const { user, isLoading } = Auth();
  const pathname = usePathname();
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialChecked, setTutorialChecked] = useState(false);

  // Auto-trigger: check tutorial status when user lands on / (home page)
  useEffect(() => {
    if (!user?.sub || isLoading || tutorialChecked) return;
    if (!pathname || pathname !== '/') return;

    let cancelled = false;

    async function checkTutorialStatus() {
      try {
        const userData = await usersAPI.getUser(user.sub);
        if (!cancelled) {
          setTutorialChecked(true);
          if (userData && userData.tutorial_completed === false) {
            setShowTutorial(true);
          }
        }
      } catch (err) {
        // Fail-open: if check fails, mark as checked and do not show tutorial
        console.error('Tutorial status check failed:', err);
        if (!cancelled) {
          setTutorialChecked(true);
        }
      }
    }

    checkTutorialStatus();

    return () => {
      cancelled = true;
    };
  }, [user?.sub, isLoading, tutorialChecked, pathname]);

  // Complete tutorial: dismiss immediately, persist to backend async
  const completeTutorial = useCallback(() => {
    setShowTutorial(false);
    setTutorialChecked(true);

    if (user?.sub) {
      usersAPI.completeTutorial(user.sub).catch((err) => {
        // Log silently -- optimistic dismissal already happened
        console.error('Failed to persist tutorial completion:', err);
      });
    }
  }, [user?.sub]);

  // Replay tutorial: re-show from any page (no pathname gate)
  const replayTutorial = useCallback(() => {
    setShowTutorial(true);
  }, []);

  const contextValue = {
    showTutorial,
    completeTutorial,
    replayTutorial,
  };

  return (
    <TutorialContext.Provider value={contextValue}>
      {children}
      {showTutorial && <TutorialOverlay onComplete={completeTutorial} />}
    </TutorialContext.Provider>
  );
}
