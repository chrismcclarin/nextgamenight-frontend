'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { promptSettingsAPI, promptAPI } from '../../lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
  promptSettingsSchema,
  openPromptsSchema,
  softFailPromptQueryFn,
  EMPTY_PROMPT_SETTINGS,
  EMPTY_OPEN_PROMPTS,
} from '../../lib/schemas/prompts';
import PromptScheduleManager from './PromptScheduleManager';
import OpenPollsList from './OpenPollsList';
import AutoPromptBehaviorBanner from './AutoPromptBehaviorBanner';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * PromptScheduleSection - Collapsible section for the group planning page.
 *
 * Phase 71.2 D-UI-01:
 *   Section is now visible to ALL active members (not just owner/admin).
 *   - Active members (any role): see AutoPromptBehaviorBanner + OpenPollsList
 *     (with the "Start a poll" button) inside the expanded body.
 *   - Owner/admin: additionally see the inline PromptScheduleManager
 *     (recurring-schedules sub-section).
 *   - Pending and removed members: section does not render.
 *
 * Badge logic now reflects open-poll count for all roles (the section's
 * primary value-prop for non-admins). Schedule count is admin-only context
 * and dropped from the badge to avoid confusing members with a number that
 * has no meaning to them.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' | 'pending'
 * @param {string} [props.currentUserDbId] - Caller's User.id UUID (passed to
 *   OpenPollsList; informational — server-derived can_close drives the close UI).
 * @param {boolean} [props.defaultExpanded=false]
 */
