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
// 88-33 Task 9 (fork 1, RULED 2026-08-17): pattern times print 12-hour everywhere.
import { formatTime } from '../../lib/datetime';
import SafeImage from '../components/SafeImage';
import DangerZoneDeleteAccount from '../components/DangerZoneDeleteAccount';
// Phase 88.8 plan 13. NO_ADDRESS_ON_FILE is IMPORTED rather than re-spelled: the
// header below renders the same fixed string as the section does when the
// resolved address is the provisioning sentinel, and two spellings of one fixed
// string on one page is the drift this phase keeps finding.
import { EmailAddressSection, NO_ADDRESS_ON_FILE } from '../components/EmailAddressSection';
import { isSyntheticAddress } from '../../lib/syntheticAddress';
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
import { StatusRegion } from '../../components/ui/StatusRegion';
import { Input, SelectControl } from '../../components/ui/Input';
import { ErrorFallback } from '../../components/ui/ErrorFallback';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
// AC-2 convert-on-touch (owner ruling 2026-09-09; LEVEL AMENDED 2026-09-13). This file's
// 20 raw console calls route through the house logger at `info`, which is
// Sentry.addBreadcrumb (logger.ts:34-36) — a BREADCRUMB, not an event. `errCtx` is the
// shared name+message builder (88.6-13); the raw Error is never passed as `ctx`.
import { logger, errCtx } from '../../lib/logger';

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
   heading sizes: a heading that grows at a breakpoint is a second scale.

   ——— AMENDED Phase 88.6-17, 2026-09-16 (D-04 / D-05) ———
   All FOURTEEN headings on this surface now render through the `Heading` primitive,
   so the three roles above are supplied by `size` — `display` (30), `heading` (20),
   `body` (16) — and the 700 by the primitive's own cva base, instead of by class
   strings at each site. Nothing about the ROLES changed and every LEVEL is preserved
   (P4); only where they come from did. Two consequences worth stating, because a
   reader who greps this file for `text-xl` or `font-bold` on a heading will now find
   nothing: the weight is no longer overridable at a call site (which is the point —
   §4.2 states 700/400 as a prohibition on 600), and the three heading tags that
   appear in COMMENT PROSE further down are prose, not markup, and were deliberately
   left alone. The h4-at-16 pair is `size="body"`: D-04's table has no h4@16 row, and
   16 is a rung, so "stays" is the mechanical read — recorded rather than assumed. */

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

    /* DECISION Phase 88.6-17 (R2 #29 / T-88.6-146, T-88.6-147): the two phone-flow senders
       carry a SYNCHRONOUS in-flight latch as their handler's first statement, released in a
       `finally` — chosen OVER relying on the rendered gate alone.

       WHICH WINDOW THE SHIPPED GUARD COVERS. `handleResendCode`'s `if (… || resendCooldown > 0)`
       early return guards the COOLDOWN window ONLY: `setResendCooldown(60)` runs AFTER the
       `await usersAPI.savePhone(...)`, so `resendCooldown` is still 0 for the whole in-flight
       window and that guard PASSES. D-8 removes this control's native `disabled` attribute, and
       `aria-disabled` refuses nothing at the DOM level — so without the latch a second press
       while the first request is in flight dispatches a second outbound SMS, the one per-press
       money cost in this phase. The same shape applies to Save & Verify once its in-flight arm
       moves to `aria-disabled` (R3 #13): the pressed control now SURVIVES the submit, which is
       the point, and a surviving control can be pressed again.

       Both halves land together or neither does: an `aria-disabled` control with no handler
       refusal is a re-submittable button. Removing either one is a decision, not a cleanup. */
    const saveInFlightRef = useRef(false);
    const resendInFlightRef = useRef(false);
    /* R2 #29, second defect: the cooldown ticker used to be a LOCAL `const timer`, cleared only
       by its own tick — nothing cancelled it on unmount. Held in a ref and cleared in the
       existing unmount effect below, alongside removeArmedTimerRef. */
    const resendTimerRef = useRef(null);

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

    /* 88-CODE-REVIEW MED#15: SR announcements for save OUTCOMES. The Radix Switch
       announces the optimistic aria-checked flip immediately, so a failed save's
       visual-only rollback left a screen-reader user believing the toggle took.
       Two always-mounted sr-only regions (StatusRegion's empty-first contract):
       polite for 'saved', assertive (role=alert) for 'error' and the guard —
       they explain a rejected/reverted action. 'saving' is deliberately NOT
       announced: transient, and the outcome announcement covers the round trip. */
    const [politeSaveAnnouncement, setPoliteSaveAnnouncement] = useState('');
    const [assertiveSaveAnnouncement, setAssertiveSaveAnnouncement] = useState('');
    const saveSlotLabel = (key) => {
        if (key === REMINDER_WINDOW_SLOT) return 'Reminder timing';
        const [typeKey, channel] = key.split(':');
        const t = NOTIFICATION_TYPES.find(x => x.key === typeKey);
        return `${t?.label || typeKey} ${channel || ''} notifications`.replace(/\s+/g, ' ').trim();
    };

    const setSaveStatus = useCallback((key, status, clearAfterMs) => {
        setSaveStatuses(prev => ({ ...prev, [key]: status }));
        // Delta review 2026-08-06 (MED x2 on the MED#15 wiring):
        //  - RESET_SLOT gets its own copy — the generic template produced the
        //    garbled "all reset notifications" label, and its error line claimed
        //    "the switch was reset" for an action that has no switch and did NOT
        //    reset. Error copy mirrors the visible text at the reset button.
        //  - Announcements are CLEARED by the same timer that clears the visual
        //    status (below). aria-live fires on DOM CHANGE only, so a second
        //    identical outcome (same toggle re-flipped; the guard hit twice) was
        //    a React state bail-out — announced once, silent forever after.
        if (status === 'saved') {
            setPoliteSaveAnnouncement(
                key === RESET_SLOT
                    ? 'Notification preferences reset to defaults'
                    : `${saveSlotLabel(key)}: saved`
            );
        } else if (status === 'error') {
            setAssertiveSaveAnnouncement(
                key === RESET_SLOT
                    ? "Couldn't reset notification preferences — try again"
                    : `${saveSlotLabel(key)}: save failed — the switch was reset`
            );
        } else if (status === 'guard') {
            setAssertiveSaveAnnouncement('At least one notification must stay enabled');
        }
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
            // Empty the live regions with the visual clear — StatusRegion's
            // empty-first contract; the next identical outcome is then a real
            // DOM change and announces again.
            setPoliteSaveAnnouncement('');
            setAssertiveSaveAnnouncement('');
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
       Filtering ~400 strings per keystroke is cheap; constructing the list is not.
       Delta review 2026-08-06 (LOW): cached across REOPENS too via ref — closing the
       picker no longer evicts the built list. The F-359 page-load gate still holds
       (nothing builds until the first open); the cache invalidates with the builder's
       identity, which changes only when `timezone` does (its fallback branch). */
    const tzListCacheRef = useRef({ builder: null, list: [] });
    const allTimezones = useMemo(() => {
        if (!tzPickerOpen) return []; // closed shape unchanged; the CACHE survives the close
        if (tzListCacheRef.current.builder !== getTimezoneList) {
            tzListCacheRef.current = { builder: getTimezoneList, list: getTimezoneList() };
        }
        return tzListCacheRef.current.list;
    }, [tzPickerOpen, getTimezoneList]);

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
                    <span
                        aria-current={tz.value === timezone ? 'true' : undefined}
                        className={tz.value === timezone ? 'text-content-link' : undefined}
                    >
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
            logger.info('Error replaying tutorial:', errCtx(error));
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
        // R3 #13 / T-88.6-147: the in-flight refusal, synchronous and FIRST. The rendered
        // control is `aria-disabled` while saving, not natively `disabled`, so it stays in the
        // document (and keeps focus) — see the marker on `saveInFlightRef`.
        if (saveInFlightRef.current) return;
        if (!user?.sub || !phoneValidation.valid) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        saveInFlightRef.current = true;
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
            logger.info('Error saving phone:', errCtx(error));
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't send the code. Check the number and try again.",
                    byCode: { validation: "That number wasn't accepted. Check it and try again." },
                })
            );
            setPhoneState('editing');
        } finally {
            // Released in `finally` so a FAILED request does not strand the control.
            saveInFlightRef.current = false;
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
            logger.info('Error verifying code:', errCtx(error));
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
        // R2 #29 / T-88.6-146: the IN-FLIGHT refusal, synchronous and FIRST. The line below
        // guards the COOLDOWN window only — `setResendCooldown(60)` runs after the await, so
        // during the request `resendCooldown` is still 0 and that guard passes. This control's
        // per-press side effect is an outbound SMS.
        if (resendInFlightRef.current) return;
        if (!user?.sub || resendCooldown > 0) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        resendInFlightRef.current = true;
        try {
            setPhoneError(null);
            await usersAPI.savePhone(selfUuid, phoneInput);
            setResendCooldown(60);
            if (resendTimerRef.current) clearInterval(resendTimerRef.current);
            resendTimerRef.current = setInterval(() => {
                setResendCooldown(prev => {
                    if (prev <= 1) {
                        clearInterval(resendTimerRef.current);
                        resendTimerRef.current = null;
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } catch (error) {
            logger.info('Error resending code:', errCtx(error));
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't resend the code. Please try again.",
                })
            );
        } finally {
            // Released in `finally` so a FAILED resend does not strand the control.
            resendInFlightRef.current = false;
        }
    };

    // Cleanup the two-tap revert timer on unmount (mirrors KebabMenu lines 64-71).
    // R2 #29: the resend cooldown ticker is cleared HERE too — an ADDITION to this effect's
    // body, deliberately not a second unmount effect.
    useEffect(() => {
        return () => {
            if (removeArmedTimerRef.current) {
                clearTimeout(removeArmedTimerRef.current);
                removeArmedTimerRef.current = null;
            }
            if (resendTimerRef.current) {
                clearInterval(resendTimerRef.current);
                resendTimerRef.current = null;
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
            logger.info('Error removing phone:', errCtx(error));
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
            logger.info('Error updating preference:', errCtx(error));
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
            logger.info('Error updating reminder window:', errCtx(error));
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
            logger.info('Error resetting preferences:', errCtx(error));
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
        /* DECISION Phase 88.8 (plan 13 Task 3(d)): the THREE username-fallback
           chains that derive a display NAME from the session email's local part
           — this one, the terminal-arm one above, and the edit-cancel one in the
           header below — are a DELIBERATE NON-CHANGE, together with the
           `user?.email` entry in this effect's dependency array (which must keep
           listing it while those chains exist). Chosen OVER converging them onto
           the app address in the same pass that fixed the three ADDRESS sites.

           WHY EACH ONE STAYS:
           - The terminal-arm chain runs inside `selfQuery.isError`, where `self`
             is unavailable BY DEFINITION. There is no app address to use there;
             it is not fixable, only removable.
           - This chain and the header's sit behind `self.username ||` and
             `userData?.username ||`. After this phase provisioning always writes
             a non-empty username (`models/User.js` `username` is NOT NULL with a
             len[1,50] backstop, and plan 04's chain ends in the 'User' literal),
             so these arms are unreachable in practice.
           - Changing them would plant a THIRD spelling of the fallback for no
             visible effect, and would spread email-derived display names — the
             same shape plan 04 is removing from the backend chain.

           AND `isSyntheticAddress` IS DELIBERATELY NOT APPLIED HERE. That helper
           guards ADDRESSES — values rendered or transmitted as a way to reach
           someone. These four sites consume the SESSION email's local part as a
           display NAME, which is a different thing with a different failure
           mode, and the session email is never synthetic anyway (the sentinel
           lives in `Users.email`, not in the Auth0 claim). Applying it here would
           spread the address rule onto a name path. `src/lib/syntheticAddress.ts`
           names these same lines as its excluded sites; the two records must
           agree, so amend both or neither.

           This is a RECORDED NON-CHANGE under the milestone-tenet rule, not
           deferred debt. */
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
            logger.info('Error updating username:', errCtx(error));
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
            logger.info('Error checking Google Calendar status:', errCtx(error));
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
            logger.info('Error disconnecting Google Calendar:', errCtx(error));
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
            logger.info('Error fetching owned games:', errCtx(error));
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
            logger.info('Error searching BGG:', errCtx(error));
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
            logger.info('Error adding game to collection:', errCtx(error));
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
            logger.info('Error removing game from collection:', errCtx(error));
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
        /* DECISION Phase 88-33 Task 5 (fork 7, RULED 2026-08-17, owner's own proposal):
           a GLYPH resting state arms into the labeled verb 'Remove' — chosen OVER the
           hook's default armed copy, which reads as instruction text and left the walk
           unsure what the armed state would do. Applies where the resting label is a
           bare ×; controls whose resting label is already 'Remove' keep the default
           armed copy (gameDetail see-all). Reverting to the default here re-opens walk
           row 381; that is a decision, not a consistency cleanup. */
        armedLabel: 'Remove',
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
            logger.info('Error creating schedule:', errCtx(error));
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
            logger.info('Error creating specific override:', errCtx(error));
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
            logger.info('Error deleting pattern:', errCtx(error));
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
            logger.info('Error importing BGG collection:', errCtx(error));
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

    /* DECISION Phase 88.6-17 (AC-2): the Auth0 session-error report is a GUARDED TOP-LEVEL
       EFFECT — chosen OVER the IN-PLACE swap every one of this file's other nineteen
       converted sites gets, and over escalating this one site to `logger.error`.

       WHY NOT THE IN-PLACE SWAP. The report it replaces executed in the component's RENDER
       BODY, inside the `if (error)` branch below — not in a handler, not in an effect. An
       unlatched render-body report re-enters on EVERY paint, and the Sentry breadcrumb buffer
       is finite (`@sentry/core/build/cjs/breadcrumbs.js:11`, DEFAULT_BREADCRUMBS = 100; nothing
       sets `maxBreadcrumbs` in `sentry.client.config.js`). So an in-place swap would evict
       every other breadcrumb in the session and destroy the diagnostic value of whatever event
       that session later files. That is the same unbounded per-paint flood
       `src/lib/colorUtils.js:583-602` already litigated and rejected — including the tempting
       escape hatch, since `dedupeIntegration` compares only against the immediately preceding
       event. That precedent is worded in EVENTS and these calls emit none; it is cited anyway
       because it is the shipped LATCH idiom, and a latch is what an unbounded per-paint report
       needs at ANY level.

       WHY NOT `logger.error` HERE. (1) AC-2's uniformity is the property the owner's ruling
       bought — executors do not re-decide the level per call. (2) It would not even deliver a
       diagnostic: Auth0's `RequestError` calls a bare `super()` and carries its only detail on
       `.status` (`@auth0/nextjs-auth0/dist/client/use-user.js`), so the message is empty and
       the name is 'Error', and no extra-error-data integration is configured to carry `.status`
       into the payload. An escalation here would file an empty-valued, fingerprint-collapsed
       issue strictly LESS informative than the line it replaced.

       The guard is part of the requirement, not a refinement: without it the effect fires on an
       error-free load. `@auth0/nextjs-auth0`'s `error` identity is stable across renders, so a
       guarded effect keyed on it reports once per distinct error. It is declared HERE, above the
       early returns, because a hook inside the `if (error)` block is a conditional hook the
       `react-hooks` rules reject. */
    useEffect(() => {
        if (!error) return;
        logger.info('Auth0 session error on /userProfile:', errCtx(error));
    }, [error]);

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
       on that phrase across this file.

       ——— AMENDED Phase 88.6-17, 2026-09-16 (D12 / AC-2) ———
       Clause (1)'s last sentence described a CHANNEL this file no longer has. Under AC-2's
       convert-on-touch gate the developer-facing detail now travels as a Sentry BREADCRUMB,
       emitted from the guarded top-level effect declared above, rather than to the browser's
       developer output. The security half is UNCHANGED and is the load-bearing half: the
       fallback still takes NO error prop by contract (ASVS V7), so no upstream message can
       reach the DOM, and the move changes only where the developer detail goes — it does not
       delete the report. The rest of this marker stands as written. */
    if (error) {
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
                        {/* DECISION Phase 88.6-17 (A10 / T-88.6-43 + R3 finding 144): this dismiss stays a
                            RAW `<button>` and is floored to 44x44 IN PLACE — chosen OVER migrating it
                            to the primitive as an icon-sized ghost. `.btn`'s unlayered
                            `font-size: .875rem` would shrink the `×` glyph, and `.btn`'s padding would
                            widen a control that has to sit flush in a `flex items-start` banner row.
                            `inline-flex` + `min-h-11 min-w-11` + `items-center justify-center` supply the
                            floor without changing the glyph's own size or the row's rhythm; the negative
                            `-m-2` keeps the banner's visual padding unchanged while the TAP TARGET grows
                            outward. The INK classes and the glyph's `text-lg` icon sizing are
                            byte-unchanged (§4.3: a glyph-only control is icon sizing, never a type rung).
                            The focus ring is the house string `globals.css` states verbatim, added
                            PER-SITE under the rule recorded there — this control carried none, so a
                            keyboard or switch user got only whatever the UA supplies. */}
                        <button
                            type="button"
                            onClick={() => setSmsDisabledBannerDismissed(true)}
                            className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-btn text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 text-lg leading-none shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                            aria-label="Dismiss"
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* Breadcrumbs. Owner ruling 175 (2026-09-14): every breadcrumb `<nav>` in the
                    tree carries an accessible NAME, so it does not announce as one more unnamed
                    navigation landmark beside the page's others. This plan owns one of the five;
                    plans 18 and 21 own the other four. */}
                <nav aria-label="Breadcrumb" className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                    <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors">Home</Link>
                    <span className="text-content-muted mx-2">{'>'}</span>
                    {/* DECISION Phase 88.6-17 (D-03 emphasis / T-88.6-138): the current-page span
                        takes 400 plus a colour token, and gains `aria-current="page"` in the SAME
                        edit — chosen OVER the colour token alone. Its `font-semibold` was the only
                        thing distinguishing it from the sibling link; once that becomes 400, colour
                        is the sole remaining VISUAL cue, so the state is exposed programmatically
                        as well. Dropping `aria-current` later is a decision, not a cleanup. */}
                    <span aria-current="page" className="text-content-primary font-normal">Profile</span>
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
                                            <Button
                                                variant="primary"
                                                onClick={handleSaveUsername}
                                                disabled={savingUsername || !username.trim()}
                                                className="whitespace-nowrap"
                                            >
                                                {savingUsername ? 'Saving...' : 'Save'}
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                onClick={() => {
                                                    setEditingUsername(false);
                                                    setUsername(userData?.username || user.name || user.email?.split('@')[0] || '');
                                                }}
                                                disabled={savingUsername}
                                                className="whitespace-nowrap"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                        <p className="text-xs text-content-muted">{username.length}/50</p>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        {/* DECISION Phase 88.6-17 (A-1): the page title's `truncate` is
                                            DROPPED, chosen OVER keeping a single-line clip. `Heading`'s
                                            cva base carries `wrap-anywhere`, so a call-site `truncate`
                                            is a clip policy fighting a wrap policy, and only one of them
                                            can be the shipped behaviour.

                                            Dropping it is safe even though this flex parent carries no
                                            `min-w-0`: `wrap-anywhere` is `overflow-wrap: anywhere`,
                                            which DOES count in min-content, so a long unbroken username
                                            breaks itself rather than widening the column and inducing
                                            horizontal scroll at 375px. That is the exact case the
                                            `truncate` existed for, and the primitive handles it without
                                            hiding the rest of the name.

                                            The phone reading is what settles it: at 375px a clip shows
                                            the first few characters of a long username and no way to see
                                            the rest; wrapping shows all of it and costs one line.
                                            Re-adding `truncate` here is a decision, not a cleanup —
                                            `Heading.tsx`'s own docblock names this site as an owner of
                                            that call. */}
                                        <Heading level={1} size="display" className="text-content-primary">
                                            {userData?.username || user.name}
                                        </Heading>
                                        {/* §7.3: an icon-only control needs a real accessible
                                            name; the pencil glyph is the whole content, so
                                            without this the name announced was the emoji, and
                                            a `title` does not count. */}
                                        <button
                                            onClick={() => setEditingUsername(true)}
                                            className="text-content-link hover:text-content-link-hover text-base"
                                            aria-label="Edit username"
                                            title="Edit username"
                                        >
                                            ✏️
                                        </button>
                                    </div>
                                )}
                                {/* THE ADDRESS THIS APP USES, not the Auth0 SESSION claim
                                    (Phase 88.8 plan 13, SPEC R12). Until this phase this line
                                    rendered `user.email` — the session claim — which after an
                                    address change would show the address the user had just
                                    moved AWAY from, while the Email section a few hundred
                                    pixels below showed the new one.

                                    `self`, NOT `userData`. `userData` is set ONCE inside the
                                    ref-guarded init effect (`setUserData(self)` above) and
                                    never re-read, so it does not see the cache patch the Email
                                    section writes after a successful change or revert — the
                                    header would keep the old address until a full remount.
                                    `self` comes straight from the immortal query, which
                                    `patchSelfCache` writes into, so the header and the section
                                    move in the SAME paint. That link is the whole point.

                                    THE `?? user.email` TAIL IS DELIBERATE and is the ONE place
                                    in the app where the session address survives. It covers the
                                    terminal arm above, where `profileLoaded` flips true but
                                    `self` was never resolved: with no fallback this line would
                                    render blank. Do not "tidy" it to `self?.email` alone.

                                    THE SYNTHETIC GUARD IS THE REGRESSION FIX FOR THIS VERY
                                    CHANGE. `Users.email` is where the provisioning sentinel
                                    lives, so switching this line to it is exactly what would
                                    put `google-oauth2-105...@auth0.local` on screen — for the
                                    population this phase exists to repair, whose header would
                                    REGRESS from a working address to a sentinel. The test is
                                    the BROAD `@auth0` substring per DECISION Phase 88.2
                                    NIX-AUTH0 (services/groupOwnershipOfferService.js:97-114),
                                    never `@auth0.local` alone. And a synthetic value does NOT
                                    fall through to `user.email`: substituting a real session
                                    address for the app address is the stale-value defect this
                                    whole task removes.

                                    NO_ADDRESS_ON_FILE is IMPORTED from the section, not
                                    re-spelled here — one fixed string, one spelling. */}
                                {/* FALSY-SAFE (code review #38, 2026-09-05). The FE
                                    `isSyntheticAddress` returns FALSE for a non-string
                                    (syntheticAddress.ts — it guards `typeof value !==
                                    'string'`), unlike the backend's, which treats blank
                                    as synthetic. So a missing address took the ELSE arm
                                    and rendered nothing: a blank line here while the
                                    section below correctly said "No email address on
                                    file". Same shape as the section's own guard,
                                    `currentAddress && !currentIsSynthetic`. */}
                                <p className="text-base text-content-secondary truncate">
                                    {(() => {
                                        const addr = self?.email ?? user.email;
                                        return addr && !isSyntheticAddress(addr) ? addr : NO_ADDRESS_ON_FILE;
                                    })()}
                                </p>
                                {userData?.username && userData.username !== user.name && (
                                    <p className="text-sm text-content-muted mt-1">
                                        Display name: {userData.username} (from Google: {user.name})
                                    </p>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Skeleton placeholder — shimmer bars sized to typical username + email.
                        // Uses bg-surface-muted token so it auto-themes.
                        <div className="flex items-center gap-3 md:gap-4 w-full">
                            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface-muted animate-pulse shrink-0" />
                            <div className="flex-1 space-y-2">
                                <div className="h-7 w-40 bg-surface-muted rounded-sm animate-pulse" />
                                <div className="h-4 w-56 bg-surface-muted rounded-sm animate-pulse" />
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
                                    {/* DECISION Phase 88.6-17 (R3 #13 / T-88.6-147): the input-plus-action
                                        row renders ONCE across the `'input'` and `'saving'` states —
                                        chosen OVER the two sibling `phoneState` branches this shipped as.

                                        Those were not one control in two states: the Save & Verify
                                        button lived inside the idle/editing branch and a second,
                                        natively-disabled "Sending code..." button lived inside the
                                        `'saving'` branch. Pressing Save & Verify therefore DESTROYED the
                                        focused element and dropped focus to `<body>` mid-submit, on an
                                        account-level flow. Now the Input's disabled state, the button's
                                        label and the button's `aria-disabled` are all driven by
                                        `phoneState`, so the element the user pressed is still in the
                                        document and still focused while the request is in flight.

                                        The native `disabled` attribute still carries the INVALID-INPUT
                                        precondition — a gate on a control nobody has activated, which the
                                        rule of KIND leaves native. Only the in-flight state moved to
                                        `aria-disabled`, and it is paired with the synchronous first-line
                                        refusal in `handleSaveAndVerify` (see the `saveInFlightRef` marker):
                                        an `aria-disabled` control with no handler refusal is a
                                        re-submittable button. Splitting these branches apart again, or
                                        dropping either half of the pair, is a decision, not a cleanup. */}
                                    {(phoneState === 'idle' || phoneState === 'editing' || phoneState === 'saving') && (
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
                                                    disabled={phoneState === 'saving'}
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
                                                        phoneState === 'saving' ? 'bg-surface-muted' :
                                                        phoneValidation.valid ? 'border-status-success' :
                                                        phoneValidation.error ? 'border-status-error' :
                                                        ''
                                                    }
                                                />
                                                {phoneValidation.valid && (
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-content-status-success">
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
                                                        className="text-content-status-error text-xs mt-1"
                                                    >
                                                        {phoneValidation.error}
                                                    </p>
                                                )}
                                            </div>
                                            {/* The in-flight cue is the LABEL SWAP plus the muted input
                                                ground, stated rather than inherited: the retired
                                                `'saving'` branch carried an unconditional
                                                `opacity-50 cursor-not-allowed`, and `.btn:disabled`'s
                                                own opacity wash keys on the NATIVE attribute this
                                                control no longer sets while in flight. A call-site
                                                `disabled:opacity-*` is DEAD on a `.btn` element and is
                                                deliberately not used as the replacement. The
                                                not-allowed cursor still arrives, from
                                                `.btn[aria-disabled='true']` in globals.css. */}
                                            <Button
                                                variant="primary"
                                                onClick={handleSaveAndVerify}
                                                disabled={!phoneValidation.valid}
                                                aria-disabled={phoneState === 'saving' ? 'true' : undefined}
                                                className="whitespace-nowrap"
                                            >
                                                {phoneState === 'saving' ? 'Sending code...' : 'Save & Verify'}
                                            </Button>
                                        </div>
                                    )}

                                    {phoneState === 'verifying' && (
                                        <div>
                                            <p className="text-sm text-content-secondary mb-2">
                                                Code sent to <span className="text-content-primary">{phoneValidation.formatted || phoneInput}</span>
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
                                                {/* An incomplete-code PRECONDITION gate on a control
                                                    nobody has activated — the rule of kind leaves it
                                                    natively `disabled`. */}
                                                <Button
                                                    variant="primary"
                                                    onClick={handleVerifyCode}
                                                    disabled={verificationCode.length !== 6}
                                                    className="whitespace-nowrap"
                                                >
                                                    Verify
                                                </Button>
                                                {/* DECISION Phase 88.6-17 (D-8): the cooldown gate is
                                                    `aria-disabled`, with the native `disabled` attribute
                                                    REMOVED — the shipped EmailAddressSection cooldown
                                                    idiom, reused verbatim. Keeping `disabled` here would
                                                    be a defect, not a no-op: the unlayered
                                                    `.btn:disabled { opacity: .5 }` would WASH OUT a
                                                    countdown label the user has to READ, and ghost's
                                                    gated ink is keyed on `aria-disabled:`
                                                    (Button.tsx), so it would never fire. A call-site
                                                    `disabled:opacity-100` cannot rescue it —
                                                    `disabled:opacity-*` is dead on a `.btn`. The
                                                    disclosed behaviour delta is that a cooling-down
                                                    Resend stays in the tab order, which is DR-C's chosen
                                                    behaviour, and the re-press is refused in
                                                    `handleResendCode`. */}
                                                <Button
                                                    variant="ghost"
                                                    onClick={handleResendCode}
                                                    aria-disabled={resendCooldown > 0 ? 'true' : undefined}
                                                    className="whitespace-nowrap"
                                                >
                                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                                                </Button>
                                            </div>
                                            {/* A10: floored to 44px IN PLACE as a raw `<button>` — see the
                                                marker on the Remove control below for why these three
                                                block links do not migrate. `inline-flex min-h-11
                                                items-center` plus the negative inline margins keeps the
                                                ink, the label and the row rhythm byte-identical while the
                                                tap target grows to the floor. Focus ring added per-site
                                                (R3 finding 144) — this control carried none. */}
                                            <button
                                                onClick={handleChangeNumber}
                                                className="-mx-2 inline-flex min-h-11 items-center rounded-btn px-2 text-sm text-content-muted hover:text-content-secondary mt-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                                            >
                                                Change number
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'verified' && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-content-status-success">
                                                <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </span>
                                            <span className="text-sm text-content-status-success">Phone verified</span>
                                            {/* A10: floored in place — see the Remove marker below. */}
                                            <button
                                                onClick={handleChangeNumber}
                                                className="-mx-2 inline-flex min-h-11 items-center rounded-btn px-2 text-sm text-content-muted hover:text-content-secondary underline ml-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                                            >
                                                Change number
                                            </button>
                                            {/* Two-tap remove link (D-PHONE-01): first tap arms 3s revert timer
                                                + flips label red; second tap commits via usersAPI.removePhone.

                                                DECISION Phase 88.6-17 (A10 / T-88.6-43, with T-88.6-41):
                                                this control is floored to 44px IN PLACE as a raw
                                                `<button>` and is deliberately NOT migrated to `<Button>`.
                                                `.btn` declares `font-weight: 600` UNLAYERED, so on the
                                                primitive both arms of the ternary below would render at
                                                600 and the ARMED `font-semibold` cue — the thing that
                                                tells you the destructive second tap is live — would be
                                                deleted with nothing red anywhere. That is a CONSEQUENCE
                                                constraint: this is the SOLE path to removing a verified
                                                phone number. The two `Change number` links above are
                                                floored the same way for consistency of mechanism within
                                                the block.

                                                Neither shipped gate can see these three: `btnCensus`'s
                                                rule for this file is raw PALETTE fills and they carry
                                                tokens, and `controlSizeFloor` proves the floor only for
                                                `Button` elements. The floor here is therefore held by
                                                this marker and by the rendered 375px measurement recorded
                                                in `88.6-17-SUMMARY.md`, not by a class-list pin. Removing
                                                `min-h-11` is a decision, not a cleanup. */}
                                            <button
                                                onClick={handleRemovePhone}
                                                className={`-mx-2 inline-flex min-h-11 items-center rounded-btn px-2 text-sm underline ml-3 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
                                                    removeArmed
                                                        ? 'text-content-status-error font-semibold'
                                                        : 'text-content-status-error hover:text-red-700'
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
                                            className="text-content-status-error text-xs mt-1"
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
                                <Heading level={2} size="heading" className="text-content-primary mb-1">Google Calendar Integration</Heading>
                                <p className="text-sm text-content-secondary">
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
                                <Button
                                    variant="danger"
                                    onClick={handleDisconnectGoogleCalendar}
                                    className="whitespace-nowrap"
                                >
                                    Disconnect Calendar
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    onClick={handleConnectGoogleCalendar}
                                    className="whitespace-nowrap"
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
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Email (Phase 88.8 plan 13, SPEC R12 / D-29): the address this
                    app uses to reach you — its OWN top-level card, mounted between
                    the profile card and the Theme card. The mount is deliberately
                    THIN: the section owns its own state, its own data (the shared
                    self row) and its own card chrome, so the page passes nothing.
                    There is NO return-parameter effect for this feature —
                    verification completes inline in the section (D-09 as re-ruled
                    2026-09-03), nothing arrives on this page by URL, and the
                    ONBD-04 return effect must NOT be cloned for it. */}
                <EmailAddressSection />

                {/* Theme Setting */}
                <div className="card p-3 md:p-6 mb-6">
                    <Heading level={2} size="heading" className="text-content-primary mb-1">Theme</Heading>
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
                    {/* DECISION Phase 88.6-17 (D-11, outcome (a)): both theme toggles MIGRATE to
                        `<Button variant="ghost">` and KEEP their own fill utilities on `className` —
                        chosen OVER outcome (b), leaving them raw behind an exclusion marker.

                        TWO DELTAS FALL OUT OF THIS AND ARE ACCEPTED, NOT OVERLOOKED. (1) The label
                        goes 16px -> 14px: these carried no size class and no ancestor sets one, and
                        `.btn`'s unlayered `font-size: .875rem` beats any call-site `text-base`. (2)
                        The UNSELECTED arm goes 400 -> 600, because `.btn` declares `font-weight: 600`
                        — so the weight half of the selection cue is gone. What still carries
                        selection: the amber border, the fill, and `aria-pressed`, which the
                        `DECISION Phase 88-10` marker above records as this control's state mechanism.

                        WHY (a) OVER (b). Under (b) neither shipped gate can see these controls —
                        `btnCensus`'s palette rule keys on the FILL (which survives either way) and
                        `controlSizeFloor` proves the 44px floor only for `Button` elements — so a
                        hand-rolled floor here would be watched by nothing and could be undone
                        silently. On the primitive the floor is `min-h-11` on the cva base, at every
                        viewport, and is gated forever. 14px is also the size every other button on
                        this page already renders at; the 16px floor is a TEXT-ENTRY rule (iOS
                        focus-zoom), not a button-label rule.

                        W19 PRECONDITION, CHECKED BEFORE THIS EDIT: `.btn { border: none }` now lives
                        inside `@layer components` in globals.css, so these controls' visible border
                        survives the migration. Before that move it would have been DELETED with no
                        test failure. If a future edit un-layers that reset, this pair loses its
                        border silently.

                        THE FILL STAYS RAW (P6) and therefore so does this file's raw-palette roster
                        entry, at 2 with decision provenance. `bg-purple-900` is ambiguous BY NAME —
                        the repo mints its own `--purple-900` as well — and it was RESOLVED before
                        this edit rather than assumed: `@theme` exposes `--color-purple-900` as
                        Tailwind's own default step, and the repo's dark-navy `--purple-900` is never
                        exposed as a utility at all, so this is a palette STEP under both readings.
                        `bg-amber-50` resolves the same way. The measured values are recorded in
                        `88.6-17-SUMMARY.md` rather than spelled here, so this file's own
                        untagged-raw-hex pin stays honest — the same reason the BGG input comment
                        below spells a utility in words. Converging these fills onto semantic tokens
                        is a look change and is out of this phase's contract.

                        `enabled-hover:bg-*` pins the SELECTED arm's fill through hover: ghost's base
                        carries `enabled-hover:bg-surface-hover`, which would otherwise wash the amber
                        (and the purple) on hover — a fill change P6 forbids. */}
                    {themeMounted ? (
                        <div className="flex gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => setTheme('light')}
                                aria-pressed={resolvedTheme === 'light'}
                                className={`border transition-colors ${
                                    resolvedTheme === 'light'
                                        ? 'border-amber-500 bg-amber-50 enabled-hover:bg-amber-50 text-content-primary'
                                        : 'border-line bg-surface-card enabled-hover:bg-surface-hover text-content-secondary'
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                                Light
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={() => setTheme('dark')}
                                aria-pressed={resolvedTheme === 'dark'}
                                className={`border transition-colors ${
                                    resolvedTheme === 'dark'
                                        ? 'border-amber-500 bg-purple-900 enabled-hover:bg-purple-900 text-white'
                                        : 'border-line bg-surface-card enabled-hover:bg-surface-hover text-content-secondary'
                                }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                </svg>
                                Dark
                            </Button>
                        </div>
                    ) : (
                        // The skeleton matches the control it stands in for: `min-h-11` (44px), not
                        // the `h-10` (40px) it shipped as, so the placeholder does not disagree with
                        // the migrated pair's floor.
                        <div className="min-h-11 w-48 bg-surface-muted rounded-lg animate-pulse" />
                    )}
                </div>

                {/* Timezone Setting */}
                <div className="card p-3 md:p-6 mb-6">
                    <Heading level={2} size="heading" className="text-content-primary mb-1">Timezone</Heading>
                    <p className="text-sm text-content-secondary mb-3">All event times and schedules use this timezone</p>
                    {/* F-359: the picker is the `Combobox` primitive (88-08). Keyboard
                        operation, Esc AND click-outside close, and focus restore all come
                        from the primitive — the hand-rolled panel this replaces had none of
                        them: it opened on click, closed only on a second click, and its
                        option list was unreachable from the keyboard. Nothing here re-rolls
                        any of that. */}
                    <Combobox
                        id="profile-timezone"
                        name="profile-timezone"
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
                    <Heading level={2} size="heading" className="text-content-primary mb-1">Notification Preferences</Heading>
                    <p className="text-sm text-content-secondary mb-4">Choose how you receive notifications</p>

                    {/* 88-CODE-REVIEW MED#15: always-mounted sr-only outcome regions —
                        see the setSaveStatus marker for the split and why 'saving' is
                        not announced. The visible per-row spans stay as-is. */}
                    <StatusRegion className="sr-only" message={politeSaveAnnouncement} />
                    <StatusRegion className="sr-only" politeness="assertive" message={assertiveSaveAnnouncement} />

                    {/* SMS Consent Disclosure (TCPA / carrier compliance) */}
                    {userData?.sms_enabled && (
                        <div className="mb-4 p-3 rounded-card border border-line bg-surface-sunken">
                            {/* DECISION Phase 88.6-17 (D-01 / T-88.6-42): legal text moves OFF the
                                caption rung — label 14/700, body 14/400. Caption's closed role list is
                                chips, counters, timestamps, eyebrows, dense-grid cells and helper text;
                                a compliance disclosure is none of them, so 12px here was MISUSE, not a
                                caption. The wording is byte-unchanged (P1).

                                The three inner spans are dispositioned individually, and neither
                                disposition generalises — D-03 is a recorded CONSEQUENCE constraint and
                                these are two narrow carve-outs, not a licence for 600 anywhere. STOP and
                                HELP drop to 400 because `font-mono` is a NON-COLOUR cue that survives
                                the weight change intact, so the keywords stay distinguishable without
                                relying on colour. The brand span has no such surviving cue, so it takes
                                700 (D-03's hierarchy outcome) rather than the 400-plus-colour emphasis
                                outcome, which would leave a colour-only distinction inside a compliance
                                surface. */}
                            <p className="text-sm font-bold text-content-primary mb-1">SMS Notifications Disclosure</p>
                            <p className="text-sm text-content-secondary leading-relaxed">
                                By enabling any SMS toggle below, you agree to receive recurring text messages from <span className="font-bold">NextGameNight</span> about your game group activity, including event creation, updates, cancellations, and reminders. Message frequency varies based on group activity. Message and data rates may apply. Reply <span className="font-mono font-normal">STOP</span> to unsubscribe at any time, or <span className="font-mono font-normal">HELP</span> for help. Consent is not a condition of using the service. See our{' '}
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
                                    className="text-content-link hover:text-content-link-hover underline"
                                >
                                    Verify
                                </button>
                            </div>
                        )}
                        {/* Header row */}
                        <div className="flex items-center py-2 border-b border-line">
                            <div className="flex-1 text-sm text-content-muted">Notification Type</div>
                            <div className="w-16 text-center text-sm text-content-muted">Email</div>
                            {/* SMS column — only rendered for entitled users (sms_enabled=true).
                                Non-entitled users see an Email-only matrix and never know
                                SMS is a feature of the app. */}
                            {userData?.sms_enabled && (
                                <div className="w-16 text-center text-sm text-content-muted">SMS</div>
                            )}
                            <div className="w-20"></div>
                        </div>

                        {NOTIFICATION_TYPES.map(type => (
                            <div key={type.key} className="py-3 border-b border-line last:border-b-0">
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <p className="text-base text-content-primary">{type.label}</p>
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
                                            <span className="text-xs text-content-status-success">Saved</span>
                                        )}
                                        {rowSaveStatus(saveStatuses, type.key) === 'error' && (
                                            <span className="text-xs text-content-status-error">Error</span>
                                        )}
                                        {rowSaveStatus(saveStatuses, type.key) === 'guard' && (
                                            <span className="text-xs text-content-status-error">At least one notification must stay enabled</span>
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
                                            id="reminder-window"
                                            name="reminder-window"
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
                                            <span className="text-xs text-content-status-success">Saved</span>
                                        )}
                                        {/* ML-16 (87.5 review): the identity-guard and persist-failure
                                            paths both set status 'error' here — without this branch the
                                            dropdown silently snapped back with zero feedback. */}
                                        {saveStatuses[REMINDER_WINDOW_SLOT] === 'error' && (
                                            <span className="text-xs text-content-status-error">Error</span>
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
                            {saveStatuses[RESET_SLOT] === 'saved' && <span className="text-xs text-content-status-success">Reset to defaults</span>}
                            {saveStatuses[RESET_SLOT] === 'error' && <span className="text-xs text-content-status-error">Couldn't reset — try again.</span>}
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
                    <Heading level={2} size="heading" className="text-content-primary mb-4">Availability Settings</Heading>
                    <p className="text-base text-content-secondary mb-4">
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
                                    <Heading level={3} size="body" className="text-content-primary">Availability Schedules</Heading>
                                    <p className="text-sm text-content-secondary mt-1">Set your recurring availability schedule</p>
                                </div>
                                <Button
                                    variant="primary"
                                    onClick={() => setShowRecurringForm(!showRecurringForm)}
                                >
                                    {showRecurringForm ? 'Cancel' : '+ Add Schedule'}
                                </Button>
                            </div>

                            {showRecurringForm && (
                                <div className="mb-6 p-4 border border-line rounded-lg bg-surface-page">
                                    <Heading level={4} size="body" className="mb-3 text-content-primary">New Schedule</Heading>
                                    <div className="space-y-3">
                                        <div>
                                            {/* Not a <label>: this names a GROUP of toggle
                                                buttons, not a single form control, and a label
                                                with no control is a label pointing at nothing. */}
                                            <span id="days-of-week-label" className="block text-sm text-content-secondary mb-1">Days of Week</span>
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
                                                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
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
                                                    className="px-3 py-1.5 rounded-btn text-sm border border-line text-content-secondary hover:border-line-accent transition-colors"
                                                >
                                                    {recurringForm.daysOfWeek.length === 7 ? 'Clear' : 'All'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label htmlFor="recurring-start-time" className="block text-sm text-content-secondary mb-1">Available From (Start Time)</label>
                                                <Input
                                                    id="recurring-start-time"
                                                    type="time"
                                                    value={recurringForm.startTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, startTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become available</p>
                                            </div>
                                            <div>
                                                <label htmlFor="recurring-end-time" className="block text-sm text-content-secondary mb-1">Available Until (End Time)</label>
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
                                                <label htmlFor="recurring-start-date" className="block text-sm text-content-secondary mb-1">Start Date</label>
                                                <Input
                                                    id="recurring-start-date"
                                                    type="date"
                                                    value={recurringForm.start_date}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, start_date: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label htmlFor="recurring-end-date" className="block text-sm text-content-secondary mb-1">End Date (Optional)</label>
                                                <Input
                                                    id="recurring-end-date"
                                                    type="date"
                                                    value={recurringForm.end_date}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, end_date: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <Button
                                            variant="primary"
                                            onClick={handleCreateRecurringPattern}
                                            disabled={savingPattern}
                                            className="w-full"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Schedule'}
                                        </Button>
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
                                                    <p className="text-content-primary">
                                                        {getDayName(pattern.pattern_data.dayOfWeek)}: {formatTime(pattern.pattern_data.startTime)} - {formatTime(pattern.pattern_data.endTime)}
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
                                                            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-btn px-2 text-sm text-content-status-error hover:bg-status-error-subtle focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring ${
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
                                        // D2 mini-formula (ruled 2026-08-15): muted, no "!".
                                        <p className="text-content-muted text-sm">No schedules set. Add one to get started.</p>
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
                                    <Heading level={3} size="body" className="text-content-primary">Specific Date Overrides</Heading>
                                    <p className="text-sm text-content-secondary mt-1">Override your schedules for specific dates</p>
                                </div>
                                <Button
                                    variant="primary"
                                    onClick={() => setShowSpecificForm(!showSpecificForm)}
                                >
                                    {showSpecificForm ? 'Cancel' : '+ Add Override'}
                                </Button>
                            </div>

                            {showSpecificForm && (
                                <div className="mb-6 p-4 border border-line rounded-lg bg-surface-page">
                                    <Heading level={4} size="body" className="mb-3 text-content-primary">New Specific Override</Heading>
                                    <div className="space-y-3">
                                        <div>
                                            <label htmlFor="specific-date" className="block text-sm text-content-secondary mb-1">Date</label>
                                            <Input
                                                id="specific-date"
                                                type="date"
                                                value={specificForm.date}
                                                onChange={(e) => setSpecificForm({ ...specificForm, date: e.target.value })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label htmlFor="specific-start-time" className="block text-sm text-content-secondary mb-1">Available From (Start Time)</label>
                                                <Input
                                                    id="specific-start-time"
                                                    type="time"
                                                    value={specificForm.startTime}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, startTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become available</p>
                                            </div>
                                            <div>
                                                <label htmlFor="specific-end-time" className="block text-sm text-content-secondary mb-1">Available Until (End Time)</label>
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
                                        <Button
                                            variant="primary"
                                            onClick={handleCreateSpecificOverride}
                                            disabled={savingPattern}
                                            className="w-full"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Override'}
                                        </Button>
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
                                                    <p className="text-content-primary">
                                                        {formatDate(pattern.pattern_data.date)}: {formatTime(pattern.pattern_data.startTime)} - {formatTime(pattern.pattern_data.endTime)}
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
                                                            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-btn px-2 text-sm text-content-status-error hover:bg-status-error-subtle focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring ${
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
                    <Heading level={2} size="heading" className="text-content-primary mb-2">Tutorial</Heading>
                    <p className="text-base text-content-secondary mb-4">
                        Need a refresher on how to use Next Game Night? Replay the onboarding tutorial to walk through the key features.
                    </p>
                    <Button
                        variant="primary"
                        onClick={handleReplayTutorial}
                        disabled={replayingTutorial}
                    >
                        {replayingTutorial ? 'Starting...' : 'Replay Tutorial'}
                    </Button>
                </div>

                {/* Owned Games Section */}
                <div className="card p-3 md:p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                        {/* 88-33 Task 7 step 2 (UAT row 272): the count renders only after the
                            owned-games fetch resolves — "(0)" mid-fetch is an empty-vs-loading
                            conflation on the count itself; an em-dash holds the slot meanwhile. */}
                        <Heading level={2} size="heading" className="text-content-primary">
                            My Game Collection ({loadingGames ? '—' : ownedGames.length})
                        </Heading>
                        <div className="flex gap-2">
                            <Button
                                variant="primary"
                                onClick={() => setShowBggSearch(!showBggSearch)}
                                className="whitespace-nowrap"
                            >
                                {showBggSearch ? 'Hide Search' : '+ Add from BGG'}
                            </Button>
                        </div>
                    </div>

                    {/* BGG Collection Import */}
                    <div className="mb-6 p-3 md:p-4 border border-line rounded-lg bg-surface-page">
                        <Heading level={3} size="body" className="mb-2 text-content-primary">Import Your Entire BGG Collection</Heading>
                        <p className="text-sm text-content-secondary mb-3">
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
                                id="bgg-username"
                                name="bgg-username"
                                aria-label="BoardGameGeek username"
                                value={bggUsername}
                                onChange={(e) => setBggUsername(e.target.value)}
                                placeholder="Your BGG username"
                                className="flex-1"
                                disabled={importingCollection}
                            />
                            <Button
                                variant="primary"
                                onClick={handleImportCollectionClick}
                                disabled={importingCollection || !bggUsername.trim()}
                                className="whitespace-nowrap"
                            >
                                {importingCollection ? 'Importing...' : 'Import Collection'}
                            </Button>
                        </div>
                        {importProgress && (
                            <div className={`mt-3 p-3 rounded-btn ${
                                importProgress.status === 'error' ? 'bg-status-error-subtle text-content-status-error' :
                                importProgress.status === 'complete' ? 'bg-status-success-subtle text-content-status-success' :
                                'bg-surface-muted text-content-secondary'
                            }`}>
                                <p className="text-content-primary">{importProgress.message}</p>
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
                                <Button
                                    variant="primary"
                                    onClick={searchBGG}
                                    disabled={bggSearching || !bggSearchQuery.trim()}
                                    className="whitespace-nowrap"
                                >
                                    {bggSearching ? 'Searching...' : 'Search'}
                                </Button>
                            </div>
                            
                            {bggSearchResults.length > 0 && (
                                <div className="max-h-60 overflow-y-auto space-y-2">
                                    {bggSearchResults.map((result) => {
                                        const isAlreadyOwned = ownedGames.some(g => g.bgg_id === result.bgg_id);
                                        return (
                                            <div key={result.bgg_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-surface-card border border-line rounded-btn">
                                                <span className="text-base text-content-primary wrap-break-word flex-1 min-w-0">
                                                    {result.name} {result.year_published ? `(${result.year_published})` : ''}
                                                </span>
                                                <Button
                                                    variant="primary"
                                                    type="button"
                                                    onClick={() => addGameToCollection(result.bgg_id)}
                                                    disabled={isAlreadyOwned}
                                                    className="whitespace-nowrap shrink-0"
                                                >
                                                    {isAlreadyOwned ? 'Already Owned' : 'Add to Collection'}
                                                </Button>
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
                                // D49-b (owner ruling 2026-09-09, option i): `hover:shadow-md` here was
                                // Tailwind's INLINED built-in scale, not the theme tier, so it snaps to
                                // `hover:shadow-theme-md`. Plain `hover:` and not plan 05's
                                // `enabled-hover:` — this is a card `div`, not a `.btn`. The snap
                                // changes hue (warm tint in light, purple hairline plus glow in dark);
                                // that is disclosed, not accidental.
                                <div key={game.id} className="border border-line rounded-lg p-4 hover:shadow-theme-md transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1">
                                            <Heading level={3} size="body" className="text-content-primary">{game.name}</Heading>
                                            {game.year_published && (
                                                <p className="text-sm text-content-secondary">({game.year_published})</p>
                                            )}
                                        </div>
                                        {/* Two-tap gate. The accessible name names the ACTION
                                            and the OBJECT (F-369) — a bare glyph is not a
                                            name, and the `title` it used to carry does not
                                            count (§7.3). Armed state swaps the visible label
                                            AND the name together (Label-in-Name, WCAG 2.5.3),
                                            both from the hook.

                                            88-33 Task 5 (fork 7): resting prominence (a real
                                            affordance box, min-w-11) + armed 'Remove' label on
                                            the error-subtle treatment. The invisible sizer span
                                            reserves the ARMED label's width at rest so arming
                                            never reflows the title next to it (walk row 573's
                                            squeeze class). */}
                                        <button
                                            {...removeGameGate.triggerProps(
                                                game.id,
                                                game.name,
                                                `Remove ${game.name}`
                                            )}
                                            className={`inline-grid min-h-11 min-w-11 place-items-center whitespace-nowrap rounded-btn border px-2 text-sm text-content-status-error focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring ${
                                                removeGameGate.isArmed(game.id)
                                                    ? 'bg-status-error-subtle border-status-error font-semibold'
                                                    : 'border-status-error hover:bg-status-error-subtle'
                                            }`}
                                        >
                                            {/* DECISION Phase 88.6-17 (D-03 / T-88.6-41): this sizer's
                                                `font-semibold` STAYS, and it is deliberately NOT one of
                                                the 600s the weight sweep converted. It is not emphasis —
                                                it is a MEASUREMENT. The span reserves the width of the
                                                ARMED label at rest, so it has to be set in the same
                                                weight the armed label renders at (the 600 on the line
                                                above). Drop it to 400 and the reservation under-measures,
                                                arming reflows the game title beside it, and walk row
                                                573's squeeze class comes back — silently, because no gate
                                                measures text advance width.

                                                `typeScaleTouchedSurfaces`'s ARMED_STATE_600_ROSTER cannot
                                                carry this one: its predicate reads the surrounding source
                                                for `isArmed`, and 160 characters back from here lands
                                                inside the className template rather than on the
                                                `removeGameGate.isArmed(...)` call four lines up. It is
                                                therefore carried in WEIGHT_ROSTER instead, which is why
                                                that entry floors at FIVE and not at the armed roster's
                                                four. Converting it is a decision, not a cleanup. */}
                                            <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-semibold">
                                                Remove
                                            </span>
                                            <span className="col-start-1 row-start-1">
                                                {removeGameGate.labelFor(game.id, '×')}
                                            </span>
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
                        // D2 mini-formula (ruled 2026-08-15): muted + sm, no "!".
                        <p className="text-content-muted text-sm">You don't have any games in your collection yet. Search BoardGameGeek to add games.</p>
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
                            <span className="text-content-primary">{bggUsername}</span>
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