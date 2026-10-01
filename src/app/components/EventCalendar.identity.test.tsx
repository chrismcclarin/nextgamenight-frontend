// Phase 87.5 WR-03: in self-fetch mode (externalEvents === null) EventCalendar
// gates its fetch on selfUuid; fetchEvents early-returns on `!selfUuid` before
// its try/finally, so a TERMINAL identity failure leaves `loading` (init true)
// stuck forever — "Loading calendar..." with no affordance. These tests prove
// the new terminal-error branch renders the calendar's error banner in place of
// the stuck spinner (self-fetch mode only), and that the pending-load path is
// untouched.
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
  // Phase 88.6-27: what the month view was last handed. The child is still stubbed to render
  // nothing — it just records, so the stale-generation arm can read WHICH response won.
  monthViewEvents: [] as unknown[],
  monthViewRenders: 0,
}));

// Phase 88.6-27 (AC-2): the house logger, spied rather than stubbed away — WHICH channel the
// fetch failure uses, and WHAT it passes, are the assertions.
const loggerSpies = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  // `errCtx` is the REAL one: the ctx-shape assertion is about what the CALL SITE passes.
  return { ...actual, logger: { ...actual.logger, info: loggerSpies.info } };
});

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: h.isError, error: null, refetch: vi.fn() },
    isPending: !h.selfUuid && !h.isError,
  }),
}));

vi.mock('@/components/ui/useFetchErrorState', () => ({
  useFetchErrorState: (q: { isError?: boolean }) => ({
    showError: Boolean(q?.isError),
    message: '',
    code: 'unknown',
    retry: vi.fn(),
  }),
}));
// Phase 88.6-27: the stub now carries `reportContext` through. There are TWO error branches in
// this component now — identity resolution and the events fetch — and they render the SAME
// banner in the SAME card frame, so a single `data-testid` could not tell them apart. The
// context string is what each branch names itself by.
vi.mock('@/components/ui/FetchErrorBanner', () => ({
  FetchErrorBanner: ({
    state,
    reportContext,
  }: {
    state: { showError: boolean };
    reportContext?: string;
  }) =>
    state.showError ? (
      <div data-testid="identity-degrade-banner" data-context={reportContext}>
        degraded
      </div>
    ) : null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// Stub the calendar child views — the error branch returns before they render.
vi.mock('@/app/components/CalendarMonthView', () => ({
  default: ({ activeEvents }: { activeEvents: unknown[] }) => {
    h.monthViewEvents = activeEvents;
    h.monthViewRenders += 1;
    return null;
  },
}));
vi.mock('@/app/components/CalendarListView', () => ({ default: () => null }));
vi.mock('@/app/components/EventDayModal', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: { getUserEvents: vi.fn().mockResolvedValue([]) },
  };
});

import EventCalendar from './EventCalendar';
import { eventsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  h.isError = false;
  h.monthViewEvents = [];
  h.monthViewRenders = 0;
  loggerSpies.info.mockClear();
});

afterEach(cleanup);

describe('EventCalendar terminal identity failure (WR-03)', () => {
  it('renders the error banner (not a stuck "Loading calendar...") in self-fetch mode when identity errors', async () => {
    h.selfUuid = undefined;
    h.isError = true;

    render(<EventCalendar />); // self-fetch mode: externalEvents defaults to null

    expect(await screen.findByTestId('identity-degrade-banner')).toBeInTheDocument();
    expect(screen.queryByText('Loading calendar...')).not.toBeInTheDocument();
    // The identity-gated self-fetch never fires.
    await new Promise((r) => setTimeout(r, 20));
    expect(eventsAPI.getUserEvents as Mock).not.toHaveBeenCalled();
  });

  it('does NOT show the identity error banner when events are supplied externally', async () => {
    // External-events mode: parent owns loading, calendar never gates on selfUuid,
    // so an identity error must NOT hijack the calendar with a banner.
    h.selfUuid = undefined;
    h.isError = true;

    // EventCalendar is untyped JS whose `events` prop infers as null; spread a
    // typed-any bag to supply the external-events array without a type clash.
    const extProps: any = { events: [] };
    render(<EventCalendar {...extProps} />);

    expect(screen.queryByTestId('identity-degrade-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading calendar...')).not.toBeInTheDocument();
  });

  it('still shows "Loading calendar..." (no banner) while identity is merely pending', async () => {
    h.selfUuid = undefined;
    h.isError = false;

    render(<EventCalendar />);

    expect(await screen.findByText('Loading calendar...')).toBeInTheDocument();
    expect(screen.queryByTestId('identity-degrade-banner')).not.toBeInTheDocument();
  });
});

