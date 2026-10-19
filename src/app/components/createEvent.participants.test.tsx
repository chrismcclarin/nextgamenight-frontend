// Phase 88-33 Task 2 (WI-F2) — draft participant integrity in the Create Event modal.
//
// Covers the four things the walk broke on: M5 (you could not type through a
// member's name), stable row identity (a middle-row removal donated its typed
// state to its neighbour), undo-on-remove (fork 4), and the duplicate-name hint
// (triage A1 — non-blocking by ruling).
//
// Since plan 88.6.1-26 it also covers the submit's in-flight guard and its in-flight label in both
// modes (create and edit): one submit at a time, `aria-disabled` (never native `disabled`), and
// copy row C7 `Creating...` / `Updating...`. The guard needs none of the scheduling half.
//
// The modal's scheduling half is stubbed out: this file is about the
// participants list, and EventScheduler/heatmap are expensive to mount (a 28-row x 7-column
// grid plus its gesture machine). The mock is STILL justified after plan 88.1-16 removed
// react-big-calendar — the reason changed from "pulls in a heavy dependency" to "is heavy
// to mount", but the cost this file is avoiding did not go away with the dependency.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// `vi.hoisted`: the vi.mock factory below is hoisted above module-level consts.
const fixtures = vi.hoisted(() => ({
  members: [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Alice', email: 'alice@example.com' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'Bob', email: 'bob@example.com' },
  ],
  // Plan 88.6.1-68 (ED5): the EventScheduler stub's latest props.
  schedulerProps: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

// Plan 88.6.1-81: the two toast channels createEvent.js calls (success and error), spied so an arm
// can count receipts. The EventDayModal.test.tsx idiom (hoisted spies, a factory that returns them).
const toastSpies = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSpies.success, error: toastSpies.error } }));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', browserTimezone: 'America/New_York' }),
}));

// Scheduling surface — out of scope here and heavy to mount.
// Plan 88.6.1-68 (ED5): it also records its latest props (the other arms never read them).
vi.mock('@/app/components/EventScheduler', () => ({
  default: (props: Record<string, unknown>) => {
    fixtures.schedulerProps = props;
    return <div>scheduler</div>;
  },
}));
vi.mock('@/app/components/EventHeatmapBackground', () => ({ default: () => null }));
vi.mock('@/app/components/GameComboInput', () => ({ default: () => <div>game input</div> }));
vi.mock('@/app/components/QuickSuggestions', () => ({ default: () => null }));
vi.mock('@/app/components/BallotOptionsEditor', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/useSwipeNavigation', () => ({ default: () => ({}) }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      ...actual.groupsAPI,
      getGroupMembers: vi.fn().mockResolvedValue(fixtures.members),
    },
    gamesAPI: { ...actual.gamesAPI, searchAll: vi.fn().mockResolvedValue([]) },
    eventsAPI: { ...actual.eventsAPI, createEvent: vi.fn().mockResolvedValue({}), updateEvent: vi.fn().mockResolvedValue({}), getEvent: vi.fn() },
    ballotAPI: { ...actual.ballotAPI, getBallot: vi.fn().mockResolvedValue(null) },
    availabilityAPI: {
      ...actual.availabilityAPI,
      getGroupHeatmap: vi.fn().mockResolvedValue({ slots: [], totalMembers: 0 }),
    },
    promptAPI: { ...actual.promptAPI, getPromptHeatmap: vi.fn().mockResolvedValue(null) },
  };
});

import CreateEventDefault from './createEvent';
import { eventsAPI, groupsAPI } from '@/lib/api';
import { ballotAPI } from '@/lib/api';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { logger } from '@/lib/logger';

// createEvent is a JS component whose inferred prop types come from its defaults
// (`editingEvent = null` infers `null`); cast to a permissive type so the edit-mode arm can pass
// an event (plan 88.6.1-26, C4).
const CreateEvent = CreateEventDefault as unknown as React.ComponentType<Record<string, unknown>>;

/** Every visible participant-name input, in DOM order. */
function nameInputs(): HTMLInputElement[] {
  return screen.getAllByLabelText('Participant Name') as HTMLInputElement[];
}

/** The Remove button belonging to the Nth participant row. */
function removeButtons(): HTMLElement[] {
  return screen.getAllByTitle('Remove participant');
}

/** Row count. Member rows render read-only (no name input), so rows are counted
 *  by the per-row Score control, which every row carries. */
function rowCount(): number {
  return screen.getAllByLabelText('Score').length;
}

/** The props every arm renders with. One object per test, so a rerender passes the SAME
 *  `modaltoggle` and `onEventCreated` spies (plan 88.6.1-81). */
function baseProps(): Record<string, unknown> {
  return {
    group_id: 'group-1',
    modal: true,
    modaltoggle: vi.fn(),
    onEventCreated: vi.fn(),
    user: { sub: 'auth0|self' },
    hideVisualCalendar: true,
    userRole: 'owner',
  };
}

