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

import { Modal } from '@/app/components/Modal';

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
  // The section heading, held in the fallback ref. null renders no heading.
  heading?: string | null;
  // With no heading: pass a fallback ref that nothing attaches (an unset ref) instead of none.
  unsetFallbackRef?: boolean;
}

// The KebabMenu shape (KebabMenu.js:237-239, item.onClick(); setOpen(false);
// restoreFocusToTrigger();): the action arms FIRST, focus is then put back on the row's
// trigger, the host awaits its mutation, and settles in finally. The End button stands in
// for a menu item, so it is not in the page tab order (tabIndex -1), as a closed menu's
// items are not.
function RowsHost({
  rows,
  mutate,
  afterSettle,
  heading = 'Check-ins',
  unsetFallbackRef = false,
}: RowsHostProps) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery(
    heading !== null || unsetFallbackRef ? { fallback: headingRef } : {}
  );
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
      {heading !== null ? <h3 ref={headingRef}>{heading}</h3> : null}
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

// The H1 shape (ManageMembers): a row list inside a REAL house Modal. Modal.Header renders a
// Radix DialogTitle, and DialogContent's aria-labelledby points at it, so the floor can reach the
// title without a ref into Modal.Header.
function MembersModal(props: Omit<RowsHostProps, 'heading'> & { bodyHeading?: string | null }) {
  const { bodyHeading = null, ...rest } = props;
  return (
    <Modal open onClose={() => {}}>
      <Modal.Header>Members</Modal.Header>
      <Modal.Body>
        <RowsHost {...rest} heading={bodyHeading} />
      </Modal.Body>
    </Modal>
  );
}

// End row A, resolve its mutation, then drop row A from the list.
async function endAndRemoveRowA(
  user: ReturnType<typeof userEvent.setup>,
  resolveNext: () => void,
  rerenderWithB: () => void
) {
  await user.click(screen.getByRole('button', { name: 'End A' }));
  await act(async () => {
    resolveNext();
  });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu for A' }));
  act(() => {
    rerenderWithB();
  });
}

describe('useFocusRecovery — the page floor as the last resort (task 2)', () => {
  it('D: inside a Modal with no fallback, a removed row hands focus to the dialog title, not the container', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const { rerender } = render(<MembersModal rows={['A', 'B']} mutate={mutate} />);
    const dialog = await screen.findByRole('dialog');

    await endAndRemoveRowA(user, resolveNext, () =>
      rerender(<MembersModal rows={['B']} mutate={mutate} />)
    );

    const title = screen.getByRole('heading', { name: 'Members' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(document.activeElement).not.toBe(dialog);
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  it('D-prime: Shift+Tab from the floored dialog title stays on the title, and the title keeps its added tabindex', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const page = (rows: string[]) => (
      <>
        <button type="button">Before the dialog</button>
        <MembersModal rows={rows} mutate={mutate} />
      </>
    );
    const { rerender } = render(page(['A', 'B']));
    await screen.findByRole('dialog');

    await endAndRemoveRowA(user, resolveNext, () => rerender(page(['B'])));
    const title = screen.getByRole('heading', { name: 'Members' });
    await waitFor(() => expect(document.activeElement).toBe(title));

    // Radix wraps only from its FIRST tabbable (react-focus-scope index.mjs:118) and the title
    // is tabindex -1, so Shift+Tab moves focus out and the trap pulls it straight back to the
    // last focused node (index.mjs:43). The measured limit, not a working Shift+Tab: the title
    // itself is asserted, which goes RED on a leak or a wrap.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  it('E: inside a Modal, a fallback heading in the body wins over the dialog title', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const { rerender } = render(
      <MembersModal rows={['A', 'B']} mutate={mutate} bodyHeading="Current members" />
    );
    await screen.findByRole('dialog');

    await endAndRemoveRowA(user, resolveNext, () =>
      rerender(<MembersModal rows={['B']} mutate={mutate} bodyHeading="Current members" />)
    );

    const bodyHeading = screen.getByRole('heading', { name: 'Current members' });
    await waitFor(() => expect(document.activeElement).toBe(bodyHeading));
  });

  it('F: outside any dialog with the fallback ref unset, the page main h1 takes focus', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const page = (rows: string[]) => (
      <main>
        <h1>Game night</h1>
        <RowsHost rows={rows} mutate={mutate} heading={null} unsetFallbackRef />
      </main>
    );
    const { rerender } = render(page(['A', 'B']));

    await endAndRemoveRowA(user, resolveNext, () => rerender(page(['B'])));

    const h1 = screen.getByRole('heading', { name: 'Game night' });
    await waitFor(() => expect(document.activeElement).toBe(h1));
  });
});
