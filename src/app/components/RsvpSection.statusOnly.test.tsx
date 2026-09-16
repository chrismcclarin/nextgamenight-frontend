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
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { formatDateTime } from '@/lib/datetime';

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

// ---------------------------------------------------------------------------------------
// Phase 88.6-29 — W43 / W44.
//
// WHAT THIS EXISTS TO CATCH
// -------------------------
//  3. AN UNLABELLED NOTE FIELD. A placeholder is not a persistent accessible name: it
//     disappears the moment the user types, and not every AT exposes it as a name at all.
//
//  4. A SILENTLY TRUNCATING NOTE FIELD. The 501st keystroke was discarded by a JS gate with
//     no attribute-level limit, so the limit was invisible to AT and the counter simply froze.
//
//  5. AN UNNAMED TRIO. Three buttons reading "Going / Maybe / Can't" with no group role and no
//     label naming the event — on a page that renders one of these per upcoming event.
//     PRESENCE of an aria-label does not catch this: the bug satisfies "a label exists". The
//     CONTENT is asserted, in both the present-date and the absent-date arm.
//
//  6. FOCUS DROPPED TO <body> MID-SUBMIT. The pressed button was natively `disabled` while its
//     own request was in flight, which removes it from the focus order.
//
//  7. AN IN-FLIGHT BUTTON WITH NO ACCESSIBLE NAME AT ALL. The spinner REPLACED the button's
//     whole content, so the control the user just activated announced as nothing for the round
//     trip. The natural wrong fix — an `aria-label` on the spinner — leaves the button named
//     "loading"; the pin below is on the BUTTON's own name.
//
//  8. A TRIO UNDER THE 44px FLOOR. `text-sm` + `py-2` computes to about 36px. This is the
//     SOURCE half only: jsdom performs no layout, so the rendered box is measured by the phone
//     lane arm in `e2e/touch-targets.spec.ts`. Neither substitutes for the other.
//
//  9. A CONDITIONALLY MOUNTED FAILURE. A screen reader announces CHANGES to a live region, not
//     the mount of a new one. PRESENCE-IN-THE-INITIAL-RENDER is asserted SEPARATELY from the
//     text landing in it — one combined assertion cannot tell the two implementations apart.
//
// 10. A SILENT SUCCESS, AND ONLY-THE-FIRST-SUCCESS. Same pair the hero's W45(a) arms pin
//     (`NextGameNightCard.test.tsx`): node identity across two consecutive saves, plus the
//     in-flight-empty window that proves the clear happened at the START of the handler.
const NOTE_SAVED_COPY = 'Note saved';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const statusButton = (status: 'yes' | 'maybe' | 'no') =>
  screen.getByRole('button', { name: statusConfig[status].buttonText });

describe('RsvpSection W43 — the note field has a real name and a UA-enforced limit', () => {
  it('the textarea carries an id, a name and an ASSOCIATED label', async () => {
    renderSection();
    const textarea = (await screen.findByLabelText(
      'Add a note (optional)'
    )) as HTMLTextAreaElement;

    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.id).not.toBe('');
    expect(textarea.getAttribute('name')).not.toBeNull();
    // The association is a real label[for], not an aria-label: `findByLabelText` above matches
    // either, so the element is checked directly.
    const label = document.querySelector(`label[for="${CSS.escape(textarea.id)}"]`);
    expect(label).not.toBeNull();
    expect(textarea.getAttribute('aria-label')).toBeNull();
  });

  it('the limit is an ATTRIBUTE and the counter is reachable from the field', async () => {
    renderSection();
    const textarea = (await screen.findByLabelText(
      'Add a note (optional)'
    )) as HTMLTextAreaElement;

    expect(textarea.maxLength).toBe(500);
    const describedBy = textarea.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const counter = document.getElementById(describedBy as string);
    expect(counter).not.toBeNull();
    expect(counter?.textContent).toMatch(/\/500$/);
  });

  it('ids are PER INSTANCE — two RsvpSections on one page do not collide', async () => {
    render(
      <>
        <RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
        <RsvpSection eventId="evt-B" self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
      </>
    );
    const boxes = await screen.findAllByLabelText('Add a note (optional)');
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLTextAreaElement).id).not.toBe((boxes[1] as HTMLTextAreaElement).id);
  });
});

