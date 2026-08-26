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
    resolveGroupBackgroundColor,
    lightTintGroupBackgroundColor,
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
            console.error('Error fetching group:', error);
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
                console.warn('Group members data is not an array:', data);
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
            console.error('Error fetching group members:', error);
            setUserList([]);
        }
    };

    const fetchGroupEvents = async () => {
        if (!Router || !user?.sub) return;
        try {
            const data = await eventsAPI.getGroupEvents(Router, { includeRsvpSummary: true });
            setGroupEvents(data || []);
        } catch (error) {
            console.error('Error fetching group events:', error);
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
            console.error('Error fetching games:', error);
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
    const headerBgColor = resolveGroupBackgroundColor(Group?.background_color);

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
     */
    const tinted = lightTintGroupBackgroundColor(headerBgColor);
    const ground = tinted ? headerBgColor : null;
    const hasHeaderImage = !!Group?.background_image_url;

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
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                <span className="text-content-muted mx-2">{'>'}</span>
                <span className="text-content-primary font-semibold wrap-break-word">{Group?.name || 'Group'}</span>
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
                    ...safeBgImageStyle(Group?.background_image_url),
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
                        <h1
                            className="text-3xl font-bold wrap-break-word [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [font-weight:var(--t-weight-l)] dark:[font-weight:var(--t-weight)]"
                            style={headerTitleVars}
                        >
                            {Group?.name || 'Group'}
                        </h1>
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
                        GroupSettings). Active members only. */}
                    {userRole && userRole !== 'pending' && (
                        <div className="shrink-0 relative z-20">
                            <KebabMenu
                                ariaLabel="Group actions"
                                items={[
                                    { label: 'Group settings', onClick: () => setShowGroupSettings(true) },
                                ]}
                            />
                        </div>
                    )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 relative z-20 w-full shrink-0 items-stretch sm:items-center md:justify-end">
                    {userRole && userRole !== 'pending' && (
                        <button
                            onClick={() => setMemberModal(true)}
                            className="btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap text-white border-2 border-white/30 rounded-btn backdrop-blur-xs hover:bg-white/20 transition-all shadow-theme-md"
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            }}
                        >
                            Manage Members
                        </button>
                    )}
                    {/* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the groupHomePage primary CTA (~37px: the px/py utilities here are DEAD — unlayered `.btn` padding beats layered utilities). Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor (rejected — would distort ~15 compact/icon `.btn` sites, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text link.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup. */}
                    <Link
                        href={`/groupPlanning?group_id=${Router}`}
                        /* The inline boxShadow this replaces carried TWO halves: a
                           pure-black drop shadow AND a 2px white ring. Req 3 moves
                           the black half onto the warm `shadow-theme-lg` token —
                           which this element already declared and the inline style
                           was silently overriding — and the ring survives as
                           `ring-2 ring-white/15`, the same 15% white at the same
                           2px. Dropping the ring would still pass 88-29's
                           zero-`rgba(0,0,0` gate while looking wrong. */
                        className="btn btn-primary px-4 py-2 md:px-6 md:py-3 font-semibold shadow-theme-lg hover:shadow-xl text-sm md:text-base whitespace-nowrap border-2 border-white/20 text-center min-h-11 ring-2 ring-white/15"
                    >
                        Plan Game Session
                    </Link>
                    {userRole && userRole !== 'pending' && (
                        <button
                            onClick={toggleEventModal}
                            /* Same two-half shadow as the CTA above: black half ->
                               `shadow-theme-lg`, white ring half preserved as
                               `ring-2 ring-white/15`. */
                            className="btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap rounded-btn transition-all border-2 border-amber-400/40 hover:border-amber-400/60 shadow-theme-lg ring-2 ring-white/15"
                            style={{
                                backgroundColor: 'var(--amber-600)',
                                color: 'white',
                            }}
                        >
                            Add New Game Event
                        </button>
                    )}
                </div>
            </div>

            {userRole === 'pending' && <PendingMemberBanner groupId={Router} />}

            {/* Tab bar */}
            <div className="flex border-b border-line mb-4">
                <button
                    onClick={() => setActiveTab('home')}
                    className={`px-4 py-2 text-sm font-medium active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
                        activeTab === 'home'
                            ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
                            : 'text-content-secondary hover:text-content-primary'
                    }`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setActiveTab('library')}
                    className={`px-4 py-2 text-sm font-medium active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset ${
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
