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
//
// quick-261026-pi6: the page now reads the shared open-polls query, so the file's render wraps a
// fresh QueryClient once (every existing render and its rerender run unchanged). The PI tests
// change h.PARAMS on purpose to model Next's patched history, which re-renders without a remount
// (planning read: node_modules:next/dist/client/components/app-router.js ("Patch pushState to ensure external changes")).
import * as React from 'react';
import { act, cleanup, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => {
  const USER = { sub: 'auth0|self' };
  const SELF_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  // Group ids are real-shaped UUIDs: the page treats a group_id that is not one as absent
  // (quick-261026-pi6-fix F4), the same conversion P-1's prompt_id fixture had.
  const G1 = '6a000000-0000-4000-8000-000000000001';
  const G2 = '6a000000-0000-4000-8000-000000000002';
  const DEFAULT_QUERY = { isError: false, error: null as unknown, refetch: (() => undefined) as () => unknown };
  return {
    USER,
    SELF_UUID,
    G1,
    G2,
    DEFAULT_QUERY,
    AUTH: { user: USER as unknown, isLoading: false },
    SELF: { uuid: SELF_UUID as string | null },
    PARAMS: new URLSearchParams(`group_id=${G1}`),
    // Mirrors PARAMS into the jsdom location through the PROTOTYPE method, so a test's history
    // spies never record it (quick-261026-pi6-fix F3: the page's stale drop reads the live
    // location). Called on every render through the useSearchParams mock and by the spies.
    syncLocation: () => undefined as void,
    ROUTER: { replace: () => undefined, push: () => undefined },
    QUERY: DEFAULT_QUERY,
    // The last props the PromptScheduleSection and CreateEvent stubs received, and EVERY
    // userRole the PromptScheduleSection stub has received, in order (arm R3 reads the history,
    // so a one-render flash of another group's role cannot pass).
    pss: null as null | Record<string, unknown>,
    ce: null as null | Record<string, unknown>,
    // The last props the ResponseDashboard stub received (quick-261026-pi6).
    rd: null as null | Record<string, unknown>,
    pssRoles: [] as unknown[],
    logInfo: vi.fn(),
    // logger.error and logger.warn spies (quick-261026-pi6-fix F2 and F13).
    logError: vi.fn(),
    logWarn: vi.fn(),
    // The `state` prop most recently given to a FetchErrorBanner rendered with `compact`.
    compactState: null as null | { showError: boolean; retry: () => Promise<unknown> },
  };
});

const SELF_UUID = h.SELF_UUID;
h.syncLocation = () => {
  const qs = h.PARAMS.toString();
  History.prototype.replaceState.call(window.history, null, '', qs ? `/groupPlanning?${qs}` : '/groupPlanning');
};
const G1 = h.G1;
const G2 = h.G2;
const G9 = '6a000000-0000-4000-8000-000000000009';

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
  useSearchParams: () => {
    h.syncLocation();
    return h.PARAMS;
  },
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
vi.mock('@/app/components/ResponseDashboard', () => ({
  default: (props: Record<string, unknown>) => {
    h.rd = props;
    return null;
  },
}));
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
  return { ...actual, logger: { ...actual.logger, info: h.logInfo, error: h.logError, warn: h.logWarn } };
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
    promptAPI: { getActivePrompt: vi.fn(), getPromptById: vi.fn(), getOpenPrompts: vi.fn() },
  };
});

import GroupPlanningPage from './page';
import { ApiError, eventsAPI, groupsAPI, promptAPI } from '@/lib/api';
import { promptKeys } from '@/lib/queryKeys/promptKeys';

type Mock = ReturnType<typeof vi.fn>;

// The page's open-polls query needs a provider (quick-261026-pi6). One fresh client per render,
// retry off, so a rejected query settles at once; rerender keeps the wrapper.
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // The client is returned too, so a test can write the open-polls cache (quick-261026-pi6-fix F10).
  return { ...rtlRender(ui, { wrapper }), client };
}

