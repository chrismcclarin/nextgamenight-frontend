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

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usersAPI } from '../../lib/api';
import { logger } from '../../lib/logger';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
// Phase 84 PRIM-05: browser-TZ detection lives in the consolidated datetime
// layer. The provider owns the policy (profile TZ canonical, browser fallback);
// datetime.ts owns the detection mechanics.
import { detectBrowserTimezone } from '../../lib/datetime';
// Phase 87.3-07 (D-02): identity/timezone resolves via the shared
// ['users','self'] query (staleTime Infinity) instead of an ad-hoc getUser
// self-fetch, so this provider stops issuing a duplicate session-start request.
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { patchSelfCache } from '../../lib/hooks/selfIdentityCache';

// The one sentence a failed timezone save shows (T1, 88.9-52; the setTimezone catch below), as a
// top toast or, on the Profile page, beside the Timezone field (T1 Field: the marker at setTimezone).
const TIMEZONE_SAVE_FAILED = 'Failed to save your timezone — please try again.';

const TimezoneContext = createContext({
  timezone: null,
  // (timezone, options?) => Promise<boolean>; options.onSaveFailed(message) takes the failure line.
  setTimezone: () => {},
  isProfileTimezoneSet: false,
  isProfileTimezoneKnown: false,
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

  // DECISION Phase 88.9-52 (W46): whether the profile zone is KNOWN, apart from whether it is
  // set. True only once the self row has been read (the read effect below reached it). While the
  // row is pending, after a read that failed with nothing cached, and signed out, it is false and
  // isProfileTimezoneSet is false too, and that false means "not read", not "none stored". The
  // nudge banner draws only when this is true, chosen OVER reading isProfileTimezoneSet alone: a
  // failed account read drew "Your timezone isn't set" over an account whose zone IS set, on the
  // event view, Create Event and the day sheet. REJECTED: a three-valued isProfileTimezoneSet
  // (null for unknown), which changes the meaning of a value every consumer already reads as a
  // boolean. Once true it stays true while the session lasts: a later failed refresh keeps the
  // cached row, so what was read still holds.
  const [isProfileTimezoneKnown, setIsProfileTimezoneKnown] = useState(false);

  // Save ordering and revert (88.9-68, X33b and owner ruling Q8 b). The AMENDED marker in
  // setTimezone's catch carries the decision; these four refs are its state.
  //   savedTzRef     the last zone the SERVER holds ({ timezone, isSet }): written by the read
  //                  effect each time it reads the self row and by a landed save. A failed save
  //                  puts this back on screen.
  //   pickSeqRef     counts picks. Each pick takes its number synchronously, BEFORE its save
  //                  joins the chain, so a failing earlier pick can tell that a later one exists.
  //   settledSeqRef  the number of the last pick whose save settled. The two differ while a pick
  //                  is in flight.
  //   saveChainRef   one promise chain: a save is sent only after the previous one settled, so
  //                  the server keeps the LAST pick whatever the network does.
  // A-27 (88.9-52): the starting value reads the zone captured once above. useRef evaluates its
  // argument on every render, and a detect call here built two Intl formatters per render.
  const savedTzRef = useRef({ timezone: browserTimezone || 'UTC', isSet: false });
  const pickSeqRef = useRef(0);
  const settledSeqRef = useRef(0);
  const saveChainRef = useRef(Promise.resolve());

  /**
   * setTimezone — explicit user action (profile picker, nudge banner CTA).
   * Persists to backend and updates local state. This is the ONLY code path
   * that should ever write to User.timezone.
   *
   * Resolves `true` once the save has landed (the PATCH answered and the self cache holds the
   * new zone) and `false` in every other case: the identity guard, a failed save, and the
   * logged-out display-only path. Never rejects (88.9-68, X33b: the Profile picker shows its
   * Saved caption from this result).
   *
   * DECISION Phase 88.9-52 (T1, owner 2026-11-17, pick Field: I thought we were making a toast
   * next to the Timezones, not a notice at the top of the page): a caller that has a Timezone
   * field on screen passes `{ onSaveFailed }` and is HANDED the failure line to show beside its
   * field; the provider then raises no toast for that call. A caller that passes nothing keeps
   * the top toast (no field on screen to put it beside). The line is the same one either way,
   * worked out here once. Chosen OVER resolving the line in place of the boolean (the X33b
   * contract, read by the Saved caption, stays true / false) and OVER a toast plus the line (the
   * same words twice). The still-loading refusal at the identity guard goes the same way: one
   * rule, a caller with a field never gets a toast. A failed EARLIER pick with a later one
   * pending is still silent (Q8): nothing is handed over.
   */
  const setTimezone = useCallback(async (newTimezone, options) => {
    // T1 (88.9-52): the caller's own place for the failure line, or the top toast.
    const reportFailure = (message) => {
      if (typeof options?.onSaveFailed === 'function') options.onSaveFailed(message);
      else toast.error(message);
    };
    // D-02: persisting the profile TZ requires the resolved caller UUID. Guard
    // BEFORE the optimistic display-state update — flipping display to a value
    // we can't persist would silently revert on the next remount. In practice
    // the picker/nudge CTA only render after `self` (and thus selfUuid) has
    // resolved, so this is defensive. Fail loud via toast, not throw (87.5
    // review ML-02): a throw here would become an unhandled rejection the user
    // never sees (AMENDED Phase 88.9-52, T1: or beside the caller's Timezone field, where it
    // has one; the marker above setTimezone). AMENDED Phase 88.9-68 (X33b): the Profile picker now AWAITS
    // this call (it was fire-and-forget) and reads the boolean it resolves, so
    // every path below returns one and none throws. Logged-out callers keep the
    // display-only fallback (no send, resolves false), matching the
    // pre-existing behavior.
    if (user?.sub && !selfUuid) {
      console.error('Cannot update timezone: identity not resolved yet');
      reportFailure('Your account is still loading — please try again in a moment.');
      return false;
    }
    setTimezoneState(newTimezone);
    setIsProfileTimezoneSet(Boolean(newTimezone));
    if (selfUuid) {
      // This pick's number, taken synchronously and BEFORE its save joins the chain (never inside
      // the chained callback, where a later pick would not yet have counted itself).
      const pick = ++pickSeqRef.current;
      const save = saveChainRef.current.then(async () => {
        await usersAPI.updateTimezone(selfUuid, newTimezone);
        // Landed. Recorded INSIDE the chain, so it is in place before the next pick's save is
        // sent and a later failure reverts to this zone.
        savedTzRef.current = { timezone: newTimezone, isSet: Boolean(newTimezone) };
        // Cache-coherence (SELF_IDENTITY_KEY contract): keep the immortal self
        // cache in sync so a later remount reads the new profile TZ, not the
        // stale pre-mutation one.
        patchSelfCache(queryClient, { timezone: newTimezone });
      });
      // The chain carries on after a failure: the next save still waits for this one to settle.
      saveChainRef.current = save.catch(() => {});
      try {
        await save;
        return true;
      } catch (err) {
        // Same silent-revert class as the guard above: display state already
        // flipped optimistically, so tell the user the persist failed (ML-02).
        // AMENDED Phase 88.9-68 (owner ruling Q8 b, 2026-11-14): DECISION: revert to the saved
        // zone on failure, chosen OVER keeping the unsaved zone on screen (the ML-02 shape, where
        // the picker showed a zone the server never stored until a remount silently put the old
        // one back); only when no later pick is pending, and only then the toast says the save
        // failed; a superseded failure is logged with no toast (the later pick is judged on its
        // own result).
        // The failure is reported once, to Sentry, for every pick (88.9-68, X33b: this catch is
        // now the basis of the picker's "no Saved" answer, so it follows the house error form).
        logger.error('Failed to update timezone', err);
        if (pick === pickSeqRef.current) {
          setTimezoneState(savedTzRef.current.timezone);
          setIsProfileTimezoneSet(savedTzRef.current.isSet);
          // The shipped sentence for an unknown cause; a known cause (a 401) reads the register's
          // own line. No new words.
          // AMENDED Phase 88.9-52 (T1, owner ruling A, 2026-11-16): a failure on OUR side (a 500, or a
          // misconfiguration) reads the timezone sentence too, chosen OVER the register's shared
          // server-error line it showed (it never says what failed). A cause the person can act on
          // (signed out, offline, going too fast) keeps the register's line.
          // AMENDED Phase 88.9-52 (T1, owner pick Field, 2026-11-17): WHERE the line shows is the
          // caller's: beside its Timezone field when it passed onSaveFailed, else the top toast.
          reportFailure(
            getFetchErrorMessage(err, {
              fallback: TIMEZONE_SAVE_FAILED,
              byCode: { internal: TIMEZONE_SAVE_FAILED, config: TIMEZONE_SAVE_FAILED },
            })
          );
        }
        return false;
      } finally {
        settledSeqRef.current = pick;
      }
    }
    return false;
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
      setIsProfileTimezoneKnown(false);
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

    // What the server holds, in both arms: the stored zone, or (none stored) the browser zone as
    // a display fallback with isSet false. A failed save reverts the display to this (Q8).
    //   stored: profile TZ is set — use it. DO NOT auto-sync browser → profile.
    //   none:   fall back to browser TZ for display. DO NOT auto-write to backend. The user must
    //           set their TZ explicitly via the userProfile picker or the nudge banner.
    const saved = stored
      ? { timezone: stored, isSet: true }
      : { timezone: detected || 'UTC', isSet: false };
    savedTzRef.current = saved;
    // W46 (88.9-52): the row has been read, so set-or-unset is now a fact (set before the
    // in-flight return below: an unsaved pick does not make the row any less read).
    setIsProfileTimezoneKnown(true);

    // While a pick is in flight the display belongs to that pick. An earlier pick's landed save
    // patches the self cache, which gives `self` a new reference and re-runs this effect; writing
    // the display here would pull it back from a LATER pick that is still saving (88.9-68, Q8).
    // The saved zone above is refreshed either way; the pick's own result settles the display.
    if (pickSeqRef.current !== settledSeqRef.current) return;

    setTimezoneState(saved.timezone);
    setIsProfileTimezoneSet(saved.isSet);
  }, [user?.sub, isLoading, self]);

  return (
    <TimezoneContext.Provider
      value={{ timezone, setTimezone, isProfileTimezoneSet, isProfileTimezoneKnown, browserTimezone }}
    >
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  return useContext(TimezoneContext);
}

export default TimezoneProvider;
