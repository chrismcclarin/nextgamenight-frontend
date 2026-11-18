'use client';
import { useEffect, useId, useRef } from 'react';
import { Input } from '@/components/ui/Input';
import { StatusRegion } from '@/components/ui/StatusRegion';

export default function ParticipantRow({ participant, index, groupMembers, onParticipantChange, onToggleParticipant, duplicateOfName = null, requestNameFocus = false, onNameFocusHandled = undefined }) {
  /* DECISION Phase 88-21 (DEF-88-10-01): control ids come from `useId`, NOT from the `index`
     prop. Chosen OVER `participant-${index}-score`, which is the obvious shape and is what the
     surrounding code already has in hand. Index-derived ids are only unique WITHIN one list, and
     this row renders in more than one place; two participant lists on a page would mint duplicate
     ids and `htmlFor` would then resolve to whichever control the browser saw first — silently
     mislabelling the second list. Re-deriving these from `index` is a decision, not a cleanup. */
  const rowId = useId();

  // 88-33 Task 4 (UAT row 542): when the parent flags this row as freshly added,
  // focus its name input and scroll it into view within the modal's scroll region.
  // `scrollIntoView` is guarded — jsdom does not implement it.
  const nameInputRef = useRef(null);
  useEffect(() => {
    if (!requestNameFocus) return;
    const node = nameInputRef.current;
    if (!node) return;
    node.focus();
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
    onNameFocusHandled?.();
  }, [requestNameFocus, onNameFocusHandled]);

  const nameId = `${rowId}-name`;
  const scoreId = `${rowId}-score`;
  const factionId = `${rowId}-faction`;
  const newPlayerId = `${rowId}-new-player`;
  const hintId = `${rowId}-name-hint`;

  return (
    // 87.8-13 walkthrough F-3: stacked at phone width (name line + wrapping
    // controls line) — the single-row layout's ~350px fixed control cluster
    // forced the whole participant list into horizontal scroll at 375px.
    // sm:+ is the original one-line layout, unchanged.
    // AMENDED Phase 88.9-52 (R15b, owner 2026-11-17: pick As is, mock one-line-remove-as-is): the one-line
    // layout now starts at md (was sm) and is REBUILT: Participant Name, Score and Faction on one line,
    // every label a block 4px above its box, the three boxes the same height (42px, the field look of
    // R15c) with bottoms level, Remove left at 44px with its bottom on the same line. Measured on the
    // mock at 1280: label line 20px, boxes 42 / 42 / 42, bottoms level, row 83px (was 107px with boxes
    // 42 / 34 / 34 on three different bottoms). Chosen OVER the shipped sm layout (inline-left Score and
    // Faction labels, the controls centred on the whole label-plus-box stack) and OVER Remove shrunk to
    // 42px (the mock he did not pick).
    // HOW the boxes stay level: the two columns are TOP-aligned (md:items-start) and both open with the
    // same one-line label (20px) and the same mb-1, so the boxes share a top and, at one height, a
    // bottom; Remove is bottom-aligned inside the controls group (items-end). Chosen OVER bottom-aligning
    // the whole row (md:items-end): the duplicate-name hint grows the name column downward, and Score,
    // Faction and Remove would then sink to the hint's line. Going back to md:items-end, or to labels
    // beside their boxes, is a decision, not a cleanup.
    // Below md the row keeps its two lines (name; then Score, Faction, Remove), with the same box look.
    //
    // DECISION Phase 88-26 (D-35/D-34): this row divider is the ONE site in the 41-site sweep
    // promoted to the STRONG hairline instead of taking the mechanical `-line` default. Rows
    // here have no background alternation, so this rule is the entire separation between one
    // participant and the next — D-34's "must be SEEN as a separator in isolation" case, and
    // the reason D-34 darkened the strong token rather than the neutral one (darkening the
    // neutral was rejected as a 280-site re-theme). In-repo precedent for the same role:
    // gameDetail/page.js's between-session rule and Header.js's sticky-header underline.
    // Demoting this to the neutral is a decision, not a consistency cleanup.
    <div className="flex flex-col md:flex-row md:items-start gap-2 md:gap-4 p-2 border-b border-line-strong">
      <div className="md:flex-1 md:min-w-0">
        {/* DECISION Phase 88.9-65 (X40, owner at N32: right justified on the participant name line): ONE New Player checkbox there at every width, its label a real 44px box (WCAG 2.5.8 floor 24, house floor 44), chosen OVER two width-gated twins (two controls for one value) and OVER an invisible extension (it would cover the name input). The line grows about 24px.
            It replaces the owner refinement of 2026-08-04 on F-3, which put a phone-only twin on this line and kept a second checkbox in the controls row from the small breakpoint up.
            AMENDED Phase 88.9-52 (R15b, owner 2026-11-17: "couldn't they sit closer to the form? Does the checkbox need that much space around it?"): from md up the label is COMPACT (no 44px box, a 6px gap), so the line is one 20px text line and Participant Name sits 4px above its box (was 15.5px, held off by the 44px box); the desktop compaction is the owner's ruling, chosen OVER the 44px box at every width. Below md the 44 by 44 tap box is KEPT (max-md:min-h-11 / max-md:min-w-11). Still ONE checkbox, on this line, at every width: never a second copy. The line is centred (items-center, was items-baseline) so the phone's 44px box and the name label share a middle. */}
        {/* DECISION Phase 88.9-65 (X43): every label here reads text-content-primary, R2-14's measured ink (17.97 / 10.64), chosen OVER the lighter ink Participant Name alone carried. */}
        <div className="flex items-center justify-between mb-1">
          {/* 88-33 Task 8 (census class B — the 3 red-tag broken label[for]): member rows
              render a read-only DIV, so a label[for] here pointed at a nonexistent form
              element — an actively wrong association. The <label> renders ONLY when the
              input it names actually exists (custom rows); member rows get a span. */}
          {participant.isFromGroup ? (
            <span className="text-sm text-content-primary block">Participant Name</span>
          ) : (
            <label htmlFor={nameId} className="text-sm text-content-primary block">Participant Name</label>
          )}
          <label className="inline-flex max-md:min-h-11 max-md:min-w-11 items-center gap-2 md:gap-1.5">
            <input
              id={newPlayerId}
              name={newPlayerId}
              type="checkbox"
              checked={participant.is_new_player || false}
              onChange={(e) => onParticipantChange(index, 'is_new_player', e.target.checked)}
            />
            <span className="text-sm text-content-primary">New Player</span>
          </label>
        </div>
        {participant.isFromGroup ? (
          // Read-only display for group members.
          // 88-33 Task 6 (fork 2 layout, UAT row 390): INLINE flow, not flex — the
          // pill rides after the LAST WORD of the name like text, so a long name
          // wraps in full (never truncated) and the pill never strands alone on
          // its own line. `break-words` covers a 50-char unbroken name.
          /* R2 / UI-SPEC §4.3: the participant's NAME is this row's ONE primary string and takes
             Body 16. It also CONVERGES the two branches: the editable twin below is the `Input`
             primitive, which authors no size utility and therefore already renders at body size —
             so the read-only branch was the odd one out at 14, and a member row and a custom row
             printed the same name at two different sizes. Everything else in this row is §4.3's
             metadata/label case and does NOT move. */
          /* DECISION Phase 88.9-52 (R15c, owner pick Field, 2026-11-17): this read-only box wears the
             type-in field look, the house Input's own classes (rounded-btn, border-input,
             bg-surface-input, p-2; 42px tall at one line), chosen OVER the lighter display look it had
             (border-line, rounded-sm, bg-surface-elevated), which the first mock copied ONTO Score and
             Faction and made the editable fields read as displays (capture j, item 3). It stays a
             plain div: no caret, no tab stop, no focus ring, and its label is a span. No recorded
             house look for a read-only field exists (searched the ui primitives and globals.css), so
             none is added; giving it a different fill or edge again is a decision, not a cleanup.
             The phone floor (max-md:min-h-11) is NOT copied: nothing here is tappable, and the
             picked phone mock keeps this box at 42px. Edge against the list box fill around it (the same
             input fill): 4.11 light, 2.79 dark, exactly what Score and Faction already measure here
             (was 2.31 light, 1.45 dark with the lighter edge). */
          <div className="p-2 border border-input rounded-btn bg-surface-input text-content-primary text-base break-words">
            {participant.username || `Participant ${index + 1}`}
            {participant.is_guest && (
              /* §4.5's pill/chip-ink row: 600/500 -> 700, with 400 REJECTED because a FILLED
                 chip's fill/ink pairing needs the weight to hold its shape. 12px stays — badge
                 labels are an enumerated Caption role. Same call as `ScheduleList`'s status chips
                 (plan 32) and `PromptScheduleSection`'s header chips (plan 15). */
              <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 align-middle">
                Guest
              </span>
            )}
          </div>
        ) : (
          // Editable input for custom participants
          <div className="flex items-center gap-2">
            <Input
              ref={nameInputRef}
              id={nameId}
              name={nameId}
              type="text"
              aria-describedby={duplicateOfName ? hintId : undefined}
              value={participant.username || ''}
              onChange={(e) => {
                const value = e.target.value;

                // Try to find matching group member
                const matchingMember = groupMembers.find(m =>
                  m.username?.toLowerCase() === value.toLowerCase() ||
                  m.email?.toLowerCase() === value.toLowerCase()
                );

                /* DECISION Phase 88-33 Task 2 (M5, UAT row 497): ONE atomic patch, not two
                   sequential single-field calls — on BOTH branches. The shipped shape fired
                   `username` then `user_id` in the same tick and the parent rebuilt from a stale
                   closure each time, so the second call clobbered the first and the completing
                   keystroke of any member's name was permanently lost. The no-match branch
                   double-fired too (set username + clear user_id), so it is patched here as well.
                   Splitting this back into two calls re-opens M5 even with a functional
                   setState upstream, because the two would still race within the tick. */
                onParticipantChange(index, {
                  username: value,
                  user_id: matchingMember ? matchingMember.id : '',
                });
              }}
              placeholder="Type name (group member or custom)"
              // 88-33 Task 6 (fork 2, RULED 2026-08-17): person names cap at 50 AT
              // ENTRY (matches the username cap in userProfile); display always
              // wraps in full — never truncates. Group name keeps its own 40.
              // BE mirror: 88-34 Task 4.
              maxLength={50}
            />
            {participant.is_guest && (
              /* The custom-row twin of the Guest chip above; same §4.5 pill/chip outcome, applied
                 in the same pass so the two branches cannot diverge. */
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 shrink-0">
                Guest
              </span>
            )}
          </div>
        )}
        {/* Duplicate-name hint (88-33 Task 2 step 3b / triage A1). Empty-first live region so a
            newly-typed duplicate is announced as a CHANGE rather than a fresh mount. Non-blocking
            by design — fork 3 allows duplicates.
            DECISION Phase 88.6.1-06 (D-22): the `mt-1` is the hint's spacing WHEN SHOWN. While the
            hint is empty, srOnlyWhenEmpty takes it out of flow, so no custom row reserves 4px under
            its name line; removing the prop brings back a 4px gap under every custom row. A
            conditional `mt-1` ternary was rejected as the per-site duplication D-22 retires. */}
        {!participant.isFromGroup && (
          <StatusRegion
            id={hintId}
            politeness="polite"
            srOnlyWhenEmpty
            className="mt-1 text-xs text-content-muted"
          >
            {duplicateOfName
              ? `Heads up: there's already a participant named ${duplicateOfName}.`
              : ''}
          </StatusRegion>
        )}
      </div>

      {/* Owner refinement round 2 (2026-08-04): score trimmed to 4-digit width;
          Faction flexes at phone (absorbs the leftover line width — factions
          range from absent to long names, so it gets whatever room exists);
          items-end aligns the buttons with the input line at phone. Net effect:
          Score + Faction + Remove share ONE line on normal rows — Remove no
          longer strands alone below. sm:+ keeps the original centered flow.
          AMENDED Phase 88.9-52 (R15b): items-end now holds at EVERY width (the centred flow from sm is
          gone: it put Remove 7px above the boxes' bottoms), and from md the group never wraps and takes
          the row's 16px gap. The marker is at the top of this row. */}
      <div className="flex flex-wrap md:flex-nowrap gap-2 md:gap-4 items-end">
        <div>
          {/* block at phone: label ABOVE the box (owner round 3) — inline-left
              labels were also silently eating Faction's stretch room. sm:+ keeps
              the original inline-left look.
              AMENDED Phase 88.9-52 (R15b): the label is above its box at EVERY width now, 4px clear
              of it (mb-1, the dialog's smallest label gap: Game, Winner, Picked By, Comments);
              Faction's label below is the same. */}
          <label htmlFor={scoreId} className="text-sm text-content-primary block mb-1">Score</label>
          {/* DECISION Phase 88-21 (Req 1): adopts `Input` for the 16px floor but KEEPS `w-16 p-1`
              as an override, OVER taking the primitive's default `w-full p-2`. Those two values
              are the owner's 2026-08-04 round-2/round-3 phone tuning (score trimmed to 4-digit
              width so Score + Faction + Remove share ONE line at 375px instead of stranding
              Remove below) — see the block comment above this row. Widening them back to the
              primitive default re-breaks that layout; it is a decision, not a cleanup. The
              primitive's `max-md:min-h-11` touch floor IS taken, because that grows the row
              vertically, which the tuning never constrained.
              AMENDED Phase 88.9-52 (R15c, owner pick Field, 2026-11-17): the p-1 override is DROPPED
              on Score and Faction, so both take the Input's own p-2 (42px tall from md up, the name
              box's height; 44px on a phone), chosen OVER keeping p-1 (34px boxes beside a 42px name
              box, the R15b complaint). The WIDTHS are kept: w-16 here, and Faction's phone stretch,
              so the three still share one line at 375 (64 + 8 + at least 96 + 8 + 73 inside 291). */}
          <Input
            id={scoreId}
            name={scoreId}
            type="number"
            step="0.01"
            value={participant.score || ''}
            onChange={(e) => onParticipantChange(index, 'score', e.target.value)}
            className="w-16"
            placeholder="0"
          />
        </div>

        <div className="flex-1 min-w-24 md:flex-none">
          <label htmlFor={factionId} className="text-sm text-content-primary block mb-1">Faction</label>
          <Input
            id={factionId}
            name={factionId}
            type="text"
            value={participant.faction || ''}
            onChange={(e) => onParticipantChange(index, 'faction', e.target.value)}
            className="w-full md:w-24"
            placeholder="Optional"
          />
        </div>

        {/*
          DECISION Phase 88-33 Task 2 step 4b (2026-08-20) — AMENDMENT, D-39 house style. The
          "Invite to group" button that used to live here is DELETED, and with it the two markers
          that documented its className. Both originals are preserved verbatim below because they
          are cross-referenced from other files; only their SUBJECT is gone.

          WHY DELETED, not wired: it was dead AND unwireable. `createEvent.js` is its only consumer
          and never passed `isAdmin`/`group_id`, so the branch never rendered — but wiring those in
          would not have helped: the handler called `invitesAPI.sendInvite(group_id, email)` and a
          draft participant has NO email (Phase 83-06 PII default-deny strips participant emails
          from every client payload), so the guard `if (!participant.email) return` could never
          pass. A draft CUSTOM participant is also not a user at all — there is nobody to invite.
          The live, working analogue is `GuestInviteButton` in `gameDetail/page.js`, which invites
          by `participant_user_id` and resolves the email server-side; that is the surface UAT row
          614 was actually walked on and the one Task 2 hardened.

          ORIGINAL MARKER 1, verbatim (Phase 87.7 D-18, className-string shape): "the branches
          below used to also carry `border-status-*` and `bg-status-*` opacity-modifier tokens.
          Those were REMOVED, not rewritten. On Tailwind v3 a `/N` modifier on a `var()`-backed
          colour generated no class at all, so these branches have always rendered with no tint and
          no coloured border — removal is what reproduces today's rendering. Rejected: (a) dropping
          the `/N` to keep the base class, which paints a SOLID status-coloured block — the exact
          regression being avoided; (b) making the tints work via `color-mix`, which is a deliberate
          visual change and this phase forbids those. The `text-status-*` tokens survive and carry
          the semantics. ... One of exactly two markers for this ~91-line strip — see RsvpSection.js
          for the object-literal shape." The census file it cites is `87.7-OPACITY-CENSUS.md` in the
          phase-87.7 planning directory. RsvpSection.js's twin marker is UNAFFECTED and still live.

          ORIGINAL MARKER 2, verbatim (Phase 88-27, D-32 buckets A/B/C): "the neutral `border-line`
          STAYS on the base and each branch overrides it, chosen OVER moving the colour onto every
          branch (which is the other way to satisfy D-35). This is a plain template literal with no
          tailwind-merge, so stylesheet order decides the winner — MEASURED in a real `next build`
          of this app, not reasoned: `.border-line` is emitted at offset 35468 and
          `.border-status-success/-error` at 35906/35959, i.e. AFTER, so the branch wins. 88-26 hit
          the mirror image of this at TutorialGrid, where the neutral was emitted LAST and DID
          overpaint the caller." `gameDetail/page.js`'s GuestInviteButton marker cites THIS one by
          file — that measured cascade fact stands on its own there and needs no edit.

          Restoring an invite affordance to this row is a decision (it needs a user_id-based
          endpoint and an admin-reachable surface), not a cleanup.
        */}
        {/* ml-auto cluster: Remove wraps as one right-aligned unit at phone width (owner
            refinement round 2 — a guest row's tight line was stranding Remove alone below).
            Remove stays outermost right: destructive control at the end of the row, matching the
            session-row Edit/Delete side (owner call 2026-08-04). sm:+ keeps the original flow
            (from md since 88.9-52 R15b; Remove itself is untouched, 44px at every width). */}
        <div className="flex gap-2 ml-auto md:ml-0">
          {/* 88-33 Task 6: min-h-11 — Task 5 imposes the 44px floor on the
              equivalent controls elsewhere in this plan; leaving this one below
              it would be a same-plan inconsistency (r2/r3 triage). Grows the row
              vertically only, which the one-line layout tuning above never
              constrained (same reasoning as the Score input's recorded floor). */}
          <button
            type="button"
            onClick={() => onToggleParticipant(index)}
            className="inline-flex min-h-11 items-center text-content-status-error hover:text-content-status-error text-sm px-2 py-1 border border-status-error rounded-sm hover:bg-status-error-subtle"
            title="Remove participant"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
