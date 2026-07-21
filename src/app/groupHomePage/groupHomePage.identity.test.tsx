// Phase 87.3-05 (Task 2): membership/removal gate must treat an unresolved
// self-identity query as LOADING, never as "removed". On a cold cache the
// members fetch races the identity query; if the removal redirect fired while
// selfUuid is still undefined, the find would miss and bounce an ACTIVE member
// off their own group page. This test mounts the page with a pending identity
// query and asserts no removed-redirect fires (loading is shown instead), plus
// the positive path where a resolved member passes the gate without redirect.
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mutable self-identity the mocked hook reads so each case can present a
// pending (undefined selfUuid) or resolved identity.
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isPending: true,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: h.isPending,
  }),
}));

const pushSpy = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=GROUP1'),
  useRouter: () => ({ push: pushSpy }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

// Stub the heavy children — this test only exercises the membership gate.
vi.mock('@/app/components/createEvent', () => ({ default: () => null }));
vi.mock('@/app/components/ManageMembers', () => ({ default: () => null }));
vi.mock('@/app/components/GroupGamesList', () => ({ default: () => null }));
vi.mock('@/app/components/EventCalendar', () => ({ default: () => null }));
vi.mock('@/app/components/PendingMemberBanner', () => ({ default: () => null }));
vi.mock('@/app/components/GroupLibrary', () => ({ default: () => null }));
vi.mock('@/app/components/KebabMenu', () => ({ default: () => null }));
vi.mock('@/app/components/GroupSettings', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { getGroup: vi.fn(), getGroupMembers: vi.fn() },
    eventsAPI: { getGroupEvents: vi.fn() },
    listsAPI: { getGroupGames: vi.fn() },
  };
});

import GroupHomePage from './page';
import { groupsAPI, eventsAPI, listsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const ROSTER = [
  { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'member' } },
  { id: 'other-uuid', user_id: 'auth0|other', username: 'Other', UserGroup: { role: 'owner' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  h.isPending = true;
  (groupsAPI.getGroup as Mock).mockResolvedValue({ id: 'GROUP1', name: 'My Group' });
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  (listsAPI.getGroupGames as Mock).mockResolvedValue([]);
});

afterEach(cleanup);

describe('groupHomePage membership gate vs unresolved identity', () => {
  it('does NOT redirect-as-removed while the identity query is unresolved (shows loading)', async () => {
    // Pending identity: selfUuid undefined.
    render(<GroupHomePage />);

    // The page stays on the "Loading group…" gate...
    expect(await screen.findByText('Loading group…')).toBeInTheDocument();

    // ...and the members fetch should not even fire the membership derive, so
    // the removed-redirect never happens. Give any stray async a tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('passes the membership gate (no redirect) once identity resolves to a member', async () => {
    // Resolved identity matching an active member.
    h.selfUuid = SELF_UUID;
    h.isPending = false;

    render(<GroupHomePage />);

    // Membership confirmed → the games fetch fires (proves membershipChecked
    // flipped true without a redirect).
    await waitFor(() => expect(listsAPI.getGroupGames as Mock).toHaveBeenCalled());
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

// PR2-L11 (SPEC Req 7): getGroup + fetchGroupEvents must NOT re-fire when
// selfUuid resolves. On a hard load identity resolves asynchronously AFTER the
// mount effect's first run; if getGroup/getGroupEvents shared the selfUuid-gated
// effect they would fetch a second, wasted time. Splitting them off the selfUuid
// dep makes each fire exactly once. getGroupMembers stays selfUuid-gated (it
// legitimately re-runs to recompute the membership derive once identity lands).
describe('groupHomePage double-fetch — single-fire per hard load', () => {
  it('fires getGroup + getGroupEvents exactly once across async identity resolution', async () => {
    // Hard load: mount with identity still pending (selfUuid undefined)...
    h.selfUuid = undefined;
    h.isPending = true;
    const { rerender } = render(<GroupHomePage />);

    // ...then identity resolves post-mount, triggering a re-render. In the
    // pre-split code this re-runs the combined effect and double-fetches
    // getGroup/getGroupEvents; after the split it must not.
    h.selfUuid = SELF_UUID;
    h.isPending = false;
    rerender(<GroupHomePage />);

    // getGroupMembers re-runs once identity resolves (still selfUuid-gated) and
    // confirms membership, so the games fetch fires — a clean anchor for "the
    // resolution re-render happened".
    await waitFor(() => expect(listsAPI.getGroupGames as Mock).toHaveBeenCalled());

    // The load-once fetches must have fired exactly once despite the resolution
    // re-render — proof the effect split removed the double-fetch.
    expect(groupsAPI.getGroup as Mock).toHaveBeenCalledTimes(1);
    expect(eventsAPI.getGroupEvents as Mock).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
