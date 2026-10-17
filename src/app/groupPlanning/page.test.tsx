// groupPlanning/page.js — the page's FIRST render suite (plan 88.6-53, gap closure 2026-09-28).
//
// VERIFICATION gap 2 found this page swept by nobody while four rosters held its sites green.
// This suite pins what the sweep must NOT move — the three headings' semantic LEVELS and their
// exact text (P4, P1) — plus the breadcrumb's landmark name and "you are here" marker.
//
// Mock surface copied from groupHomePage.identity.test.tsx, with ONE deliberate change: the
// useUser mock returns a MODULE-LEVEL constant user. The page's role effect still depends on the
// `user` OBJECT (deps [user, groupId, selfUuid]), so a fresh literal per call — the identity
// suite's shape — would re-run the role fetch after every state update, an endless loop. The
// group and poll loads now key on the user's sub instead (88.6.1-16). The same reasoning keeps
// the search params and the identity query constant within a test.
//
// Two mocks added by plan 88.6.1-16: a logger spy (the page's failure paths are Sentry
// BREADCRUMBS at info, and the ctx each one passes is asserted exactly), and a PASS-THROUGH
// FetchErrorBanner that renders the REAL component and records the state handed to the compact
// mount, so a test can read what a retry RESOLVES (the contract plan 88.6.1-21's banner reads).
//
// Synthetic identity only (T-88.1-02).
import * as React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const USER = { sub: 'auth0|self' };
  const SELF_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const DEFAULT_QUERY = { isError: false, error: null as unknown, refetch: (() => undefined) as () => unknown };
  return {
    USER,
    SELF_UUID,
    DEFAULT_QUERY,
    AUTH: { user: USER as unknown, isLoading: false },
    SELF: { uuid: SELF_UUID as string | null },
    PARAMS: new URLSearchParams('group_id=G1'),
    ROUTER: { replace: () => undefined, push: () => undefined },
    QUERY: DEFAULT_QUERY,
    // The last props the PromptScheduleSection and CreateEvent stubs received, and EVERY
    // userRole the PromptScheduleSection stub has received, in order (arm R3 reads the history,
    // so a one-render flash of another group's role cannot pass).
    pss: null as null | Record<string, unknown>,
    ce: null as null | Record<string, unknown>,
    pssRoles: [] as unknown[],
    logInfo: vi.fn(),
    // The `state` prop most recently given to a FetchErrorBanner rendered with `compact`.
    compactState: null as null | { showError: boolean; retry: () => Promise<unknown> },
  };
});

const SELF_UUID = h.SELF_UUID;

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.SELF.uuid ?? undefined,
    self: h.SELF.uuid ? { id: h.SELF.uuid, user_id: 'auth0|self' } : undefined,
    query: h.QUERY,
    isPending: !h.SELF.uuid,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => h.PARAMS,
  useRouter: () => h.ROUTER,
  usePathname: () => '/groupPlanning',
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => h.AUTH,
}));

// Stub the heavy children — this suite pins the page's own chrome, not theirs. The
// PromptScheduleSection and CreateEvent stubs record the props they receive.
vi.mock('@/app/components/createEvent', () => ({
  default: (props: Record<string, unknown>) => {
    h.ce = props;
    return null;
  },
}));
vi.mock('@/app/components/ResponseDashboard', () => ({ default: () => null }));
vi.mock('@/app/components/PromptScheduleSection', () => ({
  default: (props: Record<string, unknown>) => {
    h.pss = props;
    h.pssRoles.push(props.userRole);
    return null;
  },
}));

// The house logger idiom (EventDayModal.test.tsx): the real module, `logger.info` replaced by a
// spy, `errCtx` REAL so the asserted ctx is what the call site passes.
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { ...actual.logger, info: h.logInfo } };
});

