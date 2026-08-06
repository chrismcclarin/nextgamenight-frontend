'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { userGamesAPI, gamesAPI, googleCalendarAPI, usersAPI, availabilityAPI } from '../../lib/api';
// Phase 87.3-07 (D-02): the profile's self row resolves via the shared
// ['users','self'] query (useSelfIdentity) instead of an ad-hoc getUser
// self-fetch. Because that cache is staleTime Infinity, every self-row mutation
// on this page routes its success through the cache helpers so a remount reads
// post-mutation data (SELF_IDENTITY_KEY invalidation contract).
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { patchSelfCache } from '../../lib/hooks/selfIdentityCache';
import { parsePhoneNumber } from 'libphonenumber-js';
import Link from 'next/link';
import { formatDate, toLocalDateString } from '../../lib/dateUtils';
import SafeImage from '../components/SafeImage';
import DangerZoneDeleteAccount from '../components/DangerZoneDeleteAccount';
import { useTutorial } from '../components/tutorial/TutorialProvider';
import { useTimezone } from '../components/TimezoneProvider';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { validatedQueryFn } from '../../lib/validatedQueryFn';
import { AvailabilityPatternListSchema } from '../../lib/schemas/availability';
import { availabilityKeys } from '../../lib/queryKeys/availabilityKeys';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Switch } from '../../components/ui/Switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { Modal } from '../components/Modal';
import { Combobox } from '../../components/ui/Combobox';
import { Input, SelectControl } from '../../components/ui/Input';
import { ErrorFallback } from '../../components/ui/ErrorFallback';

const NOTIFICATION_TYPES = [
    { key: 'event_created', label: 'New Event', description: 'When a game session is scheduled' },
    { key: 'reminder', label: 'Event Reminders', description: 'Before upcoming events' },
    { key: 'event_updated', label: 'Event Updates', description: 'When event details change' },
    { key: 'event_cancelled', label: 'Event Cancelled', description: 'When an event is cancelled' },
];

const REMINDER_WINDOWS = [
    { value: 0.5, label: '30 minutes before' },
    { value: 1, label: '1 hour before' },
    { value: 2, label: '2 hours before' },
    { value: 24, label: '1 day before' },
];

/* DECISION Phase 88-19 (Req 2 / UI-SPEC §4.1 + §4.2): this surface renders THREE
   type roles, not two — 30/700 for the page title, 20/700 (`text-xl font-bold`)
   for the eight top-level section headings, and 16/700 (`text-base font-bold`)
   for the six h3/h4 sub-headings that live INSIDE one of those sections.

   The 16/700 rung is the deliberate part. It is chosen OVER promoting every h3
   to §4.1's Heading role, which is the literal reading of "section headings to
   text-xl" and is what a later reader will "correct" this to. It loses here
   because this page nests three levels: "Availability Settings" (h2) contains
   "Availability Schedules" (h3) which contains "New Schedule" (h4). Rendering
   all three at 20px flattens a real hierarchy into one visual level, on the
   surface with the most sections in the app. 16/700 keeps 30 > 20 > 16 legible
   while staying inside the 4-size working set and never reaching for a fifth.

   What is NOT negotiable in either shape: the weight. §4.2 states 700/400 as a
   PROHIBITION on 600 ("never 600/400"), and D-01 gives 600 exactly one home,
   the Button primitive. Every heading here was `font-semibold` or a bare
   `font-semibold` with no size at all; none may go back.

   `text-lg` (18) and `text-2xl` (24) both appeared on this surface and are gone
   deliberately — they are not in the working set. So are the `md:`-prefixed
   heading sizes: a heading that grows at a breakpoint is a second scale. */

/**
 * The status a notification ROW shows, derived from its two per-channel slots
 * (DEF-88-10-02). The row has ONE indicator cell but two controls, so when both
 * are live the more serious state wins — a failed SMS save is never hidden
 * behind a successful email save. `reminder:window` is deliberately NOT in this
 * list: it has its own indicator, and the old shape's row check ignored the
 * channel, so a window save lit BOTH cells at once.
 */
const SAVE_STATUS_PRECEDENCE = ['guard', 'error', 'saving', 'saved'];
/** Slots that are not a per-row channel and therefore have their own indicator. */
const REMINDER_WINDOW_SLOT = 'reminder:window';
const RESET_SLOT = 'all:reset';
function rowSaveStatus(statuses, typeKey) {
    return SAVE_STATUS_PRECEDENCE.find(
        status => statuses[`${typeKey}:email`] === status || statuses[`${typeKey}:sms`] === status
    ) ?? null;
}

const DEFAULT_PREFERENCES = {
    event_created: { email: true, sms: false },
    reminder: { email: true, sms: false, window_hours: 1 },
    event_updated: { email: true, sms: false },
    event_cancelled: { email: true, sms: false },
};

