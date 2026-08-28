// src/components/GroupList.js
'use client'
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import GroupSettings from './GroupSettings';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { groupsAPI } from '../../lib/api';
import {
  getTextStyle,
  lightTintGroupBackgroundColor,
  resolveGroupBackgroundColor,
  themedTextStyleVars,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { formatDate } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import ClickableMemberName from './ClickableMemberName';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';

const GroupList = ({ onGroupSelect, onCreateGroup, user, onGroupSettingsUpdated, refreshTrigger }) => {
  const router = useRouter();
  const { user: authUser } = Auth();
  const { timezone } = useTimezone();
  // Phase 87.3-05 (PR-B): resolve the caller's own Users.id UUID via the shared
  // identity primitive. Every is-me compare below keys on the nested member.id
  // (UUID) vs selfUuid — never the flat member.user_id vs sub compare (which
  // flips value at PR-C). selfUuid resolves ASYNC, so role derivation runs in its own effect
  // gated on resolution (D-04 async-resolution constraint).
  const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
  const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingsGroup, setSettingsGroup] = useState(null);
  const [userRoles, setUserRoles] = useState({});
  /* DECISION Phase 88-18 (Req 6 / T-88-18-01): the getUserGroups failure is tracked as its own
     state rather than being flattened into `setGroups([])`. That flatten is what made a failed
     request render "No groups yet" — telling someone who may well own several groups that they
     have none, on the app's landing surface. Empty and failed are different facts on different
     surfaces (UI-SPEC 9.2). This is separate from `selfIdentityErrorState` above: that one is
     the identity-resolution degrade (D-08/D-11), this one is the groups request itself. Do not
     merge them, and do not go back to `setGroups([])` on catch. */
  const [groupsError, setGroupsError] = useState(null);

  // selfUuid resolves ASYNC after this mount effect's first run, so it is in the
  // dependency array per the async-resolution rule — the fetch re-fires (and the
  // list populates) once identity resolves, instead of silently no-oping forever.
  useEffect(() => {
    if (user) {
      fetchGroups();
    }
  }, [user, refreshTrigger, selfUuid]); // selfUuid gates the getUserGroups sender below

  // Derive per-group self role reactively off the resolved UUID. Kept separate
  // from the group fetch so an unresolved selfUuid never stores a wrong "no
  // role" derive — the effect re-runs (and roles populate) once identity
  // resolves. selfUuid is in the dependency array per the async-resolution rule.
  useEffect(() => {
    if (!selfUuid) return;
    const roles = {};
    groups.forEach(group => {
      if (group.Users && Array.isArray(group.Users)) {
        const userMember = group.Users.find(u => u.id === selfUuid);
        if (userMember) {
          // Role is in UserGroup object from the through relationship
          roles[group.id] = userMember.UserGroup?.role || 'member';
        }
      }
    });
    setUserRoles(roles);
  }, [groups, selfUuid]);

  const fetchGroups = async () => {
    // Mount-fire gate: wait for the caller's own Users.id UUID to resolve. This
    // guard IS the resolution gate (paired with selfUuid in the effect deps).
    if (!selfUuid) return;

    try {
      setLoading(true);
      setGroupsError(null);
      // Use groupsAPI.getUserGroups which automatically includes Authorization header
      const groupsData = await groupsAPI.getUserGroups(selfUuid);
      setGroups(groupsData || []);
    } catch (error) {
      console.error('Error fetching groups:', error.message || 'Unknown error');
      // Keep the ERROR object, not a flattened string: useFetchErrorState reads
      // `ApiError.code` off it to pick the right user-facing copy.
      setGroupsError(
        error instanceof Error ? error : new Error("The groups request didn't complete.")
      );
    } finally {
      setLoading(false);
    }
  };

  // Adapter onto the shared fetch-error pair, matching the 88-14 friends-page
  // pattern: the hook documents that it reads ONLY isError/error/refetch
  // (useFetchErrorState.ts:89). `retry` must be stable — the hook puts it in a
  // useCallback dep AND in its refocus-recovery effect deps.
  const fetchGroupsRef = useRef(null);
  useEffect(() => {
    fetchGroupsRef.current = fetchGroups;
  });
  const retryGroups = useCallback(() => fetchGroupsRef.current?.(), []);
  const groupsErrorState = useFetchErrorState({
    isError: Boolean(groupsError),
    error: groupsError,
    refetch: retryGroups,
  });


  const handleGroupClick = (group, e) => {
    // Navigate to group page instead of opening modal
    e?.preventDefault();
    router.push(`/groupHomePage?id=${encodeURIComponent(group.id)}`);
  };

  // WR-03: on TERMINAL identity-resolution failure, fetchGroups early-returns on
  // `!selfUuid` BEFORE its try/finally, so `loading` never clears — the spinner
  // below would hang forever and the in-list degrade banner further down is
  // unreachable beneath that loading return. Surface the compact degrade notice
  // HERE instead (banner where the list would be), mirroring the
  // groupHomePage/friends identity-error pattern. The header shell is kept so the
  // error state looks intentional, not a broken half-render.
  if (selfIdentityErrorState.showError) {
    return (
      <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card surface-flat-phone md:p-4 flex flex-col overflow-hidden h-full">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
          <h2 className="text-xl font-bold text-content-primary">Your Groups</h2>
          {onCreateGroup && (
            /* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the home surface's primary CTA (error-state render branch of the same CTA below). Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` floor (rejected, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text button.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup. */
            <button
              className="btn btn-primary text-sm whitespace-nowrap min-h-11"
              onClick={onCreateGroup}
              aria-label="Create new group"
              data-tutorial="create-group-btn"
            >
              + Create New Group
            </button>
          )}
        </div>
        <div className="py-8 px-4">
          <FetchErrorBanner state={selfIdentityErrorState} compact />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card surface-flat-phone md:p-4 flex flex-col overflow-hidden h-full">
        <div className="text-center py-8 px-4 text-content-muted">Loading groups...</div>
      </div>
    );
  }

  return (
    // POLL-02: FriendshipStatusProvider lifted to root layout — no longer
    // mounted here, since the nested instance was shadowing root state and
    // breaking friend-state sync between NotificationBell and friends page.
    //
    // DECISION Phase 87.8 (D-02/D-03): level assignment for the home chain — this
    // wrapper and the scrolling list div below are STRUCTURAL WRAPPERS (scroll
    // plumbing), flattened at phone via surface-flat-phone; the group card inside
    // is the depth-2 surface and the only element the user perceives as a surface.
    // Chosen OVER giving each nesting level its own ladder value, which would have
    // kept the chain at 44px per side and defeated the 75px budget. The same
    // flatten is applied to the loading/error-state renders of this wrapper so the
    // surface does not jump 16px when it transitions states. That is a decision,
    // not a cleanup.
    <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card surface-flat-phone md:p-4 flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <h2 className="text-xl font-bold text-content-primary">Your Groups</h2>
        {onCreateGroup && (
          /* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the home surface's primary CTA. Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor (rejected — would distort ~15 compact/icon `.btn` sites, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text button.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup. */
          <button
            className="btn btn-primary text-sm whitespace-nowrap min-h-11"
            onClick={onCreateGroup}
            aria-label="Create new group"
            data-tutorial="create-group-btn"
          >
            + Create New Group
          </button>
        )}
      </div>

      {/* D-08: if identity resolution permanently fails, per-group role
          affordances (Invite / settings) silently vanish — surface a compact,
          non-blocking degrade notice instead of failing silently (D-11). */}
      <FetchErrorBanner state={selfIdentityErrorState} compact />

      <div className="flex-1 overflow-y-auto surface-flat-phone md:p-4 pb-8 flex flex-col gap-4 max-md:max-h-[60vh]">
        {groupsErrorState.showError ? (
          <FetchErrorBanner
            state={groupsErrorState}
            title="We couldn't load your groups"
            reportContext="Your groups list (home page)"
          />
        ) : groups.length === 0 ? (
          /* DECISION Phase 88-18 (Req 6): this EmptyState's CTA is rendered IN ADDITION to the
             identical header button above, not instead of it — the opposite call to
             OpenPollsList/PromptScheduleManager, which suppress theirs. The difference is where
             the button lives: those two sit directly above the list body and read as a duplicate
             a finger-width away, whereas this one is persistent panel chrome in the bordered
             "Your Groups" header and is present in every state, including the error state.
             Removing the header button when empty would make the panel header change shape.
             The `data-tutorial="create-group-btn"` hook is DELIBERATELY not copied here — that
             selector must resolve to one element. */
          <EmptyState
            icon="Users"
            heading="No groups yet"
            body="A group is your people plus the games you play. Make one and invite them."
            action={
              onCreateGroup ? (
                <Button
                  variant="primary"
                  className="min-h-11"
                  onClick={onCreateGroup}
                  aria-label="Create new group"
                >
                  + Create New Group
                </Button>
              ) : undefined
            }
          />
        ) : (
          groups.map((group) => {
            // Get users from the group (Users array from backend)
            const groupUsers = group.Users || [];
            const lastEvent = group.Events?.[0]; // First event from the included events
            const lastGame = lastEvent?.Game;

            // Get user role - check both userRoles state and directly from group.Users
            let userRole = userRoles[group.id];
            if (!userRole && group.Users && selfUuid) {
              const userMember = group.Users.find(u => u.id === selfUuid);
              userRole = userMember?.UserGroup?.role || userMember?.role;
            }
            const canEdit = userRole === 'owner' || userRole === 'admin';
            // null when the group has no colour of its own — the inline
            // backgroundColor is then omitted so `bg-surface-card` wins (D-28).
            const bgColor = resolveGroupBackgroundColor(group.background_color);
            /*
             * DECISION Phase 88.3 (D-09, cascade fix): the card's ground is a
             * MUTUALLY EXCLUSIVE ternary — the themed surface class and its
             * hover class live ONLY in the no-colour branch, the tint pair ONLY
             * in the has-colour branch. Chosen OVER stacking the tint classes
             * alongside an always-present `bg-surface-card hover:bg-surface-hover`.
             *
             * WHY (compile-verified on this tree, tailwindcss@4.3.3): in
             * `@layer utilities` the emitted order is
             * `.bg-[var(--group-ground-light)]` (line 1426) <
             * `.bg-surface-card` (1543) < `.bg-surface-hover` (1558) <
             * `.hover:bg-surface-hover:hover` (2347) <
             * `.dark:bg-[var(--group-ground)]` (2894). Same property, same
             * specificity — source order wins — so stacking them renders the
             * WHITE card surface in light mode for every coloured group, and
             * only the `dark:` arm would work. Today's inline `style`
             * background hides this, because an inline style beats any class;
             * the moment the mechanism becomes a class the two cannot coexist.
             * The hover class is half of it: leaving it always-present would
             * flip a coloured card to the white hover surface on hover.
             *
             * ALSO REJECTED: gating on `bgColor` alone. `ground` is gated on
             * the TINT succeeding (T-88.3-43) so a malformed legacy hex
             * withholds BOTH custom properties together, never just the light
             * one. This is a decision, not a cleanup.
             */
            const tinted = lightTintGroupBackgroundColor(bgColor);
            const ground = tinted ? bgColor : null;
            const bgImage = group.background_image_url;
            // Wave-12 review follow-up (owner-ruled fix, 2026-08-21): gate the
            // overlay AND the white-text treatment on the VALIDATED style, not
            // the raw string. safeBgImageStyle drops relative/invalid URLs
            // (FSEC-03), so a truthy-but-invalid value used to render the 0.7
            // dim + white text over NO image — a solid near-black card (the
            // walk's /bgg-logo.png black-card mystery). Invalid URLs now
            // degrade to the plain color card.
            const bgImageStyle = safeBgImageStyle(bgImage);
            const hasBgImage = !!bgImageStyle;
            // The text treatment forks in the CSS cascade, exactly like the
            // ground above: the DARK half is computed against the stored hex,
            // the LIGHT half against the rendered tint. No `useTheme` — see the
            // shipped DECISION at EventScheduler.tsx (plan 15, Req 8).
            const cardTextDark = getTextStyle(hasBgImage, bgColor);
            const cardTextVars = themedTextStyleVars(
              cardTextDark,
              getTextStyle(hasBgImage, tinted || bgColor),
            );
            const cardTextBold = !!cardTextDark.fontWeight;
            const profilePic = group.profile_picture_url;

            return (
              <div
                key={group.id}
                className={`rounded-card p-3 pl-4 md:p-6 md:pl-7 shadow-theme-sm cursor-pointer transition-all duration-200 border border-line border-l-4 border-l-accent relative hover:-translate-y-0.5 hover:shadow-theme-md hover:border-l-accent-hover active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card hover:bg-surface-hover'}`}
                onClick={(e) => handleGroupClick(group, e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleGroupClick(group, e);
                  }
                }}
                style={{
                  ...(tinted && {
                    '--group-ground': ground,
                    '--group-ground-light': tinted,
                  }),
                  ...cardTextVars,
                  ...bgImageStyle,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {hasBgImage && (
                  // Phase 73-02 gave this overlay a semantic surface tint at 85%
                  // so the bg image dims and the title stays readable; that
                  // slash-opacity was inert on v3's var()-backed tokens and
                  // 87.7 D-18 stripped it rather than let v4 start rendering it
                  // (census: 87.7-OPACITY-CENSUS.md). The div was kept so the
                  // fix would be a class edit, not a structure change.
                  //
                  // DECISION Phase 88-27 (D-32 bucket D): the dim is now
                  // `--color-bg-overlay`, one of the three UI-SPEC §10.3
                  // exemplars. Chosen OVER restoring what 73-02 actually wrote —
                  // 85% of the CARD colour, which is near-WHITE in light mode.
                  // A group title over a background image is ALWAYS white text
                  // with a dark shadow, in both themes, unconditionally
                  // (colorUtils.js getTextStyle, the `hasBackgroundImage`
                  // branch). So a card-coloured wash in light mode would have
                  // put white text on a near-white ground — the overlay would
                  // have caused the illegibility it exists to prevent.
                  // `--color-bg-overlay` darkens in both themes, which is what
                  // white text needs. Re-deriving this from the card surface is
                  // a decision that breaks light mode, not a fidelity fix.
                  //
                  // The `{bgImage && …}` gate is deliberate and unchanged: this
                  // never renders for colour-only cards, whose title takes a
                  // contrast-computed pole instead and needs no dim.
                  <div className="absolute inset-0 z-0 rounded-card bg-[var(--color-bg-overlay)]" />
                )}
                <div className="relative z-1">
                  {/* 87.8-13 walkthrough F-8: single row at ALL widths — the old
                      max-[480px] column-stack dropped the players pill to its own
                      right-justified line under a left-aligned card (owner call).
                      Long names still coexist with the pill: min-w-0 + wrap. */}
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {profilePic && (
                        <div className="w-10 h-10 rounded-full bg-surface-card-hover flex items-center justify-center text-2xl shrink-0 overflow-hidden">
                          {profilePic.startsWith('http') || profilePic.startsWith('/') ? (
                            <SafeImage
                              src={profilePic}
                              alt={group.name}
                              fallbackIcon="👥"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>{profilePic}</span>
                          )}
                        </div>
                      )}
                      {/* The inline `color`/`textShadow`/`WebkitTextStroke` keys
                          are GONE on purpose: an inline declaration beats a
                          `dark:` class, so the fork only works if they are
                          absent rather than merely overridden. `text-content-primary`
                          is gone for the same reason it was always redundant here
                          — the no-colour half of the fork already resolves to
                          `var(--color-content-primary)`. */}
                      <h3
                        className="text-[1.1rem] font-semibold flex-1 min-w-0 wrap-break-word max-md:text-base [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]"
                      >
                        {group.name}
                      </h3>
                    </div>
                    {/* DECISION Phase 88-22 (D-28): the players pill does NOT take
                        the group's text style, unlike its three siblings in this
                        card. It paints its OWN surface (`bg-btn-primary`), so it
                        must use that surface's paired token — the group style is
                        computed against the CARD's ground, and applying it inline
                        beat `text-btn-primary-text` and put slate text on purple
                        for any colourless group. Chosen OVER keeping the sibling
                        symmetry. Re-adding the inline style is a decision, not a
                        cleanup. */}
                    <span
                      className="bg-btn-primary text-btn-primary-text px-2.5 py-0.5 rounded-xl text-xs font-semibold ml-2 shrink-0"
                    >
                      {groupUsers.length} {groupUsers.length === 1 ? 'player' : 'players'}
                    </span>
                  </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {groupUsers
                    .filter((member) => member.id !== selfUuid)
                    .slice(0, 4)
                    .map((member, index) => (
                      <span key={member.id || index} className="bg-surface-card-hover text-content-secondary px-2 py-1 rounded-md text-[0.8rem] border border-line">
                        <ClickableMemberName userId={member.id} username={member.username || member.email} />
                      </span>
                    ))}
                  {groupUsers.filter((member) => member.id !== selfUuid).length > 4 && (
                    <span className="bg-surface-card-hover text-content-muted px-2 py-1 rounded-md text-[0.8rem] border border-line font-medium">
                      +{groupUsers.length - 5} more
                    </span>
                  )}
                </div>

                {/* 87.8-13 walkthrough F-9: name + date on ONE line (owner call —
                    the stacked date read as a stray row). flex-wrap keeps long
                    game names graceful: the date wraps as a unit, never mid-text. */}
                {/* DECISION Phase 88.3 (R2-6): on a TINTED card this row uses
                    `text-content-primary` for both spans, chosen OVER today's
                    `text-content-secondary` / `text-content-muted`.

                    WHY, measured against the eight t = 0.70 tints:
                    `text-content-secondary` (warm-600) 3.4-3.6:1 and
                    `text-content-muted` (warm-550) 2.8-3.0:1 both FAIL 4.5:1 —
                    only `#374151`-and-darker clears it, and
                    `text-content-primary` is the token that does. The
                    uncoloured card is untouched: its ground is the themed
                    surface those two tokens were designed against, so keeping
                    them there is correct and converging the two would be the
                    error. REJECTED: leaving today's tokens on a tinted ground.
                    This is a decision, not a cleanup. */}
                <div className={`border-t border-line pt-3 [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] ${cardTextBold ? 'font-semibold' : ''}`}>
                  <div className={`flex flex-wrap items-baseline gap-x-2 text-sm ${tinted ? 'text-content-primary' : 'text-content-secondary'}`}>
                    <span><strong className="text-content-primary">Last Game:</strong> {lastGame?.name || 'None'}</span>
                    <span className={`text-xs ${tinted ? 'text-content-primary' : 'text-content-muted'}`}>
                      {formatDate(lastEvent?.start_date || lastEvent?.createdAt, timezone)}
                    </span>
                  </div>
                </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-3 relative z-2">
                    {/* Phase 69 CONTEXT D-INV-03: any active member can invite
                        (FriendInvitePanel exposes QR + link to all roles); only
                        the Reset invite link button inside FriendInvitePanel is
                        admin-only (D-INV-02). The settings cog below stays
                        admin-gated via `canEdit`. */}
                    {userRole && userRole !== 'pending' && (
                      /* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census — per-card primary CTA on the walked home surface. Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` floor (rejected, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: `flex-1` full-row width.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup. */
                      <button
                        className="btn btn-primary text-sm flex-1 shadow-md hover:shadow-lg transition-all min-h-11"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onGroupSelect) {
                            onGroupSelect(group);
                          }
                        }}
                        aria-label="Invite member to group"
                      >
                        Invite Member
                      </button>
                    )}
                    {canEdit && (
                      /* DECISION Phase 88.3-16 (owner ruling 2, research-checked 2026-08-27):
                         the cog takes plan 14's secondary-control recipe as plain utilities —
                         `bg-btn-secondary dark:bg-surface-elevated` (warm-200 fill in light; dark
                         restored byte-identical to what shipped) plus `border border-line-control`
                         (warm-300). Req 12 test 7 named this control: in light it was #ffffff on a
                         white card with no edge at all.

                         IT TAKES A BORDER WHILE MANAGE MEMBERS TAKES A RING, and that difference is
                         deliberate rather than drift: this element does NOT carry `.btn`, so the
                         unlayered `.btn { border: none }` reset never reaches it and an ordinary
                         border utility works; `groupHomePage/page.js`'s Manage Members IS a `.btn`
                         and can only get an edge through `box-shadow`. Both resolve to the SAME
                         `--color-border-control` token, so the two render identically despite the
                         different mechanism. No `dark:border-0` is needed or wanted —
                         `--color-border-control` is declared `transparent` in the `.dark` block
                         (`globals.css`), so the border self-cancels there. D-35 requires the colour
                         in the same class string as the width, which `border border-line-control`
                         satisfies.

                         THIS ELEMENT SITS ON TWO GROUNDS, and the earlier "it is white on white"
                         reading was only half true. Its parent is the group card above, whose
                         className is `tinted ? 'bg-[var(--group-ground-light)] …' : 'bg-surface-card
                         …'` — so for every COLOURED group the cog's light ground is the tint. Both
                         measured 2026-08-27 with `src/lib/wcag.ts`:
                           - on the WHITE (uncoloured) card: fill warm-200 vs #ffffff = 1.306, ring
                             warm-300 vs the fill = 1.222, ring vs the white card = 1.595;
                           - on the eight t = 0.70 tints: fill 1.395 (Forest) - 1.477 (Wine), ring
                             1.141-1.209. SEVEN of the eight fill pairings land ABOVE the 1.40 fill
                             band top (only Forest, 1.395, is inside it). That is DISCLOSURE, not a
                             failure: the band bounds a fill against its ground for legibility and
                             more separation is not a defect. Nothing landed below the 1.05 floor, so
                             the reserved `bg-white/80` wash substitution was not triggered.

                         THE DIRECTION OF TRAVEL, stated because it is the uncomfortable half:
                         today's white cog reads ~1.82-1.93 against the tint; the warm-200 fill reads
                         ~1.39-1.48. So on a COLOURED card this change LOWERS the cog's separation
                         from its ground (~1.88 -> ~1.44) while RAISING it on the white card the
                         owner's complaint was actually about, and on the tint the border is an inner
                         edge rather than a boundary. That trade is the point of one recipe.

                         REJECTED:
                           - FORKING THE COG'S OWN className on `tinted` (keep `bg-surface-elevated`
                             when tinted, take `bg-btn-secondary` only in the null branch). It is
                             legal here — the cog is not part of the card's exclusion ternary that
                             Gate B test 3 pins — but it makes ONE control render two different
                             recipes on one screen, and there is no owner ruling for that.
                           - the `bg-white/80` WASH Manage Members takes. Held in reserve by the
                             STOP rule above; not needed, because no tinted pairing fell below 1.05.
                           - a >= 3:1 neutral border (`border-line-strong` / warm-500) — 0 of 13
                             shipped systems do it; see the survey.

                         TARGET SIZE — disclosed, deliberately NOT fixed here (owner ruling
                         2026-08-27). `px-3 py-1 text-sm` around a single emoji glyph is ~28px tall
                         on a phone, under the project's 44x44 floor (CLAUDE.md, Phone-Forward
                         Design). It is not a `.btn`, so D-36's phone-only `.btn { min-height:
                         2.75rem }` does not reach it, and the 87.8 D-13/D-14 markers in this file
                         cover the two `btn btn-primary` CTAs, not this. The recorded fix is the
                         per-CTA `min-h-11` pattern (D-13); adding it here reflows the card header,
                         which is a layout change nobody has looked at on a phone. PHASE 88.6 owns
                         it under the `Button` migration (entry in `.planning/deferred/phase-88.6.md`).

                         Any of this is a decision, not a cleanup. */
                      <button
                        className="px-3 py-1 bg-btn-secondary dark:bg-surface-elevated border border-line-control text-content-primary rounded-btn hover:bg-surface-hover active:opacity-75 text-sm shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsGroup(group);
                        }}
                        aria-label="Customize group"
                        title="Customize group"
                      >
                        ⚙️
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      
      {settingsGroup && (
        <GroupSettings
          group={settingsGroup}
          user={authUser}
          userRole={userRoles[settingsGroup.id] || (selfUuid && settingsGroup.Users?.find(u => u.id === selfUuid)?.UserGroup?.role)}
          onClose={() => setSettingsGroup(null)}
          onUpdate={() => {
            fetchGroups();
            setSettingsGroup(null);
            // Notify parent to refresh calendar
            if (onGroupSettingsUpdated) {
              onGroupSettingsUpdated();
            }
          }}
          onGroupDeleted={() => {
            fetchGroups();
            setSettingsGroup(null);
            // Notify parent to refresh calendar
            if (onGroupSettingsUpdated) {
              onGroupSettingsUpdated();
            }
          }}
          // DECISION Phase 88.2 AF-6: navigate to the group's home page, chosen
          // OVER mounting a second ManageMembers instance here (that modal is
          // imported in exactly one place — duplicating 650 lines and its member
          // refetch lifecycle onto a surface this phase does not otherwise touch),
          // and OVER leaving the prop absent, which renders BOTH transfer
          // affordances in GroupSettings permanently greyed out and leaves
          // SPEC-REQ-5's route-to-transfer unmet on the home page. Cost, weighed
          // and accepted: one extra tap — the owner lands on the group page and
          // opens Manage Members there instead of going straight into the modal.
          // This also revives the pre-existing "Open Manage Members to transfer"
          // button, dead on this surface since it shipped for the same reason.
          onOpenManageMembers={() => {
            // Read the id BEFORE clearing the state — the setter and the push are
            // in the same handler, and reading settingsGroup.id after it is the
            // kind of thing that survives review and breaks on a refactor.
            const id = settingsGroup.id;
            setSettingsGroup(null);
            router.push(`/groupHomePage?id=${id}`);
          }}
        />
      )}
    </div>
  );
};

export default GroupList;