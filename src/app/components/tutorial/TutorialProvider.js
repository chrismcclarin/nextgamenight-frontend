'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { usersAPI } from '../../../lib/api';
// Phase 87.3-07 (D-02): tutorial state resolves via the shared ['users','self']
// query instead of an ad-hoc getUser self-fetch.
import { useSelfIdentity } from '../../../lib/hooks/useSelfIdentity';
import { patchSelfCache } from '../../../lib/hooks/selfIdentityCache';
import TutorialOverlay from './TutorialOverlay';
import { CURRENT_TUTORIAL_VERSION } from './steps';

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
 *   - Checks backend tutorial_version via usersAPI.getUser
 *   - If tutorial_version < CURRENT_TUTORIAL_VERSION, shows tutorial overlay
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
  const queryClient = useQueryClient();
  // D-02: read tutorial_version off the shared self row (no duplicate fetch).
  const { self } = useSelfIdentity();
  const pathname = usePathname();
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialChecked, setTutorialChecked] = useState(false);

  // Auto-trigger: check tutorial status when user lands on / (home page)
  useEffect(() => {
    if (!user?.sub || isLoading || tutorialChecked) return;
    if (!pathname || pathname !== '/') return;
    // Fail-open: wait for the shared self row. If the query errors terminally it
    // stays undefined and we simply never auto-show (matching the old catch →
    // mark-checked, do-not-show behavior once the guard below marks it checked).
    if (!self) return;

    setTutorialChecked(true);
    if ((self.tutorial_version ?? 0) < CURRENT_TUTORIAL_VERSION) {
      setShowTutorial(true);
    }
  }, [user?.sub, isLoading, tutorialChecked, pathname, self]);

  // Complete tutorial: dismiss immediately, persist to backend async
  const completeTutorial = useCallback(() => {
    setShowTutorial(false);
    setTutorialChecked(true);

    if (user?.sub) {
      usersAPI.completeTutorial(user.sub, CURRENT_TUTORIAL_VERSION)
        .then(() => {
          // Cache-coherence (SELF_IDENTITY_KEY contract): persist the new
          // tutorial_version into the immortal self cache so a remount doesn't
          // re-trigger the tutorial from the stale pre-completion row.
          patchSelfCache(queryClient, { tutorial_version: CURRENT_TUTORIAL_VERSION });
        })
        .catch((err) => {
          // Log silently -- optimistic dismissal already happened
          console.error('Failed to persist tutorial completion:', err);
        });
    }
  }, [user?.sub, queryClient]);

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
