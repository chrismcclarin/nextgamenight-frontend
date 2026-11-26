// The planning page's poll reads, answered in the browser: the open polls, the active poll, a poll
// by id, a poll's respondents and its heatmap. Shared by the large-text sweep's planning rows
// (e2e/support/largeTextSurfaces/planning.ts) and plan 89.6-42's check-in card row.
// Added by Phase 89.6-20.
//
// WHAT IT STAGES. The page (src/app/groupPlanning/page.js) reads the open polls for its Switch poll
// chips and its check-in cards, the active poll (or a poll by id) for its dashboard, and the
// respondents of the poll it shows. The CI seed holds one active poll with no slot counts, so
// neither the chips nor the slot lines would render; this helper answers each read with staged
// polls and respondents instead. The shapes are the backend's, and the paths are the client's:
// src/lib/api.ts ("getActivePrompt: (groupId: string) =>").
// - the active read answers 200 with the poll, or 200 with a null poll when none is active, never
//   a 404 (backend:Sonnet/routes/availabilityPrompt.js ("prompt: prompt ? decoratePromptForWire")): a
//   404 makes the client throw and the page shows its poll-error banner in place of the no-poll
//   branch, a page production never shows (review M082);
// - the by-id read answers 200 with the poll, else 404 with the backend's not-found body, as
//   e2e/check-ins-select-poll.spec.ts ("async function mockPolls(page: Page) {") answers it.
// Every staged poll is sent with the group id the caller passes, so the page's own-group check
// (src/app/groupPlanning/page.js ("const thisGroupsPrompt = (data, forGroup, id) => {")) accepts it.
//
// READ-ONLY. Only a GET is answered; any other method falls back, so a write still reaches the
// caller's write hold. Register it AFTER sweepWriteGuard or holdWrites: Playwright runs the newest
// matching route first, so these answer before the hold sees the read. Bodies are never logged,
// printed or attached; every name and id is synthetic.
//
// DECISION Phase 89.6-20 (planning-polls): one shared staging helper for the planning page's poll
// reads, chosen OVER a fifth spec-local mock (four exist; folding them in is a cleanup recorded,
// not done here) and OVER the CI seed (one active poll, no slot counts, so neither the chips nor
// the slot lines would render). Plan 89.6-42 imports it. Changing this is a decision, not a cleanup.
import type { Page, Route } from '@playwright/test';

/** Fixed ids in a range no seed owns. */
export const PLANNING_POLL_A_ID = '89620000-0000-4000-8000-0000000000a1';
export const PLANNING_POLL_B_ID = '89620000-0000-4000-8000-0000000000a2';
export const PLANNING_CREATOR_A_ID = '89620000-0000-4000-8000-0000000000b1';
export const PLANNING_CREATOR_B_ID = '89620000-0000-4000-8000-0000000000b2';

export interface PlanningPoll {
  id: string;
  status: string;
  group_id: string | null;
  can_close: boolean;
  custom_message: string | null;
  blind_voting_enabled: boolean;
  deadline: string;
  Creator: { id: string; username: string };
  [field: string]: unknown;
}

export interface PlanningRespondent {
  user_id: string;
  username: string;
  has_responded: boolean;
  slot_count: number | null;
  last_reminded_at: string | null;
}

/** A synthetic open poll: the payload shape of e2e/check-ins-select-poll.spec.ts ("function syntheticPoll("). */
export function syntheticPlanningPoll(id: string, starter: string, creatorId: string): PlanningPoll {
  return {
    id,
    status: 'active',
    // Stamped with the caller's group id when served (routePlanningPolls).
    group_id: null,
    can_close: true,
    custom_message: null,
    blind_voting_enabled: false,
    deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    Creator: { id: creatorId, username: starter },
  };
}

/** A synthetic respondent row, in the backend's respondents shape. */
export function syntheticRespondent(userId: string, username: string, slotCount: number | null): PlanningRespondent {
  return { user_id: userId, username, has_responded: slotCount !== null, slot_count: slotCount, last_reminded_at: null };
}

export interface PlanningPollsOptions {
  groupId: string;
  /** The open polls, in list order. */
  polls: PlanningPoll[];
  /** The id of the active poll among `polls`, or null for no active poll. */
  activeId: string | null;
  /** The respondents answered for every staged poll. */
  respondents: PlanningRespondent[];
  /** The answer to a staged poll's heatmap read; absent lets the read through. */
  heatmap?: unknown;
}

const GET_ONLY =
  (answer: (route: Route, url: URL) => Promise<void>) =>
  async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }
    await answer(route, new URL(request.url()));
  };

/**
 * Answer the planning page's poll reads on `page` with the staged polls. Register it after the
 * page's write hold.
 */
export async function routePlanningPolls(page: Page, options: PlanningPollsOptions): Promise<void> {
  const { groupId, activeId, respondents, heatmap } = options;
  const polls = options.polls.map((poll) => ({ ...poll, group_id: groupId }));
  const byId = (id: string): PlanningPoll | undefined => polls.find((poll) => poll.id.toLowerCase() === id.toLowerCase());
  const groupPrompts = `/groups/${groupId}/prompts/`;

  await page.route(
    (url) => url.pathname.endsWith(`${groupPrompts}open`),
    GET_ONLY(async (route) => route.fulfill({ status: 200, json: { prompts: polls } })),
  );
  await page.route(
    (url) => url.pathname.endsWith(`${groupPrompts}active`),
    GET_ONLY(async (route) => route.fulfill({ status: 200, json: { prompt: activeId === null ? null : (byId(activeId) ?? null) } })),
  );
  // GET /prompts/<id> by its pathname end, never the group reads above (they also end /prompts/<word>).
  await page.route(
    (url) => /\/prompts\/[^/]+$/.test(url.pathname) && !url.pathname.includes('/groups/'),
    GET_ONLY(async (route, url) => {
      const prompt = byId(url.pathname.split('/').pop() ?? '');
      if (!prompt) {
        await route.fulfill({ status: 404, json: { error: 'Prompt not found' } });
        return;
      }
      await route.fulfill({ status: 200, json: { prompt } });
    }),
  );
  await page.route(
    (url) => /\/prompts\/[^/]+\/respondents$/.test(url.pathname),
    GET_ONLY(async (route, url) => {
      const prompt = byId(url.pathname.split('/').slice(-2)[0] ?? '');
      await route.fulfill({ status: 200, json: prompt ? respondents : [] });
    }),
  );
  if (heatmap !== undefined) {
    await page.route(
      (url) => /\/prompts\/[^/]+\/heatmap$/.test(url.pathname),
      GET_ONLY(async (route) => route.fulfill({ status: 200, json: heatmap })),
    );
  }
}
