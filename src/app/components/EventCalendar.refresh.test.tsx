// Phase 88.6.1-73 — EventCalendar's optional `headingRef` (for plan 88.6.1-71's group-page host)
// and RF1 / D-47 at its events fetch (owner ruling 2026-10-05, D-51): a failed REFRESH keeps the
// calendar and says so with plan 88.6.1-70's shared notice and its Retry; a failed FIRST load keeps
// the full banner. Cases cite plan 70's consumer contract (C1-C12) by item.
//
// HARNESS. The mock SHAPES are copied from EventCalendar.identity.test.tsx (hoisted `h`, the
// useSelfIdentity, auth0, timezone and child-view mocks), but NOT its useFetchErrorState /
// FetchErrorBanner stubs: useFetchErrorState, FetchErrorBanner (with RefreshFailedNotice,
// useRetainedContent and RetainedContentFocusGuard) and useFocusRecovery are all REAL here. The
// API module is spread over importOriginal so ApiError stays real (C-3) and every code survives.
// Comments are // lines only (CF-9).
import * as React from 'react';
import { render, screen, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';

const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  identityError: false,
  // A STABLE refetch, so the real hook's tab-return listener is not re-subscribed every render.
  identityRefetch: (() => Promise.resolve()) as () => Promise<unknown>,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: h.identityError, error: null, refetch: h.identityRefetch },
    isPending: !h.selfUuid && !h.identityError,
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, eventsAPI: { ...actual.eventsAPI, getUserEvents: vi.fn() } };
});

// ONE useUser value on every call (plan 88.6.1-11's W022 shape).
const authUser = vi.hoisted(() => ({ user: { sub: 'auth0|self' }, isLoading: false }));
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => authUser }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// The month view renders one <li> per event id, so a test can read WHICH events are on screen.
vi.mock('@/app/components/CalendarMonthView', () => ({
  default: ({ activeEvents }: { activeEvents: { id: string }[] }) => (
    <ul data-testid="month-view">
      {activeEvents.map((e) => (
        <li key={e.id}>{e.id}</li>
      ))}
    </ul>
  ),
}));
vi.mock('@/app/components/CalendarListView', () => ({ default: () => null }));
vi.mock('@/app/components/EventDayModal', () => ({ default: () => null }));

import EventCalendarDefault from './EventCalendar';
import { eventsAPI, ApiError } from '@/lib/api';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

// EventCalendar is a JS component whose inferred props are too narrow for a typed test; the same
// cast idiom as ResponseDashboard.test.tsx.
type CalendarProps = {
  refreshKey?: number;
  events?: unknown[] | null;
  title?: string;
  headingRef?: React.RefObject<HTMLElement | null>;
};
const EventCalendar = EventCalendarDefault as unknown as ComponentType<CalendarProps>;

type Mocked = ReturnType<typeof vi.fn>;
const eventsMock = () => eventsAPI.getUserEvents as unknown as Mocked;

const SELF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEFAULT_TITLE = 'Game Sessions Calendar';
const LOAD_TITLE = "Couldn't load your calendar";

beforeEach(() => {
  vi.clearAllMocks();
  eventsMock().mockReset();
  h.selfUuid = undefined;
  h.identityError = false;
});
afterEach(() => cleanup());

// The home host's shape: inside <main> with an <h1>, so plan 04's floor has somewhere to go.
function Host(props: CalendarProps) {
  return (
    <main>
      <h1>Home</h1>
      <EventCalendar {...props} />
    </main>
  );
}

