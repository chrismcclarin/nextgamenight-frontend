// Phase 88-33 Task 1 — M2 DIAGNOSIS + REGRESSION PINS ('/' with the backend
// unreachable shows a MISLEADING empty calendar).
//
// ROOT CAUSE (re-diagnosed 2026-08-20 per the Fork A ruling — this is NOT a
// retry-classification bug):
//   `upcomingLoading` initialises to FALSE (UserHomePage.js:33) and the
//   upcoming-events effect early-returns at `if (!selfUuid) return;`
//   (UserHomePage.js:59) BEFORE it ever calls `setUpcomingLoading(true)`. So for
//   the whole identity-resolution window the card is handed
//   `loading={false}, events=[], errorState.showError=false` and takes its
//   `upcomingEvents.length === 0` branch — "Nothing on the calendar" — at
//   someone whose calendar has not been fetched at all.
//   ML-17's banner covers the TERMINAL identity failure; the PENDING half was
//   never covered. With the backend up the lie lasts a few hundred ms; with it
//   unreachable the window is ~60s (2 x the BFF proxy's 30s PROXY_TIMEOUT_MS,
//   route.ts:22, plus `shouldRetry`'s single retry) — the walk's "60+s".
//
// This is the same class as grouplist's WR-03 stuck-spinner bug (87.5), one
// state over: that one hung on terminal failure, this one LIES while pending.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mutable identity: `selfUuid` resolved? `isError` terminal?
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
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
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// Siblings that own their own fetches are out of scope for this pin.
vi.mock('@/app/components/grouplist', () => ({ default: () => <div>group list</div> }));
vi.mock('@/app/components/EventCalendar', () => ({ default: () => <div>calendar</div> }));
vi.mock('@/app/components/FriendInvitePanel', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: {
      ...actual.eventsAPI,
      // Never settles: the in-flight BFF attempt against a dead backend.
      getUserEvents: vi.fn(() => new Promise(() => {})),
    },
  };
});

import UserHome from './UserHomePage';

/** UserHomePage is `.js`, so its inferred prop type has every prop REQUIRED. */
function renderHome() {
  return render(
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
  h.selfUuid = undefined;
  h.isError = false;
  vi.restoreAllMocks();
});

describe('M2 — Upcoming Events while identity is still resolving', () => {
  it('does NOT claim the calendar is clear before the events fetch has even fired', async () => {
    h.selfUuid = undefined;
    h.isError = false;
    renderHome();

    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
    expect(
      // 88-33 Task 7: current empty-body copy (7-day window disclosed).
      screen.queryByText(/Nothing scheduled in the next 7 days/)
    ).not.toBeInTheDocument();
  });

  it('says it is loading instead', async () => {
    h.selfUuid = undefined;
    h.isError = false;
    renderHome();

    expect(await screen.findByRole('status', { name: /loading your upcoming events/i }))
      .toBeInTheDocument();
  });

  it('still degrades to the ML-17 banner on TERMINAL identity failure', async () => {
    h.selfUuid = undefined;
    h.isError = true;
    renderHome();

    // The compact D-08 degrade notice — its retry control reads "Retry", not
    // "Try again" (FetchErrorBanner.tsx:85).
    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('shows the genuine empty state once identity resolved AND the fetch returned nothing', async () => {
    const api = await import('@/lib/api');
    (api.eventsAPI.getUserEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    h.selfUuid = SELF_UUID;
    h.isError = false;
    renderHome();

    expect(await screen.findByText('Nothing on the calendar')).toBeInTheDocument();
  });
});
