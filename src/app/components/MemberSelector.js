'use client';

import { Controller } from 'react-hook-form';

/**
 * MemberSelector - Member selection list with select-all, individual checkboxes, and count display
 *
 * @param {Object} props
 * @param {Array} props.members - Array of group members
 * @param {Object} props.control - react-hook-form control object
 * @param {Array} props.selectedMemberIds - Watched array of selected member IDs
 * @param {Function} props.onSelectAllMembers - Callback for select-all toggle (receives boolean)
 * @param {string|null} props.error - Error message for selected_member_ids validation
 */
export default function MemberSelector({
  members,
  control,
  selectedMemberIds,
  onSelectAllMembers,
  error = null,
}) {
  const allMembersSelected = members.length > 0 && selectedMemberIds.length === members.length;

  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Send to Members
      </label>
      <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
        {/* Select All */}
        <label className="flex items-center mb-2 pb-2 border-b border-gray-200">
          <input
            type="checkbox"
            checked={allMembersSelected}
            onChange={(e) => onSelectAllMembers(e.target.checked)}
            className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
          />
          <span className="font-medium text-gray-700">Select All</span>
        </label>

        {/* Individual members */}
        {members.map((member) => (
          <Controller
            key={member.user_id || member.id}
            name="selected_member_ids"
            control={control}
            render={({ field }) => (
              <label className="flex items-center py-1">
                <input
                  type="checkbox"
                  checked={field.value?.includes(member.user_id || member.id)}
                  onChange={(e) => {
                    const memberId = member.user_id || member.id;
                    const newValue = e.target.checked
                      ? [...(field.value || []), memberId]
                      : (field.value || []).filter(id => id !== memberId);
                    field.onChange(newValue);
                  }}
                  className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="text-gray-700">
                  {member.display_name || member.username || member.email || member.user_id}
                </span>
              </label>
            )}
          />
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Selected: {selectedMemberIds.length} of {members.length} members
      </p>
      {error && (
        <p className="text-red-500 text-sm mt-1">{error}</p>
      )}
    </div>
  );
}
