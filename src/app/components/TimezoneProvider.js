'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { usersAPI } from '../../lib/api';

const TimezoneContext = createContext({ timezone: null, setTimezone: () => {} });

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
  const [timezone, setTimezoneState] = useState(() => detectBrowserTimezone() || 'UTC');
  const [storedTimezone, setStoredTimezone] = useState(null);
  const [hasSynced, setHasSynced] = useState(false);

  // setTimezone callable from components (e.g. the picker)
  const setTimezone = useCallback(async (newTimezone) => {
    setTimezoneState(newTimezone);
    if (user?.sub) {
      try {
        await usersAPI.updateTimezone(user.sub, newTimezone);
        setStoredTimezone(newTimezone);
      } catch (err) {
        console.error('Failed to update timezone:', err.message);
      }
    }
  }, [user?.sub]);

  // On mount / user change: fetch stored timezone and auto-detect
  useEffect(() => {
    if (isLoading || !user?.sub) {
      // Not authenticated -- just use browser detection
      const detected = detectBrowserTimezone();
      if (detected) setTimezoneState(detected);
      return;
    }

    let cancelled = false;

    async function syncTimezone() {
      try {
        const userInfo = await usersAPI.getUser(user.sub);
        if (cancelled) return;

        const stored = userInfo?.timezone || null;
        setStoredTimezone(stored);

        const detected = detectBrowserTimezone();
        const effectiveTimezone = detected || stored || 'UTC';
        setTimezoneState(effectiveTimezone);

        // If detected differs from stored, silently patch
        if (detected && detected !== stored) {
          try {
            await usersAPI.updateTimezone(user.sub, detected);
            if (!cancelled) setStoredTimezone(detected);
          } catch (err) {
            console.error('Failed to sync timezone:', err.message);
          }
        }
      } catch (err) {
        console.error('Failed to fetch user timezone:', err.message);
        // Fallback to browser detection
        const detected = detectBrowserTimezone();
        if (detected && !cancelled) setTimezoneState(detected);
      } finally {
        if (!cancelled) setHasSynced(true);
      }
    }

    syncTimezone();
    return () => { cancelled = true; };
  }, [user?.sub, isLoading]);

  return (
    <TimezoneContext.Provider value={{ timezone, setTimezone }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  return useContext(TimezoneContext);
}

export default TimezoneProvider;
