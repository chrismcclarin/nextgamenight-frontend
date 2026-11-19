// F9b (88.9) pins for the delayed-enable confirm on the shared state machine
// (owner pick F9b, 88.9-PICKS-B5.json item F9, 2026-11-07; window = the Q4 default in
// 88.9-RULINGS.md round 2: gated CONFIRM_DELAY_MS, then live CONFIRM_LIVE_MS).
//
// What these lock:
//   1. A second tap inside the gate is refused, and the armed label counts down
//      Wait (3), (2), (1) while the accessible name reads the resting name, then the wait
//      (X69, 88.9-67: the name contains the visible word and changes with every step).
//   2. The two-tap tier is live from CONFIRM_DELAY_MS to CONFIRM_DELAY_MS + CONFIRM_LIVE_MS,
//      commits once, then reverts.
//   3. The dialog tier refuses confirm() for CONFIRM_DELAY_MS after open (the Enter path),
//      then commits, and never auto-closes.
//   4. The typed tier carries no countdown.
//   5. Unmounting mid-countdown leaves no timer behind.
//   6. reserveFor hands a caller the strings whose width its label must hold (X69 width,
//      88.9-67): the three countdown labels and the armed label, as strings, never markup.
// The numbers are imported from src/components/ui/confirmDelay.ts ("export const CONFIRM_DELAY_MS = 3000;"),
// never written here as literals.
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIRM_DELAY_MS, CONFIRM_LIVE_MS } from './confirmDelay';
import {
  DEFAULT_ARMED_LABEL,
  DEFAULT_ARMED_NAME,
  useConfirmAction,
  type ConfirmActionState,
  type ConfirmTier,
  type UseConfirmActionConfig,
} from './useConfirmAction';

afterEach(cleanup);

// The newest hook state, written by the host on every render, so a test can read
// dialogProps and compare function identities across renders.
let latest: ConfirmActionState | null = null;
// How many times the host has rendered (88.9-52 A-56: the countdown's cost is counted in host renders).
let hostRenders = 0;

function Host({
  tier,
  onConfirm,
}: {
  tier: ConfirmTier;
  onConfirm: UseConfirmActionConfig['onConfirm'];
}) {
  const gate = useConfirmAction({
    tier,
    title: 'Remove Sam?',
    confirmLabel: 'Remove',
    expectedPhrase: tier === 'typed' ? 'Sam' : undefined,
    onConfirm,
  });
  latest = gate;
  hostRenders += 1;
  return React.createElement(
    'div',
    null,
    gate.statusNode,
    React.createElement(
      'button',
      { ...gate.triggerProps('sam', 'Sam', 'Remove Sam'), 'data-testid': 'trigger' },
      gate.labelFor('sam', 'Remove')
    )
  );
}

