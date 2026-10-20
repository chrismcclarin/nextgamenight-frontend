'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { groupsAPI } from '../../lib/api';
import SafeImage from './SafeImage';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Input, SelectControl } from '../../components/ui/Input';
import { logger, errCtx } from '@/lib/logger';

const OWNER_FILTER_LABEL = 'Filter by owner';

export default function GroupLibrary({ groupId }) {
  const router = useRouter();
  const [games, setGames] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [showAllOwners, setShowAllOwners] = useState(false);
  /* DECISION Phase 88-18 (Req 6 / T-88-18-01): the library fetch failure is tracked as its own
     state instead of being swallowed by the `console.error` it used to be. Before this, a failed
     `getGroupLibrary` left `games` at [] and fell straight through to the empty-library copy —
     the surface told the group its shelf was bare when the request had failed. Empty and failed
     are different facts on different surfaces (UI-SPEC 9.2). Do not collapse them back. */
  const [libraryError, setLibraryError] = useState(null);
  const loaded = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Hoisted out of the mount effect so the error banner's Retry can re-run the
  // very same fetch (the hook needs a stable callable, not an effect body).
  const fetchLibrary = useCallback(async () => {
    if (!groupId) return;
    try {
      setLoading(true);
      setLibraryError(null);
      const data = await groupsAPI.getGroupLibrary(groupId);
      if (!mounted.current) return;
      setGames(data.games || []);
      setMembers(data.members || []);
      loaded.current = true;
    } catch (error) {
      // AC-2 WIDENED (owner 2026-09-09) x D2 (owner 2026-09-13): a library-fetch failure is NOT
      // an AC-16 (a) site, so this takes `logger.info` — a Sentry BREADCRUMB. `logger.error`
      // is REJECTED here: it is `Sentry.captureException`, an EVENT, which would buy Session
      // Replay volume the ROADMAP `:28` convert-on-touch gate never asked for. `logger.warn` is
      // not a cheaper middle arm — it is `Sentry.captureMessage`, also an event. The message
      // string is byte-identical to the `console.error` it replaces, and `errCtx` bounds the
      // payload to the error's name and message (T-84-01); the raw `Error` is never passed as
      // `logger.info`'s second argument, whose type is `Record<string, unknown>`
      // (`logger.ts:31`) — a mistake `npm run typecheck` cannot see in a `.js` file.
      logger.info('Error fetching group library:', errCtx(error));
      if (!mounted.current) return;
      // Keep the ERROR object, not a flattened string: useFetchErrorState reads
      // `ApiError.code` off it to pick the right user-facing copy.
      setLibraryError(
        error instanceof Error ? error : new Error("The group library request didn't complete.")
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (!groupId || loaded.current) return;
    fetchLibrary();
  }, [groupId, fetchLibrary]);

  // Retry must clear the once-only guard, or the refetch silently no-ops.
  const retryLibrary = useCallback(() => {
    loaded.current = false;
    return fetchLibrary();
  }, [fetchLibrary]);

  const libraryErrorState = useFetchErrorState({
    isError: Boolean(libraryError),
    error: libraryError,
    refetch: retryLibrary,
  });

  // Filtering + sorting (derived, not modifying source data)
  const filteredGames = useMemo(() => {
    let result = [...games];

    // Filter by owner
    if (selectedOwner) {
      result = result.filter(game =>
        game.owners.some(o => o.user_id === selectedOwner)
      );
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(game =>
        game.name.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'players': {
          const aVal = a.min_players;
          const bVal = b.min_players;
          if (aVal == null && bVal == null) return (a.name || '').localeCompare(b.name || '');
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          return aVal - bVal || (a.name || '').localeCompare(b.name || '');
        }
        case 'time': {
          const aVal = a.playing_time;
          const bVal = b.playing_time;
          if (aVal == null && bVal == null) return (a.name || '').localeCompare(b.name || '');
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          return aVal - bVal || (a.name || '').localeCompare(b.name || '');
        }
        case 'complexity': {
          const aVal = a.weight;
          const bVal = b.weight;
          if (aVal == null && bVal == null) return (a.name || '').localeCompare(b.name || '');
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          return aVal - bVal || (a.name || '').localeCompare(b.name || '');
        }
        default:
          return 0;
      }
    });

    return result;
  }, [games, selectedOwner, searchQuery, sortBy]);

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedOwner(null);
    setSortBy('name');
  };

  const hasActiveFilters = searchQuery.trim() || selectedOwner || sortBy !== 'name';

  // Loading skeleton
  if (loading) {
    return (
      <div className="mt-4 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-surface-page rounded-card animate-pulse">
            <div className="w-10 h-10 bg-surface-muted rounded-sm" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-muted rounded-sm w-1/3" />
              <div className="h-3 bg-surface-muted rounded-sm w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // The library FAILED to load — a different fact from an empty library, and it
  // is checked first so the empty copy can never stand in for a failure.
  if (libraryErrorState.showError) {
    return (
      <div className="mt-4">
        <FetchErrorBanner
          state={libraryErrorState}
          title="We couldn't load this library"
          reportContext="Group library (group home page)"
        />
      </div>
    );
  }

  // Empty library (no games at all) — Req 6 / UI-SPEC 9.2.
  if (games.length === 0) {
    return (
      <div className="mt-4 bg-surface-page rounded-card">
        <EmptyState
          icon="Library"
          heading="This library is empty"
          body="Games your group owns show up here. Add a few from your profile to get started."
          action={
            <Button asChild variant="primary" className="min-h-11">
              <Link href="/userProfile">Add games</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Search bar */}
      <div className="mb-3">
        <Input
          id="group-library-search"
          name="group-library-search"
          aria-label="Search games"
          type="text"
          placeholder="Search games..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Sort dropdown + game count */}
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2">
          <span className="text-sm text-content-secondary">Sort:</span>
          {/* `w-auto`: inline beside its "Sort:" span on a toolbar row — same shape as
              GroupGamesList's sort select. See the marker there. */}
          <SelectControl
            id="group-library-sort"
            name="group-library-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-auto"
          >
            <option value="name">Name (A-Z)</option>
            <option value="players">Player Count</option>
            <option value="time">Play Time</option>
            <option value="complexity">Complexity</option>
          </SelectControl>
        </label>
        <span className="text-sm text-content-muted">
          {filteredGames.length} {filteredGames.length === 1 ? 'game' : 'games'}
        </span>
      </div>

      {/* Owner chip bar.

          DECISION Phase 88.6-32 (§4.5, the pill/chip-ink row): both chip shapes below take
          **700**, not 400. 400 was REJECTED — these are filled pills (`bg-btn-primary` when
          selected, `bg-surface-muted` otherwise) and the ink has to hold against its own fill,
          which is the same reason §4.5 gives for `UpcomingCountPill.tsx` and
          `MemberChipStack.tsx`. The 500 they carried is a prohibition outside the `Button`
          label (§4.2), so leaving it was never an option; the choice was 400 or 700.

          DECISION Phase 88.6.1-48 (D-21 / D-44): the chips are PRESSED toggles and carry
          `aria-pressed`, read from the same comparison each fill ternary reads. `All` is a
          ONE-WAY toggle (pressing it while pressed changes nothing). Accepted: it reports a true
          state, and its pressed state is the only non-colour cue that no owner filter is active.
          REJECTED: a radio group (the D-20 icon-picker pattern). A member chip is TWO-way
          (pressing the selected member returns to All), and a radio cannot be un-checked by
          activating it; a radio group would also bring roving-tabindex keyboard work (D-43) to a
          row that needs none.
          FLOOR as in the Profile Days row: phone-scoped `min-h-11 md:min-h-0`, plus
          `min-w-11 md:min-w-0` because `All` and short usernames are under 44px wide; both sit in
          the static part of each className, so pressed and unpressed both carry them.
          The bar's `-mt-1 pt-1` is the focus ring's top inset (#211): `overflow-x-auto` makes the
          bar clip in both axes, and the chips' ring draws 4px outside them. Chosen over `pt-1`
          alone, REJECTED because it shifts the chips down 4px at every width; the pair mirrors the
          bar's own `-mx-1 px-1` and moves nothing. Removing `pt-1` cuts off the ring's top edge
          again; removing only `-mt-1` shifts the chips 4px.
          The bar is a named group (#210, owner 2026-10-13): role="group" with
          `aria-label={OWNER_FILTER_LABEL}` (the ratified words, screen-reader only). Chosen over
          leaving the row unnamed (the pressed state said WHO was picked, nothing said WHAT the
          chips do) and over a visible label above the chips (a look change no ruling made). The
          Days row's `aria-labelledby` form was not copied because this bar has no visible text to
          point at. Changing any of this is a decision, not a cleanup. */}
      <div role="group" aria-label={OWNER_FILTER_LABEL} className="mb-4 -mt-1 pt-1 overflow-x-auto flex gap-2 pb-1 -mx-1 px-1">
        <button
          aria-pressed={selectedOwner === null}
          onClick={() => setSelectedOwner(null)}
          className={`shrink-0 px-3 py-1 min-h-11 md:min-h-0 min-w-11 md:min-w-0 rounded-full text-sm font-bold active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
            selectedOwner === null
              ? 'bg-btn-primary text-btn-primary-text'
              : 'bg-surface-muted text-content-secondary hover:text-content-primary'
          }`}
        >
          All
        </button>
        {members.map((member) => (
          <button
            key={member.user_id}
            aria-pressed={selectedOwner === member.user_id}
            onClick={() => setSelectedOwner(member.user_id === selectedOwner ? null : member.user_id)}
            className={`shrink-0 px-3 py-1 min-h-11 md:min-h-0 min-w-11 md:min-w-0 rounded-full text-sm font-bold active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
              selectedOwner === member.user_id
                ? 'bg-btn-primary text-btn-primary-text'
                : 'bg-surface-muted text-content-secondary hover:text-content-primary'
            }`}
          >
            {member.username}
          </button>
        ))}
      </div>

      {/* Filter/search returns 0 results */}
      {filteredGames.length === 0 && hasActiveFilters && (
        <div className="text-center py-8 bg-surface-page rounded-card border border-line">
          <p className="text-content-secondary mb-3">No games found</p>
          <button
            onClick={clearFilters}
            className="text-content-link hover:text-content-link-hover active:opacity-75 text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Game list */}
      <div className="space-y-1">
        {filteredGames.map((game) => {
          const isExpanded = expandedId === game.id;
          const ownerCount = game.owners?.length || 0;

          // Build metadata segments, skipping nulls
          const metaParts = [];
          if (game.min_players != null || game.max_players != null) {
            if (game.min_players != null && game.max_players != null) {
              metaParts.push(`${game.min_players}-${game.max_players} players`);
            } else if (game.min_players != null) {
              metaParts.push(`${game.min_players}+ players`);
            } else {
              metaParts.push(`Up to ${game.max_players} players`);
            }
          }
          if (game.playing_time != null) {
            metaParts.push(`${game.playing_time} min`);
          }
          if (game.weight != null) {
            metaParts.push(`${game.weight.toFixed(1)} weight`);
          }

          return (
            <div key={game.id} className="border border-line rounded-card overflow-hidden">
              {/* Collapsed row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : game.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-surface-hover active:opacity-75 transition-colors text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                style={{ minHeight: '56px' }}
              >
                <SafeImage
                  src={game.thumbnail_url || game.image_url}
                  alt={game.name}
                  className="w-10 h-10 rounded-sm object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  {/* §4.5 HIERARCHY outcome: 500 -> 700. This is the row's one primary string. It is a
                      `<p>`, not an `<hN>`, so the A1 heading-`truncate` ruling does not reach it
                      and `truncate` stays — these are 40px-tall list rows, not cards. */}
                  <p className="font-bold text-content-primary truncate text-sm">{game.name}</p>
                  {metaParts.length > 0 && (
                    <p className="text-xs text-content-muted truncate">{metaParts.join(' \u00B7 ')}</p>
                  )}
                </div>
                <span className="text-xs text-content-muted shrink-0 whitespace-nowrap">
                  {ownerCount} {ownerCount === 1 ? 'owner' : 'owners'}
                </span>
              </button>

              {/* Expanded section */}
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  isExpanded ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-3 pb-3 pt-2 border-t border-line bg-surface-page">
                  <OwnerList
                    owners={game.owners || []}
                    showAll={showAllOwners && expandedId === game.id}
                    onToggleShowAll={() => setShowAllOwners(prev => !prev)}
                    onSelectOwner={(userId) => setSelectedOwner(userId)}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/gameDetail?game_id=${encodeURIComponent(game.id)}&group_id=${encodeURIComponent(groupId)}`);
                    }}
                    className="mt-2 text-sm text-content-link hover:text-content-link-hover active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                  >
                    View game
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OwnerList({ owners, showAll, onToggleShowAll, onSelectOwner }) {
  if (!owners || owners.length === 0) return null;

  const VISIBLE_LIMIT = 3;
  const hasMore = owners.length > VISIBLE_LIMIT;
  const visibleOwners = showAll ? owners : owners.slice(0, VISIBLE_LIMIT);
  const remaining = owners.length - VISIBLE_LIMIT;

  return (
    <p className="text-sm text-content-secondary">
      <span className="text-content-muted">Owned by </span>
      {visibleOwners.map((owner, i) => (
        <span key={owner.user_id}>
          {i > 0 && ', '}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectOwner(owner.user_id);
            }}
            className="text-content-link hover:text-content-link-hover hover:underline active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            {owner.username}
          </button>
        </span>
      ))}
      {hasMore && !showAll && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleShowAll();
          }}
          className="text-content-link hover:text-content-link-hover hover:underline active:opacity-75 ml-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          and {remaining} more
        </button>
      )}
    </p>
  );
}
