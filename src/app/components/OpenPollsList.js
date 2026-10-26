'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { promptAPI } from '../../lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import { collapseBlankLines } from '../../lib/collapseBlankLines';
import {
  openPromptsSchema,
  softFailPromptQueryFn,
  EMPTY_OPEN_PROMPTS,
} from '../../lib/schemas/prompts';
import KebabMenu from './KebabMenu';
import StartPollModal from './StartPollModal';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner, RefreshFailedNotice, RetainedContentFocusGuard, useRetainedContent } from '../../components/ui/FetchErrorBanner';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { toast } from 'sonner';

// DECISION 88.6.1 code review CR-6 / A-22 (owner ratified 2026-10-19): this section's RF1 notice
// passes the spoken-only `sectionName` (close ruling P-78's prop, FetchErrorBanner.tsx), so the
// notices that share its page are told apart by ear — in the region and in the Retry's
// description, never visibly. The name is the owner's ratified word, chosen OVER the section's
// visible heading (the review's lead): the ruling fixed short names per page.
// Changing it is a copy change (copyTable886_1.test.ts), not a cleanup.
const OPEN_POLLS_SECTION_NAME = 'Open polls';

/**
 * OpenPollsList — Phase 71.2 (POLL-01 / D-UI-01..04)
 *
 * Unified list of open availability prompts (manual + auto) for a group.
 * Renders the "Start a poll" entry point for any non-pending active member,
 * the source label per prompt (`Started by [creator]` for manual, `From
 * [schedule name]` for auto: the item's schedule_name first, which the backend
 * derives per request from the schedule that fired the poll, then the settings
 * include's template_name, then `From recurring schedule`), and a per-card
 * KebabMenu close action gated on the server-derived `can_close` flag.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' | 'pending'
 * @param {string} [props.currentUserDbId] - Caller's User.id UUID (currently
 *   informational; the can_close gate is server-derived in the response).
 * @param {{ current: HTMLElement | null }} [props.focusFallbackRef] - Where focus goes after an
 *   ended check-in's row leaves the DOM (Phase 88.6.1-29, H4): the host's own expand control.
 *   When omitted, the shared focus-recovery hook floors to the page (`main h1`, plan 88.6.1-04).
 */
