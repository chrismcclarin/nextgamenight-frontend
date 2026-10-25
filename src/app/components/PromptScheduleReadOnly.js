'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { promptSettingsAPI } from '../../lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
  promptSettingsSchema,
  softFailPromptQueryFn,
  EMPTY_PROMPT_SETTINGS,
} from '../../lib/schemas/prompts';
import { Heading } from '../../components/ui/Heading';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import {
  FetchErrorBanner,
  RefreshFailedNotice,
  RetainedContentFocusGuard,
  useRetainedContent,
} from '../../components/ui/FetchErrorBanner';

/**
 * PromptScheduleReadOnly - Read-only schedule summary for GroupSettings
 * Shows active schedule count, simple list, and link to manage on group page.
 *
 * Phase 84 (PRIM-07 / D-12): migrated to useQuery on the shared promptKeys
 * factory so the settings fetch dedups across the trio. This is MEMBER-visible
 * (mounted inside the Customize Group dialog,
 * src/app/components/GroupSettings.js ("<PromptScheduleReadOnly")) — the backend GET
 * prompt-settings requires
 * ACTIVE MEMBERSHIP, NOT admin — so the query gates only on `Boolean(groupId)`.
 * An isAdmin gate here would blank the summary for every non-admin member.
 *
 * (The mount is cited by its anchor token, never by a line number: that file moves under
 * every plan that edits it. Re-derive by content. Rewritten by plan 88.6.1-30, W020.)
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {string} props.groupPageUrl - URL to the group page for "Manage on group page" link
 */