function Profile(){
    const { user, error, isLoading } = Auth();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    // D-02: the profile's self row comes from the shared, deduped query.
    // 87.5 Plan 09 (SPEC Req 6): the census §3 wire-crossing senders below send
    // the caller's resolved Users.id UUID (selfUuid) instead of user.sub. The
    // wire field NAME stays `user_id`; only the VALUE flips. selfUuid is
    // undefined until the cached self-fetch resolves, so mount-fire senders gate
    // on it (+ selfUuid in their dep arrays so they re-run once it resolves) and
    // user-action senders guard-before-optimistic-update, failing loud.
    const { self, selfUuid, query: selfQuery } = useSelfIdentity();
    // WR-03: the profile header already falls back on selfQuery.isError (init
    // effect below), but the owned-games + Google-calendar-status zones init
    // their loading flags to true and clear them only inside selfUuid-gated
    // fetchers. On a TERMINAL identity failure those fetchers early-return, so
    // the flags never clear and both zones spin forever. Derive the shared error
    // state here and render the compact degrade banner in those two zones.
    const selfIdentityErrorState = useFetchErrorState(selfQuery);
    const [ownedGames, setOwnedGames] = useState([]);
    const [loadingGames, setLoadingGames] = useState(true);
    const [bggSearchQuery, setBggSearchQuery] = useState('');
    const [bggSearchResults, setBggSearchResults] = useState([]);
    const [bggSearching, setBggSearching] = useState(false);
    const [showBggSearch, setShowBggSearch] = useState(false);
    const [bggUsername, setBggUsername] = useState('');
    // The BGG import's slow-operation prompt (D-10) — an informational Modal, not a
    // destructive gate. See the marker on `handleImportCollectionClick`.
    const [bggImportPromptOpen, setBggImportPromptOpen] = useState(false);
    const [importingCollection, setImportingCollection] = useState(false);
    const [importProgress, setImportProgress] = useState(null);
    const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
    const [checkingCalendarStatus, setCheckingCalendarStatus] = useState(true);
    const [userData, setUserData] = useState(null);
    // Paint gate per D-PAINT-01 (Phase 69-04 membershipChecked shape) — gates ONLY the
    // username/avatar zone so we never flash user.name (Auth0/Google) before
    // userData.username arrives. Set true at the end of fetchUserData success AND catch.
    const [profileLoaded, setProfileLoaded] = useState(false);
    const [editingUsername, setEditingUsername] = useState(false);
    const [username, setUsername] = useState('');
    const [savingUsername, setSavingUsername] = useState(false);
    
    // Availability settings state
    const [availabilityTab, setAvailabilityTab] = useState('recurring'); // 'recurring' or 'specific'

    // PRIM-03 (Phase 86-03): availability patterns via TanStack useQuery on the
    // shared validatedQueryFn (parse-before-cache) + availabilityKeys factory.
    // Silent-retry is inherited from the global retry predicate (shouldRetry) —
    // NOT hand-rolled. The error surface (visible amber banner + report CTA) and
    // the error-only refocus-refetch recovery both come from useFetchErrorState /
    // FetchErrorBanner, so the global refetchOnWindowFocus:false default is never
    // touched. Replaces the old inline error state + hand-rolled setTimeout
    // silent-retry + manual window-refocus listener.
    // 87.4 Plan 10 (SPEC Req 5): the availability self-param is the caller's
    // resolved Users.id UUID (self.id from useSelfIdentity), not user.sub. The
    // query is gated on self?.id -- NOT user?.sub -- so it cannot fire before
    // identity resolves: `self` settles only after its own getUser round-trip
    // past Auth0's session load, so gating on user?.sub alone would fire a
    // doomed `/availability/user//patterns` request (empty id) that surfaces a
    // transient FetchErrorBanner until self catches up. The BE matchesSelf
    // dual-accept (Plan 02) still matches the caller on the UUID.
    const patternsQuery = useQuery({
        queryKey: availabilityKeys.patterns(self?.id),
        queryFn: validatedQueryFn(
            AvailabilityPatternListSchema,
            `/availability/user/${encodeURIComponent(self?.id ?? '')}/patterns`
        ),
        enabled: Boolean(self?.id),
    });
    const availabilityPatterns = patternsQuery.data ?? [];
    const loadingPatterns = Boolean(self?.id) && patternsQuery.isPending;
    const patternsError = useFetchErrorState(patternsQuery);
    const [showRecurringForm, setShowRecurringForm] = useState(false);
    const [showSpecificForm, setShowSpecificForm] = useState(false);
    const [recurringForm, setRecurringForm] = useState({
        daysOfWeek: [],
        startTime: '09:00',
        endTime: '17:00',
        // Use local-calendar date, NOT toISOString() (which is UTC and shifts
        // late-evening users to tomorrow). HEAT-02 expansion 4.
        start_date: toLocalDateString(),
        end_date: '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    const [specificForm, setSpecificForm] = useState({
        // Use local-calendar date, NOT toISOString() (which is UTC and shifts
        // late-evening users to tomorrow). HEAT-02 expansion 4.
        date: toLocalDateString(),
        startTime: '09:00',
        endTime: '17:00',
        isAvailable: true,
    });
    const [savingPattern, setSavingPattern] = useState(false);
    const [replayingTutorial, setReplayingTutorial] = useState(false);

    // Phone verification state machine: idle | editing | saving | verifying | verified
    const [phoneState, setPhoneState] = useState('idle');
    const [phoneInput, setPhoneInput] = useState('');
    const [phoneValidation, setPhoneValidation] = useState({ valid: false, error: null });
    const [verificationCode, setVerificationCode] = useState('');
    const [phoneError, setPhoneError] = useState(null);
    const [resendCooldown, setResendCooldown] = useState(0);

    // Two-tap remove confirmation state (D-PHONE-01, mirrors KebabMenu twoTap pattern):
    // first tap arms a 3s revert timer; second tap commits via usersAPI.removePhone.
    const [removeArmed, setRemoveArmed] = useState(false);
    const removeArmedTimerRef = useRef(null);

    // Phone-removal banner state (REVISION):
    // - phoneJustRemoved: session-scoped flag set by handleRemovePhone success path so
    //   the amber banner only fires after a removal in this session — NOT for users
    //   who never had a phone (the unrevised `!userData.phone` gate fired equally for
    //   both, with tone-mismatched copy).
    // - smsDisabledBannerDismissed: in-memory dismiss flag; banner hides for the rest
    //   of the session if user closes it.
    const [phoneJustRemoved, setPhoneJustRemoved] = useState(false);
    const [smsDisabledBannerDismissed, setSmsDisabledBannerDismissed] = useState(false);

    // Phone input ref — Verify-CTA scrolls + focuses this. Always valid because Task 3
    // removed the sms_enabled wrapper around the phone input, so it always renders.
    const phoneInputRef = useRef(null);

    // Notification preferences state
    const [preferences, setPreferences] = useState(null);

    /* DECISION Phase 88-19 (DEF-88-10-02): the save status is a KEYED MAP with a
       per-key clear timer, chosen OVER the single `{ type, channel, status }`
       object this shipped with.

       This is load-bearing precisely BECAUSE of D-14 two screens down. That
       exemption says these toggles need no success toast, and the reason it
       gives is that the row's own Saving/Saved indicator covers the round trip.
       With one slot, that reason was false the moment a second toggle moved:
       every writer set the slot wholesale, so flipping row B replaced row A's
       state — row A's "Saving…" vanished with no receipt whatever its request
       actually did, and if A then FAILED the switch rolled back with nothing
       said. The 2s/3s clears were unkeyed too, so A's late timer could wipe B's
       indicator early. A matrix is used by flipping several things in a row;
       this was the ordinary path, not an edge case.

       Collapsing this back to one slot is a decision that re-opens D-14, not a
       simplification. */
    const [saveStatuses, setSaveStatuses] = useState({}); // { [`${type}:${channel}`]: 'saving'|'saved'|'error'|'guard' }
    const saveStatusTimersRef = useRef({});

    const setSaveStatus = useCallback((key, status, clearAfterMs) => {
        setSaveStatuses(prev => ({ ...prev, [key]: status }));
        const timers = saveStatusTimersRef.current;
        // Cancel this key's own pending clear before arming a new one: without
        // it, a 'saved' timer already in flight fires over the NEXT status this
        // same control lands on.
        if (timers[key]) {
            clearTimeout(timers[key]);
            delete timers[key];
        }
        if (!clearAfterMs) return; // 'saving' persists until it resolves.
        timers[key] = setTimeout(() => {
            delete timers[key];
            setSaveStatuses(prev => {
                if (!(key in prev)) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }, clearAfterMs);
    }, []);

    useEffect(() => {
        const timers = saveStatusTimersRef.current;
        return () => {
            Object.values(timers).forEach(clearTimeout);
        };
    }, []);

    const { replayTutorial } = useTutorial();
    const { timezone, setTimezone } = useTimezone();
    const { setTheme, resolvedTheme } = useTheme();
    const [themeMounted, setThemeMounted] = useState(false);

    // Timezone picker state
    const [tzPickerOpen, setTzPickerOpen] = useState(false);
    const [tzSearch, setTzSearch] = useState('');

    // Get all IANA timezones with UTC offset info
    const getTimezoneList = useCallback(() => {
        try {
            const zones = Intl.supportedValuesOf('timeZone');
            return zones.map(tz => {
                try {
                    const formatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz,
                        timeZoneName: 'short',
                    });
                    const parts = formatter.formatToParts(new Date());
                    const abbr = parts.find(p => p.type === 'timeZoneName')?.value || '';

                    const offsetFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz,
                        timeZoneName: 'longOffset',
                    });
                    const offsetParts = offsetFormatter.formatToParts(new Date());
                    const offset = offsetParts.find(p => p.type === 'timeZoneName')?.value || '';

                    return { value: tz, abbr, offset, label: `${tz} (${abbr}, ${offset})` };
                } catch {
                    return { value: tz, abbr: '', offset: '', label: tz };
                }
            });
        } catch {
            // Fallback for older browsers that don't support supportedValuesOf
            return [{ value: timezone || 'UTC', abbr: '', offset: '', label: timezone || 'UTC' }];
        }
    }, [timezone]);

    /* 88-CODE-REVIEW MED#11: the expensive BASE list is built once per open, not once
       per keystroke. F-359's gate below protected first render only — while the picker
       was open, every keystroke invalidated filteredTimezones, whose body rebuilt the
       full IANA set (~800 Intl.DateTimeFormat constructions) before filtering.
       Filtering ~400 strings per keystroke is cheap; constructing the list is not. */
    const allTimezones = useMemo(
        () => (tzPickerOpen ? getTimezoneList() : []),
        [tzPickerOpen, getTimezoneList]
    );

    const filteredTimezones = useCallback(() => {
        if (!tzSearch.trim()) return allTimezones;
        const query = tzSearch.toLowerCase().replace(/[_/]/g, ' ');
        return allTimezones.filter(tz => {
            const searchable = tz.label.toLowerCase().replace(/[_/]/g, ' ');
            return searchable.includes(query);
        });
    }, [allTimezones, tzSearch]);

    const handleTimezoneSelect = useCallback((tz) => {
        setTimezone(tz);
        setTzPickerOpen(false);
        setTzSearch('');
    }, [setTimezone]);

    /* DECISION Phase 88-10 (F-359): the option list is built ONLY while the picker is
       open, chosen OVER the obvious `useMemo` keyed on the search text alone. Building
       it runs two `Intl.DateTimeFormat` constructions per zone across the full IANA
       set (~400+), so an ungated memo pays that on the first render of a page whose
       picker most visits never touch. The gate is invisible — the list is only ever
       READ while open. Dropping `tzPickerOpen` from the inputs below is a decision
       about page-load cost, not a simplification. */
    const timezoneItems = useMemo(() => {
        if (!tzPickerOpen) return [];
        return filteredTimezones().map(tz => {
            const slashIndex = tz.value.indexOf('/');
            return {
                key: tz.value,
                // Region heading — consecutive items sharing a `group` render under one
                // labelled group, which is how the primitive reproduces the region
                // sections the hand-rolled panel drew by hand.
                group: slashIndex > -1 ? tz.value.substring(0, slashIndex) : 'Other',
                label: (
                    <span className={tz.value === timezone ? 'font-medium text-content-link' : undefined}>
                        {tz.value.replace(/_/g, ' ')}
                        {tz.abbr && <span className="text-content-muted ml-1">({tz.abbr}, {tz.offset})</span>}
                    </span>
                ),
                onSelect: () => handleTimezoneSelect(tz.value),
            };
        });
    }, [tzPickerOpen, filteredTimezones, timezone, handleTimezoneSelect]);

    // Get current timezone abbreviation for display
    const currentTzAbbr = useCallback(() => {
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                timeZoneName: 'short',
            });
            const parts = formatter.formatToParts(new Date());
            return parts.find(p => p.type === 'timeZoneName')?.value || '';
        } catch {
            return '';
        }
    }, [timezone]);

    /* DECISION Phase 88-10 (F-359): the closed field shows the SELECTED timezone as its
       VALUE, and the search text takes over only while the picker is open — chosen OVER
       showing the selection as a placeholder, which is what a text-field-shaped control
       invites. A placeholder renders muted and reads as "nothing chosen yet"; this is a
       setting with a real current value, and the control it replaces displayed that
       value in full-contrast text. Swapping this to a placeholder is a decision that
       changes what the field claims, not a cleanup. */
    const currentTimezoneLabel = useCallback(() => {
        if (!timezone) return '';
        const abbr = currentTzAbbr();
        return abbr
            ? `${timezone.replace(/_/g, ' ')} (${abbr})`
            : timezone.replace(/_/g, ' ');
    }, [timezone, currentTzAbbr]);

    // Opening resets the search so the full list is offered; guarded so a click that
    // merely re-focuses an ALREADY-open field does not wipe what was typed.
    const openTimezonePicker = useCallback(() => {
        if (tzPickerOpen) return;
        setTzSearch('');
        setTzPickerOpen(true);
    }, [tzPickerOpen]);

    // Closing (Esc, outside press, selection) drops the search text so the field falls
    // back to displaying the current selection rather than a stale query.
    const handleTimezonePickerOpenChange = useCallback((next) => {
        setTzPickerOpen(next);
        if (!next) setTzSearch('');
    }, []);

    const handleReplayTutorial = async () => {
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        try {
            setReplayingTutorial(true);
            await usersAPI.resetTutorial(selfUuid);
            replayTutorial();
        } catch (error) {
            console.error('Error replaying tutorial:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't restart the tour. Please try again.",
                })
            );
        } finally {
            setReplayingTutorial(false);
        }
    };

    // Phone validation
    const validatePhoneInput = (value) => {
        if (!value) return { valid: false, error: null };
        try {
            const phoneNumber = parsePhoneNumber(value, 'US');
            if (phoneNumber && phoneNumber.isValid()) {
                return { valid: true, formatted: phoneNumber.formatInternational() };
            }
            return { valid: false, error: 'Invalid phone number' };
        } catch {
            return { valid: false, error: value.length > 5 ? 'Invalid phone number' : null };
        }
    };

    // Type-time guard per D-PHONE-03: digits + plus/minus/parens/spaces.
    // onChange-level filter (NOT keydown) so paste/autofill/IME composition still work.
    const sanitizePhoneInput = (raw) => raw.replace(/[^\d+\-() ]/g, '');

    const handlePhoneChange = (value) => {
        const filtered = sanitizePhoneInput(value);
        setPhoneInput(filtered);
        setPhoneValidation(validatePhoneInput(filtered));
        setPhoneError(null);
        if (phoneState === 'idle' || phoneState === 'verified') {
            setPhoneState('editing');
        }
    };

    const handleSaveAndVerify = async () => {
        if (!user?.sub || !phoneValidation.valid) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        try {
            setPhoneState('saving');
            setPhoneError(null);
            await usersAPI.savePhone(selfUuid, phoneInput);
            // Persist the (still-unverified) number into the self cache so a
            // remount mid-verification re-hydrates the entered number rather than
            // the stale pre-save row.
            patchSelfCache(queryClient, { phone: phoneInput, phone_verified: false });
            setPhoneState('verifying');
        } catch (error) {
            console.error('Error saving phone:', error);
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't send the code. Check the number and try again.",
                    byCode: { validation: "That number wasn't accepted. Check it and try again." },
                })
            );
            setPhoneState('editing');
        }
    };

    const handleVerifyCode = async () => {
        if (!user?.sub || !verificationCode) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        try {
            setPhoneError(null);
            // 88-CODE-REVIEW H1: the wrong-code outcome is a 200 { verified: false }
            // (routes/users.js:727-732 — the Twilio check not approving is a response,
            // not a throw; only MALFORMED input 400s). apiFetch throws solely on
            // !response.ok, so discarding this body took the success path on a wrong
            // code: phone_verified true in local state + the immortal self cache while
            // the DB row stayed false — SMS toggles enabled, SMS never sending.
            const result = await usersAPI.verifyPhone(selfUuid, verificationCode);
            if (!result?.verified) {
                setPhoneError("That code didn't match. Check it and try again.");
                return;
            }
            setPhoneState('verified');
            setVerificationCode('');
            // Reflect the now-verified number locally (enables the SMS toggles,
            // which gate on userData?.phone_verified) and keep the immortal self
            // cache coherent so a remount reads the verified state, not the stale
            // pre-verification row.
            setUserData(prev => (prev ? { ...prev, phone: phoneInput, phone_verified: true } : prev));
            patchSelfCache(queryClient, { phone: phoneInput, phone_verified: true });
        } catch (error) {
            console.error('Error verifying code:', error);
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't check that code. Please try again.",
                    // The 400 arm covers MALFORMED/missing input only (users.js:701-713)
                    // — the actual wrong-code outcome is the 200 { verified: false }
                    // branch above, which reuses the same ratified copy.
                    byCode: { validation: "That code didn't match. Check it and try again." },
                })
            );
        }
    };

    const handleChangeNumber = () => {
        setPhoneState('editing');
        setVerificationCode('');
        setPhoneError(null);
    };

    const handleResendCode = async () => {
        if (!user?.sub || resendCooldown > 0) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        try {
            setPhoneError(null);
            await usersAPI.savePhone(selfUuid, phoneInput);
            setResendCooldown(60);
            const timer = setInterval(() => {
                setResendCooldown(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } catch (error) {
            console.error('Error resending code:', error);
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't resend the code. Please try again.",
                })
            );
        }
    };

    // Cleanup the two-tap revert timer on unmount (mirrors KebabMenu lines 64-71).
    useEffect(() => {
        return () => {
            if (removeArmedTimerRef.current) {
                clearTimeout(removeArmedTimerRef.current);
                removeArmedTimerRef.current = null;
            }
        };
    }, []);

    // Two-tap remove handler (D-PHONE-01): first tap arms a 3s revert timer + flips
    // label to "Tap again to remove" (red). Second tap within 3s commits the removal
    // via the cascade endpoint (Plan 70-01). Optimistically clears local state from
    // the cascaded response and sets phoneJustRemoved so the amber banner fires.
    const handleRemovePhone = async () => {
        if (!user?.sub) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        if (!removeArmed) {
            // First tap — arm.
            if (removeArmedTimerRef.current) clearTimeout(removeArmedTimerRef.current);
            setRemoveArmed(true);
            removeArmedTimerRef.current = setTimeout(() => {
                setRemoveArmed(false);
                removeArmedTimerRef.current = null;
            }, 3000);
            return;
        }
        // Second tap — clear timer and commit.
        clearTimeout(removeArmedTimerRef.current);
        removeArmedTimerRef.current = null;
        setRemoveArmed(false);
        try {
            const updatedUser = await usersAPI.removePhone(selfUuid);
            setUserData(updatedUser);
            // Cache-coherence: PATCH only the fields the cascade changed. The
            // DELETE response is a DEFAULT-scope row (no phone/email), while the
            // immortal self row was hydrated withContactInfo — replacing it
            // wholesale would strip email from the cached self for the session.
            patchSelfCache(queryClient, {
                phone: null,
                phone_verified: false,
                notification_preferences: updatedUser.notification_preferences || DEFAULT_PREFERENCES,
            });
            setPhoneInput('');
            setPhoneValidation({ valid: false, error: null });
            setPhoneState('idle');
            setPreferences(updatedUser.notification_preferences || DEFAULT_PREFERENCES);
            setPhoneError(null);
            setPhoneJustRemoved(true); // Session flag — gates the amber banner.
            setSmsDisabledBannerDismissed(false); // Reset dismissal so banner shows fresh.
        } catch (error) {
            console.error('Error removing phone:', error);
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't remove your number. Please try again.",
                })
            );
            // NOTE: do NOT set phoneJustRemoved on failure — banner only fires on success.
        }
    };

    // Verify-CTA handler: smooth-scroll to + focus the phone input. Does NOT
    // auto-trigger verification (D-SMS-02) — user finishes the existing 3-step
    // Save & Verify flow in place.
    const handleVerifyPhoneCta = () => {
        if (!phoneInputRef.current) return;
        phoneInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Small delay so smooth-scroll has time to land before focus pulls keyboard up.
        setTimeout(() => {
            const target = phoneInputRef.current;
            if (!target) return;
            const input = target.tagName === 'INPUT'
                ? target
                : target.querySelector('input[type="tel"]');
            if (input) input.focus();
        }, 400);
    };

    // Notification preference toggle handler (auto-save with optimistic update)
    const handleToggle = async (notificationType, channel, newValue) => {
        // 87.5 Plan 09: identity-resolution guard BEFORE any optimistic state
        // write. The optimistic setPreferences below runs before the send, so a
        // guard placed just before the await would leave the UI showing an
        // un-sent change with no rollback (the catch's setPreferences rollback
        // never runs — no error is thrown). Fail loud via saveStatus 'error'.
        const slot = `${notificationType}:${channel}`;
        if (!selfUuid) {
            setSaveStatus(slot, 'error', 3000);
            return;
        }
        // Guard: at least one channel must be enabled globally across all notification types
        if (!newValue) {
            const testPrefs = {
                ...preferences,
                [notificationType]: { ...preferences[notificationType], [channel]: false }
            };
            const anyEnabled = NOTIFICATION_TYPES.some(t =>
                testPrefs[t.key]?.email || testPrefs[t.key]?.sms
            );
            if (!anyEnabled) {
                setSaveStatus(slot, 'guard', 3000);
                return;
            }
        }

        // Optimistic update
        const previousPrefs = { ...preferences };
        const updatedPrefs = {
            ...preferences,
            [notificationType]: { ...preferences[notificationType], [channel]: newValue }
        };
        setPreferences(updatedPrefs);
        setSaveStatus(slot, 'saving');

        try {
            await usersAPI.updateNotificationPreferences(selfUuid, updatedPrefs);
            // Keep the immortal self cache coherent (SELF_IDENTITY_KEY contract).
            patchSelfCache(queryClient, { notification_preferences: updatedPrefs });
            setSaveStatus(slot, 'saved', 2000);
        } catch (error) {
            console.error('Error updating preference:', error);
            setPreferences(previousPrefs);
            setSaveStatus(slot, 'error', 3000);
        }
    };

    // Reminder timing handler
    const handleReminderWindowChange = async (newWindowHours) => {
        // 87.5 Plan 09: identity guard BEFORE the optimistic setPreferences below.
        if (!selfUuid) {
            setSaveStatus(REMINDER_WINDOW_SLOT, 'error', 3000);
            return;
        }
        const previousPrefs = { ...preferences };
        const updatedPrefs = {
            ...preferences,
            reminder: { ...preferences.reminder, window_hours: newWindowHours }
        };
        setPreferences(updatedPrefs);
        setSaveStatus(REMINDER_WINDOW_SLOT, 'saving');

        try {
            await usersAPI.updateNotificationPreferences(selfUuid, updatedPrefs);
            patchSelfCache(queryClient, { notification_preferences: updatedPrefs });
            setSaveStatus(REMINDER_WINDOW_SLOT, 'saved', 2000);
        } catch (error) {
            console.error('Error updating reminder window:', error);
            setPreferences(previousPrefs);
            setSaveStatus(REMINDER_WINDOW_SLOT, 'error', 3000);
        }
    };

    // Reset to defaults handler
    const handleResetPreferences = async () => {
        // 87.5 Plan 09: identity guard BEFORE the optimistic setPreferences below.
        if (!selfUuid) {
            setSaveStatus(RESET_SLOT, 'error', 3000);
            return;
        }
        const previousPrefs = { ...preferences };
        setPreferences(DEFAULT_PREFERENCES);
        setSaveStatus(RESET_SLOT, 'saving');

        try {
            await usersAPI.updateNotificationPreferences(selfUuid, DEFAULT_PREFERENCES);
            patchSelfCache(queryClient, { notification_preferences: DEFAULT_PREFERENCES });
            setSaveStatus(RESET_SLOT, 'saved', 2000);
        } catch (error) {
            console.error('Error resetting preferences:', error);
            setPreferences(previousPrefs);
            setSaveStatus(RESET_SLOT, 'error', 3000);
        }
    };

    // D-02: initialize editable state from the shared self row exactly ONCE. The
    // self cache is staleTime Infinity, and mutation handlers below own their own
    // optimistic local-state updates + cache writes, so a reactive re-init on
    // every `self` change would risk clobbering an in-progress edit. A one-shot
    // guard keeps the mount-time population without that hazard.
    const profileInitRef = useRef(false);
    useEffect(() => {
        if (profileInitRef.current) return;
        // Terminal identity-resolution failure — fall back to Auth0 user data and
        // unblock the paint gate (D-PAINT-01) so the user doesn't stare at a
        // skeleton forever. Mirrors the old fetchUserData catch branch.
        if (selfQuery.isError) {
            profileInitRef.current = true;
            setUsername(user?.name || user?.email?.split('@')[0] || 'User');
            setPreferences(DEFAULT_PREFERENCES);
            setProfileLoaded(true);
            // WR-03: the owned-games + calendar-status fetchers never run when
            // identity fails terminally (they gate on selfUuid), so their loading
            // flags would stay true forever ("Loading your collection..." /
            // "Checking your calendar..."). Clear them here so those zones render their
            // degrade banner instead of an indefinite spinner.
            setLoadingGames(false);
            setCheckingCalendarStatus(false);
            return;
        }
        if (!self) return;
        profileInitRef.current = true;
        setUserData(self);
        setUsername(self.username || user?.name || user?.email?.split('@')[0] || '');
        // Initialize phone state
        if (self.phone && self.phone_verified) {
            setPhoneState('verified');
            setPhoneInput(self.phone);
        } else if (self.phone) {
            setPhoneState('idle');
            setPhoneInput(self.phone);
        }
        // Initialize notification preferences
        setPreferences(self.notification_preferences || DEFAULT_PREFERENCES);
        // Paint gate (D-PAINT-01): unblock username/avatar zone after backend resolves.
        setProfileLoaded(true);
    }, [self, selfQuery.isError, user?.name, user?.email]);

    const handleSaveUsername = async () => {
        if (!user?.sub || !username.trim()) {
            toast.error('Please enter a username');
            return;
        }
        
        if (username.length > 50) {
            toast.error('Username must be 50 characters or less');
            return;
        }

        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }

        try {
            setSavingUsername(true);
            const updatedUser = await usersAPI.updateUsername(selfUuid, username.trim());
            setUserData(updatedUser);
            // Cache-coherence: PATCH only the changed field. The PUT response is
            // a DEFAULT-scope row (no phone/email), while the immortal self row
            // was hydrated withContactInfo — replacing it wholesale would make a
            // verified phone vanish from the cached self for the session.
            patchSelfCache(queryClient, { username: updatedUser.username });
            setEditingUsername(false);
            toast.success('Username updated');
        } catch (error) {
            console.error('Error updating username:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save your username. Please try again.",
                    byCode: { validation: "That username can't be used. Try a different one." },
                })
            );
        } finally {
            setSavingUsername(false);
        }
    };

    const checkGoogleCalendarStatus = useCallback(async () => {
        // 87.5 Plan 09: mount-fire sender — gate on the resolved self UUID (NOT
        // user?.sub), and depend on selfUuid so this callback is re-created and
        // the calling mount effect re-runs once identity resolves. A gate with no
        // matching dep-array entry would make the send a permanent no-op.
        if (!selfUuid) return;
        try {
            setCheckingCalendarStatus(true);
            const status = await googleCalendarAPI.getStatus(selfUuid);
            setGoogleCalendarConnected(status.connected || false);
        } catch (error) {
            console.error('Error checking Google Calendar status:', error.message);
            setGoogleCalendarConnected(false);
        } finally {
            setCheckingCalendarStatus(false);
        }
    }, [selfUuid]);

    // Theme mount state for hydration-safe rendering
    useEffect(() => setThemeMounted(true), []);

    // Check for Google Calendar connection status from URL params (after OAuth redirect)
    // This must come AFTER checkGoogleCalendarStatus is defined
    useEffect(() => {
        if (!searchParams || !user?.sub) return;
        const calendarStatus = searchParams.get('google_calendar');
        if (calendarStatus === 'connected') {
            // Refresh status from backend to verify connection
            checkGoogleCalendarStatus();
            // Remove query param from URL
            window.history.replaceState({}, '', '/userProfile/');
        } else if (calendarStatus === 'error') {
            /* DECISION Phase 88-25 (Req 14 / T-88-25-01): the toast is FIXED copy, chosen OVER
               interpolating `searchParams.get('message')`. That value is an attacker-controllable
               URL query parameter, so the shipped line let anyone who could get a person to open
               `/userProfile?google_calendar=error&message=…` put arbitrary text in a toast on
               their own profile page — a phishing surface, one class worse than the raw-backend-
               message disclosure this plan is closing everywhere else. React escapes it, so it is
               not injection; it is unbounded attacker-authored COPY, which is the part that
               matters. Do not re-add the interpolation to "help with debugging" — the OAuth
               failure reason is in the server log, not the person's screen. */
            toast.error("We couldn't connect Google Calendar. Please try again.");
            setGoogleCalendarConnected(false);
            window.history.replaceState({}, '', '/userProfile/');
        }
    }, [searchParams, user, checkGoogleCalendarStatus]);

    // ONBD-04 (Phase 73): invited-branch tutorial handoff.
    // TutorialOverlay's invited-primary CTA routes to /userProfile?section=availability.
    // Wait one tick for the section to render, then scroll the Availability
    // Settings card into view. Strip the query param so a refresh doesn't re-scroll.
    useEffect(() => {
        if (!searchParams || !user?.sub) return;
        if (searchParams.get('section') !== 'availability') return;
        const t = setTimeout(() => {
            const el = document.getElementById('availability-settings');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            window.history.replaceState({}, '', '/userProfile/');
        }, 50);
        return () => clearTimeout(t);
    }, [searchParams, user]);

    const handleConnectGoogleCalendar = () => {
        if (!user?.sub) return;
        // Redirect to Next.js API route that handles authentication and redirects to Google OAuth
        window.location.href = '/api/auth/google-connect';
    };

    const performDisconnectGoogleCalendar = async () => {
        try {
            await googleCalendarAPI.disconnect(selfUuid);
            setGoogleCalendarConnected(false);
            toast.success('Google Calendar disconnected');
        } catch (error) {
            console.error('Error disconnecting Google Calendar:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't disconnect Google Calendar. Please try again.",
                })
            );
            // Rethrow so the gate stays OPEN (useConfirmAction's contract) rather
            // than closing over a disconnect that never happened.
            throw error;
        }
    };

    // Dialog tier (UI-SPEC §11.2). Title and body are the ratified copy, verbatim —
    // the body states what actually changes, and deliberately makes no "cannot be
    // undone" claim, because reconnecting is a two-click round trip.
    const disconnectCalendarGate = useConfirmAction({
        tier: 'dialog',
        title: 'Disconnect Google Calendar?',
        body: 'Future events stop syncing. Events already on your calendar stay.',
        confirmLabel: 'Disconnect',
        onConfirm: performDisconnectGoogleCalendar,
    });

    const handleDisconnectGoogleCalendar = () => {
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        disconnectCalendarGate.trigger();
    };

    const fetchOwnedGames = useCallback(async () => {
        // 87.5 Plan 09: mount-fire sender — gate on the resolved self UUID (NOT
        // user?.sub) and depend on selfUuid so the callback re-creates and the
        // calling mount effect re-runs (firing the send) once identity resolves.
        if (!selfUuid) return;
        try {
            setLoadingGames(true);
            const games = await userGamesAPI.getOwnedGames(selfUuid);
            setOwnedGames(games || []);
        } catch (error) {
            console.error('Error fetching owned games:', error);
            setOwnedGames([]);
        } finally {
            setLoadingGames(false);
        }
    }, [selfUuid]);

    const searchBGG = async () => {
        if (!bggSearchQuery.trim()) return;
        try {
            setBggSearching(true);
            const results = await gamesAPI.searchBGG(bggSearchQuery);
            setBggSearchResults(results || []);
            if (results.length === 0) {
                toast('No games found. Try a different search term.');
            }
        } catch (error) {
            console.error('Error searching BGG:', error);
            setBggSearchResults([]);
            /* DECISION Phase 88-25 (Req 14 / T-88-25-01): the BGG-unavailable case is selected by
               `ApiError.code`, chosen OVER the shipped `errorMessage.includes('401')` /
               `.includes('403')` / `.includes('rate limiting')` prose match. Two defects in one:
               the else-branch interpolated the raw upstream message, and the prose match itself
               was unreliable — it keyed on substrings of a message the backend is free to reword,
               and 'rate limiting' would also fire on a game whose TITLE contained it. The codes
               are the seam that exists for exactly this (api.ts mapErrorToCode). */
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't reach BoardGameGeek. Please try again in a few moments.",
                    byCode: {
                        rate_limited:
                            'BoardGameGeek is rate-limiting us right now. Try again in a few moments.',
                        unauthorized:
                            "BoardGameGeek isn't accepting requests right now. Try again in a few moments.",
                        forbidden:
                            "BoardGameGeek isn't accepting requests right now. Try again in a few moments.",
                    },
                })
            );
        } finally {
            setBggSearching(false);
        }
    };

    const addGameToCollection = async (game_id) => {
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        try {
            // If game_id is a BGG ID, import it first
            let gameId = game_id;
            if (typeof game_id === 'number' || (typeof game_id === 'string' && !game_id.includes('-'))) {
                // It's a BGG ID, import it first
                const importedGame = await gamesAPI.importFromBGG(game_id);
                gameId = importedGame.id;
            }
            
            await userGamesAPI.addOwnedGame(selfUuid, gameId);
            await fetchOwnedGames();
            setShowBggSearch(false);
            setBggSearchQuery('');
            setBggSearchResults([]);
            // Req 12: this mutation closes the search panel it was started from, so
            // without a receipt the only feedback is a panel vanishing.
            toast.success('Game added');
        } catch (error) {
            console.error('Error adding game to collection:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't add that game. Please try again.",
                })
            );
        }
    };

    const removeGameFromCollection = async (game_id) => {
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        try {
            await userGamesAPI.removeOwnedGame(selfUuid, game_id);
            await fetchOwnedGames();
            toast.success('Game removed');
        } catch (error) {
            console.error('Error removing game from collection:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't remove that game. Please try again.",
                })
            );
        }
    };

    // Two-tap tier (UI-SPEC §11.2): personal and trivially re-added from the search
    // directly above the list, so per D-09's tier rule the label already says
    // everything a dialog body could. Viable here because the trigger is a
    // persistent inline row button that survives the first tap — D-07's recorded
    // limit (auto-closing menu items) does not bite.
    const removeGameGate = useConfirmAction({
        tier: 'two-tap',
        // Dialog-tier copy, accepted and ignored by two-tap (superset config). It is
        // authored anyway so a retier is genuinely the one-word edit above.
        title: 'Remove this game from your collection?',
        body: 'It drops off your collection. You can add it back from the search above.',
        confirmLabel: 'Remove',
        onConfirm: (gameId) => removeGameFromCollection(gameId),
    });

    // The old hand-rolled patterns fetcher (silent-retry + window-refocus
    // listener) is GONE (PRIM-03): the useQuery above owns fetching + silent-
    // retry, and useFetchErrorState owns the error surface + error-only refocus
    // recovery.

    useEffect(() => {
        if (user?.sub) {
            // Self-row init now happens in the one-shot effect above (driven by the
            // shared useSelfIdentity query); only the non-self fetches remain here.
            fetchOwnedGames();
            checkGoogleCalendarStatus();
        }
    }, [user, fetchOwnedGames, checkGoogleCalendarStatus]);

    const handleCreateRecurringPattern = async () => {
        // 87.4 Plan 10: gate on the resolved self identity, not user?.sub, so the
        // write cannot fire (and cannot send an empty self-param) before self resolves.
        if (!self?.id) return;
        if (recurringForm.daysOfWeek.length === 0) {
            toast.error('Please select at least one day.');
            return;
        }
        // 88-CODE-REVIEW MED#7: client-side mirror of availability.js:130 — the code-less
        // 400 this triggers maps to generic "refresh the page" copy that both hides the
        // fix and discards the form. HH:MM strings compare correctly as strings.
        if (recurringForm.startTime >= recurringForm.endTime) {
            toast.error('Start time must be before end time.');
            return;
        }
        try {
            setSavingPattern(true);
            // Create one schedule per selected day
            for (const dayOfWeek of recurringForm.daysOfWeek) {
                const formData = { ...recurringForm, dayOfWeek };
                delete formData.daysOfWeek;
                if (!formData.end_date || formData.end_date.trim() === '') {
                    delete formData.end_date;
                }
                await availabilityAPI.createRecurringPattern(self.id, formData);
            }
            await patternsQuery.refetch();
            setShowRecurringForm(false);
            setRecurringForm({
                daysOfWeek: [],
                startTime: '09:00',
                endTime: '17:00',
                start_date: toLocalDateString(),
                end_date: '',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            });
            // §6.2's form is `{Object} {past-tense verb}`, <=4 words — so the count
            // the old string carried is deliberately dropped rather than shortened
            // into it. The created rows are visible in the list directly below.
            toast.success('Schedules created');
        } catch (error) {
            console.error('Error creating schedule:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save that schedule. Please try again.",
                })
            );
        } finally {
            setSavingPattern(false);
        }
    };

    const handleCreateSpecificOverride = async () => {
        // 87.4 Plan 10: gate on the resolved self identity, not user?.sub, so the
        // write cannot fire (and cannot send an empty self-param) before self resolves.
        if (!self?.id) return;
        // 88-CODE-REVIEW MED#7: same client-side start<end mirror as the recurring form
        // (availability.js:208 on this path).
        if (specificForm.startTime >= specificForm.endTime) {
            toast.error('Start time must be before end time.');
            return;
        }
        try {
            setSavingPattern(true);
            await availabilityAPI.createOverride(self.id, specificForm);
            await patternsQuery.refetch();
            setShowSpecificForm(false);
            setSpecificForm({
                date: toLocalDateString(),
                startTime: '09:00',
                endTime: '17:00',
                isAvailable: true,
            });
            toast.success('Override created');
        } catch (error) {
            console.error('Error creating specific override:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save that override. Please try again.",
                })
            );
        } finally {
            setSavingPattern(false);
        }
    };

    const performDeletePattern = async (patternId) => {
        try {
            await availabilityAPI.deleteAvailability(patternId);
            await patternsQuery.refetch();
            toast.success('Pattern deleted');
        } catch (error) {
            console.error('Error deleting pattern:', error);
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't delete that entry. Please try again.",
                })
            );
        }
    };

    // Two-tap tier (UI-SPEC §11.2): a pattern is re-creatable from the form directly
    // above, and the button's own label says what it does. ONE gate serves BOTH lists
    // (schedules and overrides) — the pattern id is the target key, so arming a row in
    // one list and tapping a different row re-arms rather than committing (AR DEC-2).
    const deletePatternGate = useConfirmAction({
        tier: 'two-tap',
        title: 'Delete this availability pattern?',
        body: 'It stops counting towards your availability. You can add it again.',
        confirmLabel: 'Delete',
        onConfirm: (patternId) => performDeletePattern(patternId),
    });

    const getDayName = (dayOfWeek) => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[dayOfWeek];
    };


    /* DECISION Phase 88-10 (D-10): the BGG import gate is an ORDINARY INFORMATIONAL
       `<Modal>`, deliberately NOT `ConfirmDialog`/`useConfirmAction` like the three
       gates above it — chosen OVER the obvious "finish the migration and put every
       remaining gate on the ladder".

       It is not a destructive gate. Nothing is lost or overwritten; the warning exists
       because the import is SLOW ("this may take a few minutes"), and D-10 records that
       ruling. Putting it on the destructive ladder would dress a progress warning up as
       a consequence, and would make the ladder's own inventory a lie about how many
       destructive gates this app has.

       It still had to stop being the bare browser prompt, because 88-29's census gate
       arms at ZERO native prompts in `src/` — leaving this one would make that gate
       unarmable (AR R1-M1). Hence: dismissable Modal, Continue/Cancel, same message.

       Moving this onto ConfirmDialog is a decision that reopens D-10, not a cleanup. */
    const handleImportCollectionClick = () => {
        if (!user?.sub || !bggUsername.trim()) {
            toast.error('Please enter your BGG username');
            return;
        }

        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }

        setBggImportPromptOpen(true);
    };

    const importBGGCollection = async () => {
        setBggImportPromptOpen(false);
        if (!user?.sub || !bggUsername.trim() || !selfUuid) return;

        try {
            setImportingCollection(true);
            setImportProgress({ status: 'fetching', message: 'Fetching your BGG collection...' });

            const result = await userGamesAPI.importBGGCollection(selfUuid, bggUsername.trim());
            
            setImportProgress({
                status: 'complete',
                message: `Imported ${result.imported} games`,
                details: result
            });
            
            // Refresh the owned games list
            await fetchOwnedGames();
            
            // Clear the username after successful import
            setTimeout(() => {
                setBggUsername('');
                setImportProgress(null);
            }, 5000);
        } catch (error) {
            console.error('Error importing BGG collection:', error);
            setImportProgress({
                status: 'error',
                message: getFetchErrorMessage(error, {
                    fallback: "We couldn't import that collection. Check the username and try again.",
                })
            });
        } finally {
            setImportingCollection(false);
        }
    };

    // §6.3: loading copy NAMES the thing. Worded identically to this route's own
    // `loading.tsx` fallback so the boundary and the component do not greet the
    // same person with two different sentences on one navigation.
    if (isLoading) return <div className="flex items-center justify-center min-h-screen">Loading your profile...</div>;

    /* DECISION Phase 88-19 (Req 7 / T-88-19-02): the session-error branch renders
       the shared `ErrorFallback` — chosen OVER hand-writing a designed sentence
       here, which is what this task's action literally asks for and what the
       neighbouring branch above still does.

       The primitive wins on two counts the copy fix alone would have missed.
       (1) SECURITY: this branch rendered `{error.message}` — a raw upstream
       message straight into the DOM (ASVS V7). `ErrorFallback` takes no error at
       all BY CONTRACT, so the disclosure cannot be reintroduced by editing a
       string; the detail goes to the console for a developer instead.
       (2) It was a DEAD END: one red line, no retry, no reload, nothing to do.
       The fallback ships both affordances.

       Deliberately NOT worded "failed to load" — plan 88-25 arms a negative gate
       on that phrase across this file. */
    if (error) {
        console.error('Auth0 session error on /userProfile:', error);
        return (
            <ErrorFallback
                title="We couldn't load your profile"
                body="Your session didn't come back. Reload the page, and sign in again if it keeps happening."
            />
        );
    }

    return (
        user && (
            <div className="p-3 md:p-6 max-w-4xl mx-auto">
                {/* SMS-disabled banner — gated on phoneJustRemoved (session flag
                    set by handleRemovePhone success) so it does NOT fire for users
                    who never had a phone. Also gated on sms_enabled per the
                    admin-entitlement model: non-entitled users never see SMS UI,
                    including this banner. Banner clears automatically when user
                    re-adds a phone. Tokens mirror Phase 62-02 TimezoneNudgeBanner. */}
                {userData?.sms_enabled && phoneJustRemoved && !userData?.phone && !smsDisabledBannerDismissed && (
                    <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex items-start gap-3">
                        <p className="flex-1 text-sm text-amber-900 dark:text-amber-100">
                            SMS disabled — add a phone number to re-enable.
                        </p>
                        <button
                            type="button"
                            onClick={() => setSmsDisabledBannerDismissed(true)}
                            className="text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 text-lg leading-none shrink-0"
                            aria-label="Dismiss"
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* Breadcrumbs */}
                <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                    <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                    <span className="text-content-muted mx-2">{'>'}</span>
                    <span className="text-content-primary font-semibold">Profile</span>
                </nav>

                {/* Profile Header */}
                <div className="card p-3 md:p-6 mb-6">
                    {/* Avatar + Username zone — paint-gated (D-PAINT-01) so user.name (Auth0/Google)
                        never flashes before userData.username arrives. Skeleton on first paint;
                        real content (or Auth0 fallback on fetch failure) once profileLoaded flips. */}
                    {profileLoaded ? (
                        <div className="flex items-center gap-3 md:gap-4">
                            {user.picture && (
                                <img src={user.picture} alt={userData?.username || user.name} className="w-16 h-16 md:w-20 md:h-20 rounded-full shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                                {editingUsername ? (
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                        {/* DECISION Phase 88-19 (Req 1 + Req 2): the inline
                                            username editor renders through the `Input`
                                            PRIMITIVE at body size — chosen OVER keeping it
                                            sized to MIRROR the <h1> it replaces, which is
                                            what it shipped as (`text-lg md:text-xl
                                            font-bold`).

                                            Two reasons the mirror loses. (1) Task 2 moves
                                            that <h1> to the Display role, 30px/700 — a
                                            30px-tall text field is absurd on a 375px phone,
                                            so the mirror was already going to break, and
                                            "mirror it, but smaller" is a size nobody owns.
                                            (2) §4.2 gives 700 to headings and 400 to body;
                                            an input is body, and a control that renders like
                                            a heading hides that it is editable at all.

                                            Re-styling this to match the heading again is a
                                            decision, not a cleanup. */}
                                        <Input
                                            aria-label="Username"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            maxLength={50}
                                            className="flex-1"
                                            placeholder="Enter username"
                                            autoFocus
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleSaveUsername}
                                                disabled={savingUsername || !username.trim()}
                                                className="btn btn-primary px-4 py-2 text-sm whitespace-nowrap disabled:opacity-50"
                                            >
                                                {savingUsername ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditingUsername(false);
                                                    setUsername(userData?.username || user.name || user.email?.split('@')[0] || '');
                                                }}
                                                disabled={savingUsername}
                                                className="btn btn-secondary px-4 py-2 text-sm whitespace-nowrap disabled:opacity-50"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                        <p className="text-xs text-content-muted">{username.length}/50</p>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-3xl font-bold text-content-primary truncate">
                                            {userData?.username || user.name}
                                        </h1>
                                        {/* §7.3: an icon-only control needs a real accessible
                                            name; the pencil glyph is the whole content, so
                                            without this the name announced was the emoji, and
                                            a `title` does not count. */}
                                        <button
                                            onClick={() => setEditingUsername(true)}
                                            className="text-content-link hover:text-content-link-hover text-sm md:text-base"
                                            aria-label="Edit username"
                                            title="Edit username"
                                        >
                                            ✏️
                                        </button>
                                    </div>
                                )}
                                <p className="text-sm md:text-base text-content-secondary truncate">{user.email}</p>
                                {userData?.username && userData.username !== user.name && (
                                    <p className="text-xs text-content-muted mt-1">
                                        Display name: {userData.username} (from Google: {user.name})
                                    </p>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Skeleton placeholder — shimmer bars sized to typical username + email.
                        // Uses bg-surface-card-hover token so it auto-themes.
                        <div className="flex items-center gap-3 md:gap-4 w-full">
                            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface-card-hover animate-pulse shrink-0" />
                            <div className="flex-1 space-y-2">
                                <div className="h-7 w-40 bg-surface-card-hover rounded-sm animate-pulse" />
                                <div className="h-4 w-56 bg-surface-card-hover rounded-sm animate-pulse" />
                            </div>
                        </div>
                    )}

                    {/* Phone Input — gated on sms_enabled per the admin-entitlement
                        model. sms_enabled is admin-set in the DB; users without it
                        see no phone surface at all. When sms_enabled=true the entire
                        phone flow (input, verify, change, remove) renders; when
                        false, the user is unaware SMS exists.
                        Wrapper div carries phoneInputRef so the verify CTA can
                        scrollIntoView + focus the inner <input type="tel">. */}
                    {userData?.sms_enabled && (
                    <div className="mt-2" ref={phoneInputRef}>
                                    {(phoneState === 'idle' || phoneState === 'editing') && (
                                        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                                            <div className="flex-1 relative">
                                                {/* Named explicitly: this control has no visible
                                                    label of any kind (a placeholder is not a
                                                    name — axe `label`, WCAG 4.1.2 A). */}
                                                <Input
                                                    type="tel"
                                                    aria-label="Phone number"
                                                    value={phoneInput}
                                                    onChange={(e) => handlePhoneChange(e.target.value)}
                                                    placeholder="+1 555-123-4567"
                                                    aria-invalid={
                                                        phoneValidation.error || phoneError ? 'true' : undefined
                                                    }
                                                    aria-describedby={
                                                        [
                                                            phoneValidation.error ? 'phone-format-error' : null,
                                                            phoneError ? 'phone-flow-error' : null,
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' ') || undefined
                                                    }
                                                    className={
                                                        phoneValidation.valid ? 'border-status-success' :
                                                        phoneValidation.error ? 'border-status-error' :
                                                        ''
                                                    }
                                                />
                                                {phoneValidation.valid && (
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-status-success">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    </span>
                                                )}
                                                {/* Same DEF-88-19-04 gap, client-side half: this
                                                    format message was equally silent to a screen
                                                    reader. It types as you go, so it is POLITE
                                                    (role="status") rather than assertive — an
                                                    alert on every keystroke would talk over the
                                                    person mid-entry. The submit-time failure
                                                    above is the one that interrupts. */}
                                                {phoneValidation.error && (
                                                    <p
                                                        id="phone-format-error"
                                                        role="status"
                                                        className="text-status-error text-xs mt-1"
                                                    >
                                                        {phoneValidation.error}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={handleSaveAndVerify}
                                                disabled={!phoneValidation.valid}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                            >
                                                Save & Verify
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'saving' && (
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                            <Input
                                                type="tel"
                                                aria-label="Phone number"
                                                value={phoneInput}
                                                disabled
                                                className="flex-1 bg-surface-card-hover"
                                            />
                                            <button
                                                disabled
                                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm opacity-50 cursor-not-allowed whitespace-nowrap"
                                            >
                                                Sending code...
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'verifying' && (
                                        <div>
                                            <p className="text-sm text-content-secondary mb-2">
                                                Code sent to <span className="font-medium">{phoneValidation.formatted || phoneInput}</span>
                                            </p>
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                                <Input
                                                    aria-label="Verification code"
                                                    value={verificationCode}
                                                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                    placeholder="Enter 6-digit code"
                                                    maxLength={6}
                                                    aria-invalid={phoneError ? 'true' : undefined}
                                                    aria-describedby={phoneError ? 'phone-flow-error' : undefined}
                                                    className="w-32 text-center tracking-widest"
                                                />
                                                <button
                                                    onClick={handleVerifyCode}
                                                    disabled={verificationCode.length !== 6}
                                                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                                >
                                                    Verify
                                                </button>
                                                <button
                                                    onClick={handleResendCode}
                                                    disabled={resendCooldown > 0}
                                                    className="text-sm text-indigo-600 hover:text-indigo-700 disabled:text-content-muted whitespace-nowrap"
                                                >
                                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                                                </button>
                                            </div>
                                            <button
                                                onClick={handleChangeNumber}
                                                className="text-sm text-content-muted hover:text-content-secondary mt-1"
                                            >
                                                Change number
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'verified' && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-status-success">
                                                <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </span>
                                            <span className="text-sm text-status-success font-medium">Phone verified</span>
                                            <button
                                                onClick={handleChangeNumber}
                                                className="text-sm text-content-muted hover:text-content-secondary underline ml-2"
                                            >
                                                Change number
                                            </button>
                                            {/* Two-tap remove link (D-PHONE-01): first tap arms 3s revert timer
                                                + flips label red; second tap commits via usersAPI.removePhone. */}
                                            <button
                                                onClick={handleRemovePhone}
                                                className={`text-sm underline ml-3 ${
                                                    removeArmed
                                                        ? 'text-status-error font-semibold'
                                                        : 'text-status-error hover:text-red-700'
                                                }`}
                                            >
                                                {removeArmed ? 'Tap again to remove' : 'Remove'}
                                            </button>
                                        </div>
                                    )}

                                    {/* DECISION Phase 88-25 (DEF-88-19-04): the phone flow's error
                                        node gets `role="alert"` + `aria-describedby` wiring
                                        DIRECTLY, chosen OVER routing it through `FormField`'s
                                        error slot as DEF-88-19-04 suggested.

                                        WHY FormField LOSES HERE: its contract is "exactly one
                                        control element", which it clones to inject
                                        `id`/`aria-invalid`/`aria-describedby`. This ONE error
                                        node serves four different phone states — the tel input
                                        (idle/editing), the disabled input (saving), the
                                        verification-code input (verifying), and the VERIFIED row,
                                        which has no control at all (the error there comes from
                                        Remove). There is no single control to wrap, so adopting
                                        FormField would mean either splitting `phoneError` into
                                        per-state slots or wrapping a control that did not cause
                                        the error. The a11y property DEF-88-19-04 actually names —
                                        a screen-reader user is told when their submission fails —
                                        is delivered in full here.

                                        `role="alert"` is on a CONDITIONALLY-MOUNTED node, which
                                        is normally the anti-pattern StatusRegion exists to stop.
                                        It is correct in this one case: assertive alerts DO
                                        announce on insertion, and the message must interrupt.
                                        Do not "fix" this into a StatusRegion — that would make it
                                        polite and it would be missed. */}
                                    {phoneError && (
                                        <p
                                            id="phone-flow-error"
                                            role="alert"
                                            className="text-status-error text-xs mt-1"
                                        >
                                            {phoneError}
                                        </p>
                                    )}
                                </div>
                    )}

                    {/* Google Calendar Connection */}
                    <div className="mt-4 pt-4 border-t border-line">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                {/* h2, not h3: this is a top-level section of the page and the
                                    nearest preceding heading is the h1 username directly above,
                                    so an h3 skipped a level (axe heading-order). The type role is
                                    carried by the classes, which are unchanged — the tag moved,
                                    the look did not. */}
                                <h2 className="text-xl font-bold text-content-primary mb-1">Google Calendar Integration</h2>
                                <p className="text-xs text-content-secondary">
                                    {googleCalendarConnected 
                                        ? 'Connected - Future game events will be automatically added to your calendar'
                                        : 'Connect your Google Calendar to automatically add future game events'}
                                </p>
                            </div>
                            {selfIdentityErrorState.showError ? (
                                // WR-03: identity failed terminally — the status
                                // check never ran; show the degrade notice, not a
                                // stuck "Checking your calendar...".
                                <FetchErrorBanner state={selfIdentityErrorState} compact />
                            ) : checkingCalendarStatus ? (
                                <div className="text-sm text-content-muted">Checking your calendar...</div>
                            ) : googleCalendarConnected ? (
                                <button
                                    onClick={handleDisconnectGoogleCalendar}
                                    className="btn btn-danger px-4 py-2 text-sm whitespace-nowrap"
                                >
                                    Disconnect Calendar
                                </button>
                            ) : (
                                <button
                                    onClick={handleConnectGoogleCalendar}
                                    className="btn btn-primary px-4 py-2 text-sm whitespace-nowrap flex items-center gap-2"
                                >
                                    {/* DECISION Phase 88-22 (Req 2), re-affirmed 88-19: Google
                                        LOGO ART — the four brand fills stay raw in every
                                        theme, same exemption class as DieLogo.js. See the
                                        fuller rationale on the identical mark in
                                        LandingPage.js. Not a cleanup.

                                        88-19 (Req 2) tagged each fill `TODO(88-29)` rather
                                        than converting it. That is a REGISTRATION, not a
                                        promise to convert: 88-29 arms the phase's raw-value
                                        gate and needs an explicit exemption list, and a
                                        silent survivor is indistinguishable from a miss.
                                        The correct 88-29 outcome here is "exempt, brand
                                        art", not a token. Tokenising these would repaint
                                        Google's mark per theme, which their brand terms
                                        forbid — and a theme-swapped Google logo is a
                                        licensing problem, not a design one. */}
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>{/* TODO(88-29): brand-art hex, exempt — see marker above */}
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>{/* TODO(88-29): brand-art hex, exempt — see marker above */}
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>{/* TODO(88-29): brand-art hex, exempt — see marker above */}
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>{/* TODO(88-29): brand-art hex, exempt — see marker above */}
                                    </svg>
                                    Connect Google Calendar
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Theme Setting */}
                <div className="card p-3 md:p-6 mb-6">
                    <h2 className="text-xl font-bold text-content-primary mb-1">Theme</h2>
                    <p className="text-sm text-content-muted mb-3">Choose your preferred appearance</p>
                    {/* DECISION Phase 88-10 (Req 5 / F-357): the two theme buttons carry
                        `aria-pressed`, chosen OVER converting them to the `Switch`
                        primitive like the notification toggles further down. A switch
                        models ONE binary thing being on or off; this is a choice between
                        two named appearances, each with its own icon and label, and a
                        third (system) is the obvious future addition. Modelling that as
                        a switch would force "Dark mode: off" to mean "light", which is
                        not what the control says. Toggle-buttons are the right pattern
                        and `aria-pressed` is their state attribute. Converting these to
                        a Switch "for consistency with the toggles below" is a decision
                        about what the control MEANS, not a cleanup. */}
                    {themeMounted ? (
                        <div className="flex gap-3">
                            <button
                                onClick={() => setTheme('light')}
                                aria-pressed={resolvedTheme === 'light'}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                                    resolvedTheme === 'light'
                                        ? 'border-amber-500 bg-amber-50 font-semibold text-content-primary'
                                        : 'border-line bg-surface-card hover:bg-surface-card-hover text-content-secondary'
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                                Light
                            </button>
                            <button
                                onClick={() => setTheme('dark')}
                                aria-pressed={resolvedTheme === 'dark'}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                                    resolvedTheme === 'dark'
                                        ? 'border-amber-500 bg-purple-900 font-semibold text-white'
                                        : 'border-line bg-surface-card hover:bg-surface-card-hover text-content-secondary'
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                </svg>
                                Dark
                            </button>
                        </div>
                    ) : (
                        <div className="h-10 w-48 bg-surface-card-hover rounded-lg animate-pulse" />
                    )}
                </div>

                {/* Timezone Setting */}
                <div className="card p-3 md:p-6 mb-6">
                    <h2 className="text-xl font-bold text-content-primary mb-1">Timezone</h2>
                    <p className="text-sm text-content-secondary mb-3">All event times and schedules use this timezone</p>
                    {/* F-359: the picker is the `Combobox` primitive (88-08). Keyboard
                        operation, Esc AND click-outside close, and focus restore all come
                        from the primitive — the hand-rolled panel this replaces had none of
                        them: it opened on click, closed only on a second click, and its
                        option list was unreachable from the keyboard. Nothing here re-rolls
                        any of that. */}
                    <Combobox
                        aria-label="Timezone"
                        /* 88-CODE-REVIEW MED#2: this picker opens on FOCUS over the full
                           alphabetized IANA list — with the default Enter-selects-first, a
                           keyboard user tabbing in and pressing Enter silently committed
                           "Africa/Abidjan" as their timezone. Enter is inert here until an
                           option is highlighted (arrow keys) or the search narrows it. */
                        selectFirstOnEnter={false}
                        value={tzPickerOpen ? tzSearch : currentTimezoneLabel()}
                        onValueChange={(next) => {
                            setTzSearch(next);
                            if (!tzPickerOpen) setTzPickerOpen(true);
                        }}
                        open={tzPickerOpen}
                        onOpenChange={handleTimezonePickerOpenChange}
                        onFocus={openTimezonePicker}
                        onClick={openTimezonePicker}
                        items={timezoneItems}
                        listLabel="Timezones"
                        emptyLabel="No timezones match your search"
                    />
                </div>

                {/* Notification Preferences Section */}
                {preferences && (
                <div className="card p-3 md:p-6 mb-6">
                    <h2 className="text-xl font-bold text-content-primary mb-1">Notification Preferences</h2>
                    <p className="text-sm text-content-secondary mb-4">Choose how you receive notifications</p>

                    {/* SMS Consent Disclosure (TCPA / carrier compliance) */}
                    {userData?.sms_enabled && (
                        <div className="mb-4 p-3 rounded-card border border-line bg-surface-card-hover">
                            <p className="text-xs font-semibold text-content-primary mb-1">SMS Notifications Disclosure</p>
                            <p className="text-xs text-content-secondary leading-relaxed">
                                By enabling any SMS toggle below, you agree to receive recurring text messages from <span className="font-semibold">NextGameNight</span> about your game group activity, including event creation, updates, cancellations, and reminders. Message frequency varies based on group activity. Message and data rates may apply. Reply <span className="font-mono font-semibold">STOP</span> to unsubscribe at any time, or <span className="font-mono font-semibold">HELP</span> for help. Consent is not a condition of using the service. See our{' '}
                                <a href="/privacy" className="text-content-link hover:underline">Privacy Policy</a>
                                {' '}and{' '}
                                <a href="/terms" className="text-content-link hover:underline">Terms of Service</a>.
                            </p>
                        </div>
                    )}

                    {/* DECISION Phase 88-10 (D-14): the toggles in this matrix fire NO
                        success toast, deliberately — chosen OVER giving every mutation on
                        this page a receipt, which is what Req 12 does everywhere else and
                        is therefore what a reader will assume is missing here.

                        A switch that visibly flips is its own receipt: the control has
                        already moved under the person's finger, and the row's own
                        "Saving…"/"Saved" indicator to its right covers the round trip. A
                        toast per flip turns a four-row matrix into a toast storm on the
                        surface people tune most, and it re-announces a state change the
                        screen reader has already read from the control itself.

                        This exemption is recorded so a missing toast here reads as
                        INTENTIONAL at UAT rather than as a defect. Adding one is a
                        decision, not a consistency fix. The failure path is different and
                        is already handled: a failed toggle rolls the switch back and shows
                        "Error", because there the visible state would otherwise lie. */}
                    {/* Preferences Matrix */}
                    <div className="space-y-0">
                        {/* Verify-phone CTA — only shown to entitled users (sms_enabled=true)
                            who haven't yet verified their number. Click smooth-scrolls to +
                            focuses the phone input above. Non-entitled users never see this. */}
                        {userData?.sms_enabled && !userData?.phone_verified && (
                            <div className="flex items-center justify-end gap-2 pb-2 text-sm">
                                <span className="text-content-secondary">Verify your phone to enable SMS</span>
                                <button
                                    type="button"
                                    onClick={handleVerifyPhoneCta}
                                    className="text-content-link hover:text-content-link-hover font-medium underline"
                                >
                                    Verify
                                </button>
                            </div>
                        )}
                        {/* Header row */}
                        <div className="flex items-center py-2 border-b border-line">
                            <div className="flex-1 text-sm font-medium text-content-muted">Notification Type</div>
                            <div className="w-16 text-center text-sm font-medium text-content-muted">Email</div>
                            {/* SMS column — only rendered for entitled users (sms_enabled=true).
                                Non-entitled users see an Email-only matrix and never know
                                SMS is a feature of the app. */}
                            {userData?.sms_enabled && (
                                <div className="w-16 text-center text-sm font-medium text-content-muted">SMS</div>
                            )}
                            <div className="w-20"></div>
                        </div>

                        {NOTIFICATION_TYPES.map(type => (
                            <div key={type.key} className="py-3 border-b border-line last:border-b-0">
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-content-primary">{type.label}</p>
                                        <p className="text-xs text-content-muted">{type.description}</p>
                                    </div>

                                    {/* Email Toggle — the `Switch` primitive (88-07). Its
                                        widget semantics and checked-state attribute come
                                        from Radix; nothing is hand-authored here, which is
                                        the whole point of adopting it (F-353/357/362). */}
                                    <div className="w-16 flex justify-center">
                                        <Switch
                                            checked={Boolean(preferences[type.key]?.email)}
                                            onCheckedChange={(next) => handleToggle(type.key, 'email', next)}
                                            aria-label={`${type.label} email notifications`}
                                        />
                                    </div>

                                    {/* SMS Toggle — only rendered for entitled users
                                        (sms_enabled=true). Within that, the toggle is
                                        disabled (greyed) until the user has verified their
                                        phone number — three layers of defense preserved
                                        across the primitive swap: the handler guard, the
                                        native disabled prop, and the primitive's own
                                        `disabled:opacity-50`. */}
                                    {userData?.sms_enabled && (
                                        <div className="w-16 flex justify-center">
                                            <Switch
                                                checked={Boolean(preferences[type.key]?.sms)}
                                                onCheckedChange={(next) => userData?.phone_verified && handleToggle(type.key, 'sms', next)}
                                                disabled={!userData?.phone_verified}
                                                aria-label={`${type.label} SMS notifications`}
                                            />
                                        </div>
                                    )}

                                    {/* Status indicator */}
                                    <div className="w-20 text-right">
                                        {rowSaveStatus(saveStatuses, type.key) === 'saving' && (
                                            <span className="text-xs text-content-muted">Saving...</span>
                                        )}
                                        {rowSaveStatus(saveStatuses, type.key) === 'saved' && (
                                            <span className="text-xs text-status-success">Saved</span>
                                        )}
                                        {rowSaveStatus(saveStatuses, type.key) === 'error' && (
                                            <span className="text-xs text-status-error">Error</span>
                                        )}
                                        {rowSaveStatus(saveStatuses, type.key) === 'guard' && (
                                            <span className="text-xs text-status-error">At least one notification must stay enabled</span>
                                        )}
                                    </div>
                                </div>

                                {/* Reminder timing dropdown */}
                                {type.key === 'reminder' && (
                                    <div className="mt-2 ml-0 sm:ml-4 flex items-center gap-2">
                                        <span className="text-xs text-content-muted">Remind me:</span>
                                        {/* The adjacent "Remind me:" span is NOT associated with
                                            this control, so the select shipped with no accessible
                                            name (axe select-name, WCAG 4.1.2 A) — the same
                                            label-with-no-htmlFor idiom found on three other
                                            surfaces this phase. Named explicitly here. */}
                                        {/* `w-auto` is the ONLY geometry override: the primitive
                                            is `block w-full` by design (88-03), which would
                                            stretch this inline dropdown across the whole matrix
                                            row and push its status indicator onto a second line
                                            at phone width. Everything else — the 16px floor, the
                                            44px phone touch height, the ring — comes from the
                                            primitive and must not be re-inlined here. */}
                                        <SelectControl
                                            aria-label="Remind me"
                                            value={preferences.reminder?.window_hours ?? 1}
                                            onChange={(e) => handleReminderWindowChange(parseFloat(e.target.value))}
                                            className="w-auto"
                                        >
                                            {REMINDER_WINDOWS.map(w => (
                                                <option key={w.value} value={w.value}>{w.label}</option>
                                            ))}
                                        </SelectControl>
                                        {saveStatuses[REMINDER_WINDOW_SLOT] === 'saving' && (
                                            <span className="text-xs text-content-muted">Saving...</span>
                                        )}
                                        {saveStatuses[REMINDER_WINDOW_SLOT] === 'saved' && (
                                            <span className="text-xs text-status-success">Saved</span>
                                        )}
                                        {/* ML-16 (87.5 review): the identity-guard and persist-failure
                                            paths both set status 'error' here — without this branch the
                                            dropdown silently snapped back with zero feedback. */}
                                        {saveStatuses[REMINDER_WINDOW_SLOT] === 'error' && (
                                            <span className="text-xs text-status-error">Error</span>
                                        )}
                                    </div>
                                )}
                                {/* Reminder helper text — rewritten from the folded todo
                                    2026-05-09 (UI-SPEC §6.3). It now names WHO is reminded
                                    and WHEN, in one sentence, and covers BOTH systems this
                                    single key drives: the pre-event reminder
                                    (schedulers/reminderScheduler.js) and the check-in nudge
                                    (workers/reminderWorker.js). The old copy described only
                                    the second, in "poll deadline" jargon that predates the
                                    check-in rename, and its second sentence claimed event
                                    create/update/cancel are "always sent" — which reads as
                                    false next to the three toggles directly above it. */}
                                {type.key === 'reminder' && (
                                    <p className="mt-2 ml-0 sm:ml-4 text-sm text-content-secondary">
                                        You&apos;ll get a reminder before events you&apos;re going to, and a nudge while your group is still waiting on your availability.
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Reset status */}
                    {saveStatuses[RESET_SLOT] && (
                        <div className="mt-2 text-center">
                            {saveStatuses[RESET_SLOT] === 'saving' && <span className="text-xs text-content-muted">Resetting...</span>}
                            {saveStatuses[RESET_SLOT] === 'saved' && <span className="text-xs text-status-success">Reset to defaults</span>}
                            {saveStatuses[RESET_SLOT] === 'error' && <span className="text-xs text-status-error">Couldn't reset — try again.</span>}
                        </div>
                    )}

                    {/* Reset to defaults */}
                    <div className="mt-4 text-right">
                        <button
                            onClick={handleResetPreferences}
                            className="text-sm text-content-muted hover:text-content-secondary underline"
                        >
                            Reset to defaults
                        </button>
                    </div>
                </div>
                )}

                {/* Availability Settings Section */}
                {/* id="availability-settings" — scroll target for the invited-branch
                    tutorial handoff (ONBD-04, Phase 73). Read by the
                    ?section=availability useEffect above. */}
                <div id="availability-settings" className="card p-3 md:p-6 mb-6">
                    <h2 className="text-xl font-bold text-content-primary mb-4">Availability Settings</h2>
                    <p className="text-sm text-content-secondary mb-4">
                        Set the times when you are <strong>available</strong> (free) to help groups find the best time to schedule game sessions. 
                        {googleCalendarConnected && ' Your Google Calendar busy times will be automatically excluded from your availability.'}
                    </p>

                    {/* Tab strip — the `Tabs` compound (88-07). The strip's widget
                        semantics, its selected-state attribute, the panel wiring and the
                        arrow-key roving tabindex all come from Radix; the hand-rolled
                        strip this replaces emitted none of them. `availabilityTab` stays
                        the source of truth (controlled) so nothing else on the page moves. */}
                    <Tabs value={availabilityTab} onValueChange={setAvailabilityTab}>
                    <TabsList aria-label="Availability settings" className="mb-4">
                        <TabsTrigger value="recurring">
                            Schedules
                        </TabsTrigger>
                        <TabsTrigger value="specific">
                            Specific Dates
                        </TabsTrigger>
                    </TabsList>

                    {/* Schedules Tab */}
                    <TabsContent value="recurring">
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="text-base font-bold text-content-primary">Availability Schedules</h3>
                                    <p className="text-xs text-content-secondary mt-1">Set your recurring availability schedule</p>
                                </div>
                                <button
                                    onClick={() => setShowRecurringForm(!showRecurringForm)}
                                    className="btn btn-primary px-4 py-2 text-sm"
                                >
                                    {showRecurringForm ? 'Cancel' : '+ Add Schedule'}
                                </button>
                            </div>

                            {showRecurringForm && (
                                <div className="mb-6 p-4 border border-line rounded-lg bg-surface-page">
                                    <h4 className="text-base font-bold mb-3 text-content-primary">New Schedule</h4>
                                    <div className="space-y-3">
                                        <div>
                                            {/* Not a <label>: this names a GROUP of toggle
                                                buttons, not a single form control, and a label
                                                with no control is a label pointing at nothing. */}
                                            <span id="days-of-week-label" className="block text-sm font-medium text-content-secondary mb-1">Days of Week</span>
                                            <div role="group" aria-labelledby="days-of-week-label" className="flex flex-wrap gap-2 mt-1">
                                                {[0, 1, 2, 3, 4, 5, 6].map(day => (
                                                    <button
                                                        key={day}
                                                        type="button"
                                                        onClick={() => {
                                                            const days = recurringForm.daysOfWeek;
                                                            setRecurringForm({
                                                                ...recurringForm,
                                                                daysOfWeek: days.includes(day)
                                                                    ? days.filter(d => d !== day)
                                                                    : [...days, day].sort((a, b) => a - b)
                                                            });
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                                            recurringForm.daysOfWeek.includes(day)
                                                                ? 'bg-btn-primary text-btn-primary-text border-btn-primary'
                                                                : 'bg-surface-card text-content-secondary border-line hover:border-line-accent'
                                                        }`}
                                                    >
                                                        {getDayName(day).slice(0, 3)}
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRecurringForm({
                                                            ...recurringForm,
                                                            daysOfWeek: recurringForm.daysOfWeek.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6]
                                                        });
                                                    }}
                                                    className="px-3 py-1.5 rounded-btn text-sm font-medium border border-line text-content-secondary hover:border-line-accent transition-colors"
                                                >
                                                    {recurringForm.daysOfWeek.length === 7 ? 'Clear' : 'All'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label htmlFor="recurring-start-time" className="block text-sm font-medium text-content-secondary mb-1">Available From (Start Time)</label>
                                                <Input
                                                    id="recurring-start-time"
                                                    type="time"
                                                    value={recurringForm.startTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, startTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become available</p>
                                            </div>
                                            <div>
                                                <label htmlFor="recurring-end-time" className="block text-sm font-medium text-content-secondary mb-1">Available Until (End Time)</label>
                                                <Input
                                                    id="recurring-end-time"
                                                    type="time"
                                                    value={recurringForm.endTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, endTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become unavailable</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label htmlFor="recurring-start-date" className="block text-sm font-medium text-content-secondary mb-1">Start Date</label>
                                                <Input
                                                    id="recurring-start-date"
                                                    type="date"
                                                    value={recurringForm.start_date}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, start_date: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label htmlFor="recurring-end-date" className="block text-sm font-medium text-content-secondary mb-1">End Date (Optional)</label>
                                                <Input
                                                    id="recurring-end-date"
                                                    type="date"
                                                    value={recurringForm.end_date}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, end_date: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleCreateRecurringPattern}
                                            disabled={savingPattern}
                                            className="btn btn-primary w-full px-4 py-2 disabled:opacity-50"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Schedule'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {loadingPatterns ? (
                                <p className="text-content-secondary">Loading schedules...</p>
                            ) : patternsError.showError ? (
                                <FetchErrorBanner
                                    state={patternsError}
                                    title="Couldn't load your schedules"
                                    reportSubject="Couldn't load availability patterns on /userProfile"
                                    reportContext="userProfile — availability schedules tab"
                                />
                            ) : (
                                <div className="space-y-2">
                                    {availabilityPatterns
                                        .filter(p => p.type === 'recurring_pattern')
                                        .map(pattern => (
                                            <div key={pattern.id} className="p-3 border border-line rounded-lg flex justify-between items-center">
                                                <div>
                                                    <p className="font-medium text-content-primary">
                                                        {getDayName(pattern.pattern_data.dayOfWeek)}: {pattern.pattern_data.startTime} - {pattern.pattern_data.endTime}
                                                    </p>
                                                    <p className="text-sm text-content-secondary">
                                                        {formatDate(pattern.start_date)} - {formatDate(pattern.end_date)}
                                                    </p>
                                                </div>
                                                {(() => {
                                                    const patternLabel = `${getDayName(pattern.pattern_data.dayOfWeek)} schedule`;
                                                    return (
                                                        <button
                                                            {...deletePatternGate.triggerProps(
                                                                pattern.id,
                                                                patternLabel,
                                                                `Delete ${patternLabel}`
                                                            )}
                                                            // DECISION Phase 88-27 (D-32 bucket D): the stripped hover was a TEXT
                                                            // alpha; it returns as a subtle SURFACE. Full reasoning at the twin
                                                            // marker on friends/page.js's Remove-friend gate.
                                                            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-btn px-2 text-sm text-status-error hover:bg-status-error-subtle focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring ${
                                                                deletePatternGate.isArmed(pattern.id) ? 'font-semibold' : ''
                                                            }`}
                                                        >
                                                            {deletePatternGate.labelFor(pattern.id, 'Delete')}
                                                        </button>
                                                    );
                                                })()}
                                            </div>
                                        ))}
                                    {availabilityPatterns.filter(p => p.type === 'recurring_pattern').length === 0 && (
                                        <p className="text-content-secondary text-sm">No schedules set. Add one to get started!</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    {/* Specific Dates Tab */}
                    <TabsContent value="specific">
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="text-base font-bold text-content-primary">Specific Date Overrides</h3>
                                    <p className="text-xs text-content-secondary mt-1">Override your schedules for specific dates</p>
                                </div>
                                <button
                                    onClick={() => setShowSpecificForm(!showSpecificForm)}
                                    className="btn btn-primary px-4 py-2 text-sm"
                                >
                                    {showSpecificForm ? 'Cancel' : '+ Add Override'}
                                </button>
                            </div>

                            {showSpecificForm && (
                                <div className="mb-6 p-4 border border-line rounded-lg bg-surface-page">
                                    <h4 className="text-base font-bold mb-3 text-content-primary">New Specific Override</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label htmlFor="specific-date" className="block text-sm font-medium text-content-secondary mb-1">Date</label>
                                            <Input
                                                id="specific-date"
                                                type="date"
                                                value={specificForm.date}
                                                onChange={(e) => setSpecificForm({ ...specificForm, date: e.target.value })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label htmlFor="specific-start-time" className="block text-sm font-medium text-content-secondary mb-1">Available From (Start Time)</label>
                                                <Input
                                                    id="specific-start-time"
                                                    type="time"
                                                    value={specificForm.startTime}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, startTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become available</p>
                                            </div>
                                            <div>
                                                <label htmlFor="specific-end-time" className="block text-sm font-medium text-content-secondary mb-1">Available Until (End Time)</label>
                                                <Input
                                                    id="specific-end-time"
                                                    type="time"
                                                    value={specificForm.endTime}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, endTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become unavailable</p>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2">
                                                {/* DECISION Phase 88-19 (Req 1): this stays a NATIVE
                                                    checkbox and is deliberately NOT routed through
                                                    the `Input` primitive like the seven date/time
                                                    controls above it. iOS focus-zoom is a TEXT-ENTRY
                                                    behaviour — a checkbox has no text to zoom — and
                                                    the primitive's `block w-full p-2` would stretch
                                                    the box across the whole form. Same exclusion, on
                                                    the same grounds, as gameDetail's recommend
                                                    checkbox (88-20). The Req 1 test pin excludes it
                                                    BY TYPE, so adding it here would fail. */}
                                                <input
                                                    type="checkbox"
                                                    checked={specificForm.isAvailable}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, isAvailable: e.target.checked })}
                                                    className="rounded-sm"
                                                />
                                                <span className="text-sm text-content-secondary">Mark as available (uncheck to mark as busy)</span>
                                            </label>
                                        </div>
                                        <button
                                            onClick={handleCreateSpecificOverride}
                                            disabled={savingPattern}
                                            className="btn btn-primary w-full px-4 py-2 disabled:opacity-50"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Override'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {loadingPatterns ? (
                                <p className="text-content-secondary">Loading overrides...</p>
                            ) : patternsError.showError ? (
                                <FetchErrorBanner
                                    state={patternsError}
                                    title="Couldn't load your overrides"
                                    reportSubject="Couldn't load availability patterns on /userProfile"
                                    reportContext="userProfile — specific overrides tab"
                                />
                            ) : (
                                <div className="space-y-2">
                                    {availabilityPatterns
                                        .filter(p => p.type === 'specific_override')
                                        .map(pattern => (
                                            <div key={pattern.id} className="p-3 border border-line rounded-lg flex justify-between items-center">
                                                <div>
                                                    <p className="font-medium text-content-primary">
                                                        {formatDate(pattern.pattern_data.date)}: {pattern.pattern_data.startTime} - {pattern.pattern_data.endTime}
                                                    </p>
                                                    <p className="text-sm text-content-secondary">
                                                        {pattern.is_available ? 'Available' : 'Busy'}
                                                    </p>
                                                </div>
                                                {(() => {
                                                    const patternLabel = `${formatDate(pattern.pattern_data.date)} override`;
                                                    return (
                                                        <button
                                                            {...deletePatternGate.triggerProps(
                                                                pattern.id,
                                                                patternLabel,
                                                                `Delete ${patternLabel}`
                                                            )}
                                                            // DECISION Phase 88-27 (D-32 bucket D): the stripped hover was a TEXT
                                                            // alpha; it returns as a subtle SURFACE. Full reasoning at the twin
                                                            // marker on friends/page.js's Remove-friend gate.
                                                            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-btn px-2 text-sm text-status-error hover:bg-status-error-subtle focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring ${
                                                                deletePatternGate.isArmed(pattern.id) ? 'font-semibold' : ''
                                                            }`}
                                                        >
                                                            {deletePatternGate.labelFor(pattern.id, 'Delete')}
                                                        </button>
                                                    );
                                                })()}
                                            </div>
                                        ))}
                                    {availabilityPatterns.filter(p => p.type === 'specific_override').length === 0 && (
                                        <p className="text-content-secondary text-sm">No specific overrides set. Add one to override your default availability!</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </TabsContent>
                    </Tabs>
                </div>

                {/* Tutorial Section */}
                <div className="card p-3 md:p-6 mb-6">
                    <h2 className="text-xl font-bold text-content-primary mb-2">Tutorial</h2>
                    <p className="text-sm text-content-secondary mb-4">
                        Need a refresher on how to use Next Game Night? Replay the onboarding tutorial to walk through the key features.
                    </p>
                    <button
                        onClick={handleReplayTutorial}
                        disabled={replayingTutorial}
                        className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50"
                    >
                        {replayingTutorial ? 'Starting...' : 'Replay Tutorial'}
                    </button>
                </div>

                {/* Owned Games Section */}
                <div className="card p-3 md:p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                        <h2 className="text-xl font-bold text-content-primary">My Game Collection ({ownedGames.length})</h2>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowBggSearch(!showBggSearch)}
                                className="btn btn-primary px-4 py-2 text-sm whitespace-nowrap"
                            >
                                {showBggSearch ? 'Hide Search' : '+ Add from BGG'}
                            </button>
                        </div>
                    </div>

                    {/* BGG Collection Import */}
                    <div className="mb-6 p-3 md:p-4 border border-line rounded-lg bg-surface-page">
                        <h3 className="text-base font-bold mb-2 text-content-primary">Import Your Entire BGG Collection</h3>
                        <p className="text-xs md:text-sm text-content-secondary mb-3">
                            Enter your BoardGameGeek username to import all games from your BGG collection at once.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            {/* This and the BGG search field below shipped as 14px promoted
                                to 16px at a breakpoint — the exact anti-pattern §8.2 names.
                                `md` is the breakpoint phones sit BELOW, so the variant
                                applied the un-zoomable size to desktop and the zooming size
                                to the only viewport that suffers from it. The primitive
                                carries 16px unconditionally and must not be re-variant-ed.
                                (Spelled out in words rather than the utility itself so a
                                grep-based gate does not match this comment.) */}
                            <Input
                                aria-label="BoardGameGeek username"
                                value={bggUsername}
                                onChange={(e) => setBggUsername(e.target.value)}
                                placeholder="Your BGG username"
                                className="flex-1"
                                disabled={importingCollection}
                            />
                            <button
                                onClick={handleImportCollectionClick}
                                disabled={importingCollection || !bggUsername.trim()}
                                className="btn btn-primary px-4 md:px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm md:text-base whitespace-nowrap"
                            >
                                {importingCollection ? 'Importing...' : 'Import Collection'}
                            </button>
                        </div>
                        {importProgress && (
                            <div className={`mt-3 p-3 rounded-btn ${
                                importProgress.status === 'error' ? 'bg-status-error-subtle text-status-error' :
                                importProgress.status === 'complete' ? 'bg-status-success-subtle text-status-success' :
                                'bg-surface-card-hover text-content-link'
                            }`}>
                                <p className="font-medium">{importProgress.message}</p>
                                {importProgress.details && (
                                    <p className="text-sm mt-1">
                                        Imported: {importProgress.details.imported} | 
                                        Skipped (already owned): {importProgress.details.skipped} | 
                                        Total: {importProgress.details.total}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* BGG Search */}
                    {showBggSearch && (
                        <div className="mb-6 p-3 md:p-4 border border-line rounded-sm bg-surface-page">
                            <div className="flex flex-col sm:flex-row gap-2 mb-3">
                                <Input
                                    aria-label="Search BoardGameGeek"
                                    value={bggSearchQuery}
                                    onChange={(e) => setBggSearchQuery(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && searchBGG()}
                                    placeholder="Search BoardGameGeek..."
                                    className="flex-1"
                                />
                                <button
                                    onClick={searchBGG}
                                    disabled={bggSearching || !bggSearchQuery.trim()}
                                    className="btn btn-primary px-4 py-2 disabled:opacity-50 text-sm md:text-base whitespace-nowrap"
                                >
                                    {bggSearching ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                            
                            {bggSearchResults.length > 0 && (
                                <div className="max-h-60 overflow-y-auto space-y-2">
                                    {bggSearchResults.map((result) => {
                                        const isAlreadyOwned = ownedGames.some(g => g.bgg_id === result.bgg_id);
                                        return (
                                            <div key={result.bgg_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-surface-card border border-line rounded-btn">
                                                <span className="text-sm text-content-primary wrap-break-word flex-1 min-w-0">
                                                    {result.name} {result.year_published ? `(${result.year_published})` : ''}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => addGameToCollection(result.bgg_id)}
                                                    disabled={isAlreadyOwned}
                                                    className="btn btn-primary text-xs px-3 py-1 disabled:opacity-50 whitespace-nowrap shrink-0"
                                                >
                                                    {isAlreadyOwned ? 'Already Owned' : 'Add to Collection'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Owned Games List */}
                    {selfIdentityErrorState.showError ? (
                        // WR-03: identity failed terminally — the owned-games
                        // fetch never ran; surface the degrade notice instead of
                        // a permanent "Loading your collection...".
                        <FetchErrorBanner state={selfIdentityErrorState} compact />
                    ) : loadingGames ? (
                        <p className="text-content-secondary">Loading your collection...</p>
                    ) : ownedGames.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {ownedGames.map((game) => (
                                <div key={game.id} className="border border-line rounded-lg p-4 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1">
                                            <h3 className="text-base font-bold text-content-primary">{game.name}</h3>
                                            {game.year_published && (
                                                <p className="text-sm text-content-secondary">({game.year_published})</p>
                                            )}
                                        </div>
                                        {/* Two-tap gate. The accessible name names the ACTION
                                            and the OBJECT (F-369) — a bare glyph is not a
                                            name, and the `title` it used to carry does not
                                            count (§7.3). Armed state swaps the visible label
                                            AND the name together (Label-in-Name, WCAG 2.5.3),
                                            both from the hook. */}
                                        <button
                                            {...removeGameGate.triggerProps(
                                                game.id,
                                                game.name,
                                                `Remove ${game.name}`
                                            )}
                                            className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-btn px-2 text-sm text-status-error hover:text-red-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring ${
                                                removeGameGate.isArmed(game.id) ? 'font-semibold' : ''
                                            }`}
                                        >
                                            {removeGameGate.labelFor(game.id, '×')}
                                        </button>
                                    </div>
                                    <SafeImage
                                        src={game.image_url}
                                        alt={game.name}
                                        className="w-full h-32 object-cover rounded-sm mb-2"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-content-secondary">You don't have any games in your collection yet. Search BoardGameGeek to add games!</p>
                    )}
                </div>

                {/* Danger Zone — irreversible account deletion (Phase 87.2 / D-13).
                    The component owns its own modal-open blockers fetch; the page
                    stays thin (mount only, no inline flow logic). */}
                <div className="mt-6">
                    <DangerZoneDeleteAccount />
                </div>

                {/* The three tiered gates, mounted ONCE at page level rather than per
                    row: the hook holds the target id, so one dialog serves every row.
                    Each `statusNode` is likewise mounted unconditionally and always —
                    a live region that is conditionally mounted announces nothing. The
                    two two-tap gates render a null dialog by design (88-05), and they
                    are mounted anyway so retiering stays the one-word edit. */}
                <ConfirmDialog {...disconnectCalendarGate.dialogProps} />
                {disconnectCalendarGate.statusNode}
                <ConfirmDialog {...removeGameGate.dialogProps} />
                {removeGameGate.statusNode}
                <ConfirmDialog {...deletePatternGate.dialogProps} />
                {deletePatternGate.statusNode}

                {/* Slow-operation warning, NOT a destructive gate (D-10) — see the
                    marker on `handleImportCollectionClick`. Dismissable, and its
                    primary action is the neutral verb the old prompt ended on. */}
                <Modal open={bggImportPromptOpen} onClose={() => setBggImportPromptOpen(false)}>
                    <Modal.Header>Import your BGG collection?</Modal.Header>
                    <Modal.Body>
                        <p className="text-base text-content-secondary">
                            This imports every game from your BoardGameGeek collection (username:{' '}
                            <span className="font-semibold text-content-primary">{bggUsername}</span>
                            ). It may take a few minutes.
                        </p>
                    </Modal.Body>
                    <Modal.Footer>
                        <Modal.Action variant="secondary" onClick={() => setBggImportPromptOpen(false)}>
                            Cancel
                        </Modal.Action>
                        <Modal.Action variant="primary" onClick={importBGGCollection}>
                            Continue
                        </Modal.Action>
                    </Modal.Footer>
                </Modal>

                {/* PRIM-03: the patterns-fetch bug-report modal now lives inside
                    FetchErrorBanner (rendered per-tab), so the page-level mount is gone. */}
            </div>
        )
    );
}

export default Profile;