describe('RsvpSection W44 — the status trio is a named group that keeps focus and its own name', () => {
  it('exposes role=group with a label naming the EVENT — content asserted, not presence', async () => {
    renderSection();
    await screen.findByRole('button', { name: statusConfig.no.buttonText });

    const when = formatDateTime(EVENT_DATE);
    // Guard the fixture itself: an empty `when` would make the assertion below vacuous.
    expect(when).not.toBe('');
    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', `RSVP for ${when}`);
  });

  it('falls back to a generic phrase when eventDate is absent — never undefined, Invalid Date or the id', async () => {
    render(<RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} />);
    await screen.findByRole('button', { name: statusConfig.no.buttonText });

    const name = screen.getByRole('group').getAttribute('aria-label') as string;
    expect(name).toBe('RSVP for this event');
    expect(name).not.toMatch(/undefined/i);
    expect(name).not.toMatch(/invalid date/i);
    expect(name).not.toContain(EVENT_ID);
  });

  it('aria-pressed reflects the selected status', async () => {
    renderSection();
    await waitFor(() =>
      expect(statusButton('yes')).toHaveAttribute('aria-pressed', 'true')
    );
    expect(statusButton('maybe')).toHaveAttribute('aria-pressed', 'false');
    expect(statusButton('no')).toHaveAttribute('aria-pressed', 'false');
  });

  it('the PRESSED button keeps focus and the OTHER two go natively disabled', async () => {
    const user = userEvent.setup();
    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);
    renderSection();

    const no = await screen.findByRole('button', { name: statusConfig.no.buttonText });
    await user.click(no);

    // In flight: the tapped control is still IN the focus order and still focused.
    expect(no).toHaveAttribute('aria-disabled', 'true');
    expect(no).not.toBeDisabled();
    expect(document.activeElement).toBe(no);
    // Nobody is standing on the other two, so they lose interactivity outright.
    expect(statusButton('yes')).toBeDisabled();
    expect(statusButton('maybe')).toBeDisabled();

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'no', note: null });
      await write.promise;
    });
  });

  it("the IN-FLIGHT button's OWN accessible name is `<status text>, saving`", async () => {
    const user = userEvent.setup();
    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);
    renderSection();

    const no = await screen.findByRole('button', { name: statusConfig.no.buttonText });
    await user.click(no);

    // The NAME is on the button. An aria-label on the spinner satisfies "the spinner has a
    // name" and leaves this query finding nothing.
    expect(
      screen.getByRole('button', { name: `${statusConfig.no.buttonText}, saving` })
    ).toBe(no);

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'no', note: null });
      await write.promise;
    });
  });

  it('the 44px floor is on the button class list (SOURCE half — the phone lane measures the box)', async () => {
    renderSection();
    await screen.findByRole('button', { name: statusConfig.no.buttonText });

    for (const status of ['yes', 'maybe', 'no'] as const) {
      const button = statusButton(status);
      expect(button.className).toMatch(/(^|\s)min-h-11(\s|$)/);
      // The floor REPLACES the vertical padding; restoring the pairing is the recorded
      // prohibition (`NextGameNightCard.tsx:502-506`).
      expect(button.className).not.toMatch(/(^|\s)(py-|p-)\d/);
      // The trio stays a BARE button: no `.btn`, and its three survivals are intact.
      expect(button.className).not.toMatch(/(^|\s)btn(\s|-|$)/);
      expect(button.className).toContain('first:rounded-l-[inherit]');
      expect(button.className).toContain('last:rounded-r-[inherit]');
    }
    expect(statusButton('maybe').className).toMatch(/border-l\b/);
    expect(statusButton('yes').className).toMatch(/border-2/);
  });
});

