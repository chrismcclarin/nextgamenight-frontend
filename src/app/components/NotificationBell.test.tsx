// Phase 88.2 fix-commit re-review R-8 — the net over the bell's L-8 fix.
//
// L-8 shipped two things with zero coverage: the 410 dead-group handling on
// invite Accept/Decline (a group soft-deleted under a pending invite now
// returns 410 from the liveness gate), and the confirmation refactor from a
// bare string to `{ text, tone }` so the "no longer available" notice does not
// render in success-green. Both regress silently without this file: a revert
// to the string shape renders an EMPTY banner (`confirmation.text` is
// undefined) while every other suite stays green.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's jsx-in-js transform hook handles the `.js` component under test.
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    invitesAPI: {
      acceptInvite: vi.fn(),
      declineInvite: vi.fn(),
    },
  };
});

const { unreadState, setInvitesMock } = vi.hoisted(() => ({
  unreadState: {
    invites: [] as Array<Record<string, unknown>>,
    friendRequests: [] as Array<Record<string, unknown>>,
    totalCount: 0,
    loading: false,
  },
  setInvitesMock: vi.fn(),
}));

vi.mock('./UnreadNotificationProvider', () => ({
  useUnreadNotificationCount: () => ({
    invites: unreadState.invites,
    friendRequests: unreadState.friendRequests,
    totalCount: unreadState.totalCount,
    loading: unreadState.loading,
    setInvites: setInvitesMock,
  }),
}));

// Phase 88.6-31 (AC-2 WIDENED + AC-16 (a)): the four accept/decline catches route through the
// house logger now, not `console.error`. This is the idiom the sibling suites already use
// (`AvailabilityForm.test.tsx`, `ScheduleForm.test.tsx`, `GroupSettings.test.tsx`,
// `NextGameNightCard.test.tsx` all mock `@/lib/logger` exactly this way) — reused rather than
// re-invented, and NO second test file is added.
// errCtx stays REAL (88.6.1 code review A-14 / A-38: the providers' load catches now call it).
vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { friendMocks } = vi.hoisted(() => ({
  friendMocks: {
    acceptRequest: vi.fn(),
    declineRequest: vi.fn(),
    // Plan 88.6.1-66's read-only context fact (one request per row across surfaces); the bell
    // reads it in every friend-request row's render (plan 88.6.1-44, NA-19).
    isRequestActionPending: vi.fn((_id: string) => false),
  },
}));

vi.mock('./FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => friendMocks,
}));

import NotificationBell from './NotificationBell';
import { invitesAPI, ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

type Mock = ReturnType<typeof vi.fn>;

const acceptInvite = () => invitesAPI.acceptInvite as unknown as Mock;
const friendAccept = () => friendMocks.acceptRequest as unknown as Mock;
const friendDecline = () => friendMocks.declineRequest as unknown as Mock;
const declineInvite = () => invitesAPI.declineInvite as unknown as Mock;

const GROUP_NAME = 'Tuesday Night Crew';
const INVITE = { id: 'inv-1', Group: { name: GROUP_NAME }, Inviter: { username: 'Bee' } };

/** The 88.2 liveness-gate rejection: the group was soft-deleted under the invite. */
function deadGroupError() {
  return new ApiError('This group is no longer available.', 'gone', 410, {
    error: 'This group is no longer available.',
  });
}

/**
 * The component is untyped JS, so tsc infers `label` (defaulted only at the
 * use site) as required — pass it explicitly. Icon variant ignores it.
 */
function renderBell() {
  return render(<NotificationBell user={{ sub: 'auth0|me' }} label={undefined} />);
}

async function openBell() {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(await screen.findByText('Group Invites')).toBeInTheDocument();
}

/** Apply the functional updater handed to setInvites and return the result. */
function applyLastUpdater(prev: Array<Record<string, unknown>>) {
  const updater = setInvitesMock.mock.calls.at(-1)?.[0] as
    | ((p: Array<Record<string, unknown>>) => Array<Record<string, unknown>>)
    | undefined;
  expect(typeof updater).toBe('function');
  return updater!(prev);
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so NA-19's override would otherwise leak.
  friendMocks.isRequestActionPending.mockImplementation(() => false);
  sessionStorage.clear();
  unreadState.invites = [INVITE];
  unreadState.friendRequests = [];
  unreadState.totalCount = 1;
  unreadState.loading = false;
});

afterEach(() => {
  cleanup();
});

describe('L-8 — a dead-group 410 on the pending invite', () => {
  it('Accept: drops the invite and shows the muted "no longer available" notice', async () => {
    acceptInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

    const notice = await screen.findByText(`${GROUP_NAME} is no longer available.`);
    /* The tone half of the refactor: a dead group is NOT a success, so it must never render
       success-green. RE-POINTED by plan 88.6-31 task 3 under the owner's D-16 ARM A ruling
       (2026-09-16): the muted arm's ink moved `text-content-muted` (4.3725, sub-AA on this
       ground) -> `text-content-secondary` (6.9620). The ASSERTION'S POINT IS UNCHANGED — it
       still pins "not success-green" — and the old token is now asserted ABSENT as well, so a
       revert to the sub-AA ink reds here rather than sliding back in. */
    expect(notice.className).toContain('text-content-secondary');
    expect(notice.className).not.toContain('text-content-muted');
    // Both token names are asserted, not just the current one: after the Phase 88.3 Req 6
    // sweep the destination is `text-content-status-success`, and pinning ONLY that would
    // leave a revert to the legacy class passing this test.
    expect(notice.className).not.toContain('text-content-status-success');
    expect(notice.className).not.toContain('text-status-success');

    // The dead row is dropped optimistically instead of leaving a button that
    // visibly does nothing until the next refetch INNER-JOINs it out.
    expect(applyLastUpdater([INVITE])).toEqual([]);

    // A failed join must not fire the joined-a-group refresh signal.
    expect(sessionStorage.getItem('nggroups:refresh')).toBeNull();
  });

  it('Decline: drops the invite silently — removal is what the user asked for', async () => {
    declineInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Decline invite to ${GROUP_NAME}` }));

    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());
    expect(applyLastUpdater([INVITE])).toEqual([]);
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });

  it('a non-410 failure removes nothing and shows no notice', async () => {
    // RE-POINTED by plan 88.6-31 task 3: this spied on `console.error`, which no longer exists
    // in this file. The escalation is the house logger now — and that call IS the AC-16 (a)
    // mitigation, so asserting it is stronger than asserting stdout ever was.
    acceptInvite().mockRejectedValue(new ApiError('boom', 'internal', 500, { error: 'boom' }));
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

    await waitFor(() => expect(logger.error as unknown as Mock).toHaveBeenCalled());
    // A transient failure must NOT eat the row — the user can retry.
    expect(setInvitesMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    // AMENDED Phase 88.6.1-44: this failure now shows the register's internal line in the panel's
    // assertive region (D-33 row 22; NA-14 pins the coded case). This case still pins that the row
    // stays and that no 'no longer available' notice appears.
  });
});

// 88.6.1 code review A-28: the backend answers 404 'Pending invite not found' once an invite is no
// longer pending (answered by email, on another device or tab). The friend rows beside these treat
// the same answer as handled elsewhere; the group-invite rows now do too.
describe('a stale-invite 404 (already answered elsewhere)', () => {
  function staleInviteError() {
    return new ApiError('Pending invite not found', 'not_found', 404, { error: 'Pending invite not found' });
  }

  it('Accept: drops the row, shows no failure line, files no error event, and signals the groups refresh', async () => {
    acceptInvite().mockRejectedValue(staleInviteError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());
    expect(applyLastUpdater([INVITE])).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('');
    expect(logger.error as unknown as Mock).not.toHaveBeenCalled();
    // Accepted elsewhere is the common case: the home list picks up the membership.
    expect(sessionStorage.getItem('nggroups:refresh')).toBe('1');
  });

  it('Decline: drops the row silently, with no failure line and no error event', async () => {
    declineInvite().mockRejectedValue(staleInviteError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Decline invite to ${GROUP_NAME}` }));

    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());
    expect(applyLastUpdater([INVITE])).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('');
    expect(logger.error as unknown as Mock).not.toHaveBeenCalled();
  });
});

