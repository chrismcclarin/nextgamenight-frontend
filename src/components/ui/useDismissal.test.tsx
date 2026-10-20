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
import { render, renderHook, screen, fireEvent } from '@testing-library/react';

import { useDismissal } from './useDismissal';

// The ancestor spy is the KM-6 discriminator: a React onKeyDown ABOVE the host's container. It sees
// a key only when the hook did not claim it.
function Harness({
  onDismiss,
  initialOpen = false,
  onAncestorKeyDown,
}: {
  onDismiss: () => void;
  initialOpen?: boolean;
  onAncestorKeyDown?: (event: React.KeyboardEvent) => void;
}) {
  const [open, setOpen] = React.useState(initialOpen);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const { containerProps } = useDismissal({
    open,
    onDismiss: () => {
      onDismiss();
      setOpen(false);
    },
    containerRef,
    triggerRef,
  });
  return (
    <div onKeyDown={onAncestorKeyDown}>
      <div ref={containerRef} data-testid="container" {...containerProps}>
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
    </div>
  );
}

function openHarness() {
  const trigger = screen.getByRole('button', { name: 'Trigger' });
  fireEvent.click(trigger);
  const inside = screen.getByRole('button', { name: 'Inside' });
  inside.focus();
  expect(inside, 'focus is established on the inside control first').toHaveFocus();
  return { trigger, inside };
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

// fireEvent returns the dispatchEvent result: false means the event was default-prevented.
describe('useDismissal Escape — a React container handler that claims the key only when it acts (P-10)', () => {
  it('E1. host OPEN: Escape dismisses once, is default-prevented, never reaches the ancestor, and focus returns to the trigger', () => {
    const onDismiss = vi.fn();
    const ancestor = vi.fn();
    render(<Harness onDismiss={onDismiss} onAncestorKeyDown={ancestor} />);
    const { trigger, inside } = openHarness();

    const notPrevented = fireEvent.keyDown(inside, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(notPrevented, 'the claimed Escape is default-prevented').toBe(false);
    expect(ancestor).not.toHaveBeenCalled();
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('E2. ANTI-VACUITY, host CLOSED: Escape is not claimed, so the ancestor sees it un-prevented', () => {
    const onDismiss = vi.fn();
    const ancestor = vi.fn();
    render(<Harness onDismiss={onDismiss} onAncestorKeyDown={ancestor} />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();

    const notPrevented = fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(ancestor).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(true);
  });

  it('E3. SPEC Edge R6 idempotency: Escape closes once, and a SECOND Escape is inert and reaches the ancestor', () => {
    const onDismiss = vi.fn();
    const ancestor = vi.fn();
    render(<Harness onDismiss={onDismiss} onAncestorKeyDown={ancestor} />);
    const { trigger, inside } = openHarness();

    expect(fireEvent.keyDown(inside, { key: 'Escape' })).toBe(false);
    expect(trigger).toHaveFocus();
    expect(ancestor).not.toHaveBeenCalled();

    // Delivered where focus really is, after the first press closed the host.
    const second = fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(ancestor).toHaveBeenCalledTimes(1);
    expect(second, 'the second press is not claimed').toBe(true);
  });

  it('E4. host OPEN, a non-Escape key: no dismissal, not prevented, and the ancestor sees it', () => {
    const onDismiss = vi.fn();
    const ancestor = vi.fn();
    render(<Harness onDismiss={onDismiss} onAncestorKeyDown={ancestor} />);
    const { inside } = openHarness();

    const notPrevented = fireEvent.keyDown(inside, { key: 'Enter' });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
    expect(ancestor).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  // E5 models PRODUCTION. Next 14's app router hydrates React on the document itself (next 14.2.35,
  // the package's dist/client/app-index.js sets its app element to document), so Header's document
  // keydown listener sits on the SAME node as React's root listeners and is registered after them.
  // In jsdom, Testing Library's root is its container div, so a listener put on the document here
  // would be stopped by React's stopPropagation and would report the opposite of production. The
  // production position is modelled instead: a native bubble listener on the React ROOT node,
  // added after render, so it is the same node and later in registration order.
  it('E5. a same-node listener registered after React STILL runs on a claimed Escape, and sees it default-prevented', () => {
    const seen: boolean[] = [];
    const sameNode = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') seen.push(event.defaultPrevented);
    };

    const { container } = render(<Harness onDismiss={vi.fn()} />);
    container.addEventListener('keydown', sameNode);
    try {
      const { inside } = openHarness();
      fireEvent.keyDown(inside, { key: 'Escape' });
      expect(seen, 'stopPropagation cannot stop a same-node listener; it reads defaultPrevented').toEqual([
        true,
      ]);
    } finally {
      container.removeEventListener('keydown', sameNode);
    }
  });

  it('E5b. ANTI-VACUITY: with the host CLOSED the same-node listener runs and sees defaultPrevented false', () => {
    const seen: boolean[] = [];
    const sameNode = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') seen.push(event.defaultPrevented);
    };

    const { container } = render(<Harness onDismiss={vi.fn()} />);
    container.addEventListener('keydown', sameNode);
    try {
      const trigger = screen.getByRole('button', { name: 'Trigger' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(seen).toEqual([false]);
    } finally {
      container.removeEventListener('keydown', sameNode);
    }
  });
});

describe('useDismissal focusout — only a non-null relatedTarget outside the container dismisses', () => {
  it('F1. host OPEN, focus moves to an OUTSIDE control: dismiss once', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const { inside } = openHarness();

    fireEvent.focusOut(inside, { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('F2. a NULL relatedTarget never dismisses', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const { inside } = openHarness();

    fireEvent.focusOut(inside, { relatedTarget: null });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('F3. focus moving to the TRIGGER (inside the container) does not dismiss', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const { trigger, inside } = openHarness();

    fireEvent.focusOut(inside, { relatedTarget: trigger });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('F4. host CLOSED: a focusout to an outside control calls nothing', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.focusOut(trigger, { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('useDismissal restoreFocusToTrigger — focuses the trigger only while it is connected', () => {
  function hookWith(trigger: HTMLElement | null) {
    return renderHook(() =>
      useDismissal({
        open: false,
        onDismiss: vi.fn(),
        containerRef: { current: null },
        triggerRef: { current: trigger },
      }),
    );
  }

  it('R1. a CONNECTED trigger receives focus', () => {
    const button = document.createElement('button');
    button.textContent = 'Connected trigger';
    document.body.appendChild(button);
    try {
      const { result } = hookWith(button);
      result.current.restoreFocusToTrigger();
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  it('R2. a DETACHED trigger is never focused, and nothing throws', () => {
    const button = document.createElement('button');
    expect(button.isConnected).toBe(false);
    // The spy is the discriminator: jsdom ignores focus on a detached node anyway, so the
    // activeElement half alone could not tell a guarded restore from an unguarded one.
    const focus = vi.spyOn(button, 'focus');
    const { result } = hookWith(button);

    expect(() => result.current.restoreFocusToTrigger()).not.toThrow();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(button);
  });

  it('R3. a NULL trigger does not throw', () => {
    const { result } = hookWith(null);
    expect(() => result.current.restoreFocusToTrigger()).not.toThrow();
  });
});

// Imports for the plan 88.6.1-80 describe, kept with it so plan 05's arms above stay byte-unchanged
// (ES imports are hoisted, so their position does not change evaluation order).
import { act, waitFor, within } from '@testing-library/react';
import { Modal } from '@/app/components/Modal';

// Plan 88.6.1-80 (D-18): a modal dialog that is open and does NOT contain the container is a layer
// ABOVE the surface. The dialog here is the REAL house Modal, rendered as a SIBLING of the host
// (outside its component tree), the shape of the report form that FeedbackModalProvider hosts at
// the layout root (plan 88.6.1-69). A test-controlled flag opens it.
const layerControls: { openDialog: () => void } = { openDialog: () => undefined };

function LayerHarness({ onDismiss }: { onDismiss: () => void }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  layerControls.openDialog = () => setDialogOpen(true);
  return (
    <>
      <Harness onDismiss={onDismiss} />
      <Modal open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <Modal.Header>Form</Modal.Header>
        <Modal.Body>
          <label>
            First field
            <input type="text" />
          </label>
          <label>
            Second field
            <input type="text" />
          </label>
        </Modal.Body>
      </Modal>
    </>
  );
}

// The host INSIDE an open dialog (the kebab-in-a-dialog shape): that dialog CONTAINS the container,
// so it is below the host, not above it.
function HostInsideDialog({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Modal open onClose={() => undefined}>
      <Modal.Header>Holder</Modal.Header>
      <Modal.Body>
        <Harness onDismiss={onDismiss} />
        <button type="button">Other control in the dialog</button>
      </Modal.Body>
    </Modal>
  );
}

async function nextMacrotask() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function underPointer(overlay: HTMLElement): HTMLElement {
  return overlay.isConnected ? overlay : document.body;
}

function overlayOf(dialog: HTMLElement) {
  const overlay = dialog.previousElementSibling as HTMLElement | null;
  expect(overlay, 'the dimmed overlay renders just before the dialog content').not.toBeNull();
  expect(overlay!.contains(dialog)).toBe(false);
  return overlay as HTMLElement;
}

describe('useDismissal — a modal dialog above the surface (plan 88.6.1-80, D-18)', () => {
  it('L6. focus moving into an open dialog above, and a press inside it, never dismiss the surface', async () => {
    const onDismiss = vi.fn();
    render(<LayerHarness onDismiss={onDismiss} />);
    openHarness();

    act(() => layerControls.openDialog());
    const dialog = await screen.findByRole('dialog', { name: 'Form' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(within(dialog).getByRole('textbox', { name: 'First field' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('L7. the boundary: a dialog that CONTAINS the host is below it, so focus leaving the host for another control in it still dismisses', async () => {
    const onDismiss = vi.fn();
    render(<HostInsideDialog onDismiss={onDismiss} />);
    const dialog = await screen.findByRole('dialog', { name: 'Holder' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trigger' }));
    const inside = within(dialog).getByRole('button', { name: 'Inside' });
    inside.focus();
    expect(inside).toHaveFocus();

    within(dialog).getByRole('button', { name: 'Other control in the dialog' }).focus();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('L8. a press on the dialog overlay belongs to the dialog: the real primary-button sequence closes the dialog alone, and the rule ends with the dialog', async () => {
    const onDismiss = vi.fn();
    render(<LayerHarness onDismiss={onDismiss} />);
    openHarness();
    act(() => layerControls.openDialog());
    const dialog = await screen.findByRole('dialog', { name: 'Form' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const overlay = overlayOf(dialog);

    // First half: the hook's press handler alone, on the overlay.
    fireEvent.mouseDown(overlay);
    expect(onDismiss).not.toHaveBeenCalled();

    // The real press sequence (review #92), once Radix's outside-press listener is registered (it
    // is added one macrotask after the layer mounts). A primary press is deferred by Radix to the
    // click, so the hook's mousedown still finds the dialog open. The mousedown and click go where a
    // browser's hit test would send them: the overlay while it is still in the document, else the
    // page beneath (a detached node's event never reaches the document). Fired with button 1
    // instead, Radix dismisses at pointerdown, the overlay is gone, and the surface closes too: the
    // residual recorded in the hook's marker.
    await nextMacrotask();
    fireEvent.pointerDown(overlay, { button: 0 });
    fireEvent.mouseDown(underPointer(overlay), { button: 0 });
    fireEvent.click(underPointer(overlay), { button: 0 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Form' })).toBeNull());
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    // The dialog is gone: an ordinary outside press dismisses again.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
