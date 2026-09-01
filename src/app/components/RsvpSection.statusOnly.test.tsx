/**
 * WHAT THIS EXISTS TO CATCH
 * =========================
 * DECISION Phase 88.5 (adversarial code review 2026-09-01, owner ruling a): a status
 * tap in `RsvpSection` is STATUS-ONLY — `submitRsvp(eventId, status)`, no third
 * argument. The previous `note || null` forwarding silently WIPED a member's saved
 * note whenever the local `note` state was stale-empty (identity unresolved when the
 * RSVP fetch landed, or a failed fetch): `'' || null` became an explicit clear that
 * POST /rsvp honoured. With the key absent, the backend preserves the saved note.
 *
 * The pins below are the mechanical form of that ruling:
 *
 *  1. ARITY-2 STATUS TAP. A future "normalize the args" refactor re-adding a third
 *     argument re-opens the wipe — `mock.calls[0]` must have length 2, mirroring the
 *     same pin on the hero (`NextGameNightCard.test.tsx`, "NOTE-LESS, and pinned").
 *
 *  2. EXPLICIT-CLEAR SURVIVES. `handleSaveNote` is the SOLE note writer and still
 *     sends `note || null`, so clearing the textarea and pressing Save note must send
 *     an explicit `null` — the backend's clear semantics depend on the key being
 *     PRESENT there.
 */
import type * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The respondent list is not under test; a passthrough keeps the render light and
// avoids the popover's own context requirements.
vi.mock('./ClickableMemberName', () => ({
  default: ({ children, username }: { children?: React.ReactNode; username?: string }) => (
    <span>{children ?? username}</span>
  ),
}));

// `rsvpAPI` MUST be mocked: the component fires `getEventRsvps` on mount, and an
// unmocked `rsvpAPI` reaches the real `apiFetch` (a real jsdom fetch). The spread
// keeps every other export real.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    rsvpAPI: {
      ...actual.rsvpAPI,
      getEventRsvps: vi.fn(),
      submitRsvp: vi.fn(),
    },
  };
});

import { rsvpAPI } from '@/lib/api';
import RsvpSectionUntyped from './RsvpSection';
import { statusConfig } from './rsvpStatusConfig';

// RsvpSection is still `.js` (mid-TS-migration), so TS infers its props as `{}`.
// Typed here from the component's own JSDoc; delete this cast when the component
// converts.
const RsvpSection = RsvpSectionUntyped as unknown as React.ComponentType<{
  eventId: string;
  self?: { id: string };
  eventDate?: string;
  onRsvpChange?: (status: string) => void;
}>;

type Mock = ReturnType<typeof vi.fn>;
const getEventRsvps = rsvpAPI.getEventRsvps as unknown as Mock;
const submitRsvp = rsvpAPI.submitRsvp as unknown as Mock;

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = 'evt-rsvp-args';
// Far future so `isPastEvent` is false and the buttons render.
const EVENT_DATE = '2099-01-01T00:00:00Z';

const withOwnRsvp = (status: string, note: string | null) => ({
  rsvps: [
    {
      id: 'rsvp-own',
      event_id: EVENT_ID,
      user_id: SELF_UUID,
      status,
      note,
      User: { id: SELF_UUID, username: 'me' },
    },
  ],
  summary: { yes: 1, maybe: 0, no: 0 },
});

const renderSection = () =>
  render(
    <RsvpSection
      eventId={EVENT_ID}
      self={{ id: SELF_UUID }}
      eventDate={EVENT_DATE}
      onRsvpChange={vi.fn()}
    />
  );

