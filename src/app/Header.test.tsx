// Phase 88.6.1-45 — the first render test of Header (D-46: the file is src/app/Header.js).
//
// Task 1 (D-08a): one Escape closes one layer. The phone hamburger mounts the bell's row variant
// (`variant="row" label="Invites"` in Header.js), whose Escape is claimed by the shared
// useDismissal hook with preventDefault. Header's own Escape listener must return on a
// default-prevented event, or one Escape closes the Invites panel AND the whole menu.
//
// Comments in this file are `//` lines only: a block comment holding a backtick or a star-slash
// makes vite:oxc collect zero tests from the file while it still reports green (FE testing
// conventions CF-9).
//
// `.tsx` is mandatory: vitest.config.mts only collects `.ts`/`.tsx`; its jsx-in-js transform
// handles the `.js` component under test.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, unreadState } = vi.hoisted(() => ({
  auth: {
    user: { sub: 'auth0|me', name: 'Me' } as { sub: string; name: string } | undefined,
    error: undefined as Error | undefined,
    isLoading: false,
  },
  unreadState: {
    invites: [] as Array<Record<string, unknown>>,
    friendRequests: [] as Array<Record<string, unknown>>,
    totalCount: 0,
    loading: false,
    setInvites: vi.fn(),
  },
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => auth,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    invitesAPI: {
      acceptInvite: vi.fn(),
      declineInvite: vi.fn(),
    },
  };
});

// Header reads totalCount from the same hook the bell reads its lists from.
vi.mock('./components/UnreadNotificationProvider', () => ({
  useUnreadNotificationCount: () => ({
    invites: unreadState.invites,
    friendRequests: unreadState.friendRequests,
    totalCount: unreadState.totalCount,
    loading: unreadState.loading,
    setInvites: unreadState.setInvites,
  }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { friendMocks } = vi.hoisted(() => ({
  friendMocks: { acceptRequest: vi.fn(), declineRequest: vi.fn() },
}));

vi.mock('./components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => friendMocks,
}));

// Not under test: FeedbackButton needs the FeedbackModal provider, ThemeToggle needs next-themes.
// The bell is NOT stubbed: its real, hook-driven Escape claim is what D-08a has to meet.
vi.mock('./components/FeedbackButton', () => ({ default: () => null }));
vi.mock('./components/ThemeToggle', () => ({ default: () => null }));

import Header from './Header';

const INVITE = { id: 'inv-1', group_name: 'Tuesday Night Crew', invited_by_name: 'Bee' };

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { sub: 'auth0|me', name: 'Me' };
  auth.error = undefined;
  auth.isLoading = false;
  unreadState.invites = [INVITE];
  unreadState.friendRequests = [];
  unreadState.totalCount = 1;
  unreadState.loading = false;
});

afterEach(() => {
  cleanup();
});

