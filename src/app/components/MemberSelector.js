'use client';

import { Controller } from 'react-hook-form';

/**
 * MemberSelector - Member selection list with select-all, individual checkboxes, and count display
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
      {/* 88-33 Task 8 (census class C): a SPAN naming the SECTION via role="group",
          not an orphan <label> — there is no single control for htmlFor to point at
          (same treatment as createEvent's Participants title, 88-21). */}
      <span id="member-selector-label" className="block text-sm font-medium text-content-secondary mb-2">
        Send to Members
      </span>
      <div role="group" aria-labelledby="member-selector-label" className="border border-line rounded-card p-3 max-h-48 overflow-y-auto">
        {/* Select All */}
        <label className="flex items-center mb-2 pb-2 border-b border-line">
          <input
            id="member-select-all"
            name="member-select-all"
            type="checkbox"
            checked={allMembersSelected}
            onChange={(e) => onSelectAllMembers(e.target.checked)}
            className="mr-2 h-4 w-4 rounded-sm border-line"
          />
          <span className="font-medium text-content-secondary">Select All</span>
        </label>

        {/* Individual members */}
        {members.map((member) => (
          <Controller
            key={member.id}
            name="selected_member_ids"
            control={control}
            render={({ field }) => (
              <label className="flex items-center py-1">
                <input
                  id={`member-select-${member.id}`}
                  name={`member-select-${member.id}`}
                  type="checkbox"
                  // 87.4 PR-2 (D-02): the PR-1 both-keys tolerance is collapsed to
                  // UUID-only. selected_member_ids now stores member.id (the
                  // Users.id UUID) exclusively -- the sub arm is gone from the
                  // React key, the checked-state read, and the write below.
                  checked={field.value?.includes(member.id)}
                  onChange={(e) => {
                    const memberId = member.id;
                    const newValue = e.target.checked
                      ? [...(field.value || []), memberId]
                      : (field.value || []).filter(id => id !== member.id);
                    field.onChange(newValue);
                  }}
                  className="mr-2 h-4 w-4 rounded-sm border-line"
                />
                <span className="text-content-secondary">
                  {/* 87.4 review PR2-L5: never render a raw identifier as a label —
                      a username-less member falls back to 'Member', not their UUID. */}
                  {member.display_name || member.username || member.email || 'Member'}
                </span>
              </label>
            )}
          />
        ))}
      </div>
      <p className="text-xs text-content-muted mt-1">
        Selected: {selectedMemberIds.length} of {members.length} members
      </p>
      {error && (
        <p className="text-status-error text-sm mt-1">{error}</p>
      )}
    </div>
  );
}
