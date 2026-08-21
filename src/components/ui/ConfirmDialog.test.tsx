// Behaviour + a11y pins for the destructive-confirmation primitive
// (`useConfirmAction` + `ConfirmDialog`, Req 11 / D-03..D-11, UI-SPEC §8.7).
//
// The contract these lock, in order of how badly a regression would hurt:
//   1. `onConfirm` NEVER fires without an explicit confirmation, in every tier
//   2. Two-tap arming is keyed BY TARGET — arming row A and tapping row B must
//      never destroy row B (AR DEC-2; the adopter surfaces are list rows)
//   3. The two-tap announcement region is ALWAYS mounted and updates IN PLACE
//      (a remounted live region is silently never announced)
//   4. The 3s window, its auto-revert, and its unmount cleanup are the SHIPPED
//      `KebabMenu.js` semantics, absorbed rather than reinvented
//   5. Pending: a slow `onConfirm` cannot be double-fired
//   6. Typed tier compares with `!==` string equality, never a built pattern
import * as React from 'react';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ConfirmDialog, isDismissableTier } from './ConfirmDialog';
import {
  useConfirmAction,
  TWO_TAP_WINDOW_MS,
  DEFAULT_ARMED_LABEL,
  type UseConfirmActionConfig,
} from './useConfirmAction';

afterEach(cleanup);

/* ------------------------------------------------------------------ *
 * Harnesses. The hook is exercised through a component (its state and
 * its always-mounted status node only exist inside a render), following
 * the `Modal.test.tsx` render-helper idiom.
 * ------------------------------------------------------------------ */

const TARGETS: Array<{ id: string; label: string }> = [
  { id: 'alex', label: 'Alex' },
  { id: 'bo', label: 'Bo' },
];

function TwoTapHarness({
  onConfirm,
  ...rest
}: Partial<UseConfirmActionConfig> & {
  onConfirm: UseConfirmActionConfig['onConfirm'];
}) {
  const confirm = useConfirmAction({
    tier: 'two-tap',
    title: 'Remove player?',
    // Superset config: `body` is accepted and ignored by the two-tap tier.
    body: 'This body belongs to the dialog tier and must be ignored here.',
    confirmLabel: 'Remove',
    onConfirm,
    ...rest,
  });

  return (
    <div>
      {confirm.statusNode}
      {TARGETS.map((target) => (
        <button
          key={target.id}
          {...confirm.triggerProps(target.id, target.label, `Remove ${target.label}`)}
          data-testid={`trigger-${target.id}`}
        >
          {confirm.labelFor(target.id, `Remove ${target.label}`)}
        </button>
      ))}
      <span data-testid="armed">{confirm.armedId ?? 'none'}</span>
      <span data-testid="pending">{String(confirm.pending)}</span>
    </div>
  );
}

function DialogHarness({
  onConfirm,
  ...rest
}: Partial<UseConfirmActionConfig> & {
  onConfirm: UseConfirmActionConfig['onConfirm'];
}) {
  const confirm = useConfirmAction({
    tier: 'dialog',
    title: 'Delete this session?',
    body: 'The play record, scores and who was there are deleted for everyone.',
    confirmLabel: 'Delete',
    onConfirm,
    ...rest,
  });

  return (
    <div>
      {confirm.statusNode}
      <button data-testid="open" onClick={() => confirm.trigger('s1', 'Tuesday session')}>
        Delete session
      </button>
      <span data-testid="open-state">{String(confirm.open)}</span>
      <span data-testid="pending">{String(confirm.pending)}</span>
      <span data-testid="disabled-empty">{String(confirm.confirmDisabled(''))}</span>
      <span data-testid="disabled-partial">
        {String(confirm.confirmDisabled('Tuesday Cre'))}
      </span>
      <span data-testid="disabled-exact">
        {String(confirm.confirmDisabled('Tuesday Crew'))}
      </span>
      <span data-testid="disabled-case">
        {String(confirm.confirmDisabled('tuesday crew'))}
      </span>
      <button data-testid="confirm" onClick={() => confirm.confirm('Tuesday Crew')}>
        Confirm
      </button>
      <button data-testid="cancel" onClick={() => confirm.cancel()}>
        Cancel
      </button>
    </div>
  );
}

