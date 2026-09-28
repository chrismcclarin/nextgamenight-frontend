// groupPlanning/page.js — the page's FIRST render suite (plan 88.6-53, gap closure 2026-09-28).
//
// VERIFICATION gap 2 found this page swept by nobody while four rosters held its sites green.
// This suite pins what the sweep must NOT move — the three headings' semantic LEVELS and their
// exact text (P4, P1) — plus the breadcrumb's landmark name and "you are here" marker.
//
// Mock surface copied from groupHomePage.identity.test.tsx, with ONE deliberate change: the
// useUser mock returns a MODULE-LEVEL constant user. The page's fetch effect depends on the
// `user` OBJECT (deps [user, groupId, selfUuid]), so a fresh literal per call — the identity
// suite's shape — would re-run the four fetches after every state update, an endless loop.
// The same reasoning keeps the search params and the identity query constant.
//
// Synthetic identity only (T-88.1-02).
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => ({
  USER: { sub: 'auth0|self' },
  PARAMS: new URLSearchParams('group_id=G1'),
  ROUTER: { replace: () => undefined, push: () => undefined },
  QUERY: { isError: false, error: null, refetch: () => undefined },
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: h.QUERY,
    isPending: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.PARAMS,
  useRouter: () => h.ROUTER,
  usePathname: () => '/groupPlanning',
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: h.USER, isLoading: false }),
}));

// Stub the heavy children — this suite pins the page's own chrome, not theirs.
vi.mock('@/app/components/createEvent', () => ({ default: () => null }));
vi.mock('@/app/components/ResponseDashboard', () => ({ default: () => null }));
vi.mock('@/app/components/PromptScheduleSection', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { getGroup: vi.fn(), getGroupMembers: vi.fn() },
    eventsAPI: { getGroupEvents: vi.fn() },
    promptAPI: { getActivePrompt: vi.fn(), getPromptById: vi.fn() },
  };
});

import GroupPlanningPage from './page';
import { eventsAPI, groupsAPI, promptAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // NO `Users` on the group: production's GET /groups/:group_id returns a bare Group.findByPk
  // with no include (periodictabletopbackend_v2/Sonnet/routes/groups.js, the group GET), so the
  // page ALWAYS takes its getGroupMembers fallback. A `Users` array here would pin a path
  // production never takes.
  (groupsAPI.getGroup as Mock).mockResolvedValue({ id: 'G1', name: 'Weekend Warriors' });
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue([
    { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'owner' } },
  ]);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  // 'active' is a real AvailabilityPrompt.status value ('pending' | 'active' | 'closed' | 'converted').
  (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: { id: 'P1', status: 'active' } });
});

afterEach(cleanup);

/** Settle on the branch-specific heading: it only renders once the poll fetch has landed. */
async function renderSettled() {
  render(<GroupPlanningPage />);
  await screen.findByRole('heading', { level: 3, name: 'Poll Responses' });
  // The page title carries the group name only after the group GET lands; the fallback
  // "Plan Game Session" renders first, so settle on the name-bearing title explicitly.
  await screen.findByRole('heading', { level: 1, name: 'Plan Game Session - Weekend Warriors' });
}

describe('groupPlanning page — heading outline (P4 levels, P1 wording)', () => {
  it('renders exactly one level-1 page title carrying the group name', async () => {
    await renderSettled();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Plan Game Session - Weekend Warriors');
  });

  it('renders the "Availability Polls" section at level 2 and "Poll Responses" at level 3', async () => {
    await renderSettled();
    expect(screen.getByRole('heading', { level: 2, name: 'Availability Polls' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Poll Responses' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });

  it('keeps the page title reachable through the breadcrumb landmark wording', async () => {
    await renderSettled();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Weekend Warriors' })).toHaveAttribute(
      'href',
      '/groupHomePage?id=G1',
    );
    expect(within(nav).getByText('Plan Game Session')).toBeInTheDocument();
  });
});