function renderHost(tier: ConfirmTier, onConfirm: UseConfirmActionConfig['onConfirm'] = vi.fn()) {
  return render(React.createElement(Host, { tier, onConfirm }));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function current(): ConfirmActionState {
  if (!latest) throw new Error('the host has not rendered');
  return latest;
}

describe('useConfirmAction — F9b delayed enable (88.9-23)', () => {
  beforeEach(() => {
    latest = null;
    hostRenders = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('F9b (88.9): two-tap tier — a second tap inside 3 s is refused and the label counts Wait (3), (2), (1)', () => {
    const onConfirm = vi.fn();
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');

    fireEvent.click(trigger);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('Wait (3)');
    // Label-in-Name (WCAG 2.5.3, MED-61; X69 88.9-67): the name holds the visible word and the
    // number, after the resting name, so it says what the button does while it waits.
    expect(trigger).toHaveAttribute('aria-label', 'Remove Sam, wait 3 seconds');
    // DEC-5: nothing is announced while pressing would do nothing.
    expect(screen.getByRole('status').textContent).toBe('');

    advance(1000);
    expect(trigger).toHaveTextContent('Wait (2)');
    expect(trigger).toHaveAttribute('aria-label', 'Remove Sam, wait 2 seconds');
    // MED-62: the gated trigger is aria-disabled, never natively disabled.
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).not.toHaveAttribute('disabled');

    advance(1000);
    expect(trigger).toHaveTextContent('Wait (1)');
    expect(trigger).toHaveAttribute('aria-label', 'Remove Sam, wait 1 second');

    advance(500);
    fireEvent.click(trigger);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveTextContent('Wait (1)');

    advance(CONFIRM_DELAY_MS - 2500 - 1);
    expect(screen.getByRole('status').textContent).toBe('');

    advance(1);
    expect(trigger.textContent).toBe('Tap again');
    expect(trigger).toHaveAttribute('aria-label', 'Tap again to confirm');
    expect(trigger).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('status')).toHaveTextContent('Press again to confirm: Remove Sam');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('F9b (88.9): two-tap tier — live from 3 s to 6 s, commits once, reverts at 6 s', async () => {
    const onConfirm = vi.fn();
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');

    fireEvent.click(trigger);
    const triggerBefore = current().trigger;
    advance(CONFIRM_DELAY_MS);
    // MED-50: the per-second ticks never churn the handler identities.
    expect(current().trigger).toBe(triggerBefore);
    expect(trigger.textContent).toBe('Tap again');

    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('sam', { from: trigger });
    expect(current().armedId).toBeNull();

    // A second arm, left alone, stays armed through the live window and reverts at its end.
    fireEvent.click(trigger);
    expect(current().armedId).toBe('sam');
    advance(CONFIRM_DELAY_MS + CONFIRM_LIVE_MS - 1);
    expect(current().armedId).toBe('sam');
    advance(1);
    expect(current().armedId).toBeNull();
    expect(trigger).toHaveTextContent('Remove');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('F9b (88.9): dialog tier — confirm() is refused for 3 s after open, then commits', async () => {
    const onConfirm = vi.fn();
    renderHost('dialog', onConfirm);

    act(() => {
      current().trigger('s1', 'Tuesday session');
    });
    expect(current().open).toBe(true);
    expect(current().dialogProps.confirmDelay).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('');

    advance(CONFIRM_DELAY_MS - 100);
    // The Enter path: ConfirmDialog's confirm reaches the hook's confirm() directly.
    await act(async () => {
      current().confirm();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    advance(100);
    expect(screen.getByRole('status').textContent).toBe('');
    // Live, and it stays open: the dialog tier never reverts on its own.
    advance(CONFIRM_LIVE_MS + 1000);
    expect(current().open).toBe(true);

    await act(async () => {
      current().confirm();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('s1');
  });

  it('F9b (88.9): typed tier carries no countdown', () => {
    renderHost('typed');

    act(() => {
      current().trigger('g1', 'Sam');
    });
    expect(current().open).toBe(true);
    expect(current().dialogProps.confirmDelay).toBe(false);
  });

  it('X69 (88.9): a custom armed label counts Wait too, and the gated name names the resting action, or confirmLabel when the caller gives none', () => {
    // The Profile collection shape: a glyph at rest that arms to the verb (fork 7). X69 widened
    // (owner 2026-11-14) supersedes R-W1's countdown on the verb for the gated half; the live label stays.
    function CustomHost() {
      const gate = useConfirmAction({
        tier: 'two-tap',
        title: 'Remove this game?',
        confirmLabel: 'Remove',
        armedLabel: 'Remove',
        onConfirm: vi.fn(),
      });
      return React.createElement(
        'div',
        null,
        gate.statusNode,
        React.createElement(
          'button',
          { ...gate.triggerProps('catan', 'Catan', 'Remove Catan'), 'data-testid': 'named' },
          gate.labelFor('catan', '×')
        ),
        React.createElement(
          'button',
          { ...gate.triggerProps('brass', 'Brass'), 'data-testid': 'bare' },
          gate.labelFor('brass', 'Remove')
        )
      );
    }
    render(React.createElement(CustomHost));
    const named = screen.getByTestId('named');
    const bare = screen.getByTestId('bare');

    fireEvent.click(named);
    expect(named).toHaveTextContent('Wait (3)');
    expect(named).toHaveAttribute('aria-label', 'Remove Catan, wait 3 seconds');
    advance(2000);
    expect(named).toHaveTextContent('Wait (1)');
    expect(named).toHaveAttribute('aria-label', 'Remove Catan, wait 1 second');
    // DEC-5 (P2): nothing is written to the live region per second.
    expect(screen.getByRole('status').textContent).toBe('');
    advance(1000);
    expect(named).toHaveTextContent('Remove');
    expect(named).toHaveAttribute('aria-label', 'Remove');

    // No resting name: the hook names the action from confirmLabel for the wait only.
    expect(bare).not.toHaveAttribute('aria-label');
    fireEvent.click(bare);
    expect(bare).toHaveTextContent('Wait (3)');
    expect(bare).toHaveAttribute('aria-label', 'Remove, wait 3 seconds');
    advance(CONFIRM_DELAY_MS);
    expect(bare).toHaveTextContent('Remove');
    expect(bare).not.toHaveAttribute('aria-label');
  });

  it('X69 (88.9): reserveFor returns the three countdown labels and the armed label while armed, or at rest when asked, and nothing otherwise', () => {
    renderHost('two-tap');
    const trigger = screen.getByTestId('trigger');
    const HELD = ['Wait (3)', 'Wait (2)', 'Wait (1)', 'Tap again'];

    // At rest: nothing, unless the caller asks for the reserve at rest (the Profile collection x,
    // whose arming must not reflow the title beside it).
    expect(current().reserveFor('sam')).toEqual([]);
    expect(current().reserveFor('sam', { atRest: true })).toEqual(HELD);

    // Armed: through the gate and the live window, for the armed target only.
    fireEvent.click(trigger);
    expect(current().reserveFor('sam')).toEqual(HELD);
    expect(current().reserveFor('alex')).toEqual([]);
    advance(CONFIRM_DELAY_MS);
    expect(current().reserveFor('sam')).toEqual(HELD);
    advance(CONFIRM_LIVE_MS);
    expect(current().reserveFor('sam')).toEqual([]);

    // Strings, never markup (the hook's No markup contract).
    expect(current().reserveFor('sam', { atRest: true }).every((entry) => typeof entry === 'string')).toBe(true);

    // The dialog and typed tiers render no row label, so they reserve nothing here; the dialog
    // tier's confirm reserves inside ConfirmDialog.
    cleanup();
    renderHost('dialog');
    expect(current().reserveFor('sam', { atRest: true })).toEqual([]);
    cleanup();
    renderHost('typed');
    expect(current().reserveFor('sam', { atRest: true })).toEqual([]);
  });

  it('F9b (88.9): unmount mid-countdown clears every timer', () => {
    const { unmount } = renderHost('two-tap');
    const trigger = screen.getByTestId('trigger');

    fireEvent.click(trigger);
    advance(1500);
    // The countdown is running (so there is a tick timer to leak) ...
    expect(trigger).toHaveTextContent('Wait (2)');

    unmount();
    // ... and unmounting leaves neither the tick nor the revert timer behind.
    expect(vi.getTimerCount()).toBe(0);
    advance(10000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('A-55 (88.9-52): a re-arm of the same row in the turn its window ends starts a fresh gate', () => {
    // The window's end and the re-arm land in ONE act, so React commits them together and the armed
    // row never renders as disarmed in between. The countdown must still restart: the label reads
    // Wait (3) and a press right after is refused, not committed on the last window's live state.
    const onConfirm = vi.fn();
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');

    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    expect(trigger.textContent).toBe('Tap again');

    act(() => {
      vi.advanceTimersByTime(CONFIRM_LIVE_MS);
      current().trigger('sam', 'Sam', trigger);
    });
    expect(current().armedId).toBe('sam');
    expect(trigger).toHaveTextContent('Wait (3)');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');

    act(() => {
      current().trigger('sam', 'Sam', trigger);
    });
    expect(onConfirm, 'a press inside the fresh gate is refused').not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('Wait (3)');

    // The fresh gate then runs its full length and goes live as usual.
    advance(CONFIRM_DELAY_MS - 1);
    expect(trigger).toHaveTextContent('Wait (1)');
    advance(1);
    expect(trigger.textContent).toBe('Tap again');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('A-56 (88.9-52): one arm left alone costs the host 4 extra renders (two ticks, live, the disarm reset)', () => {
    renderHost('two-tap');
    const trigger = screen.getByTestId('trigger');
    const atRest = hostRenders;

    fireEvent.click(trigger);
    expect(hostRenders - atRest, 'the arm itself is one render').toBe(1);
    expect(trigger).toHaveTextContent('Wait (3)');
    // One act per second: timers fired inside ONE act are batched into one render.
    advance(1000);
    advance(1000);
    advance(CONFIRM_DELAY_MS - 2000);
    expect(trigger.textContent).toBe('Tap again');
    expect(hostRenders - atRest, 'arm, Wait (2), Wait (1), live').toBe(4);
    advance(CONFIRM_LIVE_MS);
    expect(trigger).toHaveTextContent('Remove');
    // The window's end is one render (the row disarms) plus the countdown's own reset to idle.
    expect(hostRenders - atRest, 'arm and window end are the two renders every arm needs; the countdown adds 4').toBe(2 + 4);
  });
});

// R13 (88.9-52, owner 2026-11-17, pick Everywhere): the live armed label a person SEES is
// Tap again on every two-tap control; the name a screen reader HEARS stays the full sentence, and
// it starts with the seen words (Label in Name, WCAG 2.5.3).
describe('useConfirmAction — R13 the armed label is Tap again, the name the full sentence (88.9-52)', () => {
  beforeEach(() => {
    latest = null;
    hostRenders = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function R13Host({ armedName }: { armedName?: string }) {
    const gate = useConfirmAction({
      tier: 'two-tap',
      title: 'Remove?',
      confirmLabel: 'Remove',
      ...(armedName === undefined ? {} : { armedName }),
      onConfirm: vi.fn(),
    });
    latest = gate;
    return React.createElement(
      'div',
      null,
      gate.statusNode,
      React.createElement(
        'button',
        { ...gate.triggerProps('sam', 'Sam', 'Remove Sam'), 'data-testid': 'named' },
        gate.labelFor('sam', 'Remove')
      ),
      React.createElement(
        'button',
        { ...gate.triggerProps('bo', 'Bo'), 'data-testid': 'bare' },
        gate.labelFor('bo', 'Remove')
      )
    );
  }

  it('R13 words: the default visible label is Tap again and the default name starts with it', () => {
    expect(DEFAULT_ARMED_LABEL).toBe('Tap again');
    expect(DEFAULT_ARMED_NAME).toBe('Tap again to confirm');
    expect(DEFAULT_ARMED_NAME.startsWith(DEFAULT_ARMED_LABEL + ' ')).toBe(true);
  });

  it('R13 default: live, a control shows Tap again and is named Tap again to confirm, with or without a resting name', () => {
    render(React.createElement(R13Host, {}));
    for (const id of ['named', 'bare']) {
      const control = screen.getByTestId(id);
      fireEvent.click(control);
      advance(CONFIRM_DELAY_MS);
      expect(control.textContent).toBe('Tap again');
      expect(control).toHaveAttribute('aria-label', 'Tap again to confirm');
      expect(control).toHaveAccessibleName('Tap again to confirm');
      expect(control).not.toHaveAttribute('aria-disabled');
      advance(CONFIRM_LIVE_MS);
      // Back at rest the armed name is gone: the bare control is named by its text again.
      expect(control.textContent).toBe('Remove');
    }
    expect(screen.getByTestId('bare')).not.toHaveAttribute('aria-label');
    expect(screen.getByTestId('named')).toHaveAttribute('aria-label', 'Remove Sam');
  });

  it('R13 own sentence: a caller armedName is heard over the same Tap again, and the announcement is unchanged', () => {
    render(React.createElement(R13Host, { armedName: 'Tap again to remove' }));
    const bare = screen.getByTestId('bare');
    fireEvent.click(bare);
    expect(bare.textContent).toBe('Wait (3)');
    expect(bare).toHaveAttribute('aria-label', 'Remove, wait 3 seconds');
    advance(CONFIRM_DELAY_MS);
    expect(bare.textContent).toBe('Tap again');
    expect(bare).toHaveAccessibleName('Tap again to remove');
    expect(screen.getByRole('status')).toHaveTextContent('Press again to confirm: Remove Bo');
  });

  it('R13 width: the reserve holds the short label, so the armed control is no wider than its words', () => {
    render(React.createElement(R13Host, { armedName: 'Tap again to remove' }));
    fireEvent.click(screen.getByTestId('bare'));
    expect(current().reserveFor('bo')).toEqual(['Wait (3)', 'Wait (2)', 'Wait (1)', 'Tap again']);
    expect(current().reserveFor('sam', { atRest: true })).toEqual(['Wait (3)', 'Wait (2)', 'Wait (1)', 'Tap again']);
  });
});
