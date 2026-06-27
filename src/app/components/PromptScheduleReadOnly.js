'use client';

import { useQuery } from '@tanstack/react-query';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
  promptSettingsSchema,
  softFailPromptQueryFn,
  EMPTY_PROMPT_SETTINGS,
} from '../../lib/schemas/prompts';

/**
 * PromptScheduleReadOnly - Read-only schedule summary for GroupSettings
 * Shows active schedule count, simple list, and link to manage on group page.
 *
 * Phase 84 (PRIM-07 / D-12): migrated to useQuery on the shared promptKeys
 * factory so the settings fetch dedups across the trio. This is MEMBER-visible
 * (mounted at GroupSettings.js:310) — the backend GET prompt-settings requires
 * ACTIVE MEMBERSHIP, NOT admin — so the query gates only on `Boolean(groupId)`.
 * An isAdmin gate here would blank the summary for every non-admin member.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {string} props.groupPageUrl - URL to the group page for "Manage on group page" link
 */
export default function PromptScheduleReadOnly({ groupId, groupPageUrl }) {
  const { data, isPending } = useQuery({
    queryKey: promptKeys.settings(groupId),
    queryFn: softFailPromptQueryFn(
      promptSettingsSchema,
      `/groups/${groupId}/prompt-settings`,
      promptKeys.settings(groupId),
      EMPTY_PROMPT_SETTINGS,
    ),
    enabled: Boolean(groupId),
  });

  // Soft-fail queryFn never throws; on benign drift it returns the empty shape.
  const loading = isPending;
  const schedules = data?.schedules || [];

  const activeCount = schedules.filter(s => s.is_active).length;

  return (
    <div>
      <h3 className="text-lg font-semibold text-content-primary mb-3">
        Recurring Check-ins ({activeCount})
      </h3>

      {loading && (
        <p className="text-sm text-content-muted">Loading schedules...</p>
      )}

      {!loading && schedules.length === 0 && (
        <p className="text-sm text-content-muted">No schedules configured.</p>
      )}

      {!loading && schedules.length > 0 && (
        <ul className="space-y-2 mb-4">
          {schedules.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm text-content-secondary">
              <span className={`w-2 h-2 rounded-full ${s.is_active ? 'bg-status-success' : 'bg-surface-card-hover'}`} />
              <span>{s.name || 'Unnamed schedule'}</span>
              {!s.is_active && <span className="text-content-muted text-xs">(paused)</span>}
            </li>
          ))}
        </ul>
      )}

      <a
        href={groupPageUrl}
        className="text-content-link hover:text-content-link-hover text-sm font-medium"
      >
        Manage on group page &rarr;
      </a>
    </div>
  );
}
