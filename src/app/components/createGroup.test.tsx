// Phase 88 plan 16 — MIGRATION PROOF for createGroup's shell swap onto <Modal>.
//
// WHY THIS FILE EXISTS (read before extending):
// 88-16 replaced this component's hand-rolled overlay with the shared <Modal>.
// The Req 9 class census can only prove the old class is GONE; it cannot prove
// the create path still works. And this component's create path is load-bearing
// and cross-component: on a successful create it closes itself and hands off to
// FriendInvitePanel with `openedFrom="create"`, which is the ONLY thing that
// earns the panel its create-path header (88-15, UI-SPEC §6.3). Nothing pinned
// that handoff before — 88-15's pins render FriendInvitePanel directly with the
// prop already set, so a shell change here could drop it and every suite would
// stay green while the owner saw the generic "Invite Members" again, which is
// exactly the misread 88-15 existed to fix.
//
// FriendInvitePanel is STUBBED on purpose: its own behaviour is covered by
// FriendInvitePanel.test.tsx. What is untested is the WIRING, so the stub
// renders the three props that carry it.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` component under test.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.hoisted` so the `vi.mock` factory below (hoisted to the top of the file)
// can read it — a plain module-level const is not initialised in time. Same
// idiom as FriendInvitePanel.test.tsx:34.
const CREATED_GROUP = vi.hoisted(() => ({
  id: '99999999-9999-4999-8999-999999999999',
  name: 'Tuesday Night Crew',
}));

// `importOriginal` spread: only the network surface is replaced, so a REMOVED
// export still fails loudly rather than silently resolving to a mock.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      ...actual.groupsAPI,
      createGroup: vi.fn().mockResolvedValue(CREATED_GROUP),
    },
  };
});

// Stub: this suite pins the HANDOFF, not the panel. Rendering the props makes
// a dropped `openedFrom` a visible failure rather than a silent downgrade.
vi.mock('./FriendInvitePanel', () => ({
  default: ({
    group,
    open,
    openedFrom,
  }: {
    group?: { name?: string } | null;
    open?: boolean;
    openedFrom?: string;
  }) =>
    open ? (
      <div data-testid="invite-panel" data-opened-from={openedFrom}>
        {group?.name}
      </div>
    ) : null,
}));

import CreateGroup from './createGroup';
import { groupsAPI } from '../../lib/api';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

type Mock = ReturnType<typeof vi.fn>;

// 88.6-33 task 1 (R1 / DEF-88-25-01). The ratified line a code-less failure resolves
// to, READ FROM THE MODULE rather than transcribed: a register edit must move this
// test with it instead of leaving a stale literal that silently keeps passing. A plain
// `Error` carries no `ApiError.code`, so `deriveCode` returns `unknown`
// (`useFetchErrorState.ts:115-118`) and this is `MESSAGE_BY_CODE.unknown`.
const UNKNOWN_FAILURE_COPY = getFetchErrorMessage(new Error('anything at all'));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function renderCreateGroup(overrides: Record<string, unknown> = {}) {
  const modaltoggle = vi.fn();
  // CreateGroup is a JS component; its inferred prop type marks every prop
  // required. Cast so the harness can pass only what it exercises.
  const Component = CreateGroup as unknown as React.ComponentType<
    Record<string, unknown>
  >;
  const utils = render(
    <Component modal modaltoggle={modaltoggle} {...overrides} />
  );
  return { modaltoggle, ...utils };
}

