'use client';

import { SelectControl } from '../../components/ui/Input';

/* DECISION Phase 88.6-33 (§4.5 EMPHASIS): all THREE `<label>`s in this fragment take
   `font-normal` over `font-bold`. 400 is correct because a field label beside its own control is
   not a heading — the same call plan 88.6-32 made on `BrowseMoreModal.js`'s "Sort:" label — and
   the shipped twins of these exact class strings are `createEvent.js:1202`, `:1217` and `:1253`,
   which ship `block text-sm font-normal … text-content-primary`. This fragment renders INSIDE
   that same create-event form, so converging on anything else would put two label weights in one
   form. The stated 400 is chosen OVER dropping the utility, matching those twins; both spellings
   satisfy the §4.5 scanner and the phase currently ships both (recorded for plan 46).

   THE 16px iOS-ZOOM FLOOR (§4.1), enumerated rather than assumed — this fragment renders three
   form controls and all three are confirmed compliant:
     1. the `winner_id` `<SelectControl>` — `text-base` via `controlClass` (`ui/Input.tsx:75`)
     2. the `picked_by_id` `<SelectControl>` — same
     3. the `is_group_win` `<input type="checkbox">` — renders NO text, so the floor (which
        exists to stop iOS zooming a focused text field) has nothing to act on. Its label is a
        sibling element, already covered by row 1's rung.
   No control here renders below 16px. */
export default function EventResultFields({ newEvent, handleChange }) {
  return (
    <>
      {/* Winner Selection */}
      <div>
        <label htmlFor="winner_id" className="block text-sm font-normal mb-1 text-content-primary">
          Winner
        </label>
        <SelectControl
          id="winner_id"
          value={newEvent.winner_id || ''}
          onChange={handleChange}
        >
          <option value="">Select winner (optional)</option>
          {newEvent.participants
            .filter(p => p.username && p.username.trim() !== "")
            .map((participant, index) => {
              // Use user_id if available, otherwise use a custom identifier
              const value = participant.user_id || `custom_${index}_${participant.username}`;
              return (
                <option key={index} value={value}>
                  {participant.username}
                </option>
              );
            })}
        </SelectControl>
      </div>

      {/* Picked By Selection */}
      <div>
        <label htmlFor="picked_by_id" className="block text-sm font-normal mb-1 text-content-primary">
          Picked By
        </label>
        <SelectControl
          id="picked_by_id"
          value={newEvent.picked_by_id || ''}
          onChange={handleChange}
        >
          <option value="">Select who picked the game (optional)</option>
          {newEvent.participants
            .filter(p => p.username && p.username.trim() !== "")
            .map((participant, index) => {
              // Use user_id if available, otherwise use a custom identifier
              const value = participant.user_id || `custom_${index}_${participant.username}`;
              return (
                <option key={index} value={value}>
                  {participant.username}
                </option>
              );
            })}
        </SelectControl>
      </div>

      {/* Group Win Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="is_group_win"
          checked={newEvent.is_group_win}
          onChange={handleChange}
          className="mr-2"
        />
        <label htmlFor="is_group_win" className="text-sm font-normal text-content-primary">
          Group Win
        </label>
      </div>
    </>
  );
}