// PASS-THROUGH: renders the REAL FetchErrorBanner (the arms assert its real region, line and
// button) and records the compact mount's `state`.
vi.mock('@/components/ui/FetchErrorBanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/FetchErrorBanner')>();
  const Real = actual.FetchErrorBanner;
  function PassThroughFetchErrorBanner(props: React.ComponentProps<typeof Real>) {
    if (props.compact) h.compactState = props.state as unknown as typeof h.compactState;
    return <Real {...props} />;
  }
  return { ...actual, FetchErrorBanner: PassThroughFetchErrorBanner };
});

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
import { ApiError, eventsAPI, groupsAPI, promptAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const OWNER_ROW = { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'owner' } };
const NOTICE = 'Some personal controls are unavailable.';

beforeEach(() => {
  vi.clearAllMocks();
  h.AUTH = { user: h.USER, isLoading: false };
  h.SELF.uuid = SELF_UUID;
  h.QUERY = h.DEFAULT_QUERY;
  h.PARAMS = new URLSearchParams('group_id=G1');
  h.pss = null;
  h.ce = null;
  h.pssRoles = [];
  h.compactState = null;
  // NO `Users` on the group: production's GET /groups/:group_id returns a bare Group.findByPk
  // with no include (periodictabletopbackend_v2/Sonnet/routes/groups.js, the group GET), so the
  // page ALWAYS takes its getGroupMembers fallback. A `Users` array here would pin a path
  // production never takes.
  (groupsAPI.getGroup as Mock).mockResolvedValue({ id: 'G1', name: 'Weekend Warriors' });
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue([OWNER_ROW]);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  // 'active' is a real AvailabilityPrompt.status value ('pending' | 'active' | 'closed' | 'converted').
  (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: { id: 'P1', status: 'active' } });
});

afterEach(cleanup);

