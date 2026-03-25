'use client';

import { useState, useEffect } from 'react';
import { promptSettingsAPI } from '../../lib/api';

/**
 * PromptScheduleReadOnly - Read-only schedule summary for GroupSettings
 * Shows active schedule count, simple list, and link to manage on group page.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {string} props.groupPageUrl - URL to the group page for "Manage on group page" link
 */
export default function PromptScheduleReadOnly({ groupId, groupPageUrl }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSchedules = async () => {
      try {
        setLoading(true);
        const settings = await promptSettingsAPI.getGroupPromptSettings(groupId);
        setSchedules(settings.schedules || []);
      } catch (err) {
        console.error('Error loading schedules:', err);
        setError(err.message || 'Failed to load schedules.');
      } finally {
        setLoading(false);
      }
    };

    if (groupId) {
      fetchSchedules();
    }
  }, [groupId]);

  const activeCount = schedules.filter(s => s.is_active).length;

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-3">
        Prompt Schedule ({activeCount})
      </h3>

      {loading && (
        <p className="text-sm text-gray-500">Loading schedules...</p>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {!loading && !error && schedules.length === 0 && (
        <p className="text-sm text-gray-500">No schedules configured.</p>
      )}

      {!loading && !error && schedules.length > 0 && (
        <ul className="space-y-2 mb-4">
          {schedules.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <span className={`w-2 h-2 rounded-full ${s.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span>{s.name || 'Unnamed schedule'}</span>
              {!s.is_active && <span className="text-gray-400 text-xs">(paused)</span>}
            </li>
          ))}
        </ul>
      )}

      <a
        href={groupPageUrl}
        className="text-blue-600 hover:text-blue-700 text-sm font-medium"
      >
        Manage on group page &rarr;
      </a>
    </div>
  );
}