/** A promise whose settlement the test drives, for the pending pins. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useConfirmAction — dialog tier', () => {
  it('does not call onConfirm when the gate is merely opened', () => {
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('open'));

    expect(screen.getByTestId('open-state')).toHaveTextContent('true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancel aborts — onConfirm is never called and the gate closes', () => {
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('cancel'));

    expect(screen.getByTestId('open-state')).toHaveTextContent('false');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('passes the trigger target through to onConfirm unchanged', async () => {
    const onConfirm = vi.fn();
    render(<DialogHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('open'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm'));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('s1');
  });

  it('does not double-fire while onConfirm is in flight', async () => {
    const gate = deferred();
    const onConfirm = vi.fn(() => gate.promise);
    render(<DialogHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('open'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm'));
    });

    expect(screen.getByTestId('pending')).toHaveTextContent('true');
    // While pending, the confirm control is disabled — but even if a call
    // slips through (double tap, stale pointer event), it must not re-fire.
    expect(screen.getByTestId('disabled-empty')).toHaveTextContent('true');

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm'));
      fireEvent.click(screen.getByTestId('confirm'));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('false');
  });
});

describe('useConfirmAction — typed tier', () => {
  it('keeps confirm disabled until the typed value matches exactly', () => {
    render(
      <DialogHarness
        tier="typed"
        expectedPhrase="Tuesday Crew"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByTestId('disabled-empty')).toHaveTextContent('true');
    expect(screen.getByTestId('disabled-partial')).toHaveTextContent('true');
    expect(screen.getByTestId('disabled-case')).toHaveTextContent('true');
    expect(screen.getByTestId('disabled-exact')).toHaveTextContent('false');
  });

  it('refuses to commit when the supplied value does not match the phrase', async () => {
    const onConfirm = vi.fn();
    render(
      <DialogHarness
        tier="typed"
        expectedPhrase="Some Other Group"
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByTestId('open'));
    await act(async () => {
      // The harness confirm button supplies 'Tuesday Crew', which does not match.
      fireEvent.click(screen.getByTestId('confirm'));
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('commits once the supplied value matches the phrase exactly', async () => {
    const onConfirm = vi.fn();
    render(
      <DialogHarness tier="typed" expectedPhrase="Tuesday Crew" onConfirm={onConfirm} />
    );

    fireEvent.click(screen.getByTestId('open'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm'));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('useConfirmAction — two-tap tier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms on the first invocation without committing, and swaps the visible label', () => {
    const onConfirm = vi.fn();
    render(<TwoTapHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('armed')).toHaveTextContent('alex');
    expect(screen.getByTestId('trigger-alex')).toHaveTextContent(DEFAULT_ARMED_LABEL);
    expect(screen.getByTestId('trigger-bo')).toHaveTextContent('Remove Bo');
  });

  it('commits on a second invocation on the SAME target inside the window', async () => {
    const onConfirm = vi.fn();
    render(<TwoTapHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    act(() => {
      vi.advanceTimersByTime(TWO_TAP_WINDOW_MS - 100);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alex'));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('alex');
    expect(screen.getByTestId('armed')).toHaveTextContent('none');
  });

  // AR DEC-2 — the pin that exists because the adopter surfaces are list rows.
  it('CROSS-TARGET: arming A then invoking B re-arms B and never commits B', () => {
    const onConfirm = vi.fn();
    render(<TwoTapHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    expect(screen.getByRole('status')).toHaveTextContent('Alex');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByTestId('trigger-bo'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('armed')).toHaveTextContent('bo');
    expect(screen.getByTestId('trigger-bo')).toHaveTextContent(DEFAULT_ARMED_LABEL);
    expect(screen.getByTestId('trigger-alex')).toHaveTextContent('Remove Alex');
    // The announcement names the NEW target — a guaranteed text change, hence a
    // guaranteed re-announcement.
    expect(screen.getByRole('status')).toHaveTextContent('Bo');
    expect(screen.getByRole('status')).not.toHaveTextContent('Alex');
  });

  it("A's timer is cancelled when B re-arms, so A cannot revert B", () => {
    const onConfirm = vi.fn();
    render(<TwoTapHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByTestId('trigger-bo'));
    // A's original timer would have fired at 3000ms (i.e. 1000ms from here).
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByTestId('armed')).toHaveTextContent('bo');
  });

  it('auto-reverts after the 3s window, then re-arms rather than commits', () => {
    const onConfirm = vi.fn();
    render(<TwoTapHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    act(() => {
      vi.advanceTimersByTime(TWO_TAP_WINDOW_MS);
    });

    expect(screen.getByTestId('armed')).toHaveTextContent('none');
    expect(screen.getByTestId('trigger-alex')).toHaveTextContent('Remove Alex');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByTestId('trigger-alex'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('armed')).toHaveTextContent('alex');
  });

  it('clears the pending arm timer on unmount (no setState after unmount)', () => {
    const { unmount } = render(<TwoTapHarness onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not double-fire while a slow onConfirm is in flight', async () => {
    const gate = deferred();
    const onConfirm = vi.fn(() => gate.promise);
    render(<TwoTapHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alex'));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pending')).toHaveTextContent('true');

    // Further taps — same target or another — are inert while pending.
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alex'));
      fireEvent.click(screen.getByTestId('trigger-bo'));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('armed')).toHaveTextContent('none');

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('false');
  });
});

describe('useConfirmAction — the always-mounted announcement region', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders role="status" BEFORE anything is armed (never conditionally mounted)', () => {
    render(<TwoTapHarness onConfirm={vi.fn()} />);

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  // The defect this pin exists for: a live region that REMOUNTS on update is
  // never announced by NVDA/VoiceOver, and every text-content assertion above
  // still passes green. Only DOM identity catches it.
  it('DOM-IDENTITY: updates the same node in place across an arm', () => {
    render(<TwoTapHarness onConfirm={vi.fn()} />);

    const node = screen.getByRole('status');
    fireEvent.click(screen.getByTestId('trigger-alex'));

    expect(screen.getByRole('status')).toBe(node);
    expect(node).toHaveTextContent('Alex');
  });

  it('DOM-IDENTITY: survives the 3s revert as the same node', () => {
    render(<TwoTapHarness onConfirm={vi.fn()} />);

    const node = screen.getByRole('status');
    fireEvent.click(screen.getByTestId('trigger-alex'));
    act(() => {
      vi.advanceTimersByTime(TWO_TAP_WINDOW_MS);
    });

    expect(screen.getByRole('status')).toBe(node);
    expect(node).toBeEmptyDOMElement();
  });

  it('clears the announcement on commit', async () => {
    render(<TwoTapHarness onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByTestId('trigger-alex'));
    expect(screen.getByRole('status')).toHaveTextContent('Alex');
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alex'));
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('useConfirmAction — Label-in-Name (WCAG 2.5.3) and aria-pressed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('swaps any aria-label together with the visible label on arm', () => {
    render(<TwoTapHarness onConfirm={vi.fn()} />);

    const alex = screen.getByTestId('trigger-alex');
    expect(alex).toHaveAttribute('aria-label', 'Remove Alex');
    expect(alex).not.toHaveAttribute('aria-pressed');

    fireEvent.click(alex);

    // Visible label and accessible name agree — a static aria-label over a
    // changed visible label is the 2.5.3 failure this pin forbids.
    expect(alex).toHaveTextContent(DEFAULT_ARMED_LABEL);
    expect(alex).toHaveAttribute('aria-label', DEFAULT_ARMED_LABEL);
    expect(alex).toHaveAttribute('aria-pressed', 'true');
  });

  it('drops aria-pressed again on the 3s revert', () => {
    render(<TwoTapHarness onConfirm={vi.fn()} />);

    const alex = screen.getByTestId('trigger-alex');
    fireEvent.click(alex);
    act(() => {
      vi.advanceTimersByTime(TWO_TAP_WINDOW_MS);
    });

    expect(alex).not.toHaveAttribute('aria-pressed');
    expect(alex).toHaveAttribute('aria-label', 'Remove Alex');
  });

  it('omits aria-label entirely when the caller supplies none (visible text wins)', () => {
    function NoAriaLabelHarness() {
      const confirm = useConfirmAction({
        tier: 'two-tap',
        title: 'Remove friend?',
        confirmLabel: 'Remove',
        onConfirm: vi.fn(),
      });
      return (
        <button {...confirm.triggerProps('f1', 'Sam')} data-testid="trigger">
          {confirm.labelFor('f1', 'Remove')}
        </button>
      );
    }
    render(<NoAriaLabelHarness />);

    expect(screen.getByTestId('trigger')).not.toHaveAttribute('aria-label');
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByTestId('trigger')).not.toHaveAttribute('aria-label');
    expect(screen.getByTestId('trigger')).toHaveTextContent(DEFAULT_ARMED_LABEL);
  });
});

/* ================================================================== *
 * ConfirmDialog — the rendered blocking surface (Task 2)
 * ================================================================== */