// Phase 88.6-27 — UI-SPEC §6.2 (error before empty), §6.4 (the logger contract) and
// R2 #45/#122 (the phase's one cancelled-generation staleness idiom).
//
// The shipped catch logged to `console.error` and then called `setInternalEvents([])`, so a
// FAILED fetch and an EMPTY calendar were indistinguishable downstream: the app told someone
// there was nothing on their calendar when the truth was that it could not find out. That is the
// same rule this plan enforces on this component's own hosts, being violated inside it.
describe('EventCalendar — a FAILED events fetch is not an empty calendar (§6.2)', () => {
  const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  type Mocked = ReturnType<typeof vi.fn>;
  const eventsMock = () => eventsAPI.getUserEvents as Mocked;

  it('renders the calendar error banner, and NEVER the month grid, when the fetch rejects', async () => {
    h.selfUuid = SELF;
    eventsMock().mockRejectedValue(new Error('network down'));

    render(<EventCalendar />);

    const banner = await screen.findByTestId('identity-degrade-banner');
    // NAMED, not just present: this is the EVENTS-fetch branch, not the identity branch it
    // shares a frame with. Without this the assertion would pass against the wrong branch.
    expect(banner).toHaveAttribute('data-context', 'event calendar — events fetch');
    // The grid is never reached — an empty calendar is exactly what this branch replaces.
    expect(h.monthViewRenders).toBe(0);
    expect(screen.queryByText('Loading calendar...')).not.toBeInTheDocument();
  });

  it('reports the failure through the house logger, with the error name and message and NOT the raw Error', async () => {
    h.selfUuid = SELF;
    eventsMock().mockRejectedValue(new Error('network down'));

    render(<EventCalendar />);
    await screen.findByTestId('identity-degrade-banner');

    expect(loggerSpies.info).toHaveBeenCalledTimes(1);
    const [msg, ctx] = loggerSpies.info.mock.calls[0];
    expect(msg).toBe('Error fetching events');
    // `errCtx`'s shape exactly: name AND message, nothing else. The shipped call passed a bare
    // string, so the NAME is a deliberate (and disclosed) widening of what egresses.
    expect(ctx).toEqual({ name: 'Error', message: 'network down' });
    expect(ctx).not.toBeInstanceOf(Error);
  });

  it('a successful fetch still renders the grid and files no report', async () => {
    // THE POSITIVE CONTROL. Without it, a component that always errored would satisfy both
    // assertions above.
    h.selfUuid = SELF;
    eventsMock().mockResolvedValue([{ id: 'e1', start_date: '2026-09-04T18:00:00.000Z' }]);

    render(<EventCalendar />);

    await vi.waitFor(() => expect(h.monthViewRenders).toBeGreaterThan(0));
    expect(h.monthViewEvents).toHaveLength(1);
    expect(screen.queryByTestId('identity-degrade-banner')).not.toBeInTheDocument();
    expect(loggerSpies.info).not.toHaveBeenCalled();
  });
});

describe('EventCalendar — the cancelled-generation guard (R2 #45/#122)', () => {
  const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  type Mocked = ReturnType<typeof vi.fn>;
  const eventsMock = () => eventsAPI.getUserEvents as Mocked;

  it('a SUPERSEDED response cannot overwrite the current one', async () => {
    // THE DISCRIMINATING CASE. `fetchEvents` awaits and then writes state on every path with no
    // flag and no cleanup, and the mount effect returned nothing at all. So an in-flight
    // generation-1 response that settles AFTER generation 2 used to win by arriving last — the
    // user sees the list for a refreshKey they have already left.
    //
    // Both responses resolve; nothing here rejects. That matters: this arm is about STALENESS,
    // not failure, so it cannot pass by accident on the error branch above.
    h.selfUuid = SELF;
    let settleStale: (v: unknown) => void = () => {};
    eventsMock().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleStale = resolve;
        })
    );
    eventsMock().mockResolvedValue([{ id: 'fresh', start_date: '2026-09-06T18:00:00.000Z' }]);

    const { rerender } = render(<EventCalendar refreshKey={0} />);
    // Generation 2: a dep change tears down generation 1 (invalidating its flag) and refetches.
    rerender(<EventCalendar refreshKey={1} />);
    await vi.waitFor(() => expect(h.monthViewEvents).toHaveLength(1));
    expect((h.monthViewEvents[0] as { id: string }).id).toBe('fresh');

    // NOW the stale generation settles, last.
    await act(async () => {
      settleStale([{ id: 'stale', start_date: '2026-09-01T18:00:00.000Z' }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.monthViewEvents).toHaveLength(1);
    expect((h.monthViewEvents[0] as { id: string }).id).toBe('fresh');
  });
});
