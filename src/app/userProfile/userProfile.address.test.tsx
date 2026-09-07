// Phase 88.8 plan 13 Task 3 (SPEC R12, BOPS-05) — ONE ADDRESS IN THE UI.
//
// The header address line under the username used to render the Auth0 SESSION
// email. This phase makes `Users.email` changeable, so that line would show the
// address the user just moved AWAY from while the new Email section a few
// hundred pixels below showed the new one — two addresses on one page, one of
// them wrong, immediately after the user changed it.
//
// Three things are pinned here, and the third is the one that would otherwise be
// a REGRESSION INTRODUCED BY THIS TASK'S OWN FIX: switching the line from the
// session email (always a real address) to `Users.email` is exactly what puts
// the provisioning sentinel `<sub>@auth0.local` on screen — for the very
// population plans 01/04/05 exist to repair.
//
// Harness follows the shipped `userProfile.identity.test.tsx` convention.
import * as React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_EMAIL = 'session-only@example.com';
const APP_EMAIL = 'app-address@example.com';
const SYNTHETIC = 'google-oauth2-1|xyz@auth0.local';

const h = vi.hoisted(() => ({
  self: undefined as undefined | Record<string, unknown>,
  selfUuid: undefined as string | undefined,
  isError: false,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.self,
    query: { isError: h.isError, error: null, isPending: !h.self, refetch: vi.fn() },
    isPending: !h.self && !h.isError,
  }),
}));

vi.mock('@/lib/hooks/selfIdentityCache', () => ({ patchSelfCache: vi.fn() }));

// The SESSION email is DELIBERATELY different from the app address in every
// case below. A fixture where the two agree discriminates nothing — it is the
// same trap plan 04's username filter carries.
vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({
    user: { sub: 'auth0|self', name: 'Self', email: SESSION_EMAIL, picture: null },
    error: null,
    isLoading: false,
  }),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }) }));
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
vi.mock('@/components/ui/FetchErrorBanner', () => ({ FetchErrorBanner: () => null }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

// The section is stubbed so the HEADER's own rendering is what is under test —
// but the module's real exports are kept, so `NO_ADDRESS_ON_FILE` below is the
// SAME constant the section uses. If the page ever re-spells that fixed string
// instead of importing it, these tests fail. That is the point.
vi.mock('@/app/components/EmailAddressSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/EmailAddressSection')>();
  return { ...actual, EmailAddressSection: () => null };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    userGamesAPI: { ...actual.userGamesAPI, getOwnedGames: vi.fn().mockResolvedValue([]) },
    googleCalendarAPI: {
      ...actual.googleCalendarAPI,
      getStatus: vi.fn().mockResolvedValue({ connected: false }),
    },
    usersAPI: { ...actual.usersAPI, updateUsername: vi.fn().mockResolvedValue({}) },
  };
});

import Profile from './page';
import { NO_ADDRESS_ON_FILE } from '@/app/components/EmailAddressSection';

beforeEach(() => {
  vi.clearAllMocks();
  h.self = undefined;
  h.selfUuid = undefined;
  h.isError = false;
});

afterEach(cleanup);

/** The header zone: the username heading's containing block. */
function headerZone(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 1 });
  return heading.closest('div')?.parentElement as HTMLElement;
}

describe('userProfile header address line — ONE address (SPEC R12)', () => {
  it('renders the APP address (self.email), NOT the Auth0 session email', () => {
    h.self = { id: SELF_UUID, user_id: SELF_UUID, username: 'Self', email: APP_EMAIL };
    h.selfUuid = SELF_UUID;
    render(<Profile />);

    expect(within(headerZone()).getByText(APP_EMAIL)).toBeInTheDocument();
    expect(screen.queryByText(SESSION_EMAIL)).not.toBeInTheDocument();
  });

  it('falls back to the session email ONLY when the self row never resolved', () => {
    // The ONE surviving session-email read in the app, and only because there is
    // no other source in this arm: `profileLoaded` flips true on the terminal
    // path (page.js:809-821) and the line would otherwise render blank.
    h.self = undefined;
    h.isError = true;
    render(<Profile />);

    expect(screen.getByText(SESSION_EMAIL)).toBeInTheDocument();
  });

  it('renders the SHARED no-address copy for a SYNTHETIC self row — never the sentinel, never the session address', () => {
    h.self = { id: SELF_UUID, user_id: SELF_UUID, username: 'Self', email: SYNTHETIC };
    h.selfUuid = SELF_UUID;
    const { container } = render(<Profile />);

    expect(within(headerZone()).getByText(NO_ADDRESS_ON_FILE)).toBeInTheDocument();
    // The sentinel is never printed…
    expect(container.textContent).not.toContain('@auth0');
    // …and a real session address is NOT substituted for it either. That would
    // be the stale-value defect this whole task removes.
    expect(screen.queryByText(SESSION_EMAIL)).not.toBeInTheDocument();
  });

  it('THE MIRROR: a real self address IS rendered — the guard is not "always show the no-address copy"', () => {
    h.self = { id: SELF_UUID, user_id: SELF_UUID, username: 'Self', email: APP_EMAIL };
    h.selfUuid = SELF_UUID;
    const { container } = render(<Profile />);
    expect(container.textContent).not.toContain(NO_ADDRESS_ON_FILE);
  });
});
