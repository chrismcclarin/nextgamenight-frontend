// Phase 88.9-01 — the ONE synthetic pending group invite the e2e specs answer the bell with.
//
// DECISION Phase 88.9-01 (tenet: one helper): one shared invite fixture and one /invites/pending
// answerer, chosen over a per-spec copy (the copy this replaces lived three times, in
// e2e/notification-bell-panel.spec.ts, e2e/notification-bell-actions.spec.ts and
// e2e/header-main-nav.spec.ts, and e2e/contrast.spec.ts would have been the fourth). Same tenet
// as e2e/support/inFlight.ts ("DECISION Phase 88.6.1-43 (tenet: one helper)"): copies drift, and
// the copy that drifts is the one whose row the next locator no longer finds. Changing this is a
// decision, not a cleanup.
//
// Each caller supplies its OWN id and group name, because every Accept-row locator reads the
// group name (the bell labels the action "Accept invite to <Group.name>"). The inviter is the same
// synthetic host everywhere; it is never asserted on.
//
// The module is not a spec: Playwright collects only basenames ending in .spec or .test, so it is
// importable without being enumerated (the e2e/support/contrast.ts note on the same point).

export interface PendingInvite {
  id: string;
  Group: { name: string };
  Inviter: { username: string };
}

const SYNTHETIC_INVITER = { username: 'E2E Host' } as const;

/** The invite shape the bell's /invites/pending list carries, for one id and group name. */
export function pendingInvite(id: string, groupName: string): PendingInvite {
  return { id, Group: { name: groupName }, Inviter: { ...SYNTHETIC_INVITER } };
}

/**
 * An answerer for holdWrites' answerGet (e2e/support/inFlight.ts ("answerGet?: (url: URL) => unknown;")): it
 * answers /invites/pending with the given invites and leaves every other read unanswered
 * (undefined), so a spec that answers further lists composes it with its own answerer.
 */
export function answerPendingInvites(invites: PendingInvite[]): (url: URL) => unknown {
  return (url: URL): unknown => (url.pathname.endsWith('/invites/pending') ? invites : undefined);
}