function renderConfirmDialog(
  props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}
) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <ConfirmDialog
      tier="dialog"
      open
      title="Delete this session?"
      body="The play record, scores and who was there are deleted for everyone."
      confirmLabel="Delete"
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmDisabled={() => false}
      {...props}
    />
  );
  return { onCancel, onConfirm, ...utils };
}

describe('ConfirmDialog — dialog tier', () => {
  it('renders nothing while closed', () => {
    renderConfirmDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title and the concrete-consequence body', () => {
    renderConfirmDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this session?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The play record, scores and who was there are deleted for everyone.'
      )
    ).toBeInTheDocument();
  });

  it('labels the confirm button with the verb alone, on the danger variant', () => {
    renderConfirmDialog();
    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    expect(confirmButton).toHaveClass('btn', 'btn-danger');
    expect(screen.queryByRole('button', { name: /^(OK|Yes)$/ })).not.toBeInTheDocument();
  });

  it('focuses Cancel on open, not the confirm or the close affordance', async () => {
    renderConfirmDialog();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    );
  });

  it('cancel aborts — onCancel fires and onConfirm never does', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderConfirmDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables the confirm control while a commit is pending', () => {
    renderConfirmDialog({ pending: true, confirmDisabled: () => true });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('passes an axe audit on the OPEN dialog', async () => {
    renderConfirmDialog();
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });
});

