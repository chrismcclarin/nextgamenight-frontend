/**
 * Event classification predicates shared by the event surfaces.
 */

/** The fields of one EventParticipation row the guest predicate reads. */
export type GuestParticipation = {
  user_id?: string | null;
  is_guest?: boolean | null;
};

/** The part of an event the guest predicate reads. */
export type GuestEventShape = {
  EventParticipations?: readonly GuestParticipation[] | null;
};

/*
 * DECISION Phase 88.9-25 (D5a / R2-27 lift): ONE shared guest predicate for the upcoming list, the
 * calendar list and the month grid, chosen OVER a second inline copy in each surface (duplication
 * is not an option; UI-SPEC R2-27 "the guest flag derived as UpcomingEventsCard derives it"). It
 * matches on the User.id UUID with is_guest strictly true, exactly as Phase 71.1 GAMP-09's inline
 * version did, and it is a VISUAL cue only — no route, request or permission reads it.
 */
export function isGuestEvent(
  event: GuestEventShape | null | undefined,
  viewerDbUserId: string | null | undefined,
): boolean {
  if (!viewerDbUserId || !event) return false;
  // Kept at runtime: API payloads are typed, not validated, so a malformed shape answers false.
  const participations = Array.isArray(event.EventParticipations) ? event.EventParticipations : [];
  return participations.some((p) => p.user_id === viewerDbUserId && p.is_guest === true);
}