async function renderModal(override: Record<string, unknown> = {}) {
  const view = render(<CreateEvent {...baseProps()} {...override} />);
  // The member rows arrive with the group-members fetch.
  await screen.findByText('Alice');
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M5 — typing through a member name (UAT row 497)', () => {
  it('accepts the LAST character of an exact member name', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));

    const guest = nameInputs().find(i => i.value === '')!;
    expect(guest).toBeTruthy();

    // The walk's exact failure: "I type in Alic and then it won't let me type
    // the last e". Each keystroke replays the whole value, as a real input does.
    for (const value of ['A', 'Al', 'Ali', 'Alic', 'Alice']) {
      fireEvent.change(guest, { target: { value } });
    }
    expect(guest.value).toBe('Alice');

    // ...and then STRAIGHT THROUGH the boundary into a member-adjacent name.
    fireEvent.change(guest, { target: { value: 'Alice1' } });
    expect(guest.value).toBe('Alice1');
  });

  it('lets a second same-named guest be created (fork 3: duplicates allowed)', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const first = nameInputs().find(i => i.value === '')!;
    fireEvent.change(first, { target: { value: 'Bob' } });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const second = nameInputs().find(i => i.value === '')!;
    fireEvent.change(second, { target: { value: 'Bob' } });

    expect(nameInputs().filter(i => i.value === 'Bob')).toHaveLength(2);
  });
});

describe('duplicate-name hint (triage A1 — informational, never blocking)', () => {
  it('appears when a typed name collides and never disables submit', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const guest = nameInputs().find(i => i.value === '')!;
    fireEvent.change(guest, { target: { value: 'Alice' } });

    expect(
      await screen.findByText("Heads up: there's already a participant named Alice.")
    ).toBeInTheDocument();
    // Non-blocking: the field still holds the value and submit stays enabled.
    expect(guest.value).toBe('Alice');
    expect(screen.getByRole('button', { name: /Create Event/i })).not.toBeDisabled();
  });

  it('is absent for a unique name', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    const guest = nameInputs().find(i => i.value === '')!;
    fireEvent.change(guest, { target: { value: 'Zonker' } });

    expect(screen.queryByText(/Heads up: there's already a participant/)).not.toBeInTheDocument();
  });
});

