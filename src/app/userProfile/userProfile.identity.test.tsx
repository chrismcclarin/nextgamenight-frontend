// Phase 87.5 Plan 09 (SPEC Req 6): behavioral net for the userProfile census §3
// sender flip to the caller's resolved Users.id UUID (selfUuid). Two runtime
// proofs the source-grep can't give:
//
//  (a) A GATED MOUNT-FIRE sender (owned-games fetch) must NOT fire while selfUuid
//      is unresolved, and MUST fire once selfUuid transitions undefined→resolved.
//      This proves the `if (!selfUuid) return;` gate AND the matching `selfUuid`
//      dep-array entry work together at runtime — a gate without the dep entry
//      would be a permanent no-op that a text grep would still pass.
//
//  (b) A USER-ACTION sender (notif-prefs email toggle) whose optimistic
//      setPreferences runs BEFORE the send must fail LOUD (visible "Error"
//      status) and send NOTHING while selfUuid is unresolved, then send the
//      resolved UUID once identity lands. This proves the guard sits before the
//      optimistic update (D-02) — a guard placed after it would leave the UI
//      showing an un-sent change with no rollback.
//
// Follows the established `<name>.identity.test.tsx` convention
// (groupHomePage/gameDetail/FriendshipStatusProvider).
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const DEFAULT_PREFS = {
  event_created: { email: true, sms: false },
  reminder: { email: true, sms: false, window_hours: 1 },
  event_updated: { email: true, sms: false },
  event_cancelled: { email: true, sms: false },
};

// Mutable identity the mocked hook reads. `self` and `selfUuid` are controlled
// INDEPENDENTLY here so case (b) can present a resolved self row (UI renders,
// preferences populate) while selfUuid is still undefined — the exact condition
// that exercises the pre-optimistic-update guard in isolation.
const h = vi.hoisted(() => ({
  self: undefined as undefined | Record<string, unknown>,
  selfUuid: undefined as string | undefined,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.self,
    query: { isError: false, error: null, isPending: !h.self, refetch: vi.fn() },
    isPending: !h.self,
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

// The page pulls only useQueryClient + useQuery from react-query; patternsQuery
// is neutralized so the availability fetch never touches the network.
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

// Provider hooks the page consumes (their own senders are covered by the
// TimezoneProvider/TutorialProvider identity tests).
vi.mock('@/app/components/tutorial/TutorialProvider', () => ({
  useTutorial: () => ({ replayTutorial: vi.fn() }),
}));
vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// Heavy / irrelevant children stubbed to isolate the sender logic.
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/DangerZoneDeleteAccount', () => ({ default: () => null }));
vi.mock('@/components/ui/FetchErrorBanner', () => ({ FetchErrorBanner: () => null }));
vi.mock('@/components/ui/useFetchErrorState', () => ({
  useFetchErrorState: () => ({ showError: false }),
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    userGamesAPI: {
      ...actual.userGamesAPI,
      getOwnedGames: vi.fn().mockResolvedValue([]),
      addOwnedGame: vi.fn().mockResolvedValue({}),
      removeOwnedGame: vi.fn().mockResolvedValue({}),
      importBGGCollection: vi.fn().mockResolvedValue({ imported: 0 }),
    },
    googleCalendarAPI: {
      ...actual.googleCalendarAPI,
      getStatus: vi.fn().mockResolvedValue({ connected: false }),
      disconnect: vi.fn().mockResolvedValue({}),
    },
    usersAPI: {
      ...actual.usersAPI,
      updateNotificationPreferences: vi.fn().mockResolvedValue({}),
      updateUsername: vi.fn().mockResolvedValue({ username: 'Self' }),
      savePhone: vi.fn().mockResolvedValue({}),
      verifyPhone: vi.fn().mockResolvedValue({}),
      removePhone: vi.fn().mockResolvedValue({}),
      resetTutorial: vi.fn().mockResolvedValue({}),
    },
    availabilityAPI: {
      ...actual.availabilityAPI,
      createRecurringPattern: vi.fn().mockResolvedValue({}),
      createOverride: vi.fn().mockResolvedValue({}),
      deleteAvailability: vi.fn().mockResolvedValue({}),
    },
  };
});

import Profile from './page';
import { userGamesAPI, usersAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.self = undefined;
  h.selfUuid = undefined;
});

afterEach(cleanup);

describe('userProfile identity flip (SPEC Req 6, Plan 09 Task 1)', () => {
  it('gated mount-fire owned-games send fires only once selfUuid resolves from undefined', async () => {
    // Mount with identity UNRESOLVED — the mount effect runs fetchOwnedGames(),
    // but the selfUuid gate short-circuits it: no send.
    const { rerender } = render(<Profile />);
    await new Promise((r) => setTimeout(r, 20));
    expect(userGamesAPI.getOwnedGames as Mock).not.toHaveBeenCalled();

    // Identity resolves — fetchOwnedGames re-creates (selfUuid dep) and the mount
    // effect re-runs, so the gated send NOW fires with the caller UUID.
    h.self = { id: SELF_UUID, user_id: 'auth0|self', notification_preferences: DEFAULT_PREFS };
    h.selfUuid = SELF_UUID;
    rerender(<Profile />);

    await waitFor(() =>
      expect(userGamesAPI.getOwnedGames as Mock).toHaveBeenCalledWith(SELF_UUID)
    );
  });

  it('notif-prefs email toggle fails loud with no send until selfUuid resolves, then sends the caller UUID', async () => {
    // Resolved self row (so preferences populate + the toggle renders) but
    // selfUuid still undefined — isolates the pre-optimistic-update guard.
    h.self = { id: SELF_UUID, user_id: 'auth0|self', notification_preferences: DEFAULT_PREFS };
    h.selfUuid = undefined;

    const { rerender } = render(<Profile />);

    const toggle = await screen.findByLabelText('New Event email notifications');

    // Act before identity resolves: guard fires BEFORE the optimistic
    // setPreferences → visible "Error", and NOTHING is sent.
    fireEvent.click(toggle);
    expect(await screen.findByText('Error')).toBeInTheDocument();
    expect(usersAPI.updateNotificationPreferences as Mock).not.toHaveBeenCalled();

    // Identity resolves — the same action now sends the caller UUID.
    h.selfUuid = SELF_UUID;
    rerender(<Profile />);

    fireEvent.click(await screen.findByLabelText('New Event email notifications'));
    await waitFor(() =>
      expect(usersAPI.updateNotificationPreferences as Mock).toHaveBeenCalledWith(
        SELF_UUID,
        expect.any(Object)
      )
    );
  });
});
