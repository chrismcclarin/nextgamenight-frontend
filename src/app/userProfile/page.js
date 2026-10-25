'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { flushSync } from 'react-dom';
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
import { selfIdentityFailedWithNoRow } from '../../lib/hooks/selfIdentityErrorSource';
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
import { FetchErrorBanner, RefreshFailedNotice, RetainedContentFocusGuard, useRetainedContent } from '../../components/ui/FetchErrorBanner';
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
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { focusElement, focusPageFloor } from '../../components/ui/focusPageFloor';
// AC-2 convert-on-touch (owner ruling 2026-09-09; LEVEL AMENDED 2026-09-13). This file's
// 20 raw console calls route through the house logger at `info`, which is
// Sentry.addBreadcrumb (logger.ts:52-53) — a BREADCRUMB, not an event. `errCtx` is the
// shared name+message builder (88.6-13); the raw Error is never passed as `ctx`.
import { logger, errCtx } from '../../lib/logger';

// 88.6.1 code review CR-5 / A-75 (owner ratified 2026-10-19): the Disconnect Google Calendar
// confirm's text while the disconnect is in flight (ConfirmDialog's pendingLabel).
const DISCONNECT_CALENDAR_PENDING_LABEL = 'Disconnecting…';

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
const BGG_FOUND_ONE_LABEL = 'Found 1 game.';
const bggFoundManyLabel = (n) => `Found ${n} games.`;
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
// Copy row P1 (88.6.1 D-30, ratified 2026-10-04): the pressed Verify's in-flight label.
const VERIFY_CODE_IN_FLIGHT_LABEL = 'Verifying...';
// Copy row P8 (88.6.1 D-30 / D-47, owner-ratified 2026-10-05; straight apostrophe): the collection's failed-first-load title.
const COLLECTION_LOAD_FAILED_TITLE = "Couldn't load your collection";
// Copy row P7 (88.6.1 D-30 / D-47, owner-ratified 2026-10-05; three ASCII full stops): the pressed Add to Collection's in-flight label.
const ADDING_TO_COLLECTION_LABEL = 'Adding...';

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
    const { self, selfUuid, query: selfQuery, queryKey: selfQueryKey } = useSelfIdentity();
    // WR-03: the profile header falls back when identity fails with NO row (the init effect
    // below; a failed refetch that keeps the row initializes from that row — 88.6.1-61), but
    // the owned-games + Google-calendar-status zones init their loading flags to true and clear
    // them only inside selfUuid-gated fetchers. On a TERMINAL identity failure those fetchers
    // early-return, so the flags never clear and both zones spin forever. Derive the shared
    // error state here (kept RAW on purpose: DECISION Phase 88.6.1-79, identity kept row) and render the compact degrade banner in those two zones.
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
    // True while a verification-code CHECK is in flight (W066). Named for the check, not after
    // `'verifying'`, which is already the code-ENTRY value of `phoneState` above.
    const [checkingCode, setCheckingCode] = useState(false);

    /* DECISION Phase 88.6-17 (R2 #29 / T-88.6-146, T-88.6-147): the three phone-flow senders
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
       refusal is a re-submittable button. Removing either one is a decision, not a cleanup.

       AMENDED Phase 88.6.1-18 (W066): Verify joined them (`verifyInFlightRef`). It had no
       in-flight state at all, so a double tap sent two verification checks, and a late
       `{ verified: false }` from the second painted the wrong-code line over a number the first
       check had already verified (WR-505). Same pair, same rule. */
    const saveInFlightRef = useRef(false);
    const resendInFlightRef = useRef(false);
    const verifyInFlightRef = useRef(false);
    // W016 / D-35 (88.6.1-18): Replay Tutorial's synchronous latch — see its marker at the button.
    const replayInFlightRef = useRef(false);
    // Req 4 (88.6.1-53): Remove's synchronous latch, the same pair as the three senders above —
    // see `DECISION Phase 88.6.1-53 (Req 4)` at the Remove button.
    const removeInFlightRef = useRef(false);
    /* R2 #29, second defect: the cooldown ticker used to be a LOCAL `const timer`, cleared only
       by its own tick — nothing cancelled it on unmount. Held in a ref and cleared in the
       existing unmount effect below, alongside removeArmedTimerRef. */
    const resendTimerRef = useRef(null);
    // Req 5 (88.6.1-18): a successful check unmounts the focused Verify. The target is the
    // settled "Phone verified" text, the fallback the profile card's <h1> — see the marker in
    // `handleVerifyCode`.
    const phoneVerifiedRef = useRef(null);
    const profileHeadingRef = useRef(null);
    const phoneVerifyRecovery = useFocusRecovery({ fallback: profileHeadingRef });
    // Req 5 (88.6.1-53): Change number and the banner's Dismiss land on the Phone number FIELD (the
    // wrapper div below keeps `phoneInputRef`); a successful Remove lands on the banner statement.
    // Both re-arm the SAME `phoneVerifyRecovery`, so its <h1> fallback is shared.
    const phoneNumberFieldRef = useRef(null);
    const smsDisabledBannerTextRef = useRef(null);
    // Review 61 / M-32 (88.6.1-53): two counters that let `handleVerifyCode` recognise a stale
    // answer — bumped by Change number and by the start of a phone save. See the marker above
    // `handleChangeNumber`.
    const phoneFlowGenerationRef = useRef(0);
    const phoneSaveGenerationRef = useRef(0);
    // Plan 88.6.1-59 (D-35, Req 5, D-44): the two availability forms' ONE in-flight latch, the
    // targets a successful save lands focus on, and the form panels' ids their toggles control.
    // See `DECISION Phase 88.6.1-59 (D-35, availability forms)` at Save Schedule.
    const savePatternInFlightRef = useRef(false);
    const availabilityHeadingRef = useRef(null);
    const addScheduleToggleRef = useRef(null);
    const addOverrideToggleRef = useRef(null);
    const availabilityRecovery = useFocusRecovery({ fallback: availabilityHeadingRef });
    const recurringFormPanelId = useId();
    const specificFormPanelId = useId();
    // AC-29 / RF1 (88.6.1-59): each panel's level-3 heading is where focus lands when its notice,
    // its first-load banner or its withdrawn rows leave. Retention is plan 70's ONE hook, with the
    // patterns query's own key (C10), so an access answer is remembered with the cached entry. See
    // `DECISION Phase 88.6.1-59 (AC-29 / RF1)` at the schedules list.
    const schedulesHeadingRef = useRef(null);
    const overridesHeadingRef = useRef(null);
    const patternsRetained = useRetainedContent(patternsQuery.data !== undefined, patternsError, { queryKey: availabilityKeys.patterns(self?.id) });
    const patternsFailedWithNothingCached = patternsError.showError && !patternsRetained;
    // No-row half (88.6.1-61); selfIdentityErrorState stays RAW: plan 88.6.1-79 reads it over a kept row.
    const selfFailedWithNothingCached = selfIdentityFailedWithNoRow(selfQuery, self?.id);
    /* DECISION Phase 88.6.1-79 (AC-29 / D-51, identity kept row): CHOSEN — Profile is the one host
       that DISPLAYS the identity row as content (the header's name and address line), so a failed
       identity refresh over a held row is retained data: ONE RF1 notice at the top of the header
       card (D-51 names "Profile's identity header"; plan 88.6.1-61's AC-29 consistency check),
       `retained` through plan 88.6.1-70's `useRetainedContent` with the identity query's own key
       (C10), and an access or gone answer withdraws the identity zone until the next success —
       the page keeps its `h1`, reading the session name, with the full banner and its register
       line below it.
       THE RAW STATE IS LOAD-BEARING: `selfIdentityErrorState` reads the raw self query on purpose;
       wrapping it in `selfIdentityErrorSource` (the no-row source, right for the control hosts)
       would make it quiet over a held row and silence this notice. Profile's no-row half is
       `selfFailedWithNothingCached`.
       REJECTED: (a) no notice (the control-host rule) — the header would show the earlier name and
       address with nothing saying so; (b) the compact notice — its sentence is false, every control
       works; (c) the full banner above the kept row — retired by D-51; (d) a `focusTarget` — the
       card's heading is the page `h1`, which the floor reaches; (e) withdrawing the whole card on an
       access answer — the calendar zone reads its own request and the phone zone may hold an
       in-progress verification, so only the zone the row paints is withdrawn; (f) the bare
       `self !== undefined` (or a local code list) as `retained` — a 403 then a 500 would bring the
       withdrawn name back (C10).
       THE WITHDRAWN ARM KEEPS THE PAGE'S `h1` (orchestrator decision, revision-lap-3 manifest):
       CHOSEN — the same heading primitive and props, reading the SESSION's name (`user.name`), which
       is exactly what this heading reads when the page holds no row; the banner sits below it.
       REJECTED for the heading: (g) no heading while withdrawn — the page would lose its only `h1`,
       the banner's title is a `span`, and the focus floor would fall past it to `main`; (h) the
       row's username — it is the withdrawn row's content (C10); (i) a new heading text, such as the
       breadcrumb's `Profile` — a second page title for one state, new visible words in a heading
       role; (j) moving the heading above the card — it would jump position in one state.
       C12: CHOSEN — plan 70's ONE `RetainedContentFocusGuard`, the card's second child, outside the
       swapped arm, with NO target, so a withdrawal that removed a focused control lands on the
       floor's `main h1` — the withdrawn arm's heading. REJECTED — (k)
       `focusTarget={profileHeadingRef}`: that ref moves between the healthy and the withdrawn
       heading in the same commit and may still be detached when the guard runs; (l) the guard
       inside the identity zone — it would leave with the zone.
       BELOW THE HEADER (reviews 117 and 125): CHOSEN — an access or gone answer also swaps the
       collection list for its existing compact notice (`selfFailedWithNothingCached ||
       identityWithdrawn`) and puts the Email card on its existing unavailable arm (its
       `identityWithdrawn` prop), so no live control below the header acts on the withdrawn row.
       REJECTED — (m) a compact notice in the calendar zone too — it sits in the header card, which
       already carries the full banner (one failure surface per card, C6); (n) gating the profile
       init effect — the kept row is the user's own last server-confirmed settings, and the server
       rejects a write made with the dead session.
       AMENDED 2026-10-19 (88.6.1 code review A-65): the "no live control below the header" claim
       above was not true as shipped — only the collection and the Email card read
       `identityWithdrawn`, so the Notification Preferences card kept the withdrawn row's settings
       with live toggles, and both availability lists kept their rows with live Delete controls.
       CHOSEN: the preferences card is absent while withdrawn (`preferences && !identityWithdrawn`,
       the same absence it already has with no row), and the Schedules and Specific Dates lists take
       their existing compact notice (`selfFailedWithNothingCached || identityWithdrawn`), as the
       collection does. Still live, deliberately and as in the no-row state: the `+ Add Schedule` /
       `+ Add Override` toggles and their forms, which hold no row data (the server rejects their
       write). REJECTED: leaving the preferences and lists live and narrowing this marker's claim
       instead — the C10 rule above is that an access or gone answer never keeps the rows.
       Changing this is a decision, not a cleanup. */
    const identityRetained = useRetainedContent(self !== undefined, selfIdentityErrorState, { queryKey: selfQueryKey });
    const identityWithdrawn = self !== undefined && !identityRetained;
    // D-35 / Req 5 (88.6.1-59): the username editor's Save latch, and the pencil that both of the
    // editor's exits land focus on (fallback: plan 18's profile <h1>). See
    // `DECISION Phase 88.6.1-59 (D-35, username)` at the editor's button row.
    const saveUsernameInFlightRef = useRef(false);
    const editUsernamePencilRef = useRef(null);
    const usernameRecovery = useFocusRecovery({ fallback: profileHeadingRef });
    // D-35 (88.6.1-60): the BGG import's ONE in-flight latch, read first by both of its handlers.
    // See `DECISION Phase 88.6.1-60 (D-35, BGG import)` at Import Collection.
    const importInFlightRef = useRef(false);
    // Req 8 / D-22 (88.6.1-60): the import outcome region's node, and the writes HELD while a closing
    // dialog still hides the page from assistive tech. See `DECISION Phase 88.6.1-60 (Req 8 / D-22,
    // BGG import outcome)` at the region.
    const importStatusRegionRef = useRef(null);
    const heldImportWritesRef = useRef([]);
    const importHoldObserverRef = useRef(null);
    // D-35 (88.6.1-60): the BGG search latch, read first by `searchBGG` (the button AND the field's
    // Enter). See `DECISION Phase 88.6.1-60 (D-35, BGG search)` at Search.
    const searchInFlightRef = useRef(false);
    // Review 221 (88.6.1-60): the screen-reader-only result count. See `DECISION Phase 88.6.1-60 (review 221,
    // owner 2026-10-13)` in `searchBGG`.
    const [bggFoundAnnouncement, setBggFoundAnnouncement] = useState('');
    // Req 11 / Req 5 (88.6.1-60): the import's 5-second result timer, and what its callback reads to
    // decide whether to empty the username and where focus goes first. `addFromBggToggleRef` and
    // `collectionHeadingRef` are SHARED: plan 88.6.1-67 lands Remove and Add on the same two
    // elements and reuses these refs (an element takes one ref). See `DECISION Phase 88.6.1-60
    // (Req 11 / Req 5, import result timer)` in `importBGGCollection`.
    const importClearTimerRef = useRef(null);
    const importButtonRef = useRef(null);
    const addFromBggToggleRef = useRef(null);
    const collectionHeadingRef = useRef(null);
    // Plan 88.6.1-67 (88.6.1-70 contracts C2 / C3): the `selfUuid` whose collection last loaded
    // successfully (a has-loaded key, never a row count), the newest failed run's error (cleared only
    // by the newest success), and the request generation (only the newest run writes).
    const [ownedGamesLoadedFor, setOwnedGamesLoadedFor] = useState(null);
    const [ownedGamesError, setOwnedGamesError] = useState(null);
    const ownedGamesRequestRef = useRef(0);
    const collectionLoadedForSelf = Boolean(selfUuid) && ownedGamesLoadedFor === selfUuid;
    // Plan 88.6.1-67 (Req 5): Remove and Add to Collection land focus on `+ Add from BGG`, else this
    // card's heading — plan 60's two refs, a second consumer of them, never a second ref.
    const collectionRecovery = useFocusRecovery({ fallback: collectionHeadingRef });
    // Plan 88.6.1-67 (D-35): the Add to Collection latch and the `bgg_id` of the add in flight.
    const addGameInFlightRef = useRef(false);
    const [addingBggId, setAddingBggId] = useState(null);
    const bggUsernameFieldRef = useRef(null);
    const importPromptOpenRef = useRef(false);
    // D-44 (88.6.1-60): the search panel's id, named by its toggle's aria-controls while it exists.
    const bggSearchPanelId = useId();
    // The import dialog's open state, readable from the timer. One effect rather than a write beside
    // each of the four open-state setter calls (four sites to keep in step; one effect cannot drift),
    // and not a document query for an open dialog (any dialog would match, not just this one).
    useEffect(() => {
        importPromptOpenRef.current = bggImportPromptOpen;
    }, [bggImportPromptOpen]);

    // Two-tap remove confirmation state (D-PHONE-01, mirrors KebabMenu twoTap pattern):
    // first tap arms a 3s revert timer; second tap commits via usersAPI.removePhone.
    const [removeArmed, setRemoveArmed] = useState(false);
    // True while a removal is in flight (Req 4, 88.6.1-53): drives Remove's `aria-disabled`.
    const [removingPhone, setRemovingPhone] = useState(false);
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

    const { replayTutorial, showTutorial } = useTutorial();
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
        // W016 / D-35: the in-flight refusal, synchronous and FIRST — Replay is `aria-disabled`
        // while resetting, not natively disabled, so it stays pressable (see its marker).
        if (replayInFlightRef.current) return;
        // Refused while the tour is open: Replay keeps focus under the tour's scrim (D-49).
        if (showTutorial) return;
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        replayInFlightRef.current = true;
        setReplayingTutorial(true);
        try {
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
            // Released in `finally` so a FAILED reset does not strand the control.
            replayInFlightRef.current = false;
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
        // M-32 (88.6.1-53): a phone save has started, so an older verify answer still in flight
        // must not write its number as verified over this one.
        phoneSaveGenerationRef.current += 1;
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
        // W066 / WR-505 (D-35): the in-flight refusal, synchronous and FIRST — a double tap
        // used to send two checks. See the marker on `saveInFlightRef`.
        if (verifyInFlightRef.current) return;
        if (!user?.sub || !verificationCode) return;
        if (!selfUuid) {
            setPhoneError('Still loading your account — please try again in a moment.');
            return;
        }
        verifyInFlightRef.current = true;
        setCheckingCode(true);
        // Review 61 / M-32 (88.6.1-53): captured BEFORE the await. If either moves while the check
        // is in flight, the answer is stale for the screen — see the marker above
        // `handleChangeNumber`.
        const flowGeneration = phoneFlowGenerationRef.current;
        const saveGeneration = phoneSaveGenerationRef.current;
        const isStale = () => phoneFlowGenerationRef.current !== flowGeneration;
        try {
            setPhoneError(null);
            // 88-CODE-REVIEW H1: the wrong-code outcome is a 200 { verified: false }
            // (routes/users.js:823-828 — the Twilio check not approving is a response,
            // not a throw; only MALFORMED input 400s). apiFetch throws solely on
            // !response.ok, so discarding this body took the success path on a wrong
            // code: phone_verified true in local state + the immortal self cache while
            // the DB row stayed false — SMS toggles enabled, SMS never sending.
            const result = await usersAPI.verifyPhone(selfUuid, verificationCode);
            if (isStale()) {
                // The person pressed Change number while this check was in flight: the row they
                // are now typing in must not be swapped for the verified row, and no error line
                // belongs to it. The server DID verify the number the code was sent to (the
                // closure's `phoneInput`), so that truth is applied — but only while no phone save
                // has started since this check was sent; after one, a newer number is on file and
                // writing this one as verified would unlock the SMS toggles for it.
                if (result?.verified && phoneSaveGenerationRef.current === saveGeneration) {
                    setUserData(prev => (prev ? { ...prev, phone: phoneInput, phone_verified: true } : prev));
                    patchSelfCache(queryClient, { phone: phoneInput, phone_verified: true });
                }
                return;
            }
            if (!result?.verified) {
                setPhoneError("That code didn't match. Check it and try again.");
                return;
            }
            /* DECISION Phase 88.6.1-18 (Req 5): a successful check unmounts the Verify button
               the user is standing on (the code-entry branch is swapped for the verified row),
               so focus would fall to <body>. The shared `useFocusRecovery` is armed HERE, at
               SUCCESS — the only path that removes the button (a wrong code or a failure leaves
               it mounted), and `arm` seeds from the live focused element, so a user who moved
               on during the request is not followed. This is the same choice plan 88.6.1-11
               made against plan 04's "arm before any await" wording.
               Target: the settled "Phone verified" text, programmatic focus only — it tells a
               screen-reader user the outcome (D-06 is the precedent). Fallback: the profile
               card's <h1>, the heading of this block's section (D-05).
               REJECTED: (a) inline per-host focus code (D-04, by tenet); (b) focusing a
               "Change number" link — it says nothing about what happened; (c) minting a
               heading or any text (D-05, D-31).
               Named residual: Safari does not focus a clicked button, so a mouse press there
               seeds nothing and focus is left where Safari put it. It is a decision, not a
               cleanup.
               AMENDED Phase 88.6.1-53 (Req 5, review 61): this arm runs for a CURRENT answer only;
               an answer that lands after Change number takes the stale branch above (the
               generation check, see the marker above `handleChangeNumber`). */
            const settle = phoneVerifyRecovery.arm({ preferred: () => phoneVerifiedRef.current });
            setPhoneState('verified');
            setVerificationCode('');
            // Reflect the now-verified number locally (enables the SMS toggles,
            // which gate on userData?.phone_verified) and keep the immortal self
            // cache coherent so a remount reads the verified state, not the stale
            // pre-verification row.
            setUserData(prev => (prev ? { ...prev, phone: phoneInput, phone_verified: true } : prev));
            patchSelfCache(queryClient, { phone: phoneInput, phone_verified: true });
            settle();
        } catch (error) {
            logger.info('Error verifying code:', errCtx(error));
            // A stale failure has no row to speak to (review 61): the diagnostic above still runs.
            if (isStale()) return;
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't check that code. Please try again.",
                    // The 400 arm covers MALFORMED/missing input only (routes/users.js:796-799,
                    // a code that is not 6 digits, and :807-809, no phone on file) — the actual
                    // wrong-code outcome is the 200 { verified: false } branch above, which
                    // reuses the same ratified copy.
                    byCode: { validation: "That code didn't match. Check it and try again." },
                })
            );
        } finally {
            // Released in `finally` so a FAILED check does not strand the control.
            verifyInFlightRef.current = false;
            setCheckingCode(false);
        }
    };

    /* DECISION Phase 88.6.1-53 (Req 5): Change number — in the code-entry row and in the verified
       row — unmounts the link the person pressed (the row is swapped for the input row), so focus
       used to fall to <body>. CHOSEN: arm plan 18's shared `phoneVerifyRecovery` at the press with
       the Phone number FIELD as the preferred target: it is the control the action exists to
       reach, and it mounts in the same commit that removes the link. The shared instance supplies
       the profile <h1> fallback. `from` is the pressed link, because Safari does not focus a
       clicked button (plan 04's consumer contract). REJECTED: (a) per-host inline focus code
       (D-04, by tenet); (b) the "Code sent to" line — it is gone after the change; (c) leaving
       focus to fall to <body>, which is the defect. UNVERIFIED: whether iOS raises the on-screen
       keyboard for this programmatic focus; either way focus lands on the field.

       A LATE VERIFY ANSWER (review 61). CHOSEN: the person's later Change number wins over an
       older verify answer — this handler bumps `phoneFlowGenerationRef`, `handleVerifyCode`
       captures it before its await, and an answer that finds it moved skips the verified row,
       both error lines and the success focus arm. REJECTED: refusing Change number while a verify
       is in flight (it would need its own `aria-disabled` state too); plan 18's latch blocks only
       a second Verify, so it does not cover this.

       AND A NEWER SAVE (review M-32, SPEC Edge R11 ordering). CHOSEN: a stale answer writes the
       server truth (the old number, verified) only when no phone save has started since it was
       sent — a SEPARATE counter, `phoneSaveGenerationRef`, bumped by `handleSaveAndVerify`, so a
       Change number with no save still lands the verified number. REJECTED: (a) always writing it
       — that writes an old number as verified over a newer save, unlocks the SMS toggles for a
       number no longer on file, and the immortal self cache would re-derive `verified` from it on a
       remount; (b) never writing it — a Change number the person then abandons would show a
       verified number as unverified. STATED LIMIT: a save that starts and then fails also
       suppresses the write, so the page under-reports a number the server verified until the
       self row is next read; under-reporting is the safe direction (the toggles stay off). A
       current answer cannot have a save between it and its send — the save control only mounts
       after Change number moves the row off code entry — so the save check sits in the stale
       branch only. Dropping either counter is a decision, not a cleanup. */
    const handleChangeNumber = (event) => {
        const settle = phoneVerifyRecovery.arm({ preferred: () => phoneNumberFieldRef.current, from: event?.currentTarget });
        phoneFlowGenerationRef.current += 1;
        setPhoneState('editing');
        setVerificationCode('');
        setPhoneError(null);
        settle();
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
    // body, deliberately not a second unmount effect. 88.6.1-60: so is the BGG import outcome's
    // hold observer, and the BGG import's result timer is cleared HERE too.
    useEffect(() => {
        return () => {
            if (importClearTimerRef.current) {
                clearTimeout(importClearTimerRef.current);
                importClearTimerRef.current = null;
            }
            if (importHoldObserverRef.current) {
                importHoldObserverRef.current.disconnect();
                importHoldObserverRef.current = null;
            }
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
    const handleRemovePhone = async (event) => {
        // Req 4 (88.6.1-53): the in-flight refusal, synchronous and FIRST — before the identity
        // guards and the arm branch, so a tap mid-removal neither re-arms nor commits. The same
        // pair as the senders' latches (see the `saveInFlightRef` marker, DECISION Phase 88.6-17).
        if (removeInFlightRef.current) return;
        // The pressed Remove, captured before any await (React clears `currentTarget` once the
        // handler returns): it seeds the focus arm at success (Safari, plan 04's contract).
        const pressed = event?.currentTarget ?? null;
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
        removeInFlightRef.current = true;
        setRemovingPhone(true);
        try {
            const updatedUser = await usersAPI.removePhone(selfUuid);
            // Req 5 (88.6.1-53): armed at SUCCESS, before the writes that remove this button (the
            // plan 18 / plan 11 precedent) — see `DECISION Phase 88.6.1-53 (Req 4)` at the button.
            const settle = phoneVerifyRecovery.arm({ preferred: () => smsDisabledBannerTextRef.current, from: pressed });
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
            settle();
        } catch (error) {
            logger.info('Error removing phone:', errCtx(error));
            setPhoneError(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't remove your number. Please try again.",
                })
            );
            // NOTE: do NOT set phoneJustRemoved on failure — banner only fires on success.
        } finally {
            // Released in `finally` so a FAILED removal does not strand the control.
            removeInFlightRef.current = false;
            setRemovingPhone(false);
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

    /* DECISION Phase 88.6.1-61 (Req 11, identity init): initialize editable state from the
       identity row the FIRST time one is available, whether or not the query is in error. The
       no-row fallback below is a placeholder that runs at most once and never counts as that once.
       The one-shot rule this replaces, kept verbatim (D-02): "initialize editable state from the
       shared self row exactly ONCE. The self cache is staleTime Infinity, and mutation handlers
       below own their own optimistic local-state updates + cache writes, so a reactive re-init on
       every `self` change would risk clobbering an in-progress edit. A one-shot guard keeps the
       mount-time population without that hazard."

       THE DEFECT, two triggers. (A) A refetch that fails KEEPS the row and reports an error
       (TanStack's `isRefetchError`); the old head tested `selfQuery.isError` first and treated
       that as "no identity": default settings over a real row, with the save path open
       (`selfUuid` is the row's id). (B) A first load that failed closed the one-shot guard, so a
       row arriving later by Retry or a tab return never initialized the page: defaults again,
       save path open. Either way one notification toggle saved the defaults over the user's own
       settings.

       CHOSEN: the row init runs once per visit, from the first row. ONE named corner: the
       fallback opens the paint gate, so the user can open the username editor before the row
       arrives; the row init then skips its username write while that editor is open (the typed
       name survives, and Cancel restores the row's name from `userData`), and `editingUsername`
       is listed in the dependency array for that read (chosen over a mirror ref: every re-run it
       causes is a no-op behind the two early returns). The phone writes need no such guard while
       the phone surface renders only from the row (`userData?.sms_enabled`).
       CHOSEN (owner ruling 2026-10-05): with no row the fallback writes NO notification settings,
       so the card stays hidden through its existing `preferences` guard (the same state the page
       shows while identity is still resolving) and appears with the user's own settings when the
       row arrives. REJECTED for that half: (i) the defaults as before (they read as the user's
       settings, a false statement); (ii) a notice in the card's place (new words, D-31); (iii) a
       second condition on the card such as the row's presence (two sources of truth for one fact).
       REJECTED for the init: (a) testing TanStack's `isLoadingError` instead of `self` (the same
       condition, but every writer's guard keys on the row, `selfUuid`, so the effect tests what
       the guards test); (b) re-initializing on every `self` change (the clobbering hazard above);
       (c) blocking the writers until a "fresh" row (a second mechanism; the kept row is the last
       server-confirmed one, and every successful save patches it).
       Restoring the error-first head, letting the fallback close the guard, writing defaults in
       the fallback, or dropping the open-editor guard is a decision, not a cleanup. */
    const profileInitRef = useRef(false);
    const profileFallbackRef = useRef(false);
    useEffect(() => {
        if (profileInitRef.current) return;
        if (!self) {
            // Identity failed with NO row — fall back to Auth0 user data and unblock the paint
            // gate (D-PAINT-01) and the two zones below, so the user doesn't stare at a skeleton
            // forever. Deliberately writes no notification settings (see the marker above).
            if (selfQuery.isError && !profileFallbackRef.current) {
                profileFallbackRef.current = true;
                setUsername(user?.name || user?.email?.split('@')[0] || 'User');
                setProfileLoaded(true);
                // WR-03: the owned-games + calendar-status fetchers never run when
                // identity fails terminally (they gate on selfUuid), so their loading
                // flags would stay true forever ("Loading your collection..." /
                // "Checking your calendar..."). Clear them here so those zones render their
                // degrade banner instead of an indefinite spinner. (88.6.1-67: the collection
                // zone no longer reads this flag for its loader — it keys on the loaded-for
                // state — and the write stays so the flag still means "no request in flight".)
                setLoadingGames(false);
                setCheckingCalendarStatus(false);
            }
            return;
        }
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
             AMENDED Phase 88.6.1-61 (Req 11): that premise was false until this
             phase — a failed refetch keeps `self` and the arm ran over it; the
             fallback now sits inside the no-row branch, so the sentence holds by
             construction. The non-change itself is untouched.
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
        // Review 66 (88.6.1-61): skipped while the username editor is open, so a name typed
        // during the no-row fallback survives a late row — see `DECISION Phase 88.6.1-61 (Req 11,
        // identity init)` above.
        if (!editingUsername) {
            setUsername(self.username || user?.name || user?.email?.split('@')[0] || '');
        }
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
    }, [self, selfQuery.isError, user?.name, user?.email, editingUsername]);

    const handleSaveUsername = async (event) => {
        // D-35 (88.6.1-59): the in-flight refusal, synchronous and FIRST — see
        // `DECISION Phase 88.6.1-59 (D-35, username)` at the editor's button row.
        if (saveUsernameInFlightRef.current) return;
        // The pressed Save, captured before any await: it seeds the focus arm at success.
        const pressed = event?.currentTarget ?? null;
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

        saveUsernameInFlightRef.current = true;
        setSavingUsername(true);
        try {
            const updatedUser = await usersAPI.updateUsername(selfUuid, username.trim());
            // Req 5 (88.6.1-59): armed at SUCCESS, before the write that closes the editor.
            const settle = usernameRecovery.arm({ preferred: () => editUsernamePencilRef.current, from: pressed });
            setUserData(updatedUser);
            // Cache-coherence: PATCH only the changed field. The PUT response is
            // a DEFAULT-scope row (no phone/email), while the immortal self row
            // was hydrated withContactInfo — replacing it wholesale would make a
            // verified phone vanish from the cached self for the session.
            patchSelfCache(queryClient, { username: updatedUser.username });
            setEditingUsername(false);
            toast.success('Username updated');
            settle();
        } catch (error) {
            logger.info('Error updating username:', errCtx(error));
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save your username. Please try again.",
                    byCode: { validation: "That username can't be used. Try a different one." },
                })
            );
        } finally {
            // Released in `finally` so a FAILED save does not strand the control.
            saveUsernameInFlightRef.current = false;
            setSavingUsername(false);
        }
    };

    // Req 5 (88.6.1-59): Cancel removes the editor it sits in, so it arms the same recovery FIRST
    // (synchronously, at the press), then makes its two unchanged state writes.
    const handleCancelUsernameEdit = (event) => {
        const settle = usernameRecovery.arm({ preferred: () => editUsernamePencilRef.current, from: event?.currentTarget ?? null });
        setEditingUsername(false);
        setUsername(userData?.username || user.name || user.email?.split('@')[0] || '');
        settle();
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
        pendingLabel: DISCONNECT_CALENDAR_PENDING_LABEL,
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

    /* DECISION Phase 88.6.1-67 (D-09a / D-37, collection refresh):
       DEFECTS: every call replaced the grid with the loading line and the count with an em-dash,
       after every add, remove and import; a failed load emptied the list into the empty-collection
       sentence (a false statement); an older answer could overwrite a newer list.
       CHOSEN: the 88.6.1-70 contract — the rows are never written on a failure (C1); the error
       clears only on the newest success (C2) and is the thrown error itself, never a wrapped one
       (C10: a wrapped error loses its code and would read as a transient failure); a loaded-for
       STATE keyed on the requested `selfUuid` is the has-loaded input (C3), never
       `ownedGames.length` (D-09a's reason), and plan 70's `useRetainedContent` turns it into the
       zone's `retained` (C10: an access or gone answer never keeps the rows); `{ isError }`
       results through a stable retry (C4, C5); `loadingGames` keeps its name and now means only
       "a collection request is in flight", read by the render solely for `aria-busy` on the grid
       (plan 88.6.1-41's rule); only the newest run (the generation ref) writes anything.
       REJECTED: (a) a length-keyed flag (it would also send a loaded EMPTY list to the banner — the
       owner's ruling Y, 2026-10-05, says that list is retained content); (b) a visible updating
       line (new words, D-31 — D-09 gave one to Browse Games only); (c) `aria-busy` on the card (it
       contains plan 60's live region); (d) clearing the error at the start of a run (C2: the banner
       or notice would vanish at the press and focus would leave its control); (e) an empty write
       on failure (C1); (f) a list of error codes of this page's own (C10: one predicate, plan
       70's, behind one hook).
       Restoring the per-call loader or the empty write is a decision, not a cleanup. */
    const fetchOwnedGames = useCallback(async () => {
        // 87.5 Plan 09: mount-fire sender — gate on the resolved self UUID (NOT
        // user?.sub) and depend on selfUuid so the callback re-creates and the
        // calling mount effect re-runs (firing the send) once identity resolves.
        if (!selfUuid) return undefined;
        const generation = ++ownedGamesRequestRef.current;
        try {
            setLoadingGames(true);
            const games = await userGamesAPI.getOwnedGames(selfUuid);
            if (generation !== ownedGamesRequestRef.current) return undefined;
            setOwnedGames(games || []);
            setOwnedGamesLoadedFor(selfUuid);
            setOwnedGamesError(null);
            return { isError: false };
        } catch (error) {
            logger.info('Error fetching owned games:', errCtx(error));
            if (generation !== ownedGamesRequestRef.current) return undefined;
            setOwnedGamesError(error);
            return { isError: true };
        } finally {
            if (generation === ownedGamesRequestRef.current) setLoadingGames(false);
        }
    }, [selfUuid]);
    // C5: a STABLE retry (the render-time ref idiom of UserHomePage.js's `upcomingRetryRef`), so the
    // adapter's `refetch` never changes identity; the hook's tab-return re-attempt calls it too.
    const fetchOwnedGamesRef = useRef(fetchOwnedGames);
    fetchOwnedGamesRef.current = fetchOwnedGames;
    const retryOwnedGames = useCallback(() => fetchOwnedGamesRef.current(), []);
    const collectionErrorState = useFetchErrorState({ isError: Boolean(ownedGamesError), error: ownedGamesError, refetch: retryOwnedGames });
    const collectionRetained = useRetainedContent(collectionLoadedForSelf, collectionErrorState);

    const searchBGG = async () => {
        // D-35: the button AND the field's Enter call this, so one refusal covers both entry points.
        // See `DECISION Phase 88.6.1-60 (D-35, BGG search)` at Search.
        if (searchInFlightRef.current) return;
        if (!bggSearchQuery.trim()) return;
        searchInFlightRef.current = true;
        setBggSearching(true);
        // Emptied as the search starts, so the same count twice is a DOM change and is spoken twice.
        setBggFoundAnnouncement('');
        try {
            const results = await gamesAPI.searchBGG(bggSearchQuery);
            setBggSearchResults(results || []);
            /* DECISION Phase 88.6.1-60 (review 221, owner 2026-10-13): a search that lands with results is
               announced through ONE new always-mounted sr-only polite StatusRegion in the collection
               card, outside the search panel's conditional and outside the owned-games list, which
               speaks the ratified pair (copy row F8, hoisted: BGG_FOUND_ONE_LABEL / bggFoundManyLabel).
               A NEW region because no existing one qualifies (polite, sr-only while it holds text,
               mounted in every state a search can run in, writable from here): the import outcome
               region and the phone format region become VISIBLE when they hold text; the three
               gates' status nodes carry their hook's text; the save-outcome polite region sits in
               the Notification Preferences card, shares its setter and clear timer with the save
               outcomes, and is absent whenever no identity row is held (plan 88.6.1-61), while this
               search has no identity guard. Emptied when a search starts; zero results keep the
               existing toast and leave the region empty, so the two never speak together; the catch
               writes nothing (its toast speaks). REJECTED: a visible results line (a look change,
               not ruled); speaking zero through the region too (two announcements of one outcome);
               reusing a region that fails the test above; naming the games (a long list read aloud,
               and the list is on screen). Written only here, never from a render or an effect. */
            const found = (results || []).length;
            if (found === 1) {
                setBggFoundAnnouncement(BGG_FOUND_ONE_LABEL);
            } else if (found > 1) {
                setBggFoundAnnouncement(bggFoundManyLabel(found));
            }
            // 88.6.1 code review A-68: the computed count — `results` may be null (guarded above).
            if (found === 0) {
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
            // Released in `finally` so a FAILED search does not strand the control.
            searchInFlightRef.current = false;
            setBggSearching(false);
        }
    };

    const addGameToCollection = async (game_id, event) => {
        // D-35 (88.6.1-67): the in-flight refusal, synchronous and FIRST — see
        // `DECISION Phase 88.6.1-67 (D-35, Add to Collection)` at the Add button.
        if (addGameInFlightRef.current) return;
        // 88.6.1 code review A-73 / WR-09: the pressed Add, captured BEFORE any await and passed as
        // `from` (useFocusRecovery consumer contract (1)) — iOS Safari does not focus a tapped
        // button, so a seed read from `document.activeElement` after the await is <body>.
        const pressed = event?.currentTarget ?? null;
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        addGameInFlightRef.current = true;
        setAddingBggId(game_id);
        try {
            // If game_id is a BGG ID, import it first
            let gameId = game_id;
            if (typeof game_id === 'number' || (typeof game_id === 'string' && !game_id.includes('-'))) {
                // It's a BGG ID, import it first
                const importedGame = await gamesAPI.importFromBGG(game_id);
                gameId = importedGame.id;
            }
            
            const added = await userGamesAPI.addOwnedGame(selfUuid, gameId);
            const settle = collectionRecovery.arm({ preferred: () => addFromBggToggleRef.current, from: pressed });
            /* Part of `DECISION Phase 88.6.1-67 (D-35, Add to Collection)` (at the Add button).
               At the add's CONFIRMATION, before the refresh:
               - the answer's `game` row joins the list (D-54's rule, as Remove; finding #75), placed
                 by name as the GET orders it, and skipped when that id is already listed (the BE
                 answers the same shape for a game already in the collection); an answer with no row
                 appends nothing and the refresh brings it. Without it the just-added game read
                 addable again in a reopened search until the refresh landed, and was missing from
                 the list kept under RF1 when that refresh failed (findings #75 / #74);
               - the panel closes BEFORE the refresh, chosen OVER the old refresh-then-close: the
                 refreshed list flips the pressed button to its native `isAlreadyOwned` disable, and
                 in a real browser a natively disabled focused button loses focus while still in the
                 document, which the shared hook reads as the user having moved on and does not
                 recover (plan 88.6.1-04's consumer contract, item 3). Closing first removes the
                 pressed button while it is still focusable — the one signal the hook acts on;
               - the latch is released HERE, not after the refresh: holding it through the refresh
                 left every Add in a reopened search natively disabled, with no reason given, for the
                 length of a slow GET (finding #75). */
            const addedRow = added?.game;
            if (addedRow?.id) {
                setOwnedGames((games) => (
                    games.some((game) => game.id === addedRow.id)
                        ? games
                        : [...games, addedRow].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
                ));
            }
            setShowBggSearch(false);
            // 88.6.1 code review A-76: the result count leaves with the panel it counted.
            setBggFoundAnnouncement('');
            setBggSearchQuery('');
            setBggSearchResults([]);
            addGameInFlightRef.current = false;
            setAddingBggId(null);
            await fetchOwnedGames();
            // Req 12: this mutation closes the search panel it was started from, so
            // without a receipt the only feedback is a panel vanishing.
            toast.success('Game added');
            settle();
        } catch (error) {
            logger.info('Error adding game to collection:', errCtx(error));
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't add that game. Please try again.",
                })
            );
        } finally {
            // Released in `finally` too, so a FAILED add does not strand the control.
            addGameInFlightRef.current = false;
            setAddingBggId(null);
        }
    };

    /* DECISION Phase 88.6.1-67 (Req 5, collection focus):
       DEFECT: the second tap commits, the removal takes out the row holding the focused control,
       and focus fell to <body>.
       CHOSEN: the `+ Add from BGG` toggle — the add-back control the gate's own body names — else
       the `My Game Collection` heading (D-05); armed at the server's confirmation (or its 404),
       just before the row leaves, so a failed remove (the row stays) moves nothing. Focus moves
       once, when the row leaves; the refresh that follows moves nothing more — failed (RF1 above
       the remaining rows) or answered "signed out" / "no access" (the remaining rows are
       withdrawn, they hold no focus, and plan 70's guard has nothing to move). The same two
       targets plan 60's result timer uses, through the same refs. The same instance serves Add to
       Collection.
       REJECTED: (a) the next row's Remove — a destructive control under the finger right after a
       destructive action (plan 59's ruling); (b) per-host inline focus code (D-04); (c) a minted
       heading or text (D-05, D-31); (d) second refs on the same elements (an element takes one
       `ref`; plan 60's are reused). Changing the landing is a decision, not a cleanup. */
    /* DECISION Phase 88.6.1-67 (D-54, remove on confirm):
       CHOSEN: the row leaves the list when the server confirms the removal, or answers 404, not
       when the next read lands; both paths then refresh, so a 404 for a gone identity withdraws
       the rest of the list through C10 (orchestrator D-r3-8). This is D-54's rule for friend
       requests (`88.6.1-CONTEXT.md`, anchor `D-54 [owner] Friend request rows`), applied to the
       collection. The drop runs BEFORE this action's own refresh starts, so that refresh
       supersedes any older read still in flight (the generation ref), and a failed refresh writes
       no rows (C1): the drop holds.
       REJECTED: (a) waiting for the refresh — under a failed refresh the deleted game stayed listed
       under "Showing what loaded earlier", still read `Already Owned` in the search, and a second
       Remove on it answered 404 (finding #74); (b) removing before the server answers and
       restoring on failure (D-54 rejected remove-then-restore); (c) no refresh on the 404 path
       (this plan's r2 shape) — a 404 for a gone identity (the BE's `User not found`, checked
       before `Game not found in your collection`) then dropped one row and left the rest
       presented as current, and an older read in flight could restore the dropped game; reading
       the BE's 404 prose to tell the two 404s apart was rejected too (prose is not a contract).
       Putting the removal back behind the refresh is a decision, not a cleanup. */
    // `opts.from` (88.6.1 code review A-74): the pressed Remove, handed over by the two-tap gate —
    // iOS Safari does not focus a tapped button, so the arm below needs it as its seed.
    const removeGameFromCollection = async (game_id, opts) => {
        if (!user?.sub) return;
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        // ONE shared step for both confirmed paths (the resolved DELETE and its 404): arm the focus
        // instance FIRST, so it is armed when the row leaves, then drop the row; returns `settle`.
        const dropRemovedGame = () => {
            const settle = collectionRecovery.arm({ preferred: () => addFromBggToggleRef.current, from: opts?.from ?? null });
            setOwnedGames((games) => games.filter((game) => game.id !== game_id));
            return settle;
        };
        try {
            await userGamesAPI.removeOwnedGame(selfUuid, game_id);
            const settle = dropRemovedGame();
            await fetchOwnedGames();
            toast.success('Game removed');
            settle();
        } catch (error) {
            logger.info('Error removing game from collection:', errCtx(error));
            // 88.6.1 code review A-67 / WR-11: keyed on `ApiError.code` (DECISION Phase 88-25), and a
            // 404 toasts nothing — it is a confirmed removal (D-54 above), so an error toast beside
            // the row leaving misreported it; a gone-identity 404 speaks through the refresh (C10).
            if (error?.code === 'not_found') {
                const settle = dropRemovedGame();
                await fetchOwnedGames();
                settle();
                return;
            }
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
        onConfirm: (gameId, ctx) => removeGameFromCollection(gameId, ctx),
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

    const handleCreateRecurringPattern = async (event) => {
        // D-35 (88.6.1-59): the in-flight refusal, synchronous and FIRST — see
        // `DECISION Phase 88.6.1-59 (D-35, availability forms)` at Save Schedule.
        if (savePatternInFlightRef.current) return;
        // The pressed Save, captured before any await (React clears `currentTarget` once the
        // handler returns): it seeds the focus arm at success (Safari, plan 04's contract).
        const pressed = event?.currentTarget ?? null;
        // 87.4 Plan 10: gate on the resolved self identity, not user?.sub, so the
        // write cannot fire (and cannot send an empty self-param) before self resolves.
        // 88.6.1-61 (review 65): the refusal says so — see `DECISION Phase 88.6.1-61 (AC-29, identity notices)`.
        if (!self?.id) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
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
        savePatternInFlightRef.current = true;
        setSavingPattern(true);
        // Req 11 (88.6.1-59): the days whose create was CONFIRMED (its request resolved) — see
        // `DECISION Phase 88.6.1-59 (Req 11, partial save)` in the catch.
        const createdDays = [];
        try {
            // Create one schedule per selected day
            for (const dayOfWeek of recurringForm.daysOfWeek) {
                const formData = { ...recurringForm, dayOfWeek };
                delete formData.daysOfWeek;
                if (!formData.end_date || formData.end_date.trim() === '') {
                    delete formData.end_date;
                }
                await availabilityAPI.createRecurringPattern(self.id, formData);
                createdDays.push(dayOfWeek);
            }
            await patternsQuery.refetch();
            // Req 5 (88.6.1-59): armed at SUCCESS, before the write that closes the form and
            // removes this button (the plan 18 precedent).
            const settle = availabilityRecovery.arm({ preferred: () => addScheduleToggleRef.current, from: pressed });
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
            settle();
        } catch (error) {
            logger.info('Error creating schedule:', errCtx(error));
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save that schedule. Please try again.",
                })
            );
            /* DECISION Phase 88.6.1-59 (Req 11, partial save): the loop creates one row per day, so a
               failure on day k used to leave days 1 to k-1 saved but not listed (this catch never
               re-read the list), and a retry created them again — the backend accepts duplicates
               (`routes/availability.js` creates with no existence check; `UserAvailability` has no
               unique index).
               CHOSEN: drop the days whose create was CONFIRMED from the selection, and re-read the
               list on EVERY failure, so the list shows what the backend had committed by the time of
               the re-read and a retry never re-sends a confirmed day. The toast above stays.
               RESIDUAL, named (not claimed fixed): a day whose answer was lost (the proxy's 30 s
               abort, which does not stop the backend, or a dropped connection after the commit)
               stays selected and can be duplicated on retry until the backend dedupes — routed to
               Phase 91 (`.planning/deferred/phase-91.md`, `POST /availability/user/:id/recurring
               accepts duplicates`); a commit that lands after the re-read is missed until the next
               load.
               REJECTED: (a) leaving the selection (duplicates on retry); (b) a saved-N-of-M line (new
               words, D-31; and the toast rule above drops counts); (c) one batch request (a backend
               change, out of this frontend-only phase); (d) deleting the created rows on failure
               (destroys saved data on a transient error); (e) re-reading only when a create was
               confirmed (a lost-answer commit on day 1 would stay off the list); (f) trimming the
               selection against the re-read list (matching dates and timezones is brittle, and a late
               commit can still miss the re-read — the backend dedupe is the real guard).
               The latch is released in `finally`, AFTER the re-read, so a retry cannot start before
               the trimmed selection commits. Undoing either half is a decision, not a cleanup. */
            if (createdDays.length > 0) {
                setRecurringForm((prev) => ({ ...prev, daysOfWeek: prev.daysOfWeek.filter((d) => !createdDays.includes(d)) }));
            }
            // TanStack swallows a failed refetch without `throwOnError`, so this never throws.
            await patternsQuery.refetch();
        } finally {
            // Released in `finally` so a FAILED save does not strand the control.
            savePatternInFlightRef.current = false;
            setSavingPattern(false);
        }
    };

    const handleCreateSpecificOverride = async (event) => {
        // D-35 (88.6.1-59): the same first-line refusal on the SAME latch — see
        // `DECISION Phase 88.6.1-59 (D-35, availability forms)` at Save Schedule.
        if (savePatternInFlightRef.current) return;
        // The pressed Save, captured before any await (see the recurring handler).
        const pressed = event?.currentTarget ?? null;
        // 87.4 Plan 10: gate on the resolved self identity, not user?.sub, so the
        // write cannot fire (and cannot send an empty self-param) before self resolves.
        // 88.6.1-61 (review 65): the refusal says so — see `DECISION Phase 88.6.1-61 (AC-29, identity notices)`.
        if (!self?.id) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }
        // 88-CODE-REVIEW MED#7: same client-side start<end mirror as the recurring form
        // (availability.js:208 on this path).
        if (specificForm.startTime >= specificForm.endTime) {
            toast.error('Start time must be before end time.');
            return;
        }
        savePatternInFlightRef.current = true;
        setSavingPattern(true);
        try {
            await availabilityAPI.createOverride(self.id, specificForm);
            await patternsQuery.refetch();
            // Req 5 (88.6.1-59): armed at SUCCESS, as in the recurring handler.
            const settle = availabilityRecovery.arm({ preferred: () => addOverrideToggleRef.current, from: pressed });
            setShowSpecificForm(false);
            setSpecificForm({
                date: toLocalDateString(),
                startTime: '09:00',
                endTime: '17:00',
                isAvailable: true,
            });
            toast.success('Override created');
            settle();
        } catch (error) {
            logger.info('Error creating specific override:', errCtx(error));
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save that override. Please try again.",
                })
            );
        } finally {
            // Released in `finally` so a FAILED save does not strand the control.
            savePatternInFlightRef.current = false;
            setSavingPattern(false);
        }
    };

    /* DECISION Phase 88.6.1-59 (Req 5, row delete): the second tap commits, the re-read removes the
       row holding the focused Delete, and focus used to fall to <body>.
       CHOSEN: the same panel's toggle (`+ Add Schedule` / `+ Add Override`, the control that adds a
       row back), else the `Availability Settings` heading, through the page's one
       `availabilityRecovery`; armed at SUCCESS, so a failed delete (the row stays) moves nothing.
       REJECTED: (a) the next row's Delete — it puts a destructive control under the user's finger
       right after a destructive action, and these lists are short; (b) per-host inline focus code
       (D-04, by tenet); (c) a minted heading (D-05). Changing this is a decision, not a cleanup.
       AMENDED 2026-10-19 (88.6.1 code review A-74): the arm moves to the START of the action,
       before the DELETE's await (useFocusRecovery consumer contract (1)), seeded with the pressed
       Delete the two-tap gate now hands over (`ctx.from`; iOS Safari does not focus a tapped
       button), and settles in `finally`. "A failed delete moves nothing" still holds: the row
       stays, so the watched Delete is still connected and the hook does not act. */
    const performDeletePattern = async (patternId, opts) => {
        const rowType = availabilityPatterns.find((p) => p.id === patternId)?.type;
        const settle = availabilityRecovery.arm({
            preferred: () => (rowType === 'specific_override' ? addOverrideToggleRef.current : addScheduleToggleRef.current),
            from: opts?.from ?? null,
        });
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
        } finally {
            settle();
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
        onConfirm: (patternId, ctx) => performDeletePattern(patternId, ctx),
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
        // D-35: a press mid-import must not reopen the dialog over the running import.
        // See `DECISION Phase 88.6.1-60 (D-35, BGG import)` at Import Collection.
        if (importInFlightRef.current) return;
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

    // Req 8 / review 220 (88.6.1-60): every write the import makes to its outcome region goes
    // through here. While the region sits under an `aria-hidden` ancestor (the closing import dialog's
    // modal hiding, lifted only when its content unmounts) the write is HELD and applied in order, one
    // commit each, the moment that hiding lifts; otherwise it goes straight through. See
    // `DECISION Phase 88.6.1-60 (Req 8 / D-22, BGG import outcome)` at the region.
    const writeImportProgress = (value) => {
        const isHidden = () => Boolean(importStatusRegionRef.current?.closest('[aria-hidden="true"]'));
        if (!importStatusRegionRef.current || (heldImportWritesRef.current.length === 0 && !isHidden())) {
            setImportProgress(value);
            return;
        }
        heldImportWritesRef.current.push(value);
        if (importHoldObserverRef.current) return;
        const observer = new MutationObserver(() => {
            if (isHidden()) return;
            observer.disconnect();
            importHoldObserverRef.current = null;
            // One commit per held write, so a result that settled inside the exit still lands as a
            // text CHANGE after the progress line (a batched update would collapse the two).
            heldImportWritesRef.current.splice(0).forEach((next) => flushSync(() => setImportProgress(next)));
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-hidden'] });
        importHoldObserverRef.current = observer;
    };

    const importBGGCollection = async () => {
        // D-35: a second Continue before the dialog's exit ends must not start a second import.
        // See `DECISION Phase 88.6.1-60 (D-35, BGG import)` at Import Collection.
        if (importInFlightRef.current) return;
        setBggImportPromptOpen(false);
        if (!user?.sub || !bggUsername.trim() || !selfUuid) return;
        // The exact name sent, so the result timer compares against what was imported (Req 11).
        const importedName = bggUsername.trim();

        importInFlightRef.current = true;
        setImportingCollection(true);
        // A new import is never touched by an earlier import's result timer (Req 11).
        if (importClearTimerRef.current) {
            clearTimeout(importClearTimerRef.current);
            importClearTimerRef.current = null;
        }
        try {
            writeImportProgress({ status: 'fetching', message: 'Fetching your BGG collection...' });

            const result = await userGamesAPI.importBGGCollection(selfUuid, importedName);
            
            writeImportProgress({
                status: 'complete',
                message: `Imported ${result.imported} games`,
                details: result
            });
            
            // Refresh the owned games list
            await fetchOwnedGames();
            
            /* DECISION Phase 88.6.1-60 (Req 11 / Req 5, import result timer).
               Defects fixed: (1) the handle was never held, so a second import inside the window had
               its progress line wiped mid-import by the first timer, and nothing cancelled it on
               unmount. Now it is cleared when a new import starts, and a timer PENDING at unmount is
               cancelled in the page's one unmount effect. A timer scheduled AFTER unmount (the import
               or its refresh was still running) runs once and does nothing: the username field ref is
               null, so the name is not cleared and focus is not moved, and the progress write on an
               unmounted page is a no-op (review 67). (2) The callback emptied the username, which
               natively disabled the still-focused Import Collection (its blank-name half) and dropped
               keyboard focus to the top of the page five seconds after success.
               CHOSEN, the owner's own design (2026-10-05), which replaced this plan's options K and C:
               the box still empties after five seconds and the result line still goes, because a
               second press re-imports and every import makes two BoardGameGeek calls
               (periodictabletopbackend_v2/Sonnet/routes/userGames.js:173-174) the owner does not want
               made by accident; but if focus is still on Import Collection at that moment it first
               moves to + Add from BGG beside it (the same button reads Hide Search while the search is
               open), else the My Game Collection heading, else the page floor: D-05's order through
               plan 04's outcome-checked primitives, the same target and fallback plan 67 uses after
               Remove and Add. Focus anywhere else is left alone.
               Never wipes what the user is using (orchestrator decision 2026-10-05; the owner's intent
               was only "no leftover name"): the name is cleared only when the box still holds the
               imported name (`importedName`) and the import dialog is closed. A newly typed name
               stays; a second Import Collection press inside the window keeps the dialog's name, so
               Continue re-imports it (it used to close silently on a blank name). The result line goes
               on schedule either way, and the focus move happens only when the name is cleared.
               Why the order inside the callback is load-bearing: the move runs while Import Collection
               is still ENABLED, so the native disable the emptied name causes lands on a button that no
               longer holds focus. A check after the commit cannot work: by then the browser has
               already moved focus to the body and nothing can tell where the user was.
               REJECTED: (a) keep the username (option K: a press then re-imports; the owner's reason
               above); (b) focus the emptied username field (option C: superseded by the owner's
               design; a jump into a text box); (c) make the blank-name half aria-disabled so the
               button keeps focus (reverses D-35's rule of KIND, DECISION Phase 88.6-22, and leaves the
               user on a dead control); (d) plan 04's useFocusRecovery (it acts only on a removed
               element and reads a native disable as the user moving on); (e) a second unmount effect
               (the file's rule); (f) skipping the clear whenever the box is non-empty (the imported
               name is non-empty too, so the box would never clear); (g) a functional username updater
               that decides inside React (the focus move needs the decision synchronously, before the
               write, and an updater must stay free of side effects).
               Restoring the old callback, moving the focus step after the state writes, or dropping
               either skip condition is a decision, not a cleanup. */
            importClearTimerRef.current = setTimeout(() => {
                importClearTimerRef.current = null;
                const usernameField = bggUsernameFieldRef.current;
                const clearName = !importPromptOpenRef.current
                    && usernameField !== null
                    && usernameField.value.trim() === importedName;
                if (clearName) {
                    const importButton = importButtonRef.current;
                    if (importButton && document.activeElement === importButton) {
                        if (!focusElement(addFromBggToggleRef.current)
                            && !focusElement(collectionHeadingRef.current)) {
                            focusPageFloor(importButton);
                        }
                    }
                    setBggUsername('');
                }
                // Any write still held (a hiding that outlasted the window) predates this emptying
                // and must not land after it.
                heldImportWritesRef.current = [];
                setImportProgress(null);
            }, 5000);
        } catch (error) {
            logger.info('Error importing BGG collection:', errCtx(error));
            writeImportProgress({
                status: 'error',
                message: getFetchErrorMessage(error, {
                    fallback: "We couldn't import that collection. Check the username and try again.",
                })
            });
        } finally {
            // Released in `finally` so a FAILED import does not strand the control.
            importInFlightRef.current = false;
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
       src/lib/colorUtils.js ("this warn fires on THIS arm only") already litigated and rejected — including the tempting
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
                        <p ref={smsDisabledBannerTextRef} className="flex-1 text-sm text-amber-900 dark:text-amber-100">
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
                        {/* DECISION Phase 88.6.1-53 (Req 5, review item 214): pressing Dismiss unmounts the
                            whole banner with this button inside it, so focus used to fall to <body>.
                            CHOSEN: arm plan 18's shared `phoneVerifyRecovery` with the Phone number
                            field as the preferred target — the control the dismissed sentence pointed
                            at. While the banner shows, the field is mounted in the idle / editing /
                            saving rows; in the code-entry state it is not (a save moves the row to code
                            entry without touching `userData`, so the banner can still show), and there
                            the shared instance's <h1> fallback takes focus. REJECTED: (a) the <h1> as
                            the PREFERRED target — it skips past the control the sentence names; (b)
                            leaving focus to fall to <body>, the defect. This differs from the Remove
                            marker's rejected (b) on purpose: after a destructive Remove the empty field
                            says nothing about what just happened, so focus goes to this sentence; here
                            the person has read the sentence and dismissed it, and it named the field.
                            UNVERIFIED, as for Change number: whether iOS raises the keyboard for this
                            programmatic focus. Only the onClick changed; the A10 marker above, the raw
                            button and its classes are untouched. */}
                        <button
                            type="button"
                            onClick={(event) => {
                                const settle = phoneVerifyRecovery.arm({ preferred: () => phoneNumberFieldRef.current, from: event.currentTarget });
                                setSmsDisabledBannerDismissed(true);
                                settle();
                            }}
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
                {/* DECISION Phase 88.6.1-53 (D-46 / R7-M7): this breadcrumb reaches the house
                    standard groupPlanning's and gameDetail's two already meet (plans 88.6.1-16 and
                    88.6.1-52). CHOSEN (a): the
                    house focus ring on the Home link, per site (`DECISION Phase 88.3-17`, which chose
                    per-site OVER a global `a:focus-visible` rule); D-46 counted five unringed
                    breadcrumb links and this is the last of them. CHOSEN (b): `aria-hidden` on the
                    `>` separator — it is decoration, a screen reader read "greater than" between the
                    crumbs, and it looks the same. CHOSEN (c): `min-w-0` on the nav — inert under
                    today's block parent, kept so a future flex parent cannot let `min-width: auto`
                    beat `max-w-full` and re-open UAT3-D1. This DEPARTS FROM the UAT3-D1 close-out
                    marker in `groupHomePage/page.js` ("deliberately NOT added"); SPEC Requirement 11
                    (R7-M7) rules the change, and plan 88.6.1-55 amends that marker in place.
                    Dropping any of the three is a decision, not a cleanup. */}
                <nav aria-label="Breadcrumb" className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block max-w-full wrap-break-word min-w-0">
                    <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2">Home</Link>
                    <span aria-hidden="true" className="text-content-muted mx-2">{'>'}</span>
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
                    {/* AC-29 / D-51 (88.6.1-79): the shared RF1 notice, mounted unconditionally
                        (88.6.1-70 contract C6), reading the RAW identity state; then the card's ONE
                        focus guard, outside the swapped arm and with no target (C12). See
                        `DECISION Phase 88.6.1-79 (AC-29 / D-51, identity kept row)`. */}
                    <RefreshFailedNotice state={selfIdentityErrorState} retained={identityRetained} className="mb-4" />
                    <RetainedContentFocusGuard retained={identityRetained} />
                    {/* Avatar + Username zone — paint-gated (D-PAINT-01) so user.name (Auth0/Google)
                        never flashes before userData.username arrives. Skeleton on first paint;
                        real content (or Auth0 fallback on fetch failure) once profileLoaded flips.
                        88.6.1-79: an access or gone answer over a kept row withdraws the zone — the
                        page heading reads the session name, the full banner below it. */}
                    {identityWithdrawn ? (
                        <div className="flex flex-col gap-3 md:gap-4">
                            <Heading ref={profileHeadingRef} level={1} size="display" className="text-content-primary">
                                {/* 88.6.1 code review IN-15: the no-row fallback chain, so a session with
                                    no `name` still renders the page's one h1 (Heading drops empty children). */}
                                {user?.name || user?.email?.split('@')[0] || 'User'}
                            </Heading>
                            <FetchErrorBanner state={selfIdentityErrorState} />
                        </div>
                    ) : profileLoaded ? (
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
                                            id="profile-username"
                                            name="profile-username"
                                            autoComplete="nickname"
                                            aria-label="Username"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            maxLength={50}
                                            className="flex-1"
                                            placeholder="Enter username"
                                            autoFocus
                                        />
                                        {/* DECISION Phase 88.6.1-59 (D-35, username): Save's in-flight half is the
                                            rule of POSITION (`aria-disabled` plus the `saveUsernameInFlightRef`
                                            refusal as the handler's first statement, released in `finally`); its
                                            blank-name half is the rule of KIND and stays NATIVE (nobody can save a
                                            blank name). Cancel is a SIBLING (D-35), so it stays natively disabled
                                            while saving; but its own click removes the editor, so it arms the same
                                            recovery first. Both exits land on the Edit-username pencil (the control
                                            that opened the editor, mounted in the same commit), else the profile
                                            <h1>.
                                            REJECTED: (a) native `disabled` for the in-flight half (it drops focus in
                                            a real browser); (b) focusing the <h1> on a save (the success toast
                                            already announces the outcome, and one target for Save and Cancel keeps
                                            the editor's exit predictable); (c) per-host inline focus code (D-04).
                                            Disclosed visible delta: while saving, Save shows the gated primary pair
                                            instead of the half-strength wash. Dropping either half of the pair is a
                                            decision, not a cleanup. */}
                                        <div className="flex gap-2">
                                            <Button
                                                variant="primary"
                                                onClick={handleSaveUsername}
                                                disabled={!username.trim()}
                                                aria-disabled={savingUsername ? 'true' : undefined}
                                                className="whitespace-nowrap"
                                            >
                                                {savingUsername ? 'Saving...' : 'Save'}
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                onClick={handleCancelUsernameEdit}
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
                                        <Heading ref={profileHeadingRef} level={1} size="display" className="text-content-primary">
                                            {userData?.username || user.name}
                                        </Heading>
                                        {/* §7.3: an icon-only control needs a real accessible
                                            name. While the pencil glyph was the whole content the
                                            name announced was the emoji, and a `title` did not
                                            count. AMENDED Phase 88.6.1-53 (review item 215, the D-52 /
                                            D-53 shape): the glyph is now `aria-hidden`, so the
                                            `title` IS the name, and it is the ONE name source.
                                            CHOSEN: the title as the single name, the shape the
                                            owner ruled for the home gear and the group icon tiles.
                                            REJECTED: an `aria-label` beside an identical `title`,
                                            which reads the name twice (the title becomes the
                                            description; the double-read `GroupSettings.js` records
                                            beside its colour swatches). If VoiceOver does not read
                                            the title, that goes back to the owner (D-53's rule).
                                            Re-adding an `aria-label` here is a decision, not a
                                            cleanup. */}
                                        {/* DECISION Phase 88.6.1-53 (V-1a / AC-23): the pencil's focus ring is INSET.
                                            UI review 2026-09-30 (Top Fix 2, WINDOWS #33): the bare emoji measured
                                            ~20x24 — below the 44px floor. Same negative-margin idiom as the
                                            banner dismiss above (`-m-2 inline-flex min-h-11 min-w-11`): the
                                            target grows; the glyph shifts ~4px right (the -8px margin consumes the row's gap-2).
                                            The focus ring is the house string, per-site as `globals.css` records; the bare
                                            emoji button carried none (UI re-audit 2026-09-30, N-2).
                                            DEFECT: the `-m-2` box's left edge sits on the heading's right edge
                                            (the row's 8px gap minus the 8px margin), so the house ring with its
                                            2px offset painted 4px outside that box, over the last letter of the
                                            name. The owner confirmed it on 2026-09-30 ("the tabbed border covers
                                            the last letter of the name").
                                            CHOSEN: the inset ring. The ring box is now the button box, which
                                            touches the heading and never overlaps the text, and nothing changes
                                            at rest. Precedent: the `groupHomePage/page.js` tab strip.
                                            REJECTED: (a) trading the left negative margin for clearance — it
                                            moves the glyph the owner passed ("Pencil is good"), so it is a look
                                            change for Phase 88.9; (b) keeping the outset ring, which is the defect.
                                            Inconsistent with the banner dismiss ON PURPOSE: the dismiss keeps the
                                            outset ring, because its ring stops at the banner text's box edge
                                            (measured in `e2e/profile-pressed-controls.spec.ts`). This one is
                                            measured by `e2e/profile-pencil-ring.spec.ts`. Restoring the offset is
                                            a decision, not a cleanup. */}
                                        <button
                                            ref={editUsernamePencilRef}
                                            onClick={() => setEditingUsername(true)}
                                            className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-btn text-content-link hover:text-content-link-hover text-base focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                                            title="Edit username"
                                        >
                                            <span aria-hidden="true">✏️</span>
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
                                                {/* W065 (88.6-REVIEW WR-504, fixed in 88.6.1-53): browser
                                                    autofill reads id, name and autocomplete, never ARIA, so
                                                    every field here carries all three. tel offers the saved
                                                    number; on the code field, one-time-code lets iOS and
                                                    Android offer the texted code and numeric brings up the
                                                    number pad. The Username field takes nickname, not
                                                    username: it is the public display name and Auth0 owns
                                                    login, so username would invite password managers and
                                                    QuickType to offer the login email there. */}
                                                <Input
                                                    ref={phoneNumberFieldRef}
                                                    id="profile-phone"
                                                    name="profile-phone"
                                                    autoComplete="tel"
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
                                                {/* DECISION Phase 88.6.1-53 (D-22 / D-42, R3-A29): the
                                                    format hint is the house ALWAYS-MOUNTED polite region.
                                                    KEPT: POLITE, for the existing reason (the DEF-88-19-04
                                                    gap, client-side half) — it types as you go, so an alert
                                                    on every keystroke would talk over the person mid-entry;
                                                    the submit-time failure below is the one that interrupts.
                                                    CHANGED: the mount. D-42 confirms that a conditionally
                                                    mounted POLITE region is unreliably announced, which is
                                                    exactly what the old status paragraph was, so its message
                                                    could go unheard. The region is now mounted with the
                                                    input row and its text is injected, in the one house
                                                    empty-region shape (`srOnlyWhenEmpty`, D-22): identical
                                                    output when set, no footprint when empty. The field's
                                                    `aria-describedby` names it only while it holds text.
                                                    REJECTED: (a) the conditional status node (the defect);
                                                    (b) assertive (it types as you go); (c) a hand-rolled
                                                    empty-state ternary (D-22: one house shape). Restoring
                                                    the conditional mount is a decision, not a cleanup. */}
                                                <StatusRegion
                                                    id="phone-format-error"
                                                    srOnlyWhenEmpty
                                                    className="text-content-status-error text-xs mt-1"
                                                    message={phoneValidation.error}
                                                />
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
                                                    id="profile-verification-code"
                                                    name="profile-verification-code"
                                                    autoComplete="one-time-code"
                                                    inputMode="numeric"
                                                    aria-label="Verification code"
                                                    value={verificationCode}
                                                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                    placeholder="Enter 6-digit code"
                                                    maxLength={6}
                                                    aria-invalid={phoneError ? 'true' : undefined}
                                                    aria-describedby={phoneError ? 'phone-flow-error' : undefined}
                                                    className="w-32 text-center tracking-widest"
                                                />
                                                {/* DECISION Phase 88.6.1-18 (W066 / D-35): two conditions,
                                                    two attributes, one control.
                                                    (1) An incomplete-code PRECONDITION gate on a control
                                                    nobody has activated — the rule of kind leaves it
                                                    natively `disabled`.
                                                    (2) The IN-FLIGHT state is `aria-disabled` plus the
                                                    `verifyInFlightRef` refusal in `handleVerifyCode` — the
                                                    rule of POSITION (`DECISION Phase 88.6-22`,
                                                    FriendInvitePanel.js:59): this is the control the user
                                                    just pressed, so it keeps focus and a second press is
                                                    refused. Its label while checking is copy row P1.
                                                    REJECTED: (a) native `disabled` while checking — it
                                                    drops focus to <body> in a real browser; (b) folding
                                                    the precondition into `aria-disabled` — Save & Verify
                                                    keeps its validity gate native too; (c) making the
                                                    code field read-only while checking — nothing submits
                                                    from that field (no form, no key handler on it), so it
                                                    is not the activated control.
                                                    Disclosed visible delta: while checking, Verify now
                                                    shows the P1 label on the gated primary colour pair;
                                                    before, nothing changed on screen. No call-site
                                                    opacity or cursor class: both come from the
                                                    `aria-disabled` rules in globals.css. Dropping either
                                                    half of the pair is a decision, not a cleanup. */}
                                                <Button
                                                    variant="primary"
                                                    onClick={handleVerifyCode}
                                                    disabled={verificationCode.length !== 6}
                                                    aria-disabled={checkingCode ? 'true' : undefined}
                                                    className="whitespace-nowrap"
                                                >
                                                    {checkingCode ? VERIFY_CODE_IN_FLIGHT_LABEL : 'Verify'}
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
                                                <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </span>
                                            <span ref={phoneVerifiedRef} className="text-sm text-content-status-success">Phone verified</span>
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
                                            {/* DECISION Phase 88.6.1-53 (Req 4): while a removal is in flight
                                                Remove carries `aria-disabled` and `handleRemovePhone`'s first
                                                line refuses every tap (`removeInFlightRef`, released in
                                                `finally`). CHOSEN: the rule of POSITION (`DECISION
                                                Phase 88.6-22`) on the control the person just pressed. This
                                                is an ADDED guard: there was no gate at all, so a tap
                                                mid-removal re-armed the control ("Tap again to remove" while
                                                the removal was still running) and the next tap sent a second
                                                removal. The label stays "Remove" — no in-flight label is
                                                ratified (D-31). No gated look: this raw link-style control has
                                                no `.btn` gated arm, and the A10 marker above keeps it raw.
                                                On success focus moves to the banner statement ("SMS disabled
                                                …", D-06's settled-text precedent), else the profile <h1>
                                                (Req 5). REJECTED: (a) native `disabled` — it drops focus in a
                                                real browser; (b) focusing the now-empty Phone number field —
                                                on a phone it raises the keyboard after a destructive action
                                                and says nothing about what happened; (c) minting a heading or
                                                text (D-05, D-31). Dropping either half of the pair is a
                                                decision, not a cleanup. */}
                                            <button
                                                onClick={handleRemovePhone}
                                                aria-disabled={removingPhone ? 'true' : undefined}
                                                className={`-mx-2 inline-flex min-h-11 items-center rounded-btn px-2 text-sm underline ml-3 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
                                                    removeArmed
                                                        ? 'text-content-status-error font-semibold'
                                                        : 'text-content-status-error hover:text-content-status-error'
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

                                        `role="alert"` is on a CONDITIONALLY-MOUNTED node, and
                                        that is correct for an assertive alert: an alert inserted
                                        with its text is announced reliably, and this message must
                                        interrupt. The mount-then-inject rule in StatusRegion's
                                        docblock holds for POLITE regions only.
                                        Do not convert this node to an always-mounted region: it
                                        would add a standing empty assertive region to this block
                                        and announce nothing more than today.
                                        AMENDED Phase 88.6.1-53 (D-42, which supersedes D-23; ST-1
                                        site #10): the decision stands; the two sentences above were
                                        rewritten because their premise did not hold — they called
                                        this conditional assertive mount an anti-pattern, and they
                                        said a StatusRegion would make the node polite, while the
                                        primitive has an assertive variant. */}
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
                            {selfFailedWithNothingCached ? (
                                // WR-03: identity failed terminally (no row) — the status
                                // check never ran; show the degrade notice, not a
                                // stuck "Checking your calendar...".
                                // See `DECISION Phase 88.6.1-61 (AC-29, identity notices)`.
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
                <EmailAddressSection identityWithdrawn={identityWithdrawn} />

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

                {/* Notification Preferences Section — absent while identity has no row, on purpose:
                    see `DECISION Phase 88.6.1-61 (Req 11, identity init)`. */}
                {preferences && !identityWithdrawn && (
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
                    <Heading ref={availabilityHeadingRef} level={2} size="heading" className="text-content-primary mb-4">Availability Settings</Heading>
                    <p className="text-base text-content-secondary mb-4">
                        Set the times when you are <strong>available</strong> (free) to help groups find the best time to schedule game sessions. 
                        {googleCalendarConnected && ' Your Google Calendar busy times will be automatically excluded from your availability.'}
                    </p>

                    {/* Tab strip — the `Tabs` compound (88-07). The strip's widget
                        semantics, its selected-state attribute, the panel wiring and the
                        arrow-key roving tabindex all come from Radix; the hand-rolled
                        strip this replaces emitted none of them. `availabilityTab` stays
                        the source of truth (controlled) so nothing else on the page moves. */}
                    {/* C12 (88.6.1-59): ONE guard for `patternsRetained`, outside both panels — see
                        `DECISION Phase 88.6.1-59 (AC-29 / RF1)` at the schedules list. */}
                    <RetainedContentFocusGuard retained={patternsRetained} focusTarget={availabilityTab === 'recurring' ? schedulesHeadingRef : overridesHeadingRef} />
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
                                    <Heading ref={schedulesHeadingRef} level={3} size="body" className="text-content-primary">Availability Schedules</Heading>
                                    <p className="text-sm text-content-secondary mt-1">Set your recurring availability schedule</p>
                                </div>
                                <Button
                                    ref={addScheduleToggleRef}
                                    variant="primary"
                                    onClick={() => setShowRecurringForm(!showRecurringForm)}
                                    aria-expanded={showRecurringForm}
                                    {...(showRecurringForm ? { 'aria-controls': recurringFormPanelId } : {})}
                                >
                                    {showRecurringForm ? 'Cancel' : '+ Add Schedule'}
                                </Button>
                            </div>

                            {showRecurringForm && (
                                <div id={recurringFormPanelId} className="mb-6 p-4 border border-line rounded-lg bg-surface-page">
                                    <Heading level={4} size="body" className="mb-3 text-content-primary">New Schedule</Heading>
                                    <div className="space-y-3">
                                        <div>
                                            {/* Not a <label>: this names a GROUP of toggle
                                                buttons, not a single form control, and a label
                                                with no control is a label pointing at nothing. */}
                                            {/* DECISION Phase 88.6.1-48 (D-21 / D-44): the seven days carry
                                                `aria-pressed`, read from the SAME expression the colour ternary reads,
                                                so state and colour cannot disagree. They are two-way pressed toggles,
                                                and the theme toggles in this file use the same attribute (DECISION
                                                Phase 88-10). REJECTED: native checkboxes or role="checkbox" — honest
                                                for a multi-select too, but D-21 / D-44 ruled `aria-pressed`, and a
                                                native box changes the look.

                                                `All` / `Clear` is an ACTION (D-21) and carries no pressed state: its
                                                label says what the next press does, and "pressed" on it would describe
                                                a button that cannot stay pressed.

                                                FLOOR: phone-scoped `min-h-11 md:min-h-0`, the house phone floor
                                                (UpcomingEventsCard.js `min-h-11 md:min-h-0`; Input.tsx
                                                `max-md:min-h-11`, which the sibling inputs in this form use). AC-19 is
                                                a 375px criterion and this is a non-look phase, so desktop renders as
                                                before. REJECTED: an all-width `min-h-11`, which grows every desktop row
                                                for no requirement. `min-w-11 md:min-w-0` as well, because `Fri` and
                                                `All` are under 44px wide by class arithmetic. The floor sits in the
                                                STATIC part of each className, so pressed and unpressed both carry it.

                                                KEPT RAW, not migrated to `<Button variant="ghost">`: D-21 says "in
                                                place", and the migration is a look change (`.btn` weight 600 over these
                                                400-weight labels, plus its padding and elevation). This ANSWERS rather
                                                than overrides DECISION Phase 88.6-17 (D-11, outcome (a)): its worry, a
                                                hand-rolled floor watched by nothing, is closed, because this floor is
                                                pinned in controlSizeFloor.test.tsx's NAMED_SUBJECTS (profileDayToggles,
                                                profileDaysAllClear and their Width twins).

                                                Dropping the attribute, the floor or its source pin is a decision, not a
                                                cleanup. */}
                                            <span id="days-of-week-label" className="block text-sm text-content-secondary mb-1">Days of Week</span>
                                            <div role="group" aria-labelledby="days-of-week-label" className="flex flex-wrap gap-2 mt-1">
                                                {[0, 1, 2, 3, 4, 5, 6].map(day => (
                                                    <button
                                                        key={day}
                                                        type="button"
                                                        aria-pressed={recurringForm.daysOfWeek.includes(day)}
                                                        onClick={() => {
                                                            const days = recurringForm.daysOfWeek;
                                                            setRecurringForm({
                                                                ...recurringForm,
                                                                daysOfWeek: days.includes(day)
                                                                    ? days.filter(d => d !== day)
                                                                    : [...days, day].sort((a, b) => a - b)
                                                            });
                                                        }}
                                                        className={`px-3 py-1.5 min-h-11 md:min-h-0 min-w-11 md:min-w-0 rounded-lg text-sm border transition-colors ${
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
                                                    className="px-3 py-1.5 min-h-11 md:min-h-0 min-w-11 md:min-w-0 rounded-btn text-sm border border-line text-content-secondary hover:border-line-accent transition-colors"
                                                >
                                                    {recurringForm.daysOfWeek.length === 7 ? 'Clear' : 'All'}
                                                </button>
                                            </div>
                                        </div>
                                        {/* DECISION Phase 88.6-30 (W53 reopen, row alignment, 2026-09-21): the
                                            two-column availability rows are SUBGRIDS — the container declares three
                                            named row tracks and each cell adopts them with `grid-rows-subgrid
                                            row-span-3`. CHOSEN OVER shortening the labels, which is the obvious fix
                                            and is REJECTED because label text is visible copy (section 6.3 of the
                                            phase's register) and therefore an owner decision, not an executor's.

                                            THE DEFECT, from the owner's iPhone screenshot: "Available From (Start
                                            Time)" wraps to two lines at phone width and "Available Until (End Time)"
                                            does not, so with plain grid cells the right-hand input starts a line
                                            HIGHER than the left one and the left hint text collides with the right
                                            column. Subgrid makes label / control / hint share row tracks across both
                                            columns, so they line up whatever the labels do.

                                            ROW-SPAN IS 3, NOT 2 — measured, not chosen for symmetry: at span 2 the
                                            hint paragraph falls outside the shared tracks and overlaps the control.
                                            The date row below has no hint and so uses only two of the three tracks;
                                            the empty third track collapses to zero height and the span is kept at 3
                                            so the two rows stay structurally identical.

                                            REQUIRES Safari 16+ / Chrome 117+. Below that, `grid-rows-subgrid` is
                                            ignored and the rows render exactly as they do today — the un-fixed
                                            layout, not a broken one. Replacing this with fixed heights or absolute
                                            positioning is a decision, not a cleanup. */}
                                        <div className="grid grid-cols-2 gap-3 grid-rows-[auto_auto_auto]">
                                            <div className="grid grid-rows-subgrid row-span-3">
                                                <label htmlFor="recurring-start-time" className="block text-sm text-content-secondary mb-1">Available From (Start Time)</label>
                                                <Input
                                                    id="recurring-start-time"
                                                    name="recurring-start-time"
                                                    type="time"
                                                    value={recurringForm.startTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, startTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become available</p>
                                            </div>
                                            <div className="grid grid-rows-subgrid row-span-3">
                                                <label htmlFor="recurring-end-time" className="block text-sm text-content-secondary mb-1">Available Until (End Time)</label>
                                                <Input
                                                    id="recurring-end-time"
                                                    name="recurring-end-time"
                                                    type="time"
                                                    value={recurringForm.endTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, endTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become unavailable</p>
                                            </div>
                                        </div>
                                        {/* DECISION Phase 88.6-47 (todo 2026-09-21, "date range inputs
                                            allow end before start"): each bound is DERIVED from the
                                            sibling's current value, never hard-coded, and passes
                                            `undefined` when the sibling is empty — the End Date is
                                            OPTIONAL, so an empty-string bound would be a real bound of
                                            nothing on a field the user is entitled to leave blank.
                                            Native attributes, so the phone pickers this was reported
                                            from grey out the unreachable days; `Input` spreads them
                                            straight onto the element (`src/components/ui/Input.tsx:143`).

                                            THE TIME PAIRS ABOVE ARE DELIBERATELY NOT TOUCHED. Both
                                            already refuse an end before the start with a ratified toast,
                                            added by 88-CODE-REVIEW MED#7 —
                                            `userProfile/page.js:1760` (recurring) and `:1855`
                                            (specific-date). Adding a second mechanism on top of a shipped
                                            guard is how two answers to one question get created. The
                                            owner's report named four surfaces; two were already closed.

                                            NARROWING, NOT A COMPLETE GUARD, and the gap is named rather
                                            than left to be found: `min`/`max` ADMIT EQUALITY, while the
                                            server's rule is STRICT — `routes/availability.js:137` rejects
                                            `startDate >= endDateObj` — so a same-day start and end still
                                            reaches the code-less 400 that renders the generic register
                                            copy and discards the form. Closing that would need either a
                                            client branch with new copy (P1 forbids minting it) or a
                                            server change, and neither is this plan's scope.
                                            REJECTED — an inline error for the typed path, for the same P1
                                            reason recorded at the gameDetail pair; routed to Phase 88.9
                                            with a row in `.planning/deferred/phase-88.6.md`. */}
                                        <div className="grid grid-cols-2 gap-3 grid-rows-[auto_auto_auto]">
                                            <div className="grid grid-rows-subgrid row-span-3">
                                                <label htmlFor="recurring-start-date" className="block text-sm text-content-secondary mb-1">Start Date</label>
                                                <Input
                                                    id="recurring-start-date"
                                                    name="recurring-start-date"
                                                    type="date"
                                                    value={recurringForm.start_date}
                                                    max={recurringForm.end_date || undefined}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, start_date: e.target.value })}
                                                />
                                            </div>
                                            <div className="grid grid-rows-subgrid row-span-3">
                                                <label htmlFor="recurring-end-date" className="block text-sm text-content-secondary mb-1">End Date (Optional)</label>
                                                <Input
                                                    id="recurring-end-date"
                                                    name="recurring-end-date"
                                                    type="date"
                                                    value={recurringForm.end_date}
                                                    min={recurringForm.start_date || undefined}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, end_date: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        {/* DECISION Phase 88.6.1-59 (D-35, availability forms): Save Schedule and
                                            Save Override are PRESSED controls (rule of POSITION, `DECISION Phase
                                            88.6-22`): the in-flight half is `aria-disabled` plus ONE
                                            `savePatternInFlightRef` refusal as the first statement of both
                                            handlers, released in `finally`. One latch because the two forms already
                                            share one `savingPattern`, and Radix unmounts the inactive tab panel, so
                                            they never coexist.
                                            Success: the form closes, and focus moves to the form's own toggle (the
                                            control that opened it, which stays mounted), else the `Availability
                                            Settings` heading (D-05). Armed at success, because only the success path
                                            closes the form.
                                            REJECTED: (a) native `disabled` — it drops focus in a real browser, and
                                            the form's close then loses it again; (b) two latches — they would split
                                            a state the page deliberately keeps as one; (c) focusing the new rows — a
                                            multi-day save creates several, so "the new row" is not one element, and
                                            the success toast already announces the outcome; (d) minting a heading or
                                            any text (D-05, D-31).
                                            Disclosed visible delta: while a save runs the button shows the gated
                                            primary pair instead of the half-strength wash. Dropping either half of
                                            the pair is a decision, not a cleanup. */}
                                        <Button
                                            variant="primary"
                                            onClick={handleCreateRecurringPattern}
                                            aria-disabled={savingPattern ? 'true' : undefined}
                                            className="w-full"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Schedule'}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* DECISION Phase 88.6.1-59 (AC-29 / RF1): a failed refresh keeps the rows.
                                CHOSEN: plan 70's shared `RefreshFailedNotice` above the kept rows (owner ruling
                                2026-10-05, copy row RF1 / D-47; every retained-content site uses it, D-51); the
                                full banner only when nothing is retained; retention keyed on data presence
                                (`data !== undefined`, contract C3), never a count, so a list that loaded empty
                                is retained content with the notice above its empty sentence (D-50, owner
                                ruling Y); an access or gone answer is treated as nothing retained through plan
                                70's `useRetainedContent` (C10: the rows are not rendered and the full banner
                                carries the register line); focus after a successful Retry or Try again lands
                                on the panel's own level-3 heading (D-05); when a withdrawal removes a focused
                                row control, the ONE guard before the tab strip moves focus to the mounted
                                panel's heading (C12), never <body>.
                                Spacing: `mb-3` (the form's own `space-y-3` rhythm) on the notice's wrapper,
                                which plan 70 renders only while the notice shows; healthy, only its empty
                                sr-only region exists, so the panel gains no box.
                                REJECTED: (a) the exclusive ternary keyed on the error alone (after a create or
                                delete whose re-read failed it hid every row the user had); (b) the FULL banner
                                above the kept rows (this plan's earlier lap) — its could-not-load title is
                                false over rows that did load; (c) the compact banner (both of its sentences are
                                about personal controls and false here); (d) a count-keyed test; (e) one notice
                                for both panels above the tab strip (it would sit away from the list it
                                qualifies, and Radix mounts one panel at a time anyway); (f) for C12, a guard
                                inside each panel (two guards for one `retained` value) or a guard with no
                                target (the floor is the page's h1, far above on a phone).
                                This marker names copy rows by id and spells no user-facing sentence. Changing
                                any of these is a decision, not a cleanup. */}
                            {selfFailedWithNothingCached || identityWithdrawn ? (
                                // AC-29 (88.6.1-61): no identity row — see `DECISION Phase 88.6.1-61 (AC-29, identity notices)`.
                                // A-65: an access or gone answer over a kept row too — see `DECISION Phase 88.6.1-79`.
                                <FetchErrorBanner state={selfIdentityErrorState} compact focusTarget={schedulesHeadingRef} />
                            ) : loadingPatterns ? (
                                <p className="text-content-secondary">Loading schedules...</p>
                            ) : patternsFailedWithNothingCached ? (
                                <FetchErrorBanner
                                    state={patternsError}
                                    title="Couldn't load your schedules"
                                    reportSubject="Couldn't load availability patterns on /userProfile"
                                    reportContext="userProfile — availability schedules tab"
                                    focusTarget={schedulesHeadingRef}
                                />
                            ) : (
                                <>
                                <RefreshFailedNotice state={patternsError} retained={patternsRetained} focusTarget={schedulesHeadingRef} className="mb-3" />
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
                                </>
                            )}
                        </div>
                    </TabsContent>

                    {/* Specific Dates Tab */}
                    <TabsContent value="specific">
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <Heading ref={overridesHeadingRef} level={3} size="body" className="text-content-primary">Specific Date Overrides</Heading>
                                    <p className="text-sm text-content-secondary mt-1">Override your schedules for specific dates</p>
                                </div>
                                <Button
                                    ref={addOverrideToggleRef}
                                    variant="primary"
                                    onClick={() => setShowSpecificForm(!showSpecificForm)}
                                    aria-expanded={showSpecificForm}
                                    {...(showSpecificForm ? { 'aria-controls': specificFormPanelId } : {})}
                                >
                                    {showSpecificForm ? 'Cancel' : '+ Add Override'}
                                </Button>
                            </div>

                            {showSpecificForm && (
                                <div id={specificFormPanelId} className="mb-6 p-4 border border-line rounded-lg bg-surface-page">
                                    <Heading level={4} size="body" className="mb-3 text-content-primary">New Specific Override</Heading>
                                    <div className="space-y-3">
                                        <div>
                                            <label htmlFor="specific-date" className="block text-sm text-content-secondary mb-1">Date</label>
                                            <Input
                                                id="specific-date"
                                                name="specific-date"
                                                type="date"
                                                value={specificForm.date}
                                                onChange={(e) => setSpecificForm({ ...specificForm, date: e.target.value })}
                                            />
                                        </div>
                                        {/* Same subgrid row alignment as the Schedules tab — see the
                                            DECISION Phase 88.6-30 marker at the recurring form's time row. */}
                                        <div className="grid grid-cols-2 gap-3 grid-rows-[auto_auto_auto]">
                                            <div className="grid grid-rows-subgrid row-span-3">
                                                <label htmlFor="specific-start-time" className="block text-sm text-content-secondary mb-1">Available From (Start Time)</label>
                                                <Input
                                                    id="specific-start-time"
                                                    name="specific-start-time"
                                                    type="time"
                                                    value={specificForm.startTime}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, startTime: e.target.value })}
                                                />
                                                <p className="text-xs text-content-muted mt-1">When you become available</p>
                                            </div>
                                            <div className="grid grid-rows-subgrid row-span-3">
                                                <label htmlFor="specific-end-time" className="block text-sm text-content-secondary mb-1">Available Until (End Time)</label>
                                                <Input
                                                    id="specific-end-time"
                                                    name="specific-end-time"
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
                                                    id="specific-is-available"
                                                    name="specific-is-available"
                                                    type="checkbox"
                                                    checked={specificForm.isAvailable}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, isAvailable: e.target.checked })}
                                                    className="rounded-sm"
                                                />
                                                <span className="text-sm text-content-secondary">Mark as available (uncheck to mark as busy)</span>
                                            </label>
                                        </div>
                                        {/* D-35 (88.6.1-59): see `DECISION Phase 88.6.1-59 (D-35, availability forms)` at Save Schedule. */}
                                        <Button
                                            variant="primary"
                                            onClick={handleCreateSpecificOverride}
                                            aria-disabled={savingPattern ? 'true' : undefined}
                                            className="w-full"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Override'}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* AC-29 / RF1 (88.6.1-59): see `DECISION Phase 88.6.1-59 (AC-29 / RF1)` at the schedules list. */}
                            {selfFailedWithNothingCached || identityWithdrawn ? (
                                // AC-29 (88.6.1-61): no identity row — see `DECISION Phase 88.6.1-61 (AC-29, identity notices)`.
                                // A-65: an access or gone answer over a kept row too — see `DECISION Phase 88.6.1-79`.
                                <FetchErrorBanner state={selfIdentityErrorState} compact focusTarget={overridesHeadingRef} />
                            ) : loadingPatterns ? (
                                <p className="text-content-secondary">Loading overrides...</p>
                            ) : patternsFailedWithNothingCached ? (
                                <FetchErrorBanner
                                    state={patternsError}
                                    title="Couldn't load your overrides"
                                    reportSubject="Couldn't load availability patterns on /userProfile"
                                    reportContext="userProfile — specific overrides tab"
                                    focusTarget={overridesHeadingRef}
                                />
                            ) : (
                                <>
                                <RefreshFailedNotice state={patternsError} retained={patternsRetained} focusTarget={overridesHeadingRef} className="mb-3" />
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
                                </>
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
                    {/* DECISION Phase 88.6.1-18 (Replay, W016 / D-35): while the reset runs, Replay is
                        `aria-disabled` and `handleReplayTutorial` refuses a second press through
                        `replayInFlightRef` — the rule of POSITION (`DECISION Phase 88.6-22`,
                        FriendInvitePanel.js:59): this is the control the user just pressed
                        (Requirement 4, SPEC amendment row 11).
                        WHY: a natively disabled button drops focus to <body> in a real browser the
                        moment it is pressed, and the native attribute was the only thing refusing a
                        second reset (the handler had no in-flight guard). A focused Replay is also
                        what the v2.1 tutorial rewrite's "focus back to Replay" item will need (D-49
                        carry-over); the tutorial itself is NOT changed here — no role, Escape or
                        focus handling (D-49).
                        REFUSED WHILE THE TOUR IS OPEN: Replay stays focused under the tour's scrim
                        until the v2.1 rewrite moves focus into the tour (D-49), so it is also
                        `aria-disabled` and refused while `showTutorial` is true; otherwise Enter
                        behind the scrim re-sends the reset while the tour shows. This reads the
                        provider's existing value; the overlay and provider are not edited.
                        REJECTED: (a) native `disabled` — the cause; (b) leaving Replay native until
                        the v2.1 rewrite — it is a Requirement 4 control in its own right, and D-49
                        struck the tutorial's dialog work, not this row.
                        Disclosed visible delta: while resetting, Replay shows the DR-C gated primary
                        colour pair instead of the 50% native-disabled wash, and keeps that pair
                        while the tour is open (under the tour's scrim) — the same disclosure
                        FriendInvitePanel.js:87-90 makes. The in-flight label is existing text, not
                        new copy (D-31 not triggered). Restoring the native attribute or dropping
                        the latch is a decision, not a cleanup. */}
                    <Button
                        variant="primary"
                        onClick={handleReplayTutorial}
                        aria-disabled={replayingTutorial || showTutorial ? 'true' : undefined}
                    >
                        {replayingTutorial ? 'Starting...' : 'Replay Tutorial'}
                    </Button>
                </div>

                {/* Owned Games Section */}
                <div className="card p-3 md:p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                        {/* 88-33 Task 7 step 2 (UAT row 272): the count renders only after the
                            owned-games fetch resolves — "(0)" mid-fetch is an empty-vs-loading
                            conflation on the count itself; an em-dash holds the slot meanwhile.
                            Extended by 88.6.1-67: the em-dash holds the slot until the collection has
                            loaded for this identity (mid-fetch, after a failed first load, or with no
                            identity row), and a refresh keeps the previous count, like the rows. */}
                        <Heading ref={collectionHeadingRef} level={2} size="heading" className="text-content-primary">
                            My Game Collection ({collectionRetained ? ownedGames.length : '—'})
                        </Heading>
                        <div className="flex gap-2">
                            <Button
                                ref={addFromBggToggleRef}
                                variant="primary"
                                onClick={() => {
                                    // 88.6.1 code review A-76: Hide Search empties the result count too.
                                    if (showBggSearch) setBggFoundAnnouncement('');
                                    setShowBggSearch(!showBggSearch);
                                }}
                                aria-expanded={showBggSearch}
                                {...(showBggSearch ? { 'aria-controls': bggSearchPanelId } : {})}
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
                                ref={bggUsernameFieldRef}
                                id="bgg-username"
                                name="bgg-username"
                                aria-label="BoardGameGeek username"
                                value={bggUsername}
                                onChange={(e) => setBggUsername(e.target.value)}
                                placeholder="Your BGG username"
                                className="flex-1"
                                disabled={importingCollection}
                            />
                            {/* DECISION Phase 88.6.1-60 (D-35, BGG import): rule of POSITION on the import
                                dialog's opener. Import Collection carries aria-disabled while an import runs,
                                plus ONE `importInFlightRef` refusal as the FIRST statement of BOTH handlers:
                                `handleImportCollectionClick` (a press mid-import must not reopen the dialog
                                over a running import) and `importBGGCollection` (a second Continue before the
                                dialog's exit animation ends must not start a second import). The latch is set
                                before the `try` and released in `finally`. The blank-username half stays a
                                NATIVE disable (rule of KIND, DECISION Phase 88.6-22 in FriendInvitePanel.js).
                                Why it matters for focus: Continue closes the dialog and starts the import in
                                one commit, so the dialog's close restore meets its opener mid-import. A
                                natively disabled opener refuses focus and the user lands at the top of the
                                page; a focusable one takes the restore.
                                REJECTED: (a) a native disable while importing (the restore cannot land);
                                (b) a refusal in `importBGGCollection` only (a press mid-import would reopen
                                the dialog); (c) moving the gate onto ConfirmDialog (reopens D-10, the 88-10
                                marker above `handleImportCollectionClick`); (d) a per-consumer close-focus
                                handler on the dialog (DECISION Phase 88.6-44 in Modal.tsx).
                                The username FIELD stays natively disabled while importing: a sibling (D-35),
                                not the pressed control. Disclosed visible delta: while importing, the button
                                shows the gated primary pair instead of the 50% wash. Dropping either half of
                                the pair is a decision, not a cleanup. */}
                            <Button
                                ref={importButtonRef}
                                variant="primary"
                                onClick={handleImportCollectionClick}
                                disabled={!bggUsername.trim()}
                                aria-disabled={importingCollection ? 'true' : undefined}
                                className="whitespace-nowrap"
                            >
                                {importingCollection ? 'Importing...' : 'Import Collection'}
                            </Button>
                        </div>
                        {/* DECISION Phase 88.6.1-60 (Req 8 / D-22, BGG import outcome): the outcome box IS a
                            polite StatusRegion, always mounted, srOnlyWhenEmpty: empty and hidden before the
                            first import, the visible box once a message is set, the same node throughout, so
                            a slow import's start, result and failure are each a text change a screen reader
                            announces. Its classes are the old box's byte-for-byte (each status read now
                            optional, since the region renders before any import) plus text-base, which holds
                            the message at today's inherited 16px against the primitive's smaller default.
                            Its writes WAIT while the closing import dialog still hides the page (review 220):
                            the dialog's modal hiding lifts only when its content unmounts, after a 200 ms exit,
                            and a text change inside a hidden subtree is silent and never repeated, so
                            `writeImportProgress` holds them and applies them in order, one commit each, when
                            the region's aria-hidden ancestry lifts (a MutationObserver on that attribute; the
                            latch and the in-flight state are never held). The result timer's emptying is not
                            held: an emptying is not an announcement.
                            REJECTED: (a) the conditional mount (announces nothing, the page's own rule at the
                            three gates below); (b) an sr-only twin beside the visible box (the text twice in
                            the DOM; DECISION Phase 88.6-36 in FetchErrorBanner.tsx rejects two regions of
                            opposite visibility); (c) assertive (neither progress nor result is urgent; D-42);
                            (d) writing at Continue (the silent window); (e) a per-consumer close-focus handler
                            on the dialog as the release moment (DECISION Phase 88.6-44 in Modal.tsx); (f)
                            polling frames until no dialog remains (a proxy for the property that matters, and
                            the hiding is undone in an effect cleanup that can trail the dialog's removal).
                            The id is the test handle and is never read aloud. */}
                        <StatusRegion
                            ref={importStatusRegionRef}
                            id="bgg-import-status"
                            srOnlyWhenEmpty
                            className={`mt-3 p-3 rounded-btn text-base ${
                                importProgress?.status === 'error' ? 'bg-status-error-subtle text-content-status-error' :
                                importProgress?.status === 'complete' ? 'bg-status-success-subtle text-content-status-success' :
                                'bg-surface-muted text-content-secondary'
                            }`}
                        >
                            {importProgress && (
                                <>
                                    <p className="text-content-primary">{importProgress.message}</p>
                                    {importProgress.details && (
                                        <p className="text-sm mt-1">
                                            Imported: {importProgress.details.imported} | 
                                            Skipped (already owned): {importProgress.details.skipped} | 
                                            Total: {importProgress.details.total}
                                        </p>
                                    )}
                                </>
                            )}
                        </StatusRegion>
                    </div>

                    {/* Review 221 (88.6.1-60): the search result count, screen-reader only. Outside the search
                        panel's conditional so it is mounted before any search answers. See
                        `DECISION Phase 88.6.1-60 (review 221, owner 2026-10-13)` in `searchBGG`. */}
                    <StatusRegion className="sr-only" message={bggFoundAnnouncement} />

                    {/* BGG Search */}
                    {showBggSearch && (
                        <div id={bggSearchPanelId} className="mb-6 p-3 md:p-4 border border-line rounded-sm bg-surface-page">
                            <div className="flex flex-col sm:flex-row gap-2 mb-3">
                                <Input
                                    id="bgg-search"
                                    name="bgg-search"
                                    aria-label="Search BoardGameGeek"
                                    value={bggSearchQuery}
                                    onChange={(e) => setBggSearchQuery(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && searchBGG()}
                                    placeholder="Search BoardGameGeek..."
                                    className="flex-1"
                                />
                                {/* DECISION Phase 88.6.1-60 (D-35, BGG search): rule of POSITION. Search carries
                                    aria-disabled while a search runs, plus ONE `searchInFlightRef` refusal as
                                    `searchBGG`'s first statement, which BOTH this button and the field's Enter
                                    call, so one guard covers both entry points; set before the `try`, released
                                    in `finally`. The blank-query half stays native (rule of KIND). Closed with
                                    it: the field's Enter was never gated, so an Enter mid-search started a
                                    second request and whichever answered last wrote the results.
                                    REJECTED: (a) a native disable while searching (drops focus in a real
                                    browser); (b) disabling the field while searching (typing is legitimate;
                                    only a second request is not); (c) a latest-request-wins counter (a second
                                    mechanism on a control the house rule already latches, and the button
                                    already says Searching...). Disclosed visible delta: while searching, the
                                    gated primary pair instead of the 50% wash. Dropping either half of the
                                    pair is a decision, not a cleanup. */}
                                <Button
                                    variant="primary"
                                    onClick={searchBGG}
                                    disabled={!bggSearchQuery.trim()}
                                    aria-disabled={bggSearching ? 'true' : undefined}
                                    className="whitespace-nowrap"
                                >
                                    {bggSearching ? 'Searching...' : 'Search'}
                                </Button>
                            </div>
                            
                            {bggSearchResults.length > 0 && (
                                <div className="max-h-60 overflow-y-auto space-y-2">
                                    {bggSearchResults.map((result) => {
                                        const isAlreadyOwned = ownedGames.some(g => g.bgg_id === result.bgg_id);
                                        const isAddingThis = addingBggId === result.bgg_id;
                                        return (
                                            <div key={result.bgg_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-surface-card border border-line rounded-btn">
                                                <span className="text-base text-content-primary wrap-break-word flex-1 min-w-0">
                                                    {result.name} {result.year_published ? `(${result.year_published})` : ''}
                                                </span>
                                                {/* DECISION Phase 88.6.1-67 (D-35, Add to Collection):
                                                    CHOSEN: rule of POSITION (`DECISION Phase 88.6-22`; the
                                                    in-house list shape in BallotSection.js) — the pressed Add
                                                    carries aria-disabled plus ONE `addGameInFlightRef` refusal
                                                    as `addGameToCollection`'s first statement; sibling Adds are
                                                    natively disabled until the add is confirmed (nobody is
                                                    standing on them); the latch is released at that
                                                    confirmation, not after the refresh (finding #75);
                                                    `isAlreadyOwned` stays native (rule of KIND — a validity gate
                                                    on a control nobody pressed).
                                                    WHY: there was no in-flight guard at all; a double tap sent
                                                    two imports and two adds and toasted twice.
                                                    LABEL: `Adding...` while in flight (copy row P7,
                                                    owner-ratified 2026-10-05); the name follows the visible
                                                    label. Swept: no unit test or e2e spec looked this button up
                                                    by name before this plan.
                                                    REJECTED: (a) native `disabled` on the pressed button (it
                                                    drops focus in a real browser); (b) a per-game latch letting
                                                    two different adds race (the panel closes on the first
                                                    success, so a second press lands on a list about to vanish).
                                                    DISCLOSED visible delta: the pressed Add shows the gated
                                                    primary pair, its siblings the 50% wash, for the length of an
                                                    add. Dropping either half of the pair, or restoring
                                                    refresh-then-close, is a decision, not a cleanup. */}
                                                <Button
                                                    variant="primary"
                                                    type="button"
                                                    onClick={(event) => addGameToCollection(result.bgg_id, event)}
                                                    disabled={isAlreadyOwned || (addingBggId !== null && !isAddingThis)}
                                                    aria-disabled={isAddingThis ? 'true' : undefined}
                                                    className="whitespace-nowrap shrink-0"
                                                >
                                                    {isAlreadyOwned ? 'Already Owned' : isAddingThis ? ADDING_TO_COLLECTION_LABEL : 'Add to Collection'}
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 88.6.1-70 contract C12 (a): outside every arm of the zone below, so it stays mounted
                        when an access answer swaps the retained arm for the P8 banner. Renders nothing. */}
                    <RetainedContentFocusGuard retained={collectionRetained} focusTarget={collectionHeadingRef} />
                    {/* Owned Games List */}
                    {/* DECISION Phase 88.6.1-61 (AC-29, identity notices): the compact identity notice
                        replaces a zone only when identity failed with NO row
                        (`selfFailedWithNothingCached`, keyed on `self === undefined`, the plan-59
                        shape). With a kept row the calendar zone and this collection render their
                        normal content and no notice shows: its sentence would be false, since every
                        control works from the kept row. Plan 88.6.1-67 reads the same boolean.
                        AMENDED Phase 88.6.1-63 (AC-29): the boolean now reads the shared `selfIdentityFailedWithNoRow` (the one rule every identity host uses); `selfIdentityErrorState` stays raw because the header's RF1 notice reads it (plan 88.6.1-79).
                        CHOSEN (review 65): with no row the same notice also takes the place of each
                        availability panel's list (the patterns query never runs, so the list's empty
                        sentence would state as fact that the user has no schedules or overrides), and
                        the two availability create guards toast the page's existing still-loading
                        sentence instead of returning without a word.
                        CHOSEN (review 222): after a successful no-row Retry, focus lands on this
                        card's heading (`collectionHeadingRef`) and on each availability panel's own
                        heading (plan 59's refs); the calendar notice passes no `focusTarget`, because
                        its nearest heading is the page's `main h1` in the same card, which plan 21's
                        floor already reaches.
                        REJECTED: (a) the old error-only condition (it hid a working calendar control
                        and collection list behind a false notice); (b) the compact notice beside the
                        content (its sentence is false there; plan 30's ruling on the compact text);
                        (c) removing the ternaries (their announcement gap is Phase 92's,
                        `.planning/deferred/phase-92.md:84`, which says keep them); (d) leaving the
                        availability lists' empty sentences in the no-row state (a false statement of
                        fact); (e) no `focusTarget` on the collection and availability notices (focus
                        would jump to the top of the page, far from the card on a phone).
                        Kept-row state, routed (not mounted here): plan 88.6.1-79 Task 3 mounts plan
                        88.6.1-70's RF1 notice as the header card's first child for a kept row whose
                        refresh failed, reading `selfIdentityErrorState` RAW, so that state is never
                        wrapped in a no-row source; this boolean is the no-row half. An access-or-gone
                        answer over a kept row is ALSO plan 79 Task 3's (its `identityWithdrawn`, which
                        withdraws the row's name and address and decides which zones show a notice for
                        it), so `selfFailedWithNothingCached` is not the whole story of when a zone's
                        notice shows. Plan 79 amends this bullet in place when it lands.
                        AMENDED Phase 88.6.1-79: mounted — the header card's first child; an access or
                        gone answer over a kept row also shows the collection zone's compact notice
                        (`selfFailedWithNothingCached || identityWithdrawn`); see `DECISION Phase
                        88.6.1-79 (AC-29 / D-51, identity kept row)`.
                        Changing any of these is a decision, not a cleanup. */}
                    {selfFailedWithNothingCached || identityWithdrawn ? (
                        // WR-03: identity failed terminally (no row) — the owned-games
                        // fetch never ran; surface the degrade notice instead of
                        // a permanent "Loading your collection...".
                        <FetchErrorBanner state={selfIdentityErrorState} compact focusTarget={collectionHeadingRef} />
                    ) : !collectionRetained ? (
                        /* DECISION Phase 88.6.1-67 (Req 9 / P8 / RF1, collection situations):
                           CHOSEN: the 88.6.1-70 situation table — nothing loaded and failed -> the
                           full banner titled with copy row P8 (owner-ratified 2026-10-05) and
                           `focusTarget` on the `My Game Collection` heading; nothing loaded -> the
                           loader; loaded -> the content with plan 70's `RefreshFailedNotice` above
                           it (RF1 after a failed refresh) — a load that returned zero rows included,
                           so its empty sentence stays under the notice (owner ruling Y,
                           2026-10-05); an access or gone answer -> the full banner in the content's
                           place, never RF1 (C10, through `useRetainedContent`). The banner's arm
                           sits before the loader and the empty sentence, and the error is kept
                           through a retry, so the banner stays during it and a failed FIRST load
                           never reaches the empty sentence; the count shows the em-dash.
                           REJECTED: (a) the compact notice (its fixed sentence is about personal
                           controls, not the collection); (b) a `reportContext` / `reportSubject`
                           literal (unratified words, D-31 — the D-32 R5 precedent ratified each
                           one) — AMENDED Phase 88.6.1-91 (close ruling P-82, owner 2026-10-18): the reportContext words are now ratified
                           and set; reportSubject stays unset (not ratified); (c) the full banner above retained rows (the owner's 2026-10-05
                           ruling gives a failed refresh the small RF1 notice).
                           The notice is plan 70's (88.6.1-70 contract C6), mounted here as the
                           retained arm's first child, outside the busy grid (it holds a live region).
                           A row control that held focus when an access answer withdrew the rows hands
                           it to the heading through plan 70's RetainedContentFocusGuard (C12) — a
                           Remove's own row has already left at the server's confirmation, so the
                           guard acts on an unpressed withdrawal, not on a Remove.
                           Changing this order is a decision, not a cleanup. */
                        ownedGamesError ? (
                            <FetchErrorBanner state={collectionErrorState} title={COLLECTION_LOAD_FAILED_TITLE} reportContext="userProfile — game collection fetch" focusTarget={collectionHeadingRef} />
                        ) : (
                            <p className="text-content-secondary">Loading your collection...</p>
                        )
                    ) : (
                        <>
                        <RefreshFailedNotice state={collectionErrorState} retained={collectionRetained} focusTarget={collectionHeadingRef} className="mb-4" />
                        {ownedGames.length > 0 ? (
                        <div aria-busy={loadingGames || undefined} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                        </>
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