// A real email link carries the poll's UUID (P-1's fixture since quick-261026-pi6 ruling 1).
const EMAIL_PROMPT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const OWNER_ROW = { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'owner' } };
const NOTICE = 'Some personal controls are unavailable.';

beforeEach(() => {
  vi.clearAllMocks();
  h.AUTH = { user: h.USER, isLoading: false };
  h.SELF.uuid = SELF_UUID;
  h.QUERY = h.DEFAULT_QUERY;
  h.PARAMS = new URLSearchParams(`group_id=${G1}`);
  h.pss = null;
  h.ce = null;
  h.rd = null;
  h.pssRoles = [];
  h.compactState = null;
  // NO `Users` on the group: production's GET /groups/:group_id returns a bare Group.findByPk
  // with no include (periodictabletopbackend_v2/Sonnet/routes/groups.js, the group GET), so the
  // page ALWAYS takes its getGroupMembers fallback. A `Users` array here would pin a path
  // production never takes.
  (groupsAPI.getGroup as Mock).mockResolvedValue({ id: G1, name: 'Weekend Warriors' });
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue([OWNER_ROW]);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  // 'active' is a real AvailabilityPrompt.status value ('pending' | 'active' | 'closed' | 'converted').
  (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: { id: 'P1', status: 'active' } });
  (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [] });
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
      `/groupHomePage?id=${G1}`,
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
    // AMENDED quick-261026-pi6-fix F10: the dashboard's swap announcement is a second polite
    // region by design (its own data-testid), so the count excludes it.
    const regions = container.querySelectorAll('[role="status"]:not([data-testid="poll-selection-status"])');
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
      id === G2 ? g2.promise : Promise.resolve([OWNER_ROW]),
    );
    h.pssRoles = [];
    h.PARAMS = new URLSearchParams(`group_id=${G2}`);
    rerender(<GroupPlanningPage />);

    // Synchronously after the switch — the FIRST render after it included.
    expect(h.pssRoles.length).toBeGreaterThan(0);
    expect(h.pssRoles.every((r) => r === null)).toBe(true);

    // Positive: the new group's read is open. The hold: still nothing but null.
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledWith(G2));
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
    // Two reads for the SAME group. AMENDED 2026-10-19 (88.6.1 code review A-60): a retry now
    // JOINS a read already in flight, so the second read is the identity-keyed effect's own
    // re-run (a new `user` object), which calls the read directly and never joins.
    act(() => {
      pA = h.compactState!.retry();
    });
    h.AUTH = { user: { ...h.USER }, isLoading: false };
    rerender(<GroupPlanningPage />);
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledTimes(4));
    pB = h.compactState!.retry();

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
      id === G2 ? Promise.resolve([{ ...OWNER_ROW, UserGroup: { role: 'admin' } }]) : dC.promise,
    );
    let pC!: Promise<unknown>;
    act(() => {
      pC = h.compactState!.retry();
    });
    h.PARAMS = new URLSearchParams(`group_id=${G2}`);
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

  // A-60 (88.6.1 code review): the house JOIN idiom (groupHomePage's `…InFlightRef.current ??`).
  it('R7: a tab return during a pending role read, then a Retry press, sends ONE members request', async () => {
    const user = userEvent.setup();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('members request failed', 'internal', 500));
    render(<GroupPlanningPage />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledTimes(2));

    const held = deferred<unknown[]>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValue(held.promise);
    const before = (groupsAPI.getGroupMembers as Mock).mock.calls.length;

    // The hook's error-only refocus re-attempt starts a role read…
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(before + 1);
    // …and the person's press while it is open joins it instead of sending another.
    await user.click(retry);
    expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(before + 1);

    await act(async () => {
      held.resolve([OWNER_ROW]);
    });
    await waitFor(() => expect(lastRole()).toBe('owner'));
    expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(before + 1);
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
    h.PARAMS = new URLSearchParams(`group_id=${G1}&prompt_id=${EMAIL_PROMPT_ID}`);
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
      expect(replace).toHaveBeenCalledWith(`/groupPlanning?group_id=${G1}`, { scroll: false });

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

// quick-261026-pi6 (owner R3-R5, 2026-10-26): a selected poll loads in place through its own URL
// parameter. Next 14.2.35 patches the native history so a pushState or replaceState dispatches a
// router restore: useSearchParams returns the new value and the page RE-RENDERS, never remounts.
// The spies below model exactly that: they set h.PARAMS from the URL and record it, and each test
// re-renders by hand (rerender, never a fresh render). Poll ids are real-shaped UUIDs (the page
// checks them with isUuid before any request). Every comment here is a // line (CF-9).
describe('groupPlanning page: poll selection (quick-261026-pi6, owner R3-R5)', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const P3 = '33333333-3333-4333-8333-333333333333';
  const PX = '99999999-9999-4999-8999-999999999999';
  const poll = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'active', group_id: G1, ...extra });
  const manual = (id: string, username: string) => poll(id, { can_close: true, Creator: { id: `u-${id}`, username } });
  const REDUCED = '(prefers-reduced-motion: reduce)';

  type Select = (id: string) => void;
  const onSelectPoll = () => (h.pss as { onSelectPoll?: Select } | null)?.onSelectPoll as Select;
  const pollResponses = () => screen.getByRole('heading', { level: 3, name: 'Poll Responses' });
  // The swap announcement region, the dashboard wrapper that holds it, and the Showing line
  // (quick-261026-pi6-fix F10).
  const selectionStatus = () => screen.getByTestId('poll-selection-status');
  const dashboardWrapper = () => selectionStatus().parentElement as HTMLElement;
  const showingLine = () => pollResponses().nextElementSibling as HTMLElement;
  const queryOf = (url: string) => new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');

  let pushed: string[];
  let replaced: string[];
  let spies: Array<{ mockRestore: () => void }>;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    pushed = [];
    replaced = [];
    originalMatchMedia = window.matchMedia;
    spies = [
      vi.spyOn(window.history, 'pushState').mockImplementation((_d, _t, url) => {
        pushed.push(String(url));
        h.PARAMS = queryOf(String(url));
        h.syncLocation();
      }),
      vi.spyOn(window.history, 'replaceState').mockImplementation((_d, _t, url) => {
        replaced.push(String(url));
        h.PARAMS = queryOf(String(url));
        h.syncLocation();
      }),
    ];
    (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: poll(P1) });
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    window.matchMedia = originalMatchMedia;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  // The modelled restore: a re-render with whatever h.PARAMS now holds.
  function reRender(rerender: (ui: React.ReactElement) => void) {
    act(() => {
      rerender(<GroupPlanningPage />);
    });
  }

  function stubScroll() {
    const scroll = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
    return scroll;
  }

  function stubReducedMotion() {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === REDUCED,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  async function settledOn(id: string) {
    await waitFor(() => expect(h.rd?.promptId).toBe(id));
  }

  it('PI-1. ?poll= loads that poll by id, never the active one, and opens no dialog', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&poll=${P2}`);
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2) });
    render(<GroupPlanningPage />);
    await settledOn(P2);
    expect(promptAPI.getPromptById).toHaveBeenCalledTimes(1);
    expect(promptAPI.getPromptById).toHaveBeenCalledWith(P2);
    expect(promptAPI.getActivePrompt).not.toHaveBeenCalled();
    expect(h.ce!.modal).toBe(false);
  });

  it('PI-2. with prompt_id and poll, the dashboard loads poll and the dialog still auto-opens', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&prompt_id=${P1}&poll=${P2}`);
    (promptAPI.getPromptById as Mock).mockImplementation(async (id: string) => ({ prompt: poll(id) }));
    render(<GroupPlanningPage />);
    await settledOn(P2);
    expect(h.ce!.modal).toBe(true);
  });

  it('PI-3. a card select pushes poll=, keeps the dashboard mounted while the next poll loads, and re-fetches nothing else', async () => {
    const d2 = deferred<unknown>();
    (promptAPI.getPromptById as Mock).mockImplementation((id: string) => (id === P2 ? d2.promise : Promise.resolve({ prompt: poll(id) })));
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    const heading = pollResponses();

    act(() => onSelectPoll()(P2));
    expect(pushed).toHaveLength(1);
    expect(queryOf(pushed[0]).get('group_id')).toBe(G1);
    expect(queryOf(pushed[0]).get('poll')).toBe(P2);

    reRender(rerender);
    await waitFor(() => expect(promptAPI.getPromptById).toHaveBeenCalledWith(P2));
    expect(pollResponses()).toBe(heading);
    // The loading BRANCH never replaced the dashboard (AMENDED quick-261026-pi6-fix F10: the
    // Showing line itself now reads the loading phrase while the poll is on the network, and the
    // wrapper is busy).
    expect(screen.queryByText('Loading poll data...', { selector: 'p.text-center' })).toBeNull();
    expect(showingLine()).toHaveTextContent(/^Loading poll data\.\.\.$/);
    expect(dashboardWrapper()).toHaveAttribute('aria-busy', 'true');
    expect(h.rd!.promptId).toBe(P1);

    await act(async () => {
      d2.resolve({ prompt: poll(P2) });
    });
    await settledOn(P2);
    expect(dashboardWrapper()).not.toHaveAttribute('aria-busy');
    expect(selectionStatus()).toHaveTextContent(/^Showing Availability check-in$/);
    expect(pollResponses()).toBe(heading);
    expect(h.pss!.selectedPollId).toBe(P2);
    expect(groupsAPI.getGroup).toHaveBeenCalledTimes(1);
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1);
  });

  it('PI-4. a card select scrolls the Poll Responses heading to the top and focuses it; instant under reduced motion', async () => {
    (promptAPI.getPromptById as Mock).mockImplementation(async (id: string) => ({ prompt: poll(id) }));
    const scroll = stubScroll();
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    const heading = pollResponses();

    act(() => onSelectPoll()(P2));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(heading);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start', behavior: 'smooth' });
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute('tabindex', '-1');

    reRender(rerender);
    await settledOn(P2);
    stubReducedMotion();
    act(() => onSelectPoll()(P1));
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('PI-5. selecting the poll already shown pushes nothing and still scrolls and focuses', async () => {
    const scroll = stubScroll();
    render(<GroupPlanningPage />);
    await settledOn(P1);
    act(() => onSelectPoll()(P1));
    expect(pushed).toHaveLength(0);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(pollResponses());
  });

  it('PI-6. with two open polls a Switch poll chip row swaps in place, without scrolling, and focus stays on the chip', async () => {
    const user = userEvent.setup();
    (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [manual(P1, 'Ana'), manual(P2, 'Ben')] });
    (promptAPI.getPromptById as Mock).mockImplementation(async (id: string) => ({ prompt: poll(id) }));
    const scroll = stubScroll();
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    const chips = await screen.findByRole('group', { name: 'Switch poll' });
    expect(within(chips).getAllByRole('button')).toHaveLength(2);
    expect(within(chips).getByRole('button', { name: "Ana's check-in" })).toHaveAttribute('aria-pressed', 'true');
    const ben = within(chips).getByRole('button', { name: "Ben's check-in" });
    expect(ben).toHaveAttribute('aria-pressed', 'false');

    await user.click(ben);
    expect(pushed).toHaveLength(1);
    expect(queryOf(pushed[0]).get('poll')).toBe(P2);
    reRender(rerender);
    await settledOn(P2);
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ben);
    expect(ben).toHaveAttribute('aria-pressed', 'true');
  });

  it('PI-7. with one open poll there is no chip row, and the Showing line names a generic manual poll for its starter', async () => {
    (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [manual(P1, 'Ana')] });
    (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: manual(P1, 'Ana') });
    render(<GroupPlanningPage />);
    await settledOn(P1);
    await waitFor(() =>
      expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === "Showing Ana's check-in")).toBeInTheDocument(),
    );
    expect(screen.queryByRole('group', { name: 'Switch poll' })).toBeNull();
  });

  it('PI-8. a poll id that fails to load falls back to the active poll and drops the parameter, with no error banner', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&poll=${PX}`);
    (promptAPI.getPromptById as Mock).mockRejectedValue(new ApiError('not found', 'not_found', 404));
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1);
    expect(replaced).toHaveLength(1);
    expect(queryOf(replaced[0]).get('group_id')).toBe(G1);
    expect(queryOf(replaced[0]).has('poll')).toBe(false);
    expect(screen.queryByText("We couldn't load the poll responses")).toBeNull();
    expect(h.logInfo).toHaveBeenCalledWith('Selected poll did not load; showing the active poll:', expect.anything());

    reRender(rerender);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1);
  });

  it('PI-9. a malformed poll id sends no request, the active poll loads and the parameter is dropped', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&poll=not-a-uuid`);
    render(<GroupPlanningPage />);
    await settledOn(P1);
    expect(promptAPI.getPromptById).not.toHaveBeenCalled();
    expect(replaced).toHaveLength(1);
    expect(queryOf(replaced[0]).has('poll')).toBe(false);
    expect(queryOf(replaced[0]).get('group_id')).toBe(G1);
    // One fallback load: the drop runs with no await, inside the mount commit.
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1);
  });

  it('PI-10. a poll that belongs to another group is treated as stale', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&poll=${P2}`);
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2, { group_id: G9 }) });
    render(<GroupPlanningPage />);
    await settledOn(P1);
    expect(promptAPI.getPromptById).toHaveBeenCalledWith(P2);
    expect(replaced).toHaveLength(1);
    expect(queryOf(replaced[0]).has('poll')).toBe(false);
  });

  it('PI-11. newest wins: a late answer for an earlier selection writes nothing', async () => {
    const d2 = deferred<unknown>();
    const d3 = deferred<unknown>();
    (promptAPI.getPromptById as Mock).mockImplementation((id: string) => (id === P2 ? d2.promise : d3.promise));
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);

    act(() => onSelectPoll()(P2));
    reRender(rerender);
    await waitFor(() => expect(promptAPI.getPromptById).toHaveBeenCalledWith(P2));
    act(() => onSelectPoll()(P3));
    reRender(rerender);
    await waitFor(() => expect(promptAPI.getPromptById).toHaveBeenCalledWith(P3));

    await act(async () => {
      d3.resolve({ prompt: poll(P3) });
    });
    await settledOn(P3);
    await act(async () => {
      d2.resolve({ prompt: poll(P2) });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(h.rd!.promptId).toBe(P3);
  });

  it('PI-12. back steps to the previous poll in place', async () => {
    (promptAPI.getPromptById as Mock).mockImplementation(async (id: string) => ({ prompt: poll(id) }));
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    act(() => onSelectPoll()(P2));
    reRender(rerender);
    await settledOn(P2);

    // The modelled popstate: the earlier entry's query, then a re-render.
    h.PARAMS = new URLSearchParams(`group_id=${G1}`);
    reRender(rerender);
    await settledOn(P1);
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(2);
    expect(h.pss!.selectedPollId).toBe(P1);
  });

  it('PI-13. a generic automatic poll is named for its schedule on its chip and in the Showing line', async () => {
    const auto = poll(P1, { created_by_settings_id: 'set-1', Creator: null, schedule_name: 'Sunday Wingspan' });
    (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [auto, manual(P2, 'Ben')] });
    (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: auto });
    render(<GroupPlanningPage />);
    await settledOn(P1);
    const chips = await screen.findByRole('group', { name: 'Switch poll' });
    expect(within(chips).getByRole('button', { name: 'Sunday Wingspan' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Showing Sunday Wingspan')).toBeInTheDocument();
  });

  // AMENDED quick-261026-pi6-fix F9: a chip names a poll the open-polls cache holds, so its swap
  // is served from that cache and can no longer fail on the network; this test first pinned the
  // banner and the focus fallback after a failed chip swap, and now pins that the swap holds while
  // both poll reads would fail.
  it('PI-14. a chip swap is served from the open-polls cache while both poll reads fail: no banner, focus stays on the chip', async () => {
    const user = userEvent.setup();
    (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [manual(P1, 'Ana'), manual(P2, 'Ben')] });
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    const chips = await screen.findByRole('group', { name: 'Switch poll' });
    (promptAPI.getPromptById as Mock).mockRejectedValue(new ApiError('failed', 'unknown', 500));
    (promptAPI.getActivePrompt as Mock).mockRejectedValue(new ApiError('failed', 'unknown', 500));

    const ben = within(chips).getByRole('button', { name: "Ben's check-in" });
    await user.click(ben);
    reRender(rerender);
    await settledOn(P2);
    expect(screen.queryByText("We couldn't load the poll responses")).toBeNull();
    expect(promptAPI.getPromptById).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ben);
  });

  it('PI-15. with no poll parameter the section receives the shown poll as selected and a select handler', async () => {
    render(<GroupPlanningPage />);
    await settledOn(P1);
    await waitFor(() => expect(h.pss!.selectedPollId).toBe(P1));
    expect(typeof h.pss!.onSelectPoll).toBe('function');
  });

  it('PI-16. a prompt_id that is not a UUID is treated as absent: no request, the active poll, no dialog', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&prompt_id=not-a-uuid`);
    render(<GroupPlanningPage />);
    // Positive signal first (CF-26), then the absences.
    await settledOn(P1);
    expect(promptAPI.getPromptById).not.toHaveBeenCalled();
    expect(h.ce!.modal).toBe(false);
    expect(h.ce!.promptId).toBeNull();
    expect(h.ce!.hideVisualCalendar).toBe(true);
  });

  // quick-261026-pi6-fix F1 (the reviewer's probe R-A, ported; a 404 so the stale path runs).
  it('PI-17. re-tapping a poll whose first load was dropped as stale loads it again', async () => {
    (promptAPI.getPromptById as Mock).mockRejectedValueOnce(new ApiError('not found', 'not_found', 404));
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);

    act(() => onSelectPoll()(P2));
    reRender(rerender);
    await waitFor(() => expect(replaced).toHaveLength(1));
    reRender(rerender);
    await waitFor(() => expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(2));
    await settledOn(P1);

    // The poll is reachable now; the person taps the same card again.
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2) });
    act(() => onSelectPoll()(P2));
    expect(pushed).toHaveLength(2);
    reRender(rerender);
    expect(h.pss!.selectedPollId).toBe(P2);
    await waitFor(() => expect(promptAPI.getPromptById).toHaveBeenCalledTimes(2));
    await settledOn(P2);
  });

  // quick-261026-pi6-fix F2: a transient failure is not a stale link.
  it('FX-2. a selected poll that fails with a 500 shows the banner, keeps the parameter, reports once, and Retry loads it', async () => {
    const user = userEvent.setup();
    h.PARAMS = new URLSearchParams(`group_id=${G1}&poll=${P2}`);
    (promptAPI.getPromptById as Mock).mockRejectedValueOnce(new ApiError('failed', 'internal', 500));
    render(<GroupPlanningPage />);
    expect(await screen.findByText("We couldn't load the poll responses")).toBeInTheDocument();
    expect(replaced).toHaveLength(0);
    expect(h.PARAMS.get('poll')).toBe(P2);
    expect(h.logError).toHaveBeenCalledTimes(1);
    expect(h.logError).toHaveBeenCalledWith('Selected poll failed to load', expect.any(ApiError));
    expect(promptAPI.getActivePrompt).not.toHaveBeenCalled();

    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2) });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await settledOn(P2);
    expect(promptAPI.getPromptById).toHaveBeenCalledTimes(2);
    expect(promptAPI.getPromptById).toHaveBeenLastCalledWith(P2);
    expect(replaced).toHaveLength(0);
  });

  // quick-261026-pi6-fix F3 (the reviewer's probe R-B, ported; a 404 so the stale drop runs).
  it('PI-18. a stale drop that lands after the dialog closed does not write prompt_id back', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&prompt_id=${EMAIL_PROMPT_ID}&poll=${PX}`);
    const dx = deferred<unknown>();
    (promptAPI.getPromptById as Mock).mockImplementation((id: string) =>
      id === PX ? dx.promise : Promise.resolve({ prompt: poll(id) }),
    );
    const replace = vi.spyOn(h.ROUTER, 'replace').mockImplementation(((url: string) => {
      h.PARAMS = queryOf(url);
      h.syncLocation();
    }) as unknown as () => undefined);
    try {
      const { rerender } = render(<GroupPlanningPage />);
      await waitFor(() => expect(h.ce?.modal).toBe(true));
      act(() => {
        (h.ce!.modaltoggle as () => void)();
      });
      reRender(rerender);
      expect(h.PARAMS.has('prompt_id')).toBe(false);

      await act(async () => {
        dx.reject(new ApiError('not found', 'not_found', 404));
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(replaced).toHaveLength(1);
      expect(queryOf(replaced[0]).has('prompt_id')).toBe(false);
      expect(queryOf(replaced[0]).has('poll')).toBe(false);
      expect(queryOf(replaced[0]).get('group_id')).toBe(G1);
    } finally {
      replace.mockRestore();
    }
  });

  // quick-261026-pi6-fix F7: a UUID names the same row in any case.
  it('FX-7. an uppercase group_id in the URL still loads the selected poll of that group', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1.toUpperCase()}&poll=${P2}`);
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2) });
    render(<GroupPlanningPage />);
    await settledOn(P2);
    expect(promptAPI.getActivePrompt).not.toHaveBeenCalled();
    expect(replaced).toHaveLength(0);
  });

  // quick-261026-pi6-fix F5: the email link's arm gets the poll arm's same-group rule.
  it("FX-5. a prompt_id naming another group's poll loads the active poll instead", async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&prompt_id=${EMAIL_PROMPT_ID}`);
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(EMAIL_PROMPT_ID, { group_id: G9 }) });
    render(<GroupPlanningPage />);
    await waitFor(() => expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1));
    await settledOn(P1);
    expect(promptAPI.getPromptById).toHaveBeenCalledWith(EMAIL_PROMPT_ID);
  });

  // quick-261026-pi6-fix F8: ending the shown poll must not leave it displayed as open.
  type Closed = (id: string) => void;
  const onPollClosed = () => (h.pss as { onPollClosed?: Closed } | null)?.onPollClosed as Closed;

  it('FX-8a. ending the poll the URL selects reloads it, and the dashboard reads it as closed', async () => {
    h.PARAMS = new URLSearchParams(`group_id=${G1}&poll=${P2}`);
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2) });
    // The open-polls cache still lists the poll as active when the close lands (F9's cache-first
    // read must not serve the reload).
    (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [manual(P1, 'Ana'), manual(P2, 'Ben')] });
    render(<GroupPlanningPage />);
    await settledOn(P2);
    await screen.findByRole('group', { name: 'Switch poll' });
    // No deadline, so the page's derive reads falsy here (undefined), not false.
    expect(h.rd!.pollClosed).toBeFalsy();

    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P2, { status: 'closed' }) });
    act(() => onPollClosed()(P2));
    await waitFor(() => expect(h.rd!.pollClosed).toBe(true));
    expect(h.rd!.promptId).toBe(P2);
    expect(promptAPI.getPromptById).toHaveBeenCalledTimes(2);
  });

  it('FX-8b. ending the active poll with no selection loads the next open poll; ending another poll reloads nothing', async () => {
    render(<GroupPlanningPage />);
    await settledOn(P1);
    act(() => onPollClosed()(P3));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(1);

    (promptAPI.getActivePrompt as Mock).mockResolvedValue({ prompt: poll(P2) });
    act(() => onPollClosed()(P1));
    await settledOn(P2);
    expect(promptAPI.getActivePrompt).toHaveBeenCalledTimes(2);
  });

  // quick-261026-pi6-fix F9: a swap to a poll the open-polls cache holds sends no request.
  it('FX-9. a chip press for a cached poll never calls getPromptById; an id the cache lacks still does', async () => {
    const user = userEvent.setup();
    (promptAPI.getOpenPrompts as Mock).mockResolvedValue({ prompts: [manual(P1, 'Ana'), manual(P2, 'Ben')] });
    (promptAPI.getPromptById as Mock).mockResolvedValue({ prompt: poll(P3) });
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    const chips = await screen.findByRole('group', { name: 'Switch poll' });

    await user.click(within(chips).getByRole('button', { name: "Ben's check-in" }));
    reRender(rerender);
    await settledOn(P2);
    expect(promptAPI.getPromptById).not.toHaveBeenCalled();
    // The cached swap is announced too (F10).
    expect(selectionStatus()).toHaveTextContent(/^Showing Ben's check-in$/);

    act(() => onSelectPoll()(P3));
    reRender(rerender);
    await settledOn(P3);
    expect(promptAPI.getPromptById).toHaveBeenCalledTimes(1);
    expect(promptAPI.getPromptById).toHaveBeenCalledWith(P3);
  });

  // quick-261026-pi6-fix F10 (WCAG 4.1.3): a swap is told, and its wait is visible.
  it('FX-10a. while a labelled poll loads the wrapper is busy and the line reads Loading; the commit is announced', async () => {
    const d2 = deferred<unknown>();
    (promptAPI.getPromptById as Mock).mockImplementation((id: string) => (id === P2 ? d2.promise : Promise.resolve({ prompt: poll(id) })));
    const { rerender, client } = render(<GroupPlanningPage />);
    await settledOn(P1);
    // The first load is not announced, and the region was there, empty, before any swap.
    expect(selectionStatus()).toHaveTextContent(/^$/);

    act(() => onSelectPoll()(P2));
    reRender(rerender);
    await waitFor(() => expect(promptAPI.getPromptById).toHaveBeenCalledWith(P2));
    // The open list lands while the by-id read is still open, so the poll has a label.
    act(() => {
      client.setQueryData(promptKeys.openPolls(G1), { prompts: [manual(P1, 'Ana'), manual(P2, 'Ben')] });
    });
    await waitFor(() => expect(showingLine()).toHaveTextContent(/^Loading Ben's check-in…$/));
    expect(dashboardWrapper()).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      d2.resolve({ prompt: manual(P2, 'Ben') });
    });
    await settledOn(P2);
    expect(selectionStatus()).toHaveTextContent(/^Showing Ben's check-in$/);
    expect(showingLine()).toHaveTextContent(/^Showing Ben's check-in$/);
    expect(dashboardWrapper()).not.toHaveAttribute('aria-busy');
  });

  it('FX-10b. a swap that falls back to the active poll says so', async () => {
    (promptAPI.getPromptById as Mock).mockRejectedValue(new ApiError('not found', 'not_found', 404));
    const { rerender } = render(<GroupPlanningPage />);
    await settledOn(P1);
    act(() => onSelectPoll()(PX));
    reRender(rerender);
    await waitFor(() => expect(replaced).toHaveLength(1));
    await waitFor(() =>
      expect(selectionStatus()).toHaveTextContent(/^That poll couldn't be opened\. Showing Availability check-in\.$/),
    );
  });
});

// quick-261026-pi6-fix (2026-10-26): the review fix batch. Every comment here is a // line (CF-9).
describe('groupPlanning page: review fix batch (quick-261026-pi6-fix)', () => {
  it('FX-4. a group_id that is not a UUID is treated as absent: the no-group state and no request at all', async () => {
    h.PARAMS = new URLSearchParams('group_id=G1');
    render(<GroupPlanningPage />);
    // Positive signal first (CF-26), then the absences after a settle.
    expect(screen.getByText('No group specified. Please navigate from a group page.')).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(groupsAPI.getGroup).not.toHaveBeenCalled();
    expect(groupsAPI.getGroupMembers).not.toHaveBeenCalled();
    expect(promptAPI.getActivePrompt).not.toHaveBeenCalled();
    expect(promptAPI.getPromptById).not.toHaveBeenCalled();
    expect(promptAPI.getOpenPrompts).not.toHaveBeenCalled();
  });
});