export default function PromptScheduleReadOnly({ groupId, groupPageUrl }) {
  // The section heading (88.6.1-30, D-05): the RF1 notice's and the withdrawal guard's focus
  // target. The summary sits mid-dialog inside Customize Group, so the dialog-title floor would
  // land a screen above it on a phone.
  const headingRef = useRef(null);
  const settingsQuery = useQuery({
    queryKey: promptKeys.settings(groupId),
    queryFn: softFailPromptQueryFn(
      promptSettingsSchema,
      () => promptSettingsAPI.getGroupPromptSettings(groupId),
      promptKeys.settings(groupId),
      EMPTY_PROMPT_SETTINGS,
    ),
    enabled: Boolean(groupId),
  });

  const { data, isPending } = settingsQuery;
  // C3 (plan 70): has-loaded is DATA PRESENCE, never a count — TanStack keeps `data` across a
  // failed refetch, so a list that loaded empty is retained content too (owner ruling Y).
  const hasSettingsData = data !== undefined;

  /* DECISION Phase 88.6-15 (D-31 / UI-SPEC §6.2,
     planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-UI-SPEC.md ("### 6.2 Error-surface routing")):
     the ERROR branch is checked BEFORE
     the empty branch, chosen OVER the shipped order in which a rejected fetch fell straight
     through to "No schedules configured." — telling a member their group had no check-ins when
     the request had merely failed (threat T-88.6-36). Same ruling
     src/app/components/OpenPollsList.js ("DECISION Phase 88-18 (Req 6 / T-88-18-01, UI-SPEC 9.2)") and
     src/app/components/PromptScheduleManager.js ("DECISION Phase 88-18 (Req 6 / T-88-18-01)")
     already carry for their own keys; do not re-merge the two branches.

     THE COMMENT THIS REPLACES WAS WRONG, and that was the whole defect: it read "Soft-fail
     queryFn never throws". MEASURED against
     src/lib/schemas/prompts.ts ("export function softFailPromptQueryFn") — the returned
     async body is `const raw = await fetcher(); return parsePromptsSoftFail(...)` with NO
     try/catch around the fetch — so `softFailPromptQueryFn` soft-fails ONLY a ZodError
     (safeParse -> `EMPTY_PROMPT_SETTINGS`) and RE-THROWS every real network / 4xx / 5xx
     rejection. The old sentence was true of the Zod path and false of the fetch path, which is
     exactly why the empty copy could paint on a failure. The soft-fail-on-ZodError behaviour is
     PRESERVED (D-31's explicit instruction) and has its own negative-control test arm.

     ——— AMENDED Phase 88.6.1-30 (MEDLOW-7 / AC-29 / RF1), the reasoning above KEPT AS HISTORY:
     error-before-empty still holds for a FIRST-load failure (nothing cached: the full banner,
     never the empty sentence). A failed REFRESH is a different state: TanStack keeps `data`
     across a refetch error, so the rows that loaded earlier stay, under plan 70's RF1 notice
     (copy row RF1), which says the refresh failed and that this is what loaded earlier — see
     src/app/components/PromptScheduleManager.js ("DECISION Phase 88.6.1-30 (AC-29 / RF1): when a refresh fails").
     That is not a re-merge: the empty sentence still shows only when a successful fetch said empty (a list
     that loaded empty keeps it under the notice, owner ruling Y). An access or gone answer
     never keeps the rows (C10, through `useRetainedContent`). */
  const settingsErrorState = useFetchErrorState(settingsQuery);
  // C10 (plan 70): false on an access or gone answer, and on every failure after it until the
  // next success; the memory is kept with this query's cache entry, so it outlives a remount.
  const hasRetainedSettings = useRetainedContent(hasSettingsData, settingsErrorState, { queryKey: promptKeys.settings(groupId) });
  const failedWithNothingCached = settingsErrorState.showError && !hasRetainedSettings;

  const loading = isPending;
  const schedules = data?.schedules || [];

  const activeCount = schedules.filter(s => s.is_active).length;

  return (
    <div>
      {/* DECISION Phase 88.6-15 (D-31): in the ERROR state the heading OMITS its parenthesised
          count, chosen OVER leaving `({activeCount})` rendered above every branch. `activeCount`
          derives from `data?.schedules || []`, so on a failure it is 0 and the heading would
          assert "Recurring Check-ins (0)" beside the failure banner — the same false claim about
          server state the error-before-empty ordering exists to stop, one element higher. No new
          string is authored: the parenthetical is omitted, never replaced. The count returns for
          every data branch, a TRUE zero included.
          ——— AMENDED Phase 88.6.1-30 (MEDLOW-7 / AC-29 / RF1), the reasoning above KEPT AS
          HISTORY: the count is omitted ONLY when the failure has nothing cached
          (`failedWithNothingCached`: a failed first load, or an access or gone answer). TanStack
          keeps `data` across a refetch error, so a retained count, a true zero included, is a
          fact the user can trust, and it stays beside plan 70's RF1 notice. */}
      <Heading ref={headingRef} level={3} size="heading" className="text-content-primary mb-3">
        {failedWithNothingCached
          ? 'Recurring Check-ins'
          : `Recurring Check-ins (${activeCount})`}
      </Heading>
      {/* C12 (a), plan 70: outside the retained block, so it stays mounted when an access answer
          withdraws the list; the same ref the notice gets. It renders nothing. */}
      <RetainedContentFocusGuard retained={hasRetainedSettings} focusTarget={headingRef} />

      {loading && (
        <p className="text-sm text-content-muted">Loading schedules...</p>
      )}

      {!loading && failedWithNothingCached && (
        <FetchErrorBanner
          state={settingsErrorState}
          title="We couldn't load your schedules"
          reportContext="Recurring check-ins summary (group settings)"
        />
      )}

      {/* The retained block: copy row RF1's notice above what loaded earlier, an empty list
          included — see
          src/app/components/PromptScheduleManager.js ("DECISION Phase 88.6.1-30 (AC-29 / RF1): when a refresh fails"). */}
      {hasRetainedSettings && (
        <>
          <RefreshFailedNotice
            state={settingsErrorState}
            retained={hasRetainedSettings}
            focusTarget={headingRef}
            className="mb-3"
          />
          {schedules.length === 0 ? (
            <p className="text-sm text-content-muted">No schedules configured.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {schedules.map(s => (
                <li key={s.id} className="flex items-center gap-2 text-sm text-content-secondary">
                  <span className={`w-2 h-2 rounded-full ${s.is_active ? 'bg-status-success' : 'bg-surface-muted'}`} />
                  {/* DECISION quick-261025-dzo (88.6.2 CODE-REVIEW HIGH, owner ruling A): the
                      schedule name reads template_name first, OVER reading name alone. The
                      backend builds every schedule with template_name only,
                      backend:Sonnet/routes/groupPromptSettings.js ("template_name: finalTemplateName,"),
                      and its update allow-list has no name key, so name was always empty and
                      every row painted the fallback label in production. name stays as the
                      second read, OVER dropping it: the schema accepts both keys, so an older
                      payload that carries name still shows its name. It is the same key the
                      admin list reads,
                      src/app/components/ScheduleList.js ("schedule.template_name ||").
                      Dropping the template_name read, or reading name first, is a decision,
                      not a cleanup. */}
                  <span>{s.template_name || s.name || 'Unnamed schedule'}</span>
                  {!s.is_active && <span className="text-content-muted text-xs">(paused)</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <a
        href={groupPageUrl}
        className="text-content-link hover:text-content-link-hover text-sm"
      >
        Manage on group page &rarr;
      </a>
    </div>
  );
}
