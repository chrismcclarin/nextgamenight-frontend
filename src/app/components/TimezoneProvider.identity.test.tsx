// Phase 87.5 Plan 09 (SPEC Req 6): behavioral net for the TimezoneProvider
// sender flip. The timezone persist lives INSIDE the user-action setTimezone
// callback (NOT a mount effect), so this test proves two things:
//
//  (a) invoking setTimezone via the provider context with selfUuid resolved
//      persists the caller's UUID (not user.sub); and
//  (b) mounting the provider — and selfUuid transitioning undefined→resolved —
//      does NOT persist anything on its own. This guards the locked Phase 62
//      "no auto-sync from mount-time browser detection" policy: a mount-fire
//      send here would reintroduce the silent profile-TZ-overwrite bug.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const h = vi.hoisted(() => ({ selfUuid: undefined as string | undefined }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self', timezone: null } : undefined,
    query: { isError: false, error: null, isPending: !h.selfUuid, refetch: vi.fn() },
    isPending: !h.selfUuid,
  }),
}));

vi.mock('@/lib/hooks/selfIdentityCache', () => ({ patchSelfCache: vi.fn() }));

// ML-02 (87.5 review): the pre-resolution guard surfaces via toast, not throw —
// mock sonner so the guard test can assert the user actually gets feedback.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));

vi.mock('@/lib/datetime', () => ({ detectBrowserTimezone: () => 'UTC' }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    usersAPI: { ...actual.usersAPI, updateTimezone: vi.fn().mockResolvedValue({}) },
  };
});

import { TimezoneProvider, useTimezone } from './TimezoneProvider';
import { usersAPI } from '@/lib/api';
import { toast } from 'sonner';

type Mock = ReturnType<typeof vi.fn>;

function TZConsumer() {
  // The context's default value types setTimezone as `() => void`; the live
  // provider value is the async `(tz) => Promise<void>` callback. Narrow it here.
  const { setTimezone } = useTimezone() as unknown as {
    setTimezone: (tz: string) => Promise<void>;
  };
  return (
    <button onClick={() => { void setTimezone('America/Chicago'); }}>set-tz</button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
});

afterEach(cleanup);

describe('TimezoneProvider identity flip (Plan 09 Task 2)', () => {
  it('persists the resolved selfUuid when setTimezone is invoked by the user', async () => {
    h.selfUuid = SELF_UUID;
    render(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );

    fireEvent.click(screen.getByText('set-tz'));

    await waitFor(() =>
      expect(usersAPI.updateTimezone as Mock).toHaveBeenCalledWith(SELF_UUID, 'America/Chicago')
    );
  });

  it('does NOT persist on mount or on selfUuid resolving alone (locked Phase 62 no-auto-sync)', async () => {
    // Mount with identity unresolved — no user action.
    h.selfUuid = undefined;
    const { rerender } = render(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(usersAPI.updateTimezone as Mock).not.toHaveBeenCalled();

    // Identity resolves — still no user action, so still no persist.
    h.selfUuid = SELF_UUID;
    rerender(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(usersAPI.updateTimezone as Mock).not.toHaveBeenCalled();
  });

  it('ML-02: setTimezone before identity resolves toasts an error and sends nothing (no throw — sole caller is fire-and-forget)', async () => {
    h.selfUuid = undefined; // logged-in (mocked auth sub) but identity unresolved
    render(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );

    // Fires the guard; must NOT reject (the click handler does not await).
    fireEvent.click(screen.getByText('set-tz'));

    await waitFor(() => expect(toast.error as Mock).toHaveBeenCalled());
    expect(usersAPI.updateTimezone as Mock).not.toHaveBeenCalled();
  });
});
