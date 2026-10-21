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
  // Optional per-verdict sequence (the FormField `errorKey` idiom, plan 88.6.1-26): bumped per
  // verdict, it re-mounts the alert so an identical second error is announced again.
  errorKey = undefined,
}) {
  const allMembersSelected = members.length > 0 && selectedMemberIds.length === members.length;

  return (
    <div className="mb-6">
      {/* 88-33 Task 8 (census class C): a SPAN naming the SECTION via role="group",
          not an orphan <label> — there is no single control for htmlFor to point at
          (same treatment as createEvent's Participants title, 88-21). */}
      {/* DECISION Phase 88.6-33 (§4.5 EMPHASIS): `font-normal` over `font-bold` on this section
          label. 400 is correct because this is a field-level label beside its own control group,
          not a heading — and the marker directly above names `createEvent`'s Participants title
          (88-21) as this site's treatment twin, which ships exactly this class string with an
          explicit `font-normal` (`createEvent.js`, the Participants title at
          `id="participants-section-label"`; re-pointed by anchor in 88.6.1-26, the old `:1290`
          had drifted and plans 15 and 26 moved it again). The stated 400 is chosen OVER simply
          dropping the utility so the weight is pinned rather than inherited; both spellings
          satisfy the §4.5 scanner, and the phase currently ships both (recorded for plan 46).

          ——— AMENDED quick-261020-tz3 (VO-P2-4, owner VoiceOver walk 2026-10-20), the reasoning
          above KEPT AS HISTORY: the Participants twin in `createEvent.js` took heading semantics
          (a level-3 heading named "Participants (required)") for an iOS VoiceOver reason — its
          name has to carry "(required)", and on iOS a heading with a label is the element
          VoiceOver lands on. So the "not a heading" wording above is now stale FOR THE TWIN only.
          The class-string twinning and this label's 400 weight stand. This label carries no
          "(required)" and stays a plain label naming its group. */}
      <span id="member-selector-label" className="block text-sm font-normal text-content-secondary mb-2">
        Send to Members
      </span>
      <div
        role="group"
        aria-labelledby="member-selector-label"
        aria-describedby={error ? 'member-selector-error' : undefined}
        className="border border-line rounded-card p-3 max-h-48 overflow-y-auto"
      >
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
          {/* DECISION Phase 88.6-33 (§4.5 HIERARCHY): `font-bold` (700) over the EMPHASIS
              outcome (400 + a colour token) — the OPPOSITE call from the section label six lines
              above, deliberately. §4.5's emphasis arm requires a colour token to be doing the
              work, and here there is none available: this row carries the SAME
              `text-content-secondary` as every individual member name below it, so dropping to
              400 would erase the only signal separating the select-all control from the members
              it governs. Re-inking it instead was rejected as a look change with no owner.
              Weight is the only lever left, which is exactly the case §4.5 routes to 700. */}
          <span className="font-bold text-content-secondary">Select All</span>
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
      {/* DECISION Phase 88.6.1-26 (Req 8, D-42): the FormField shape — a conditional
          `role="alert"` paragraph with an id, associated by the group's `aria-describedby` only
          while it is present — chosen for consistency with every other field error in
          ScheduleForm. REJECTED: an always-mounted region (one more empty assertive region on a
          form whose house rule is one failure region per surface — plan 88.6.1-15's FormField
          record) and leaving it unassociated (it was announced by nothing and tied to nothing).
          `key={errorKey}` is the FormField per-verdict idiom (ScheduleForm passes `submitCount`).
          NOTE: no `scheduleSchema` rule emits a message at `selected_member_ids` today
          (`scheduleFormSchema.js`, `selected_member_ids: z.array(z.string()).default([])`), so this
          branch renders only once a rule exists — the shape is fixed now so that rule inherits an
          announced, associated error. Changing this is a decision, not a cleanup. */}
      {error && (
        <p key={errorKey} id="member-selector-error" role="alert" className="text-content-status-error text-sm mt-1">{error}</p>
      )}
    </div>
  );
}
