// Phase 88.9-01 — the ONE synthetic pending group invite the e2e specs answer the bell with.
//
// DECISION Phase 88.9-01 (tenet: one helper): one shared invite fixture and one /invites/pending
// answerer, chosen over a per-spec copy (the copy this replaces lived three times, in
// e2e/notification-bell-panel.spec.ts, e2e/notification-bell-actions.spec.ts and
// e2e/header-main-nav.spec.ts, and e2e/contrast.spec.ts would have been the fourth). Same tenet
// as e2e/support/inFlight.ts ("DECISION Phase 88.6.1-43 (tenet: one helper)"): copies drift, and
// the copy that drifts is the one whose row the next locator no longer finds. Changing this is a
// decision, not a cleanup. AMENDED Phase 88.9 code review (2026-11-03, finding d2): the one fixture
// now carries the backend's flat shape, not the nested Group/Inviter shape it first copied.
//
// Each caller supplies its OWN id and group name, because every Accept-row locator reads the
// group name (the bell labels the action "Accept invite to <group_name>"). The inviter is the same
// synthetic host everywhere; it is never asserted on. member_count is null on purpose: no "N members"
// line appears in the four specs today (e2e/contrast.spec.ts measures the row's ring), and a count
// would add a line to every row and change their layout.
//
// The module is not a spec: Playwright collects only basenames ending in .spec or .test, so it is
// importable without being enumerated (the e2e/support/contrast.ts note on the same point).

/**
 * One row of GET /invites/pending as the backend sends it: the flat enriched object built in
 * backend:Sonnet/routes/invites.js ("invited_by_name: invite.Inviter ? invite.Inviter.username : 'Someone',").
 * No nested Group or Inviter key ever reaches the client.
 */
export interface PendingInvite {
  id: string;
  group_id: string;
  group_name: string;
  invited_by_name: string;
  member_count: number | null;
  created_at: string;
  token?: string;
}

const SYNTHETIC_INVITER_NAME = 'E2E Host';
const SYNTHETIC_CREATED_AT = '2026-01-01T00:00:00.000Z';

/** One flat /invites/pending row for an id and group name (group_id is derived from the id). */
export function pendingInvite(id: string, groupName: string): PendingInvite {
  return {
    id,
    group_id: `group-${id}`,
    group_name: groupName,
    invited_by_name: SYNTHETIC_INVITER_NAME,
    member_count: null,
    created_at: SYNTHETIC_CREATED_AT,
  };
}

/**
 * An answerer for holdWrites' answerGet (e2e/support/inFlight.ts ("answerGet?: (url: URL) => unknown;")): it
 * answers /invites/pending with the given invites and leaves every other read unanswered
 * (undefined), so a spec that answers further lists composes it with its own answerer.
 */
export function answerPendingInvites(invites: PendingInvite[]): (url: URL) => unknown {
  return (url: URL): unknown => (url.pathname.endsWith('/invites/pending') ? invites : undefined);
}
