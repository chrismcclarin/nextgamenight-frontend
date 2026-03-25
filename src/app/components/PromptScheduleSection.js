'use client';

import { useState } from 'react';
import PromptScheduleManager from './PromptScheduleManager';

/**
 * PromptScheduleSection - Collapsible inline section for the group page
 * Shows prompt schedule management for owner/admin roles only.
 * Collapsed by default with a chevron toggle.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' | 'pending'
 */
export default function PromptScheduleSection({ groupId, group, userRole }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Only visible to owner and admin
  if (userRole !== 'owner' && userRole !== 'admin') {
    return null;
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Prompt Schedule
      </button>
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
