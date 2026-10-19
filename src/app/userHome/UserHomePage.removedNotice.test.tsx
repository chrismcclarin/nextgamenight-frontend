// Plan 88.6.1-82 Task 1 (Req 8 / Req 5, D-22 / D-42 / D-31 / D-04 / D-07) — the
// removed-from-group notice ("You're no longer a member of that group.").
//
// 88.6.1 code review CR-4 / A-69 (owner ratified 2026-10-19): `removedFrom` is PRESENCE ONLY. The
// value used to be painted (and, since plan 82, spoken) as the group's name, so any link could put
// its own free text inside a first-party banner. The sentence is now fixed; RB2 / RB6 pin that
// nothing from the URL reaches the DOM.
//
// Before this plan the notice was a status box INSERTED already holding its text, one commit
// after mount (a polite region inserted populated is not announced by NVDA, JAWS or VoiceOver
// macOS: AT-4, `research/APPENDIX-AT.md:297-299`), and Dismiss unmounted its own focused button,
// so focus fell to <body>. These pins hold the fix: ONE always-mounted StatusRegion
// (`srOnlyWhenEmpty`), empty from the first render and filled with the notice's own shipped
// sentence after REGION_EMPTY_DWELL_MS; the box styling and Dismiss sit outside it; Dismiss arms
// useFocusRecovery with no host target, so focus lands on the page floor (`main`).
//
// The harness is COPIED from `UserHomePage.identity.test.tsx` (not imported: plan 63 edits that
// file after this plan). `getUserEvents` never settles; the siblings are stubbed.
import * as React from 'react';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REGION_EMPTY_DWELL_MS } from '@/components/ui/StatusRegion';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
  search: '',
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: {
      isError: h.isError,
      error: h.isError ? new Error('identity failed') : null,
      refetch: vi.fn(),
    },
    isPending: !h.selfUuid && !h.isError,
  }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/app/components/grouplist', () => ({ default: () => <div>group list</div> }));
vi.mock('@/app/components/EventCalendar', () => ({ default: () => <div>calendar</div> }));
vi.mock('@/app/components/FriendInvitePanel', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: {
      ...actual.eventsAPI,
      getUserEvents: vi.fn(() => new Promise(() => {})),
    },
  };
});

import UserHome from './UserHomePage';

// The shipped amber class string of the notice's box, byte-for-byte (UserHomePage.js).
const BOX_CLASS =
  'mb-4 px-4 py-3 rounded-card bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-100 flex items-center justify-between gap-3';

