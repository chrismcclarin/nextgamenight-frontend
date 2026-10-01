'use client';

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
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';

/**
 * PromptScheduleReadOnly - Read-only schedule summary for GroupSettings
 * Shows active schedule count, simple list, and link to manage on group page.
 *
 * Phase 84 (PRIM-07 / D-12): migrated to useQuery on the shared promptKeys
 * factory so the settings fetch dedups across the trio. This is MEMBER-visible
 * (mounted at GroupSettings.js:1009) — the backend GET prompt-settings requires
 * ACTIVE MEMBERSHIP, NOT admin — so the query gates only on `Boolean(groupId)`.
 * An isAdmin gate here would blank the summary for every non-admin member.
 *
 * (Mount cite re-derived 2026-09-16 by plan 88.6-15. It read `GroupSettings.js:310`,
 * which is stale by ~700 lines; `88.6-15-PLAN.md` proposed `:1006`, also off — the
 * `<PromptScheduleReadOnly` element opens at `:1009`. Re-derive by content, not by
 * number.)
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {string} props.groupPageUrl - URL to the group page for "Manage on group page" link
 */
export default function PromptScheduleReadOnly({ groupId, groupPageUrl }) {
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

  /* DECISION Phase 88.6-15 (D-31 / UI-SPEC §6.2 `:518`): the ERROR branch is checked BEFORE
     the empty branch, chosen OVER the shipped order in which a rejected fetch fell straight
     through to "No schedules configured." — telling a member their group had no check-ins when
     the request had merely failed (threat T-88.6-36). Same ruling `OpenPollsList.js:37-42` and
     `PromptScheduleManager.js:59-64` already carry for their own keys; do not re-merge the two
     branches.

     THE COMMENT THIS REPLACES WAS WRONG, and that was the whole defect: it read "Soft-fail
     queryFn never throws". MEASURED against `src/lib/schemas/prompts.ts:222-241` — the returned
     async body is `const raw = await fetcher(); return parsePromptsSoftFail(...)` with NO
     try/catch around the fetch — so `softFailPromptQueryFn` soft-fails ONLY a ZodError
     (safeParse -> `EMPTY_PROMPT_SETTINGS`) and RE-THROWS every real network / 4xx / 5xx
     rejection. The old sentence was true of the Zod path and false of the fetch path, which is
     exactly why the empty copy could paint on a failure. The soft-fail-on-ZodError behaviour is
     PRESERVED (D-31's explicit instruction) and has its own negative-control test arm. */
  const settingsErrorState = useFetchErrorState(settingsQuery);

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
          every data branch, a TRUE zero included. */}
      <Heading level={3} size="heading" className="text-content-primary mb-3">
        {settingsErrorState.showError
          ? 'Recurring Check-ins'
          : `Recurring Check-ins (${activeCount})`}
      </Heading>

      {loading && (
        <p className="text-sm text-content-muted">Loading schedules...</p>
      )}

      {!loading && settingsErrorState.showError && (
        <FetchErrorBanner
          state={settingsErrorState}
          title="We couldn't load your schedules"
          reportContext="Recurring check-ins summary (group settings)"
        />
      )}

      {!loading && !settingsErrorState.showError && schedules.length === 0 && (
        <p className="text-sm text-content-muted">No schedules configured.</p>
      )}

      {!loading && !settingsErrorState.showError && schedules.length > 0 && (
        <ul className="space-y-2 mb-4">
          {schedules.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm text-content-secondary">
              <span className={`w-2 h-2 rounded-full ${s.is_active ? 'bg-status-success' : 'bg-surface-muted'}`} />
              <span>{s.name || 'Unnamed schedule'}</span>
              {!s.is_active && <span className="text-content-muted text-xs">(paused)</span>}
            </li>
          ))}
        </ul>
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