// WHY THIS HARNESS EXISTS. The Next 14 App Router hydrates React on the document itself
// (node_modules/next/dist/client/app-index.js:42, `const appElement = document;`), so in
// production Header's document keydown listener sits on the SAME node as React's root listener
// and runs after it: the bell's stopPropagation cannot stop it, and only a default-prevented
// bail protects the menu. Testing Library's root is a div. A listener left on the document sits
// ABOVE that root, the bell's stopPropagation stops the event before it gets there, and the test
// would pass without the fix. So, after render, Header's document keydown registrations are
// redirected onto the RTL container: React's root node, later in order — the position Header
// has in production. Every other event type still lands on the document (useDismissal's
// outside mousedown listener). Same model as NotificationBell.test.tsx NB-6 and useDismissal E5.
function redirectDocumentKeydownTo(container: HTMLElement) {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const addSpy = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === 'keydown' && listener) {
          added.push(listener);
          container.addEventListener(type, listener, options);
          return;
        }
        EventTarget.prototype.addEventListener.call(document, type, listener, options);
      },
    );
  const removeSpy = vi
    .spyOn(document, 'removeEventListener')
    .mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) => {
        if (type === 'keydown' && listener) {
          removed.push(listener);
          container.removeEventListener(type, listener, options);
          return;
        }
        EventTarget.prototype.removeEventListener.call(document, type, listener, options);
      },
    );
  return {
    added,
    removed,
    restore() {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

function toggle() {
  return screen.getByRole('button', { name: 'Toggle menu' });
}

// The ROW bell, the one the phone hamburger mounts. The desktop icon bell ("Notifications")
// also renders under jsdom, which applies no media query.
function rowBell() {
  return screen.getByRole('button', { name: 'Invites notifications' });
}

function openMenuAndBell() {
  fireEvent.click(toggle());
  expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(rowBell());
  expect(rowBell()).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Group Invites')).toBeInTheDocument();
}

describe('Header — one Escape, one layer (D-08a, Phase 88.6.1-45)', () => {
  it('HD-1. with the hamburger and the Invites panel open, ONE Escape closes the panel only: default-prevented, the menu stays open, focus stays on the Invites trigger', () => {
    const { container } = render(<Header />);
    const harness = redirectDocumentKeydownTo(container);
    try {
      // Anti-vacuity: the harness sees Header's listener exactly when Header adds it.
      expect(harness.added).toHaveLength(0);
      openMenuAndBell();
      expect(harness.added).toHaveLength(1);

      const trigger = rowBell();
      trigger.focus();
      const notPrevented = fireEvent.keyDown(trigger, { key: 'Escape' });

      expect(notPrevented).toBe(false);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Group Invites')).not.toBeInTheDocument();
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
      expect(document.activeElement).toBe(trigger);
    } finally {
      harness.restore();
    }
  });

  it('HD-2. one Escape per layer: the second Escape is not claimed and closes the menu with focus on Toggle menu; a third is inert, and the listener removed is the one added', () => {
    const { container } = render(<Header />);
    const harness = redirectDocumentKeydownTo(container);
    try {
      openMenuAndBell();
      const trigger = rowBell();
      trigger.focus();
      expect(fireEvent.keyDown(trigger, { key: 'Escape' })).toBe(false);
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');

      // Second Escape: nothing claims it, so it closes the hamburger and focus returns home.
      expect(fireEvent.keyDown(trigger, { key: 'Escape' })).toBe(true);
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(toggle());

      // Third Escape: inert. Nothing is listening and nothing reopens.
      expect(fireEvent.keyDown(toggle(), { key: 'Escape' })).toBe(true);
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Group Invites')).not.toBeInTheDocument();

      expect(harness.added).toHaveLength(1);
      expect(harness.removed).toHaveLength(1);
      expect(harness.removed[0]).toBe(harness.added[0]);
    } finally {
      harness.restore();
    }
  });

  it('HD-3. an Escape a capture-phase layer already claimed (the shape of Radix DismissableLayer) leaves the hamburger open', () => {
    const { container } = render(<Header />);
    const harness = redirectDocumentKeydownTo(container);
    // Radix's useEscapeKeydown listens in the CAPTURE phase on the document and calls
    // preventDefault when it dismisses; in production that is the React root node too.
    const claim = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') event.preventDefault();
    };
    try {
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
      expect(harness.added).toHaveLength(1);
      container.addEventListener('keydown', claim, { capture: true });

      toggle().focus();
      expect(fireEvent.keyDown(toggle(), { key: 'Escape' })).toBe(false);
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    } finally {
      container.removeEventListener('keydown', claim, { capture: true });
      harness.restore();
    }
  });
});

describe('Header — one Main navigation landmark (AC-18, copy row H5)', () => {
  // The label is asserted as the literal 'Main' (copy row H5), never by importing the constant,
  // so a changed constant fails here.
  it('HD-4. signed in: exactly one nav, named Main, holds all 9 header links, the Toggle menu button and the inert closed panel', () => {
    render(<Header />);
    const navs = document.querySelectorAll('nav');
    expect(navs).toHaveLength(1);
    const nav = navs[0];
    expect(nav.getAttribute('aria-label')).toBe('Main');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBe(nav);

    // The brand link plus Home, Friends, Profile and Logout in each of the two lists.
    const links = Array.from(document.querySelectorAll('a'));
    expect(links).toHaveLength(9);
    expect(links.filter((a) => !nav.contains(a))).toEqual([]);

    expect(nav.contains(toggle())).toBe(true);

    // The phone panel stays a div with its inert-while-closed attribute (owner ruling R3-D).
    const inertNodes = Array.from(document.querySelectorAll('[inert]'));
    expect(inertNodes).toHaveLength(1);
    expect(inertNodes[0].tagName).toBe('DIV');
    expect(nav.contains(inertNodes[0])).toBe(true);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('HD-5. signed out: exactly one nav, named Main, holds all 3 header links', () => {
    auth.user = undefined;
    render(<Header />);
    const navs = document.querySelectorAll('nav');
    expect(navs).toHaveLength(1);
    const nav = navs[0];
    expect(nav.getAttribute('aria-label')).toBe('Main');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBe(nav);

    // The brand link plus Login in each of the two lists.
    const links = Array.from(document.querySelectorAll('a'));
    expect(links).toHaveLength(3);
    expect(links.filter((a) => !nav.contains(a))).toEqual([]);
    cleanup();

    // 88.9-52 W6: while the session is still being read, the strip is not empty. The brand (logo
    // and name) is there, inside the same one Main landmark; the lists and the menu button, which
    // depend on who is signed in, are not there yet.
    auth.isLoading = true;
    render(<Header />);
    const waitingNavs = document.querySelectorAll('nav');
    expect(waitingNavs).toHaveLength(1);
    expect(waitingNavs[0].getAttribute('aria-label')).toBe('Main');
    const waitingLinks = Array.from(document.querySelectorAll('a'));
    expect(waitingLinks).toHaveLength(1);
    expect(waitingLinks[0]).toHaveAttribute('href', '/');
    expect(waitingLinks[0]).toHaveTextContent('Next Game Night');
    expect(waitingNavs[0].contains(waitingLinks[0])).toBe(true);
    expect(screen.queryByRole('button', { name: 'Toggle menu' })).toBeNull();
    expect(screen.queryByText('Login')).toBeNull();
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});

// 88.9-52 R21 (owner 2026-11-17, pick Fit or logo): at enlarged text the site name is held at the
// largest size that keeps it on one line between the logo and the menu button, never below its
// ordinary 18px; where 18px cannot fit, the logo stands alone and the link keeps its name.
// jsdom performs no layout and resolves no container query, so this reads the two class tokens
// the rule is written in and works the same arithmetic the browser does, at the widths the
// capture measured (20px fits at 375 with doubled text; at 320 with doubled text only 13px would).
describe('R21 (88.9-52): the header site name fits one line at enlarged text, or gives way to the logo', () => {
  const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const SIZE = /^text-\[length:clamp\((\d+)px,calc\(\(100cqw_-_(\d+)px_-_([\d.]+)rem_-_(\d+)px\)_\/_([\d.]+)\),([\d.]+)rem\)\]$/;
  const HIDE = /^@max-\[calc\((\d+)px_\+_([\d.]+)rem\)\]:sr-only$/;
  // Measured by capture j on the real element: the name is 157.4px wide at 20px and 102.3px at 13px.
  const NAME_WIDTH_EM = 157.4 / 20;

  const read = () => {
    render(<Header />);
    // Matched as a pattern from when the logo carried a label of its own; the logo is decoration
    // since 88.9-52 and the exact name is pinned in the last describe of this file.
    const link = screen.getByRole('link', { name: /Next Game Night$/ });
    const name = Array.from(link.querySelectorAll('span')).find((s) => s.textContent?.trim() === 'Next Game Night') as HTMLElement;
    const cls = tokens(name);
    const size = cls.map((t) => SIZE.exec(t)).find(Boolean);
    const hide = cls.map((t) => HIDE.exec(t)).find(Boolean);
    return { link, name, cls, size, hide };
  };
  const numbers = (m: RegExpExecArray) => m.slice(1).map(Number);

  it('R21 tokens: the name carries one fit rule and one give-way rule, never wraps, and its row is the measured container', () => {
    const { link, name, cls, size, hide } = read();
    expect(size, 'the fit rule (a clamp on the row width) is on the name').toBeTruthy();
    expect(hide, 'the give-way rule (visually hidden under a row width) is on the name').toBeTruthy();
    expect(cls).toContain('whitespace-nowrap');
    // The desktop rung of the owner-accepted pair (C10a) is kept; the phone rung is now the fit rule's cap.
    expect(cls).toContain('md:text-xl');
    expect(cls).not.toContain('text-lg');
    // The row that holds the brand link and the menu button is the query container.
    const row = link.parentElement as HTMLElement;
    expect(tokens(row)).toContain('@container');
    expect(row.contains(screen.getByRole('button', { name: 'Toggle menu' }))).toBe(true);
    // Hidden from sight only: the name stays in the link, so the link keeps its name.
    expect(link.contains(name)).toBe(true);
  });

  it('R21 lockstep: the constants in the two rules are the logo, the gap after it, the menu button and an 8px clearance', () => {
    const { link, size, hide } = read();
    const [minPx, logoPx, remTerm, clearPx, divisor, capRem] = numbers(size as RegExpExecArray);
    const [hidePx, hideRem] = numbers(hide as RegExpExecArray);
    expect(minPx).toBe(18);
    expect(capRem * 16).toBe(18);
    // The logo is a fixed px size: it does not grow with text.
    const logo = link.querySelector('svg') as SVGElement;
    expect(Number(logo.getAttribute('width'))).toBe(logoPx);
    // gap-2.5 after the logo (0.625rem) plus the menu button, p-2.5 round a w-6 icon (2.75rem).
    expect(tokens(link)).toContain('gap-2.5');
    const menu = screen.getByRole('button', { name: 'Toggle menu' });
    expect(tokens(menu)).toContain('p-2.5');
    expect(tokens(menu.querySelector('svg') as Element)).toEqual(['w-6', 'h-6']);
    expect(remTerm).toBe(0.625 + 0.625 * 2 + 1.5);
    expect(clearPx).toBe(8);
    // The divisor is the name's measured width in em, rounded up, so the clearance is never eaten.
    expect(divisor).toBeGreaterThanOrEqual(NAME_WIDTH_EM);
    expect(divisor).toBeLessThanOrEqual(NAME_WIDTH_EM * 1.03);
    // The give-way width is exactly where the fit rule reaches its 18px floor.
    expect(hideRem).toBe(remTerm);
    expect(hidePx).toBe(logoPx + clearPx + minPx * divisor);
  });

  it('R21 arithmetic: 18px at ordinary text, about 20px at 375 with doubled text, the logo alone at 320 with doubled text', () => {
    const { size, hide } = read();
    const [minPx, logoPx, remTerm, clearPx, divisor, capRem] = numbers(size as RegExpExecArray);
    const [hidePx, hideRem] = numbers(hide as RegExpExecArray);
    // The row is the screen less the nav's px-4 on each side (1rem each).
    const row = (viewport: number, rem: number) => viewport - 2 * rem;
    const shown = (viewport: number, rem: number) => row(viewport, rem) >= hidePx + hideRem * rem;
    const fontPx = (viewport: number, rem: number) =>
      Math.min(Math.max(minPx, (row(viewport, rem) - logoPx - remTerm * rem - clearPx) / divisor), capRem * rem);
    // What is left between the end of the name and the menu button.
    const clearance = (viewport: number, rem: number) =>
      row(viewport, rem) - logoPx - remTerm * rem - NAME_WIDTH_EM * fontPx(viewport, rem);

    // Ordinary text: nothing changes, at either phone width.
    expect(shown(375, 16)).toBe(true);
    expect(fontPx(375, 16)).toBe(18);
    expect(shown(320, 16)).toBe(true);
    expect(fontPx(320, 16)).toBe(18);
    // Doubled text at 375: the capture measured 20px as the largest size with 8px clear.
    expect(shown(375, 32)).toBe(true);
    expect(fontPx(375, 32)).toBeGreaterThanOrEqual(20);
    expect(fontPx(375, 32)).toBeLessThan(20.5);
    expect(clearance(375, 32)).toBeGreaterThanOrEqual(8);
    // Doubled text at 320: 18px cannot fit (the capture measured 13px), so the logo stands alone.
    expect(shown(320, 32)).toBe(false);
    // Wide enough, doubled text: the name reaches its doubled size (36px) and still clears the button.
    expect(fontPx(600, 32)).toBe(36);
    expect(clearance(600, 32)).toBeGreaterThanOrEqual(8);
    // Never under 18px while shown, at any width and text size on the way.
    for (const rem of [16, 20, 24, 28, 32, 40]) {
      for (let viewport = 280; viewport <= 767; viewport += 1) {
        if (!shown(viewport, rem)) continue;
        expect(fontPx(viewport, rem)).toBeGreaterThanOrEqual(18);
        expect(clearance(viewport, rem), viewport + ' at ' + rem).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

// 88.9-52 (found by the R21 fixer): the logo inside the home link carried a label of its own with
// the legacy name of one group, so the link was spoken with that name in front of the product's.
// The logo is decoration there: the link's name is the product name, once, and nothing else.
describe('the header home link is named by the product name alone (88.9-52)', () => {
  it('brand name: signed in and signed out, the home link is named exactly Next Game Night and the logo is hidden from assistive tech', () => {
    for (const signedIn of [true, false]) {
      auth.user = signedIn ? { sub: 'auth0|me', name: 'Me' } : undefined;
      render(<Header />);
      // A string name is an exact match of the whole computed name.
      const link = screen.getByRole('link', { name: 'Next Game Night' });
      expect(link).toHaveAttribute('href', '/');
      const logo = link.querySelector('svg') as SVGElement;
      expect(logo).not.toBeNull();
      expect(logo).toHaveAttribute('aria-hidden', 'true');
      expect(logo).not.toHaveAttribute('aria-label');
      expect(document.querySelector('[aria-label*="Periodic"]')).toBeNull();
      // The give-way state of R21 keeps the name in the link as text, so the name does not depend
      // on the word being drawn: the span is still the link's only text.
      expect(link.textContent?.trim()).toBe('Next Game Night');
      cleanup();
    }
  });
});