describe('EventCalendar headingRef (plan 88.6.1-73)', () => {
  it('HR-1. the identity-failure card attaches the ref to its title H2', async () => {
    h.selfUuid = undefined;
    h.identityError = true;
    const ref = React.createRef<HTMLElement>();
    render(<Host headingRef={ref} />);

    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('H2');
    expect(ref.current?.isConnected).toBe(true);
    expect(ref.current?.textContent).toBe(DEFAULT_TITLE);
  });

  it('HR-2. the first-load failure card attaches the ref to its title H2', async () => {
    h.selfUuid = SELF;
    const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    eventsMock().mockRejectedValue(new actual.ApiError('Server error', 'internal', 500));
    const ref = React.createRef<HTMLElement>();
    render(<Host headingRef={ref} />);

    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();
    expect(ref.current?.tagName).toBe('H2');
    expect(ref.current?.isConnected).toBe(true);
    expect(ref.current?.textContent).toBe(DEFAULT_TITLE);
  });

  it('HR-3. the self-fetch calendar attaches the ref to the header row H2', async () => {
    h.selfUuid = SELF;
    eventsMock().mockResolvedValue([{ id: 'e1', start_date: '2026-10-20T18:00:00.000Z' }]);
    const ref = React.createRef<HTMLElement>();
    render(<Host headingRef={ref} title="Calendar" />);

    expect(await screen.findByTestId('month-view')).toBeInTheDocument();
    expect(ref.current?.tagName).toBe('H2');
    expect(ref.current?.isConnected).toBe(true);
    expect(ref.current?.textContent).toBe('Calendar');
  });

  it('HR-4. external-events mode (plan 71) attaches the ref to the header row H2', async () => {
    const ref = React.createRef<HTMLElement>();
    render(<Host headingRef={ref} events={[]} title="Calendar" />);

    expect(await screen.findByTestId('month-view')).toBeInTheDocument();
    expect(ref.current?.tagName).toBe('H2');
    expect(ref.current?.textContent).toBe('Calendar');
    expect(eventsMock()).not.toHaveBeenCalled();
  });

  it('HR-5. the loading card renders no heading, so the ref is null there (confirm-only)', async () => {
    h.selfUuid = undefined;
    h.identityError = false;
    const ref = React.createRef<HTMLElement>();
    render(<Host headingRef={ref} />);

    expect(await screen.findByText('Loading calendar...')).toBeInTheDocument();
    expect(ref.current).toBeNull();
  });
});

