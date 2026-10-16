// Behaviour + a11y pins for the phone `BottomSheet` primitive
// (Req 11a / 11b, 88.1 D-05, UI-SPEC §S5).
//
// The contract these lock, in order of how badly a regression would hurt:
//   1. The open sheet has an ACCESSIBLE NAME. Radix requires a DialogTitle, but
//      RESEARCH A2 could not confirm the dev-time warning fires in the installed
//      production dist — so a dropped title may fail SILENTLY, leaving a modal a
//      screen-reader user cannot identify. Asserted directly, never inferred
//      from a console warning.
//   2. Every dismiss path works: Esc, the close button, and (E2E-only) an
//      outside tap. A modal with no way out is WCAG 2.1.2 No Keyboard Trap.
//   3. Focus enters the sheet on open and is RESTORED to the invoker on close —
//      the keyboard user's place in the page is not lost.
//   4. axe-clean while open (the fleet was 0/16 before Radix — the "0/16 on axe"
//      sentence in `Modal.tsx`'s docblock).
//   5. NO gesture affordance (D-05) — dismissal is the three explicit paths, and
//      no drag handle is ever advertised to assistive tech.
//
// Geometry (height, viewport units, scroll) is deliberately NOT pinned here: it
// is P7 and belongs to the phone Playwright spec in plan 88.1-10. jsdom has no
// layout, so a geometry assertion here would be theatre.
import * as React from 'react';
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { BottomSheet } from './BottomSheet';

afterEach(cleanup);

const TITLE = 'Upcoming events';

// Controlled harness with a real invoker button, following the
// `Modal.test.tsx` render-helper idiom. The trigger is a plain button (not
// `DialogTrigger`) because that is how the one shipped consumer
// (`UserHomePage.js`, the Calendar sheet) mounts the sheet — and because focus
// restore must be proven against the element that actually had focus, not
// against a Radix-managed trigger.
function SheetHarness({
  onClose,
  ...props
}: Partial<React.ComponentProps<typeof BottomSheet>> & {
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        title={TITLE}
        {...props}
      >
        <p>Poker night, Thursday</p>
      </BottomSheet>
    </div>
  );
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open sheet' }));
  return screen.getByRole('dialog', { name: TITLE });
}

describe('BottomSheet', () => {
  it('exposes an accessible name from its DialogTitle', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    // Asserted DIRECTLY (A2): a missing title would not necessarily warn.
    const sheet = await openSheet(user);
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveAttribute('aria-modal', 'true');

    const labelledby = sheet.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(screen.getByText(TITLE)).toHaveAttribute(
      'id',
      labelledby as string
    );
  });

  it('closes on Escape and reports it through onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);

    await openSheet(user);
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
    );
  });

  it('closes from a control whose accessible name is "Close"', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);

    await openSheet(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
    );
  });

  it('moves focus into the sheet on open and restores it to the invoker on close', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    const invoker = screen.getByRole('button', { name: 'Open sheet' });
    const sheet = await openSheet(user);

    await waitFor(() =>
      expect(sheet).toContainElement(document.activeElement as HTMLElement)
    );

    await user.keyboard('{Escape}');

    await waitFor(() => expect(invoker).toHaveFocus());
  });

  it('passes an axe audit while open', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    const sheet = await openSheet(user);
    expect(await axe(sheet)).toHaveNoViolations();
  });

  it('advertises no gesture affordance (D-05: dismissal is Esc / close / outside tap only)', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    const sheet = await openSheet(user);

    // No handle is named to assistive tech under any of the idioms a sheet
    // library would use for one.
    expect(
      screen.queryByRole('slider', { name: /handle|grabber|resize|sheet/i })
    ).toBeNull();
    expect(
      screen.queryByRole('separator', { name: /handle|grabber|drag/i })
    ).toBeNull();
    expect(screen.queryByLabelText(/drag|grabber|pull|swipe/i)).toBeNull();

    // The only control the primitive itself renders is Close — no second,
    // unnamed affordance is sitting in the chrome.
    const controls = Array.from(sheet.querySelectorAll('button'));
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName('Close');
  });

  it('renders the caller content inside the sheet', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);

    const sheet = await openSheet(user);
    expect(sheet).toContainElement(screen.getByText('Poker night, Thursday'));
  });
});