beforeEach(() => {
  getEventRsvps.mockResolvedValue(withOwnRsvp('yes', 'running late, start without me'));
  submitRsvp.mockImplementation((_id: string, status: string) =>
    Promise.resolve({ id: 'rsvp-own', status, note: 'running late, start without me' })
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RsvpSection status tap is status-only (owner ruling a, 2026-09-01)', () => {
  it('sends exactly (eventId, status) on a status tap — no note argument, ever', async () => {
    const user = userEvent.setup();
    renderSection();

    const noButton = await screen.findByRole('button', {
      name: statusConfig.no.buttonText,
    });
    await user.click(noButton);

    await waitFor(() => expect(submitRsvp).toHaveBeenCalledTimes(1));
    expect(submitRsvp).toHaveBeenCalledWith(EVENT_ID, 'no');
    // ARITY-2, pinned: a third `note` argument would re-open the wipe the backend's
    // key-presence fix closed. Mirrors the hero's pin.
    expect(submitRsvp.mock.calls[0]).toHaveLength(2);
  });

  it('a typed-but-unsaved draft SURVIVES a status tap — not saved, but never erased', async () => {
    const user = userEvent.setup();
    // Stateful mocks mirroring the real backend: a submit updates the status the
    // subsequent refetch reports (otherwise the refetch would reset selectedStatus
    // to the fixture's original and the Save-note assertion below tests nothing).
    let serverStatus = 'yes';
    submitRsvp.mockImplementation((_id: string, status: string) => {
      serverStatus = status;
      return Promise.resolve({
        id: 'rsvp-own',
        status,
        note: 'running late, start without me',
      });
    });
    getEventRsvps.mockImplementation(() =>
      Promise.resolve(withOwnRsvp(serverStatus, 'running late, start without me'))
    );
    renderSection();

    const textarea = await screen.findByPlaceholderText('Add a note (optional)');
    await waitFor(() =>
      expect(textarea).toHaveValue('running late, start without me')
    );

    // Type a new draft over the saved note, then change status WITHOUT saving.
    await user.clear(textarea);
    await user.type(textarea, 'actually bringing snacks');
    await user.click(
      screen.getByRole('button', { name: statusConfig.no.buttonText })
    );
    await waitFor(() => expect(submitRsvp).toHaveBeenCalledTimes(1));

    // The round-2 HIGH: the response echo and the post-tap refetch both used to
    // repaint the box with the server's OLD note. The draft must still be here.
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(2));
    expect(textarea).toHaveValue('actually bringing snacks');

    // And Save note then persists exactly that draft (DR0's carried requirement).
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(submitRsvp).toHaveBeenCalledTimes(2));
    expect(submitRsvp).toHaveBeenNthCalledWith(2, EVENT_ID, 'no', 'actually bringing snacks');
  });

  it('an event switch on the SAME instance re-syncs the new event note despite a stale draft', async () => {
    // The remedy-skeptic objection, pinned: gameDetail keys this component by refresh
    // counter, not event id, so ?event_id=A -> B re-renders the SAME instance. A
    // draft typed under A must not block B's saved note from hydrating.
    const user = userEvent.setup();
    getEventRsvps.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'evt-B'
          ? withOwnRsvp('yes', 'note for event B')
          : withOwnRsvp('yes', 'running late, start without me')
      )
    );

    const { rerender } = render(
      <RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    const textarea = await screen.findByPlaceholderText('Add a note (optional)');
    await waitFor(() =>
      expect(textarea).toHaveValue('running late, start without me')
    );
    await user.clear(textarea);
    await user.type(textarea, 'unsaved draft for A');

    rerender(
      <RsvpSection eventId="evt-B" self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await waitFor(() => expect(textarea).toHaveValue('note for event B'));
  });

  it('Save note still sends an explicit null when the textarea is cleared', async () => {
    const user = userEvent.setup();
    renderSection();

    // The saved note is hydrated into the textarea once the own RSVP resolves.
    const textarea = await screen.findByPlaceholderText('Add a note (optional)');
    await waitFor(() =>
      expect(textarea).toHaveValue('running late, start without me')
    );

    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(submitRsvp).toHaveBeenCalledTimes(1));
    // Explicit clear: the key must be PRESENT with null — this is the one path
    // allowed (and required) to write the note.
    expect(submitRsvp).toHaveBeenCalledWith(EVENT_ID, 'yes', null);
  });
});