describe('stable row identity + undo (UAT rows 510, 557)', () => {
  it('removing a MIDDLE row leaves the survivors\' typed state attached to the right people', async () => {
    await renderModal();
    // Two guests after the two members: [Alice, Bob, G1, G2]
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    fireEvent.change(nameInputs().find(i => i.value === '')!, { target: { value: 'Gina' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    fireEvent.change(nameInputs().find(i => i.value === '')!, { target: { value: 'Hal' } });

    const scores = screen.getAllByLabelText('Score') as HTMLInputElement[];
    fireEvent.change(scores[2], { target: { value: '11' } }); // Gina
    fireEvent.change(scores[3], { target: { value: '22' } }); // Hal

    // Remove Bob (a MIDDLE row).
    fireEvent.click(removeButtons()[1]);

    await waitFor(() => expect(rowCount()).toBe(3));
    const after = screen.getAllByLabelText('Score') as HTMLInputElement[];
    // Gina and Hal keep THEIR scores — with index keys, Gina inherited Bob's row.
    expect(after[1].value).toBe('11');
    expect(after[2].value).toBe('22');
  });

  it('offers Undo, restores the row with its typed data, and puts focus on the control', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));
    fireEvent.change(nameInputs().find(i => i.value === '')!, { target: { value: 'Gina' } });
    const scores = screen.getAllByLabelText('Score') as HTMLInputElement[];
    fireEvent.change(scores[2], { target: { value: '11' } });
    const factions = screen.getAllByLabelText('Faction') as HTMLInputElement[];
    fireEvent.change(factions[2], { target: { value: 'Reds' } });

    fireEvent.click(removeButtons()[2]);

    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByText('Gina removed')).toBeInTheDocument();
    await waitFor(() => expect(undo).toHaveFocus());

    fireEvent.click(undo);

    await waitFor(() =>
      expect(nameInputs().some(i => i.value === 'Gina')).toBe(true)
    );
    const restoredScores = screen.getAllByLabelText('Score') as HTMLInputElement[];
    const restoredFactions = screen.getAllByLabelText('Faction') as HTMLInputElement[];
    expect(restoredScores[2].value).toBe('11');
    expect(restoredFactions[2].value).toBe('Reds');
    // Offer consumed.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('does NOT offer undo when the keep-at-least-one guard blocks the removal', async () => {
    await renderModal();
    // Drop to a single row, then try to remove it.
    fireEvent.click(removeButtons()[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss undo for Alice' }));
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.click(removeButtons()[0]);

    expect(rowCount()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('announces the removal politely', async () => {
    await renderModal();
    fireEvent.click(removeButtons()[1]);

    await waitFor(() => {
      const regions = screen.getAllByRole('status');
      expect(regions.some(r => r.textContent === 'Bob removed. Undo is available.')).toBe(true);
    });
  });
});

// 88-33 Task 4 (UAT row 542): "+ Add Participant" moves focus into the fresh
// row's name input so the person can type the name immediately — the walk found
// the new row appended off-screen with focus still on the button.
describe('add-participant focus (UAT row 542)', () => {
  it("moves focus to the freshly added row's name input", async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Participant' }));

    const inputs = nameInputs();
    const fresh = inputs[inputs.length - 1]; // new rows append at the end
    expect(fresh.value).toBe('');
    await waitFor(() => expect(fresh).toHaveFocus());
  });
});

// Plan 88.6.1-26 (D-35 rule of POSITION, copy row C7, plan 88.6.1-15's finding). Create Event's
// submit had NO in-flight guard: one double tap created two events and sent two rounds of
// notifications, and the button gave no sign it was working. It now refuses a second submit on
// the first statement after `e.preventDefault()`, carries `aria-disabled` (never native
// `disabled`, which drops a keyboard user to <body>) and reads `Creating...` / `Updating...`.
describe('createEvent — the submit refuses a second press, stays focusable and says it is working (88.6.1-26, D-35, C7)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function holdOnce(fn: unknown) {
    let resolve: (v: unknown) => void = () => {};
    (fn as Mock).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    return (v: unknown = {}) => resolve(v);
  }

  function submitButton(): HTMLElement {
    return screen.getByTestId('create-event-submit');
  }

  it('C1: two submits dispatched in ONE act create exactly one event (Edge R4 idempotency)', async () => {
    await renderModal();
    const form = submitButton().closest('form') as HTMLFormElement;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1);
  });

  it('C2: while creating, the submit is aria-disabled (not disabled) and reads Creating...; then Create Event again', async () => {
    const release = holdOnce(eventsAPI.createEvent);
    await renderModal();
    const form = submitButton().closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    expect(submitButton()).not.toHaveAttribute('disabled');
    // Copy row C7, exact bytes: three ASCII full stops.
    expect(submitButton()).toHaveAccessibleName('Creating...');

    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 30));
    expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1);
    expect(submitButton()).toHaveAccessibleName('Creating...');

    // The modaltoggle stub keeps the dialog mounted, so the restore after a SUCCESS is observable.
    release({});
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-disabled'));
    expect(submitButton()).toHaveAccessibleName('Create Event');
  });

  // CONFIRM-ONLY (green before the fix by design): guards the release in `finally`.
  it('C3: after a FAILED create the submit is released (Create Event, no aria-disabled) and a retry creates', async () => {
    const toastError = vi.spyOn(toast, 'error');
    (eventsAPI.createEvent as Mock).mockRejectedValueOnce(new Error('boom'));
    await renderModal();
    const form = submitButton().closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    // Positive signal first: the rejection was handled (its toast fired).
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-disabled'));
    expect(submitButton()).toHaveAccessibleName('Create Event');

    fireEvent.submit(form);
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(2));
  });

  it('C4: in EDIT mode the submit reads Updating... while it works, then Update Event again', async () => {
    const release = holdOnce(eventsAPI.updateEvent);
    // Plan 88.6.1-68: the Edit dialog now reads the event fresh when it opens, so the arm hands
    // that read the same event it passes as `editingEvent`.
    vi.mocked(eventsAPI.getEvent).mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      group_id: 'group-1',
      game_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      Game: { name: 'Catan' },
      EventParticipations: [],
      duration_minutes: 120,
    } as never);
    render(
      <CreateEvent
        group_id="group-1"
        modal
        modaltoggle={vi.fn()}
        onEventCreated={vi.fn()}
        user={{ sub: 'auth0|self' }}
        hideVisualCalendar
        userRole="owner"
        editingEvent={{
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          group_id: 'group-1',
          // A game_id, so onSubmit never reaches the unmocked gamesAPI.resolveGame.
          game_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          Game: { name: 'Catan' },
          EventParticipations: [],
          duration_minutes: 120,
        }}
      />
    );
    const button = await screen.findByRole('button', { name: 'Update Event' });
    expect(button).toBe(submitButton());
    const form = button.closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(eventsAPI.updateEvent).toHaveBeenCalledTimes(1));
    expect(submitButton()).toHaveAccessibleName('Updating...');
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    expect(submitButton()).not.toHaveAttribute('disabled');

    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 30));
    expect(eventsAPI.updateEvent).toHaveBeenCalledTimes(1);

    release({});
    await waitFor(() => expect(submitButton()).toHaveAccessibleName('Update Event'));
    expect(submitButton()).not.toHaveAttribute('aria-disabled');
  });
});

