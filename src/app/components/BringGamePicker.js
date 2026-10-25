'use client';

import { useState, useEffect, useRef } from 'react';
import { userGamesAPI, eventBringsAPI } from '../../lib/api';
import SafeImage from './SafeImage';
import { Modal } from './Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { logger, errCtx } from '@/lib/logger';
import { useSelfIdentity } from '@/lib/hooks/useSelfIdentity';

/* Phase 88.6-44 (T-88.6-142, WCAG 4.1.3): the sr-only announcement copy for the load path.
   AUTHORED, NOT RATIFIED — UI-SPEC §6.1 carries no entry for a loading announcement; both
   strings are recorded in `88.6-44-SUMMARY.md` as authored copy. Neither is VISIBLE (the regions
   below are `sr-only`), which is why authoring them here does not breach P1. The count in the
   loaded string is the array length, never backend text.
   AMENDED Phase 88.6.1-14 (D-32 R6, copy row E9): the zero-count announcement is now the ratified
   E9 sentence, ONE constant (`EMPTY_COLLECTION_LINE`) shared with the visible empty line.
   AMENDED Phase 88.6.1-14 (owner ruling 2026-10-05, wording batch 5 row Q): the owner ratified the
   loading line (`LOADING_ANNOUNCEMENT`) and the non-zero count line (`loadedAnnouncement`'s
   non-zero arm) AS SHIPPED on 2026-10-05, so the "not ratified" statement above is history, not
   current state; both are byte-unchanged and pinned by the picker test (J2); changing either is an
   owner wording decision (D-31), not a cleanup. */
const LOADING_ANNOUNCEMENT = 'Loading your games...';
const EMPTY_COLLECTION_LINE = "You haven't added any games to your collection yet.";
const IDENTITY_FAILURE_LINE = "We couldn't load your games. Close this and try again.";
const loadedAnnouncement = (count) =>
  count === 0 ? EMPTY_COLLECTION_LINE : `${count} ${count === 1 ? 'game' : 'games'} loaded.`;

/**
 * BringGamePicker - Modal overlay for selecting games to bring to an event
 *
 * @param {boolean} isOpen - Controls modal visibility
 * @param {Function} onClose - Called when user closes or skips
 * @param {string} eventId - UUID of the event
 * @param {object} self - Resolved self-identity row from useSelfIdentity
 *   ({ id: <Users.id UUID>, user_id: <the SAME UUID via the PR-C toSelfWire
 *   alias>, ... }). Phase 87.3-04: my-brings preselect keys on `self.id` vs
 *   the nested `bring.User.id` UUID (D-04). The getOwnedGames server call
 *   passes `self.user_id` (now the UUID) — the owned-games route's self-gate
 *   accepts EITHER of the caller's own identifiers (sub OR Users.id UUID,
 *   both JWT-resolved; dual-armed in PR-C), so the arg shape stays valid.
 * @param {Function} onSave - Called after successful save (triggers BringSummary refetch)
 */