/** UserHomePage is `.js`, so its inferred prop type has every prop REQUIRED. */
function homeElement() {
  return (
    <UserHome
      GroupList={null}
      getGroupList={vi.fn()}
      onCreateGroup={vi.fn()}
      groupListRefreshKey={0}
      onMemberAdded={vi.fn()}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  h.selfUuid = undefined;
  h.isError = false;
  h.search = '';
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the removed-from-group notice is spoken from a region that was already there (88.6.1-82, D-22 / D-42)', () => {
  it('RB1 (D-42): the region is attached EMPTY from the first render and the sentence arrives inside it after the dwell', () => {
    vi.useFakeTimers();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });

    h.selfUuid = SELF_UUID;
    h.search = 'removedFrom=Weekend%20Warriors';
    render(homeElement());

    const region = screen.getByTestId('removed-from-group-status');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
    expect(region).toHaveClass('sr-only');

    act(() => {
      vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1);
    });
    expect(screen.getByTestId('removed-from-group-status').textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const filled = screen.getByTestId('removed-from-group-status');
    expect(filled).toBe(region);
    expect(filled.textContent).toBe("You're no longer a member of that group.");
    expect(filled).not.toHaveClass('sr-only');

    records.push(...observer.takeRecords());
    observer.disconnect();
    const fill = records.find(
      (r) => r.type === 'childList' && r.target === region && r.addedNodes.length > 0
    );
    expect(fill).toBeDefined();
  });

  it('RB2 (D-31 by reuse; CR-4 / A-69): the heard sentence is the one visible node, fixed text with no child element; Dismiss and the box sit outside the region', () => {
    vi.useFakeTimers();
    h.selfUuid = SELF_UUID;
    h.search = `removedFrom=${encodeURIComponent("Tom & Jerry's <Table>")}`;
    render(homeElement());
    act(() => {
      vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    });

    const region = screen.getByTestId('removed-from-group-status');
    const matches = screen.getAllByText(/no longer a member of/);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(region);

    expect(region.textContent).toBe("You're no longer a member of that group.");
    expect(region.children).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Tom & Jerry');

    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(region.contains(dismiss)).toBe(false);
    expect(region.nextElementSibling).toBe(dismiss);

    const box = region.parentElement as HTMLElement;
    expect(box.hasAttribute('role')).toBe(false);
    expect(box.hasAttribute('aria-live')).toBe(false);
    expect(box.className).toBe(BOX_CLASS);
    expect(box.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('RB3: with no removed group the region is mounted, empty and sr-only, with no box and no Dismiss', () => {
    vi.useFakeTimers();
    h.selfUuid = SELF_UUID;
    h.search = '';
    render(homeElement());
    act(() => {
      vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS * 2);
    });

    const region = screen.getByTestId('removed-from-group-status');
    expect(region.textContent).toBe('');
    expect(region).toHaveClass('sr-only');
    const wrapper = region.parentElement as HTMLElement;
    expect(wrapper.hasAttribute('class')).toBe(false);
    expect(wrapper.children).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('RB4 (Req 5, D-04 / D-07): Dismiss empties the same region and focus lands on main, never <body>', async () => {
    h.selfUuid = SELF_UUID;
    h.search = 'removedFrom=Weekend%20Warriors';
    const main = document.body.appendChild(document.createElement('main'));
    render(homeElement(), { container: main });

    const region = await screen.findByText(/no longer a member of/);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    expect(document.activeElement).toBe(dismiss);
    fireEvent.click(dismiss);

    expect(screen.queryByText(/no longer a member of/)).toBeNull();
    const after = screen.getByTestId('removed-from-group-status');
    expect(after).toBe(region);
    expect(after.textContent).toBe('');
    expect(after).toHaveClass('sr-only');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(main));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('RB4b (WR-08, Safari shape): a Dismiss tap that never focused the button still lands focus on main, never <body>', async () => {
    h.selfUuid = SELF_UUID;
    h.search = 'removedFrom=Weekend%20Warriors';
    const main = document.body.appendChild(document.createElement('main'));
    render(homeElement(), { container: main });

    await screen.findByText(/no longer a member of/);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    // iOS Safari does not focus a tapped button: activeElement is still <body> at arm time.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(dismiss);

    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(main));
  });

  it('RB6 (CR-4 / A-69): free text in `removedFrom` never reaches the page or the live region', () => {
    vi.useFakeTimers();
    h.selfUuid = SELF_UUID;
    const spoof = 'Game Night - your account is suspended, call 555-0100';
    h.search = `removedFrom=${encodeURIComponent(spoof)}`;
    render(homeElement());
    act(() => {
      vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    });

    const region = screen.getByTestId('removed-from-group-status');
    expect(region.textContent).toBe("You're no longer a member of that group.");
    expect(document.body.textContent).not.toContain('suspended');
    expect(document.body.textContent).not.toContain('555-0100');
  });

  it('RB5 (guard, confirm-only): after Dismiss a re-render with the same props does not bring the sentence back', async () => {
    h.selfUuid = SELF_UUID;
    h.search = 'removedFrom=Weekend%20Warriors';
    const { rerender } = render(homeElement());
    await screen.findByText(/no longer a member of/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/no longer a member of/)).toBeNull();

    rerender(homeElement());
    await new Promise((resolve) => setTimeout(resolve, REGION_EMPTY_DWELL_MS * 2));
    expect(screen.queryByText(/no longer a member of/)).toBeNull();
  });
});