describe('RsvpSection W44 — the Save-note button takes the same split', () => {
  it('uses aria-disabled (never native disabled) and its busy string ADDS to the name', async () => {
    const user = userEvent.setup();
    renderSection();
    const save = await screen.findByRole('button', { name: 'Save note' });

    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);
    await user.click(save);

    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(document.activeElement).toBe(save);
    // ADDITIVE, not a replacement: a bare "Saving..." swap would make this query fail and
    // `getByRole('button', { name: 'Saving...' })` succeed instead.
    expect(screen.getByRole('button', { name: 'Save note, saving' })).toBe(save);

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'yes', note: null });
      await write.promise;
    });
  });
});

describe('RsvpSection W44/P3 — the outcome regions', () => {
  it('the FAILURE region is present in the INITIAL render, before any failure', async () => {
    renderSection();
    await screen.findByRole('button', { name: statusConfig.no.buttonText });

    // Presence, asserted on its own. A conditionally-mounted <p> passes the content assertion
    // below and fails this one.
    const failure = screen.getByRole('alert');
    expect(failure).toBeInTheDocument();
    expect(failure.textContent?.trim()).toBe('');
  });

  it('the failure TEXT lands in that same already-mounted region', async () => {
    const user = userEvent.setup();
    renderSection();
    const no = await screen.findByRole('button', { name: statusConfig.no.buttonText });

    const failure = screen.getByRole('alert');
    submitRsvp.mockRejectedValue(new Error('network down'));
    await user.click(no);

    await waitFor(() =>
      expect(failure.textContent).toContain('Could not save your response')
    );
    // The SAME node — never remounted.
    expect(screen.getByRole('alert')).toBe(failure);
  });

  it('announces EVERY note save, proven by NODE IDENTITY across two consecutive saves', async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole('button', { name: 'Save note' });

    // Captured ONCE and never re-queried: re-querying would pass against a region that is
    // unmounted and remounted per announcement, which is the defect being pinned.
    const region = screen.getByRole('status');
    expect(region.textContent?.trim()).toBe('');

    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(region.textContent?.trim()).toBe(NOTE_SAVED_COPY));
    expect(screen.getByRole('status')).toBe(region);

    // SECOND save, deferred so the in-flight window is observable: the region must be EMPTY
    // while the second request is still in flight, which is what proves the clear happened at
    // the START of the handler rather than only alongside the set.
    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(region.textContent?.trim()).toBe('');

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'yes', note: null });
      await write.promise;
    });

    await waitFor(() => expect(region.textContent?.trim()).toBe(NOTE_SAVED_COPY));
    expect(screen.getByRole('status')).toBe(region);
  });

  it('success and failure CLEAR EACH OTHER — the two regions cannot contradict', async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole('button', { name: 'Save note' });

    const success = screen.getByRole('status');
    const failure = screen.getByRole('alert');

    // POSITIVE settle signal first: a success actually lands before the absence is asserted.
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(success.textContent?.trim()).toBe(NOTE_SAVED_COPY));

    submitRsvp.mockRejectedValue(new Error('network down'));
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(failure.textContent?.trim()).not.toBe(''));
    expect(success.textContent?.trim()).toBe('');

    submitRsvp.mockResolvedValue({ id: 'rsvp-own', status: 'yes', note: null });
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(success.textContent?.trim()).toBe(NOTE_SAVED_COPY));
    expect(failure.textContent?.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------------------
// Phase 88.6-29 — W60 / W61.
//
// 11. KEYSTROKES LOST TO THEIR OWN SAVE (W60). `handleSaveNote` cleared `noteDirty`
//     unconditionally after the submit await but BEFORE the follow-up `fetchRsvps`, so a
//     keystroke typed during that round trip lost its dirty flag and the (correct) gated
//     re-syncs repainted the server's value over it. Written RED against the unfixed code.
//
// 12. A SUPERSEDED RESPONSE APPLIED (W61). Four polarities, because three of them can be
//     satisfied by a guard that is wrong in the opposite direction: a superseded response is
//     discarded, a CURRENT one is still applied (the negative control — a guard that discards
//     everything is not a guard), a superseded REJECTION renders no banner, and a response
//     landing after unmount writes nothing.
//
// 13. AN UNDER-GUARDED HANDLER FETCH. `fetchRsvps` is called from THREE places; a literal copy
//     of the port's effect-local `let cancelled` guards ONE of them and leaves the two handler
//     fetches unguarded with nothing to show for it. The staleness arms below drive through a
//     HANDLER-initiated fetch on purpose — the mount-effect route cannot see that mistake.
const STALE_SUMMARY = { yes: 9, maybe: 0, no: 0 };

const withSummary = (summary: { yes: number; maybe: number; no: number }, note: string) => ({
  rsvps: [
    {
      id: 'rsvp-own',
      event_id: EVENT_ID,
      user_id: SELF_UUID,
      status: 'yes',
      note,
      User: { id: SELF_UUID, username: 'me' },
    },
  ],
  summary,
});

describe('RsvpSection W60 — keystrokes typed DURING a save survive it', () => {
  it('a draft typed while the save is in flight is NOT repainted by the follow-up re-sync', async () => {
    const user = userEvent.setup();
    renderSection();

    const textarea = await screen.findByPlaceholderText('Add a note (optional)');
    await waitFor(() => expect(textarea).toHaveValue('running late, start without me'));

    await user.clear(textarea);
    await user.type(textarea, 'bringing dice');

    // The save leaves, and the user keeps typing before it lands.
    const write = deferred<unknown>();
    submitRsvp.mockReturnValue(write.promise);
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await user.type(textarea, ' and snacks');
    expect(textarea).toHaveValue('bringing dice and snacks');

    await act(async () => {
      write.resolve({ id: 'rsvp-own', status: 'yes', note: 'bringing dice' });
      await write.promise;
    });

    // POSITIVE settle signal before the persistence claim: the follow-up re-sync has actually
    // run, so this is not satisfied on the first tick.
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(2));
    expect(textarea).toHaveValue('bringing dice and snacks');
  });
});

