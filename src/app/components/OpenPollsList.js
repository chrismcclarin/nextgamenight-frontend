'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { promptAPI } from '../../lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
  openPromptsSchema,
  softFailPromptQueryFn,
  EMPTY_OPEN_PROMPTS,
} from '../../lib/schemas/prompts';
import KebabMenu from './KebabMenu';
import StartPollModal from './StartPollModal';

/**
 * OpenPollsList — Phase 71.2 (POLL-01 / D-UI-01..04)
 *
 * Unified list of open availability prompts (manual + auto) for a group.
 * Renders the "Start a poll" entry point for any non-pending active member,
 * the source label per prompt (`Started by [creator]` for manual, `From
 * [schedule name]` for auto — Plan 01 ships GroupPromptSettings.template_name
 * inline in the GET /prompts/open response), and a per-card KebabMenu close
 * action gated on the server-derived `can_close` flag.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' | 'pending'
 * @param {string} [props.currentUserDbId] - Caller's User.id UUID (currently
 *   informational; the can_close gate is server-derived in the response).
 */
export default function OpenPollsList({ groupId, group, userRole, currentUserDbId }) {
  const [showStartPoll, setShowStartPoll] = useState(false);
  const queryClient = useQueryClient();

  // Phase 84 (PRIM-07 / D-12): open prompts via useQuery on the shared promptKeys
  // factory so this fetch dedups with the parent Section's badge-count query
  // (F-826: 2x → 1x). Role gate mirrors the parent's pending exclusion (the
  // backend GET /prompts/open requires active membership) and is Boolean-wrapped
  // so `enabled` is never undefined.
  const { data, isPending } = useQuery({
    queryKey: promptKeys.openPolls(groupId),
    queryFn: softFailPromptQueryFn(
      openPromptsSchema,
      `/groups/${groupId}/prompts/open`,
      promptKeys.openPolls(groupId),
      EMPTY_OPEN_PROMPTS,
    ),
    enabled: Boolean(groupId) && Boolean(userRole) && userRole !== 'pending',
  });

  const loading = isPending;
  const prompts = data?.prompts || [];

  // Post-write cache invalidation replaces the old loadPrompts() refetch — keeps
  // the open-polls list fresh after a direct-API write (A1/A4).
  const invalidateOpenPolls = () =>
    queryClient.invalidateQueries({ queryKey: promptKeys.openPolls(groupId) });

  // Gate alignment: parent PromptScheduleSection uses `!userRole || userRole
  // === 'pending' → return null`. We mirror the same negative check so any
  // future role addition (e.g. 'guest') evolves both gates together. No
  // positive role allowlist.
  const canCreate = userRole && userRole !== 'pending';

  const handleClose = async (promptId) => {
    try {
      await promptAPI.closePrompt(promptId);
      // Backend has already flipped status to 'closed'; invalidate so the
      // GET /prompts/open query refetches and drops it from the list.
      await invalidateOpenPolls();
    } catch (err) {
      const msg = err?.message || 'Unknown error';
      // Match the existing PromptScheduleManager pattern (alert on close-action
      // failure). KebabMenu has already closed by this point.
      // eslint-disable-next-line no-alert
      alert(`Failed to end check-in: ${msg}`);
    }
  };

  return (
    <div>
      {canCreate && (
        <button
          type="button"
          onClick={() => setShowStartPoll(true)}
          className="btn btn-primary mb-4"
        >
          + Start a check-in
        </button>
      )}

      {loading ? (
        <p className="text-content-muted text-sm py-4 text-center">Loading check-ins...</p>
      ) : prompts.length === 0 ? (
        // D-UI-03: unified empty-state copy for ALL roles (admin/member alike).
        <p className="text-content-muted text-sm py-8 text-center">
          No active check-ins. Start one to find a time that works for everyone.
        </p>
      ) : (
        <ul className="space-y-2">
          {prompts.map((p) => (
            <OpenPollCard
              key={p.id}
              prompt={p}
              group={group}
              onClose={handleClose}
            />
          ))}
        </ul>
      )}

      <StartPollModal
        groupId={groupId}
        group={group}
        isOpen={showStartPoll}
        onClose={() => setShowStartPoll(false)}
        onSuccess={() => {
          setShowStartPoll(false);
          invalidateOpenPolls();
        }}
      />
    </div>
  );
}

/**
 * OpenPollCard — single prompt row in the unified list.
 *
 * Source label rules (D-UI-02):
 *   - Auto-prompt (created_by_settings_id != null):
 *       "From {GroupPromptSettings.template_name}"
 *       Falls back to "From recurring schedule" if the parent settings row
 *       has been deleted (rare; ON DELETE SET NULL on created_by_settings_id
 *       leaves the include null).
 *   - Manual poll: "Started by {Creator.username}"
 *       Falls back to "a group member" if the Creator association is null.
 *
 * KebabMenu visibility is gated on the server-derived `can_close` flag.
 * Backend re-validates on PATCH (defense in depth) so a forged client-side
 * flag still fails with 403 — see threat T-71.2-11 in plan.
 */
function OpenPollCard({ prompt, group, onClose }) {
  const isAuto = !!prompt.created_by_settings_id;

  // Note: Plan 01 named the include attribute `template_name` (the actual
  // model column). The route returns it under the alias `GroupPromptSetting`
  // (Sequelize default), but to be defensive across alias variations we
  // accept either shape.
  const settingsRow = prompt.GroupPromptSetting || prompt.GroupPromptSettings;
  const sourceLabel = isAuto
    ? `From ${settingsRow?.template_name || 'recurring schedule'}`
    : `Started by ${prompt.Creator?.username || 'a group member'}`;

  // Resolve game name from group.games when available — falls back to the
  // generic title when the prompt has no associated game.
  const gameName = (() => {
    if (!prompt.game_id) return null;
    if (Array.isArray(group?.games)) {
      const g = group.games.find((x) => x.id === prompt.game_id);
      return g?.name || g?.title || null;
    }
    return null;
  })();
  const title = gameName || 'Availability check-in';

  // Format deadline in viewer's local timezone using Intl.
  const deadlineDisplay = (() => {
    if (!prompt.deadline) return '';
    try {
      const d = new Date(prompt.deadline);
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(d);
    } catch {
      return prompt.deadline;
    }
  })();

  return (
    <li className="bg-surface-card border border-line rounded-card p-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-content-primary truncate">{title}</p>
        <p className="text-xs text-content-muted mt-0.5">{sourceLabel}</p>
        {deadlineDisplay && (
          <p className="text-xs text-content-secondary mt-1">
            Deadline: {deadlineDisplay}
          </p>
        )}
        {prompt.custom_message && (
          <p className="text-sm text-content-secondary mt-2 italic">
            &ldquo;{prompt.custom_message}&rdquo;
          </p>
        )}
      </div>

      {prompt.can_close === true && (
        <KebabMenu
          ariaLabel="Check-in actions"
          items={[
            {
              label: 'End check-in',
              danger: true,
              twoTap: true,
              confirmLabel: 'Tap again to end',
              onClick: () => onClose(prompt.id),
            },
          ]}
        />
      )}
    </li>
  );
}