describe('createGroup — Req 9 migration proof', () => {
  it('renders a real dialog labelled by its header (not a bare overlay div)', () => {
    renderCreateGroup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByRole('heading', { name: 'Create a new Group' })
    ).toBeInTheDocument();
  });

  it('closes on Escape — a keyboard path the hand-rolled overlay never had', async () => {
    const user = userEvent.setup();
    const { modaltoggle } = renderCreateGroup();
    await user.keyboard('{Escape}');
    expect(modaltoggle).toHaveBeenCalled();
  });

  it('exposes exactly ONE named close affordance — the error-red × (UAT row 283)', () => {
    renderCreateGroup();
    // 88-33 Task 9: the red "Close" text button is REMOVED by owner decision
    // (row 283); the header × takes the error color as its replacement. The
    // count is asserted so silently RESTORING the second button reads as a
    // decision rather than a passing test.
    const closes = screen.getAllByRole('button', { name: /close/i });
    expect(closes).toHaveLength(1);
    expect(closes[0].className).toContain('text-content-status-error');
  });

  it('renders nothing at all when `modal` is false', () => {
    renderCreateGroup({ modal: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Phase 88-29 (Req 11 / DEF-88-16-01). The blank-name guard used to raise a browser
  // `alert()`. Three assertions, because two of the three plausible regressions would
  // pass the other two: that no native dialog is raised, that the message lands in the
  // component's inline slot, and that the slot is ANNOUNCED. The third is the one that
  // matters — silently dropping `role="alert"` would leave a screen-reader user worse
  // off than the alert they had, and it would look like a passing test.
  it('reports a blank name inline and ANNOUNCED — never through a native dialog', async () => {
    const user = userEvent.setup();
    const nativeAlert = vi.fn();
    vi.stubGlobal('alert', nativeAlert);
    try {
      renderCreateGroup();
      // Whitespace passes the input's `required`, which is why this guard is reachable.
      await user.type(screen.getByPlaceholderText('Group Name'), '   ');
      await user.click(screen.getByRole('button', { name: /create group/i }));

      expect(nativeAlert).not.toHaveBeenCalled();
      const error = await screen.findByRole('alert');
      expect(error).toHaveTextContent('Please enter a group name');
      expect(screen.getByPlaceholderText('Group Name')).toHaveAttribute(
        'aria-describedby',
        error.id,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Stateful harness: `modaltoggle` really flips `modal`, so the create dialog
 * actually UNMOUNTS on success. A vi.fn() stub would leave it open and the
 * handoff assertions below would pass against a state the app never reaches.
 */
function StatefulHarness({ onToggle }: { onToggle: () => void }) {
  const [modal, setModal] = React.useState(true);
  const Component = CreateGroup as unknown as React.ComponentType<
    Record<string, unknown>
  >;
  return (
    <Component
      modal={modal}
      modaltoggle={() => {
        onToggle();
        setModal((m) => !m);
      }}
    />
  );
}

describe('createGroup create-path handoff (88-15 wiring survives the 88-16 shell swap)', () => {
  it('closes itself and auto-opens the invite panel with openedFrom="create"', async () => {
    const user = userEvent.setup();
    const modaltoggle = vi.fn();
    render(<StatefulHarness onToggle={modaltoggle} />);

    await user.type(screen.getByPlaceholderText('Group Name'), 'Tuesday Night Crew');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    await waitFor(() => {
      expect(screen.getByTestId('invite-panel')).toBeInTheDocument();
    });
    // The create dialog is really gone, not merely covered.
    expect(screen.queryByRole('dialog')).toBeNull();
    // BLK-88-12-01 shape, applied to the CLOSING side of the handoff: Radix
    // sets `pointer-events: none` on <body> while a dialog is open. If that
    // survives the create dialog's unmount, the incoming invite panel ships
    // pointer-dead — the exact failure mode 88-12 hit from the other direction.
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
    // The flag is the whole point: without it the panel shows the generic
    // "Invite Members" header, which the owner read as an accidental
    // click-through (88-15, UI-SPEC §6.3).
    expect(screen.getByTestId('invite-panel')).toHaveAttribute(
      'data-opened-from',
      'create'
    );
    // ...and it is the freshly created group that is handed over, not the form.
    expect(screen.getByTestId('invite-panel')).toHaveTextContent(
      'Tuesday Night Crew'
    );
    expect(modaltoggle).toHaveBeenCalled();
    expect(groupsAPI.createGroup as unknown as Mock).toHaveBeenCalledWith({
      name: 'Tuesday Night Crew',
    });
  });

  it('does NOT open the invite panel when the create request fails', async () => {
    (groupsAPI.createGroup as unknown as Mock).mockRejectedValueOnce(
      new Error('Group name already taken')
    );
    const user = userEvent.setup();
    renderCreateGroup();

    await user.type(screen.getByPlaceholderText('Group Name'), 'Dupe');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    // The failure surfaces inline in the still-open dialog — as the RATIFIED
    // register line, never the upstream `error.message` this used to render
    // (88.6-33 task 1, R1 / DEF-88-25-01).
    expect(await screen.findByText(UNKNOWN_FAILURE_COPY)).toBeInTheDocument();
    expect(screen.queryByText('Group name already taken')).toBeNull();
    // ...and the celebratory invite hand-off must not fire for a group that
    // was never created.
    expect(screen.queryByTestId('invite-panel')).toBeNull();
  });
});

// 88.6-33 task 1 (R1 / DEF-88-25-01 + UI-SPEC §14 A-30 + D49-b + D-30).
//
// THREE things this block pins, and the reason each needs a BEHAVIOURAL arm:
//
//  1. The SERVER-failure copy is the ratified register line AND it is reachable
//     through the name input's `aria-describedby` association — i.e. announced by
//     the region the field points at, NOT by a toast. Asserting the string alone
//     would pass a version that routed it to Sonner and dropped the association,
//     which is exactly what the §6.2 named exception exists to prevent.
//  2. The CLIENT-SIDE validation copy at the `.trim()` guard is UNCHANGED and does
//     NOT pass through `getFetchErrorMessage` — routing it would replace a specific
//     instruction with the generic `unknown` line.
//  3. Activating the migrated `<Button>` still SUBMITS the form. `Button` defaults
//     `type` to `'button'` (`Button.tsx:267`), so a migration that forgot
//     `type="submit"` would leave the control inert with no type error and no class
//     census failure. An attribute-only check is NOT sufficient — it would pass a
//     `<Button type="submit">` whose submit was broken some other way — so the arm
//     below asserts the REQUEST, and the attribute is checked beside it as a hint
//     for whoever reads the failure.
//
// `UNKNOWN_FAILURE_COPY` is declared beside the imports above, for the reason recorded there.
describe('createGroup failure copy + submit wiring (88.6-33)', () => {
  it('announces the RATIFIED server-failure line through the input’s own aria-describedby region — not a toast', async () => {
    (groupsAPI.createGroup as unknown as Mock).mockRejectedValueOnce(
      new Error('Group name already taken')
    );
    const user = userEvent.setup();
    renderCreateGroup();

    const input = screen.getByPlaceholderText('Group Name');
    await user.type(input, 'Dupe');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    // Positive settle signal FIRST (the sweep recipe's trap 2): wait for the region
    // to actually carry the failure before asserting anything about the wiring.
    const region = await screen.findByRole('alert');
    expect(region).toHaveTextContent(UNKNOWN_FAILURE_COPY);
    // The association is the load-bearing half of the §6.2 named exception.
    expect(input).toHaveAttribute('aria-describedby', region.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(region.id).toBe('create-group-error');
    // The raw upstream text never reaches the person.
    expect(screen.queryByText('Group name already taken')).toBeNull();
    // The modal stays open on failure — the context does not move.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('leaves the CLIENT-SIDE validation copy alone — it does not route through getFetchErrorMessage', async () => {
    const user = userEvent.setup();
    renderCreateGroup();

    // Whitespace passes the input's `required`, which is what makes this guard reachable.
    await user.type(screen.getByPlaceholderText('Group Name'), '   ');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    const region = await screen.findByRole('alert');
    expect(region).toHaveTextContent('Please enter a group name');
    // Discriminating arm: if the guard were "standardised" onto the helper it would
    // render the generic unknown line instead of the specific instruction.
    expect(region).not.toHaveTextContent(UNKNOWN_FAILURE_COPY);
    // ...and no request was ever attempted.
    expect(groupsAPI.createGroup as unknown as Mock).not.toHaveBeenCalled();
  });

  it('still SUBMITS the form when the migrated <Button> is activated (type="submit" survived)', async () => {
    const user = userEvent.setup();
    renderCreateGroup();

    await user.type(screen.getByPlaceholderText('Group Name'), 'Tuesday Night Crew');
    const submit = screen.getByRole('button', { name: /create group/i });
    // Hint for whoever reads a failure here — NOT the assertion that carries the test.
    expect(submit).toHaveAttribute('type', 'submit');

    await user.click(submit);

    // THE assertion: the click reached the form's onSubmit and a create was attempted.
    await waitFor(() =>
      expect(groupsAPI.createGroup as unknown as Mock).toHaveBeenCalledWith({
        name: 'Tuesday Night Crew',
      })
    );
  });

  it('carries its own elevation pair on the tier, with the enabled-hover variant (§3.4 rule 2 / D49-b)', async () => {
    const user = userEvent.setup();
    renderCreateGroup();
    // Settle on the control itself, which only renders inside the open dialog.
    const submit = await screen.findByRole('button', { name: /create group/i });

    // The resting half and the PIN. The pin is what stops `Button`'s cva base
    // (`enabled-hover:shadow-theme-md`) shrinking this control's shipped `lg` on hover.
    expect(submit.className).toContain('shadow-theme-sm');
    expect(submit.className).toContain('enabled-hover:shadow-theme-lg');
    // The alias family is gone from this element entirely, and a BARE `hover:` pin is
    // rejected (D10) — it would not dedupe against the base token, so both would paint.
    expect(submit.className).not.toMatch(/(?:^|\s|:)shadow-(?:sm|md|lg)\b/);
    expect(submit.className).not.toContain('hover:shadow-theme-lg ');
    expect(/(?:^|\s)hover:shadow-/.test(submit.className)).toBe(false);
    // D-30: the per-CTA floor is the primitive's now, not the call site's. `min-h-11`
    // is still PRESENT on the element because the cva base emits it — what must be gone
    // is a SECOND, call-site copy, so this arm pins the base's and not the duplicate.
    expect(submit.className).toContain('min-h-11');
    expect(submit.className.match(/\bmin-h-11\b/g)).toHaveLength(1);
    // `uppercase` is ALIVE and survives: `.btn` declares no `text-transform`.
    expect(submit.className).toContain('uppercase');
    // Dead-on-`.btn` utilities are gone (§3.4 rule 3).
    expect(submit.className).not.toContain('text-sm');
    expect(submit.className).not.toContain('font-bold');
    expect(submit.className).not.toContain('px-6');
    expect(submit.className).not.toContain('disabled:opacity-50');
  });
});

// 88-33 Task 4 (UAT row 447): in-flight feedback + the mid-create dismiss guard.
// The walk failure: "pressed enter... nothing happened, and I was able to press
// escape and exit the modal before the friends modal came up". Every close path
// (Esc, the header ×, the red Close button) routes through ONE guarded onClose,
// so all are inert while the create request is in flight — and work again the
// moment it settles.
describe('createGroup in-flight guard (UAT row 447)', () => {
  function deferCreate() {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    (groupsAPI.createGroup as unknown as Mock).mockImplementationOnce(
      () =>
        new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        })
    );
    return {
      resolve: (v: unknown = CREATED_GROUP) => resolve(v),
      reject: (e: unknown) => reject(e),
    };
  }

  it('cannot double-submit: the button disables, swaps its label, and a forced re-submit is inert', async () => {
    const user = userEvent.setup();
    const deferred = deferCreate();
    renderCreateGroup();

    await user.type(screen.getByPlaceholderText('Group Name'), 'Tuesday Night Crew');
    const submit = screen.getByRole('button', { name: /create group/i });
    await user.click(submit);

    // In-flight presentation: disabled + label swap, announced via a live region.
    const creating = screen.getByRole('button', { name: /creating/i });
    expect(creating).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Creating group...');

    // Belt-and-braces: even a submit EVENT that bypasses the disabled button
    // (Enter re-dispatch, programmatic submit) must not fire a second request.
    fireEvent.submit(creating.closest('form')!);
    expect(groupsAPI.createGroup as unknown as Mock).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create group/i })).toBeEnabled()
    );
  });

  it('Esc, the header ×, and the red Close are ALL inert mid-create; Esc closes again after an error settle', async () => {
    const user = userEvent.setup();
    const deferred = deferCreate();
    const { modaltoggle } = renderCreateGroup();

    await user.type(screen.getByPlaceholderText('Group Name'), 'Crew');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    // Mid-create: every close affordance is inert AND presents as unavailable.
    await user.keyboard('{Escape}');
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    expect(closeButtons).toHaveLength(1); // the red × (Task 9 removed the text button)
    for (const button of closeButtons) {
      await user.click(button);
      expect(button).toHaveAttribute('aria-disabled', 'true');
    }
    expect(modaltoggle).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The request FAILS: closability must come back — the person is not stuck.
    // 88.6-33: the inline region now carries the RATIFIED register line, not the
    // upstream `error.message`; the settle signal is unchanged in kind.
    deferred.reject(new Error('Group name already taken'));
    expect(await screen.findByText(UNKNOWN_FAILURE_COPY)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(modaltoggle).toHaveBeenCalledTimes(1);
  });

  it('focuses the group name input on open (UAT row 291 fleet policy)', async () => {
    renderCreateGroup();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Group Name')).toHaveFocus()
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-44 (R7 / AC-7, UI-SPEC §7.5) — the composed axe audit, after this surface's LAST
// migration commit (plan 88.6-33's `6410449`; `git log -1 -- createGroup.js` re-checked at
// execution). THIS SURFACE HAS NO `matchMedia` FORK: neither `createGroup.js` nor anything it
// renders (`Modal`, `Input`, `Button`; `FriendInvitePanel` is stubbed above) calls `matchMedia`
// — measured 2026-09-22. One tree, one run per rule set, no resize.
//
// The fork-5 house rule is asserted alongside axe: `formLabels.audit.test.tsx`'s fixed roster
// never included this form, and axe's `label` rule passes a placeholder-only input.
// ---------------------------------------------------------------------------
import { axe } from 'vitest-axe';
import { auditFormControls } from '../../test-utils/formControlAudit';

const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

/** A real trigger + the consumer's shape: `modaltoggle` flips `modal`, and the form returns null. */
function AuditHost() {
  const [open, setOpen] = React.useState(false);
  const Component = CreateGroup as unknown as React.ComponentType<Record<string, unknown>>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        + Create New Group
      </button>
      <Component modal={open} modaltoggle={() => setOpen((m) => !m)} />
    </>
  );
}

describe('createGroup — R7 composed axe audit + house rule + focus contract (88.6-44)', () => {
  it('1. the dialog passes WCAG 4.1.2 and heading-order (one composed run each; no media-query fork)', async () => {
    renderCreateGroup();
    await screen.findByRole('button', { name: /create group/i });
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the group-name control carries id + name + a label source (house rule Input.tsx:11-19)', async () => {
    renderCreateGroup();
    await screen.findByRole('button', { name: /create group/i });
    auditFormControls(screen.getByRole('dialog'));
  });

  it('3. focus: on OPEN the passed initialFocusRef target (the name input); on CLOSE the NAMED trigger', async () => {
    const user = userEvent.setup();
    render(<AuditHost />);
    const trigger = screen.getByRole('button', { name: '+ Create New Group' });
    trigger.focus();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    const nameInput = screen.getByPlaceholderText('Group Name');
    // `createGroup.js` passes `initialFocusRef={nameInputRef}` — the NAMED target.
    await waitFor(() => expect(document.activeElement).toBe(nameInput));
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // NAMED identity, never "not body".
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
