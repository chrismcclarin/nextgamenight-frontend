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
import { render, screen, cleanup, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mutable identity: `selfUuid` resolved? `isError` terminal?
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
  // Plan 88.9-42 (SESSION-02): the identity query's error object, so a test can hand the page an
  // ApiError whose `code` is `unauthorized`. `null` keeps the shipped generic Error.
  error: null as Error | null,
}));

// Plan 88.9-42 (O22d): what the GroupList stub reports and receives, per render.
const gl = vi.hoisted(() => ({
  unauthorized: false,
  lastProps: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: {
      isError: h.isError,
      error: h.isError ? (h.error ?? new Error('identity failed')) : null,
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
// Plan 88.9-42 (O22d): the stub records its props and, when told to, reports a groups 401 the
// way the real GroupList does — a boolean through `onGroupsUnauthorized`, from an effect.
vi.mock('@/app/components/grouplist', async () => {
  const ReactModule = await import('react');
  function GroupListStub(props: Record<string, unknown>) {
    gl.lastProps = props;
    const report = props.onGroupsUnauthorized as ((value: boolean) => void) | undefined;
    ReactModule.useEffect(() => {
      if (!report) return undefined;
      report(gl.unauthorized);
      return () => report(false);
    }, [report]);
    return <div>group list</div>;
  }
  return { default: GroupListStub };
});
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

// 88.6.1 code review A-66 / WR-10: record the `refetch` each fetch-error source hands the shared
// hook, so a test can call the upcoming adapter (`retryUpcoming`) directly. The real hook still runs.
const fetchErrorSources = vi.hoisted(() => ({ refetches: [] as Array<() => Promise<unknown>> }));
vi.mock('@/components/ui/useFetchErrorState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/useFetchErrorState')>();
  return {
    ...actual,
    useFetchErrorState: (source: Parameters<typeof actual.useFetchErrorState>[0]) => {
      fetchErrorSources.refetches.push(source.refetch as () => Promise<unknown>);
      return actual.useFetchErrorState(source);
    },
  };
});

import UserHome from './UserHomePage';
import { ApiError } from '@/lib/api';

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
  h.error = null;
  gl.unauthorized = false;
  gl.lastProps = null;
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

// 88.6.1-63 (AC-29): a failed identity re-read keeps its row (TanStack keeps `data` beside
// `isError`), and every control works from that row, so it is not an identity failure: the card,
// the sheet and the count stay. Only a failure with NO row degrades (the M2 case above).
describe('a held identity row is not an identity failure (88.6.1-63, AC-29)', () => {
  const KEPT_ROW_EVENT = {
    id: 'e-kept',
    group_id: 'g1',
    game_id: 'game-kept',
    start_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
    Game: { name: 'Kept Row Game' },
    Group: { name: 'Alpha' },
    EventParticipations: [],
  };

  async function renderHeldRowFailure() {
    const api = await import('@/lib/api');
    (api.eventsAPI.getUserEvents as ReturnType<typeof vi.fn>).mockResolvedValue([KEPT_ROW_EVENT]);
    h.selfUuid = SELF_UUID;
    h.isError = true;
    renderHome();
  }

  it('K1: the card lists its events and the Calendar button carries its count', async () => {
    await renderHeldRowFailure();

    expect((await screen.findAllByText('Kept Row Game')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Calendar, 1 upcoming game this week' })
    ).toBeInTheDocument();
  });

  it('K2: the phone sheet shows its list, not the compact notice', async () => {
    await renderHeldRowFailure();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^calendar\b/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Kept Row Game')).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/some personal controls are (still )?unavailable/i)
    ).not.toBeInTheDocument();
  });
});

describe('A-66 / WR-10 — a Retry of the upcoming list never hangs while identity is unresolved', () => {
  it('the upcoming adapter resolves (with an unknown outcome) when no run can start for a missing selfUuid', async () => {
    h.selfUuid = undefined;
    h.isError = false;
    fetchErrorSources.refetches.length = 0;
    renderHome();

    // The upcoming source is the page's LAST useFetchErrorState call in a render (identity first,
    // then plan 88.9-42's groups-session adapter, then upcoming — the page keeps upcoming last).
    const retryUpcoming = fetchErrorSources.refetches[fetchErrorSources.refetches.length - 1];
    expect(typeof retryUpcoming).toBe('function');
    let settled: unknown = 'pending';
    await act(async () => {
      void retryUpcoming().then((value) => {
        settled = value;
      });
    });
    await waitFor(() => expect(settled).toBeUndefined());
  });
});

// Plan 88.9-42 — O22d (owner pick page 9 v3, 88.9-PICKS-B9.json; UI-SPEC (d) O-22) + SESSION-02.
// A dead session on the home page says so ONCE, at every width, in a page-level banner titled
// "Couldn't load this page" whose action is Sign in (plan 88.9-26's unauthorized branch); the
// in-column copy yields while it shows, so nothing beneath it claims the calendar or the group
// list is empty after a failure.
describe('O22d + SESSION-02 — one page-level session banner on the home page (88.9-42)', () => {
  const SESSION_ERROR = () => new ApiError('Not signed in', 'unauthorized', 401);
  const pageBanner = () => screen.getAllByText("Couldn't load this page");

  it('O22d (88.9): a 401 on either home fetch shows ONE page-level banner with Sign in; the column copy yields', async () => {
    const api = await import('@/lib/api');
    // Arm 1: the upcoming-events fetch answers 401.
    (api.eventsAPI.getUserEvents as ReturnType<typeof vi.fn>).mockRejectedValue(SESSION_ERROR());
    h.selfUuid = SELF_UUID;
    h.isError = false;
    const first = renderHome();

    await waitFor(() => expect(pageBanner()).toHaveLength(1));
    const banner = pageBanner()[0];
    // Above the two-column row: the banner precedes the group list in document order.
    const groupList = screen.getByText('group list');
    expect(banner.compareDocumentPosition(groupList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    expect(screen.queryByText('Nothing on the calendar')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Upcoming events/i })).toBeNull();
    expect(gl.lastProps?.sessionBannerShown).toBe(true);
    first.unmount();

    // Arm 2: upcoming loads fine; the group list reports its own 401.
    (api.eventsAPI.getUserEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    gl.unauthorized = true;
    renderHome();

    await waitFor(() => expect(pageBanner()).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing on the calendar')).toBeNull();
    expect(gl.lastProps?.sessionBannerShown).toBe(true);
  });

  it('SESSION-02 (88.9): an identity 401 shows the page banner and the compact identity notice yields', async () => {
    h.selfUuid = undefined;
    h.isError = true;
    h.error = SESSION_ERROR();
    const first = renderHome();

    await waitFor(() => expect(pageBanner()).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Some personal controls are unavailable/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(gl.lastProps?.sessionBannerShown).toBe(true);
    first.unmount();

    // A NON-unauthorized identity failure keeps the shipped shape: compact notice, no page banner.
    h.error = null;
    renderHome();
    expect(screen.queryByText("Couldn't load this page")).toBeNull();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(gl.lastProps?.sessionBannerShown).toBe(false);
  });
});
