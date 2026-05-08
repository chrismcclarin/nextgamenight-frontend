'use client';

import { useState, useEffect } from 'react';
import { promptSettingsAPI, promptAPI } from '../../lib/api';
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
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openPollCount, setOpenPollCount] = useState(0);
  const [openPollsLoading, setOpenPollsLoading] = useState(true);

  const isAdmin = userRole === 'owner' || userRole === 'admin';

  // Fetch schedules — owner/admin only (the API requires elevated role for
  // GET /groups/:id/prompt-settings; pre-Phase-71.2 the whole section was
  // gated to admins so this fetch was always allowed).
  useEffect(() => {
    if (!groupId || !isAdmin) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fetchSchedules = async () => {
      try {
        setLoading(true);
        const settings = await promptSettingsAPI.getGroupPromptSettings(groupId);
        if (!cancelled) setSchedules(settings.schedules || []);
      } catch (err) {
        console.error('Error loading prompt schedules:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchSchedules();
    return () => { cancelled = true; };
  }, [groupId, isAdmin]);

  // Open-poll count for the badge — visible to ALL active members. Cheap to
  // fetch; same endpoint OpenPollsList consumes (response cache via the
  // browser when both fire, but this is also fine if it double-fetches).
  useEffect(() => {
    if (!groupId || !userRole || userRole === 'pending') {
      setOpenPollCount(0);
      setOpenPollsLoading(false);
      return;
    }
    let cancelled = false;
    const fetchCount = async () => {
      try {
        setOpenPollsLoading(true);
        const data = await promptAPI.getOpenPrompts(groupId);
        if (!cancelled) setOpenPollCount(Array.isArray(data?.prompts) ? data.prompts.length : 0);
      } catch (err) {
        console.error('Error loading open polls count:', err);
        if (!cancelled) setOpenPollCount(0);
      } finally {
        if (!cancelled) setOpenPollsLoading(false);
      }
    };
    fetchCount();
    return () => { cancelled = true; };
  }, [groupId, userRole]);

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
      <span className="bg-status-success/10 text-status-success rounded-full px-2 py-0.5 text-xs font-medium">
        {openPollCount} open {openPollCount === 1 ? 'poll' : 'polls'}
      </span>
    );
  };

  return (
    <div>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-3 cursor-pointer hover:bg-surface-card-hover rounded-card transition-colors"
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