describe('EventCalendar RF1 — a failed refresh keeps the calendar (plan 88.6.1-73)', () => {
  // Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7). It is
  // in the DOM twice while shown: the visible line and the polite region.
  const RF1 = "Couldn't refresh. Showing what loaded earlier.";
  // 88.6.1 code review CR-6 / A-22 (owner ratified 2026-10-19): this notice passes `sectionName`,
  // so its polite region and the Retry's description say "Calendar: " first and the visible line
  // holds RF1 alone — RF1 by exact text is found ONCE, the region holds SPOKEN.
  const SPOKEN = "Calendar: Couldn't refresh. Showing what loaded earlier.";
  const E1 = { id: 'e1', start_date: '2026-10-20T18:00:00.000Z' };
  const E2 = { id: 'e2', start_date: '2026-10-22T18:00:00.000Z' };
  const EA = { id: 'eA', start_date: '2026-10-23T18:00:00.000Z' };
  const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const server500 = () => new ApiError('Server error', 'internal', 500);

  function deferred<T = unknown>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // The house idiom (useFetchErrorState.test.tsx, function fireVisibility): the hook's tab-return
  // re-attempt, the refresh nobody pressed.
  function fireVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  const monthIds = () => {
    const view = screen.queryByTestId('month-view');
    return view ? within(view).queryAllByRole('listitem').map((li) => li.textContent) : null;
  };
  const homeH1 = () => screen.getByRole('heading', { level: 1, name: 'Home' });
  const calendarH2 = () => screen.getByRole('heading', { level: 2, name: DEFAULT_TITLE });
  const rf1Region = () =>
    Array.from(document.querySelectorAll('[role="status"]')).find((n) => n.textContent === SPOKEN);
  // The positive RF1 signal waits for BOTH copies (plan 88.6.1-30's lesson): the visible line
  // (RF1 once by exact text) and the filled region (SPOKEN).
  const waitForRf1 = () =>
    waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(rf1Region()).toBeDefined();
    });

  // A refresh is a rerender with the next refreshKey, as the home host does.
  async function loadThenRefresh(failure: unknown, extra: CalendarProps = {}) {
    h.selfUuid = SELF;
    eventsMock().mockResolvedValueOnce([E1]);
    const view = render(<Host refreshKey={0} {...extra} />);
    await waitFor(() => expect(monthIds()).toEqual(['e1']));
    eventsMock().mockRejectedValueOnce(failure);
    view.rerender(<Host refreshKey={1} {...extra} />);
    return view;
  }

  it('EC-RF-1. a failed refresh (a 500) keeps the calendar and shows RF1; the full banner is absent (C8 a, C8 e)', async () => {
    await loadThenRefresh(server500());
    await waitForRf1();
    expect(monthIds()).toEqual(['e1']);
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
  });

  it('EC-RF-2. the RF1 region is one of the status nodes present BEFORE the failure (C8 b, Req 8)', async () => {
    h.selfUuid = SELF;
    eventsMock().mockResolvedValueOnce([E1]);
    const view = render(<Host refreshKey={0} />);
    await waitFor(() => expect(monthIds()).toEqual(['e1']));
    const before = Array.from(document.querySelectorAll('[role="status"]'));

    eventsMock().mockRejectedValueOnce(server500());
    view.rerender(<Host refreshKey={1} />);
    await waitForRf1();
    const region = rf1Region();
    expect(region, 'a status node carries RF1').toBeDefined();
    // Node identity (C-6): the same node, filled.
    expect(before.find((n) => n === region)).toBe(region);
  });

  it('EC-RF-3. a successful Retry lands focus on the calendar heading, with and without a host ref (C8 c, Req 5)', async () => {
    const user = userEvent.setup();

    // The calendar's own ref (no headingRef).
    await loadThenRefresh(server500());
    await waitForRf1();
    eventsMock().mockResolvedValueOnce([E2]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(document.activeElement).toBe(calendarH2()));
    expect(monthIds()).toEqual(['e2']);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(document.activeElement).not.toBe(document.body);

    cleanup();

    // A host ref: focus lands on the element the host holds.
    const ref = React.createRef<HTMLElement>();
    await loadThenRefresh(server500(), { headingRef: ref });
    await waitForRf1();
    eventsMock().mockResolvedValueOnce([E2]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(document.activeElement).toBe(ref.current));
    expect(ref.current?.tagName).toBe('H2');
    expect(monthIds()).toEqual(['e2']);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EC-RF-4. Retry answers only when its fetch settles: Retrying… holds and the region stays quiet while held (C4, Edge R5 ordering)', async () => {
    const user = userEvent.setup();
    await loadThenRefresh(server500());
    await waitForRf1();
    const region = rf1Region() as Element;
    const retry = screen.getByRole('button', { name: 'Retry' });

    const held = deferred();
    eventsMock().mockImplementationOnce(() => held.promise);
    await user.click(retry);
    await act(async () => {
      await sleep(150);
    });
    expect(retry).toHaveTextContent('Retrying…');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(retry);
    expect(region.textContent, 'the region stays quiet while the fetch is out').toBe('');

    await act(async () => {
      held.reject(server500());
    });
    await waitFor(() => expect(region.textContent).toBe(SPOKEN));
    expect(document.activeElement).toBe(retry);
  });

  it('EC-RF-CR6 (CR-6 / A-22): the self-fetch notice names the Calendar in its region and in the Retry description, never visibly', async () => {
    await loadThenRefresh(server500());
    await waitForRf1();
    expect(rf1Region()!.textContent).toBe(SPOKEN);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(SPOKEN);
  });

  it('EC-RF-5. a failed FIRST load is the full banner, never RF1 (confirm-only)', async () => {
    h.selfUuid = SELF;
    eventsMock().mockRejectedValueOnce(server500());
    render(<Host />);
    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(monthIds()).toBeNull();
  });

  it('EC-RF-6. a refresh in flight keeps the calendar: no "Loading calendar..." over loaded events (D-09a / D-37)', async () => {
    h.selfUuid = SELF;
    eventsMock().mockResolvedValueOnce([E1]);
    const view = render(<Host refreshKey={0} />);
    await waitFor(() => expect(monthIds()).toEqual(['e1']));

    const held = deferred();
    eventsMock().mockImplementationOnce(() => held.promise);
    view.rerender(<Host refreshKey={1} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(eventsMock()).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Loading calendar...')).toBeNull();
    expect(monthIds()).toEqual(['e1']);

    await act(async () => {
      held.resolve([E1]);
    });
    expect(monthIds()).toEqual(['e1']);
  });

  it('EC-RF-7. an identity refetch failure that kept its row shows FRESH events with no RF1 (the identity site, confirm-only)', async () => {
    h.selfUuid = SELF;
    h.identityError = true;
    eventsMock().mockResolvedValueOnce([E1]);
    render(<Host />);
    await waitFor(() => expect(monthIds()).toEqual(['e1']));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
  });

  it('EC-RF-8. a new account is not a refresh: the old account\'s events never render under it (C3, confirm-only)', async () => {
    h.selfUuid = SELF;
    eventsMock().mockResolvedValueOnce([EA]);
    const view = render(<Host />);
    await waitFor(() => expect(monthIds()).toEqual(['eA']));

    const held = deferred();
    eventsMock().mockImplementationOnce(() => held.promise);
    h.selfUuid = OTHER;
    view.rerender(<Host />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(monthIds(), 'the first account\'s events under the second').toBeNull();

    await act(async () => {
      held.reject(server500());
    });
    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();
    expect(monthIds()).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EC-RF-9. a 401 refresh withdraws the events for the full banner and its register line (C8 e, C10)', async () => {
    const e401 = new ApiError('Unauthorized', 'unauthorized', 401);
    await loadThenRefresh(e401);
    expect(await screen.findByText(getFetchErrorMessage(e401))).toBeInTheDocument();
    expect(screen.getByText(LOAD_TITLE)).toBeInTheDocument();
    expect(monthIds()).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EC-RF-10. a 403 refresh withdraws the events, and a later 500 does not bring them back (C8 e, C10 memory)', async () => {
    const user = userEvent.setup();
    const e403 = new ApiError('Access denied', 'forbidden', 403);
    await loadThenRefresh(e403);
    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();
    expect(monthIds()).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    const e500 = server500();
    eventsMock().mockRejectedValueOnce(e500);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(getFetchErrorMessage(e500))).toBeInTheDocument();
    expect(monthIds()).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EC-RF-11. a network failure on refresh keeps the calendar under RF1 (C8 e)', async () => {
    await loadThenRefresh(new ApiError('Network', 'network', 0));
    await waitForRf1();
    expect(monthIds()).toEqual(['e1']);
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
  });

  it('EC-RF-12. a refresh nobody pressed never drops focus to <body>: a 403 withdrawal and a success while Retry holds focus (C8 f, C12)', async () => {
    // (f1) The view toggle inside the calendar holds focus; the tab-return re-attempt is a 403.
    const ref = React.createRef<HTMLElement>();
    await loadThenRefresh(server500(), { headingRef: ref });
    await waitForRf1();
    const toggle = screen.getByRole('button', { name: /^(List|Month) View$/ });
    act(() => toggle.focus());
    expect(document.activeElement).toBe(toggle);
    const e403 = new ApiError('Access denied', 'forbidden', 403);
    eventsMock().mockRejectedValueOnce(e403);
    await act(async () => {
      fireVisibility('visible');
    });
    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();
    expect(monthIds()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(ref.current));
    expect(ref.current?.tagName).toBe('H2');
    expect(ref.current?.textContent).toBe(DEFAULT_TITLE);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(homeH1());

    cleanup();

    // (f2) Retry holds focus; the tab-return re-attempt succeeds.
    const ref2 = React.createRef<HTMLElement>();
    await loadThenRefresh(server500(), { headingRef: ref2 });
    await waitForRf1();
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    eventsMock().mockResolvedValueOnce([E2]);
    await act(async () => {
      fireVisibility('visible');
    });
    await waitFor(() => expect(document.activeElement).toBe(ref2.current));
    expect(ref2.current?.tagName).toBe('H2');
    expect(monthIds()).toEqual(['e2']);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EC-RF-13. a tab return while a Retry is out joins that fetch: one request, never a cancelled one (C4 join, review #81 / #152)', async () => {
    const user = userEvent.setup();
    await loadThenRefresh(server500());
    await waitForRf1();
    const region = rf1Region() as Element;
    const retry = screen.getByRole('button', { name: 'Retry' });

    const held = deferred();
    eventsMock().mockImplementationOnce(() => held.promise);
    const callsBefore = eventsMock().mock.calls.length;
    await user.click(retry);
    await act(async () => {
      fireVisibility('visible');
    });
    await act(async () => {
      fireVisibility('visible');
    });
    // The Retry's run and two tab returns: ONE more request.
    expect(eventsMock()).toHaveBeenCalledTimes(callsBefore + 1);
    expect(retry).toHaveTextContent('Retrying…');

    await act(async () => {
      held.reject(server500());
    });
    await waitFor(() => expect(region.textContent).toBe(SPOKEN));
    expect(document.activeElement).toBe(retry);
    expect(eventsMock()).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it('EC-RF-14. a successful Try again on the FIRST-load banner lands focus on the calendar heading (review #82, Req 5)', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<HTMLElement>();
    h.selfUuid = SELF;
    eventsMock().mockRejectedValueOnce(server500());
    render(<Host headingRef={ref} />);
    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();

    eventsMock().mockResolvedValueOnce([E1]);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(document.activeElement).toBe(ref.current));
    expect(ref.current?.tagName).toBe('H2');
    expect(ref.current?.textContent).toBe(DEFAULT_TITLE);
    expect(monthIds()).toEqual(['e1']);
    expect(document.activeElement).not.toBe(homeH1());
    expect(document.activeElement).not.toBe(document.body);
  });
});
