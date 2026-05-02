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
import { usersAPI } from '../../lib/api';

const TimezoneContext = createContext({
  timezone: null,
  setTimezone: () => {},
  isProfileTimezoneSet: false,
  browserTimezone: null,
});

/**
 * Detects the browser's IANA timezone and validates it.
 * Returns the detected timezone string or null if invalid/unavailable.
 */
function detectBrowserTimezone() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) return null;
    // Validate by attempting to create a formatter with it
    Intl.DateTimeFormat(undefined, { timeZone: detected });
    return detected;
  } catch {
    return null;
  }
}

export function TimezoneProvider({ children }) {
  const { user, isLoading } = useUser();

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
    setTimezoneState(newTimezone);
    setIsProfileTimezoneSet(Boolean(newTimezone));
    if (user?.sub) {
      try {
        await usersAPI.updateTimezone(user.sub, newTimezone);
      } catch (err) {
        console.error('Failed to update timezone:', err.message);
      }
    }
  }, [user?.sub]);

  // On mount / user change: read stored profile TZ; never write.
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

    let cancelled = false;

    async function loadProfileTimezone() {
      try {
        const userInfo = await usersAPI.getUser(user.sub);
        if (cancelled) return;

        const stored = userInfo?.timezone || null;

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
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch user timezone:', err.message);
        // Network/API failure — fall back to browser TZ for display.
        setTimezoneState(detected || 'UTC');
        setIsProfileTimezoneSet(false);
      }
    }

    loadProfileTimezone();
    return () => { cancelled = true; };
  }, [user?.sub, isLoading]);

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
