'use client';

/**
 * TimezoneProvider — locked policy (Phase 62 CONTEXT.md):
 *
 *   Profile TZ (User.timezone) is canonical.
 *   Browser TZ is FALLBACK only, used when profile TZ is unset.
 *   NEVER silently overwrite profile TZ with browser-detected TZ.
 *
 * Setting/changing the profile TZ is an EXPLICIT user action — it happens
 * via the userProfile picker, or (Plan 02) via the nudge banner CTA, both
 * of which call the exposed `setTimezone(...)`. There is no auto-sync from
 * mount-time browser detection.
 *
 * The previous implementation patched browser-detected TZ into User.timezone
 * on mount whenever they differed, which corrupted the profile TZ for users
 * who travel, are jet-lagged, or recently set a non-local TZ. That class of
 * bug is closed at the source by removing the silent-sync block.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useQueryClient } from '@tanstack/react-query';
import { usersAPI } from '../../lib/api';
// Phase 84 PRIM-05: browser-TZ detection lives in the consolidated datetime
// layer. The provider owns the policy (profile TZ canonical, browser fallback);
// datetime.ts owns the detection mechanics.
import { detectBrowserTimezone } from '../../lib/datetime';
// Phase 87.3-07 (D-02): identity/timezone resolves via the shared
// ['users','self'] query (staleTime Infinity) instead of an ad-hoc getUser
// self-fetch, so this provider stops issuing a duplicate session-start request.
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { patchSelfCache } from '../../lib/hooks/selfIdentityCache';

const TimezoneContext = createContext({
  timezone: null,
  setTimezone: () => {},
  isProfileTimezoneSet: false,
  browserTimezone: null,
});

export function TimezoneProvider({ children }) {
  const { user, isLoading } = useUser();
  const queryClient = useQueryClient();

  // TZ-01 forwarding (detectBrowserTimezone() as getUser's 2nd arg → backend
  // persist/backfill) lives inside the hook's queryFn, so migrating the fetch
  // onto the shared cache preserves the persist/backfill write side-effect.
  // 87.5 Plan 09 (SPEC Req 6): the setTimezone persist below sends the caller's
  // resolved Users.id UUID (selfUuid) instead of user.sub. selfUuid is flipped
  // INSIDE the user-action callback only — the mount effect stays read-only per
  // the locked Phase 62 no-auto-sync policy in this file's header.
  const { self, selfUuid } = useSelfIdentity();

  // Browser TZ is captured once on mount and stays available — used both as
  // fallback for `timezone` when profile TZ is unset, AND exposed to consumers
  // (e.g. Plan 02's nudge banner) so they can show the user what their browser
  // reports without re-detecting.
  const [browserTimezone, setBrowserTimezoneState] = useState(() => detectBrowserTimezone());

  // The effective TZ to use for display/conversion everywhere.
  const [timezone, setTimezoneState] = useState(() => detectBrowserTimezone() || 'UTC');

  // True when User.timezone is non-null (i.e., the user has explicitly set
  // their profile TZ). Plan 02 uses this to decide whether to render the
  // nudge banner.
  const [isProfileTimezoneSet, setIsProfileTimezoneSet] = useState(false);

  /**
   * setTimezone — explicit user action (profile picker, nudge banner CTA).
   * Persists to backend and updates local state. This is the ONLY code path
   * that should ever write to User.timezone.
   */
  const setTimezone = useCallback(async (newTimezone) => {
    // D-02: persisting the profile TZ requires the resolved caller UUID. Guard
    // BEFORE the optimistic display-state update — flipping display to a value
    // we can't persist would silently revert on the next remount. In practice
    // the picker/nudge CTA only render after `self` (and thus selfUuid) has
    // resolved, so this is defensive; if it ever trips it fails LOUD (throws)
    // rather than swallowing the action. Logged-out callers keep the display-only
    // fallback (no send), matching the pre-existing behavior.
    if (user?.sub && !selfUuid) {
      console.error('Cannot update timezone: identity not resolved yet');
      throw new Error('Your account is still loading — please try again in a moment.');
    }
    setTimezoneState(newTimezone);
    setIsProfileTimezoneSet(Boolean(newTimezone));
    if (selfUuid) {
      try {
        await usersAPI.updateTimezone(selfUuid, newTimezone);
        // Cache-coherence (SELF_IDENTITY_KEY contract): keep the immortal self
        // cache in sync so a later remount reads the new profile TZ, not the
        // stale pre-mutation one.
        patchSelfCache(queryClient, { timezone: newTimezone });
      } catch (err) {
        console.error('Failed to update timezone:', err.message);
      }
    }
  }, [user?.sub, selfUuid, queryClient]);

  // On mount / user change / self resolution: read stored profile TZ; never write.
  useEffect(() => {
    // Re-detect browser TZ on (re)mount in case the user moved devices.
    const detected = detectBrowserTimezone();
    setBrowserTimezoneState(detected);

    if (isLoading || !user?.sub) {
      // Unauthenticated or still loading auth — fall back to browser TZ for
      // display purposes only. No backend interaction.
      setTimezoneState(detected || 'UTC');
      setIsProfileTimezoneSet(false);
      return;
    }

    // Wait for the shared self row. Until it resolves — or if the query errors
    // terminally (self stays undefined) — keep the browser-TZ fallback the
    // display state was initialized to. This preserves the old catch-branch
    // behavior (network/API failure → browser TZ for display) without a
    // duplicate fetch here.
    if (!self) return;

    // Phase 78 / TZ-01: the browser-TZ persist/backfill write already happened
    // in the hook's queryFn (getUser's 2nd arg); we only READ the stored TZ here.
    const stored = self.timezone || null;

    if (stored) {
      // Profile TZ is set — use it. DO NOT auto-sync browser → profile.
      setTimezoneState(stored);
      setIsProfileTimezoneSet(true);
    } else {
      // Profile TZ is null — fall back to browser TZ for display.
      // DO NOT auto-write to backend. The user must set their TZ
      // explicitly via the userProfile picker or the nudge banner.
      setTimezoneState(detected || 'UTC');
      setIsProfileTimezoneSet(false);
    }
  }, [user?.sub, isLoading, self]);

  return (
    <TimezoneContext.Provider
      value={{ timezone, setTimezone, isProfileTimezoneSet, browserTimezone }}
    >
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  return useContext(TimezoneContext);
}

export default TimezoneProvider;