describe('the { text, tone } confirmation shape', () => {
  it('a successful Accept renders the success-toned confirmation with the group name', async () => {
    acceptInvite().mockResolvedValue({ success: true });
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

    // A revert to the bare-string confirmation renders an empty banner here —
    // `confirmation.text` is undefined — so this line is the shape pin.
    const confirmation = await screen.findByText(`Joined ${GROUP_NAME}!`);
    expect(confirmation.className).toContain('text-content-status-success');
    expect(applyLastUpdater([INVITE])).toEqual([]);
    expect(sessionStorage.getItem('nggroups:refresh')).toBe('1');
  });
});

/* ---------------------------------------------------------------------------
   PHASE 88.6-31 task 3 — the telemetry half of the four silent failures, and the
   SINGLE named two-attribute ARIA exception.

   Everything else this task observed about the bell — the `mousedown`-only outside-click,
   the missing Escape handler, the panel's missing role, and the four failures'
   still-missing USER-FACING copy — is RECORDED AND ROUTED, never fixed here, so there is
   deliberately no assertion about any of them below.
   --------------------------------------------------------------------------- */
// AMENDED Phase 88.6.1-28 (D-18): the outside click, the Escape path and the panel's role and
// name are now fixed and pinned in the NB describe at the end of this file; the four failures'
// user-facing copy is plan 88.6.1-44's (N3-N6).
// DONE Phase 88.6.1-44 (W026, MEDLOW-28): the four failures' user-facing lines (N3-N6) and the success announcement are pinned by NA-12..NA-17; the two decline success lines (N9 / N10, owner ruling #205) by NA-20.

const loggerError = () => logger.error as unknown as Mock;

