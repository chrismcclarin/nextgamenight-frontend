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
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
