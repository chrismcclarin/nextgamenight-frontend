// Behavior + a11y pins for the compound <Modal> primitive (PRIM-02 / D-09).
//
// The current hand-rolled modal fleet is 0/16 on axe (no focus trap, no Esc, no
// aria-modal). This suite locks the contract the Radix-backed primitive must
// honor so the Phase-88 `.modal-*` -> <Modal.*> swap is mechanical and safe:
//   1. role=dialog + aria-modal + aria-labelledby wired to the header title
//   2. axe-clean render (the headline gate)
//   3. size prop -> max-w mapping
//   4. dismissable escape hatch (overlay-dismiss defeatable for forms)
//   5. Close affordance carries an accessible "Close" name + fires onClose
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Modal, preventNonDismissableClose } from './Modal';

afterEach(cleanup);

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Modal open onClose={onClose} {...props}>
      <Modal.Header>Start a check-in</Modal.Header>
      <Modal.Body>
        <p>When are you free?</p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Action variant="secondary" onClick={onClose}>
          Cancel
        </Modal.Action>
        <Modal.Action variant="primary">Start poll</Modal.Action>
      </Modal.Footer>
    </Modal>
  );
  return { onClose, ...utils };
}

describe('Modal', () => {
  it('exposes role=dialog, aria-modal, and aria-labelledby wired to the header title', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    const title = screen.getByText('Start a check-in');
    expect(title).toHaveAttribute('id', labelledby as string);
  });

  it('passes an axe audit with no violations', async () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('maps size="sm" to max-w-sm', () => {
    renderModal({ size: 'sm' });
    expect(screen.getByRole('dialog')).toHaveClass('max-w-sm');
  });

  it('maps size="lg" to max-w-4xl', () => {
    renderModal({ size: 'lg' });
    expect(screen.getByRole('dialog')).toHaveClass('max-w-4xl');
  });

  // DEF-88-17-01 (closed by 88-16). The 87.8 DEC-3 12px phone gutter used to be
  // written ONLY in a `@media (width < 48rem)` rule keyed to the legacy overlay
  // class, so it evaporated for each surface as it migrated onto this primitive.
  // It now lives on the content surface itself. jsdom computes no layout, so the
  // pin is on the class contract — which is also the thing a future "tidy" would
  // delete. Both halves matter: the phone inset AND its `md:` neutraliser.
  it('carries the 12px-per-side phone gutter and drops it at md (DEF-88-17-01)', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('w-[calc(100%-1.5rem)]');
    expect(dialog).toHaveClass('md:w-full');
    // A bare `w-full` at the phone tier is the regression this closes.
    expect(dialog.className.split(/\s+/)).not.toContain('w-full');
  });

  it('renders a single Close affordance with an accessible name that fires onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    expect(closeButtons).toHaveLength(1);
    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape via onClose by default', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('still closes on Escape when dismissable=false (keyboard is never trapped)', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal({ dismissable: false });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // The outside-click escape hatch (D-09, StartPollModal data-loss fix) is
  // pinned at the seam we own: the guard that cancels Radix's outside event.
  // Radix's own outside-pointer DETECTION needs a real browser (E2E), not
  // jsdom — so we assert the decision logic deterministically here.
  describe('outside-dismiss escape hatch', () => {
    it('cancels the outside event when dismissable=false', () => {
      const event = { preventDefault: vi.fn() };
      preventNonDismissableClose(false, event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('leaves the outside event intact when dismissable=true', () => {
      const event = { preventDefault: vi.fn() };
      preventNonDismissableClose(true, event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  it('renders a destructive footer action affordance mapping to btn-danger', () => {
    render(
      <Modal open onClose={vi.fn()}>
        <Modal.Header>Delete group</Modal.Header>
        <Modal.Body>This cannot be undone.</Modal.Body>
        <Modal.Footer>
          <Modal.Action variant="danger">Delete</Modal.Action>
        </Modal.Footer>
      </Modal>
    );
    const danger = screen.getByRole('button', { name: 'Delete' });
    expect(danger).toHaveClass('btn', 'btn-danger');
  });
});

// ---------------------------------------------------------------------------
// Phase 88-33 Task 3 (fork 6, UAT rows 299/308/317/313/333) — ONE shared
// horizontal scale across header, body and footer.
//
// Assertions read the COMPUTED class list off a real render, not a regex over
// the source: the phase's anti-pattern register records 17 defective
// grep-shaped gates, several of which passed against JSX the regex could not
// see. A render-based pin cannot be vacuous — if the element stops existing,
// the query throws.
// ---------------------------------------------------------------------------
describe('Modal padding scale (fork 6)', () => {
  /** Walk up from the title/body text to the padded container. */
  function headerEl() {
    return screen.getByText('Start a check-in').parentElement as HTMLElement;
  }
  function bodyEl() {
    return screen.getByText('When are you free?').parentElement as HTMLElement;
  }
  function footerEl() {
    return screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
  }

  it('header, body and footer share the SAME horizontal padding at both breakpoints', () => {
    renderModal();
    // Body is the reference scale (88-32 ruling 6: `p-3 md:p-6`).
    expect(bodyEl().className).toContain('p-3');
    expect(bodyEl().className).toContain('md:p-6');

    for (const el of [headerEl(), footerEl()]) {
      expect(el.className).toContain('px-3');
      expect(el.className).toContain('md:px-6');
      // The old flat scale is what indented the title past the body content.
      expect(el.className).not.toMatch(/(^|\s)px-6(\s|$)/);
    }
  });

  it('tightens the header vertically without touching the 44px close box', () => {
    renderModal();
    expect(headerEl().className).toContain('py-2');
    expect(headerEl().className).toContain('md:py-3');
    expect(headerEl().className).not.toMatch(/(^|\s)py-5(\s|$)/);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toContain('min-h-11');
    expect(close.className).toContain('min-w-11');
    // Optical centering of the glyph inside the taller box.
    expect(close.className).toContain('leading-none');
  });
});
