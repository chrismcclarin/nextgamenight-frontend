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
 * @param {string} currentUserId - Auth0 user ID (for identifying own brings)
 * @param {number|string} refreshKey - Changes to trigger refetch
 * @param {Function} onEditClick - Callback to open BringGamePicker for editing
 */
export default function BringSummary({ eventId, groupId, currentUserId, refreshKey, onEditClick }) {
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

        // Group by user
        const grouped = {};
        for (const bring of brings) {
          const userId = bring.user_id;
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

  const currentUserHasBrings = currentUserId && bringsByUser[currentUserId];

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
