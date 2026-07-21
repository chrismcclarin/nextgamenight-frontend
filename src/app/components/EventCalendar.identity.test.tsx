// Phase 87.5 WR-03: in self-fetch mode (externalEvents === null) EventCalendar
// gates its fetch on selfUuid; fetchEvents early-returns on `!selfUuid` before
// its try/finally, so a TERMINAL identity failure leaves `loading` (init true)
// stuck forever — "Loading calendar..." with no affordance. These tests prove
// the new terminal-error branch renders the calendar's error banner in place of
// the stuck spinner (self-fetch mode only), and that the pending-load path is
// untouched.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
}));

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
vi.mock('@/components/ui/FetchErrorBanner', () => ({
  FetchErrorBanner: ({ state }: { state: { showError: boolean } }) =>
    state.showError ? <div data-testid="identity-degrade-banner">degraded</div> : null,
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
vi.mock('@/app/components/CalendarMonthView', () => ({ default: () => null }));
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
