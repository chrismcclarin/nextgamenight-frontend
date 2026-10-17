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

    fireEvent.click(screen.getByRole('button', { name: `Accept invite to ${GROUP_NAME}` }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

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
});
