// Phase 88.9-37 X1 / R2-48 (owner pick B5a) — the footer controls, class pin.
//
// Site: src/app/components/Footer.js ("DECISION Phase 88.9-37 B5a").
// Measured basis (UI-SPEC R2-48, page B1 item B5): the three footer links shipped 20px tall
// (under WCAG 2.5.8's 24) and wore the browser focus outline, which read 1.84:1 on the page
// ground in light (under 3:1). B5a makes each link a 44px flex box and puts every footer
// control on the house ring with the page-ground halo: ring vs halo and ring vs the ground
// outside it 5.97 light / 10.13 dark (band 1.00).
//
// jsdom paints nothing, so this pins the class tokens. The real proofs are on CI: the phone
// touch-target pin 'R4 (88.9 B5a)' measures every footer control in both auth states at 375,
// and the Gate C pin 'halo (88.9 R2): footer About and Report bug ring band' reads the ring.
//
// Also pinned (threat register T-88.9-120 / T-88.9-121): the Privacy link's href stays the
// capital-P path in both footers, and Report bug renders only in the signed-in footer.
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ loggedOut: false }));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () =>
    h.loggedOut
      ? { user: undefined, isLoading: false }
      : { user: { sub: 'auth0|self' }, isLoading: false },
}));

vi.mock('./FeedbackForm', () => ({ default: () => null }));
vi.mock('./BGGLogo', () => ({ default: () => null }));

import Footer from './Footer';

const RING = [
  'focus:outline-hidden',
  'focus-visible:ring-2',
  'focus-visible:ring-focus-ring',
  'focus-visible:ring-offset-2',
  'focus-visible:ring-offset-surface-page',
];
const LINK_BOX = ['min-h-11', 'inline-flex', 'items-center'];

function expectFooterControls(signedIn: boolean) {
  const footer = within(screen.getByRole('contentinfo'));
  for (const name of ['About', 'Privacy', 'Terms']) {
    const link = footer.getByRole('link', { name });
    expect(link, `${name} link (${signedIn ? 'signed in' : 'signed out'})`).toHaveClass(
      ...LINK_BOX,
      ...RING,
    );
  }
  expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/Privacy');
  const reportBug = footer.queryByRole('button', { name: /report bug/i });
  if (!signedIn) {
    expect(reportBug).toBeNull();
    return;
  }
  expect(reportBug).not.toBeNull();
  expect(reportBug).toHaveClass('min-h-11', ...RING);
}

describe('X1 (88.9 B5a) — the footer controls', () => {
  afterEach(() => {
    cleanup();
    h.loggedOut = false;
  });

  it('X1: three links min-h-11, house ring on page ground', () => {
    h.loggedOut = true;
    render(<Footer />);
    expectFooterControls(false);
    cleanup();

    h.loggedOut = false;
    render(<Footer />);
    expectFooterControls(true);
  });
});
