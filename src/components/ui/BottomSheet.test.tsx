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
//   4. axe-clean while open (the fleet was 0/16 before Radix, `Modal.tsx:5-10`).
//   5. NO gesture affordance (D-05) — dismissal is the three explicit paths, and
//      no drag handle is ever advertised to assistive tech.
//
// Geometry (height, viewport units, scroll) is deliberately NOT pinned here: it
// is P7 and belongs to the phone Playwright spec in plan 88.1-10. jsdom has no
// layout, so a geometry assertion here would be theatre.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { BottomSheet } from './BottomSheet';

afterEach(cleanup);

const TITLE = 'Upcoming events';

/**
 * Controlled harness with a real invoker button, following the
 * `Modal.test.tsx` render-helper idiom. The trigger is a plain button (not
 * `DialogTrigger`) because that is how both shipped consumers mount the sheet —
 * and because focus restore must be proven against the element that actually
 * had focus, not against a Radix-managed trigger.
 */
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
