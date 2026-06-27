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
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Modal } from './Modal';

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

  it('closes on outside pointer interaction by default', async () => {
    const { onClose } = renderModal();
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does NOT close on outside pointer interaction when dismissable=false', () => {
    const { onClose } = renderModal({ dismissable: false });
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    expect(onClose).not.toHaveBeenCalled();
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
