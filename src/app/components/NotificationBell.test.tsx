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
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { friendMocks } = vi.hoisted(() => ({
  friendMocks: { acceptRequest: vi.fn(), declineRequest: vi.fn() },
}));

vi.mock('./FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => friendMocks,
}));

import NotificationBell from './NotificationBell';
import { invitesAPI, ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';

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

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(logger.error as unknown as Mock).toHaveBeenCalled());
    // A transient failure must NOT eat the row — the user can retry.
    expect(setInvitesMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });
});

describe('the { text, tone } confirmation shape', () => {
  it('a successful Accept renders the success-toned confirmation with the group name', async () => {
    acceptInvite().mockResolvedValue({ success: true });
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    expect(loggerError().mock.calls[0][0]).toBe('Failed to decline invite:');
    expect(loggerError().mock.calls[0][1]).toBe(boom);
  });

  it('THE HOISTED-CONVERSION CATCHER: a `status: 410` rejection through EITHER invite handler files ZERO escalations — the designed soft-delete outcome is not a failure', async () => {
    acceptInvite().mockRejectedValue(deadGroupError());
    renderBell();
    await openBell();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(loggerError()).toHaveBeenCalledTimes(1));
    expect(loggerError().mock.calls[0][0]).toBe('Failed to accept friend request:');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
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

    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    // Closed: the panel is not mounted, so the idref is dangling until it opens.
    expect(document.getElementById(controls!)).toBeNull();

    fireEvent.click(trigger);
    expect(await screen.findByText('Group Invites')).toBeInTheDocument();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(controls!);
    expect(panel).not.toBeNull();
    // The panel is the node that actually contains the disclosed content.
    expect(panel).toContainElement(screen.getByText('Group Invites'));
  });

  it('the ROW trigger — the one mounted inside the phone hamburger — exposes the same two attributes', async () => {
    render(<NotificationBell user={{ sub: 'auth0|me' }} variant="row" label="Invites" />);
    const trigger = screen.getByRole('button', { name: 'Invites notifications' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();

    fireEvent.click(trigger);
    expect(await screen.findByText('Group Invites')).toBeInTheDocument();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(controls!)).toContainElement(screen.getByText('Group Invites'));
  });

  it('PRESERVATION — the exception is ATTRIBUTE-ONLY: no role was added to the panel, and both triggers keep their shipped accessible names and hover/focus pins', () => {
    renderBell();
    const trigger = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(trigger);

    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    // No `role` was added — the remaining disclosure semantics are ROUTED, not fixed.
    expect(panel).not.toHaveAttribute('role');
    // The Phase 88.3 focus-ring treatment on this trigger is byte-unchanged.
    expect(trigger.className).toContain('focus-visible:ring-inset');
    expect(trigger.className).toContain('hover:text-amber-400');
  });
});