export default function OpenPollsList({ groupId, group, userRole, currentUserDbId, focusFallbackRef }) {
  const [showStartPoll, setShowStartPoll] = useState(false);
  // Req 4 in-flight latch, keyed per check-in id: the ref refuses synchronously, the state
  // renders the End item's `ariaDisabled`. See DECISION Phase 88.6.1-29 (Req 4) above handleClose.
  const closingPromptIdsRef = useRef(new Set());
  const [closingPromptIds, setClosingPromptIds] = useState(() => new Set());
  const queryClient = useQueryClient();

  // Phase 84 (PRIM-07 / D-12): open prompts via useQuery on the shared promptKeys
  // factory so this fetch dedups with the parent Section's badge-count query
  // (F-826: 2x → 1x). Role gate mirrors the parent's pending exclusion (the
  // backend GET /prompts/open requires active membership) and is Boolean-wrapped
  // so `enabled` is never undefined.
  const openPollsQuery = useQuery({
    queryKey: promptKeys.openPolls(groupId),
    queryFn: softFailPromptQueryFn(
      openPromptsSchema,
      () => promptAPI.getOpenPrompts(groupId),
      promptKeys.openPolls(groupId),
      EMPTY_OPEN_PROMPTS,
    ),
    enabled: Boolean(groupId) && Boolean(userRole) && userRole !== 'pending',
  });

  const { data, isPending } = openPollsQuery;
  const loading = isPending;
  const prompts = data?.prompts || [];
  // 88.6.1-70 contract C3: DATA PRESENCE, never a count (the Section badge's `hasRetainedOpenData`
  // rule) — a list that loaded EMPTY is retained content too (owner ruling Y, D-50).
  const hasRetainedPollsData = data !== undefined;

  /* DECISION Phase 88-18 (Req 6 / T-88-18-01, UI-SPEC 9.2): a HARD fetch failure now renders the
     shared fetch-error treatment instead of falling through to the empty state. `softFailPromptQueryFn`
     only soft-fails a PARSE failure to EMPTY_OPEN_PROMPTS — a network/4xx/5xx rejection still rejects,
     leaving `data` undefined and `prompts` at [], which used to print "no active check-ins" at someone
     whose request had failed. Empty and failed are different facts and get different surfaces; do not
     re-merge these two branches.
     AMENDED Phase 88.6.1-75 (AC-29): a failure with data RETAINED now renders plan 88.6.1-70's RF1
     notice above that data, and the full banner only when nothing is retained (a first load, or an
     access or gone answer — plan 70's C10, through `useRetainedContent`). Empty and failed are still
     never merged: the empty state renders only when a SUCCESSFUL fetch returned zero. */
  const pollsErrorState = useFetchErrorState(openPollsQuery);
  const pollsRetained = useRetainedContent(hasRetainedPollsData, pollsErrorState, { queryKey: promptKeys.openPolls(groupId) });
  const focusRecovery = useFocusRecovery({ fallback: focusFallbackRef });

  // Post-write cache invalidation replaces the old loadPrompts() refetch — keeps
  // the open-polls list fresh after a direct-API write (A1/A4).
  const invalidateOpenPolls = () =>
    queryClient.invalidateQueries({ queryKey: promptKeys.openPolls(groupId) });

  // Gate alignment: parent PromptScheduleSection uses `!userRole || userRole
  // === 'pending' → return null`. We mirror the same negative check so any
  // future role addition (e.g. 'guest') evolves both gates together. No
  // positive role allowlist.
  const canCreate = userRole && userRole !== 'pending';

  /* DECISION Phase 88.6.1-29 (D-04, D-05, H4): ending a check-in arms plan 88.6.1-04's ONE shared
     focus-recovery hook at the START of this handler, with the host's own expand control (the
     Check-ins `role="button"` header, passed down as `focusFallbackRef`) as the fallback. The hook
     acts only once the ended row has left the DOM and only if focus was lost with it; without the
     prop it floors to the page `<h1>` (plan 04's floor). REJECTED, each for its reason:
     (a) a heading minted for Check-ins: D-05 forbids it, and the Section's own note keeps the title
         a span;
     (b) a fallback prop on KebabMenu: D-04 forbids it, and so does KebabMenu's own restore marker;
     (c) focusing after the refresh await resolves: TanStack commits the removal a macrotask after
         that (RESEARCH M-2.1, P-6), so focus would leave a row still on screen; the ordering arm of
         PromptScheduleSection.test.tsx shows that RED;
     (d) the next row's kebab trigger as `preferred`: D-05 names the expand control, whose
         accessible name carries the live count badge, so landing there announces the outcome; a
         next-row target announces only "Check-in actions";
     (e) the planning page's "Availability Polls" heading: it lies outside this component, and D-05
         names the section's own control.
     Changing the target is a decision, not a cleanup. */
  /* DECISION Phase 88.6.1-29 (Req 4, DECISION 88.6-22 rule of POSITION): one End request per
     check-in while the first is in flight. Before this, a re-commit from a re-opened menu sent a
     second PATCH, whose outcome was the backend's 409 and then the ratified "already closed" toast.
     The real order of refusal: while the request is in flight the End item carries
     `aria-disabled` through KebabMenu's shipped per-item `ariaDisabled` flag, and KebabMenu's
     handler refusal of a flagged item (`if (item.ariaDisabled) return;`) runs before its two-tap
     commit, so that is what refuses a re-commit from a re-opened menu. The per-id ref latch checked
     on the first line below is defense-in-depth for any caller of handleClose that bypasses that
     refusal; it refuses synchronously, and a refused commit does not re-arm the focus hook.
     REJECTED: the native `disabled` attribute (88.6-16 and 88.6-22: a natively disabled focused
     control blurs to `<body>`, and the focus hook would then read the user as having moved on).
     REJECTED: no guard, which leaves a concurrent double close to the backend.
     Removing either half is a decision, not a cleanup. */
  const handleClose = async (promptId) => {
    if (closingPromptIdsRef.current.has(promptId)) return;
    const settle = focusRecovery.arm();
    closingPromptIdsRef.current.add(promptId);
    setClosingPromptIds((prev) => new Set(prev).add(promptId));
    try {
      await promptAPI.closePrompt(promptId);
      // Backend has already flipped status to 'closed'; invalidate so the
      // GET /prompts/open query refetches and drops it from the list.
      await invalidateOpenPolls();
    } catch (err) {
      /* No `console.error` here on purpose: this file is NOT on `.eslintrc.json`'s legacy
         `no-console: off` allow-list, and adding it to that list to keep a log line would widen
         a deliberate deny. The failure is already reported to the person by the toast below and
         to Sentry by the global handler. */
      /* DECISION Phase 88-25 (Req 14 / Req 11, DEF-88-16-01, T-88-25-01): this is a toast with
         DERIVED copy, chosen OVER the native browser alert with an interpolated upstream message that
         shipped here. Three defects in one line: a browser alert is unstyled and blocks the page;
         the raw upstream message was painted at the user (ASVS V7); and it was one of the six
         native-alert sites DEF-88-16-01 censused as invisible to Req 11's confirm-only gate. (The
         literal calls are not written out here, comment included — those gates are plain greps
         and do not exempt comments; same convention as 88-11's marker in gameDetail.)

         It no longer "matches the existing PromptScheduleManager pattern" as the old comment
         said — that file still has two native alerts of its own and is NOT in this plan's scope.
         DEF-88-16-01 tracks the remaining four. Do not restore the alert for consistency with
         them; the debt runs the other way. */
      toast.error(
        getFetchErrorMessage(err, {
          fallback: "We couldn't end that check-in. Please try again.",
          // 88-CODE-REVIEW D2: 'conflict' ADDED, 'forbidden' KEPT — the remedy check
          // flagged that replacing this map would silently drop the forbidden copy
          // (a real, reachable 403 with no test pin at the time). The pins live in
          // useFetchErrorState.test.tsx: a mechanism pin over an identical byCode
          // literal, plus a SOURCE pin asserting this file still carries both arms
          // (delta-review correction 2026-08-06 — the mechanism pin alone could not
          // see this map drift). The 409 body can also read "Poll is already
          // converted"; the closed copy is the ratified approximate for both.
          byCode: {
            conflict: 'This check-in is already closed.',
            forbidden: 'Only the poll creator and group admins can end a check-in.',
          },
        })
      );
    } finally {
      settle();
      closingPromptIdsRef.current.delete(promptId);
      setClosingPromptIds((prev) => {
        const next = new Set(prev);
        next.delete(promptId);
        return next;
      });
    }
  };

  // A retained EMPTY list under the RF1 notice is still the empty state, so the 88-18 header-CTA rule
  // below keeps exactly one start-a-check-in CTA (header or empty state) in every state.
  const showEmptyState = !loading && (!pollsErrorState.showError || pollsRetained) && prompts.length === 0;

  return (
    <div>
      {/* DECISION Phase 88-18 (Req 6): this header CTA is SUPPRESSED while the empty state is
          showing, chosen OVER rendering both — the EmptyState carries the very same
          "+ Start a check-in" action six lines below it, and two identical primary buttons a
          finger-width apart is noise on a 375px phone. It is NOT suppressed while loading or
          erroring, so the action never disappears from under someone mid-render. grouplist.js
          deliberately keeps BOTH, because its button lives in a persistent panel header rather
          than directly above the list body. Restoring the unconditional render is a decision. */}
      {canCreate && !showEmptyState && (
        /* DECISION Phase 87.8 (D-13/D-14/AF-2): per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor — the global floor was considered and REJECTED because it would silently distort ~15 shipped compact/icon `.btn` sites (AF-2, e.g. BrowseMoreModal's 32x32 squares); 44px chosen OVER Material's 48dp, surfaced and consciously declined (D-14). The global `.btn` sizing question (all 210 sites) stays with Phase 88 (DEF-1) — this is a decision, not an oversight. No `min-w-11`: this wide text button already exceeds 44px rendered width (151px measured).  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup.  ——— AMENDED Phase 88.6 (D-09), original reasoning above KEPT AS HISTORY: the desktop half is now ANSWERED, and again by a split. TAKEN: `min-h-11` on the `Button` primitive's cva base (src/components/ui/Button.tsx ("LIVES ON THE cva BASE")), which reaches every viewport width. STILL REJECTED: the ALL-VIEWPORT floor on the `.btn` CLASS — `globals.css`'s `@media (width < 48rem)` rule is unwidened (src/app/globals.css ("or promoting the floor to all"), reasoning at src/app/globals.css ("DECISION Phase 88-01 (D-36, UI-SPEC")), because square-by-design controls wear `.btn` and a class-level floor would deform them. That is why both halves of this marker are still literally true: the rejection is about a rule on the CLASS; the new floor is on the PRIMITIVE, which only opted-in elements get. CONSEQUENCE: this per-CTA `min-h-11` becomes redundant ONLY once this element is a `<Button>`. Until this file's own migration sweep lands, deleting it still shrinks this control on desktop. When the sweep does land, dropping it is correct and is part of that commit — not a separate cleanup, and not something to do from here. */
        <Button
          variant="primary"
          className="mb-4"
          onClick={() => setShowStartPoll(true)}
        >
          + Start a check-in
        </Button>
      )}

      {/* DECISION Phase 88.6.1-75 (AC-29 / RF1): a failed REFRESH over check-ins that loaded keeps
          them on screen under plan 88.6.1-70's shared RefreshFailedNotice (copy row RF1, its
          REFRESH_FAILED_NOTICE constant, plus a Retry) — owner ruling 2026-10-05 (D-47) and the
          orchestrator's consistency decision that every retained-content site uses it. Three arms,
          one failure surface per state: loading; the FULL banner only when nothing is retained (a
          first load, or an access or gone answer), checked before the empty state; otherwise the
          notice, mounted unconditionally in that arm, above the list or above the empty state a
          SUCCESSFUL fetch returned.
          REJECTED: (a) the FULL banner above the retained list — plan 88.6.1-29's earlier-lap choice
          (the D-09a / D-41 shape): its title says the check-ins could not be loaded above check-ins
          that did load, which contradicts the screen; (b) the compact banner — both of its sentences
          (plan 21's compact notice and its after-failed-retry line) are about personal controls and
          are false for a list refresh; (c) the banner REPLACING the list (what shipped before this),
          which hid rows the Section's badge still counts; (d) retention keyed on a non-zero count —
          the r3 #14 trap, a successful empty list would blank (owner ruling Y: a list that loaded
          empty is retained content); (e) the notice over rows after a 401 / 403 refetch, or a local
          list of access codes — plan 70's useRetainedContent decides (C10), so the full banner says
          why and the rows are withdrawn until a success.
          Retention is DATA PRESENCE (`hasRetainedPollsData`, the Section badge's rule) passed through
          plan 70's useRetainedContent with this query's own key (`pollsRetained`, so the access memory
          outlives a remount); the notice's focus target is the Section's expand control
          (`focusFallbackRef`, D-05 — no heading is minted).
          C12: plan 70's RetainedContentFocusGuard sits right here, before the ternary and outside
          every arm, with the same target, so a row control that held focus when an access answer
          withdrew the rows hands it to the expand control, never the page body; the notice's own
          Retry is plan 70's. Changing this is a decision, not a cleanup. */}
      <RetainedContentFocusGuard retained={pollsRetained} focusTarget={focusFallbackRef} />
      {loading ? (
        // Matches copy row G4 (CHECK_INS_LOADING_LABEL in PromptScheduleSection.js), one U+2026 — VO-P2-7.
        <p className="text-content-muted text-sm py-4 text-center">Loading check-ins…</p>
      ) : pollsErrorState.showError && !pollsRetained ? (
        <FetchErrorBanner
          state={pollsErrorState}
          title="We couldn't load the check-ins"
          reportContext="Open availability check-ins list (group page)"
        />
      ) : (
        <>
          <RefreshFailedNotice
            state={pollsErrorState}
            retained={pollsRetained}
            focusTarget={focusFallbackRef}
            className="mb-4"
            sectionName={OPEN_POLLS_SECTION_NAME}
          />
          {prompts.length === 0 ? (
            // D-UI-03: unified empty-state COPY for ALL roles (admin/member alike);
            // only the CTA is role-gated, and that gate stays here at the call site.
            <EmptyState
              icon="Vote"
              heading="No check-ins running"
              body="Start one and everyone picks the nights that work — you'll see the overlap."
              action={
                canCreate ? (
                  /* The per-CTA `min-h-11` this used to carry is DROPPED, in the same commit as
                     the header button's `<Button>` migration above — the D-36 marker's own last
                     clause says that is when it becomes correct, because the cva base now supplies
                     the 44px floor at EVERY viewport (88.6-06 D-09). Both CTAs are the same action
                     and still the same touch target; what changed is where the floor comes from.
                     The floor itself is NOT optional here — see that marker. */
                  <Button
                    variant="primary"
                    onClick={() => setShowStartPoll(true)}
                  >
                    + Start a check-in
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-2">
              {prompts.map((p) => (
                <OpenPollCard
                  key={p.id}
                  prompt={p}
                  group={group}
                  closing={closingPromptIds.has(p.id)}
                  onClose={handleClose}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <StartPollModal
        groupId={groupId}
        group={group}
        isOpen={showStartPoll}
        onClose={() => setShowStartPoll(false)}
        onSuccess={() => {
          setShowStartPoll(false);
          invalidateOpenPolls();
        }}
      />
    </div>
  );
}

/**
 * OpenPollCard — single prompt row in the unified list.
 *
 * Source label rules (D-UI-02, quick-261025-rl3):
 *   - Auto-prompt (created_by_settings_id != null):
 *       "From {schedule_name}", the current name of the schedule that fired
 *       the poll, derived per request by the backend from the poll's own link.
 *       Falls back to the settings include's template_name (a backend that
 *       predates the link, or a settings row that still holds a name), then to
 *       "From recurring schedule" (no link and no name on the settings row).
 *       A DELETED settings row never reaches this arm: ON DELETE SET NULL clears
 *       created_by_settings_id itself, so the poll renders through the manual
 *       arm as "Started by a group member" (review 261025-rl3 FE-L1; no route
 *       deletes a settings row today, only a group deletion, which removes the
 *       group's polls with it).
 *   - Manual poll: "Started by {Creator.username}"
 *       Falls back to "a group member" if the Creator association is null.
 *
 * KebabMenu visibility is gated on the server-derived `can_close` flag.
 * Backend re-validates on PATCH (defense in depth) so a forged client-side
 * flag still fails with 403 — see threat T-71.2-11 in plan.
 */
function OpenPollCard({ prompt, group, closing, onClose }) {
  // DECISION quick-261025-rl3 (261025-dzo review WR-02), backend half at backend:Sonnet/routes/availabilityPrompt.js ("DECISION quick-261025-rl3"):
  // the automatic card names its schedule from the wire's schedule_name OVER the settings
  // include's template_name. The backend derives schedule_name per request from the poll's own
  // schedule link. The include's settings-level column is written by no backend route, so on its
  // own the label could only ever print the fallback. The include read stays second, OVER
  // dropping it, for a backend that predates the link and a settings row that still holds a
  // name. Reading the include first, or dropping schedule_name, is a decision, not a cleanup.
  const isAuto = !!prompt.created_by_settings_id;

  // schedule_name is the primary source of the auto label; the settings alias (either shape) is the fallback.
  const settingsRow = prompt.GroupPromptSetting || prompt.GroupPromptSettings;
  const sourceLabel = isAuto
    ? `From ${prompt.schedule_name || settingsRow?.template_name || 'recurring schedule'}`
    : `Started by ${prompt.Creator?.username || 'a group member'}`;

  // Resolve game name from group.games when available — falls back to the
  // generic title when the prompt has no associated game.
  const gameName = (() => {
    if (!prompt.game_id) return null;
    if (Array.isArray(group?.games)) {
      const g = group.games.find((x) => x.id === prompt.game_id);
      return g?.name || g?.title || null;
    }
    return null;
  })();
  const title = gameName || 'Availability check-in';

  // Format deadline in viewer's local timezone using Intl.
  const deadlineDisplay = (() => {
    if (!prompt.deadline) return '';
    try {
      const d = new Date(prompt.deadline);
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(d);
    } catch {
      return prompt.deadline;
    }
  })();

  return (
    <li className="bg-surface-card border border-line rounded-card p-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {/* §4.5 HIERARCHY outcome: 600 -> 700. This is the row's one primary string, and 600
            is a prohibition outside the `Button` label (§4.2). It is a `<p>` and not an `<hN>`,
            so the A1 heading-`truncate` ruling does not reach it and `truncate` stays. */}
        <p className="font-bold text-content-primary truncate">{title}</p>
        <p className="text-xs text-content-muted mt-0.5 wrap-anywhere">{sourceLabel}</p>
        {deadlineDisplay && (
          <p className="text-xs text-content-secondary mt-1">
            Deadline: {deadlineDisplay}
          </p>
        )}
        {/* DECISION Phase 88.6.1-29 (R10 / AC-31, shared rule 12): `whitespace-pre-line` +
            `wrap-anywhere`, the one pair decided for all five R10 sites so that plans 29, 38 and 52
            agree, so a check-in note keeps the line breaks people type. REJECTED:
            `whitespace-pre-wrap` (it keeps runs of spaces and leading indentation, which a note does
            not need, and the five sites must not diverge). REJECTED: splitting the text into line
            elements or rendering markup (SPEC Constraint: user text renders as text only).
            CHOSEN as well (owner ruling #115, 2026-10-13): the value passes through plan
            88.6.1-84's shared `collapseBlankLines`, so a run of three or more breaks renders as one
            blank line, OVER rendering every break as typed (a flood of blank lines pushes the card
            off a phone screen) and OVER a server cap (it would change stored text); the stored
            message is untouched. Removing the call is a decision, not a cleanup. */}
        {prompt.custom_message && (
          <p className="text-sm text-content-secondary mt-2 italic whitespace-pre-line wrap-anywhere">
            &ldquo;{collapseBlankLines(prompt.custom_message)}&rdquo;
          </p>
        )}
      </div>

      {prompt.can_close === true && (
        <KebabMenu
          ariaLabel="Check-in actions"
          items={[
            {
              label: 'End check-in',
              danger: true,
              twoTap: true,
              confirmLabel: 'Tap again to end',
              ariaDisabled: closing,
              onClick: () => onClose(prompt.id),
            },
          ]}
        />
      )}
    </li>
  );
}
