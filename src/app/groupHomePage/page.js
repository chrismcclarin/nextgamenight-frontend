'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import CreateEvent from '../components/createEvent';
import ManageMembers from '../components/ManageMembers';
import { listsAPI, groupsAPI, eventsAPI, API_BASE_URL } from '../../lib/api';
import GroupGamesList from '../components/GroupGamesList';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import {
    getTextStyle,
    getSubtitleStyle,
    groupInkVars,
    resolveGroupGround,
    storedGroupColour,
    isDarkBackground,
    themedTextStyleVars,
} from '../../lib/colorUtils';
import { cn } from '../../lib/cn';
import SafeImage from '../components/SafeImage';
import EventCalendar from '../components/EventCalendar';
import PendingMemberBanner from '../components/PendingMemberBanner';
import GroupLibrary from '../components/GroupLibrary';
import KebabMenu from '../components/KebabMenu';
import GroupSettings from '../components/GroupSettings';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { logger, errCtx } from '../../lib/logger';

// A groups home page
function GroupHomePage(){
    const { user } = Auth();
    const router = useRouter();
    // Phase 87.3-05 (PR-B): resolve the caller's own Users.id UUID via the
    // shared identity primitive. The membership/removal gate keys on the nested
    // member.id (UUID) vs selfUuid. CRITICAL: selfUuid resolves ASYNC, so the
    // removal redirect must NOT run until identity resolves — an unresolved
    // selfUuid makes the find miss and would bounce an active member off their
    // own group. Identity-unresolved is a LOADING state, never "removed".
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const [Group, setGroup] = useState(null);
    const [UserList, setUserList] = useState(null);
    const [gamesList, setGamesList] = useState([]);
    const [gamesError, setGamesError] = useState(null);
    const [eventModal, setEventModal] = useState(false);
    const [memberModal, setMemberModal] = useState(false);
    const [showGroupSettings, setShowGroupSettings] = useState(false);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null);
    const [activeTab, setActiveTab] = useState('home');
    // Phase 69-04 paint gate: blocks page render until the membership check
    // resolves. Without this, getGroup()/games/events fetches race the
    // membership lookup and the page paints with partial data before the
    // redirect fires for removed users.
    const [membershipChecked, setMembershipChecked] = useState(false);

    // Calendar state
    const [groupEvents, setGroupEvents] = useState([]);
    const [calendarPrefillDate, setCalendarPrefillDate] = useState(null);
    // CAL-05: track the visual entry mode for the create-event modal.
    // 'day' is set when the user taps an empty day cell or the modal's
    // "+ New event on this day" button — the EventScheduler then opens
    // in its DAY view focused on the tapped date. (Until plan 88.1-16 that day view was
    // react-big-calendar's; the rebuilt scheduler's week and day arms are the same code
    // path parameterized by `days` (7 vs 1) — SPEC Req 2 — so 'day view' is now a prop
    // value on one component, not a second library view.)
    // The "Add New Game Event" header button leaves this at 'week'.
    const [calendarEntryMode, setCalendarEntryMode] = useState('week');
    // Defensive cache-bust key — bumped after a fresh fetch so EventCalendar
    // re-renders even if React batches/dedupes the state update by accident.
    // Mirrors the pattern already used in UserHomePage.
    const [eventsRefreshKey, setEventsRefreshKey] = useState(0);

    const searchParams = useSearchParams();
    const Router = searchParams.get('id');
    const prefillDate = searchParams.get('date');
    const prefillTime = searchParams.get('time');
    const shouldCreateEvent = searchParams.get('create_event') === 'true';

    // GROUP-05 (Plan 69-04): detect "user is no longer a member" signals and
    // redirect to the home banner consumer at `/?removedFrom=<name>`.
    //
    // apiFetch (src/lib/api.js) throws Error(message) only — there's no
    // exposed `.status`, so we match on common 403/404/membership phrases.
    // Defensive: also accepts a `.status` field if a future helper exposes it.
    const isRemovedFromGroupError = (error) => {
        const status = error?.status || error?.response?.status;
        if (status === 403 || status === 404) return true;
        // CONTROL FLOW, not a user-facing read, and rostered as such in
        // `fetchErrorTreatment.test.ts`'s `CONTROL_FLOW_ALLOWED` (`:314-318`), whose `why` reads:
        // "isRemovedFromGroupError — routes a removal 403 to a redirect. Never displayed."
        // This line is DELIBERATELY byte-unchanged. A later R1 sweep that "completes" the work by
        // routing it through `getFetchErrorMessage` would turn a deliberate control-flow read into
        // a false offender and break the removed-member redirect. Comment sits ABOVE the line
        // because both that allow-list check and the suite's anti-vacuity companion match with
        // `includes` on the stripped line.
        const msg = (error?.message || '').toLowerCase();
        return (
            msg.includes('not a member') ||
            msg.includes('forbidden') ||
            msg.includes('access denied') ||
            msg.includes('403') ||
            msg.includes('404') ||
            msg.includes('group not found')
        );
    };

    const redirectToHomeAsRemoved = (groupName) => {
        const name = groupName || Group?.name || 'this group';
        router.push(`/?removedFrom=${encodeURIComponent(name)}`);
    };

    const getGroup = async () => {
        if (!Router) return;
        try {
            // Use groupsAPI.getGroup which automatically includes Authorization header
            const data = await groupsAPI.getGroup(Router);
            setGroup(data);
        } catch (error) {
            if (isRemovedFromGroupError(error)) {
                redirectToHomeAsRemoved();
                return;
            }
            logger.info('Error fetching group:', errCtx(error));
        }
    };

    const getGroupMembers = async () => {
        // Gate the membership derive on identity resolution. Until selfUuid is
        // resolved the find below would miss and the redirect-as-removed branch
        // would fire on an active member — so we wait. membershipChecked stays
        // false (page shows "Loading group…"); when selfUuid resolves the effect
        // re-runs (selfUuid is in its deps) and the derive recomputes.
        if (!Router || !user?.sub || !selfUuid) return;
        try {
            // Use groupsAPI.getGroupMembers which automatically includes Authorization header
            const data = await groupsAPI.getGroupMembers(Router);

            // Ensure data is an array before processing
            if (!Array.isArray(data)) {
                /* DECISION Phase 88.6-21 (AC-2 / T-84-01): this call is RESHAPED, not merely
                   re-channelled. It used to log the rejected member-list payload itself — the
                   response body T-84-01 excludes by name, carrying member PII — and the house
                   logger egresses its ctx to Sentry, so re-channelling it unchanged would have
                   sent that payload out of the browser. A SHAPE DESCRIPTOR goes instead; the
                   payload never does. `logger.warn` is NOT the matching level: it is
                   `Sentry.captureMessage` (`logger.ts:31-32`), an EVENT, and AC-2's amended level
                   (owner 2026-09-13) is `info` — a breadcrumb. Restoring `data` here is one
                   keystroke and is exactly what T-84-01 forbids. */
                logger.info('Group members data is not an array:', {
                    received: data === null ? 'null' : typeof data,
                });
                setUserList([]);
                return;
            }

            // GROUP-05: backend's `/groups/:id/users` returns 200 even for
            // non-members (just omits them from the list), so in-list
            // absence is the real removal signal. Redirect BEFORE any
            // setState that would paint the group view, so removed users
            // never see a flash of group content.
            const currentUserMember = data.find(m => m.id === selfUuid);
            if (!currentUserMember || !currentUserMember.UserGroup) {
                redirectToHomeAsRemoved();
                return;
            }

            // Confirmed member — safe to commit member list + role + open
            // the paint gate so the rest of the page renders.
            setUserList(data);
            setUserRole(currentUserMember.UserGroup.role);
            setMembershipChecked(true);
        } catch (error) {
            if (isRemovedFromGroupError(error)) {
                redirectToHomeAsRemoved();
                return;
            }
            logger.info('Error fetching group members:', errCtx(error));
            setUserList([]);
        }
    };

    const fetchGroupEvents = async () => {
        if (!Router || !user?.sub) return;
        try {
            const data = await eventsAPI.getGroupEvents(Router, { includeRsvpSummary: true });
            setGroupEvents(data || []);
        } catch (error) {
            logger.info('Error fetching group events:', errCtx(error));
            setGroupEvents([]);
        }
    };

    const getGamesForGroup = useCallback(async () => {
        // 87.4 Plan 10 (SPEC Req 5 + T-874-10-RACE): gate the games fetch on
        // selfUuid resolution the same way getGroupMembers is (L109-115). selfUuid
        // resolves ASYNC (after an Auth0-session-load round-trip), so a callback
        // keyed only on user?.sub would close over an unresolved selfUuid on a hard
        // load, send it as undefined, get a 403 from the self-gated lists endpoint,
        // and have the catch below misread that 403 as a removal signal -- bouncing
        // an active member. Gating here (and re-keying selfUuid into the deps) makes
        // the fetch impossible to fire before identity resolves.
        if (!Router || !user?.sub || !selfUuid) return;
        try {
            setLoading(true);
            setGamesError(null);
            const games = await listsAPI.getGroupGames(Router, selfUuid);
            setGamesList(games || []);
        } catch (error) {
            // /api/lists/games/:groupId/:userId 403s non-members — treat
            // it as a removal signal and redirect, same as the member-list
            // absence path in getGroupMembers.
            if (isRemovedFromGroupError(error)) {
                redirectToHomeAsRemoved();
                return;
            }
            logger.info('Error fetching games:', errCtx(error));
            /* DECISION Phase 88-25 (Req 14 / DEF-88-18-01, T-88-18-01): a failed games request is
               TRACKED as a failure here and handed to GroupGamesList as an `errorState` prop —
               chosen OVER the `setGamesList([])` this shipped with. GroupGamesList takes `games`
               as a prop and does not fetch, so flattening the failure into an empty array arrived
               at the component as a legitimately-empty list: a group with years of history was
               told "No game nights logged yet" when its request had merely failed. Empty and
               failed are different facts (UI-SPEC 9.2).

               The removal-403 redirect above stays FIRST and is untouched — that path is a real
               403 with a real meaning and must never reach the error banner.

               Keep the ERROR object, not a flattened string: useFetchErrorState reads
               `ApiError.code` off it to pick the right user-facing copy. Do NOT re-add
               `setGamesList([])` here — the stale list is deliberately left alone so a refetch
               failure does not blank a list the person is still looking at. */
            setGamesError(
                error instanceof Error ? error : new Error("The group games request didn't complete.")
            );
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Router, user?.sub, selfUuid]);

    // getGamesForGroup is already a useCallback with a stable identity, so it can be handed to
    // the hook directly — no ref hop needed here (unlike groupPlanning's per-render fetches).
    const gamesErrorState = useFetchErrorState({
        isError: Boolean(gamesError),
        error: gamesError,
        refetch: getGamesForGroup,
    });

    // PR2-L11 (SPEC Req 7): getGroup + fetchGroupEvents do NOT depend on selfUuid,
    // so they live in an effect keyed only on [Router, user?.sub, ...] — they fire
    // once per hard load and are NOT re-fetched when selfUuid resolves later. Prior
    // to the split they shared the selfUuid-gated effect below and double-fetched on
    // every hard load (the async identity resolution re-ran the combined effect).
    useEffect(() => {
        if (Router && user?.sub) {
            getGroup();
            fetchGroupEvents();
        }
        // Auto-open event modal if coming from planning page
        if (shouldCreateEvent && prefillDate && prefillTime) {
            setEventModal(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Router, user?.sub, shouldCreateEvent, prefillDate, prefillTime]);

    // getGroupMembers self-gates on selfUuid (see its guard); selfUuid is in the
    // deps so the membership derive re-runs once identity resolves. This is the
    // legitimate identity-keyed re-run — kept separate so getGroup/fetchGroupEvents
    // above are not dragged along with it.
    useEffect(() => {
        if (Router && user?.sub) {
            getGroupMembers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Router, user?.sub, selfUuid]);

    // Defer the games fetch until the membership check has confirmed the
    // user belongs to the group. The games endpoint 403s non-members
    // (correctly), but firing it before redirect produces noisy console
    // errors. The redirect-on-403 fallback in getGamesForGroup is still
    // there as a safety net — this gate just prevents the noise on the
    // happy path of "removed user opens a stale URL".
    useEffect(() => {
        // 87.4 Plan 10: also gate the calling effect on selfUuid so it fires only
        // once identity resolves (getGamesForGroup's own guard early-returns until
        // then, and its identity changes when selfUuid lands via the deps above).
        if (Router && user?.sub && selfUuid && membershipChecked) {
            getGamesForGroup();
        }
    }, [Router, user?.sub, selfUuid, membershipChecked, getGamesForGroup]);

    const handleEventCreated = async (newEvent) => {
        // Refresh games list and calendar events after creating new event
        getGamesForGroup();
        await fetchGroupEvents();
        // Bump the defensive refresh key AFTER the fetch resolves so the
        // calendar grid + Upcoming Events card both re-render with the new
        // data, even if groupEvents reference equality is preserved.
        setEventsRefreshKey(prev => prev + 1);
    };

    const toggleEventModal = () => {
        if (eventModal) {
            setCalendarPrefillDate(null); // Clear when closing
            setCalendarEntryMode('week'); // CAL-05: reset to default for next open
        }
        setEventModal(!eventModal);
    };


    // Phase 69-04 paint gate: don't render the group page until the
    // membership check has confirmed the current user belongs here. This
    // covers two cases — (a) `getGroup` resolves before `getGroupMembers`
    // and `setGroup(data)` would otherwise flash group content for a
    // removed user, (b) the games endpoint 403s in the brief window
    // between mount and redirect.
    if (!membershipChecked) {
        return (
            <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-screen">
                <p className="text-content-secondary">Loading group…</p>
                {/* D-08: if identity resolution permanently fails, the membership
                    check can never complete — surface a compact, non-blocking
                    degrade notice instead of an indefinite silent spinner (D-11). */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-screen">
                <p className="text-content-secondary">Loading games...</p>
            </div>
        );
    }

    // null when the group has no colour of its own — the identity header then
    // keeps its themed surface class instead of an inline override (D-28).
    /*
     * AMENDED Phase 88.3.1 (plan 09, AMENDMENT J): the ACCESSOR is
     * `storedGroupColour(Group)`, never `Group?.background_color`. Plan
     * 88.3.1-05 migrates every coloured group to `color_preset='<id>',
     * background_color=NULL`, so reading the legacy column alone would render
     * every migrated group's header UNCOLOURED — a failure with a fully green
     * suite, because nothing in this tree reads a computed style.
     * REJECTED: a per-site `color_preset ?? background_color` ternary — six
     * copies of one rule (project tenet). A decision, not a cleanup.
     */
    const headerGroundPair = resolveGroupGround(storedGroupColour(Group));

    /*
     * DECISION Phase 88.3 (D-08/D-09): the identity header renders a LIGHT TINT
     * of the group's stored colour in light mode and the stored hex itself in
     * dark, and the UNCOLOURED header stays on `bg-surface-elevated` (white in
     * light) — chosen because the owner's principle for this phase is no dark
     * bands in light mode, for coloured groups AND uncoloured ones alike.
     *
     * REJECTED, both measured in the phase discussion: (H2) a warm-700 band —
     * a dark plinth behind the title, which is the very thing light mode is
     * supposed to stop; and (H3) a nav-blue band — the same objection plus a
     * second identity colour competing with the group's own. Neither survives
     * the "the group's colour IS the identity cue" contract that 87.8 D-03
     * records a few lines below.
     *
     * AND: Phase 88-22's "the header falls back to the THEMED ELEVATED SURFACE"
     * decision at the comment below STANDS. It is NOT reversed by this phase —
     * the tint applies to a group that HAS a colour; the no-colour path is
     * untouched. Re-pinning a hardcoded dark value here would re-open the exact
     * D-28 bug 88-22 closed.
     *
     * `ground` is the raw stored hex GATED ON THE TINT SUCCEEDING (T-88.3-43,
     * the same shape as plan 10's five render sites): there is no second parse
     * and no `parsedHex` local, because `lightTintGroupBackgroundColor`'s own
     * success/failure IS the parse. A legacy non-hex value therefore behaves as
     * "no colour" in BOTH arms — light falls to `bg-surface-elevated`, and
     * `darkArm` below falls to `!ground`, rather than the raw string being
     * truthy in one arm and unusable in the other.
     *
     * Changing any of this is a decision, not a cleanup.
     *
     * AMENDED Phase 88.3.1 (plan 09), the whole block above KEPT AS HISTORY.
     * Everything it decides still stands — the light tint in light mode, the
     * stored value in dark, 88-22's themed fallback for the uncoloured header,
     * and both rejected alternatives (H2's warm-700 plinth, H3's nav-blue band).
     * Two mechanical facts under it moved. (1) `resolveGroupBackgroundColor` and
     * `lightTintGroupBackgroundColor` are no longer CALLED here; both moved
     * inside `resolveGroupGround`, which is now the one place that answers "what
     * ground does this stored value paint". (2) Its "`ground` is the raw stored
     * hex GATED ON THE TINT SUCCEEDING" sentence describes a gate this file no
     * longer writes: T-88.3-43 became a property of the resolver's RETURN TYPE
     * (`{dark, light, …}` or `null`, never half a pair), so the two locals below
     * are destructured from ONE object and cannot drift apart. The CONSEQUENCE
     * the sentence cares about is UNCHANGED and still load-bearing: a value that
     * resolves to nothing behaves as "no colour" in BOTH arms, so `darkArm`
     * below still falls to its `!ground` clause rather than one arm seeing a
     * truthy string the other cannot use.
     */
    const ground = headerGroundPair?.dark ?? null;
    const tinted = headerGroundPair?.light ?? null;
    const hasHeaderImage = !!Group?.background_image_url;
    /*
     * DECISION Phase 88.3.1 (plan 09, AMENDMENT AC — the two-flag shape plan 08
     * shipped at `CalendarListView.js` and `EventDayModal.js`): a SECOND image
     * flag, derived from the VALIDATED `safeBgImageStyle` result, read ONLY by
     * `groupInkVars`.
     *
     * WHY TWO. `safeBgImageStyle` drops relative/invalid URLs (FSEC-03), so a
     * truthy-but-rejected URL paints NO image: that header IS a plain coloured
     * card and must get its ink. Feeding `groupInkVars` the raw `hasHeaderImage`
     * would withhold the ink from exactly those headers.
     * REJECTED: converging `hasHeaderImage` onto the validated style here. It is
     * the right end state and is the wave-12 ruling already applied at
     * `grouplist.js`, but it CHANGES WHAT AN INVALID-URL HEADER PAINTS (the
     * white-on-image title treatment gives way to plain contrast maths) on a
     * surface this plan was not scoped to re-look at, and the same divergence is
     * live at three sibling files. Registered as one 4-site family in
     * `.planning/deferred/phase-88.6.md`; converge all of them in one pass with a
     * rendered check. Deleting either flag here is a decision, not a cleanup.
     */
    const headerBgImageStyle = safeBgImageStyle(Group?.background_image_url);
    const hasValidHeaderImage = !!headerBgImageStyle;

    /*
     * `darkArm` — the ground-brightness half of the three header controls' fork.
     * The `!ground` clause is NOT belt-and-braces: `getBrightness(null)` returns
     * `255` by contract (colorUtils.js), so `isDarkBackground(null)` is `false`,
     * and a bare `isDarkBackground(ground)` would silently send the UNCOLOURED
     * header — the app's default and most common case — to the LIGHT arm even in
     * dark theme, where it sits on `bg-surface-elevated` (purple-800). That
     * surface is invisible to the colour value alone, so the null rule is the
     * only thing that can see it. `getTextStyle` already carries the equivalent
     * rule for the TITLE (its `isUnsetBackgroundColor` branch); this is the
     * controls' half of the same rule.
     */
    const darkArm = !ground || isDarkBackground(ground);

    // 88.6-21 (D-31, owner ruling 2026-08-27): the group-settings entry gate. Spelled as the
    // SAME expression `grouplist.js` already ships for the same decision, rather than a second
    // formulation of it. PRESENTATION ONLY — the backend 403 (`routes/groups.js:1521`) is the
    // authorization control; see the marker on the kebab below.
    const canEditGroup = userRole === 'owner' || userRole === 'admin';

    /*
     * The title/subtitle treatment is computed TWICE — once against the stored
     * hex (what dark mode paints) and once against the rendered tint (what
     * light mode paints) — and handed to the cascade as `--t-*` custom
     * properties. An inline `style` cannot itself be forked by a `dark:` class,
     * so the indirection is REQUIRED here, not stylistic (the plan-07 inert-
     * override trap; see `themedTextStyleVars`' own note in colorUtils.js).
     * No `useTheme`: the shipped DECISION at EventScheduler.tsx (plan 15, Req 8)
     * rejected the hook for exactly this problem — hydration fork, theme flash.
     *
     * NOTE for a future reader: at t = 0.70 all eight shipped presets tint to
     * W3C brightness 188-191, so `getTextStyle` takes its `brightness > 180`
     * tier for every one of them and the LIGHT-mode title treatment is CONSTANT
     * across the preset table (UI-SPEC §5.10.2). Do not add per-colour
     * computation back on the strength of that constancy — it is an outcome of
     * the current preset set, and `colorUtils.test.ts` pins the tier per preset
     * so a future light preset reds there first.
     *
     * `--t-weight` / `--t-weight-l` are built HERE rather than in
     * `themedTextStyleVars`, which deliberately omits `fontWeight` because it is
     * spread onto a CONTAINER at `grouplist.js` and `font-weight` inherits. Both
     * consumers here are leaf text elements, so the property cannot bleed.
     *
     * The fallback is the element's OWN base weight (`700` = `font-bold` on the
     * h1, `inherit` on the unstyled `<p>`), NOT a bare `inherit`. Compile-
     * verified against this tree's tailwindcss@4.3.3: `.font-bold` emits at
     * line 1847 of the compiled sheet and `.[font-weight:var(--t-weight-l)]` at
     * 1863 — same property, same specificity, so the ARBITRARY UTILITY WINS.
     * `inherit` is a real value, not an absence: it would beat `font-bold` and
     * silently un-bold the uncoloured header, which is the app's default.
     */
    const themedTextVars = (dark, light, baseWeight) => ({
        ...themedTextStyleVars(dark, light),
        '--t-weight': dark.fontWeight || baseWeight,
        '--t-weight-l': light.fontWeight || baseWeight,
    });
    const headerTitleVars = themedTextVars(
        getTextStyle(hasHeaderImage, ground),
        getTextStyle(hasHeaderImage, tinted),
        '700',
    );
    const headerSubtitleVars = themedTextVars(
        getSubtitleStyle(hasHeaderImage, ground),
        getSubtitleStyle(hasHeaderImage, tinted),
        'inherit',
    );
    /*
     * The eight arbitrary-property utilities that READ the properties above are
     * written out LITERALLY on each of the two elements rather than hoisted into
     * a shared constant. Deliberate, twice over: the drift gate
     * (`groupColourRendering.test.ts`) matches whole `className` EXPRESSIONS, and
     * `typeScaleTouchedSurfaces.test.ts`'s `HEADING_RE` reads the h1's className
     * literal — an interpolated constant is invisible to both, so hoisting would
     * silently disarm two gates. Four utilities are light-arm (unprefixed) and
     * four are `dark:`; the light-arm STROKE and WEIGHT are not optional
     * decoration — without them an image-background header loses its outline in
     * light mode and `font-bold` beats the returned `600`.
     */

    return (
        // POLL-02: FriendshipStatusProvider lifted to root layout — see
        // src/app/layout.js. Nested mount removed so NotificationBell +
        // friends/page consume the same receivedRequests state.
        <div className="p-4 md:p-6">
            {/* Breadcrumbs.
                DECISION Phase 88.3-17 (DEF-88.3-13-04, owner ruling A, 2026-08-27):
                the Home link gains the project focus ring, the same string the tab
                bar below and the header CTAs carry. It is included because the
                owner's finding was PAGE-WIDE — "when tabbing around the screen like
                this it's a blue circle, which is readable on some items, and not
                readable on others" — and a sweep scoped to the calendar would have
                closed the finding on a narrower surface than it was reported on,
                leaving this tab stop still painting the browser default. It is the
                FIRST tab stop on the group page, so it is the first thing that
                default outline paints on. Chosen OVER a global `a:focus-visible`
                rule in `globals.css`: that would repaint every link in the app from
                inside a phase that has no rendered gate on most of them. */}
            {/* DECISION Phase 88.6-21 (#175, owner ruling 2026-09-14, option 2 — label all five
                breadcrumb navs). Without a name, every `<nav>` in the app is announced as the same
                anonymous "navigation" landmark, so a screen-reader user's landmark list cannot
                tell the breadcrumb from the site nav. The other four are plans 17 and 18's; this
                one and `groupPlanning/page.js`'s are this plan's, and the ruling is assigned ONCE
                per nav, so plans 07/41/43 must not re-add it here.

                R2 #171 on the two spans below, each resolving differently:
                  - the HOME LINK's `font-medium` is DELETED. It is §4.5's emphasis case and the
                    emphasis is already carried by `text-content-link` plus the underline-on-hover,
                    so 400 + a colour token is exactly what it becomes, with no delta to look at.
                  - the CURRENT PAGE span KEEPS its weight (600 -> 700 under D-03) AND GAINS
                    `aria-current="page"` (T-88.6-138), matching plans 17 and 18's three
                    breadcrumbs so the five behave alike. Without the attribute, "you are here" is
                    carried by WEIGHT alone — nothing a screen reader exposes — and R2 #171 is the
                    rule that a weight may not be the sole carrier of information. The weight stays
                    because it is also the sighted cue; the attribute is an addition, not a swap. */}
            <nav aria-label="Breadcrumb" className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2">Home</Link>
                <span className="text-content-muted mx-2">{'>'}</span>
                <span aria-current="page" className="text-content-primary font-bold wrap-break-word">{Group?.name || 'Group'}</span>
            </nav>

            {/* Header — Phase 69-04 layout: ALWAYS stack title row above
                button row (no md:flex-row). Kebab moves into the title row
                so it sits beside the group name at every breakpoint instead
                of wrapping awkwardly under the buttons at narrow widths. */}
            {/* DECISION Phase 87.8 (D-03): the identity header is EXEMPT from the
                phone flatten rule — it keeps its chrome (background colour/cover
                image, rounded-lg) at phone width, chosen OVER applying the flatten
                rule uniformly. This is the one surface where the group's own colour
                rather than the token palette carries identity (UI-SPEC focal-point
                contract): its background IS its depth cue and the surface's anchor,
                and full-bleeding it deletes that anchor. Padding is depth-2
                (12px phone / 24px desktop) only. Removing this exemption is a decision, not a
                cleanup. */}
            {/* The old hardcoded near-black fallback here was a LOCAL patch of
                the D-28 white-card bug: this one surface pinned a dark value
                because the shared fallback resolved to white. Phase 88-22 fixed
                the shared fallback, so the patch drops and the header falls back
                to the themed elevated surface — which also makes it correct in
                light mode, where a hardcoded near-black header was not. */}
            <div
                className={cn(
                    'mb-6 flex flex-col gap-4 p-3 md:p-6 rounded-lg relative overflow-visible',
                    // MUTUALLY EXCLUSIVE, never stacked — `bg-surface-elevated`
                    // lives ONLY in the null branch. Compile-verified against
                    // this tree's tailwindcss@4.3.3: `.bg-[var(--group-ground-light)]`
                    // emits at 1426 and `.bg-surface-elevated` at 1549 — same
                    // property, same specificity, so source order wins and a
                    // stacked themed class would paint a coloured group WHITE in
                    // light mode. The inline `style` background this replaces hid
                    // that, because an inline style beats any class.
                    tinted
                        ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]'
                        : 'bg-surface-elevated',
                )}
                style={{
                    ...(tinted && {
                        '--group-ground': ground,
                        '--group-ground-light': tinted,
                    }),
                    /*
                     * DECISION Phase 88.3.1 (plan 09, SPEC Req 4 / UI-SPEC 3.3): the
                     * CARD ink pair rides in the SAME style object as the two grounds,
                     * chosen OVER emitting it at whichever text element consumes it.
                     * The ink and the ground must turn on and off together, and
                     * `groupColourRendering.test.ts` test 9 can only assert that when
                     * both live in one expression — co-location is what makes the
                     * invariant mechanical instead of conventional.
                     *
                     * `surface: 'card'`, not `'tile'`: UI-SPEC 3.3 puts this header in
                     * the CARD bucket, so it takes the preset's stored per-theme ink
                     * (8.00-8.08:1 on its own ground) rather than the tiles' plain
                     * high-contrast poles. `hasBackgroundImage` is passed EXPLICITLY
                     * and is the VALIDATED flag: this is a `.js` file, so an omitted
                     * option degrades silently to `false` — the UNSAFE direction, a
                     * preset's tinted ink painted over a user's photograph.
                     * REJECTED: the raw `hasHeaderImage` — see the two-flag marker
                     * above.
                     *
                     * KNOWN RESIDUAL, recorded so it is not read as an oversight: the
                     * h1 and its subtitle below still fork on `--t-color*` from
                     * `themedTextStyleVars`, so nothing in THIS file consumes the ink
                     * yet — exactly as at `grouplist.js`'s card title, at
                     * `EventDayModal.js`'s title/subtitle and at
                     * `CalendarListView.js`'s row. All four card TITLES are uniform
                     * today; what plan 08 moved onto the ink were the SPEC Req 8 sites
                     * (a theme-token fork keyed on "has a colour"), and this header
                     * has none — its three controls fork on `darkArm`, which is
                     * already ground-derived. Re-inking the titles is a real open
                     * question, it is a FOUR-SITE family rather than a gap in one
                     * file, and it needs its own look at 375px; registered in
                     * `.planning/deferred/phase-88.6.md`. The channel is wired here so
                     * that change is a className edit, not a re-plumb.
                     */
                    ...groupInkVars(headerGroundPair, {
                        surface: 'card',
                        hasBackgroundImage: hasValidHeaderImage,
                    }),
                    ...headerBgImageStyle,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    minHeight: '120px',
                }}
            >
                <div
                    // The dim exists to darken a user-chosen colour or cover
                    // image so the title reads over it. With neither, the header
                    // is on a themed surface that already has its contrast — a
                    // wash there just muddies the token (D-28).
                    //
                    // EXTENDED Phase 88.3 (Req 9, UI-SPEC §5.10.3), original
                    // reasoning above KEPT: the same argument now applies to the
                    // COLOURED header in LIGHT mode. A 15% black dim over the
                    // t = 0.70 tint costs ~11.5 L*, which would drag the rendered
                    // ground below Req 9's own `L* >= 75` acceptance — and that
                    // acceptance is measured on the RENDERED PIXEL, so the dim
                    // would fail the requirement rather than merely dull it. The
                    // dim rescues text from a DARK colour or a photo; on a light
                    // tint it only muddies the ground. So three explicit cases:
                    //   (1) background image -> 0.4, INLINE, both themes;
                    //   (2) stored colour, no image -> transparent in light,
                    //       0.15 in dark, via the class below;
                    //   (3) no colour -> transparent in both themes.
                    //
                    // The 0.15 is `dark:bg-[rgb(0_0_0/0.15)]` and NOT Tailwind's
                    // `dark:bg-black/15` shorthand. Compile-verified on
                    // tailwindcss@4.3.3: the slash form on a theme colour emits
                    // `color-mix(in oklab, var(--color-black) 15%, transparent)`,
                    // which Chromium serialises back as `color(srgb …)`/`oklab(…)`
                    // — not `rgba()`. The bracketed value emits a plain
                    // `rgb(0 0 0/0.15)`, which is what plan 12's rendered-alpha
                    // probe reads. It is also NEVER an inline value: an inline
                    // declaration outranks a `dark:` class, so an inline
                    // `'transparent'` on this property would win in both themes
                    // and silently delete the dark dim. The guard is `tinted`,
                    // not raw `headerBgColor`, so a legacy non-hex colour is
                    // "no colour" here too — same rule as the ground above.
                    className={
                        tinted && !Group?.background_image_url
                            ? 'dark:bg-[rgb(0_0_0/0.15)]'
                            : undefined
                    }
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 0,
                        borderRadius: 'inherit',
                        ...(Group?.background_image_url && {
                            backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        }),
                    }}
                />
                {/* z-30, not z-10: this row hosts the kebab dropdown, and its z-index
                    is a STACKING CONTEXT for everything inside — the sibling CTA row
                    below is z-20, so at z-10 the open dropdown painted underneath
                    "Manage Members" at phone width (87.8-13 walkthrough F-5). */}
                <div className="flex items-center gap-3 md:gap-4 relative z-30 flex-1 min-w-0">
                    {Group?.profile_picture_url && (
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface-card flex items-center justify-center text-2xl md:text-4xl shrink-0 overflow-hidden border-2 md:border-4 border-surface-card shadow-theme-lg">
                            {Group.profile_picture_url.startsWith('http') || Group.profile_picture_url.startsWith('/') ? (
                                <SafeImage
                                    src={Group.profile_picture_url}
                                    alt={Group.name}
                                    fallbackIcon="👥"
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span>{Group.profile_picture_url}</span>
                            )}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        {/* DECISION Phase 88-24 (Req 2 / UI-SPEC §4.1): the page title is
                            `text-3xl` at EVERY width, chosen OVER the shipped
                            `text-2xl md:text-3xl`. A heading that grows at a breakpoint is a
                            second type scale — the same reasoning 88-19 recorded when it
                            removed the md:-prefixed heading sizes from userProfile. This is a
                            visible +6px on phone, and it is the intended direction: userProfile
                            (:1268) and gameDetail (:1036) both already render their h1 at 30px
                            unconditionally, so this surface was the last outlier. `wrap-break-word`
                            is what keeps a long group name safe at 375px and must stay. */}
                        <Heading
                            level={1}
                            size="display"
                            /* `size="display"` IS `text-3xl` + 700 — no rung movement, so no
                               visible delta. The two ARBITRARY `[font-weight:var(--t-weight*)]`
                               declarations STAY and are load-bearing: they are the ground-derived
                               weight `getTextStyle` computes for a title over a photograph, and
                               tailwind-merge does not treat an arbitrary PROPERTY as conflicting
                               with `font-bold`, so both emit exactly as they do today and the
                               later one wins. `wrap-break-word` is dropped for the primitive's
                               own `wrap-anywhere`, the same trade plans 17-19 made on every
                               migrated heading. */
                            className="[color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [font-weight:var(--t-weight-l)] dark:[font-weight:var(--t-weight)]"
                            style={headerTitleVars}
                        >
                            {Group?.name || 'Group'}
                        </Heading>
                        <p
                            className="mt-1 [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [font-weight:var(--t-weight-l)] dark:[font-weight:var(--t-weight)]"
                            style={headerSubtitleVars}
                        >
                            {gamesList.length} {gamesList.length === 1 ? 'game' : 'games'} played
                            {UserList && UserList.length > 0 && (
                                <span className="ml-2">• {UserList.length} {UserList.length === 1 ? 'member' : 'members'}</span>
                            )}
                        </p>
                    </div>
                    {/* Kebab lives in the title row at every breakpoint so it
                        sits beside the group name (CONTEXT D-LEAVE-01 entry to
                        GroupSettings). Active members only.

                        ——— AMENDED Phase 88.6-21 (D-31), the line above KEPT AS HISTORY ———

                        "Active members only" IS SUPERSEDED, not contradicted: the entry is now
                        OWNER/ADMIN only. Owner ruling 2026-08-27, phone UAT test 6, option 1. The
                        single item is "Group settings", whose SAVE the backend 403s for anyone
                        else (`routes/groups.js:1507-1521`, the refusal at `:1521`), so an active
                        member was being offered an action that could only end in a failure toast.
                        The expression matches the one `grouplist.js` already ships for the same
                        decision (`canEdit = userRole === 'owner' || userRole === 'admin'`).

                        THIS GATE IS PRESENTATION ONLY. The BACKEND 403 remains the authorization
                        control and must never be "simplified away" on the strength of this line —
                        a UI gate mistaken for authorization is a real privilege defect
                        (T-88.6-54). The 403's user-facing copy is `MESSAGE_BY_CODE.forbidden`
                        (`useFetchErrorState.ts:50`, already ratified — no new string), routed and
                        asserted by plan 88.6-20 at `GroupSettings.js`'s settings-save catch, not
                        here. That path stays reachable: the role can change after the modal
                        renders (SPEC Edge Coverage, `ordering / R1`).

                        BOTH the wrapper AND the item are gated, deliberately. Plan 16's
                        zero-items-renders-no-trigger rule still holds as a rule (UI-SPEC §9 / §7.3)
                        but is NOT what is relied on here — in plan 18's own words, so this phase
                        ships one posture on the question, "that rule is a TEST CONTRACT, not an
                        authorization gate, and keeping the wrapper is cheaper than depending on
                        it".

                        IT STRANDS NOBODY. Leave Group lives in Manage Members
                        (`ManageMembers.js:641-647`, rendered for `isCurrentUser && !isOwner`),
                        whose opener sits under the same active-member gate in the CTA row below
                        and is reachable by every active member.

                        The TRIGGER stays swappable — Phase 88.9 owns replacing it with a gear
                        glyph, and this phase changes only what plan 16's component change brings.
                        Widening this gate back to any active member is a decision, not a cleanup. */}
                    {canEditGroup && (
                        <div className="shrink-0 relative z-20">
                            <KebabMenu
                                ariaLabel="Group actions"
                                items={
                                    canEditGroup
                                        ? [
                                              { label: 'Group settings', onClick: () => setShowGroupSettings(true) },
                                          ]
                                        : []
                                }
                            />
                        </div>
                    )}
                </div>
                {/* DECISION Phase 88.3 (D-10 / OI-6): all three controls in this row
                    branch on `darkArm = !ground || isDarkBackground(ground)`, where
                    `ground` is the STORED hex gated on the tint parsing (see the ground
                    block above). The `dark:`-prefixed classes are appended only on the
                    dark arm; the light-arm classes are always present. No `useTheme` —
                    the theme half rides the cascade, exactly as the ground does.

                    REJECTED, and both matter:
                      - keying off "the group HAS no colour", which is what shipped. That
                        is why `text-white border-2 border-white/30` over an inline
                        `rgba(255,255,255,0.1)` wash rendered INVISIBLE the moment 88-22
                        made an uncoloured header white in light mode.
                      - a `data-ground` CSS attribute selector. It is a new unlayered-
                        override idiom aimed at a primitive Phase 88.6 is already
                        migrating; revisit it there as a `Button` `onGround`/inverse
                        variant, not here.
                      - a bare `isDarkBackground(ground)` with no null rule — see the
                        `darkArm` comment above for why that is a silent regression.

                    OI-6 (owner-ruled 2026-08-25), fixed here under "converge while you
                    are in the file": the Add-New-Game-Event fill was `var(--amber-600)`
                    with white text — 3.19:1, FAILING in BOTH themes since before this
                    phase, i.e. pre-existing and not caused by Req 9. It is now
                    `var(--amber-700)`, 5.02:1. `amber-800` (7.09:1) was offered and
                    REJECTED by the owner as too dark.

                    THE BORDERS ARE GONE, and that is not a style tidy: `globals.css`'s
                    unlayered `.btn { border: none }` beats every `@layer utilities`
                    border class, so `border-2 border-white/30` (Manage Members),
                    `border-2 border-white/20` (Plan Game Session) and
                    `border-2 border-amber-400/40 hover:border-amber-400/60` (Add New
                    Game Event) rendered NOTHING on this row and had done for as long as
                    `.btn` has been unlayered. Keeping a white border declaration on a
                    control that now sits on a WHITE header would have read as intent to
                    a future editor. A real border/ring model for `.btn` is Phase 88.6's
                    `Button` migration to own; this plan asserts no border ratio.
                    In their place all three carry an AUTHOR FOCUS RING —
                    `focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring
                    focus-visible:ring-offset-2`. `.btn` defines no `focus-visible` style
                    and there is no global one, so this was the only keyboard affordance
                    missing. It does NOT fork on `darkArm`: `--color-focus-ring` is
                    purple-700 in light and amber-400 in dark, so the token carries the
                    theme itself.

                    NOTE on the inline-boxShadow marker below (preserved verbatim, do not
                    edit it): its "the ring survives as `ring-2 ring-white/15`" is now
                    true in DARK ONLY. On the light arm that ring measures 1.28:1 on the
                    t = 0.70 tint — invisible — so it drops there and the focus ring takes
                    its place. The dark arm keeps it as `dark:ring-2 dark:ring-white/15`:
                    RENDERED-EQUIVALENT to what shipped, not byte-identical.

                    LIMIT, recorded because it is the thing that will break first: the
                    light arm's `text-content-primary` and `hover:bg-surface-hover` are
                    THEME tokens, not ground-derived. They are correct today only because
                    every shipped preset is dark, so `darkArm` is `true` for all eight of
                    `DEFAULT_BACKGROUND_COLORS` — plan 10's `colorUtils.test.ts` pins all
                    eight as `isDarkBackground === true`, so a future LIGHT preset reds
                    that test before it ever reaches this header. If one ships, the
                    upgrade path is the ground-derived pole — `getContrastColor(ground)`
                    handed to CSS as a custom property, the same indirection the title
                    already uses above — NOT a theme-token swap.

                    ——— AMENDED Phase 88.3.1 (plan 09), the LIMIT above KEPT AS HISTORY ———

                    THE LIMIT'S PREMISE NEEDED CORRECTING, NOT ITS CONCLUSION. Its
                    sentence "every shipped preset is dark, so `darkArm` is `true` for
                    all eight of `DEFAULT_BACKGROUND_COLORS`" is false AS WRITTEN after
                    this phase: that array no longer exists, and each preset now carries
                    TWO values — a dark band and a light surface
                    (`lib/groupColourPresets.ts`). Read literally it would send a future
                    reader looking for a light preset that "reaches this header", and
                    there is one in the table.

                    THE CORRECTED PREMISE: every shipped preset's DARK BAND is dark
                    (W3C brightness 32-47, `getBrightness` <= 128 for all eight, pinned
                    by `groupColourPresets.test.ts`), and `ground` is the DARK BAND —
                    `resolveGroupGround(...).dark`. So `darkArm` is still `true` for all
                    eight and the LIMIT still does not fire. The light surface is only
                    ever painted in LIGHT mode, where the light-arm classes are the ones
                    present, so the theme token and the rendered ground still agree.
                    `darkArm` is therefore BYTE-UNCHANGED by this plan — deliberately.

                    THE GUARD IT NAMES SURVIVES. `colorUtils.test.ts`'s dark-ground
                    tripwire was RE-PINNED to `p.dark` by plan 88.3.1-06 rather than
                    deleted, so a future preset whose DARK band stopped being dark still
                    reds there before it ever reaches this header. And the stated upgrade
                    path — a ground-derived pole handed to CSS as a custom property, NOT
                    a theme-token swap — is unchanged and is still the right one.

                    WHAT WOULD ACTUALLY FIRE IT, so the residual is named rather than
                    implied: a LEGACY light stored hex, which resolves through the
                    compatibility path with `ground` = that light hex. SPEC Req 6's
                    migration removes every one of those from the estate, which is why
                    this is a corrected premise and not an open defect.

                    Any of this is a decision, not a cleanup. */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 relative z-20 w-full shrink-0 items-stretch sm:items-center md:justify-end">
                    {userRole && userRole !== 'pending' && (
                        /* DECISION Phase 88.3-16 (owner ruling 2, research-checked 2026-08-27):
                           the LIGHT arm of this control now carries an 80% WHITE WASH plus a 1px
                           RING — `bg-white/80 ring-1 dark:ring-0`. Req 12 test 7,
                           verbatim: "I can read the words, but I can't see a button there. All other
                           buttons are readable." Before this it had no bg and no border at all: the
                           resting shadow was its only edge and Req 3 removed it.

                           THIS ELEMENT RENDERS ON TWO GROUNDS and both are measured (2026-08-27,
                           `src/lib/wcag.ts`), because `darkArm` is true for all eight presets so the
                           LIGHT arm is what an UNCOLOURED header gets as well as a tinted one:
                             - on the eight t = 0.70 tints, the composited wash vs the tint measures
                               1.634 (Forest) - 1.716 (Wine), Navy 1.660 — the wash IS the boundary;
                             - on the WHITE uncoloured header the wash composites to white and
                               contributes NOTHING (1.00), so the RING is the only cue there:
                               warm-300 vs #ffffff = 1.595. That is the shipped Geist / Fluent / Ant /
                               shadcn-outline pattern (white fill + a 1.20-1.53 hairline), and it is
                               why the treatment is a wash AND a ring rather than either alone;
                             - ring vs the composited wash: 1.418-1.432, inside the shipped
                               1.20-1.57 neutral-border band;
                             - DISCLOSURE, not a floor: ring vs the raw tint is only 1.141-1.209. The
                               ring is an inner edge ON the wash, not a boundary against the tint.
                               Do not read that number as the tint boundary — the wash's own 1.66 is;
                             - text `text-content-primary` (warm-900) on the composited wash:
                               15.97-16.12. The wash did not hurt the label.

                           HOVER IS A DIFFERENT GROUND and is deliberately left alone.
                           `hover:bg-surface-hover` is (0,2,0) and beats the base `bg-white/80` at
                           (0,1,0), so on hover the fill becomes the OPAQUE `--color-bg-hover`
                           (warm-50), not the wash every number above measures: ring 1.505, text
                           16.949 there. Changing it would repaint a surface the owner has not been
                           asked about, including on the white header. It is emitted inside
                           `@media (hover: hover)`, so it is desktop-only and INERT on the phone lane
                           — it cannot affect the Req 12 phone re-check. If the wash should ever
                           persist under the pointer, the recorded step is `hover:bg-white/90`.

                           REJECTED, and each matters:
                             - a >= 3:1 NEUTRAL BORDER (`border-line-strong` / warm-500). This is the
                               substitution the FIRST version of this plan proposed, and the research
                               check killed it: 0 of 13 shipped systems put a >= 3:1 neutral border on
                               a neutral fill, the shipped band is 1.20-1.57, and warm-500 is 2.3x the
                               strongest shipped neutral border
                               (`LIGHT-MODE-SECONDARY-BUTTONS-SURVEY-2026-08-27.md`). "Measure upward
                               until 3:1" is withdrawn, not deferred.
                             - a BORDER instead of a ring. `.btn { border: none }` is unlayered and
                               eats every border utility on this element (see the D-10 marker above);
                               `ring-*` compiles to `box-shadow`, which that reset cannot defeat.
                               Compile receipt (tailwindcss@4.3.3, 2026-08-27): `.ring-1` emits
                               `box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow),
                               var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)`
                               — the SAME list `.shadow-theme-md` writes, so the existing
                               `shadow-theme-md` composes with the ring instead of being replaced.
                               `.focus-visible\:ring-2:focus-visible` is (0,2,0) and emits after
                               `.ring-1` (0,1,0), so the FOCUS ring still wins when focused; and
                               `.dark\:ring-0:where(.dark, .dark *)` is (0,1,0) emitted after
                               `.ring-1`, so the dark arm renders byte-equivalent to what shipped.
                               Verified from the emitted CSS, not assumed.
                             - RESTORING THE RESTING SHADOW. Req 3 / OI-2 stands; the owner did not
                               reject the shadow removal, he reported its consequence.
                             - a `data-ground` CSS attribute selector — already rejected at the D-10
                               marker above and still rejected here, for the same reason.
                             - an OPAQUE light-arm FILL (`bg-btn-secondary`, warm-200). This is the
                               recorded NEXT STEP, not a discarded idea: it would make this control
                               consistent with `.btn-secondary` and reads 1.31 on the white header
                               instead of leaning on the ring. Reach for it if the phone re-check
                               still says "no button there".
                               AMENDED Phase 88.3-18 (owner ruling 1c, 2026-08-28): it STAYS a
                               recorded next step — only its numbers move. `--color-btn-secondary-bg`
                               is now **warm-100** (ruling 1c moved the page off that hex; see the
                               `.btn-secondary` marker in `globals.css` for why that is not a
                               reverted fix), so this alternative would read **1.1330** on the white
                               header, not 1.31 — i.e. a WEAKER opaque cue than when this bullet was
                               written. That makes the ring this control actually ships more
                               defensible, not less. Nothing here changed in code.

                           Phase 88.6's `Button` migration still owns the real border/ring MODEL;
                           this is an interim per-site edge. Changing it is a decision, not a
                           cleanup. */
                        /* ——— AMENDED Phase 88.6-21 (task 2, UI-SPEC §3.2 `:208`), everything
                           above KEPT AS HISTORY ———

                           THIS CONTROL IS NOW A `<Button variant="ghost">`, AND EVERY EDGE
                           TREATMENT THE MARKER ABOVE DESCRIBES SURVIVES IT. `bg-white/80`,
                           `ring-1 ring-line-control`, `dark:ring-0` and the whole dark arm move
                           onto `<Button className>` unchanged and win through `cn`'s
                           tailwind-merge last-wins, exactly as §3.2's `btn`-alone row says. Every
                           ratio measured above is therefore still the shipped ratio.

                           `variant="secondary"` was NOT available: the opaque `bg-btn-secondary`
                           alternative is the RECORDED NEXT STEP priced at 1.1330 in the bullet
                           above, i.e. a WEAKER cue than the ring, and taking it here would have
                           been the rejected arm of ruling 2. `variant="primary"` is forbidden for
                           a bare `.btn` outright (§3.2 `:214`).

                           FOUR MECHANICAL CHANGES, each of which touches something this marker
                           states, so each is recorded rather than left to be discovered:

                             1. `hover:bg-surface-hover` is DELETED from the call site. It is not
                                lost — `variant="ghost"` supplies the byte-equal
                                `enabled-hover:bg-surface-hover` from the cva variant map. The
                                spelling had to change: `enabled-hover` excludes `:disabled` and
                                `[aria-disabled]`, and a bare `hover:` left beside it would not
                                de-dupe under tailwind-merge, so both would survive.
                             2. `dark:hover:bg-white/20` becomes `dark:enabled-hover:bg-white/20`,
                                and this one is LOAD-BEARING rather than tidy. `enabled-hover`
                                compiles to `&:not(:disabled):not([aria-disabled='true']):hover`
                                — (0,4,0). The dark variant is `:where(.dark, *)`, which is
                                zero-specificity, so the old `dark:hover:` form is (0,2,0) and
                                would now LOSE to the ghost variant's hover in dark mode: the 10%
                                -> 20% white wash would have silently become the light-theme
                                surface token. Verified against the compiled stylesheet, not
                                reasoned from the class names.
                             3. The per-site focus ring is DELETED — `A-2 ARM A` (owner ruling
                                2026-09-15) puts the `.btn` family's ring in `Button.tsx`'s cva
                                base and forbids a second expression of it. `cascadeOrder.test.ts`
                                keeps the half-migration (class string kept, ring dropped) red.
                             4. `px-4 py-2 md:px-6 md:py-3`, `rounded-btn` and `transition-all`
                                are DELETED as dead: `.btn` declares `padding`, `border-radius`
                                and `transition` UNLAYERED (`globals.css:2194-2205`), so no
                                `@layer utilities` class of any of the three ever painted here.
                                `transition-all` in particular is worth naming: the hover fill
                                DOES transition, from `.btn`'s own
                                `transition: var(--theme-transition)` (`:1684` —
                                background-color, color, border-color, box-shadow), never from
                                this class.

                           `shadow-theme-md` STAYS and gains NO hover pin: the base emits
                           `enabled-hover:shadow-theme-md`, so hover resolves to the SAME tier it
                           rests at. Measured-safe, and `shadowTier.test.ts` test 8 is the shipped
                           negative control for exactly that. */
                        <Button
                            variant="ghost"
                            onClick={() => setMemberModal(true)}
                            className={
                                'whitespace-nowrap ' +
                                'text-content-primary bg-white/80 ring-1 ring-line-control dark:ring-0 ' +
                                'shadow-theme-md' +
                                // The 10% white wash moves from an inline `style` to
                                // `dark:bg-white/10`, because an inline declaration cannot
                                // be forked by a `dark:` class. On a light ground it was
                                // invisible, and it is what made this control disappear.
                                // `backdrop-blur-xs` comes with it: it only ever did
                                // visible work over that translucent wash or an image.
                                (darkArm
                                    ? ' dark:text-white dark:bg-white/10 dark:enabled-hover:bg-white/20 dark:backdrop-blur-xs'
                                    : '')
                            }
                        >
                            Manage Members
                        </Button>
                    )}
                    {/* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the groupHomePage primary CTA (~37px: the px/py utilities here are DEAD — unlayered `.btn` padding beats layered utilities). Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor (rejected — would distort ~15 compact/icon `.btn` sites, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text link.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup.  ——— AMENDED Phase 88.6 (D-09), original reasoning above KEPT AS HISTORY: the desktop half is now ANSWERED, and again by a split. TAKEN: `min-h-11` on the `Button` primitive's cva base (`src/components/ui/Button.tsx`), which reaches every viewport width. STILL REJECTED: the ALL-VIEWPORT floor on the `.btn` CLASS — `globals.css`'s `@media (width < 48rem)` rule is unwidened (`globals.css:2677-2681`, reasoning at `:2647-2676`), because square-by-design controls wear `.btn` and a class-level floor would deform them. That is why both halves of this marker are still literally true: the rejection is about a rule on the CLASS; the new floor is on the PRIMITIVE, which only opted-in elements get. CONSEQUENCE: this per-CTA `min-h-11` becomes redundant ONLY once this element is a `<Button>`. Until this file's own migration sweep lands, deleting it still shrinks this control on desktop. When the sweep does land, dropping it is correct and is part of that commit — not a separate cleanup, and not something to do from here. */}
                    {/* DECISION Phase 88.6-21 (task 2, UI-SPEC §3.2 asChild row / §13 correction 4):
                        this is the PURPLE `btn btn-primary` CTA, not the amber one — the SPEC's
                        own §13 correction 4 exists because an earlier reading swapped the two. It
                        becomes `<Button asChild variant="primary">` wrapping the `<Link>`, and the
                        surviving utilities go on `<Button className>`, NEVER on the slotted child:
                        Radix `Slot` concatenates the child's className onto the slot's WITHOUT
                        tailwind-merge, so a utility left on the child cannot win a conflict and can
                        silently double up. `asChild` correctly omits `type` on a slotted anchor.

                        `hover:shadow-xl` is GONE, for two independent reasons that happen to have
                        one fix. It is OFF-TIER — `--shadow-xl` is not declared in `globals.css`, so
                        it fell through to Tailwind's inlined black default rather than the
                        re-tinted project scale (D-14b, `DECISION Phase 87.7`). And it is a BARE
                        `hover:` pin, which re-lifts a gated control and does not de-dupe against
                        the primitive's `enabled-hover:` base token, so both would have survived
                        the merge. The replacement is `enabled-hover:shadow-theme-lg`, which also
                        satisfies §3.4 rule 2: without a pin the base's `enabled-hover:shadow-theme-md`
                        would SHRINK this control's `lg` resting elevation on hover.

                        `min-h-11` DROPS HERE, in the same commit as the migration and never before
                        it — the amended D-36 marker above says this class is the ONLY thing holding
                        the CTA at 44px at `md`+, so dropping it first opens a window with no desktop
                        floor. `Button`'s cva base now supplies that floor at every viewport (D-09).
                        The MARKER stays; only the class goes.

                        `px-4 py-2 md:px-6 md:py-3` are deleted as dead (unlayered `.btn` padding),
                        and the per-site focus ring with them (A-2 ARM A — the ring's one home is
                        the cva base). A decision, not a cleanup. */}
                    <Button
                        asChild
                        variant="primary"
                        /* The inline boxShadow this replaces carried TWO halves: a
                           pure-black drop shadow AND a 2px white ring. Req 3 moves
                           the black half onto the warm `shadow-theme-lg` token —
                           which this element already declared and the inline style
                           was silently overriding — and the ring survives as
                           `ring-2 ring-white/15`, the same 15% white at the same
                           2px. Dropping the ring would still pass 88-29's
                           zero-`rgba(0,0,0` gate while looking wrong. */
                        className={
                            'shadow-theme-lg enabled-hover:shadow-theme-lg ' +
                            'whitespace-nowrap text-center' +
                            (darkArm ? ' dark:ring-2 dark:ring-white/15' : '')
                        }
                    >
                        <Link href={`/groupPlanning?group_id=${Router}`}>
                            Plan Game Session
                        </Link>
                    </Button>
                    {userRole && userRole !== 'pending' && (
                        /* DECISION Phase 88.6-21 (task 2, D-09 / UI-SPEC §3.2 accent row): the
                           amber Create-Event CTA converges onto `<Button variant="accent">` and
                           its inline `style` is DELETED. That inline pair was the SECOND
                           expression of one design decision — the first is `.btn-accent`
                           (`globals.css:2478-2481`) — which is exactly the routed duplication the
                           `DECISION Phase 88.3-18` marker at `globals.css:2389` exists to prevent.
                           The OI-6 reasoning the deleted comment carried is KEPT here rather than
                           lost: the fill was `var(--amber-600)`, white on it 3.19:1, a pre-existing
                           AA failure in both themes; `--amber-700` is 5.0216:1; `amber-800` (7.09)
                           was offered and REJECTED by the owner as too dark.

                           BYTE-EQUAL AT REST, MEASURED AT EXECUTION ACROSS ALL THREE TOKENS, not
                           two: `--color-btn-accent-bg` is `var(--amber-700)` in both theme blocks
                           (`globals.css:1390`, `:1827`), `--color-btn-accent-text` is `#ffffff` in
                           both (`:1392`, `:1829`), and `--color-btn-accent-hover` is
                           `var(--amber-800)` in both (`:1391`, `:1828`).

                           THE HOVER STATE IS NOT BYTE-EQUAL, AND THAT IS DISCLOSED RATHER THAN
                           SUPPRESSED. Today the amber is an INLINE declaration, which beats every
                           class rule, so the fill is INVARIANT under hover — `.btn` declares no
                           background of its own. After this migration
                           `.btn-accent:hover:not(:disabled):not([aria-disabled='true'])`
                           (`globals.css:2483-2484`) applies `--color-btn-accent-hover`, and
                           `.btn`'s own unlayered `transition: var(--theme-transition)` (`:1684`)
                           covers background-color — so the control now visibly DARKENS on hover
                           where it previously did not move. It is an ADDED state, not a changed
                           one, and the added state is STRONGER than the rest state it lifts from:
                           white on amber-800 measures 7.0900 (`tokenContrast.test.ts:1257`) against
                           the rest state's 5.0216. Recorded in `88.6-21-SUMMARY.md` for
                           `/gsd-ui-review`. Re-adding an inline fill to suppress it is a decision,
                           not a cleanup.

                           `shadow-theme-lg enabled-hover:shadow-theme-lg` is UI-SPEC §3.4 rule 2
                           and this control is its certain subject: it rests at `lg` with no hover
                           rule today, so the base's `enabled-hover:shadow-theme-md` would have
                           SHRUNK it. The spelling is plan 05's `enabled-hover` variant, never a
                           bare `hover:` — plan 12's hover-pin gate rejects the bare form because it
                           re-lifts the gated controls the variant exists to exclude. */
                        <Button
                            variant="accent"
                            onClick={toggleEventModal}
                            /* Same two-half shadow as the CTA above: black half ->
                               `shadow-theme-lg`, white ring half preserved as
                               `ring-2 ring-white/15`. */
                            className={
                                'whitespace-nowrap ' +
                                'shadow-theme-lg enabled-hover:shadow-theme-lg' +
                                (darkArm ? ' dark:ring-2 dark:ring-white/15' : '')
                            }
                        >
                            Add New Game Event
                        </Button>
                    )}
                </div>
            </div>

            {userRole === 'pending' && <PendingMemberBanner groupId={Router} />}

            {/* Tab bar */}
            {/* DECISION Phase 88.6-21 (R2 #171 + a Rule-2 a11y add): these two tabs conveyed their
                ACTIVE state to nobody. They are bare `<button>`s with no `role`, no
                `aria-selected` and no `aria-current`; the active one differs by fill, ink and a
                bottom border, none of which is exposed to assistive technology. They are this
                page's only content switch. `aria-current` is one attribute with ZERO visual delta,
                and it is the same fix plan 88.6-19 made on the friends tab strip, so the two
                surfaces stay one idiom.

                The `font-medium` DELETION is a separate correction and is NOT the fix above: the
                weight sat on BOTH arms, so it never carried the active state at all — it is
                simply §4.5's 500-is-not-a-rung case, and 400 is what a control label is.

                REJECTED: `role="tab"` + `aria-selected` + a `tablist` parent. That is the full
                ARIA tabs pattern and it brings obligations these buttons do not meet — arrow-key
                roving focus, `aria-controls` onto a `role="tabpanel"`. Claiming the pattern
                without the keyboard contract is worse than not claiming it (the same reasoning
                `KebabMenu` records for refusing the menu pattern, 88.6-16 D-12). Adding the full
                pattern is a decision for Phase 88.9, not a cleanup.

                REJECTED: migrating these onto `Button`. They are tab chrome, not buttons — `.btn`
                would impose its own padding, its 44px floor and the elevation pair on a flush tab
                strip, which is a look change (P6). They wear no `.btn` today and no census counts
                them. */}
            <div className="flex border-b border-line mb-4">
                <button
                    onClick={() => setActiveTab('home')}
                    aria-current={activeTab === 'home' ? 'true' : undefined}
                    className={`px-4 py-2 text-sm active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
                        activeTab === 'home'
                            ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
                            : 'text-content-secondary hover:text-content-primary'
                    }`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setActiveTab('library')}
                    aria-current={activeTab === 'library' ? 'true' : undefined}
                    className={`px-4 py-2 text-sm active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
                        activeTab === 'library'
                            ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
                            : 'text-content-secondary hover:text-content-primary'
                    }`}
                >
                    Library
                </button>
            </div>

            {activeTab === 'home' && (
              <>
                {/* Group Calendar */}
                <EventCalendar
                    refreshKey={eventsRefreshKey}
                    events={groupEvents}
                    variant="compact"
                    title="Calendar"
                    showListView={true}
                    scope={Router ? `group:${Router}` : 'group'}
                    onEmptyDayClick={userRole && userRole !== 'pending' ? (dateStr) => {
                        // CAL-05: empty-day tap (or EventDayModal's
                        // "+ New event on this day") opens create-event in
                        // visual day-mode focused on the tapped day.
                        setCalendarPrefillDate(dateStr);
                        setCalendarEntryMode('day');
                        setEventModal(true);
                    } : undefined}
                />

                {/* Group Games Section */}
                <GroupGamesList
                    games={gamesList}
                    groupId={Router}
                    onAddEvent={toggleEventModal}
                    userRole={userRole}
                    members={UserList}
                    errorState={gamesErrorState}
                />
              </>
            )}

            {activeTab === 'library' && (
                <GroupLibrary groupId={Router} />
            )}

            <CreateEvent
                group_id={Router}
                modal={eventModal}
                modaltoggle={() => {
                    setEventModal(false);
                    setCalendarPrefillDate(null); // Clear calendar prefill on close
                    setCalendarEntryMode('week'); // CAL-05: reset to default
                }}
                onEventCreated={handleEventCreated}
                user={user}
                prefillDate={calendarPrefillDate || prefillDate}
                prefillTime={prefillTime}
                userRole={userRole}
                initialVisualView={calendarEntryMode}
            />

            <ManageMembers
                group_id={Router}
                user={user}
                modal={memberModal}
                modaltoggle={() => setMemberModal(false)}
                onMembersUpdated={getGroupMembers}
                group_name={Group?.name || 'this group'}
            />

            {showGroupSettings && Group && (
                <GroupSettings
                    group={Group}
                    user={user}
                    userRole={userRole}
                    onClose={() => setShowGroupSettings(false)}
                    onUpdate={() => {
                        // Re-fetch group settings + members so Settings edits
                        // (profile picture, background, etc.) reflect immediately.
                        getGroup();
                        getGroupMembers();
                        setShowGroupSettings(false);
                    }}
                    onGroupDeleted={() => {
                        setShowGroupSettings(false);
                        router.push('/');
                    }}
                    onOpenManageMembers={() => {
                        setShowGroupSettings(false);
                        setMemberModal(true);
                    }}
                />
            )}
        </div>
    );
}

export default GroupHomePage;
