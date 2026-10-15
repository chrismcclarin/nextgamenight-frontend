// useFocusRecovery — Requirement 5 (D-04, D-05): when an action removes the row a keyboard or
// screen-reader user stood on, focus goes to the host's target instead of falling to <body>.
//
// Test-file comments are line comments only (FE-TESTING-CONVENTIONS CF-9: a block comment that
// holds a backtick or a close-comment makes vite collect ZERO tests from this file while it
// still reports green). Every focus claim is an identity check against a NAMED node (C-5), and
// every wait is for a POSITIVE signal; an absence is asserted only after a deterministic flush,
// never inside waitFor (CF-26, P-6).
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '@/app/components/Modal';

import { useFocusRecovery, type FocusRecovery } from './useFocusRecovery';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
  // An unrelated status line (a toast or spinner stand-in), rendered above the list when set.
  status?: string;
  // Pass the activated control as arm({ from }) (the non-KebabMenu host, contract (1)).
  passFrom?: boolean;
  // Restore focus to the row trigger after arming (the KebabMenu shape). Default true.
  restoreTrigger?: boolean;
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
  status,
  passFrom = false,
  restoreTrigger = true,
}: RowsHostProps) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery(
    heading !== null || unsetFallbackRef ? { fallback: headingRef } : {}
  );
  const triggers = React.useRef(new Map<string, HTMLButtonElement>());

  const end = async (name: string, from: HTMLElement) => {
    const settle = recovery.arm(passFrom ? { from } : undefined);
    if (restoreTrigger) triggers.current.get(name)?.focus();
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
      {status ? <p>{status}</p> : null}
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
            <button type="button" tabIndex={-1} onClick={(event) => void end(name, event.currentTarget)}>
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

// Records every time the node takes focus, so "never took focus" is asserted, not inferred.
function focusSpy(el: HTMLElement) {
  const spy = vi.fn();
  el.addEventListener('focus', spy);
  return spy;
}

const flushMacrotask = () =>
  act(async () => {
    await macrotask();
  });

// Exposes the hook to the test, which arms it directly. Every row control is tabbable.
function ProbeHost({
  rows,
  onRecovery,
}: {
  rows: string[];
  onRecovery: (recovery: FocusRecovery) => void;
}) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery({ fallback: headingRef });
  onRecovery(recovery);
  return (
    <section>
      <h3 ref={headingRef}>Check-ins</h3>
      <ul>
        {rows.map((name) => (
          <li key={name}>
            <button type="button">Menu for {name}</button>
            <button type="button">End {name}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The H6 shape: each row opens a confirm Modal; Confirm arms, closes the Modal and settles. The
// row removal is test-controlled and comes later.
function DeleteHost({ rows }: { rows: string[] }) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery({ fallback: headingRef });
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const confirm = () => {
    const settle = recovery.arm();
    setConfirming(null);
    settle();
  };
  return (
    <section>
      <h3 ref={headingRef}>Game sessions</h3>
      <ul>
        {rows.map((name) => (
          <li key={name}>
            <button type="button" onClick={() => setConfirming(name)}>
              Delete {name}
            </button>
          </li>
        ))}
      </ul>
      <Modal open={confirming !== null} onClose={() => setConfirming(null)}>
        <Modal.Header>Delete this session?</Modal.Header>
        <Modal.Body>
          <button type="button" onClick={confirm}>
            Confirm
          </button>
        </Modal.Body>
      </Modal>
    </section>
  );
}

// The host whose own unmount IS the removal: the parent owns the heading and unmounts the child
// with its last row.
function ChildRows({
  rows,
  fallback,
  mutate,
  onEnded,
}: {
  rows: string[];
  fallback: React.RefObject<HTMLElement | null>;
  mutate: (name: string) => Promise<void>;
  onEnded: (name: string) => void;
}) {
  const recovery = useFocusRecovery({ fallback });
  const triggers = React.useRef(new Map<string, HTMLButtonElement>());
  const end = async (name: string) => {
    const settle = recovery.arm();
    triggers.current.get(name)?.focus();
    try {
      await mutate(name);
    } finally {
      settle();
    }
    onEnded(name);
  };
  return (
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
  );
}

function ParentOfChild({ initial, mutate }: { initial: string[]; mutate: (name: string) => Promise<void> }) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const [rows, setRows] = React.useState(initial);
  return (
    <section>
      <h3 ref={headingRef}>Check-ins</h3>
      {rows.length > 0 ? (
        <ChildRows
          rows={rows}
          fallback={headingRef}
          mutate={mutate}
          onEnded={(name) => setRows((current) => current.filter((row) => row !== name))}
        />
      ) : null}
    </section>
  );
}

// The KebabMenu shape with a SYNCHRONOUS settle (KebabMenu.js:237-239 and :268-269): the item's
// handler arms, schedules a local-state removal and settles with no await; then the menu restores
// focus to the row trigger in the same task; then the row unmounts.
function SyncKebabHost({ initial }: { initial: string[] }) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery({ fallback: headingRef });
  const [rows, setRows] = React.useState(initial);
  const triggers = React.useRef(new Map<string, HTMLButtonElement>());
  const end = (name: string) => {
    const settle = recovery.arm();
    setRows((current) => current.filter((row) => row !== name));
    settle();
    triggers.current.get(name)?.focus();
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
            <button type="button" tabIndex={-1} onClick={() => end(name)}>
              End {name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Arm on FOCUS and settle at once (plans 37, 69, 70): watch a control an unpressed refresh can
// remove.
function FocusArmHost({ showControl }: { showControl: boolean }) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const recovery = useFocusRecovery({ fallback: headingRef });
  const watchFocus = () => {
    const settle = recovery.arm();
    settle();
  };
  return (
    <section>
      <h3 ref={headingRef}>Your name</h3>
      {showControl ? <input aria-label="Display name" onFocus={watchFocus} /> : null}
    </section>
  );
}

describe('useFocusRecovery — never yank, defer to a dialog, survive unmount (task 3)', () => {
  it('G: a user who blurred to blank space is not moved when the row is later removed', async () => {
    const user = userEvent.setup();
    const { mutate } = deferredMutation();
    const { rerender } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);
    const headingFocus = focusSpy(screen.getByRole('heading', { name: 'Check-ins' }));

    await user.click(screen.getByRole('button', { name: 'End A' }));
    const triggerA = screen.getByRole('button', { name: 'Menu for A' });
    expect(document.activeElement).toBe(triggerA);
    act(() => triggerA.blur());
    // ONE macrotask: the real gap between a click on blank space and a refetch commit.
    await flushMacrotask();

    act(() => rerender(<RowsHost rows={['A', 'B']} mutate={mutate} status="Saved" />));
    act(() => rerender(<RowsHost rows={['B']} mutate={mutate} status="Saved" />));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Menu for A' })).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(headingFocus).not.toHaveBeenCalled();
  });

  it('G2: blur to blank space, then the removal as the FIRST mutation, still moves nobody', async () => {
    const user = userEvent.setup();
    const { mutate } = deferredMutation();
    const { rerender } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);
    const headingFocus = focusSpy(screen.getByRole('heading', { name: 'Check-ins' }));

    await user.click(screen.getByRole('button', { name: 'End A' }));
    const triggerA = screen.getByRole('button', { name: 'Menu for A' });
    act(() => triggerA.blur());
    await flushMacrotask();

    act(() => rerender(<RowsHost rows={['B']} mutate={mutate} />));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Menu for A' })).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(headingFocus).not.toHaveBeenCalled();
  });

  it('H: after settle, a move from one live control to another disarms the hook', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const { rerender } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);
    const headingFocus = focusSpy(screen.getByRole('heading', { name: 'Check-ins' }));

    await user.click(screen.getByRole('button', { name: 'End A' }));
    await act(async () => {
      resolveNext();
    });
    // settle() takes effect one macrotask after the call.
    await flushMacrotask();
    await user.tab();
    const triggerB = screen.getByRole('button', { name: 'Menu for B' });
    expect(document.activeElement).toBe(triggerB);

    act(() => rerender(<RowsHost rows={['B']} mutate={mutate} />));
    await act(async () => {});
    expect(document.activeElement).toBe(triggerB);

    act(() => rerender(<RowsHost rows={[]} mutate={mutate} />));
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
    expect(headingFocus).not.toHaveBeenCalled();
  });

  it('J: a closing dialog restores to its opener first; the hook follows and recovers when the opener is removed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DeleteHost rows={['A', 'B']} />);
    const heading = screen.getByRole('heading', { name: 'Game sessions' });
    const deleteA = screen.getByRole('button', { name: 'Delete A' });

    await user.click(deleteA);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The Modal's 88.6-44 restore, not the fallback.
    await waitFor(() => expect(document.activeElement).toBe(deleteA));

    act(() => rerender(<DeleteHost rows={['B']} />));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('K: a host whose own unmount IS the removal still hands focus to the parent heading', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    render(<ParentOfChild initial={['A']} mutate={mutate} />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });

    await user.click(screen.getByRole('button', { name: 'End A' }));
    await act(async () => {
      resolveNext();
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole('button', { name: 'Menu for A' })).toBeNull();
  });

  it('L: unmounting an armed host disconnects the observer and removes both document listeners', async () => {
    const user = userEvent.setup();
    const { mutate } = deferredMutation();
    const { unmount } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);
    await user.click(screen.getByRole('button', { name: 'End A' }));

    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    unmount();
    await act(async () => {});
    expect(disconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('focusin', expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith('focusout', expect.any(Function), true);
  });

  it('M: re-arming replaces the intent, and a replaced arm settle does not settle the new arm', async () => {
    const user = userEvent.setup();
    let recovery!: FocusRecovery;
    const capture = (r: FocusRecovery) => {
      recovery = r;
    };
    const { rerender } = render(<ProbeHost rows={['A', 'B', 'C']} onRecovery={capture} />);
    const byName = (name: string) => () => screen.queryByRole('button', { name });
    act(() => screen.getByRole('button', { name: 'Menu for A' }).focus());

    let settleFirst!: () => void;
    act(() => {
      settleFirst = recovery.arm({ preferred: byName('End B') });
      recovery.arm({ preferred: byName('End C') });
    });
    act(() => settleFirst());
    // The flush makes the id guard, not the settle deferral, what keeps the second arm unsettled.
    await flushMacrotask();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End A' }));

    act(() => rerender(<ProbeHost rows={['B', 'C']} onRecovery={capture} />));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End C' })));
  });

  it('N: it acts once; after recovering, a later removal of another focused control moves nothing', async () => {
    const user = userEvent.setup();
    const { mutate, resolveNext } = deferredMutation();
    const { rerender } = render(<RowsHost rows={['A', 'B']} mutate={mutate} />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });

    await user.click(screen.getByRole('button', { name: 'End A' }));
    await act(async () => {
      resolveNext();
    });
    act(() => rerender(<RowsHost rows={['B']} mutate={mutate} />));
    await waitFor(() => expect(document.activeElement).toBe(heading));

    act(() => screen.getByRole('button', { name: 'Menu for B' }).focus());
    act(() => rerender(<RowsHost rows={[]} mutate={mutate} />));
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });

  it('O1: a preferred resolver that returns a connected element wins over the fallback', async () => {
    let recovery!: FocusRecovery;
    const capture = (r: FocusRecovery) => {
      recovery = r;
    };
    const { rerender } = render(<ProbeHost rows={['A', 'B']} onRecovery={capture} />);
    act(() => screen.getByRole('button', { name: 'Menu for A' }).focus());
    act(() => {
      recovery.arm({ preferred: () => screen.queryByRole('button', { name: 'End B' }) });
    });
    act(() => rerender(<ProbeHost rows={['B']} onRecovery={capture} />));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End B' })));
  });

  it('O2: a preferred resolver that returns null falls through to the fallback', async () => {
    let recovery!: FocusRecovery;
    const capture = (r: FocusRecovery) => {
      recovery = r;
    };
    const { rerender } = render(<ProbeHost rows={['A', 'B']} onRecovery={capture} />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });
    act(() => screen.getByRole('button', { name: 'Menu for A' }).focus());
    act(() => {
      recovery.arm({ preferred: () => null });
    });
    act(() => rerender(<ProbeHost rows={['B']} onRecovery={capture} />));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('O3: a preferred resolver that returns a detached node falls through to the fallback', async () => {
    let recovery!: FocusRecovery;
    const capture = (r: FocusRecovery) => {
      recovery = r;
    };
    const { rerender } = render(<ProbeHost rows={['A', 'B']} onRecovery={capture} />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });
    const detached = document.createElement('button');
    act(() => screen.getByRole('button', { name: 'Menu for A' }).focus());
    act(() => {
      recovery.arm({ preferred: () => detached });
    });
    act(() => rerender(<ProbeHost rows={['B']} onRecovery={capture} />));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('P: a synchronous settle followed by the KebabMenu restore in the same task still recovers', async () => {
    const user = userEvent.setup();
    render(<SyncKebabHost initial={['A', 'B']} />);
    const heading = screen.getByRole('heading', { name: 'Check-ins' });

    await user.click(screen.getByRole('button', { name: 'End A' }));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole('button', { name: 'Menu for A' })).toBeNull();
  });

  it('Q: the from seed (Safari never focuses a clicked button) still recovers from <body>', async () => {
    const { mutate, resolveNext } = deferredMutation();
    const host = (rows: string[]) => (
      <RowsHost rows={rows} mutate={mutate} passFrom restoreTrigger={false} />
    );
    const { rerender } = render(host(['A', 'B']));
    const heading = screen.getByRole('heading', { name: 'Check-ins' });

    // fireEvent.click moves no focus: the Safari click shape.
    fireEvent.click(screen.getByRole('button', { name: 'End A' }));
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      resolveNext();
    });
    act(() => rerender(host(['B'])));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('Q2: with the from seed, an unrelated mutation first (a toast) does not disarm; the removal still recovers', async () => {
    const { mutate, resolveNext } = deferredMutation();
    const host = (rows: string[], status?: string) => (
      <RowsHost rows={rows} mutate={mutate} passFrom restoreTrigger={false} status={status} />
    );
    const { rerender } = render(host(['A', 'B']));
    const heading = screen.getByRole('heading', { name: 'Check-ins' });

    fireEvent.click(screen.getByRole('button', { name: 'End A' }));
    await act(async () => {
      resolveNext();
    });
    act(() => rerender(host(['A', 'B'], 'Saved')));
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
    act(() => rerender(host(['B'], 'Saved')));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('U (GREEN at birth): armed and settled on FOCUS, an unpressed refresh that removes the control still recovers', async () => {
    const { rerender } = render(<FocusArmHost showControl />);
    const heading = screen.getByRole('heading', { name: 'Your name' });
    act(() => screen.getByRole('textbox', { name: 'Display name' }).focus());

    act(() => rerender(<FocusArmHost showControl={false} />));
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