export default function BringGamePicker({ isOpen, onClose, eventId, self, onSave }) {
  const [ownedGames, setOwnedGames] = useState([]);
  const [selectedGameIds, setSelectedGameIds] = useState(new Set());
  const [othersBringing, setOthersBringing] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /* DECISION Phase 88.6-44 (T-88.6-142, WCAG 4.1.3 Status Messages): TWO announcement states
     feeding TWO always-mounted `sr-only` <StatusRegion>s below — one FIXED `polite`, one FIXED
     `assertive` — chosen OVER one region with a `politeness` derived from the outcome. A derived
     politeness mutates `role` / `aria-live` on a live node (the primitive's `role`/`aria-live` pair
     derived from `politeness` in `StatusRegion.tsx`), which assistive tech does not reliably
     re-read; two fixed-politeness regions is the shipped shape (the profile page's two
     notification `StatusRegion`s, `politeSaveAnnouncement` / `assertiveSaveAnnouncement` in
     `userProfile/page.js`). Both start EMPTY: the primitive's contract is empty-first (its
     EMPTY-FIRST docblock bullet in `StatusRegion.tsx`), and a region that mounts already
     populated announces nothing.
     `loadError` is the VISIBLE half of the load failure — the copy the list slot paints instead
     of the empty-collection line — and it is a string rather than a flag so the visible branch
     and the assertive region render the SAME ratified sentence. It carries NO live role of its
     own: one failure, one announcement (UI-SPEC §6.2).
     AMENDED Phase 88.6.1-14 (D-42): "a region that mounts already populated announces nothing"
     holds for the POLITE region only. An alert-role region inserted together with its text IS
     announced (ARIA 1.2's alert role; the TetraLogical 2024 matrix incl. VoiceOver iOS — AT-4).
     The assertive region still starts empty for the clear-then-set reason `handleClose` records.
     An identity failure (E10, below) reaches it by TWO real paths (scoped check H-07):
     (1) REOPEN AFTER A FAILURE. The picker is always mounted (both hosts render it
     unconditionally and flip `isOpen`), so its identity observer lives as long as the picker does
     and nothing refetches on open; the query is still in its error state at the open commit, so
     the open subtree MOUNTS the assertive region already carrying E10 (arm I6). That this mount is
     announced is [ASSUMED]: AT-4 found an alert-role region inserted with its text announced on
     every engine it read (ARIA 1.2's creation sentence, WebKit's live-region code, the
     TetraLogical 2024 matrix, "All announced" for VoiceOver iOS), but whether shipping iOS Safari
     runs the managed path is UNVERIFIED there, MDN dissents without data, and nobody measured an
     alert mounting inside a dialog whose opening moves focus in the same commit. The check is
     routed to plan 88.6.1-57's Not-staged-by-hand list (Event page — Games to Bring reopened),
     which never records it as heard; it stays [ASSUMED] until a by-hand staging is found. Arm I6
     pins the mounted TEXT, not the announcement. A clear-then-set on open (mount empty, then set
     E10) would avoid the assumption, but it is a deliberate design change, not made here.
     (2) OPEN WHILE IDENTITY IS RESOLVING, or a retry of the errored query from another consumer.
     The region is already mounted and empty while the query is pending (a fetch of a data-less
     query resets it to pending with no error — TanStack query-core's `fetchState`), and E10 is
     SET into it when the fetch fails: a change, announced like any other (arms I2, I3). */
  const [politeAnnouncement, setPoliteAnnouncement] = useState('');
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState('');
  const [loadError, setLoadError] = useState('');
  /* Dismissal generation for the SAVE path (the load path has the effect's `cancelled` flag).
     `handleSave` is a handler, not an effect, so nothing cancels its continuation when the
     person presses Esc mid-save: a rejection landing after `handleClose` cleared the regions
     would re-populate the assertive one PAST that clear, and the next open would mount it
     already populated — silent. The catch compares the generation it captured at start. */
  const dismissGenerationRef = useRef(0);
  // 88.6.1-14 (D-35): the Save press latch — see the AMENDED (D-35) note at the Save control.
  // A REF, not the `saving` state: a state write does not land before a second synchronous
  // press dispatches.
  const saveInFlightRef = useRef(false);
  /* DECISION Phase 88.6.1-14 (D-09b, AC-30; copy row E10, D-33 row 23): the identity failure is
     read from the SHARED identity query (the page's cached entry — no extra request while it
     holds data), chosen OVER a new prop from both hosts (the fix would move into the game page,
     which later plans of this phase own), OVER editing the fetch effect below (Phase 89's fence,
     `.planning/deferred/phase-89.md`, the BringGamePicker performance entry), and OVER copying the
     condition into the announcement state from an effect (a second copy of a fact the query
     already holds, which can go stale across a retry). E10 is a FIXED line — no error object
     exists for "identity unknown", and the query's error text is never shown. Only the query's
     ERROR state counts: a query still resolving keeps the spinner, and an error with a cached
     row (`self` present) is not a failure here. A new observer of an errored identity query makes
     TanStack retry it once on mount (retryOnMount, query-core 5.101.1) — the same behaviour every
     other `useSelfIdentity()` consumer already has; for this picker that mount is its host
     page's mount (both hosts render it unconditionally), never an open. Changing this is a
     decision, not a cleanup. */
  const { query: selfIdentityQuery } = useSelfIdentity();

  useEffect(() => {
    // Phase 87.3-04: gate the fetch on identity resolution — `self` is undefined
    // while useSelfIdentity is still resolving; the effect re-runs when it lands
    // (self in the dep array), so my-brings preselect never evaluates against an
    // unresolved identity (indeterminate, never "not mine").
    if (!isOpen || !eventId || !self?.user_id) return;

    let cancelled = false;

    async function fetchData() {
      /* DECISION Phase 88.6-44 (T-88.6-142): the loading announcement is SET HERE, as the first
         statements inside `fetchData`, chosen OVER deriving the polite message from `loading`.
         `loading` initialises to `true` and the whole subtree returns `null` while closed, so
         on the open commit the region would mount ALREADY populated with the derived text — a
         mount, not a change, and live regions announce changes. Setting it after the identity
         guard above (`self?.user_id`) is what turns "loading" into a DOM mutation the reader
         hears. The failure state (visible + announced) is RESET on every new fetch so a
         successful retry never paints the failure branch over a fresh list, and so an identical
         second failure is a real change rather than a React bail-out. */
      setLoadError('');
      setAssertiveAnnouncement('');
      setPoliteAnnouncement(LOADING_ANNOUNCEMENT);
      setLoading(true);
      try {
        const [gamesRes, bringsRes] = await Promise.all([
          // Server-call ARG is self.user_id — post-PR-C the Users.id UUID
          // (toSelfWire alias). The owned-games route's self-gate accepts both
          // of the caller's own identifiers (sub OR UUID); not an is-me compare.
          userGamesAPI.getOwnedGames(self.user_id),
          eventBringsAPI.getEventBrings(eventId),
        ]);

        if (cancelled) return;

        // Extract games from the owned games response
        const games = Array.isArray(gamesRes) ? gamesRes : (gamesRes?.games || []);
        setOwnedGames(games);

        // Process brings to find what this user already has and what others are bringing
        const brings = Array.isArray(bringsRes) ? bringsRes : (bringsRes?.brings || []);

        // Pre-select games the user already has marked
        const myGameIds = new Set();
        const othersCount = {};

        for (const bring of brings) {
          // Phase 87.3-04 (D-04): "mine" = nested User.id UUID === self.id UUID.
          if (bring.User?.id === self.id) {
            myGameIds.add(bring.game_id);
          } else {
            othersCount[bring.game_id] = (othersCount[bring.game_id] || 0) + 1;
          }
        }

        setSelectedGameIds(myGameIds);
        setOthersBringing(othersCount);
        setPoliteAnnouncement(loadedAnnouncement(games.length));
      } catch (err) {
        /* DECISION Phase 88.6-33 (AC-2 WIDENED 2026-09-09; level AMENDED by the D2 ruling
           2026-09-13): `logger.info` — a Sentry BREADCRUMB — over `logger.error`, AC-2's
           original uniform arm, which was rejected because it buys Session Replay volume the
           `no-console` milestone gate never asked for. `logger.warn` is not a cheaper arm
           (`Sentry.captureMessage`, src/lib/logger.ts ("Sentry.captureMessage(msg"), is also an event). Egress delta
           versus today: NIL — with no `captureConsoleIntegration` in `sentry.client.config.js`
           this was already a breadcrumb and stays one.
           `errCtx(err)` and never the raw `Error`: `info`'s second parameter is
           `ctx?: Record<string, unknown>` (src/lib/logger.ts ("info(msg: string, ctx?: Record<string, unknown>)")) and `checkJs: false` hides
           that mistake at a `.js` call site. Converted IN PLACE — a catch inside an async
           effect, not a render body, so no latch is required.
           RECORDED, NOT FIXED (this commit's scope is the channel and the sweep): this path
           reports NOTHING to the person. The picker is left showing an empty selection as
           though nothing were bringable. Routed to `.planning/deferred/phase-88.6.md`.
           FIXED Phase 88.6-44 (T-88.6-142) — the person-facing half only; the CHANNEL stays
           `logger.info`, breadcrumb-only, per the D2 ruling (recorded in `88.6-44-SUMMARY.md`
           for plan 46's ledger). The breadcrumb fires BEFORE the `cancelled` guard on purpose,
           the `EventDayModal.js` W16 shape: a breadcrumb is not context, so a late rejection
           still reports while writing no state. */
        logger.info('BringGamePicker: failed to load data', errCtx(err));
        if (cancelled) return;
        /* The visible branch and the assertive region carry the SAME sentence, resolved through
           the ratified register (`getFetchErrorMessage` -> `MESSAGE_BY_CODE`), chosen OVER
           minting a picker-specific line: a visible string with no UI-SPEC §6.3 row is not an
           executor's to author (P1), and the register already turns a code into copy without
           ever interpolating `err.message` — `extractErrorMessage` (`api.ts`) returns raw
           backend prose and `StatusRegion` renders verbatim, so the caught error's text must
           never reach either node (ASVS V7.4.1, the user-facing twin of `logger.ts`'s
           T-84-01). The polite region is cleared so "Loading" does not linger beside "failed". */
        const copy = getFetchErrorMessage(err);
        setLoadError(copy);
        setPoliteAnnouncement('');
        setAssertiveAnnouncement(copy);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [isOpen, eventId, self?.user_id, self?.id]);

  if (!isOpen) return null;

  // 88.6.1-14 (AC-30): see the DECISION at the identity read. `failureLine` is whichever failure
  // the list area shows first — E10 for an identity failure, the load error otherwise.
  const identityFailed = !self?.user_id && selfIdentityQuery.isError;
  const failureLine = identityFailed ? IDENTITY_FAILURE_LINE : loadError;

  /* DECISION Phase 88.6-44 (T-88.6-142): a LOCAL `handleClose` that EVERY dismissal routes
     through — `Modal`'s `onClose` (where Radix funnels Esc, outside-click and the header close
     control into one call, the `createGroup.js` `DECISION Phase 88-33` precedent), the
     Skip-for-now button, and `handleSave`'s success path — chosen OVER clearing the regions at
     the Skip button alone. Esc is the dominant dismissal on a phone-primary surface; a
     Skip-only clear would leave the assertive region populated across a close, so the NEXT
     identical failure sets identical text — a React bail-out, no DOM change, no announcement
     (the profile page records the same mechanism in its note "a React state bail-out — announced
     once, silent forever after", `userProfile/page.js`). The visible failure copy is
     cleared here too so a reopened picker never paints last time's failure over a fresh fetch.
     Re-pointing any of the three sites straight at the `onClose` prop is a decision, not a
     cleanup. */
  const handleClose = () => {
    dismissGenerationRef.current += 1;
    setPoliteAnnouncement('');
    setAssertiveAnnouncement('');
    setLoadError('');
    onClose();
  };

  const toggleGame = (gameId) => {
    setSelectedGameIds(prev => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.add(gameId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    // 88.6.1-14 (D-35): the first-line press latch; released in `finally`.
    if (saveInFlightRef.current) return;
    // Phase 88.6-57 (CR-101): refuse unless the selection came from a SUCCESSFUL load. The PUT
    // is a FULL REPLACE, and until the load lands `selectedGameIds` is the initial empty Set
    // (or a stale one from a previous open) — saving it wipes the person's brings. The refusal
    // lives HERE so it holds whatever the control's disabled idiom becomes.
    if (loading || loadError || identityFailed) return;
    saveInFlightRef.current = true;
    const generation = dismissGenerationRef.current;
    // Cleared at the START so a second identical failure is a real change (the
    // `NextGameNightCard` / `RsvpSection` clear-then-set idiom, UI-SPEC §6.3).
    setAssertiveAnnouncement('');
    setSaving(true);
    try {
      await eventBringsAPI.updateMyBrings(eventId, Array.from(selectedGameIds));
      onSave?.();
      handleClose();
    } catch (err) {
      /* 88.6-33 (AC-2 WIDENED / D2 level ruling): `logger.info` + `errCtx(err)` — the same
         call as the load path above, for the same reasons. Converted IN PLACE (a catch inside
         an async handler).
         RECORDED, NOT FIXED: this catch is reached with `onSave?.()` and `onClose()` SKIPPED —
         they sit above it inside the `try` — so the modal simply stays open with no error
         state, no toast and no live region, and the person cannot tell whether their brings
         were saved. Routed to `.planning/deferred/phase-88.6.md` together with the load path;
         changing the failure BEHAVIOUR is work this commit does not own.
         FIXED Phase 88.6-44 (T-88.6-142) — the ANNOUNCED half: the assertive region below now
         carries the ratified register sentence, so a screen-reader user hears that the save
         failed and the modal stayed open. The channel stays `logger.info` (D2, recorded for
         plan 46). What this does NOT do, recorded rather than hidden: paint anything a SIGHTED
         person can see. UI-SPEC §6.2 routes a modal-submit failure to `toast.error`, which is
         visible AND announces through Sonner — but that would be a SECOND live region for one
         failure beside the assertive region plan 44 pins, and §6.2 forbids two. The visible
         half is a named residual in `88.6-44-SUMMARY.md`, owner plan 46 / UI review. */
      logger.info('BringGamePicker: failed to save', errCtx(err));
      if (generation !== dismissGenerationRef.current) return;
      setAssertiveAnnouncement(getFetchErrorMessage(err));
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  // Filter games by search query (case-insensitive)
  const filteredGames = ownedGames.filter(item => {
    const game = item.Game || item;
    const name = game.name || game.title || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    /* DECISION Phase 88-17 (Req 9): hosted on the shared <Modal>; the hand-rolled
       backdrop + `handleBackdropClick` target-compare are gone rather than ported
       (Radix owns outside-dismiss, Esc and the focus trap).

       The overlay's `p-4` is DELETED, not relocated: it was ALWAYS dead when it was
       removed — the unlayered legacy overlay rule in globals.css then declared
       `padding: 1rem`, and an unlayered author rule beats every `@layer utilities`
       rule. That legacy rule was itself DELETED later, by Phase 88-31; the amended
       `DECISION Phase 87.8 DEC-3` marker in `globals.css` records the deletion
       (re-pointed 88.6.1-14). So removing the `p-4` was not a spacing change and
       must not be read as one.

       The search row stays PINNED above the scrolling list (Modal.Body is `p-0` +
       flex column, the list owns the scroll with `min-h-0`). Collapsing it into a
       single scrolling body would push the search field off-screen as soon as the
       list scrolls — that is a decision, not a cleanup. */
    /* DECISION Phase 88.6.1-56 (W023 class): CHOSEN — the 80% height cap is kept (this dialog's
       own choice) and its unit is the DYNAMIC viewport unit the shared primitive
       (`Modal.tsx`, `DECISION Phase 88.6-08`) and the day dialog (plan 88.6.1-47) use, so the
       dialog's bottom and its Save button never sit under a phone's browser toolbar.
       REJECTED: dropping the override (the dialog would grow to the primitive's 90%, a visible
       change) and keeping the static unit (W023's defect). Changing this is a decision, not a
       cleanup. */
    <Modal open onClose={handleClose} className="max-w-md max-h-[80dvh]">
      <Modal.Header>Games to Bring</Modal.Header>
      <Modal.Body className="flex flex-col p-0 md:p-0">
        {/* Phase 88.6-44 (T-88.6-142): the two always-mounted announcement regions — see the
            DECISION at the state declarations. `sr-only` is LOAD-BEARING: `StatusRegion` is
            visible by default (`text-sm`, the `cn('text-sm', className)` call in `StatusRegion.tsx`), and without it the loading
            copy would render beside the spinner and the loaded count above the list — a visible
            delta on a UI-SPEC-gated phase. Layout-safe: `sr-only` is absolutely positioned and
            this Body has no `gap`/`space-y`, so two empty divs add nothing. First children on
            purpose, ahead of the search row. */}
        <StatusRegion className="sr-only" message={politeAnnouncement} />
        <StatusRegion
          className="sr-only"
          politeness="assertive"
          message={identityFailed ? IDENTITY_FAILURE_LINE : assertiveAnnouncement}
        />
        {/* Search */}
        <div className="shrink-0 p-4 pb-2">
          {/* DECISION Phase 88.6-44 (T-88.6-124, house rule src/components/ui/Input.tsx ("HOUSE RULE (88-33 Task 8, fork 5")): `id` + `name` +
              an ARIA-supplied name, chosen OVER a visible <label> row above the field. The
              house rule allows `aria-label` alone only where a visible label genuinely cannot
              exist, and here it cannot in THIS phase: a visible "Search" line is NEW VISIBLE
              COPY with no UI-SPEC §6.3 row (P1 forbids an executor minting it) and a new
              visible row on a `max-h-[80dvh]` dialog whose list owns the scroll — ~24px of list
              height at 375px on a phone-primary surface, an unsanctioned look delta. The
              `aria-label` mirrors the placeholder so sighted and spoken names agree. `id`/`name`
              are present regardless: the autofill heuristic does not read ARIA. Adding a visible
              label later is a copy decision for the owner, not a cleanup. */}
          <Input
            type="text"
            id="bring-game-search"
            name="bring-game-search"
            aria-label="Search your games"
            placeholder="Search your games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Game List */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {failureLine ? (
            /* Phase 88.6-44 (T-88.6-142): the load-FAILURE branch, checked BEFORE the empty
               branch (UI-SPEC §6.2: an empty state must never render on a fetch failure). Until
               this branch existed a failed load fell through to "You haven't added any games…",
               which is FALSE on a failed load and sends a person to re-add games they own. NO
               `role` here — the assertive region above is this failure's single announcement.
               Not <FetchErrorBanner>: it composes its own live regions (`Banner` + a polite
               `StatusRegion`) and would double-announce one failure. Error ink, not the empty
               state's muted ink, so the two branches are visibly distinct as well.
               AMENDED Phase 88.6.1-14 (AC-30): this box is now checked FIRST, ahead of the spinner,
               and shows whichever failure applies — E10 for an identity failure, the load error
               otherwise; still no role of its own. Safe for the load error because the load path
               never holds a failure and the in-flight flag together: a new run clears the error
               before setting the flag in one synchronous block, a failed run sets the error and
               clears the flag in one continuation, and a cancelled run sets neither. */
            <div className="text-center py-8">
              <p className="text-content-status-error text-sm">{failureLine}</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
            </div>
          ) : ownedGames.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-content-muted text-sm">{EMPTY_COLLECTION_LINE}</p>
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-content-muted text-sm">No games match your search</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGames.map(item => {
                const game = item.Game || item;
                const gameId = game.id;
                const gameName = game.name || game.title || 'Unknown Game';
                const thumbnail = game.thumbnail_url || game.thumbnail || game.image_url;
                const isSelected = selectedGameIds.has(gameId);
                const othersCount = othersBringing[gameId] || 0;

                return (
                  /* DECISION Phase 88.6-44 (T-88.6-124, WCAG 4.1.2): `role="checkbox"` +
                     `aria-checked` on the row, chosen OVER `aria-pressed`. Until this edit the
                     selected state lived ONLY in classes and a glyph — a plain <button> with no
                     programmatic state, which axe-core 4.12.1 has no rule to see. The visual IS
                     a checkbox and the interaction is multi-select, so "checkbox, checked" is
                     the truthful announcement; "toggle button, pressed" (aria-pressed, the
                     house idiom for ARMING a two-tap action) describes a different interaction.
                     The native <button> is kept underneath for Enter/Space and focus; `checkbox`
                     is an allowed role on it (ARIA in HTML). Under this role the row falls under
                     axe's `aria-toggle-field-name`, so its NAME is now audited too — see the
                     thumbnail note below. Going back to a bare button is a decision. */
                  <button
                    key={gameId}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    /* NAME = the game name alone (`aria-labelledby` -> the visible name line);
                       the "N others bringing this" line is the DESCRIPTION. Measured before this
                       edit: name-from-content read "Catan 1 other bringing this" — a count that
                       changes as members respond was part of the checkbox's NAME. */
                    aria-labelledby={`bring-game-name-${gameId}`}
                    aria-describedby={othersCount > 0 ? `bring-game-others-${gameId}` : undefined}
                    onClick={() => toggleGame(gameId)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                      isSelected ? 'bg-surface-muted border border-accent' : 'hover:bg-surface-hover border border-transparent'
                    }`}
                  >
                    {/* Thumbnail — DECORATIVE, and hidden from the row's NAME on all three
                        branches. Before this edit `alt={gameName}` on a 32px thumbnail made
                        name-from-content read the game name TWICE ("Catan Catan"). The `<img>`
                        now carries an EMPTY `alt`, and the well is `aria-hidden` on top of it.
                        THE `SafeImage` CAVEAT, recorded because it is real and non-obvious:
                        `SafeImage.js` forwards an empty `alt` correctly on the `<img>` path
                        (`alt={alt || ''}`) — but on its PLACEHOLDER path (`onError`, or a URL the
                        allow-list rejects) it substitutes `aria-label={alt || 'Image placeholder'}`
                        on a `role="img"` node, so an empty `alt` there would put "Image
                        placeholder" INTO the row's name. The `thumbnail ?` guard around this
                        branch does not close that hole — `SafeImage` can still take its
                        placeholder path with a truthy `src` — which is why the well itself is
                        `aria-hidden`: whichever of the three renderings lands inside it, the
                        name is the visible label alone. Do NOT copy `alt=""` to a `SafeImage`
                        site without this guard. (`getColorFromText('')` resolves to the muted
                        well colour — the same ground as the `?` glyph branch below — so the
                        broken-URL fallback loses nothing visible; src/app/components/QuickSuggestions.js ("also routes") (`getColorFromText`)
                        records the same routing.) */}
                    <div aria-hidden="true" className="w-8 h-8 rounded-sm shrink-0 overflow-hidden bg-surface-muted">
                      {thumbnail ? (
                        <SafeImage
                          src={thumbnail}
                          alt=""
                          width={32}
                          height={32}
                          className="w-8 h-8 object-cover rounded-sm"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-surface-muted rounded-sm flex items-center justify-center">
                          {/* DECISION Phase 88.6-33 (D-16, owner ruling ARM A 2026-09-16):
                              `text-content-secondary` (6.9620) over `text-content-muted`
                              (4.3725) — this glyph sits on a CERTAIN `bg-surface-muted` ground
                              (the thumbnail well one line above), where 4.3725 is below the AA
                              4.5 floor. Re-inking the INK rather than moving the GROUND, the
                              same disposition plans 88.6-20 and 88.6-27 took at their own D-16
                              sites: the well's muted ground is what distinguishes a missing
                              thumbnail from a present one, so lightening it would erase the
                              affordance to fix the contrast.
                              The `?` is ICON sizing (D-02) — `text-xs` stays and is never
                              converged onto the type scale. Going back to `text-content-muted`
                              is a decision, not a cleanup. */}
                          <span className="text-content-secondary text-xs">?</span>
                        </div>
                      )}
                    </div>

                    {/* Name + others indicator.
                        DECISION Phase 88.6-33 (§4.5 EMPHASIS): the game name takes `font-normal`
                        over `font-bold`. 400 is correct because the distinction is already
                        carried by COLOUR and SIZE — `text-content-primary` at 14 against the
                        annotation's `text-content-secondary` at 12 directly below. 700 was
                        rejected: this is a dense scrolling picker row, not a card title, and
                        bolding every row in a list makes none of them read as emphasised.
                        The rung STAYS at 14: §4.3's primary-string clause reads to 16, but the
                        shipped fleet keeps compact list-row names at 14 (`CalendarListView.js`,
                        `BallotSection.js`), and folding this one row to 16 would be an
                        unowned look change on a phone-primary dense list. Recorded for plan 46.

                        DECISION Phase 88.6-33 (D-16, owner ruling ARM A 2026-09-16): the
                        annotation below is `text-content-secondary` (6.9620), NOT
                        `text-content-muted` (4.3725). Its ground is the selected-row arm's
                        `bg-surface-muted` on the wrapping button, against which 4.3725 is below
                        the AA 4.5 floor. Ink moved rather than ground, same as the thumbnail
                        well above. Going back is a decision, not a cleanup. */}
                    <div className="flex-1 min-w-0">
                      <p id={`bring-game-name-${gameId}`} className="text-sm font-normal text-content-primary truncate">{gameName}</p>
                      {othersCount > 0 && (
                        <p id={`bring-game-others-${gameId}`} className="text-xs text-content-secondary">
                          {othersCount} {othersCount === 1 ? 'other' : 'others'} bringing this
                        </p>
                      )}
                    </div>

                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-sm border-2 shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-accent border-accent' : 'border-line'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Modal.Body>

      {/* Footer */}
      <Modal.Footer className="justify-between">
        <button
          type="button"
          onClick={handleClose}
          className="text-sm text-content-muted hover:text-content-secondary transition-colors"
        >
          Skip for now
        </button>
        {/* 88.6-33 (§3.2/§3.3): `<Button variant="primary" size="default">`. `text-sm` was DEAD
            under unlayered `.btn`'s `font-size` (the unlayered `.btn {` rule's `font-size: 0.875rem` in
            `globals.css`) and is deleted rather than
            moved onto the className. The control KEEPS its NATIVE `disabled={saving}` — the
            plans 17-24 `aria-disabled` conversion is not this plan's work.
            AMENDED Phase 88.6-57 (CR-101, 88.6-REVIEW.md, 2026-09-28): still NATIVE `disabled`.
            R123 (plan 88.6-49 task 2) rules the in-flight idiom for `FetchErrorBanner` and
            `ConfirmDialog` ONLY — this Save is NOT in its scope, and whether it later follows
            whatever idiom that ruling sets is a separate call, not pre-empted here. What changed:
            Save is now ALSO refused while `loading` and after `loadError` (here and in
            `handleSave`'s first line), because the PUT is a FULL REPLACE and the initial empty
            Set would wipe the person's brings. Re-enabling it on those states is a decision, not
            a cleanup.
            AMENDED Phase 88.6.1-14 (D-35): D-35 (owner, 2026-10-04) classified this gate. The
            in-flight half is the control the user just pressed, so it moves to `aria-disabled`
            plus a synchronous first-line ref latch (`saveInFlightRef`) released in `finally` —
            the rule of POSITION, `DECISION Phase 88.6-22` in `FriendInvitePanel.js` — chosen OVER
            leaving it native (a keyboard or switch user is dropped out of the focus order
            mid-save). The loading, failed-load and identity-failure terms stay NATIVE: nobody
            pressed Save to cause any of them (the rule of KIND), and CR-101's refusal in
            `handleSave` still holds for all three. The research note that called this gate
            "leave, 88.9 / 89" was superseded because neither register owns the in-flight focus
            drop. Visible delta, disclosed: while saving, the button takes the shipped gated
            colour pair (`.btn-primary[aria-disabled='true']` in `globals.css`) instead of the
            `.btn:disabled` 50% wash. Dropping either half, or restoring the native attribute for
            the in-flight case, is a decision, not a cleanup. */}
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={loading || !!loadError || identityFailed}
          aria-disabled={saving ? 'true' : undefined}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
