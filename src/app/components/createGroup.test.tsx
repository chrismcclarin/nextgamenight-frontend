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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

type Mock = ReturnType<typeof vi.fn>;

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

  it('exposes a NAMED close affordance (SPEC Req 4 — no nameless glyphs)', () => {
    renderCreateGroup();
    // Two by design: <Modal.Header>'s `aria-label="Close"` × and the shipped
    // red "Close" text button 88-16 deliberately kept. Both are NAMED, which is
    // the requirement; the count is asserted so silently dropping the visible
    // one reads as a decision rather than a passing test.
    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(2);
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

    // The failure surfaces inline in the still-open dialog...
    expect(await screen.findByText('Group name already taken')).toBeInTheDocument();
    // ...and the celebratory invite hand-off must not fire for a group that
    // was never created.
    expect(screen.queryByTestId('invite-panel')).toBeNull();
  });
});
