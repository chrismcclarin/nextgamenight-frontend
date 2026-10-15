// useFocusRecovery — Requirement 5 (D-04, D-05): when an action removes the row a keyboard or
// screen-reader user stood on, focus goes to the host's target instead of falling to <body>.
//
// Test-file comments are line comments only (FE-TESTING-CONVENTIONS CF-9: a block comment that
// holds a backtick or a close-comment makes vite collect ZERO tests from this file while it
// still reports green). Every focus claim is an identity check against a NAMED node (C-5), and
// every wait is for a POSITIVE signal; an absence is asserted only after a deterministic flush,
// never inside waitFor (CF-26, P-6).
import * as React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { useFocusRecovery } from './useFocusRecovery';

afterEach(() => cleanup());

// A test-controlled "mutation": each call returns a promise the test resolves by hand.
function deferredMutation() {
  const pending: Array<() => void> = [];
  const mutate = () =>
    new Promise<void>((resolve) => {
      pending.push(resolve);
    });
  const resolveNext = () => {
    const next = pending.shift();
    if (!next) throw new Error('no mutation in flight');
    next();
  };
  return { mutate, resolveNext };
}

// One macrotask: the gap between an awaited promise and a TanStack commit
// (notifyManager's systemSetTimeoutZero scheduler).
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface RowsHostProps {
  rows: string[];
  mutate: (name: string) => Promise<void>;
  // Runs after settle(), in the same continuation as the host's own work.
  afterSettle?: (name: string) => void;
}

// The KebabMenu shape (KebabMenu.js:237-239, item.onClick(); setOpen(false);
// restoreFocusToTrigger();): the action arms FIRST, focus is then put back on the row's
// trigger, the host awaits its mutation, and settles in finally. The End button stands in
// for a menu item, so it is not in the page tab order (tabIndex -1), as a closed menu's
// items are not.
function RowsHost({ rows, mutate, afterSettle }: RowsHostProps) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery({ fallback: headingRef });
  const triggers = React.useRef(new Map<string, HTMLButtonElement>());

  const end = async (name: string) => {
    const settle = recovery.arm();
    triggers.current.get(name)?.focus();
    try {
      await mutate(name);
    } finally {
      settle();
    }
    afterSettle?.(name);
  };

  return (
    <section>
      <h3 ref={headingRef}>Check-ins</h3>
      <ul>
        {rows.map((name) => (
          <li key={name}>
            <button
              type="button"
              ref={(node) => {
                if (node) triggers.current.set(name, node);
                else triggers.current.delete(name);
              }}
            >
              Menu for {name}
            </button>
            <button type="button" tabIndex={-1} onClick={() => void end(name)}>
              End {name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Holds the rows in state, so the host's own handler can remove a row the way a refetch does.
function StatefulRows({
  initial,
  mutate,
  removeAfterSettle,
}: {
  initial: string[];
  mutate: (name: string) => Promise<void>;
  removeAfterSettle?: 'macrotask';
}) {
  const [rows, setRows] = React.useState(initial);
  const afterSettle = removeAfterSettle
    ? (name: string) => {
        // The TanStack shape: the commit that drops the row lands one macrotask after the
        // awaited work resolves (notifyManager.js:3, systemSetTimeoutZero).
        setTimeout(() => setRows((current) => current.filter((row) => row !== name)), 0);
      }
    : undefined;
  return <RowsHost rows={rows} mutate={mutate} afterSettle={afterSettle} />;
}

describe('useFocusRecovery — the tracer path (task 1)', () => {
  it('Test 1: a row removed AFTER settle hands focus to the host heading, and nothing moves before the removal', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const { rerender } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });
    expect(heading.hasAttribute('tabindex')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'End A' }));
    const triggerA = screen.getByRole('button', { name: 'Menu for A' });
    await act(async () => {
      resolveNext();
    });

    // The R5 ordering backstop: the row is still mounted, so the restored trigger keeps focus
    // after settle(). A settle-time focus (await-then-focus) fails exactly here.
    expect(document.activeElement).toBe(triggerA);

    act(() => {
      rerender(<RowsHost rows={['B']} mutate={mutate} />);
    });

    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('Test 2: the TanStack shape — the removal commits one macrotask after settle, and focus still reaches the heading', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    render(<StatefulRows initial={['A', 'B']} mutate={mutate} removeAfterSettle="macrotask" />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });

    await user.click(screen.getByRole('button', { name: 'End A' }));
    await act(async () => {
      resolveNext();
      await macrotask();
    });

    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole('button', { name: 'Menu for A' })).toBeNull();
  });

  it('Test 3: a removal that does not take the watched element leaves focus where it is', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const { rerender } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);

    await user.click(screen.getByRole('button', { name: 'End A' }));
    const triggerA = screen.getByRole('button', { name: 'Menu for A' });
    await act(async () => {
      resolveNext();
    });
    expect(document.activeElement).toBe(triggerA);

    act(() => {
      rerender(<RowsHost rows={['A']} mutate={mutate} />);
    });
    // A deterministic flush (the observer's microtask), then a synchronous check — never a
    // waitFor around an absence.
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Menu for B' })).toBeNull();
    expect(document.activeElement).toBe(triggerA);
  });
});
