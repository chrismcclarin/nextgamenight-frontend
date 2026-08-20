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

  it('preserves both Close affordances (corner X + footer button)', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    // The freeform QR modal keeps its original two close affordances: the
    // top-right X (aria-label="Close") and the full-width "Close" button.
    expect(
      screen.getAllByRole('button', { name: /close/i })
    ).toHaveLength(2);
  });

  // 88-33 Task 3 (fork 6, UAT row 333). The walk sighting was that THIS modal's
  // glyph "sits LOWER" than the fleet's: it carried the shared 44px box and the
  // text-2xl size but NOT `leading-none`, so the glyph rode the line-box. The
  // insets now land on the same edge the fleet header's close box does.
  it('centers its close glyph optically and sits on the fleet header inset', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    // Two controls share the name 'Close' (corner glyph + footer button); the
    // corner one is first in DOM order.
    const [corner] = screen.getAllByRole('button', { name: 'Close' });
    expect(corner.className).toContain('leading-none');
    expect(corner.className).toContain('min-h-11');
    expect(corner.className).toContain('min-w-11');
    expect(corner.className).toContain('right-3');
    expect(corner.className).toContain('md:right-6');
  });
});
