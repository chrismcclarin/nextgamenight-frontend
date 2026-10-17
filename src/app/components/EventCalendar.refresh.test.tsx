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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
import { eventsAPI } from '@/lib/api';

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