// Settle on the branch-specific heading: it only renders once the poll fetch has landed.
async function renderSettled() {
  const result = render(<GroupPlanningPage />);
  await screen.findByRole('heading', { level: 3, name: 'Poll Responses' });
  // The page title carries the group name only after the group GET lands; the fallback
  // "Plan Game Session" renders first, so settle on the name-bearing title explicitly.
  await screen.findByRole('heading', { level: 1, name: 'Plan Game Session - Weekend Warriors' });
  return result;
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

describe('groupPlanning page — breadcrumb exposes "you are here" (plan 88.6-53 task 2)', () => {
  // Plan 21 was told to write the landmark-name assertion and did not (88.6-21-SUMMARY.md); the
  // landmark case sits in the outline describe above and is repeated here as the settle point.
  it('names the breadcrumb landmark and marks ONLY the current crumb with aria-current="page"', async () => {
    await renderSettled();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Plan Game Session')).toHaveAttribute('aria-current', 'page');
    for (const link of within(nav).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
  });

  it('hides both ">" separators from assistive tech', async () => {
    // Read by TEXT, not by accessible name: an aria-hidden separator is still in the DOM, so a
    // role-based "no > in the name" check would pass whether or not the attribute exists.
    await renderSettled();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const separators = within(nav).getAllByText('>');
    expect(separators).toHaveLength(2);
    for (const sep of separators) {
      expect(sep).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('gives both breadcrumb links the project focus ring (DECISION Phase 88.3-17)', async () => {
    await renderSettled();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.className).toContain('focus-visible:ring-2');
      expect(link.className).toContain('focus-visible:ring-focus-ring');
    }
  });
});

// A promise whose settle functions the test holds.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const lastRole = () => (h.pss as { userRole?: unknown } | null)?.userRole;

describe("groupPlanning page — the caller's role cannot load (88.6.1-16, D-25 / G6)", () => {
  it('R1: a failed role read shows the compact notice from the region that was mounted empty, and the role is null', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members request failed', 'internal', 500));
    const { container } = render(<GroupPlanningPage />);
    // Synchronously, before any read settles: ONE polite region, sr-only and empty.
    const regions = container.querySelectorAll('[role="status"]');
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region).toHaveClass('sr-only');
    expect(region.textContent).toBe('');

    await screen.findByRole('button', { name: 'Retry' });
    // The notice arrives as a TEXT CHANGE of that same node (C-6), never a new mount.
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region.textContent).toBe(NOTICE);
    expect(screen.getAllByText(NOTICE)).toHaveLength(2);
    expect(h.logInfo).toHaveBeenCalledWith('Error fetching user role:', {
      name: 'ApiError',
      message: 'members request failed',
    });
    expect(lastRole()).toBeNull();
  });

  it('R2: Retry re-runs ONLY the role read; on success the notice leaves and the role comes back', async () => {
    const user = userEvent.setup();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members request failed', 'internal', 500));
    const { container } = render(<GroupPlanningPage />);
    const region = container.querySelector('[role="status"]');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const before = (groupsAPI.getGroupMembers as Mock).mock.calls.length;

    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([OWNER_ROW]);
    await user.click(retry);
    await waitFor(() => expect(lastRole()).toBe('owner'));

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(region?.textContent).toBe('');
    // The role only — the group load did not re-run.
    expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(before + 1);
  });

  it("R3: the previous group's role never reaches a gated control, not even while the new read is open", async () => {
    const { rerender } = await renderSettled();
    await waitFor(() => expect(lastRole()).toBe('owner'));

    const g2 = deferred<unknown[]>();
    (groupsAPI.getGroupMembers as Mock).mockImplementation((id: string) =>
      id === 'G2' ? g2.promise : Promise.resolve([OWNER_ROW]),
    );
    h.pssRoles = [];
    h.PARAMS = new URLSearchParams('group_id=G2');
    rerender(<GroupPlanningPage />);

    // Synchronously after the switch — the FIRST render after it included.
    expect(h.pssRoles.length).toBeGreaterThan(0);
    expect(h.pssRoles.every((r) => r === null)).toBe(true);

    // Positive: the new group's read is open. The hold: still nothing but null.
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledWith('G2'));
    expect(h.pssRoles.every((r) => r === null)).toBe(true);

    await act(async () => {
      g2.resolve([{ ...OWNER_ROW, UserGroup: { role: 'admin' } }]);
    });
    await waitFor(() => expect(lastRole()).toBe('admin'));
  });

  // AMENDED Phase 88.6.1-63 (AC-29): with a held identity row (`selfUuid` defined) identity is not the
  // failed request, so the one notice is the ROLE failure and its Retry re-reads the role, never the
  // identity (was the reverse). The original guard's teeth (a second compact mount reds it) still hold.
  it('R4: identity AND role failing at once print ONE notice with ONE Retry, which retries the role while an identity row is held (88.6.1-63)', async () => {
    // Guard arm, green on arrival by design; its teeth (a second compact mount reds it) are
    // recorded in the plan SUMMARY.
    const user = userEvent.setup();
    const identityRefetch = vi.fn().mockResolvedValue(undefined);
    h.QUERY = { isError: true, error: new ApiError('identity failed', 'internal', 500), refetch: identityRefetch };
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members request failed', 'internal', 500));
    render(<GroupPlanningPage />);

    await waitFor(() =>
      expect(h.logInfo).toHaveBeenCalledWith('Error fetching user role:', {
        name: 'ApiError',
        message: 'members request failed',
      }),
    );
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    expect(screen.getAllByText(NOTICE)).toHaveLength(2);

    const before = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    await user.click(retries[0]);
    await waitFor(() =>
      expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(before + 1),
    );
    expect(identityRefetch).not.toHaveBeenCalled();
  });

  it('R5: the role Retry resolves its outcome — failed, failed again, succeeded; a skipped read resolves nothing', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members request failed', 'internal', 500));
    const { rerender } = render(<GroupPlanningPage />);
    await screen.findByRole('button', { name: 'Retry' });

    let r1: unknown;
    await act(async () => {
      r1 = await h.compactState!.retry();
    });
    expect(r1).toEqual({ isError: true });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getAllByText(NOTICE)).toHaveLength(2);

    // Idempotency R8 (consumer half): every failed NEWEST read says so, again.
    let r2: unknown;
    await act(async () => {
      r2 = await h.compactState!.retry();
    });
    expect(r2).toEqual({ isError: true });

    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([OWNER_ROW]);
    let r3: unknown;
    await act(async () => {
      r3 = await h.compactState!.retry();
    });
    expect(r3).toEqual({ isError: false });
    await waitFor(() => expect(lastRole()).toBe('owner'));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    // Skipped: identity gone, so the gate asks nothing. An ungated read issues its request
    // synchronously, so the count is read around the call in one synchronous block.
    h.SELF.uuid = null;
    rerender(<GroupPlanningPage />);
    const countBefore = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    const p = h.compactState!.retry();
    const countAfter = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    expect(countAfter).toBe(countBefore);
    let r: unknown = 'unset';
    await act(async () => {
      r = await p;
    });
    expect(r).toBeUndefined();
  });

  it('R6: newest wins — a superseded read writes nothing and resolves nothing (same group, then a group change)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members request failed', 'internal', 500));
    const { rerender } = render(<GroupPlanningPage />);
    await screen.findByRole('button', { name: 'Retry' });
    // Positive: the group fallback and the role read have both asked, so no settle-time request
    // can consume the deferreds below.
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledTimes(2));

    const dA = deferred<unknown[]>();
    const dB = deferred<unknown[]>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    let pA!: Promise<unknown>;
    let pB!: Promise<unknown>;
    // Two reads for the SAME group; the second models the hook's error-only refocus refetch,
    // which bypasses the Retry button's latch.
    act(() => {
      pA = h.compactState!.retry();
      pB = h.compactState!.retry();
    });

    dB.resolve([OWNER_ROW]);
    let rB: unknown;
    await act(async () => {
      rB = await pB;
    });
    expect(rB).toEqual({ isError: false });
    await waitFor(() => expect(lastRole()).toBe('owner'));

    dA.reject(new ApiError('stale', 'internal', 500));
    let rA: unknown = 'unset';
    await act(async () => {
      rA = await pA;
    });
    expect(rA).toBeUndefined();
    expect(lastRole()).toBe('owner');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText(NOTICE)).toHaveLength(0);

    // Group half: a G1 read is overtaken by a switch to G2.
    const dC = deferred<unknown[]>();
    (groupsAPI.getGroupMembers as Mock).mockImplementation((id: string) =>
      id === 'G2' ? Promise.resolve([{ ...OWNER_ROW, UserGroup: { role: 'admin' } }]) : dC.promise,
    );
    let pC!: Promise<unknown>;
    act(() => {
      pC = h.compactState!.retry();
    });
    h.PARAMS = new URLSearchParams('group_id=G2');
    rerender(<GroupPlanningPage />);
    await waitFor(() => expect(lastRole()).toBe('admin'));

    dC.reject(new ApiError('stale group', 'internal', 500));
    let rC: unknown = 'unset';
    await act(async () => {
      rC = await pC;
    });
    expect(rC).toBeUndefined();
    expect(lastRole()).toBe('admin');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('groupPlanning page — one load per visit (88.6.1-16, W060)', () => {
  it('L1: a visit and a create issue ZERO events requests; the create still closes the dialog', async () => {
    await renderSettled();
    expect(eventsAPI.getGroupEvents).not.toHaveBeenCalled();

    // Open the dialog and let the page re-render, so the next callbacks come from the OPEN render
    // (the page's toggle reads the modal state of the render it was created in).
    act(() => {
      (h.ce!.modaltoggle as () => void)();
    });
    expect(h.ce!.modal).toBe(true);

    // 88.6.1-68: the page passes no created-callback; CreateEvent's own modaltoggle() is the close.
    expect(h.ce!.onEventCreated).toBeUndefined();
    act(() => {
      (h.ce!.modaltoggle as () => void)();
    });
    expect(eventsAPI.getGroupEvents).not.toHaveBeenCalled();
    expect(h.ce!.modal).toBe(false);
  });

  it('L2: identity resolving re-derives the role but does NOT re-load the group or the poll data', async () => {
    h.SELF.uuid = null;
    const { rerender } = render(<GroupPlanningPage />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Poll Responses' });

    h.SELF.uuid = SELF_UUID;
    rerender(<GroupPlanningPage />);
    await waitFor(() => expect(lastRole()).toBe('owner'));

    expect(groupsAPI.getGroup).toHaveBeenCalledTimes(1);
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1);
    // The group fallback once and the role read once (the fallback's redundancy is Phase 89's,
    // .planning/deferred/phase-89.md, review r1 #136).
    expect(groupsAPI.getGroupMembers).toHaveBeenCalledTimes(2);
    // The poll responses were not blanked to their loading line and remounted.
    expect(await screen.findByRole('heading', { level: 3, name: 'Poll Responses' })).toBe(heading);
  });

  it('L3: a failed members fallback is a logger breadcrumb with errCtx, never a raw console call', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members failed', 'internal', 500));
      render(<GroupPlanningPage />);
      await waitFor(() =>
        expect(h.logInfo).toHaveBeenCalledWith('Error fetching group members:', {
          name: 'ApiError',
          message: 'members failed',
        }),
      );
      const raw = consoleSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].startsWith('Error fetching'),
      );
      expect(raw).toHaveLength(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('L4: a failed group fetch is a logger breadcrumb with errCtx, and the group banner still shows', async () => {
    (groupsAPI.getGroup as Mock).mockRejectedValue(new ApiError('group failed', 'internal', 500));
    render(<GroupPlanningPage />);
    await screen.findByText("We couldn't load this group");
    expect(h.logInfo).toHaveBeenCalledWith('Error fetching group:', { name: 'ApiError', message: 'group failed' });
  });
});

