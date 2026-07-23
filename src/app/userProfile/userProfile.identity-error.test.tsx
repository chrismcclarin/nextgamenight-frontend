// Phase 87.5 WR-03: the userProfile owned-games + Google-calendar-status zones
// init their loading flags to true and clear them ONLY inside selfUuid-gated
// fetchers. On a TERMINAL self-identity failure those fetchers early-return, so
// the flags never clear and both zones spin forever ("Loading your
// collection..." / "Checking..."). The profile header already falls back via
// selfQuery.isError — these two zones did not. This test proves both zones now
// render the degrade banner instead of an indefinite spinner on terminal failure.
//
// Sibling of userProfile.identity.test.tsx (the sender-flip net), kept separate
// so this file can present query.isError=true + showError=true without disturbing
// the other file's showError:false stubs.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Terminal identity failure: selfUuid never resolves, query.isError is true.
vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: undefined,
    self: undefined,
    query: { isError: true, error: null, isPending: false, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/selfIdentityCache', () => ({
  patchSelfCache: vi.fn(),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({
    user: { sub: 'auth0|self', name: 'Self', email: 'self@example.com', picture: null },
    error: null,
    isLoading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast };
});

vi.mock('@/app/components/tutorial/TutorialProvider', () => ({
  useTutorial: () => ({ replayTutorial: vi.fn() }),
}));
vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/DangerZoneDeleteAccount', () => ({ default: () => null }));

// showError follows the identity query's isError; the banner renders a marker
// only when showError so we can count the two degraded zones.
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
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    userGamesAPI: {
      ...actual.userGamesAPI,
      getOwnedGames: vi.fn().mockResolvedValue([]),
    },
    googleCalendarAPI: {
      ...actual.googleCalendarAPI,
      getStatus: vi.fn().mockResolvedValue({ connected: false }),
    },
    usersAPI: { ...actual.usersAPI },
    availabilityAPI: { ...actual.availabilityAPI },
  };
});

import Profile from './page';
import { userGamesAPI, googleCalendarAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('userProfile terminal identity failure (WR-03)', () => {
  it('renders degrade banners instead of stuck "Loading your collection..." / "Checking..."', async () => {
    render(<Profile />);

    // Both selfUuid-gated fetchers never fire (identity never resolves).
    await new Promise((r) => setTimeout(r, 20));
    expect(userGamesAPI.getOwnedGames as Mock).not.toHaveBeenCalled();
    expect(googleCalendarAPI.getStatus as Mock).not.toHaveBeenCalled();

    // Neither zone is stuck on its loading text...
    expect(screen.queryByText('Loading your collection...')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking...')).not.toBeInTheDocument();

    // ...both surface the degrade banner instead (collection zone + calendar zone).
    const banners = await screen.findAllByTestId('identity-degrade-banner');
    expect(banners.length).toBeGreaterThanOrEqual(2);
  });
});
