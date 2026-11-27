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
import { expectFocusRing, expectRingGround } from '@/test-utils/focusRingAssert';

const LINK_BOX = ['min-h-11', 'inline-flex', 'items-center'];
// Phase 89.6-43 (outline rule 10 G1 + G2, owner pick O-1 B, 2026-11-22): every footer text control's
// ring is rounded (4px) and has 4px of side room paid back by an equal negative margin. jsdom lays
// nothing out, so this pins the class tokens; the rendered reads are in
// e2e/chrome-ring-geometry.spec.ts ("G1 + G2 (89.6-43): the footer controls").
const RING_ROOM = ['rounded-sm', 'px-1', '-mx-1'];

function expectFooterControls(signedIn: boolean) {
  const footer = within(screen.getByRole('contentinfo'));
  for (const name of ['About', 'Privacy', 'Terms']) {
    const link = footer.getByRole('link', { name });
    const where = `${name} link (${signedIn ? 'signed in' : 'signed out'})`;
    expect(link, where).toHaveClass(...LINK_BOX, ...RING_ROOM, 'focus:outline-hidden');
    expectFocusRing(link, where);
    expectRingGround(link, 'page', where);
  }
  expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/Privacy');
  const reportBug = footer.queryByRole('button', { name: /report bug/i });
  if (!signedIn) {
    expect(reportBug).toBeNull();
    return;
  }
  expect(reportBug).not.toBeNull();
  // 89.6-43 (register UR-05): Report bug is a flex box like the links, so its text is centred in
  // the 44px box by construction.
  expect(reportBug).toHaveClass(...LINK_BOX, ...RING_ROOM, 'focus:outline-hidden');
  expectFocusRing(reportBug as HTMLElement, 'Report bug');
  expectRingGround(reportBug as HTMLElement, 'page', 'Report bug');
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

  // 88.9-52 W10: at 375px with doubled text the link row was one unbreakable line wider than the
  // screen (the group page measured 643px). The row wraps and centres in both footers. jsdom lays
  // nothing out, so this pins the class tokens; the width itself is unmeasured here.
  it('W10 (88.9-52): the link row wraps and centres in both footers', () => {
    for (const loggedOut of [true, false]) {
      h.loggedOut = loggedOut;
      render(<Footer />);
      const row = within(screen.getByRole('contentinfo')).getByRole('link', { name: 'About' })
        .parentElement as HTMLElement;
      expect(row, loggedOut ? 'signed out' : 'signed in').toHaveClass(
        'flex',
        'flex-wrap',
        'items-center',
        'justify-center',
        'gap-4',
      );
      expect(within(row).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/Privacy');
      cleanup();
    }
  });

  // 88.9-52 R4 S1: the floating feedback button sits 3rem + 8px off the page bottom, 24px in from
  // the right, 56px square (src/app/components/FeedbackButton.js ("AMENDED Phase 88.9-52 (R5, owner 2026-11-17, pick Always)")).
  // At 768px with doubled text the copyright wrapped onto two lines inside the one footer row and
  // the button sat on it. From md the footer keeps that corner clear: the copyright never breaks
  // (so its top is never above 3rem), the row may break instead and the copyright group keeps the
  // right-hand end of its own line, and the link group stops 8px short of the button's box.
  // jsdom lays nothing out, so this pins the class tokens; the rendered proof is the R5 e2e test.
  it('S1 (88.9-52 R4): from md the copyright stays on one line at the right and the links stop short of the feedback button', () => {
    for (const loggedOut of [true, false]) {
      h.loggedOut = loggedOut;
      render(<Footer />);
      const who = loggedOut ? 'signed out' : 'signed in';
      const links = within(screen.getByRole('contentinfo')).getByRole('link', { name: 'About' })
        .parentElement as HTMLElement;
      const row = links.parentElement as HTMLElement;
      expect(row, who).toHaveClass('flex', 'flex-col', 'md:flex-row', 'md:flex-wrap', 'items-center', 'justify-between', 'gap-3');
      // 88px = the button's 24px inset + its 56px + an 8px gap; 1rem is the footer's own side padding.
      expect(links, who).toHaveClass('md:max-w-[calc(100%_-_88px_+_1rem)]');
      const copyright = screen.getByText(/^© \d{4} Next Game Night$/);
      const group = copyright.parentElement as HTMLElement;
      expect(group.parentElement, who).toBe(row);
      expect(group, who).toHaveClass('md:ms-auto', 'md:whitespace-nowrap');
      // Below md nothing changed: the copyright may still break on a phone.
      expect(group.className.split(/\s+/), who).not.toContain('whitespace-nowrap');
      cleanup();
    }
  });
});