describe('groupPlanning page — loading line and breadcrumb (88.6.1-16, G5 / R7-M7)', () => {
  it("G5: while Auth0 resolves the session the page reads Getting your group's plans... (byte-equal to the route fallback)", () => {
    h.AUTH = { user: undefined, isLoading: true };
    render(<GroupPlanningPage />);
    expect(screen.getByText("Getting your group's plans...")).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('M1: the breadcrumb nav carries min-w-0 beside inline-block max-w-full wrap-break-word', async () => {
    await renderSettled();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    for (const token of ['min-w-0', 'inline-block', 'max-w-full', 'wrap-break-word']) {
      expect(nav.classList.contains(token), token).toBe(true);
    }
  });
});

describe("groupPlanning leaves the dialog's close to CreateEvent (88.6.1-68)", () => {
  it('P-1: no created-callback; a create closes the email-link dialog once and clears its parameters once', async () => {
    const previousParams = h.PARAMS;
    h.PARAMS = new URLSearchParams('group_id=G1&prompt_id=P1');
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: null });
    const replace = vi.spyOn(h.ROUTER, 'replace');
    try {
      render(<GroupPlanningPage />);
      // The email-link auto-open.
      await waitFor(() => expect(h.ce?.modal).toBe(true));
      const p = h.ce!;
      expect(p.onEventCreated).toBeUndefined();

      // CreateEvent's success order, with both closures captured while the dialog is open.
      act(() => {
        (p.onEventCreated as ((e: unknown) => void) | undefined)?.({ id: 'E1' });
        (p.modaltoggle as () => void)();
      });
      expect(h.ce!.modal).toBe(false);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('/groupPlanning?group_id=G1', { scroll: false });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(h.ce!.modal).toBe(false);
    } finally {
      replace.mockRestore();
      h.PARAMS = previousParams;
    }
  });
});
