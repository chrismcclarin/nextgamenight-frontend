// Axe audit for QRCodeModal after its migration onto the shared <Modal> primitive
// (PRIM-02 / D-09). The pre-migration hand-rolled `.modal-overlay` had no
// role=dialog / focus-trap / aria-modal (the 0/16-axe fleet); this pins the
// migrated modal to the Radix-backed a11y contract: it exposes role=dialog and
// returns zero axe violations rendered open at size="sm".
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import QRCodeModal from './QRCodeModal';

afterEach(cleanup);

describe('QRCodeModal (migrated onto <Modal size="sm">)', () => {
  it('renders as role=dialog when open', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('preserves the accessible Close affordance', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    expect(
      screen.getByRole('button', { name: /close/i })
    ).toBeInTheDocument();
  });
});
