'use client';

import { useId, useState } from 'react';
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
  // AC-7: the header's `aria-controls` target. `useId` rather than a literal so two mounted
  // sections cannot collide on one id — the idiom already shipped at `CalendarListView.js:172`
  // and `ParticipantRow.js:13`.
  const panelId = `prompt-schedule-panel-${useId()}`;

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
  /* DECISION Phase 88.6-15 (D-31 / UI-SPEC §6.2 `:522-524`): this query's FAILURE gets NO
     surface of its own here, chosen OVER adding a `<FetchErrorBanner>` beside it. The
     `PromptScheduleManager` this file mounts below resolves the SAME `promptKeys.settings(groupId)`
     key under the SAME `Boolean(groupId) && Boolean(isAdmin)` gate, and it already renders the ONE
     banner for that failure. §6.2 allows exactly one live region per failure, and a nested
     component observing the parent's key does not mint a second one — it omits its own output.
     The only thing this query drives here is the `Next check-in:` line, which already omits on
     failure (`nextPromptDay` stays null when `schedules` is empty). Adding a banner here is a
     decision, not a cleanup. */
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
  const { data: openData, isPending: openPending, isError: openIsError } = useQuery({
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
  /* DATA PRESENCE, never a non-zero count. `openPollCount` is 0 both for a TRUE zero and for
     no data at all, so a retention branch keyed on "the count is non-zero" would silently blank
     a legitimate "No open polls" the moment a refetch failed over a successful-EMPTY cache — and
     a retained-COUNT test would never catch it, because it only ever exercises the populated
     case. TanStack (5.101.1) retains `data` across a refetch error, so `openData !== undefined`
     is exactly "the cache still holds something the user can trust". */
  const hasRetainedOpenData = openData !== undefined;

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
  /* DECISION Phase 88.6-15 (D-31 / T-88.6-36): on an open-polls FAILURE with nothing retained,
     this badge renders NOTHING — chosen OVER an error-toned failure chip in the collapsed header,
     and over the shipped behaviour where `:92` collapsed a rejection to a count of 0 and the
     header asserted "No open polls" at someone whose request had failed.

     WHY NOT A CHIP OR A BANNER HERE. The badge lives inside the `role="button"` header below, so
     any interactive failure surface would nest a control inside a control and its retry click
     would bubble to the header's `onClick` and toggle the section. The failure ALREADY has
     exactly one surface — `OpenPollsList`'s banner on the SAME open-polls key
     (`OpenPollsList.js:104-109`, DECISION-marked at `:37-42`) — and UI-SPEC §6.2 allows exactly
     one live region per failure.

     WHY THE COLLAPSED-AND-FAILED STATE SURFACING NOTHING IS ACCEPTED, and the fact it rests on:
     the only PRODUCTION mount passes `defaultExpanded={true}`
     (`src/app/groupPlanning/page.js:299-303`; `grep -rn '<PromptScheduleSection' src` returns 5
     hits — that one plus 4 test renders), so a first failure lands with the panel OPEN and the
     banner visible. The silent state is reachable only after the user DELIBERATELY collapses the
     section, which is what a disclosure control is for. THE CONDITION THAT RE-OPENS THIS
     DECISION: a mount that stops passing `defaultExpanded={true}`. If that happens the header
     must carry the failure itself.

     DO NOT re-tone the `openPollCount === 0` span below into a failure chip — re-merging the
     empty and failed states is the exact defect this closes, and `OpenPollsList.js:37-42` forbids
     it by name ("do not re-merge these two branches").

     WEIGHT (R3 / UI-SPEC §4.5, V-6): both chips moved `font-medium` -> `font-bold`. §4.5's
     pill/chip row is explicit that 400 is REJECTED for this family because the fill/ink pairing
     needs the weight to read as a chip at 12px — these two carry a fill (`bg-surface-muted` /
     `bg-status-success-subtle`) and are the same family. Dropping to `font-normal` is the
     recorded rejected arm. */
  const renderBadge = () => {
    if (openPollsLoading) {
      return <span className="text-xs text-content-muted">Loading...</span>;
    }
    // Retained data wins over the error: a count — or a true zero — the user can still trust
    // must not be replaced with nothing. Only a failure with an EMPTY cache omits.
    if (!hasRetainedOpenData && openIsError) {
      return null;
    }
    if (openPollCount === 0) {
      return (
        <span className="bg-surface-muted text-content-secondary rounded-full px-2 py-0.5 text-xs font-bold">
          No open polls
        </span>
      );
    }
    return (
      <span className="bg-status-success-subtle text-content-status-success rounded-full px-2 py-0.5 text-xs font-bold">
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
          Turning this into a `<button>` "for correctness" is a decision, not a cleanup.

          ——— AMENDED Phase 88.6-15 (AC-7, owner ruling 2026-09-09 option 1), every sentence
          above KEPT AS HISTORY — the `role="button"`-over-`<button>` choice and its `<button><p>`
          hydration reason are unchanged and still live. WHAT IS NEW: this header now carries
          `aria-controls` naming the panel it toggles (it had `aria-expanded` and ZERO
          `aria-controls`), and the panel below LEAVES THE TAB ORDER AND THE A11Y TREE while
          collapsed, gated with the HTML `hidden` attribute. Chosen OVER leaving the CSS-only
          collapse in place: `overflow-hidden` + `max-h-0 opacity-0` hides a panel VISUALLY while
          every descendant control inside it — `AutoPromptBehaviorBanner`, `OpenPollsList`'s
          "Start a poll" and its `FetchErrorBanner`, and for an admin the inline
          `PromptScheduleManager`'s "Try again" / "Report this" — stayed focusable and announced.
          WCAG 2.4.3 and 2.4.7.

          `inert` IS NOT AN OPTION HERE and the choice is not the next executor's. Probed against
          this repo's `node_modules` 2026-09-14: `@testing-library/dom`'s `isSubtreeInaccessible`
          consults `element.hidden`, `aria-hidden` and computed `display` and nothing else, and
          the token `inert` appears ZERO times in `@testing-library/dom/dist`, ZERO times in
          `jsdom/lib/jsdom` and ZERO times in `user-event/dist/cjs`; React is 18.2.0, which has no
          boolean `inert` prop. Under `inert`, neither half of AC-7 could be PROVEN by this
          surface's own gate — the only green-able assertion would be an attribute pin, i.e.
          silent false coverage on an a11y fix an owner ruled into this phase.

          GIVEN UP, deliberately: the 200ms expand/collapse height transition, which `hidden`
          (display:none) defeats. REJECTED ALTERNATIVE: applying `hidden` on `transitionend`
          (animate out, then hide) — disproportionate machinery on the phase's tracer plan.
          Reverting to the CSS-only collapse is a decision, not a cleanup. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={panelId}
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
            {/* DECISION Phase 88.6-15 (owner ruling #165, 2026-09-14): the chevron is marked
                DECORATIVE, chosen OVER accepting the bare svg and OVER auditing the whole
                Section (R7 stays scoped to modals — no Section axe audit is added here and R7's
                surface list is not amended). The header's accessible name comes from the
                "Check-ins" span plus the badge; the svg never contributed to it, so
                `keyboardOperability.test.tsx:87`'s `{ name: /check-ins/i }` is undisturbed. */}
            <svg
              aria-hidden="true"
              className={`w-4 h-4 text-content-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {/* R3 / UI-SPEC §4.5 (V-6): `font-medium` -> `font-bold`. This is the section's
                title — the HIERARCHY outcome, not the emphasis one, so 700 rather than
                "400 + a colour token". It stays a `<span>`: this file has no `<h3>` and D-04
                mints no heading where none existed (P4). */}
            <span className="font-bold text-content-primary">Check-ins</span>
          </div>
          {renderBadge()}
        </div>
        {!isExpanded && isAdmin && !loading && nextPromptDay && (
          <p className="text-sm text-content-muted mt-1 ml-6">
            Next check-in: {nextPromptDay}
          </p>
        )}
      </div>
      {/* AC-7: `hidden` is what removes this panel from the tab order AND the a11y tree while
          collapsed — see the amended marker on the header above for the ruling, the `inert`
          evidence and the transition given up. The `max-h-0 opacity-0` pair is KEPT rather than
          deleted: it is the EXPANDING half's animation (the panel animates in), and it is what
          renders correctly in the fraction of a frame between the attribute clearing and paint.
          Deleting `hidden` to "get the collapse animation back" re-opens WCAG 2.4.3 / 2.4.7. */}
      <div
        id={panelId}
        hidden={!isExpanded}
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