// Phase 88.6.1-20 (N6 / D-07, AC-15): the sheet now runs the SAME shared close-restore as
// `Modal` (`restoreDialogFocus` in `dialog.tsx`). MEASURED before the fix: an invoker that was
// removed or disabled, a chained sheet, and ANY consumer `onCloseAutoFocus` that did not prevent
// default (it REPLACED the restore) all left focus on <body>. Landings are asserted by identity;
// the heading is captured before the sheet opens (Radix hides the page from AT while open).
describe('BottomSheet focus floor on close (N6, 88.6.1-20)', () => {
  function FloorHost({
    invokerDisabled = false,
    onCloseAutoFocus,
  }: {
    invokerDisabled?: boolean;
    onCloseAutoFocus?: (event: Event) => void;
  }) {
    const [open, setOpen] = React.useState(false);
    const [removed, setRemoved] = React.useState(false);
    return (
      <main>
        <h1>Home</h1>
        {!removed && (
          <button type="button" disabled={invokerDisabled} onClick={() => setOpen(true)}>
            Open sheet
          </button>
        )}
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title={TITLE}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <button
            type="button"
            onClick={() => {
              setRemoved(true);
              setOpen(false);
            }}
          >
            Hide the bar
          </button>
        </BottomSheet>
      </main>
    );
  }

  it('S1: the invoker was removed with the sheet, so focus lands on the page h1', async () => {
    const user = userEvent.setup();
    render(<FloorHost />);
    const heading = screen.getByRole('heading', { name: 'Home' });
    await openSheet(user);
    await user.click(screen.getByRole('button', { name: 'Hide the bar' }));
    expect(screen.queryByRole('button', { name: 'Open sheet', hidden: true })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('S2: the invoker was disabled while open, so focus lands on the page h1', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FloorHost />);
    const heading = screen.getByRole('heading', { name: 'Home' });
    const invoker = screen.getByRole('button', { name: 'Open sheet' });
    await openSheet(user);
    // No `tabindex` on the invoker: jsdom focuses a disabled control that carries one.
    rerender(<FloorHost invokerDisabled />);
    expect(invoker).toBeDisabled();
    expect(invoker).not.toHaveAttribute('tabindex');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  function ChainedSheets() {
    const [aOpen, setAOpen] = React.useState(false);
    const [bOpen, setBOpen] = React.useState(false);
    return (
      <main>
        <h1>Home</h1>
        <button type="button" onClick={() => setAOpen(true)}>
          Open sheet
        </button>
        <BottomSheet open={aOpen} onClose={() => setAOpen(false)} title={TITLE}>
          <button
            type="button"
            onClick={() => {
              setAOpen(false);
              setBOpen(true);
            }}
          >
            Open the calendar
          </button>
        </BottomSheet>
        <BottomSheet open={bOpen} onClose={() => setBOpen(false)} title="Calendar">
          <p>Poker night, Thursday</p>
        </BottomSheet>
      </main>
    );
  }

  it('S3: a chained hand-off never focuses the old invoker, and closing B floors to the page h1', async () => {
    const user = userEvent.setup();
    render(<ChainedSheets />);
    const heading = screen.getByRole('heading', { name: 'Home' });
    const invoker = screen.getByRole('button', { name: 'Open sheet' });
    await openSheet(user);

    // fireEvent (synchronous, no timer turn) so sheet A's queued restore has NOT run yet.
    fireEvent.click(screen.getByRole('button', { name: 'Open the calendar' }));
    const b = screen.getByRole('dialog', { name: 'Calendar' });
    const invokerFocus = vi.fn();
    invoker.addEventListener('focus', invokerFocus);
    // Radix dispatches A's unmount autofocus event from a setTimeout queued at unmount; one
    // later macrotask is guaranteed to run after it. Asserted synchronously after (CF-26).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invokerFocus).not.toHaveBeenCalled();
    expect(b.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
    invoker.removeEventListener('focus', invokerFocus);
  });

  it('S4: a consumer handler that does not prevent default is composed, and focus returns to the invoker', async () => {
    const user = userEvent.setup();
    const recorder = vi.fn();
    render(<FloorHost onCloseAutoFocus={recorder} />);
    const invoker = screen.getByRole('button', { name: 'Open sheet' });
    await openSheet(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(invoker));
    expect(recorder).toHaveBeenCalledTimes(1);
  });

  it('S5: a consumer handler that does not prevent default, invoker removed, floors to the page h1', async () => {
    const user = userEvent.setup();
    const recorder = vi.fn();
    render(<FloorHost onCloseAutoFocus={recorder} />);
    const heading = screen.getByRole('heading', { name: 'Home' });
    await openSheet(user);
    await user.click(screen.getByRole('button', { name: 'Hide the bar' }));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(recorder).toHaveBeenCalledTimes(1);
  });

  // Confirm-only pin: GREEN before the fix and must stay green after (T-87.8-22 / 88.6-44).
  it('S6: a consumer that prevents default keeps control of focus', async () => {
    const user = userEvent.setup();
    const elsewhere = document.createElement('button');
    elsewhere.textContent = 'Elsewhere';
    document.body.appendChild(elsewhere);
    try {
      render(
        <FloorHost
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            elsewhere.focus();
          }}
        />
      );
      await openSheet(user);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(document.activeElement).toBe(elsewhere));
    } finally {
      elsewhere.remove();
    }
  });
});
