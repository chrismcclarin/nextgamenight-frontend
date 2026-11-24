// F9b (88.9) pins for the delayed-enable confirm on the shared state machine
// (owner pick F9b, 88.9-PICKS-B5.json item F9, 2026-11-07; the wait = the Q4 default in
// 88.9-RULINGS.md round 2: gated CONFIRM_DELAY_MS).
// AMENDED Phase 89.6-04 (OW-2 A, owner 2026-11-22): the live half has no end any more; item 2.
//
// What these lock:
//   1. A second tap inside the gate is refused, and the armed label counts down
//      Wait (3), (2), (1) while the accessible name reads the resting name, then the wait
//      (X69, 88.9-67: the name contains the visible word and changes with every step).
//   2. The two-tap tier is live from the 3 s wait with no end; it disarms on an outside press,
//      focus leaving, Escape, scroll-out or page hidden, each saying the cancel words.
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

import { CONFIRM_DELAY_MS } from './confirmDelay';
import { INLINE_RECEIPT_MS } from './useInlineReceipt';
import {
  DEFAULT_ARMED_LABEL,
  DISARM_ANNOUNCEMENT,
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
    ),
    // A second, plain control: somewhere for focus to go (OW-2, 89.6-04).
    React.createElement('button', { type: 'button', 'data-testid': 'other' }, 'Other')
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

  it('OW-2 (89.6-04): two-tap tier — live from 3 s with no end, commits once; no timer is pending once live', async () => {
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

    // A second arm, left alone, goes live and stays live: nothing ends it but a press or a disarm.
    fireEvent.click(trigger);
    expect(current().armedId).toBe('sam');
    advance(CONFIRM_DELAY_MS);
    expect(trigger.textContent).toBe('Tap again');
    // Once live nothing is scheduled: no revert timer exists (it was 1 before 89.6-04).
    expect(vi.getTimerCount()).toBe(0);
    advance(60000);
    expect(current().armedId).toBe('sam');
    expect(trigger.textContent).toBe('Tap again');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(vi.getTimerCount()).toBe(0);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('OW-2 (89.6-04): an outside press disarms and says Confirmation cancelled.; a press on the control\'s own parent is outside (no margin); a press on the control is not', () => {
    const onConfirm = vi.fn();
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');
    const region = screen.getByRole('status');

    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    // A press on the control itself is inside: still armed.
    fireEvent.mouseDown(trigger);
    expect(current().armedId).toBe('sam');
    expect(trigger.textContent).toBe('Tap again');

    // The control's own parent (its row) is outside: the 44px box is the edge, with no margin.
    fireEvent.mouseDown(trigger.parentElement as HTMLElement);
    expect(current().armedId).toBeNull();
    expect(trigger).toHaveTextContent('Remove');
    expect(trigger).not.toHaveAttribute('aria-pressed');
    expect(trigger).toHaveAttribute('aria-label', 'Remove Sam');
    // The same node before and after (C-6: a remounted live region says nothing).
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Confirmation cancelled.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('OW-2 (89.6-04): focus moving to another control disarms and says it; a null relatedTarget does not', () => {
    renderHost('two-tap');
    const trigger = screen.getByTestId('trigger');
    const other = screen.getByTestId('other');

    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    fireEvent.focusOut(trigger, { relatedTarget: null });
    expect(current().armedId).toBe('sam');
    expect(screen.getByRole('status')).toHaveTextContent('Press again to confirm: Remove Sam');

    fireEvent.focusOut(trigger, { relatedTarget: other });
    expect(current().armedId).toBeNull();
    expect(trigger).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('status').textContent).toBe('Confirmation cancelled.');
  });

  it('OW-2 (89.6-04): Escape disarms, says it, keeps focus on the control and claims the key', () => {
    const onConfirm = vi.fn();
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');

    trigger.focus();
    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    // fireEvent returns false when the handler called preventDefault: the key is claimed.
    expect(fireEvent.keyDown(trigger, { key: 'Escape' })).toBe(false);
    expect(current().armedId).toBeNull();
    expect(trigger).toHaveTextContent('Remove');
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('status').textContent).toBe('Confirmation cancelled.');
    // At rest the control claims nothing: Escape belongs to whatever is around it again.
    expect(fireEvent.keyDown(trigger, { key: 'Escape' })).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('OW-2 (89.6-04): a commit never says Confirmation cancelled., even when focus leaves during the commit', async () => {
    let settle!: () => void;
    const pendingCommit = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const onConfirm = vi.fn(() => pendingCommit);
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');
    const other = screen.getByTestId('other');

    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(current().pending).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('');

    // Focus leaves while the commit is still out, by every path a disarm could take.
    fireEvent.focusOut(trigger, { relatedTarget: other });
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.getByRole('status').textContent).toBe('');

    await act(async () => {
      settle();
      await pendingCommit;
    });
    expect(screen.getByRole('status').textContent).toBe('');
    advance(INLINE_RECEIPT_MS);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('OW-2b (89.6-04): the disarm words are the kebab\'s', () => {
    expect(DISARM_ANNOUNCEMENT).toBe('Confirmation cancelled.');
  });

  it('OW-2 (89.6-04): a press on another row disarms the first and its cancel words stay through the new arm until the live edge replaces them', () => {
    const onConfirm = vi.fn();
    function TwoRowHost() {
      const gate = useConfirmAction({ tier: 'two-tap', title: 'Remove?', confirmLabel: 'Remove', onConfirm });
      latest = gate;
      return React.createElement(
        'div',
        null,
        gate.statusNode,
        React.createElement(
          'button',
          { ...gate.triggerProps('a', 'Alex', 'Remove Alex'), 'data-testid': 'row-a' },
          gate.labelFor('a', 'Remove')
        ),
        React.createElement(
          'button',
          { ...gate.triggerProps('b', 'Bo', 'Remove Bo'), 'data-testid': 'row-b' },
          gate.labelFor('b', 'Remove')
        )
      );
    }
    render(React.createElement(TwoRowHost));
    const rowA = screen.getByTestId('row-a');
    const rowB = screen.getByTestId('row-b');
    const region = screen.getByRole('status');

    fireEvent.click(rowA);
    advance(CONFIRM_DELAY_MS);
    expect(rowA.textContent).toBe('Tap again');

    // The real pointer order on another row: the press, then the click.
    fireEvent.mouseDown(rowB);
    expect(current().armedId).toBeNull();
    expect(region.textContent).toBe('Confirmation cancelled.');
    fireEvent.click(rowB);
    expect(current().armedId).toBe('b');
    expect(rowB).toHaveTextContent('Wait (3)');
    expect(rowB).toHaveAttribute('aria-disabled', 'true');
    expect(rowA).not.toHaveAttribute('aria-pressed');
    // The first row's disarm is still said while the new row waits.
    expect(region.textContent).toBe('Confirmation cancelled.');
    advance(CONFIRM_DELAY_MS - 1);
    expect(region.textContent).toBe('Confirmation cancelled.');

    advance(1);
    expect(rowB.textContent).toBe('Tap again');
    expect(region.textContent).toBe('Press again to confirm: Remove Bo');
    // The receipt's own clear (4 s after the disarm) must not wipe the live words.
    advance(INLINE_RECEIPT_MS);
    expect(region.textContent).toBe('Press again to confirm: Remove Bo');
    expect(screen.getByRole('status')).toBe(region);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('OW-2 (89.6-04): the cancel words clear after INLINE_RECEIPT_MS, in the same node', () => {
    renderHost('two-tap');
    const trigger = screen.getByTestId('trigger');
    const region = screen.getByRole('status');

    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    fireEvent.mouseDown(document.body);
    expect(region.textContent).toBe('Confirmation cancelled.');
    advance(INLINE_RECEIPT_MS - 1);
    expect(region.textContent).toBe('Confirmation cancelled.');
    advance(1);
    // Cleared, so the hidden region is not left holding the words as a phantom swipe stop.
    expect(region.textContent).toBe('');
    expect(screen.getByRole('status')).toBe(region);
    expect(vi.getTimerCount()).toBe(0);

    // A disarm, then a re-arm before the receipt clears: the live edge clears it, so once the
    // control is armed and live no timer is pending.
    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    fireEvent.mouseDown(document.body);
    expect(region.textContent).toBe('Confirmation cancelled.');
    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    expect(trigger.textContent).toBe('Tap again');
    expect(region.textContent).toBe('Press again to confirm: Remove Sam');
    expect(vi.getTimerCount()).toBe(0);
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
    advance(60000);
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

    // Armed: through the gate and for as long as it stays live, for the armed target only.
    fireEvent.click(trigger);
    expect(current().reserveFor('sam')).toEqual(HELD);
    expect(current().reserveFor('alex')).toEqual([]);
    advance(CONFIRM_DELAY_MS);
    expect(current().reserveFor('sam')).toEqual(HELD);
    // OW-2 (89.6-04): the reserve ends when the row disarms, not at the end of a window.
    fireEvent.mouseDown(document.body);
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
    // ... and unmounting leaves no timer behind (the tick is the only one since 89.6-04).
    expect(vi.getTimerCount()).toBe(0);
    advance(10000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('A-55 (88.9-52, re-pinned 89.6-04): a re-arm of the same row in the turn it disarms starts a fresh gate', () => {
    // The disarm (an outside press, since 89.6-04 removed the window) and the re-arm land in ONE
    // act, so React commits them together and the armed row never renders as disarmed in between.
    // The countdown must still restart: the label reads Wait (3) and a press right after is
    // refused, not committed on the last arm's live state.
    const onConfirm = vi.fn();
    renderHost('two-tap', onConfirm);
    const trigger = screen.getByTestId('trigger');

    fireEvent.click(trigger);
    advance(CONFIRM_DELAY_MS);
    expect(trigger.textContent).toBe('Tap again');

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
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
    // OW-2 (89.6-04): an arm left alone costs nothing once live.
    advance(60000);
    expect(hostRenders - atRest, 'a minute live adds no render').toBe(4);
    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveTextContent('Remove');
    // The disarm is one render (the row disarms) plus the countdown's own reset to idle.
    expect(hostRenders - atRest, 'arm and disarm are the two renders every arm needs; the countdown adds 4').toBe(2 + 4);
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
      fireEvent.mouseDown(document.body);
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
