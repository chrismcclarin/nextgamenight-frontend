// Pins for isGuestEvent (Phase 88.9-25, the D5a / R2-27 lift).
//
// WHAT THESE EXIST TO CATCH: the guest cue (a dashed edge and a Guest pill) used to be derived
// inline in UpcomingEventsCard; plans 88.9-28 (the month tile) and 88.9-39 (the calendar list) need
// the same answer. One predicate, so the three surfaces cannot disagree about who is a guest. It is
// a visual cue only (no route, request or permission reads it), and it matches on the viewer's own
// User.id UUID with is_guest strictly true, exactly as Phase 71.1 GAMP-09's inline version did.

import { describe, it, expect } from 'vitest';
import { isGuestEvent } from './eventClassification';

const VIEWER = 'u-viewer';
const OTHER = 'u-other';

describe('isGuestEvent — the shared guest predicate (88.9-25)', () => {
  it("isGuestEvent (88.9-25): true when the viewer's own participation has is_guest true", () => {
    const event = { EventParticipations: [{ user_id: OTHER, is_guest: false }, { user_id: VIEWER, is_guest: true }] };
    expect(isGuestEvent(event, VIEWER)).toBe(true);
  });

  it("isGuestEvent (88.9-25): false for the viewer's member participation, another user's guest participation and an empty list", () => {
    expect(isGuestEvent({ EventParticipations: [{ user_id: VIEWER, is_guest: false }] }, VIEWER), 'member').toBe(false);
    expect(isGuestEvent({ EventParticipations: [{ user_id: OTHER, is_guest: true }] }, VIEWER), "another user's guest row").toBe(false);
    expect(isGuestEvent({ EventParticipations: [] }, VIEWER), 'empty list').toBe(false);
  });

  it('isGuestEvent (88.9-25): false without a viewer id — null, undefined and the empty string', () => {
    const event = { EventParticipations: [{ user_id: VIEWER, is_guest: true }] };
    expect(isGuestEvent(event, null), 'null').toBe(false);
    expect(isGuestEvent(event, undefined), 'undefined').toBe(false);
    expect(isGuestEvent(event, ''), 'empty string').toBe(false);
  });

  it("isGuestEvent (88.9-25): false for a null event, a missing or non-array EventParticipations, and an is_guest that is not strictly true", () => {
    expect(isGuestEvent(null, VIEWER), 'null event').toBe(false);
    expect(isGuestEvent(undefined, VIEWER), 'undefined event').toBe(false);
    expect(isGuestEvent({}, VIEWER), 'missing EventParticipations').toBe(false);
    expect(isGuestEvent({ EventParticipations: null }, VIEWER), 'null EventParticipations').toBe(false);
    // API payloads are typed, not validated at runtime, so a malformed shape must still answer false.
    const notArray = { EventParticipations: { user_id: VIEWER, is_guest: true } } as unknown as Parameters<typeof isGuestEvent>[0];
    expect(isGuestEvent(notArray, VIEWER), 'non-array EventParticipations').toBe(false);
    const stringTrue = [{ user_id: VIEWER, is_guest: 'true' }] as unknown as { user_id: string; is_guest: boolean }[];
    expect(isGuestEvent({ EventParticipations: stringTrue }, VIEWER), "is_guest 'true' (a string)").toBe(false);
    const one = [{ user_id: VIEWER, is_guest: 1 }] as unknown as { user_id: string; is_guest: boolean }[];
    expect(isGuestEvent({ EventParticipations: one }, VIEWER), 'is_guest 1').toBe(false);
  });
});