describe('Phase 88.6-31 — AC-16 (a) telemetry: the four accept/decline failures reach Sentry', () => {
  const FRIEND_REQ = { id: 'fr-1', Requester: { username: 'Cee' } };

  /* BEHAVIOURAL, not a grep: each handler is driven to a real rejection and the escalation is
     observed at the `@/lib/logger` seam the sibling suites already mock. The house logger routes
     `error` to `Sentry.captureException`, so ONE call here is ONE Sentry event — which is exactly
     what AC-16 (a) asked for and what a `console.error` never delivered. */
  it('a non-410 Accept-invite failure escalates ONCE, carrying that handler`s own message and the ERROR OBJECT (never the bare message string)', async () => {
    const boom = new ApiError('boom', 'internal', 500, { error: 'boom' });
    acceptInvite().mockRejectedValue(boom);
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    const [msg, err] = loggerError().mock.calls[0] as [string, unknown];
    expect(msg).toBe('Failed to accept invite:');
    // THE ERROR OBJECT, not `err.message` — `logger.error` synthesizes an Error only when the
    // second argument is OMITTED, so passing the object is what T-84-01 describes and is
    // strictly more useful in Sentry than a stringified message.
    expect(err).toBe(boom);
    expect(err).not.toBe('boom');
  });

  it('a non-410 Decline-invite failure escalates ONCE with its own verbatim message', async () => {
    const boom = new ApiError('boom', 'internal', 500, { error: 'boom' });
    declineInvite().mockRejectedValue(boom);
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Decline invite to ${GROUP_NAME}` }));

    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    expect(loggerError().mock.calls[0][0]).toBe('Failed to decline invite:');
    expect(loggerError().mock.calls[0][1]).toBe(boom);
  });

  it('THE HOISTED-CONVERSION CATCHER: a `status: 410` rejection through EITHER invite handler files ZERO escalations — the designed soft-delete outcome is not a failure', async () => {
    acceptInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

    /* POSITIVE SETTLE SIGNAL FIRST. An absence claim asserted on the first tick observes nothing
       and would pass against a hoisted conversion. Wait for the DESIGNED outcome to land — the
       muted notice — and only THEN assert that nothing was escalated. */
    await screen.findByText(`${GROUP_NAME} is no longer available.`);
    expect(loggerError()).not.toHaveBeenCalled();

    // The decline arm's 410 is the same designed outcome and says nothing at all, so it needs a
    // different settle signal: the optimistic row drop.
    cleanup();
    vi.clearAllMocks();
    declineInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();
    fireEvent.click(screen.getByRole('button', { name: `Decline invite to ${GROUP_NAME}` }));
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());
    expect(loggerError()).not.toHaveBeenCalled();
  });

  it('both FRIEND-request handlers escalate too — bare catches, no 410 branch, converted in place', async () => {
    unreadState.invites = [];
    unreadState.friendRequests = [FRIEND_REQ];
    unreadState.totalCount = 1;
    friendAccept().mockRejectedValue(new Error('nope'));
    friendDecline().mockRejectedValue(new Error('nope'));

    render(<NotificationBell user={{ sub: 'auth0|me' }} label={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Friend Requests')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept friend request from Cee' }));
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    expect(loggerError().mock.calls[0][0]).toBe('Failed to accept friend request:');

    fireEvent.click(screen.getByRole('button', { name: 'Decline friend request from Cee' }));
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(2));
    expect(loggerError().mock.calls[1][0]).toBe('Failed to decline friend request:');
  });
});

describe('Phase 88.6-31 — the SINGLE two-attribute ARIA exception (ACCEPT §9 / #164, owner 2026-09-14)', () => {
  /* BY ROLE AND STATE, which is the form that actually proves the attribute is doing its job:
     the trigger is found by role and accessible name, `aria-expanded` is FALSE before activation
     and TRUE after, and `aria-controls` RESOLVES to the panel node. A presence-shaped assertion
     would pass against an `aria-controls` pointing at nothing. */
  it('the ICON trigger exposes its disclosure state, and `aria-controls` resolves to the dropdown panel', async () => {
    renderBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Closed: the panel is NOT mounted, so the trigger exposes NO `aria-controls` at all — a
    // permanently-present idref would name an element that is not in the document (a dangling
    // reference, not a relationship). Flipped by plan 88.6-59 (review MEDLOW-30): until then
    // this line asserted the dangle on purpose. Same rule as KebabMenu DECISION 88.6-16, pinned
    // there by KM-2 (`keyboardOperability.test.tsx`) — the phase ships ONE disclosure-trigger rule.
    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);
    expect(await screen.findByText('Group Invites')).toBeInTheDocument();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Read the idref only AFTER it opens — it exists exactly while the panel does.
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel).not.toBeNull();
    // The panel is the node that actually contains the disclosed content.
    expect(panel).toContainElement(screen.getByText('Group Invites'));
  });

  it('the ROW trigger — the one mounted inside the phone hamburger — exposes the same two attributes', async () => {
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const trigger = screen.getByRole('button', { name: 'Invites notifications' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Closed: no `aria-controls` (plan 88.6-59, review MEDLOW-30 — see the icon case above).
    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);
    expect(await screen.findByText('Group Invites')).toBeInTheDocument();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toContainElement(screen.getByText('Group Invites'));
  });

  it('PRESERVATION — the exception is ATTRIBUTE-ONLY: no explicit role attribute on the panel (its role is the section element\'s implicit region, 88.6.1-28 D-18), and both triggers keep their shipped accessible names and hover/focus pins', () => {
    renderBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(trigger);

    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    // AMENDED Phase 88.6.1-28 (D-18): the panel's role now comes from its section element (an
    // implicit region, named by its heading — NB-7). An explicit role attribute stays absent, and
    // the menu role is forbidden (DECISION Phase 88.6-16).
    expect(panel).not.toHaveAttribute('role');
    // The Phase 88.3 focus-ring treatment on this trigger is byte-unchanged.
    expect(trigger.className).toContain('focus-visible:ring-inset');
    expect(trigger.className).toContain('hover:text-amber-400');
  });
});

// Phase 88.6.1-28 (D-18, AC-17, register R128): the bell's panel now dismisses through the
// shared useDismissal hook (src/components/ui/useDismissal.ts, plan 88.6.1-05). Every test
// below finds controls by role and name, probes "open" by the trigger's aria-expanded plus the
// panel's own content, and asserts each absence directly after the synchronous fireEvent (no
// waitFor around an absence, FE-TESTING-CONVENTIONS CF-26).
describe('Phase 88.6.1-28 — the panel dismisses through the shared hook (D-18, AC-17)', () => {
  // The Accept button is matched by an anchored pattern, never the bare name: plan 88.6.1-44
  // renames it to copy row N8 (Accept invite to {group}), and the seed holds one invite and no
  // friend request, so the match stays unique.
  const acceptButton = () => screen.getByRole('button', { name: /^Accept/ });

  function renderWithOutside(variant?: 'row') {
    return render(
      <>
        {variant === 'row' ? (
          <NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />
        ) : (
          <NotificationBell user={{ sub: 'auth0|me' }} label={undefined} />
        )}
        <button type="button">Outside</button>
      </>,
    );
  }

  it('NB-1. icon variant: Escape inside the open panel closes it, is default-prevented, and returns focus to the trigger', async () => {
    renderBell();
    await openBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const accept = acceptButton();
    accept.focus();
    expect(document.activeElement).toBe(accept);

    // fireEvent returns false when a listener called preventDefault.
    const notPrevented = fireEvent.keyDown(accept, { key: 'Escape' });
    expect(notPrevented).toBe(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Group Invites')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('NB-2. SPEC Edge R6 idempotency: Escape closes once, and a second Escape on the closed bell is inert and not claimed', async () => {
    renderBell();
    await openBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });

    acceptButton().focus();
    expect(fireEvent.keyDown(acceptButton(), { key: 'Escape' })).toBe(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);

    // Second Escape, panel closed: nobody claims the key, nothing reopens.
    const secondNotPrevented = fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(secondNotPrevented).toBe(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Group Invites')).toBeNull();
  });

  it('NB-3. row variant (the phone hamburger mount): Escape on the Invites row closes the panel, is default-prevented, and leaves focus on that row', async () => {
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const trigger = screen.getByRole('button', { name: 'Invites notifications' });
    fireEvent.click(trigger);
    expect(await screen.findByText('Group Invites')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // fireEvent.click does not move focus, so the focus assertion below is earned by the restore.
    expect(document.activeElement).not.toBe(trigger);

    const notPrevented = fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(notPrevented).toBe(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Group Invites')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('NB-4. focus leaving the bell closes the panel; focus moving inside it, or a null relatedTarget, does not', async () => {
    renderWithOutside();
    await openBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    const outside = screen.getByRole('button', { name: 'Outside' });

    // Inside: focus moves from the Accept button back to the trigger.
    fireEvent.focusOut(acceptButton(), { relatedTarget: trigger });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Group Invites')).toBeInTheDocument();

    // Null relatedTarget is ambiguous (a press on non-focusable inside chrome), never a dismissal.
    fireEvent.focusOut(acceptButton(), { relatedTarget: null });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Group Invites')).toBeInTheDocument();

    // Outside: focus lands on a control that is not part of the bell.
    fireEvent.focusOut(acceptButton(), { relatedTarget: outside });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Group Invites')).toBeNull();
  });

  it('NB-5. the outside mousedown listener exists only while open: none while closed, one while open, an inside press keeps it open, an outside press closes it and removes the same function', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    try {
      renderWithOutside();
      const mousedownAdds = () => addSpy.mock.calls.filter(([type]) => type === 'mousedown');
      const mousedownRemoves = () => removeSpy.mock.calls.filter(([type]) => type === 'mousedown');

      // Closed: the bell leaves nothing on the document.
      expect(mousedownAdds()).toHaveLength(0);

      await openBell();
      const trigger = screen.getByRole('button', { name: 'Notifications' });
      expect(mousedownAdds()).toHaveLength(1);

      // A press inside the panel (its heading text) is not a dismissal.
      fireEvent.mouseDown(screen.getByText('Notifications'));
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Group Invites')).toBeInTheDocument();

      // A press outside the bell closes the panel.
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Group Invites')).toBeNull();

      // Closing removed the very function that opening added, and added no second one.
      expect(mousedownAdds()).toHaveLength(1);
      expect(mousedownRemoves()).toHaveLength(1);
      expect(mousedownRemoves()[0][1]).toBe(mousedownAdds()[0][1]);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  // NB-6 models production's listener order. The App Router hydrates the DOCUMENT itself
  // (node_modules/next/dist/client/app-index.js:42, const appElement = document;), so in production
  // React's root listener and Header's document Escape listener (src/app/Header.js:31-42) share one
  // node, React's registered first. A synthetic stopPropagation cannot stop a later listener on
  // the same node, so Header still runs and only sees the claim through defaultPrevented. Under
  // RTL the React root is the render container, not the document, so a document listener would
  // never be reached here: a jsdom-only reassurance that does not hold in production. The spy is
  // therefore registered on the RTL container AFTER render, which reproduces production's order.
  it('NB-6. production Escape order (D-08a, P-10): a later listener on the React root node runs once and sees the Escape the bell claimed as default-prevented; a closed-bell Escape arrives un-prevented; the bell adds no document keydown listener', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const seen: boolean[] = [];
    const rootSpy = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') seen.push(event.defaultPrevented);
    };
    let container: HTMLElement | null = null;
    try {
      container = renderBell().container;
      container.addEventListener('keydown', rootSpy);
      await openBell();
      const trigger = screen.getByRole('button', { name: 'Notifications' });

      acceptButton().focus();
      fireEvent.keyDown(acceptButton(), { key: 'Escape' });
      expect(seen).toEqual([true]);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      // Anti-vacuity: with the panel closed the same position sees an un-prevented Escape.
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(seen).toEqual([true, false]);

      expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    } finally {
      container?.removeEventListener('keydown', rootSpy);
      addSpy.mockRestore();
    }
  });

  it('NB-7. the open panel is a region named by its own Notifications heading in both variants: a section with no explicit role and no aria-label, the trigger controls it, and no menu semantics exist', async () => {
    renderBell();
    await openBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });

    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region.tagName).toBe('SECTION');
    // The role is the section element's implicit one; nothing spells it, and no second copy of
    // the words names it (D-33 row 21).
    expect(region).not.toHaveAttribute('role');
    expect(region).not.toHaveAttribute('aria-label');
    // The name resolves through aria-labelledby to the visible level-3 heading itself.
    const labelledBy = region.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading).toBe(screen.getByRole('heading', { level: 3, name: 'Notifications' }));
    expect(heading).toHaveTextContent(/^Notifications$/);
    // The trigger's conditional aria-controls (DECISION Phase 88.6-59) names this region.
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    // The menu role is forbidden (DECISION Phase 88.6-16).
    expect(screen.queryAllByRole('menu')).toHaveLength(0);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(trigger).not.toHaveAttribute('aria-haspopup');

    // The row variant, the one the phone hamburger mounts, finds the same region.
    cleanup();
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const rowTrigger = screen.getByRole('button', { name: 'Invites notifications' });
    fireEvent.click(rowTrigger);
    expect(await screen.findByText('Group Invites')).toBeInTheDocument();
    const rowRegion = screen.getByRole('region', { name: 'Notifications' });
    expect(rowRegion.tagName).toBe('SECTION');
    expect(rowTrigger.getAttribute('aria-controls')).toBe(rowRegion.id);
    expect(rowTrigger).not.toHaveAttribute('aria-haspopup');
  });

  it('NB-8. copy row N1 (D-30): while the first load runs, the open panel carries the screen-reader text Loading notifications and the spinner is hidden from assistive tech', () => {
    unreadState.loading = true;
    renderBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // The panel is found through the trigger's idref, so this test reds on the missing words
    // alone, not on the region role NB-7 owns.
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel).not.toBeNull();
    expect(panel).toHaveTextContent('Loading notifications');
    const words = screen.getByText('Loading notifications');
    expect(panel).toContainElement(words);
    expect(words).toHaveClass('sr-only');
    const spinner = panel.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});

// Phase 88.6.1-44 (W016, N8, H9, W026, MEDLOW-28): the bell's four row controls. Every control is
// found by its copy row N8 name (Accept invite to {group}, and its three siblings). In-flight pins
// follow FE-TESTING-CONVENTIONS C-11: the RED half is the attributes and the request count, and a
// focus claim on the pressed control is CONFIRM-ONLY in jsdom (jsdom never blurs a disabled
// element); the real-browser proof is e2e/notification-bell-actions.spec.ts. Focus-after-removal
// pins wait for a POSITIVE signal (the target has focus) and only then assert absences (CF-26).
describe("Phase 88.6.1-44 — the bell's row actions: pressed controls, names, focus after a row leaves, outcomes (W016, N8, H9, W026, MEDLOW-28)", () => {
  const INVITE_A = { id: 'inv-a', Group: { name: 'Alpha Crew' }, Inviter: { username: 'Ann' } };
  const INVITE_B = { id: 'inv-b', Group: { name: 'Beta Crew' }, Inviter: { username: 'Bo' } };

  function deferred<T = unknown>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // The row an invite or a friend request renders in, found by the name it shows.
  function rowFor(name: string) {
    const row = screen.getByText(name).closest('li');
    expect(row).not.toBeNull();
    return row as HTMLElement;
  }

  const bellElement = () => <NotificationBell user={{ sub: 'auth0|me' }} label={undefined} />;

  function seedInvites(invites: Array<Record<string, unknown>>) {
    unreadState.invites = invites;
    unreadState.friendRequests = [];
    unreadState.totalCount = invites.length;
  }

  it('NA-1. invite Accept (AC-12, SPEC Edge R4 idempotency + concurrency, N2 + N8): named for its group at rest; in flight it reads Accepting..., is aria-disabled not disabled, its sibling is natively disabled, other rows are untouched, two more presses send nothing; the gate clears when the request settles', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    const d = deferred();
    acceptInvite().mockReturnValue(d.promise);
    renderBell();
    await openBell();

    const rowA = rowFor('Alpha Crew');
    const rowB = rowFor('Beta Crew');
    const acceptA = within(rowA).getByRole('button', { name: 'Accept invite to Alpha Crew' });
    expect(acceptA).toHaveAccessibleName('Accept invite to Alpha Crew');
    expect(acceptA).toHaveTextContent(/^Accept$/);

    await user.click(acceptA);

    // The SAME node, now in flight.
    expect(acceptA).toHaveAccessibleName('Accepting...');
    expect(acceptA).toHaveTextContent(/^Accepting\.\.\.$/);
    expect(acceptA).not.toHaveAttribute('aria-label');
    expect(acceptA).toHaveAttribute('aria-disabled', 'true');
    expect(acceptA).not.toHaveAttribute('disabled');
    // CONFIRM-ONLY in jsdom (C-11): jsdom never blurs a disabled element.
    expect(document.activeElement).toBe(acceptA);

    const declineA = within(rowA).getByRole('button', { name: /^Decline/ });
    expect(declineA).toBeDisabled();
    expect(declineA).not.toHaveAttribute('aria-disabled');
    for (const button of within(rowB).getAllByRole('button')) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    fireEvent.click(acceptA);
    fireEvent.click(acceptA);
    expect(acceptInvite()).toHaveBeenCalledTimes(1);
    expect(acceptA).toHaveAccessibleName('Accepting...');

    await act(async () => {
      d.resolve({ success: true });
    });
    expect(acceptA).not.toHaveAttribute('aria-disabled');
    expect(acceptA).toHaveAccessibleName('Accept invite to Alpha Crew');
  });

  it('NA-2. AC-14 adjacency + the R5 ordering backstop: focus stays on the pressed Accept until the row leaves, then lands on the next row\'s Accept inside the open panel; also from the Safari / iOS tap shape (focus on body for the whole flight)', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    const d = deferred();
    acceptInvite().mockReturnValue(d.promise);
    const { rerender } = renderBell();
    await openBell();

    const acceptA = within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' });
    await user.click(acceptA);
    await act(async () => {
      d.resolve({ success: true });
    });

    // ORDERING HALF: the request settled but the removal has not committed, so focus is still
    // on the pressed control. Focusing the next row inside the handler would fail here.
    expect(document.activeElement).toBe(acceptA);

    // Commit the removal the way the provider would.
    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 1;
    rerender(bellElement());

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept invite to Beta Crew' })),
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(
      document.activeElement as HTMLElement,
    );

    // Arm (b): the Safari / iOS tap shape. fireEvent.click does not focus the button, so focus
    // sits on body for the whole flight; the pressed control is handed over as the watched node.
    cleanup();
    seedInvites([INVITE_A, INVITE_B]);
    const d2 = deferred();
    acceptInvite().mockReturnValue(d2.promise);
    const second = renderBell();
    await openBell();
    const acceptA2 = within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' });
    fireEvent.click(acceptA2);
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      d2.resolve({ success: true });
    });
    expect(document.activeElement).toBe(document.body);

    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 1;
    second.rerender(bellElement());

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept invite to Beta Crew' })),
    );
  });

  it('NA-3. AC-14 empty: when the removed row was the last one, focus lands on the panel\'s own Notifications heading inside the still-open panel, and no heading is minted', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A]);
    acceptInvite().mockResolvedValue({ success: true });
    const { rerender } = renderBell();
    await openBell();

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());

    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 0;
    rerender(bellElement());
    expect(await screen.findByText('No pending notifications')).toBeInTheDocument();

    const region = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(region).getByRole('heading', { name: 'Notifications' })),
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toBe(region);
    expect(within(region).getAllByRole('heading')).toHaveLength(1);
  });

  it('NA-4. two rows in flight: one row\'s settle never clears another row\'s record; two presses in ONE batch both keep their gate', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    const dA = deferred();
    const dB = deferred();
    acceptInvite().mockImplementation((id: string) => (id === INVITE_A.id ? dA.promise : dB.promise));
    renderBell();
    await openBell();

    const acceptA = within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' });
    const acceptB = within(rowFor('Beta Crew')).getByRole('button', { name: 'Accept invite to Beta Crew' });
    await user.click(acceptA);
    await user.click(acceptB);
    for (const pressed of [acceptA, acceptB]) {
      expect(pressed).toHaveAccessibleName('Accepting...');
      expect(pressed).toHaveAttribute('aria-disabled', 'true');
    }

    await act(async () => {
      dA.resolve({ success: true });
    });
    expect(acceptA).toHaveAccessibleName('Accept invite to Alpha Crew');
    expect(acceptA).not.toHaveAttribute('aria-disabled');
    expect(acceptB).toHaveAccessibleName('Accepting...');
    expect(acceptB).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      dB.resolve({ success: true });
    });
    expect(acceptB).toHaveAccessibleName('Accept invite to Beta Crew');
    expect(acceptB).not.toHaveAttribute('aria-disabled');

    // Arm (b): both presses inside ONE act, so the second handler is the same render's closure.
    cleanup();
    seedInvites([INVITE_A, INVITE_B]);
    acceptInvite().mockImplementation(() => new Promise(() => {}));
    renderBell();
    await openBell();
    const batchA = within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' });
    const batchB = within(rowFor('Beta Crew')).getByRole('button', { name: 'Accept invite to Beta Crew' });
    act(() => {
      fireEvent.click(batchA);
      fireEvent.click(batchB);
    });
    for (const pressed of [batchA, batchB]) {
      expect(pressed).toHaveAccessibleName('Accepting...');
      expect(pressed).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('NA-5. no lingering arm (the recorded deviation from plan 88.6.1-04 item 1): a failed Accept removes nothing, and a later outside press that closes the panel moves nobody to the page heading', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    acceptInvite().mockRejectedValue(new ApiError('teapot', 'unknown', 418, {}));
    render(
      <main>
        <h1>Home</h1>
        {bellElement()}
        <p>Outside</p>
      </main>,
    );
    await openBell();

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    // Positive settle signal: the failure reached the escalation.
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));

    fireEvent.mouseDown(screen.getByText('Outside'));
    await act(async () => {});

    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Home' });
    expect(document.activeElement).not.toBe(h1);
    expect(h1).not.toHaveAttribute('tabindex');
  });

  // Task 2 (W016 rows 7-9, N8, H9 on the other three controls). Friend requests in the mocked
  // provider, like plan 88.6.1-66's real one, stay listed while their request runs.
  const FR1 = { id: 'fr-a', Requester: { username: 'Cee' } };
  const FR2 = { id: 'fr-b', Requester: { username: 'Dee' } };

  function seed(invites: Array<Record<string, unknown>>, friendRequests: Array<Record<string, unknown>>) {
    unreadState.invites = invites;
    unreadState.friendRequests = friendRequests;
    unreadState.totalCount = invites.length + friendRequests.length;
  }

  async function openOn(sectionText: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(sectionText)).toBeInTheDocument();
  }

  it('NA-6. invite Decline (AC-12, D-33 row 15, N8): keeps its word and its name while in flight, is aria-disabled not disabled, its Accept sibling is natively disabled, two more presses send nothing', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    const d = deferred();
    declineInvite().mockReturnValue(d.promise);
    renderBell();
    await openBell();

    const rowA = rowFor('Alpha Crew');
    const declineA = within(rowA).getByRole('button', { name: 'Decline invite to Alpha Crew' });
    expect(declineA).toHaveAccessibleName('Decline invite to Alpha Crew');

    await user.click(declineA);

    expect(declineA).toHaveTextContent(/^Decline$/);
    expect(declineA).toHaveAccessibleName('Decline invite to Alpha Crew');
    expect(declineA).toHaveAttribute('aria-disabled', 'true');
    expect(declineA).not.toHaveAttribute('disabled');
    const acceptA = within(rowA).getByRole('button', { name: 'Accept invite to Alpha Crew' });
    expect(acceptA).toBeDisabled();
    expect(acceptA).not.toHaveAttribute('aria-disabled');

    fireEvent.click(declineA);
    fireEvent.click(declineA);
    expect(declineInvite()).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve({ success: true });
    });
    expect(declineA).not.toHaveAttribute('aria-disabled');
    expect(acceptA).toBeEnabled();
  });

  it('NA-7. friend Accept then friend Decline (AC-12, N2 + N8): each pressed control stays focusable and refuses a second request; Accept reads Accepting..., Decline keeps its word', async () => {
    const user = userEvent.setup();
    seed([], [FR1]);
    const dA = deferred();
    friendAccept().mockReturnValue(dA.promise);
    renderBell();
    await openOn('Friend Requests');

    const row = rowFor('Cee');
    const accept = within(row).getByRole('button', { name: 'Accept friend request from Cee' });
    const decline = within(row).getByRole('button', { name: 'Decline friend request from Cee' });

    await user.click(accept);
    expect(accept).toHaveAccessibleName('Accepting...');
    expect(accept).toHaveTextContent(/^Accepting\.\.\.$/);
    expect(accept).not.toHaveAttribute('aria-label');
    expect(accept).toHaveAttribute('aria-disabled', 'true');
    expect(accept).not.toHaveAttribute('disabled');
    expect(decline).toBeDisabled();
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(friendAccept()).toHaveBeenCalledTimes(1);
    await act(async () => {
      dA.resolve({ alreadyAccepted: false });
    });
    expect(accept).not.toHaveAttribute('aria-disabled');

    const dD = deferred();
    friendDecline().mockReturnValue(dD.promise);
    await user.click(decline);
    expect(decline).toHaveTextContent(/^Decline$/);
    expect(decline).toHaveAccessibleName('Decline friend request from Cee');
    expect(decline).toHaveAttribute('aria-disabled', 'true');
    expect(decline).not.toHaveAttribute('disabled');
    expect(accept).toBeDisabled();
    fireEvent.click(decline);
    fireEvent.click(decline);
    expect(friendDecline()).toHaveBeenCalledTimes(1);
    await act(async () => {
      dD.resolve({ alreadyDeclined: false });
    });
    expect(decline).not.toHaveAttribute('aria-disabled');
  });

  it('NA-8. AC-14 on plan 88.6.1-66\'s remove-on-confirm shape: (a) the friend row stays while its Accept works, focus stays until the provider removes it, then lands on the next request; (b) a failure keeps the row and arms nothing', async () => {
    const user = userEvent.setup();
    seed([], [FR1, FR2]);
    const d = deferred();
    friendAccept().mockReturnValue(d.promise);
    const { rerender } = renderBell();
    await openOn('Friend Requests');

    const acceptCee = within(rowFor('Cee')).getByRole('button', { name: 'Accept friend request from Cee' });
    await user.click(acceptCee);
    // Held: the row is still listed and the pressed control paints its in-flight words.
    expect(rowFor('Cee')).toBeInTheDocument();
    expect(acceptCee).toHaveAccessibleName('Accepting...');

    await act(async () => {
      d.resolve({ alreadyAccepted: false });
    });
    // ORDERING HALF: resolved, not yet removed by the provider.
    expect(document.activeElement).toBe(acceptCee);
    expect(screen.getByText('Accepted friend request!')).toBeInTheDocument();

    // The provider's removal, modelled.
    unreadState.friendRequests = [FR2];
    unreadState.totalCount = 1;
    rerender(bellElement());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept friend request from Dee' })),
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(
      document.activeElement as HTMLElement,
    );

    // (b) failure: the row stays, nothing is armed, and a later outside press moves nobody.
    cleanup();
    seed([], [FR1, FR2]);
    friendAccept().mockRejectedValue(new ApiError('HTTP error! status: 500', 'internal', 500, {}));
    render(
      <main>
        <h1>Home</h1>
        {bellElement()}
        <p>Outside</p>
      </main>,
    );
    await openOn('Friend Requests');
    const failedAccept = within(rowFor('Cee')).getByRole('button', { name: 'Accept friend request from Cee' });
    await user.click(failedAccept);
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    expect(rowFor('Cee')).toBeInTheDocument();
    expect(failedAccept).toHaveAccessibleName('Accept friend request from Cee');
    expect(failedAccept).not.toHaveAttribute('aria-disabled');
    // CONFIRM-ONLY in jsdom (C-11).
    expect(document.activeElement).toBe(failedAccept);

    fireEvent.mouseDown(screen.getByText('Outside'));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Home' });
    expect(document.activeElement).not.toBe(h1);
    expect(h1).not.toHaveAttribute('tabindex');
  });

  it('NA-9. panel order crosses lists: accepting the last invite lands focus on the first friend request\'s Accept', async () => {
    const user = userEvent.setup();
    seed([INVITE_A], [FR1]);
    acceptInvite().mockResolvedValue({ success: true });
    const { rerender } = renderBell();
    await openBell();

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());

    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 1;
    rerender(bellElement());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept friend request from Cee' })),
    );
  });

  it('NA-10. AC-14 for Decline: declining the first invite lands on the next row\'s Accept; a dead-group 410 on the last row lands on the panel heading', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    declineInvite().mockResolvedValueOnce({ success: true });
    const { rerender } = renderBell();
    await openBell();

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Decline invite to Alpha Crew' }));
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalledTimes(1));
    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 1;
    rerender(bellElement());
    const acceptBeta = await waitFor(() => {
      const target = screen.getByRole('button', { name: 'Accept invite to Beta Crew' });
      expect(document.activeElement).toBe(target);
      return target;
    });
    expect(acceptBeta).toBeInTheDocument();

    declineInvite().mockRejectedValueOnce(deadGroupError());
    await user.click(within(rowFor('Beta Crew')).getByRole('button', { name: 'Decline invite to Beta Crew' }));
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalledTimes(2));
    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 0;
    rerender(bellElement());
    const region = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(region).getByRole('heading', { name: 'Notifications' })),
    );
  });

  it('NA-18. the preferred target skips a natively disabled control: with the next row\'s Decline in flight (its Accept natively disabled), focus lands on that focusable Decline, not on the heading', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A, INVITE_B]);
    const heldDecline = deferred();
    declineInvite().mockReturnValue(heldDecline.promise);
    acceptInvite().mockResolvedValue({ success: true });
    const { rerender } = renderBell();
    await openBell();

    const declineBeta = within(rowFor('Beta Crew')).getByRole('button', { name: 'Decline invite to Beta Crew' });
    await user.click(declineBeta);
    expect(declineBeta).toHaveAttribute('aria-disabled', 'true');
    expect(within(rowFor('Beta Crew')).getByRole('button', { name: 'Accept invite to Beta Crew' })).toBeDisabled();

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalledTimes(1));
    unreadState.invites = applyLastUpdater(unreadState.invites);
    unreadState.totalCount = 1;
    rerender(bellElement());

    await waitFor(() => expect(document.activeElement).toBe(declineBeta));
    expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(declineBeta);
    await act(async () => {
      heldDecline.resolve({ success: true });
    });
  });

  it('NA-19. one request per row across surfaces (review r3, H-02): a friend request whose request runs from the Friends page is natively disabled on both buttons here and sends nothing; a press made on the bell keeps its rule of POSITION', async () => {
    seed([], [FR1, FR2]);
    friendMocks.isRequestActionPending.mockImplementation((id: string) => id === FR1.id);
    const { rerender } = renderBell();
    await openOn('Friend Requests');

    const acceptCee = screen.getByRole('button', { name: 'Accept friend request from Cee' });
    const declineCee = screen.getByRole('button', { name: 'Decline friend request from Cee' });
    for (const button of [acceptCee, declineCee]) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute('aria-disabled');
    }
    fireEvent.click(declineCee);
    fireEvent.click(acceptCee);
    expect(friendDecline()).toHaveBeenCalledTimes(0);
    expect(friendAccept()).toHaveBeenCalledTimes(0);
    expect(loggerError()).not.toHaveBeenCalled();
    for (const button of within(rowFor('Dee')).getAllByRole('button')) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    friendMocks.isRequestActionPending.mockImplementation(() => false);
    rerender(bellElement());
    expect(acceptCee).toBeEnabled();
    expect(declineCee).toBeEnabled();

    // Second half: the provider's fact turns true for Dee from the moment Dee's Accept is pressed
    // on the bell (the same press sets it); the pressed control keeps its rule of POSITION.
    const pending = new Set<string>();
    const held = deferred();
    friendMocks.isRequestActionPending.mockImplementation((id: string) => pending.has(id));
    friendAccept().mockImplementation((id: string) => {
      pending.add(id);
      return held.promise;
    });
    const acceptDee = screen.getByRole('button', { name: 'Accept friend request from Dee' });
    fireEvent.click(acceptDee);
    expect(acceptDee).toHaveAccessibleName('Accepting...');
    expect(acceptDee).toHaveAttribute('aria-disabled', 'true');
    expect(acceptDee).not.toHaveAttribute('disabled');
  });

  it('NA-11. N8 names (SPEC Edge R6 by analogy): (a) eight row buttons carry the eight distinct N8 names, each starting with its visible text; (b) a whitespace group name falls back to the bare word; (c) quotes, an emoji and 120+ letters are carried untruncated', async () => {
    seed([INVITE_A, INVITE_B], [FR1, FR2]);
    renderBell();
    await openBell();

    const region = screen.getByRole('region', { name: 'Notifications' });
    const buttons = within(region).getAllByRole('button');
    const names = buttons.map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Accept invite to Alpha Crew',
      'Decline invite to Alpha Crew',
      'Accept invite to Beta Crew',
      'Decline invite to Beta Crew',
      'Accept friend request from Cee',
      'Decline friend request from Cee',
      'Accept friend request from Dee',
      'Decline friend request from Dee',
    ]);
    expect(new Set(names).size).toBe(8);
    buttons.forEach((button, i) => {
      expect(button).toHaveAccessibleName(names[i]!);
      expect(names[i]!.startsWith(button.textContent ?? '\u0000')).toBe(true);
    });

    // (b) empty, held out.
    cleanup();
    seedInvites([{ id: 'inv-blank', Group: { name: '   ' }, Inviter: { username: 'Ann' } }]);
    renderBell();
    await openBell();
    const blankButtons = within(screen.getByRole('region', { name: 'Notifications' })).getAllByRole('button');
    expect(blankButtons).toHaveLength(2);
    expect(blankButtons[0]).toHaveAccessibleName('Accept');
    expect(blankButtons[1]).toHaveAccessibleName('Decline');

    // (c) encoding, held out.
    cleanup();
    const longName = `"Dice" \u{1F3B2} ${'a'.repeat(120)}`;
    seedInvites([{ id: 'inv-long', Group: { name: longName }, Inviter: { username: 'Ann' } }]);
    renderBell();
    await openBell();
    const longAccept = within(screen.getByRole('region', { name: 'Notifications' })).getAllByRole('button')[0];
    expect(longAccept).toHaveAttribute('aria-label', `Accept invite to ${longName}`);
    expect(longAccept).toHaveAccessibleName(`Accept invite to ${longName}`);
  });

  // Task 3 (W026, MEDLOW-28, Req 8): the outcome regions. The ratified bytes are hard-coded here on
  // purpose (AC-33): copy rows N3-N6 (88.6.1-COPY-TABLE.html, U+2019 normalised to a straight
  // apostrophe, D-32 R8) and the decline success lines N9 / N10 (owner ruling #205).
  const N3 = "We couldn't accept that invite. Please try again.";
  const N4 = "We couldn't decline that invite. Please try again.";
  const N5 = "We couldn't accept that friend request. Please try again.";
  const N6 = "We couldn't decline that friend request. Please try again.";
  const teapot = () => new ApiError('teapot', 'unknown', 418, {});

  const panelRegion = () => screen.getByRole('region', { name: 'Notifications' });
  const alertNode = () => within(panelRegion()).getByRole('alert');
  const statusNode = () => within(panelRegion()).getByRole('status');

  function closeWithEscape() {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Notifications' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
  }

  it('NA-12. AC-24 + N3 (W026): the failure line appears in the panel\'s always-mounted assertive region, the same node as before the failure; the escalation is still one logger call; the row stays', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A]);
    acceptInvite().mockRejectedValue(teapot());
    renderBell();
    await openBell();

    const alert = alertNode();
    expect(alert).toHaveTextContent(/^$/);
    expect(alert).toHaveClass('sr-only');

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    await waitFor(() => expect(alertNode()).toHaveTextContent(N3));
    expect(alertNode()).toBe(alert);
    expect(alert.textContent).toBe(N3);
    expect(alert).not.toHaveClass('sr-only');
    expect(loggerError()).toHaveBeenCalledTimes(1);
    expect(loggerError().mock.calls[0][0]).toBe('Failed to accept invite:');
    expect(statusNode()).toHaveTextContent(/^$/);
    expect(rowFor('Alpha Crew')).toBeInTheDocument();
  });

  it('NA-13. N4, N5, N6: invite Decline, friend Accept and friend Decline each show their own line on the panel\'s single alert node', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A]);
    declineInvite().mockRejectedValue(teapot());
    renderBell();
    await openBell();
    const inviteAlert = alertNode();
    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Decline invite to Alpha Crew' }));
    await waitFor(() => expect(inviteAlert.textContent).toBe(N4));
    expect(within(panelRegion()).getAllByRole('alert')).toHaveLength(1);

    cleanup();
    seed([], [FR1]);
    friendAccept().mockRejectedValue(new Error('nope'));
    renderBell();
    await openOn('Friend Requests');
    const acceptAlert = alertNode();
    await user.click(screen.getByRole('button', { name: 'Accept friend request from Cee' }));
    await waitFor(() => expect(acceptAlert.textContent).toBe(N5));
    expect(within(panelRegion()).getAllByRole('alert')).toHaveLength(1);

    cleanup();
    seed([], [FR1]);
    friendDecline().mockRejectedValue(new Error('nope'));
    renderBell();
    await openOn('Friend Requests');
    const declineAlert = alertNode();
    await user.click(screen.getByRole('button', { name: 'Decline friend request from Cee' }));
    await waitFor(() => expect(declineAlert.textContent).toBe(N6));
    expect(within(panelRegion()).getAllByRole('alert')).toHaveLength(1);
  });

  it('NA-14. D-33 row 22: a coded failure keeps its register line (a network failure shows the register\'s network sentence, never N3)', async () => {
    const user = userEvent.setup();
    seedInvites([INVITE_A]);
    const offline = new ApiError('offline', 'network', 0, null);
    acceptInvite().mockRejectedValue(offline);
    renderBell();
    await openBell();
    const alert = alertNode();

    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    await waitFor(() => expect(alert.textContent).toBe(getFetchErrorMessage(offline)));
    expect(alert.textContent).not.toBe(N3);
  });

  it('NA-15. AC-24 success (MEDLOW-28, SPEC Edge R8 adjacency): the confirmation appears in the always-mounted polite region, the same node, in the success ink; one alert and one status, siblings, never nested', async () => {
    const user = userEvent.setup();
    acceptInvite().mockResolvedValue({ success: true });
    renderBell();
    await openBell();

    const status = statusNode();
    const alert = alertNode();
    expect(status).toHaveTextContent(/^$/);
    expect(status).toHaveClass('sr-only');

    await user.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));
    await waitFor(() => expect(statusNode()).toHaveTextContent(`Joined ${GROUP_NAME}!`));
    expect(statusNode()).toBe(status);
    expect(status.textContent).toBe(`Joined ${GROUP_NAME}!`);
    expect(status).toHaveClass('text-content-status-success');
    expect(status).not.toHaveClass('sr-only');
    expect(alert).toHaveTextContent(/^$/);

    const region = panelRegion();
    expect(within(region).getAllByRole('alert')).toHaveLength(1);
    expect(within(region).getAllByRole('status')).toHaveLength(1);
    expect(alert.contains(status)).toBe(false);
    expect(status.contains(alert)).toBe(false);
  });

  it('NA-16. SPEC Edge R8 idempotency (backstop): the same outcome twice is announced twice — the same node empties while the repeat is in flight and carries the text again after', async () => {
    const user = userEvent.setup();
    // (a) failure twice.
    seedInvites([INVITE_A]);
    const second = deferred();
    acceptInvite().mockRejectedValueOnce(teapot()).mockReturnValueOnce(second.promise);
    renderBell();
    await openBell();
    const alert = alertNode();
    const acceptA = within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' });

    await user.click(acceptA);
    await waitFor(() => expect(alert.textContent).toBe(N3));
    await user.click(acceptA);
    expect(alertNode()).toBe(alert);
    expect(alert.textContent).toBe('');
    expect(alert).toHaveClass('sr-only');
    await act(async () => {
      second.reject(teapot());
    });
    await waitFor(() => expect(alert.textContent).toBe(N3));

    // (b) success twice.
    cleanup();
    seed([], [FR1, FR2]);
    const heldSecond = deferred();
    friendAccept().mockResolvedValueOnce({ alreadyAccepted: false }).mockReturnValueOnce(heldSecond.promise);
    renderBell();
    await openOn('Friend Requests');
    const status = statusNode();

    await user.click(screen.getByRole('button', { name: 'Accept friend request from Cee' }));
    await waitFor(() => expect(status.textContent).toBe('Accepted friend request!'));
    await user.click(screen.getByRole('button', { name: 'Accept friend request from Dee' }));
    expect(statusNode()).toBe(status);
    expect(status.textContent).toBe('');
    expect(status).toHaveClass('sr-only');
    await act(async () => {
      heldSecond.resolve({ alreadyAccepted: false });
    });
    await waitFor(() => expect(status.textContent).toBe('Accepted friend request!'));
  });

  // AMENDED 2026-10-19 (88.6.1 code review A-26 / A-30, orchestrator ruling; SPEC Edge R8 amended): arm (b) now pins
  // the opposite of what it did — a FAILURE that settles while the panel is closed is kept for the next open (written
  // after the reopened panel mounts its empty region, so it is announced), and a later close-and-reopen clears it.
  it('NA-17. SPEC Edge R8 empty: both regions start empty every time the panel opens — a failure is cleared by a close, a failure that settles while the panel is closed is shown on the next open, and a confirmation that settles while closed never shows', async () => {
    const user = userEvent.setup();
    // (a) a failure, then close and reopen.
    seedInvites([INVITE_A]);
    acceptInvite().mockRejectedValue(teapot());
    renderBell();
    await openBell();
    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    await waitFor(() => expect(alertNode().textContent).toBe(N3));
    closeWithEscape();
    await openBell();
    expect(alertNode().textContent).toBe('');
    expect(alertNode()).toHaveClass('sr-only');

    // (b) a failure that lands while the panel is CLOSED.
    cleanup();
    vi.clearAllMocks();
    seedInvites([INVITE_A]);
    const held = deferred();
    acceptInvite().mockReturnValue(held.promise);
    renderBell();
    await openBell();
    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    closeWithEscape();
    await act(async () => {
      held.reject(teapot());
    });
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    await openBell();
    await waitFor(() => expect(alertNode().textContent).toBe(N3));
    expect(alertNode()).not.toHaveClass('sr-only');
    // Shown once: the next close and reopen clears it, as for a failure seen while open.
    closeWithEscape();
    await openBell();
    expect(alertNode().textContent).toBe('');
    expect(alertNode()).toHaveClass('sr-only');

    // (c) a confirmation that lands while the panel is closed; reopened at once (well inside the
    // 3 s timer, so the timer cannot be what clears it).
    cleanup();
    seedInvites([INVITE_A]);
    const heldOk = deferred();
    acceptInvite().mockReturnValue(heldOk.promise);
    renderBell();
    await openBell();
    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Accept invite to Alpha Crew' }));
    closeWithEscape();
    await act(async () => {
      heldOk.resolve({ success: true });
    });
    await waitFor(() => expect(setInvitesMock).toHaveBeenCalled());
    await openBell();
    expect(statusNode().textContent).toBe('');
    expect(statusNode()).toHaveClass('sr-only');
  });

  it('NA-20. owner ruling #205 (N9, N10): a successful Decline is announced in the polite region — Declined invite to {group}. for an invite, Declined friend request. for a friend request', async () => {
    const user = userEvent.setup();
    // (a) invite Decline.
    seedInvites([INVITE_A]);
    declineInvite().mockResolvedValue({ success: true });
    renderBell();
    await openBell();
    const status = statusNode();
    const alert = alertNode();
    expect(status.textContent).toBe('');
    expect(status).toHaveClass('sr-only');
    await user.click(within(rowFor('Alpha Crew')).getByRole('button', { name: 'Decline invite to Alpha Crew' }));
    await waitFor(() => expect(status.textContent).toBe('Declined invite to Alpha Crew.'));
    expect(statusNode()).toBe(status);
    expect(status).toHaveClass('text-content-status-success');
    expect(status).not.toHaveClass('sr-only');
    expect(alert.textContent).toBe('');

    // (b) friend Decline.
    cleanup();
    seed([], [FR1]);
    friendDecline().mockResolvedValue({ alreadyDeclined: false });
    renderBell();
    await openOn('Friend Requests');
    const friendStatus = statusNode();
    const friendAlert = alertNode();
    expect(friendStatus.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Decline friend request from Cee' }));
    await waitFor(() => expect(friendStatus.textContent).toBe('Declined friend request.'));
    expect(statusNode()).toBe(friendStatus);
    expect(friendStatus).toHaveClass('text-content-status-success');
    expect(friendStatus).not.toHaveClass('sr-only');
    expect(friendAlert.textContent).toBe('');
  });
});

// 88.6.1 code review CR-2 / A-33 (owner ratified 2026-10-19): the unread count reaches assistive
// tech as each trigger's DESCRIPTION, the real count (never the badge's 9+), while both names stay
// byte-identical (the exact-name queries across the suites and e2e depend on them).
describe('CR-2 / A-33 — the pending count is the triggers\' description', () => {
  it('row trigger with two pending items is described "2 pending" and keeps its name', () => {
    unreadState.invites = [INVITE, { ...INVITE, id: 'inv-2' }];
    unreadState.totalCount = 2;
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const trigger = screen.getByRole('button', { name: 'Invites notifications' });
    expect(trigger).toHaveAccessibleName('Invites notifications');
    expect(trigger).toHaveAccessibleDescription('2 pending');
  });

  it('icon trigger with twelve pending is described by the real count, not 9+', () => {
    unreadState.totalCount = 12;
    renderBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    expect(trigger).toHaveAccessibleName('Notifications');
    expect(trigger).toHaveAccessibleDescription('12 pending');
    // The visible badge is hidden from assistive tech, so nothing reads 9+.
    const badge = within(trigger).getByText('9+');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('nothing pending: both variants are described "None pending"', () => {
    unreadState.invites = [];
    unreadState.totalCount = 0;
    const { unmount } = renderBell();
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAccessibleDescription(
      'None pending'
    );
    unmount();
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    expect(
      screen.getByRole('button', { name: 'Invites notifications' })
    ).toHaveAccessibleDescription('None pending');
  });

  it('the description span is out of the reading order (hidden) and still the description (scoped check 3, nit 1)', () => {
    unreadState.totalCount = 3;
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const trigger = screen.getByRole('button', { name: 'Invites notifications' });
    expect(trigger).toHaveAccessibleDescription('3 pending');
    const span = document.getElementById(trigger.getAttribute('aria-describedby') as string) as HTMLElement;
    // Without `hidden` a line-by-line reader meets "3 pending" a second time as loose text.
    expect(span).not.toBeVisible();
    expect(span.hidden).toBe(true);
  });

  it('the row badge is hidden from assistive tech', () => {
    unreadState.totalCount = 3;
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const trigger = screen.getByRole('button', { name: 'Invites notifications' });
    expect(within(trigger).getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });
});
