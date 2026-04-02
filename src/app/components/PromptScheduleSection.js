'use client';

import { useState, useEffect } from 'react';
import { promptSettingsAPI } from '../../lib/api';
import PromptScheduleManager from './PromptScheduleManager';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * PromptScheduleSection - Collapsible summary card for the group page
 * Shows active schedule count and next prompt day when collapsed.
 * Expands to reveal the full PromptScheduleManager for owner/admin roles only.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' | 'pending'
 */
export default function PromptScheduleSection({ groupId, group, userRole, defaultExpanded = false }) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSchedules = async () => {
      try {
        setLoading(true);
        const settings = await promptSettingsAPI.getGroupPromptSettings(groupId);
        setSchedules(settings.schedules || []);
      } catch (err) {
        console.error('Error loading prompt schedules:', err);
      } finally {
        setLoading(false);
      }
    };

    if (groupId) {
      fetchSchedules();
    }
  }, [groupId]);

  // Only visible to owner and admin
  if (userRole !== 'owner' && userRole !== 'admin') {
    return null;
  }

  const activeSchedules = schedules.filter(s => s.is_active);
  const activeCount = activeSchedules.length;

  // Find the next prompt day from active schedules
  let nextPromptDay = null;
  if (activeCount > 0) {
    const todayDow = new Date().getDay();
    let minDaysUntil = Infinity;

    for (const schedule of activeSchedules) {
      let daysUntil = (schedule.schedule_day_of_week - todayDow + 7) % 7;
      // If daysUntil is 0 (same day), treat as 7 (next week) since today's prompt likely already fired
      if (daysUntil === 0) daysUntil = 7;
      if (daysUntil < minDaysUntil) {
        minDaysUntil = daysUntil;
        nextPromptDay = DAY_NAMES[schedule.schedule_day_of_week];
      }
    }
  }

  // Determine the status badge
  const renderBadge = () => {
    if (loading) {
      return <span className="text-xs text-content-muted">Loading...</span>;
    }
    if (schedules.length === 0) {
      return (
        <span className="bg-surface-card-hover text-content-secondary rounded-full px-2 py-0.5 text-xs font-medium">
          No schedules
        </span>
      );
    }
    if (activeCount === 0) {
      return (
        <span className="bg-status-warning/10 text-status-warning rounded-full px-2 py-0.5 text-xs font-medium">
          All paused
        </span>
      );
    }
    return (
      <span className="bg-status-success/10 text-status-success rounded-full px-2 py-0.5 text-xs font-medium">
        {activeCount} active
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
            <span className="font-medium text-content-primary">Prompt Schedule</span>
          </div>
          {renderBadge()}
        </div>
        {!isExpanded && !loading && nextPromptDay && (
          <p className="text-sm text-content-muted mt-1 ml-6">
            Next prompt: {nextPromptDay}
          </p>
        )}
      </div>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isExpanded ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'
        }`}
      >
        <PromptScheduleManager
          groupId={groupId}
          group={group}
          userRole={userRole}
          variant="inline"
        />
      </div>
    </div>
  );
}