// Plan 88.6.1-81. A create can outlive its dialog: the dialog stays closable mid-create (owner
// ruling, D-55 (b)), so the person can close it and open it again while the first request is still
// running. These arms pin what createEvent.js does then. groupHomePage and groupPlanning keep the
// SAME instance mounted (closing only hides it), so S1-S3 close and reopen through a rerender; the
// gameDetail hosts mount a FRESH instance per open, which F1-F4 drive with an unmount and a second
// render. Every held request is settled before its test ends, because a held entry would otherwise
// outlive the test.
describe('createEvent — a request that outlives its dialog (88.6.1-81: dialog session, one payload in flight)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  type View = ReturnType<typeof render>;

  function holdOnce(fn: unknown) {
    let settle: { resolve: (v: unknown) => void; reject: (e: unknown) => void } = {
      resolve: () => {},
      reject: () => {},
    };
    (fn as Mock).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        })
    );
    return {
      resolve: (v: unknown = {}) => settle.resolve(v),
      reject: (e: unknown) => settle.reject(e),
    };
  }

  function submitButton(): HTMLElement {
    return screen.getByTestId('create-event-submit');
  }

  function submitForm() {
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
  }

  function comments(): HTMLTextAreaElement {
    return screen.getByLabelText('Comments') as HTMLTextAreaElement;
  }

  // Let every pending promise continuation and the React commit it schedules run.
  async function flush() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  // Close the dialog, then open it again, as an always-mounted host does (`modal` false, then true).
  // The reopen re-runs the members fetch, which rebuilds the create form; wait for that rebuild to
  // land before typing, or it would overwrite what the arm types.
  async function closeAndReopen(view: View, props: Record<string, unknown>) {
    const fetchesBefore = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    view.rerender(<CreateEvent {...props} modal={false} />);
    view.rerender(<CreateEvent {...props} modal />);
    await waitFor(() =>
      expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(fetchesBefore + 1)
    );
    await screen.findByText('Alice');
    await flush();
  }

  function expectLiveCreate() {
    expect(submitButton()).toHaveAccessibleName('Create Event');
    expect(submitButton()).not.toHaveAttribute('aria-disabled');
  }

  it('S1: a create that settles after a close and a reopen leaves the reopened dialog, its typed text and its button alone', async () => {
    const first = holdOnce(eventsAPI.createEvent);
    const props = baseProps();
    const view = await renderModal(props);
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));

    await closeAndReopen(view, props);
    // A fresh session: the reopened button carries no press it never had.
    expectLiveCreate();
    fireEvent.change(comments(), { target: { value: 'second session' } });

    first.resolve({ id: 'evt-1' });
    // Positive signals first: the host refresh and the receipt still happen for the late create.
    await waitFor(() => expect(props.onEventCreated).toHaveBeenCalledTimes(1));
    expect(props.onEventCreated).toHaveBeenCalledWith({ id: 'evt-1' });
    expect(toastSpies.success).toHaveBeenCalledTimes(1);
    expect(toastSpies.success).toHaveBeenCalledWith('Event created');
    await flush();
    // Then the absences: the reopened dialog is not closed, wiped or latched.
    expect(props.modaltoggle).not.toHaveBeenCalled();
    expect(comments().value).toBe('second session');
    expectLiveCreate();
  });

  it('S2: a create that settles after the dialog closed (and was not reopened) does not close it a second time; a later open starts live', async () => {
    const first = holdOnce(eventsAPI.createEvent);
    const props = baseProps();
    const view = await renderModal(props);
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));

    view.rerender(<CreateEvent {...props} modal={false} />);
    first.resolve({ id: 'evt-1' });
    await waitFor(() => expect(props.onEventCreated).toHaveBeenCalledTimes(1));
    expect(toastSpies.success).toHaveBeenCalledTimes(1);
    await flush();
    // The person's own close already ran the host's close; a second call is what closes a
    // reopened dialog.
    expect(props.modaltoggle).not.toHaveBeenCalled();

    view.rerender(<CreateEvent {...props} modal />);
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledTimes(2));
    await screen.findByText('Alice');
    await flush();
    expectLiveCreate();
  });

  it('S3: a different event created from the reopened dialog is sent; the old request neither releases nor closes the new one', async () => {
    const first = holdOnce(eventsAPI.createEvent);
    const props = baseProps();
    const view = await renderModal(props);
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));

    await closeAndReopen(view, props);
    fireEvent.change(comments(), { target: { value: 'second session' } });
    const second = holdOnce(eventsAPI.createEvent);
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(2));
    // Session 2's own press.
    expect(submitButton()).toHaveAccessibleName('Creating...');
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');

    first.resolve({ id: 'evt-1' });
    await waitFor(() => expect(props.onEventCreated).toHaveBeenCalledTimes(1));
    await flush();
    // The stale request released nothing and closed nothing.
    expect(submitButton()).toHaveAccessibleName('Creating...');
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    expect(props.modaltoggle).not.toHaveBeenCalled();

    second.resolve({ id: 'evt-2' });
    // Session 2's own success closes its own dialog.
    await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
    expect(toastSpies.success).toHaveBeenCalledTimes(2);
    expect(props.onEventCreated).toHaveBeenCalledTimes(2);
  });

  it('F1: a fresh instance pressing the SAME details while the first create runs joins it: one request, its own refresh, one receipt', async () => {
    const first = holdOnce(eventsAPI.createEvent);
    const props = baseProps();
    const viewA = await renderModal(props);
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));

    // A conditional host unmounts the dialog on close and mounts a fresh one on the next open.
    viewA.unmount();
    // B's OWN refresh spy is load-bearing: with one shared spy the joiner's call reads 2 and this
    // arm fails. Never "fix" that by going back to the shared factory spy.
    const onEventCreatedB = vi.fn();
    await renderModal({ ...props, onEventCreated: onEventCreatedB });
    submitForm();
    // B's own press shows at once (copy row C7)...
    expect(submitButton()).toHaveAccessibleName('Creating...');
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    // ...and inside the join window no second request is sent.
    await new Promise((r) => setTimeout(r, 50));
    expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1);

    first.resolve({ id: 'evt-1' });
    // B ends its own session with the shared outcome.
    await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
    expect(props.onEventCreated).toHaveBeenCalledTimes(1);
    expect(onEventCreatedB).toHaveBeenCalledTimes(1);
    expect(onEventCreatedB).toHaveBeenCalledWith({ id: 'evt-1' });
    // The 88-16 order for the joiner: its own refresh, then its close.
    expect(onEventCreatedB.mock.invocationCallOrder[0]).toBeLessThan(
      (props.modaltoggle as Mock).mock.invocationCallOrder[0]
    );
    // One write, one receipt: the originator's.
    expect(toastSpies.success).toHaveBeenCalledTimes(1);
    await waitFor(() => expectLiveCreate());
  });

  it('F3: a joined create that FAILS gives one error toast (the originator\'s); the joiner keeps its form and a retry sends', async () => {
    const first = holdOnce(eventsAPI.createEvent);
    const props = baseProps();
    const viewA = await renderModal(props);
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));

    viewA.unmount();
    await renderModal(props);
    submitForm();
    expect(submitButton()).toHaveAccessibleName('Creating...');
    await new Promise((r) => setTimeout(r, 50));
    expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1);

    first.reject(new Error('boom'));
    // Positive signals first: the originator's notice, and the joiner's release.
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expectLiveCreate());
    await flush();
    expect(toastSpies.error).toHaveBeenCalledTimes(1);
    expect(props.modaltoggle).not.toHaveBeenCalled();
    expect(props.onEventCreated).not.toHaveBeenCalled();

    // The key was freed when the first request settled, so the retry sends.
    submitForm();
    await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(2));
    // Let the retry settle before the test ends.
    await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
  });

  it('F4: past the 30-second join window an identical press sends again, so a hung create never blocks the retry', async () => {
    // Only Date is faked: the window compares start times read with Date.now(). setTimeout stays
    // real, because renderModal awaits findByText and waitFor polls on real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-17T19:00:00Z'));
      const first = holdOnce(eventsAPI.createEvent);
      const props = baseProps();
      const viewA = await renderModal(props);
      submitForm();
      await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(1));

      viewA.unmount();
      // 31 seconds later: past createEvent.js's JOIN_WINDOW_MS (30 seconds).
      vi.setSystemTime(new Date('2026-10-17T19:00:31Z'));
      const second = holdOnce(eventsAPI.createEvent);
      await renderModal(props);
      submitForm();
      // A new originator: it sends, and shows its own press.
      await waitFor(() => expect(eventsAPI.createEvent).toHaveBeenCalledTimes(2));
      expect(submitButton()).toHaveAccessibleName('Creating...');
      expect(submitButton()).toHaveAttribute('aria-disabled', 'true');

      // Settle both before the test ends: the newer first, then the hung one.
      second.resolve({ id: 'evt-2' });
      await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
      first.resolve({ id: 'evt-1' });
      await waitFor(() => expect(props.onEventCreated).toHaveBeenCalledTimes(2));
      await flush();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Plan 88.6.1-68. The Edit dialog builds its form from the event AS THE SERVER HOLDS IT, read when
// the dialog opens and only after every update this device still has in flight for that event has
// settled — never from the host's pre-update copy. The gameDetail hosts mount a FRESH instance per
// open, so these arms close with an unmount and reopen with a second render that still passes the
// host's old copy (`v1`), exactly as the host would. See DECISION Phase 88.6.1-68 (edit reads the
// event fresh) in createEvent.js.
describe('createEvent edit mode reads the event fresh (88.6.1-68: a reopened Edit dialog never shows or sends the pre-update copy)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  const EV = '99999999-9999-4999-8999-999999999999';
  const OTHER_EV = '88888888-8888-4888-8888-888888888888';
  const v1 = {
    id: EV,
    group_id: 'group-1',
    // A game_id, so onSubmit never reaches the unmocked gamesAPI.resolveGame.
    game_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    Game: { name: 'Catan' },
    EventParticipations: [],
    duration_minutes: 120,
    comments: 'v1 notes',
  };

  function deferred<T>() {
    let resolve: (v: T) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function comments(): HTMLTextAreaElement {
    return screen.getByLabelText('Comments') as HTMLTextAreaElement;
  }

  async function settle(ms = 50) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  afterEach(() => {
    vi.mocked(eventsAPI.getEvent).mockReset();
  });

  it('ED0: create mode keeps its own loading line, Loading group members... (confirm-only)', async () => {
    const members = deferred<unknown>();
    vi.mocked(groupsAPI.getGroupMembers).mockReturnValueOnce(members.promise as never);
    render(<CreateEvent {...baseProps()} />);
    expect(await screen.findByText('Loading group members...')).toBeInTheDocument();
    expect(screen.queryByText('Loading game night...')).toBeNull();
    await act(async () => {
      members.resolve(fixtures.members);
    });
    await screen.findByText('Alice');
  });

  it('ED1: reopened while the first update is still in flight, it waits on Loading game night..., then shows and sends the saved values', async () => {
    let server: Record<string, unknown> = v1;
    vi.mocked(eventsAPI.getEvent).mockImplementation((async () => server) as never);
    const A = render(<CreateEvent {...baseProps()} editingEvent={v1} />);
    await screen.findByRole('button', { name: 'Update Event' });
    fireEvent.change(comments(), { target: { value: 'v2 notes' } });
    const put = deferred<unknown>();
    (eventsAPI.updateEvent as Mock).mockImplementationOnce(() => put.promise);
    fireEvent.submit(screen.getByTestId('create-event-submit').closest('form') as HTMLFormElement);
    await waitFor(() => expect(eventsAPI.updateEvent).toHaveBeenCalledTimes(1));
    server = { ...v1, comments: 'v2 notes' };
    A.unmount();

    const readsBefore = vi.mocked(eventsAPI.getEvent).mock.calls.length;
    render(<CreateEvent {...baseProps()} editingEvent={v1} />);
    await settle();
    expect(screen.getByText('Loading game night...')).toBeInTheDocument();
    expect(screen.queryByText('Loading group members...')).toBeNull();
    expect(screen.queryByTestId('create-event-submit')).toBeNull();
    expect(vi.mocked(eventsAPI.getEvent).mock.calls.length).toBe(readsBefore);

    await act(async () => {
      put.resolve({});
    });
    await waitFor(() => expect(comments().value).toBe('v2 notes'));
    const submit = screen.getByTestId('create-event-submit');
    expect(submit).toHaveAccessibleName('Update Event');
    expect(submit).not.toHaveAttribute('aria-disabled');

    fireEvent.submit(submit.closest('form') as HTMLFormElement);
    await waitFor(() => expect(eventsAPI.updateEvent).toHaveBeenCalledTimes(2));
    expect((eventsAPI.updateEvent as Mock).mock.calls[1][1]).toMatchObject({ comments: 'v2 notes' });
  });

  // 88.6.1 code review A-36 (= REVIEW WR-06): the settle-wait is bounded by the same JOIN_WINDOW_MS as
  // the payload join (F4), so a HUNG update never holds every later Edit dialog on its loading line.
  // Each arm uses its own event id and releases its hung write at the end, because the in-flight map
  // is module scope and would otherwise hold later arms' reads.
  async function hangAnUpdate(id: string) {
    const ev = { ...v1, id };
    vi.mocked(eventsAPI.getEvent).mockResolvedValue(ev as never);
    const A = render(<CreateEvent {...baseProps()} editingEvent={ev} />);
    await screen.findByRole('button', { name: 'Update Event' });
    const put = deferred<unknown>();
    (eventsAPI.updateEvent as Mock).mockImplementationOnce(() => put.promise);
    fireEvent.submit(screen.getByTestId('create-event-submit').closest('form') as HTMLFormElement);
    await waitFor(() => expect(eventsAPI.updateEvent).toHaveBeenCalledTimes(1));
    A.unmount();
    return { ev, put };
  }

  it('ED7: a hung update reopened PAST the 30-second window reads the event and opens the form', async () => {
    // Only Date is faked (the F4 idiom): the window compares start times read with Date.now().
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-17T19:00:00Z'));
      const { ev, put } = await hangAnUpdate('66666666-6666-4666-8666-666666666666');
      const readsBefore = vi.mocked(eventsAPI.getEvent).mock.calls.length;
      vi.setSystemTime(new Date('2026-10-17T19:00:31Z'));
      render(<CreateEvent {...baseProps()} editingEvent={ev} />);
      await waitFor(() => expect(vi.mocked(eventsAPI.getEvent).mock.calls.length).toBe(readsBefore + 1));
      expect(await screen.findByRole('button', { name: 'Update Event' })).toBeInTheDocument();
      expect(screen.queryByText('Loading game night...')).toBeNull();
      await act(async () => {
        put.resolve({});
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ED7b: a hung update reopened INSIDE the window waits only for what is left of it, then reads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-17T19:00:00Z'));
      const { ev, put } = await hangAnUpdate('55555555-5555-4555-8555-555555555555');
      const readsBefore = vi.mocked(eventsAPI.getEvent).mock.calls.length;
      // 29.85 seconds in: 150ms of the window are left, which the wait spends on a real timer.
      vi.setSystemTime(new Date('2026-10-17T19:00:29.850Z'));
      render(<CreateEvent {...baseProps()} editingEvent={ev} />);
      await settle(20);
      expect(screen.getByText('Loading game night...')).toBeInTheDocument();
      expect(vi.mocked(eventsAPI.getEvent).mock.calls.length).toBe(readsBefore);
      await waitFor(() => expect(vi.mocked(eventsAPI.getEvent).mock.calls.length).toBe(readsBefore + 1));
      expect(await screen.findByRole('button', { name: 'Update Event' })).toBeInTheDocument();
      await act(async () => {
        put.resolve({});
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ED8 (88.6.1 code review A-37): a failed ballot-option save on Update says so in the receipt, never "Event updated"', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const ev = { ...v1, id };
    vi.mocked(eventsAPI.getEvent).mockResolvedValue(ev as never);
    vi.mocked(ballotAPI.getBallot).mockResolvedValueOnce({
      ballot_status: 'open',
      options: [{ game_id: null, game_name: 'Catan' }, { game_id: null, game_name: 'Azul' }],
    } as never);
    const updateBallotOptions = vi.spyOn(ballotAPI, 'updateBallotOptions').mockRejectedValueOnce(new Error('ballot down'));
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const props = baseProps();
      render(<CreateEvent {...props} editingEvent={ev} />);
      await screen.findByRole('button', { name: 'Update Event' });
      await waitFor(() => expect(ballotAPI.getBallot).toHaveBeenCalledWith(id));
      await settle();
      fireEvent.submit(screen.getByTestId('create-event-submit').closest('form') as HTMLFormElement);
      await waitFor(() => expect(updateBallotOptions).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
      expect(toastSpies.error).toHaveBeenCalledWith('Event updated but ballot options could not be saved.');
      expect(toastSpies.success).not.toHaveBeenCalledWith('Event updated');
      // The 88-16 order: the receipt fires before the close.
      expect(toastSpies.error.mock.invocationCallOrder[0]).toBeLessThan(
        (props.modaltoggle as Mock).mock.invocationCallOrder[0],
      );
      // The failure is a Sentry EVENT, not a breadcrumb.
      expect(loggerError).toHaveBeenCalledWith('Error updating ballot options:', expect.any(Error));
    } finally {
      updateBallotOptions.mockRestore();
      loggerError.mockRestore();
    }
  });

  it('ED2: reopened after the update landed but before the host refreshed, it shows the saved values', async () => {
    let server: Record<string, unknown> = v1;
    vi.mocked(eventsAPI.getEvent).mockImplementation((async () => server) as never);
    const propsA = baseProps();
    const A = render(<CreateEvent {...propsA} editingEvent={v1} />);
    await screen.findByRole('button', { name: 'Update Event' });
    fireEvent.change(comments(), { target: { value: 'v2 notes' } });
    fireEvent.submit(screen.getByTestId('create-event-submit').closest('form') as HTMLFormElement);
    await waitFor(() => expect(propsA.modaltoggle).toHaveBeenCalledTimes(1));
    server = { ...v1, comments: 'v2 notes' };
    A.unmount();

    render(<CreateEvent {...baseProps()} editingEvent={v1} />);
    await waitFor(() => expect(comments().value).toBe('v2 notes'));
  });

  it('ED3: a failed re-read shows the register line and closes, and never builds a form', async () => {
    const error = new ApiError('Request failed', 'internal', 500);
    vi.mocked(eventsAPI.getEvent).mockRejectedValue(error);
    const props = baseProps();
    render(<CreateEvent {...props} editingEvent={v1} />);
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalledTimes(1));
    expect(toastSpies.error).toHaveBeenCalledWith(getFetchErrorMessage(error));
    await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('create-event-submit')).toBeNull();
  });

  it('ED3b: a re-read that answers for a different event is treated as a failed read', async () => {
    vi.mocked(eventsAPI.getEvent).mockResolvedValue({ ...v1, id: OTHER_EV } as never);
    const props = baseProps();
    render(<CreateEvent {...props} editingEvent={v1} />);
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalledTimes(1));
    expect(toastSpies.error).toHaveBeenCalledWith(getFetchErrorMessage(new Error('x')));
    await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('create-event-submit')).toBeNull();
  });

  it('ED6: a failed members read in edit mode shows the register line and closes, with no blank form', async () => {
    const error = new ApiError('Request failed', 'internal', 500);
    vi.mocked(groupsAPI.getGroupMembers).mockRejectedValueOnce(error);
    vi.mocked(eventsAPI.getEvent).mockResolvedValue(v1 as never);
    const props = baseProps();
    render(<CreateEvent {...props} editingEvent={v1} />);
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalledTimes(1));
    expect(toastSpies.error).toHaveBeenCalledWith(getFetchErrorMessage(error));
    await waitFor(() => expect(props.modaltoggle).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByTestId('create-event-submit')).toBeNull();
    expect(screen.queryByLabelText('Comments')).toBeNull();
  });

  it('ED6b: when both reads fail, one opening shows ONE toast and closes ONCE', async () => {
    vi.mocked(groupsAPI.getGroupMembers).mockRejectedValueOnce(new ApiError('Request failed', 'internal', 500));
    vi.mocked(eventsAPI.getEvent).mockRejectedValue(new ApiError('Request failed', 'internal', 500));
    const props = baseProps();
    render(<CreateEvent {...props} editingEvent={v1} />);
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalled());
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalled());
    await waitFor(() => expect(eventsAPI.getEvent).toHaveBeenCalled());
    await settle();
    expect(toastSpies.error).toHaveBeenCalledTimes(1);
    expect(props.modaltoggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('create-event-submit')).toBeNull();
  });

  it('ED4: the reopened dialog reads the game-vote options only after the first update settles', async () => {
    let server: Record<string, unknown> = v1;
    vi.mocked(eventsAPI.getEvent).mockImplementation((async () => server) as never);
    const A = render(<CreateEvent {...baseProps()} editingEvent={v1} />);
    await screen.findByRole('button', { name: 'Update Event' });
    fireEvent.change(comments(), { target: { value: 'v2 ballot notes' } });
    const put = deferred<unknown>();
    (eventsAPI.updateEvent as Mock).mockImplementationOnce(() => put.promise);
    fireEvent.submit(screen.getByTestId('create-event-submit').closest('form') as HTMLFormElement);
    await waitFor(() => expect(eventsAPI.updateEvent).toHaveBeenCalledTimes(1));
    server = { ...v1, comments: 'v2 ballot notes' };
    A.unmount();

    const ballotReadsBefore = vi.mocked(ballotAPI.getBallot).mock.calls.length;
    render(<CreateEvent {...baseProps()} editingEvent={v1} />);
    await settle();
    expect(vi.mocked(ballotAPI.getBallot).mock.calls.length).toBe(ballotReadsBefore);

    await act(async () => {
      put.resolve({});
    });
    await waitFor(() => expect(vi.mocked(ballotAPI.getBallot).mock.calls.length).toBe(ballotReadsBefore + 1));
    expect(vi.mocked(ballotAPI.getBallot).mock.calls.at(-1)?.[0]).toBe(EV);
  });

  it('ED5: the visual calendar opens on the saved start date, not the host copy\'s', async () => {
    // Its own event id, so a write an earlier arm left in flight for EV (only on a failing tree)
    // cannot hold this read.
    const id = '77777777-7777-4777-8777-777777777777';
    const hostCopy = { ...v1, id, start_date: '2026-11-02T19:00:00.000Z' };
    vi.mocked(eventsAPI.getEvent).mockResolvedValue({ ...v1, id, start_date: '2026-11-16T19:00:00.000Z' } as never);
    fixtures.schedulerProps = null;
    render(<CreateEvent {...baseProps()} hideVisualCalendar={false} editingEvent={hostCopy} />);
    await screen.findByRole('button', { name: 'Update Event' });
    await waitFor(() => expect(fixtures.schedulerProps).not.toBeNull());
    // Re-read through a cast: TypeScript narrowed the holder to null at the reset above.
    const recorded = fixtures.schedulerProps as Record<string, unknown> | null;
    const initialDate = recorded?.initialDate as Date;
    expect(initialDate.toISOString().slice(0, 10)).toBe('2026-11-16');
  });
});
