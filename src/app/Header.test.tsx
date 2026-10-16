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

const INVITE = { id: 'inv-1', Group: { name: 'Tuesday Night Crew' }, Inviter: { username: 'Bee' } };

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
        if (type === 'keydown') {
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
        if (type === 'keydown') {
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
