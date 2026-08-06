'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { promptAPI } from '../../lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
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
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { toast } from 'sonner';

/**
 * OpenPollsList — Phase 71.2 (POLL-01 / D-UI-01..04)
 *
 * Unified list of open availability prompts (manual + auto) for a group.
 * Renders the "Start a poll" entry point for any non-pending active member,
 * the source label per prompt (`Started by [creator]` for manual, `From
 * [schedule name]` for auto — Plan 01 ships GroupPromptSettings.template_name
 * inline in the GET /prompts/open response), and a per-card KebabMenu close
 * action gated on the server-derived `can_close` flag.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' | 'pending'
 * @param {string} [props.currentUserDbId] - Caller's User.id UUID (currently
 *   informational; the can_close gate is server-derived in the response).
 */
export default function OpenPollsList({ groupId, group, userRole, currentUserDbId }) {
  const [showStartPoll, setShowStartPoll] = useState(false);
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

  /* DECISION Phase 88-18 (Req 6 / T-88-18-01, UI-SPEC 9.2): a HARD fetch failure now renders the
     shared fetch-error treatment instead of falling through to the empty state. `softFailPromptQueryFn`
     only soft-fails a PARSE failure to EMPTY_OPEN_PROMPTS — a network/4xx/5xx rejection still rejects,
     leaving `data` undefined and `prompts` at [], which used to print "no active check-ins" at someone
     whose request had failed. Empty and failed are different facts and get different surfaces; do not
     re-merge these two branches. */
  const pollsErrorState = useFetchErrorState(openPollsQuery);

  // Post-write cache invalidation replaces the old loadPrompts() refetch — keeps
  // the open-polls list fresh after a direct-API write (A1/A4).
  const invalidateOpenPolls = () =>
    queryClient.invalidateQueries({ queryKey: promptKeys.openPolls(groupId) });

  // Gate alignment: parent PromptScheduleSection uses `!userRole || userRole
  // === 'pending' → return null`. We mirror the same negative check so any
  // future role addition (e.g. 'guest') evolves both gates together. No
  // positive role allowlist.
  const canCreate = userRole && userRole !== 'pending';

  const handleClose = async (promptId) => {
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
          byCode: { forbidden: 'Only the poll creator and group admins can end a check-in.' },
        })
      );
    }
  };

  const showEmptyState = !loading && !pollsErrorState.showError && prompts.length === 0;

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
        /* DECISION Phase 87.8 (D-13/D-14/AF-2): per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor — the global floor was considered and REJECTED because it would silently distort ~15 shipped compact/icon `.btn` sites (AF-2, e.g. BrowseMoreModal's 32x32 squares); 44px chosen OVER Material's 48dp, surfaced and consciously declined (D-14). The global `.btn` sizing question (all 210 sites) stays with Phase 88 (DEF-1) — this is a decision, not an oversight. No `min-w-11`: this wide text button already exceeds 44px rendered width (151px measured).  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup. */
        <button
          type="button"
          onClick={() => setShowStartPoll(true)}
          className="btn btn-primary mb-4 min-h-11"
        >
          + Start a check-in
        </button>
      )}

      {loading ? (
        <p className="text-content-muted text-sm py-4 text-center">Loading check-ins...</p>
      ) : pollsErrorState.showError ? (
        <FetchErrorBanner
          state={pollsErrorState}
          title="We couldn't load the check-ins"
          reportContext="Open availability check-ins list (group page)"
        />
      ) : prompts.length === 0 ? (
        // D-UI-03: unified empty-state COPY for ALL roles (admin/member alike);
        // only the CTA is role-gated, and that gate stays here at the call site.
        <EmptyState
          icon="Vote"
          heading="No check-ins running"
          body="Start one and everyone picks the nights that work — you'll see the overlap."
          action={
            canCreate ? (
              /* 44px floor carried per-CTA, matching the 87.8 D-13/D-14 marker on the
                 header button above — same action, same touch target. */
              <Button
                variant="primary"
                className="min-h-11"
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
              onClose={handleClose}
            />
          ))}
        </ul>
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
 * Source label rules (D-UI-02):
 *   - Auto-prompt (created_by_settings_id != null):
 *       "From {GroupPromptSettings.template_name}"
 *       Falls back to "From recurring schedule" if the parent settings row
 *       has been deleted (rare; ON DELETE SET NULL on created_by_settings_id
 *       leaves the include null).
 *   - Manual poll: "Started by {Creator.username}"
 *       Falls back to "a group member" if the Creator association is null.
 *
 * KebabMenu visibility is gated on the server-derived `can_close` flag.
 * Backend re-validates on PATCH (defense in depth) so a forged client-side
 * flag still fails with 403 — see threat T-71.2-11 in plan.
 */
function OpenPollCard({ prompt, group, onClose }) {
  const isAuto = !!prompt.created_by_settings_id;

  // Note: Plan 01 named the include attribute `template_name` (the actual
  // model column). The route returns it under the alias `GroupPromptSetting`
  // (Sequelize default), but to be defensive across alias variations we
  // accept either shape.
  const settingsRow = prompt.GroupPromptSetting || prompt.GroupPromptSettings;
  const sourceLabel = isAuto
    ? `From ${settingsRow?.template_name || 'recurring schedule'}`
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
        <p className="font-semibold text-content-primary truncate">{title}</p>
        <p className="text-xs text-content-muted mt-0.5">{sourceLabel}</p>
        {deadlineDisplay && (
          <p className="text-xs text-content-secondary mt-1">
            Deadline: {deadlineDisplay}
          </p>
        )}
        {prompt.custom_message && (
          <p className="text-sm text-content-secondary mt-2 italic">
            &ldquo;{prompt.custom_message}&rdquo;
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
              onClick: () => onClose(prompt.id),
            },
          ]}
        />
      )}
    </li>
  );
}
