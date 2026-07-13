'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { eventBringsAPI } from '../../lib/api';

/**
 * BringSummary - Displays who is bringing which games, grouped by person
 * Hidden entirely when nobody has marked any games.
 *
 * @param {string} eventId - UUID of the event
 * @param {string} groupId - UUID of the group (for game detail links)
 * @param {object} self - Resolved self-identity row from useSelfIdentity
 *   ({ id: <Users.id UUID>, ... }). Phase 87.3-04: brings are grouped by the
 *   nested `bring.User.id` UUID and the own-brings check keys on `self.id` (D-04)
 *   — never the flat `user_id` (a sub through the PR-C window).
 * @param {number|string} refreshKey - Changes to trigger refetch
 * @param {Function} onEditClick - Callback to open BringGamePicker for editing
 */
export default function BringSummary({ eventId, groupId, self, refreshKey, onEditClick }) {
  const [bringsByUser, setBringsByUser] = useState({});
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    async function fetchBrings() {
      setLoading(true);
      try {
        const res = await eventBringsAPI.getEventBrings(eventId);
        if (cancelled) return;

        const brings = Array.isArray(res) ? res : (res?.brings || []);

        if (brings.length === 0) {
          setHasData(false);
          setBringsByUser({});
          return;
        }

        // Group by user. Phase 87.3-04 (D-04/D-07): key on the nested User.id
        // UUID so the own-brings check below (self.id) is a UUID-to-UUID match —
        // no flat `user_id` (sub) key that the PR-C flip would silently break.
        const grouped = {};
        for (const bring of brings) {
          // Rows missing the nested User include are still SHOWN (grouped under
          // a single 'Unknown' bucket) — silently dropping them would hide a
          // game someone is bringing just because attribution failed.
          const userId = bring.User?.id || 'unknown';
          if (!grouped[userId]) {
            grouped[userId] = {
              username: bring.User?.username || bring.username || 'Unknown',
              games: [],
            };
          }
          grouped[userId].games.push({
            id: bring.game_id,
            name: bring.Game?.name || bring.Game?.title || 'Unknown Game',
          });
        }

        setBringsByUser(grouped);
        setHasData(true);
      } catch (err) {
        console.error('BringSummary: failed to fetch brings', err);
        setHasData(false);
        setBringsByUser({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBrings();
    return () => { cancelled = true; };
  }, [eventId, refreshKey]);

  // Hide entirely when loading or no data
  if (loading || !hasData) return null;

  // Sort users alphabetically by username
  const sortedUsers = Object.entries(bringsByUser).sort((a, b) =>
    a[1].username.localeCompare(b[1].username)
  );

  // Phase 87.3-04: own-brings check keys on the resolved self UUID vs the
  // UUID-keyed grouping. Falsy while identity is unresolved (indeterminate —
  // Edit affordance simply stays hidden until `self` resolves, never a wrong
  // "not mine"); recomputes on the next render once `self` lands.
  const currentUserHasBrings = self?.id && bringsByUser[self.id];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-content-primary">Bringing</h3>
        {currentUserHasBrings && onEditClick && (
          <button
            onClick={onEditClick}
            className="text-sm text-content-link hover:text-content-link-hover transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      <div className="space-y-2">
        {sortedUsers.map(([userId, { username, games }]) => (
          <div key={userId}>
            <span className="text-sm font-medium text-content-secondary">{username}: </span>
            {games.map((game, idx) => (
              <span key={game.id}>
                <Link
                  href={`/gameDetail?game_id=${game.id}&group_id=${groupId}`}
                  className="text-sm text-content-link hover:underline"
                >
                  {game.name}
                </Link>
                {idx < games.length - 1 && <span className="text-content-muted">, </span>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
