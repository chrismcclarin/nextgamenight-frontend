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
      <label className="block text-sm font-medium text-content-secondary mb-2">
        Send to Members
      </label>
      <div className="border border-line rounded-card p-3 max-h-48 overflow-y-auto">
        {/* Select All */}
        <label className="flex items-center mb-2 pb-2 border-b border-line">
          <input
            type="checkbox"
            checked={allMembersSelected}
            onChange={(e) => onSelectAllMembers(e.target.checked)}
            className="mr-2 h-4 w-4 rounded border-line"
          />
          <span className="font-medium text-content-secondary">Select All</span>
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
                  // 87.4 PR-1 (D-02): a stored selected_member_ids entry may be
                  // the member's sub (pre-backfill) OR their UUID (post-backfill),
                  // so match against EITHER key -- not just whichever is truthy
                  // first -- else a backfilled schedule renders every box
                  // unchecked and re-saving silently drops the members.
                  checked={field.value?.includes(member.user_id) || field.value?.includes(member.id)}
                  onChange={(e) => {
                    // ADD keeps writing the member's sub during PR-1 (falls back
                    // to id only when a member has no sub) so writes stay
                    // sub-based and either BE/FE deploy order is safe; Plan 10
                    // (PR-2) collapses this to id-only.
                    const addId = member.user_id || member.id;
                    // REMOVE must drop whichever key is actually stored (sub OR
                    // UUID); a sub-only filter leaves a backfilled UUID entry
                    // behind, so the box re-renders checked and the member can
                    // never be deselected.
                    const newValue = e.target.checked
                      ? [...(field.value || []), addId]
                      : (field.value || []).filter(id => id !== member.user_id && id !== member.id);
                    field.onChange(newValue);
                  }}
                  className="mr-2 h-4 w-4 rounded border-line"
                />
                <span className="text-content-secondary">
                  {member.display_name || member.username || member.email || member.user_id}
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