describe('RsvpSection W61 — superseded and post-unmount responses write nothing', () => {
  it('a SUPERSEDED response from a HANDLER-initiated fetch is discarded', async () => {
    const user = userEvent.setup();
    const stale = deferred<unknown>();
    // Call 1 = the mount effect (resolves at once). Call 2 = the fetch `handleStatusClick`
    // awaits — held open. Call 3 = the new event's mount fetch after the switch.
    getEventRsvps
      .mockResolvedValueOnce(withSummary({ yes: 1, maybe: 0, no: 0 }, 'note A'))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue(withSummary({ yes: 2, maybe: 0, no: 0 }, 'note B'));

    const { rerender } = render(
      <RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await screen.findByText('1 Yes');

    await user.click(statusButton('no'));
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(2));

    // The switch supersedes the in-flight handler fetch.
    rerender(
      <RsvpSection eventId="evt-B" self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await screen.findByText('2 Yes');

    await act(async () => {
      stale.resolve(withSummary(STALE_SUMMARY, 'STALE NOTE'));
      await stale.promise;
    });

    // The stale value never renders, and the fresh one is still standing.
    expect(screen.queryByText('9 Yes')).toBeNull();
    expect(screen.getByText('2 Yes')).toBeInTheDocument();
  });

  it('the CURRENT response IS applied — the negative control', async () => {
    const user = userEvent.setup();
    getEventRsvps
      .mockResolvedValueOnce(withSummary({ yes: 1, maybe: 0, no: 0 }, 'note A'))
      .mockResolvedValue(withSummary({ yes: 4, maybe: 0, no: 0 }, 'note A'));

    renderSection();
    await screen.findByText('1 Yes');

    await user.click(statusButton('no'));
    // A guard that discards everything would leave "1 Yes" standing here for ever.
    await screen.findByText('4 Yes');
  });

  it('a superseded fetch that REJECTS renders NO error banner', async () => {
    const user = userEvent.setup();
    const stale = deferred<unknown>();
    getEventRsvps
      .mockResolvedValueOnce(withSummary({ yes: 1, maybe: 0, no: 0 }, 'note A'))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue(withSummary({ yes: 2, maybe: 0, no: 0 }, 'note B'));

    const { rerender } = render(
      <RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await screen.findByText('1 Yes');

    await user.click(statusButton('no'));
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(2));

    rerender(
      <RsvpSection eventId="evt-B" self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    // POSITIVE settle signal first — the fresh read has landed, so the absence below is
    // observed against the state under test rather than on the first tick.
    await screen.findByText('2 Yes');

    await act(async () => {
      stale.reject(new Error('superseded and failing'));
      await stale.promise.catch(() => {});
    });

    expect(screen.getByRole('alert').textContent?.trim()).toBe('');
    expect(screen.queryByText('Could not load RSVPs')).toBeNull();
  });

  /* THE CLEANUP CLAUSE, PROVEN. The effect cleanup is what bumps the generation, and it fires on
     BOTH an identity change and unmount — one clause, two triggers. Unmount itself has no
     observable signal in React 18 (see the arm below), so the clause is proven here, through the
     trigger that does: a superseded MOUNT fetch must not clear `loading` either, because the
     `finally` is one of the guard's four checkpoints. Unguarded, resolving the superseded read
     renders the loaded card while the fresh read is still in flight. */
  it('a superseded MOUNT fetch does not clear the loading state (the finally checkpoint)', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    getEventRsvps.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(
      <RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    rerender(
      <RsvpSection eventId="evt-B" self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(withSummary(STALE_SUMMARY, 'STALE NOTE'));
      await first.promise;
    });

    // Still the skeleton: the superseded read cleared neither the data nor the flag.
    expect(screen.getByText('Loading RSVPs...')).toBeInTheDocument();
    expect(screen.queryByText('9 Yes')).toBeNull();

    await act(async () => {
      second.resolve(withSummary({ yes: 2, maybe: 0, no: 0 }, 'note B'));
      await second.promise;
    });
    await screen.findByText('2 Yes');
  });

  /* LABELLED HONESTLY: this arm is NOT discriminating and was measured as such — it is GREEN
     against the pre-fix component. React 18 removed the unmounted-setState warning and an update
     scheduled on an unmounted fiber is bailed out before `scheduleUpdateOnFiber` can warn, so
     "no state write after unmount" has no observable signal from outside the component. It is
     kept as a REGRESSION guard (it would catch a future runtime that reinstates the warning, and
     it catches a resolution path that throws), and the cleanup clause it belongs to is actually
     PROVEN by the arm directly above, which drives the same cleanup through its other trigger. */
  it('a response landing AFTER unmount produces no state write (hygiene arm — see the note above)', async () => {
    const late = deferred<unknown>();
    getEventRsvps.mockReturnValue(late.promise);

    // React 18 removed the "state update on an unmounted component" warning, so the observable
    // signal is the act(...) warning React still emits when an UNGUARDED update is scheduled
    // from outside act. The guard makes the resolution a pure no-op: no update is scheduled at
    // all, so nothing is logged and nothing throws.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(
      <RsvpSection eventId={EVENT_ID} self={{ id: SELF_UUID }} eventDate={EVENT_DATE} />
    );
    await waitFor(() => expect(getEventRsvps).toHaveBeenCalledTimes(1));

    unmount();
    late.resolve(withSummary(STALE_SUMMARY, 'note after unmount'));
    // Deliberately NOT wrapped in act(): wrapping it would suppress the very warning this arm
    // reads. Two macrotask turns let the component's own `.then`/`finally` continuations run.
    await late.promise;
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const actWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes('not wrapped in act')
    );
    expect(actWarnings).toEqual([]);
    consoleError.mockRestore();
  });
});
