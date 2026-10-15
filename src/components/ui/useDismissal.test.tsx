// useDismissal: the ONE shared dismissal hook (Phase 88.6.1-05, D-18), extracted from KebabMenu.
//
// Every comment in this file is a line comment on purpose (FE-TESTING-CONVENTIONS CF-9: a block
// comment carrying a backtick or a closing delimiter makes the collector report zero tests while
// the file still reads green).
//
// The harness holds REAL open state, the way both consumers do: the HOST owns `open`, and the hook
// only ever asks the host to dismiss. Its onDismiss calls the spy the test passes, then closes.
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useDismissal } from './useDismissal';

function Harness({
  onDismiss,
  initialOpen = false,
}: {
  onDismiss: () => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(initialOpen);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  useDismissal({
    open,
    onDismiss: () => {
      onDismiss();
      setOpen(false);
    },
    containerRef,
    triggerRef,
  });
  return (
    <>
      <div ref={containerRef} data-testid="container">
        <button type="button" ref={triggerRef} onClick={() => setOpen((prev) => !prev)}>
          Trigger
        </button>
        {open ? (
          <div data-testid="panel">
            <button type="button">Inside</button>
          </div>
        ) : null}
      </div>
      <button type="button">Outside</button>
    </>
  );
}

function mousedownCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((call) => call[0] === 'mousedown');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDismissal outside pointer — registered only while the host is open (D-18)', () => {
  it('P1. a CLOSED host registers zero document mousedown listeners, and an outside mousedown calls nothing', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);

    expect(mousedownCalls(add)).toHaveLength(0);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('P2. an OPEN host registers exactly one; outside dismisses once, trigger and inside do not', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    expect(mousedownCalls(add)).toHaveLength(1);

    // The two INSIDE presses first, each with the panel still present afterwards.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('P3. closing removes the SAME function that was added, and a later outside press calls nothing', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.click(trigger);
    const [added] = mousedownCalls(add);
    expect(added, 'one listener was registered on open').toBeDefined();

    // Close through the host's own toggle, so the removal is the effect cleanup and not the
    // handler's own dismissal.
    fireEvent.click(trigger);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();

    const removed = mousedownCalls(remove);
    expect(removed).toHaveLength(1);
    expect(removed[0][1], 'the cleanup removes the very function it added').toBe(added[1]);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('P4. a re-render with a NEW onDismiss is honoured, and the registration count stays 1', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onDismiss={first} initialOpen />);
    expect(mousedownCalls(add)).toHaveLength(1);

    rerender(<Harness onDismiss={second} initialOpen />);
    // The effect depends on `open` only, so a new callback never re-registers.
    expect(mousedownCalls(add)).toHaveLength(1);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first, 'a stale callback captured at registration time would fire here').not.toHaveBeenCalled();
  });

  it('P5. unmounting while OPEN removes the listener', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const onDismiss = vi.fn();
    const { unmount } = render(<Harness onDismiss={onDismiss} initialOpen />);
    const [added] = mousedownCalls(add);
    expect(added).toBeDefined();

    unmount();

    const removed = mousedownCalls(remove);
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[1]);
  });
});
