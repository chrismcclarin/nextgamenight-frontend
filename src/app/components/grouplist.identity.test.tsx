// Phase 87.5 WR-03: GroupList must not hang forever when the self-identity query
// fails TERMINALLY. fetchGroups gates on `!selfUuid` and early-returns BEFORE its
// try/finally, so `loading` (init true) never clears on terminal failure — the
// "Loading groups..." spinner would spin forever and the in-list D-08 degrade
// banner (rendered below that loading return) is UNREACHABLE. These tests prove
// the new terminal-error branch surfaces the compact degrade banner in place of
// the stuck spinner, and that the normal pending-load path is untouched.
//
// Follows the established `<name>.identity.test.tsx` convention
// (groupHomePage.identity.test.tsx shows the useSelfIdentity mocking approach).
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mutable identity the mocked hook reads: `selfUuid` (resolved?) + `isError`
// (terminal failure?). Each case flips these to present pending vs. errored.
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

// Keep the error-surface primitives light + deterministic: showError follows the
// mocked query.isError, and the banner renders a marker only when showError.
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

// Stub children irrelevant to the identity gate.
vi.mock('@/app/components/GroupSettings', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/ClickableMemberName', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { getUserGroups: vi.fn().mockResolvedValue([]) },
  };
});

import GroupList from './grouplist';
import { groupsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

// GroupList is untyped JS; its destructured props infer as required. Spread a
// typed-any props bag so the JSX doesn't demand the unrelated callback props.
const listProps: any = { user: { sub: 'auth0|self' } };

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  h.isError = false;
});

afterEach(cleanup);

describe('GroupList terminal identity failure (WR-03)', () => {
  it('renders the degrade banner (not a stuck "Loading groups...") when identity errors terminally', async () => {
    h.selfUuid = undefined;
    h.isError = true;

    render(<GroupList {...listProps} />);

    // Banner is now REACHABLE — it renders in place of the perpetual spinner.
    expect(await screen.findByTestId('identity-degrade-banner')).toBeInTheDocument();
    // The stuck loading text must be gone.
    expect(screen.queryByText('Loading groups...')).not.toBeInTheDocument();
    // The identity-gated groups fetch never fires (no selfUuid).
    await new Promise((r) => setTimeout(r, 20));
    expect(groupsAPI.getUserGroups as Mock).not.toHaveBeenCalled();
  });

  it('still shows "Loading groups..." (no banner) while identity is merely pending', async () => {
    h.selfUuid = undefined;
    h.isError = false;

    render(<GroupList {...listProps} />);

    // Normal pre-resolution loading path is untouched.
    expect(await screen.findByText('Loading groups...')).toBeInTheDocument();
    expect(screen.queryByTestId('identity-degrade-banner')).not.toBeInTheDocument();
  });
});