export default function PromptScheduleSection({
  groupId,
  group,
  userRole,
  currentUserDbId,
  defaultExpanded = false,
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // Phase 84 (PRIM-07 / D-12): schedules + open-poll count via useQuery on the
  // shared promptKeys factory so they dedup with the rest of the trio (settings
  // 3x → 1x F-852; open 2x → 1x F-826). Each query carries its OWN per-component
  // Boolean-wrapped `enabled` gate.

  // Fetch schedules. The API (GET /groups/:id/prompt-settings) only requires
  // ACTIVE MEMBERSHIP (backend isActiveMember gate), NOT an elevated role. The
  // Boolean(isAdmin) gate below is a deliberate FE/product choice — only the
  // owner/admin manager surface consumes the schedule settings — not an API
  // constraint.
  const { data: settingsData, isPending: settingsPending } = useQuery({
    queryKey: promptKeys.settings(groupId),
    queryFn: softFailPromptQueryFn(
      promptSettingsSchema,
      () => promptSettingsAPI.getGroupPromptSettings(groupId),
      promptKeys.settings(groupId),
      EMPTY_PROMPT_SETTINGS,
    ),
    enabled: Boolean(groupId) && Boolean(isAdmin),
  });
  const schedules = settingsData?.schedules || [];
  // Loading is only meaningful while the admin-gated query can run; for
  // non-admins the query is disabled and we treat schedules as resolved-empty.
  const loading = isAdmin ? settingsPending : false;

  // Open-poll count for the badge — visible to ALL active members. Shares the
  // openPolls key with OpenPollsList so the two collapse to ONE fetch (F-826).
  const { data: openData, isPending: openPending } = useQuery({
    queryKey: promptKeys.openPolls(groupId),
    queryFn: softFailPromptQueryFn(
      openPromptsSchema,
      () => promptAPI.getOpenPrompts(groupId),
      promptKeys.openPolls(groupId),
      EMPTY_OPEN_PROMPTS,
    ),
    enabled: Boolean(groupId) && Boolean(userRole) && userRole !== 'pending',
  });
  const openPollCount = Array.isArray(openData?.prompts) ? openData.prompts.length : 0;
  const enabledOpen = Boolean(groupId) && Boolean(userRole) && userRole !== 'pending';
  const openPollsLoading = enabledOpen ? openPending : false;

  // Phase 71.2 D-UI-01: visible to ALL active members. Pending and removed
  // (no role at all) get nothing. Same negative check is mirrored inside
  // OpenPollsList for the "Start a poll" button gate so future role tweaks
  // evolve both surfaces together.
  if (!userRole || userRole === 'pending') {
    return null;
  }

  const activeSchedules = schedules.filter((s) => s.is_active);
  const activeCount = activeSchedules.length;

  // Find the next prompt day from active schedules (admins only — members
  // don't see this metadata since the schedule manager isn't rendered for
  // them).
  let nextPromptDay = null;
  if (isAdmin && activeCount > 0) {
    const todayDow = new Date().getDay();
    let minDaysUntil = Infinity;
    for (const schedule of activeSchedules) {
      let daysUntil = (schedule.schedule_day_of_week - todayDow + 7) % 7;
      if (daysUntil === 0) daysUntil = 7;
      if (daysUntil < minDaysUntil) {
        minDaysUntil = daysUntil;
        nextPromptDay = DAY_NAMES[schedule.schedule_day_of_week];
      }
    }
  }

  // Badge logic — open-poll count for everyone (the headline number).
  const renderBadge = () => {
    if (openPollsLoading) {
      return <span className="text-xs text-content-muted">Loading...</span>;
    }
    if (openPollCount === 0) {
      return (
        <span className="bg-surface-card-hover text-content-secondary rounded-full px-2 py-0.5 text-xs font-medium">
          No open polls
        </span>
      );
    }
    return (
      <span className="bg-status-success-subtle text-status-success rounded-full px-2 py-0.5 text-xs font-medium">
        {openPollCount} open {openPollCount === 1 ? 'poll' : 'polls'}
      </span>
    );
  };

  return (
    <div>
      {/* DECISION Phase 88-28 (Req 4): this is `role="button"` + `tabIndex` + a key handler,
          chosen OVER converting it to a real `<button>`. The header renders a `<p>` in its
          admin branch (the "Next check-in:" line below), and `<p>` is not phrasing content —
          a browser parsing `<button><p>` breaks the paragraph OUT of the button, restructuring
          the DOM under React and producing a hydration mismatch. The ARIA pattern gives the
          same role, name, keyboard contract and focus ring with no content-model violation.
          87.8-08's census recorded this control as press-styled but NOT keyboard-operable
          ("NO (div, no role/tabIndex)") and deferred it here. Space is `preventDefault`ed
          because the browser's default for Space on a non-button is to scroll the page.
          Turning this into a `<button>` "for correctness" is a decision, not a cleanup. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
        className="p-3 cursor-pointer hover:bg-surface-hover active:opacity-75 rounded-card transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className={`w-4 h-4 text-content-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium text-content-primary">Check-ins</span>
          </div>
          {renderBadge()}
        </div>
        {!isExpanded && isAdmin && !loading && nextPromptDay && (
          <p className="text-sm text-content-muted mt-1 ml-6">
            Next check-in: {nextPromptDay}
          </p>
        )}
      </div>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isExpanded ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'
        }`}
      >
        {/* Behavior-shift banner — dismissable, persists across reloads via
            localStorage. Shown to all active members (manual-poll users still
            benefit from understanding consensus-close even if they don't own
            a recurring schedule). */}
        <AutoPromptBehaviorBanner />

        {/* Unified open polls + Start-a-poll button. Renders for all active
            members regardless of role. */}
        <OpenPollsList
          groupId={groupId}
          group={group}
          userRole={userRole}
          currentUserDbId={currentUserDbId}
        />

        {/* Recurring-schedules manager — admin-only sub-mount per D-UI-01.
            Members don't see schedule plumbing since they can't manage it. */}
        {isAdmin && (
          <div className="mt-4">
            <PromptScheduleManager
              groupId={groupId}
              group={group}
              userRole={userRole}
              variant="inline"
            />
          </div>
        )}
      </div>
    </div>
  );
}