describe('ConfirmDialog — typed tier', () => {
  const typedProps = {
    tier: 'typed' as const,
    title: 'Delete Tuesday Crew?',
    body: 'The group is hidden immediately and its 4 members are emailed a takeover link.',
    confirmLabel: 'Delete group',
    expectedPhrase: 'Tuesday Crew',
  };

  it('renders a programmatically labelled type-to-confirm input', () => {
    renderConfirmDialog({ ...typedProps, confirmDisabled: () => true });
    const input = screen.getByLabelText(/To confirm, type/i);
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('id');
    // The name must say WHAT to type, not just that something must be typed.
    expect(input).toHaveAccessibleName(/Tuesday Crew/);
  });

  it('keeps the confirm disabled until the typed value matches exactly', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderConfirmDialog({
      ...typedProps,
      confirmDisabled: (value?: string) => value !== 'Tuesday Crew',
    });

    const confirmButton = screen.getByRole('button', { name: 'Delete group' });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByLabelText(/To confirm, type/i);
    await user.type(input, 'Tuesday Cre');
    expect(confirmButton).toBeDisabled();

    await user.type(input, 'w');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith('Tuesday Crew');
  });

  // 88-33 Task 4 (walk rows 439/431, owner-ruled 2026-08-13): the TYPED tier opens with
  // focus on the type-to-confirm input and submits on Enter once the value matches.
  // Button-only tiers keep Cancel-first — pinned by the dialog-tier focus test above.
  it('focuses the type-to-confirm input on open (typed tier only — walk row 439)', async () => {
    renderConfirmDialog({ ...typedProps, confirmDisabled: () => true });
    await waitFor(() =>
      expect(screen.getByLabelText(/To confirm, type/i)).toHaveFocus()
    );
  });

  it('Enter submits once the typed value matches (walk row 431)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderConfirmDialog({
      ...typedProps,
      confirmDisabled: (value?: string) => value !== 'Tuesday Crew',
    });

    const input = screen.getByLabelText(/To confirm, type/i);
    await user.type(input, 'Tuesday Crew{Enter}');

    expect(onConfirm).toHaveBeenCalledWith('Tuesday Crew');
  });

  it('Enter with a non-matching value does nothing (same predicate as the button)', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderConfirmDialog({
      ...typedProps,
      confirmDisabled: (value?: string) => value !== 'Tuesday Crew',
    });

    const input = screen.getByLabelText(/To confirm, type/i);
    await user.type(input, 'Tuesday Cre{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('restores focus to the input after a FAILED commit (r3 triage — the disabled window drops focus)', async () => {
    const shared = {
      ...typedProps,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      confirmDisabled: () => true,
    };
    const { rerender } = render(<ConfirmDialog {...shared} open pending />);

    // The commit settles as a FAILURE: the gate stays open, pending clears.
    rerender(<ConfirmDialog {...shared} open pending={false} />);

    await waitFor(() =>
      expect(screen.getByLabelText(/To confirm, type/i)).toHaveFocus()
    );
  });

  it('renders the caller-supplied pre-flight blocker panel above the input', () => {
    renderConfirmDialog({
      ...typedProps,
      confirmDisabled: () => true,
      blockerPanel: <p>You still own 2 groups with other members.</p>,
    });

    const panel = screen.getByText('You still own 2 groups with other members.');
    const input = screen.getByLabelText(/To confirm, type/i);
    expect(panel).toBeInTheDocument();
    // DOCUMENT_POSITION_FOLLOWING === 4: the input comes after the panel.
    expect(panel.compareDocumentPosition(input) & 4).toBeTruthy();
  });

  it('withholds the confirm control entirely while blocked (D-06)', () => {
    renderConfirmDialog({
      ...typedProps,
      confirmDisabled: () => true,
      blocked: true,
      blockerPanel: <p>Transfer ownership first.</p>,
    });

    expect(
      screen.queryByRole('button', { name: 'Delete group' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  // Outside-pointer dismissal is defeated for the typed tier (D-08). Radix's
  // own outside detection needs a real browser, so the DECISION seam is pinned
  // here the way `Modal.test.tsx:89-105` pins its escape hatch.
  it('marks the typed tier non-dismissable and the other tiers dismissable', () => {
    expect(isDismissableTier('typed')).toBe(false);
    expect(isDismissableTier('dialog')).toBe(true);
    expect(isDismissableTier('two-tap')).toBe(true);
  });

  it('Escape ABORTS — it routes to onCancel and never to onConfirm', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderConfirmDialog({
      ...typedProps,
      confirmDisabled: () => true,
    });

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('passes an axe audit on the OPEN typed dialog', async () => {
    renderConfirmDialog({ ...typedProps, confirmDisabled: () => true });
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });

  it('resets the typed value when the gate is reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = renderConfirmDialog({
      ...typedProps,
      confirmDisabled: () => true,
    });

    await user.type(screen.getByLabelText(/To confirm, type/i), 'Tuesday Crew');
    expect(screen.getByLabelText(/To confirm, type/i)).toHaveValue('Tuesday Crew');

    const shared = {
      ...typedProps,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      confirmDisabled: () => true,
    };
    rerender(<ConfirmDialog {...shared} open={false} />);
    rerender(<ConfirmDialog {...shared} open />);

    expect(screen.getByLabelText(/To confirm, type/i)).toHaveValue('');
  });
});

describe('ConfirmDialog — two-tap tier', () => {
  it('renders no dialog surface at all, so a tier switch is a one-word edit', () => {
    renderConfirmDialog({ tier: 'two-tap', open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders no dialog surface even if a caller leaves `open` true', () => {
    renderConfirmDialog({ tier: 'two-tap', open: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
