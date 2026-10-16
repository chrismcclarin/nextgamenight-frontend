// Phase 88.6-23 task 1 — the guard net over the group-invite landing page.
//
// NOT IN THE PLAN'S FILE LIST, and here deliberately. The plan instructs AC-13's cancellation
// idiom be copied "VERBATIM" from `invite/game/[token]/page.js:69,74,77,100` — a per-effect-run
// `let cancelled = false` with a cleanup that sets it true. Applied to THIS page's `autoJoin`
// effect that idiom is a DEFECT, because this effect carries the BUG-02 single-shot
// `joiningRef` latch and the sibling's preview effect does not:
//
//   any re-run of the effect while the join POST is in flight — the dep array is
//   `[authLoading, user, groupInfo, token]`, and `user` is an object whose IDENTITY can change
//   on an Auth0 revalidation — runs the cleanup, marking run 1 cancelled. `joiningRef` is a
//   REF, so it survives into run 2 and makes it return immediately without re-firing. Run 1's
//   POST then resolves into a cancelled closure and writes nothing at all, and the page sits on
//   "Joining…" forever with no error and no retry.
//
// The first test below is that proof: it changes the `user` object's identity mid-flight. It is
// RED against the per-run form and GREEN against the unmount-scoped ref the page actually ships.
// The deviation, and what is and is not measured about it, is recorded in 88.6-23-SUMMARY.md.
//
// `.tsx` is mandatory: `vitest.config.mts:67` collects `src/**/*.{test,spec}.{ts,tsx}` only.
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'c'.repeat(64);
const GROUP_ID = '33333333-3333-4333-8333-333333333333';

const { pushMock, authState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  authState: {
    user: undefined as { sub: string } | undefined,
    isLoading: false,
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: authState.user, isLoading: authState.isLoading }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      getInvitePreview: vi.fn(),
      joinByToken: vi.fn(),
    },
  };
});

import GroupInvitePage from './page';
import { groupsAPI, ApiError } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;
const preview = () => groupsAPI.getInvitePreview as unknown as Mock;
const join = () => groupsAPI.joinByToken as unknown as Mock;

const PREVIEW_BODY = { group_name: 'Tuesday Night Crew', member_count: 4, group_id: GROUP_ID };

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = undefined;
  authState.isLoading = false;
  preview().mockReset();
  join().mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('invite/group/[token] — AC-13 guards, composed with the BUG-02 latch', () => {
  it('a dep-identity change mid-flight does not deadlock the latch — the join still lands', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);

    // A join POST that is still in flight when the effect re-runs.
    let resolveJoin: (v: unknown) => void = () => {};
    join().mockReturnValue(
      new Promise((resolve) => {
        resolveJoin = resolve;
      })
    );

    const { rerender } = render(<GroupInvitePage />);

    // Settle on the POSITIVE signal that the POST has actually been issued — not on the
    // absence of something, which is satisfied on the first tick and observes nothing.
    await screen.findByText(/joining tuesday night crew/i);
    expect(join()).toHaveBeenCalledTimes(1);

    // The hazard: a NEW `user` object with the same subject. `useUser` returns an object, the
    // effect depends on it, so this re-runs the effect and fires its cleanup.
    await act(async () => {
      authState.user = { sub: 'auth0|abc' };
      rerender(<GroupInvitePage />);
    });

    await act(async () => {
      resolveJoin({ success: true, group_id: GROUP_ID });
    });

    expect(
      await screen.findByRole('heading', { name: /you've joined tuesday night crew!/i }),
      'a per-effect-run `cancelled` flag deadlocks against the single-shot `joiningRef`: the ' +
        're-run marks run 1 cancelled, the latch makes run 2 return, and the resolved POST ' +
        "writes nothing — the page hangs on 'Joining…' with no error and no retry"
    ).toBeInTheDocument();
    // The latch still did its job: exactly ONE POST, never two (BUG-02 / F-450).
    expect(join()).toHaveBeenCalledTimes(1);
  });

  it('the redirect timer is cleared on unmount — no push after the user has left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);
    join().mockResolvedValue({ success: true, group_id: GROUP_ID });

    const { unmount } = render(<GroupInvitePage />);

    await screen.findByRole('heading', { name: /you've joined tuesday night crew!/i });
    expect(pushMock).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(
      pushMock,
      'the 1500ms `setTimeout(router.push, …)` had its id stored nowhere before this plan, so it ' +
        'navigated a user who had already left the page'
    ).not.toHaveBeenCalled();
  });

  it('the redirect DOES fire while the page is still mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);
    join().mockResolvedValue({ success: true, group_id: GROUP_ID });

    render(<GroupInvitePage />);
    await screen.findByRole('heading', { name: /you've joined tuesday night crew!/i });

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    // The anti-vacuity half of the test above: the clear must not have disarmed the feature.
    expect(pushMock).toHaveBeenCalledWith(`/groupHomePage?id=${GROUP_ID}`);
  });
});

describe('invite/group/[token] — R1 and the migrated anchors', () => {
  it('a join failure renders the ratified register line, not the upstream message', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);
    join().mockRejectedValue(
      new ApiError('HTTP error! status: 403', 'forbidden', 403, { error: 'nope' })
    );

    render(<GroupInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /unable to join group/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText("You don't have access to this. Refresh the page to try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to join group/i)).toBeNull();
    expect(screen.queryByText(/http error! status/i)).toBeNull();
  });

  it('the sign-in CTA is still an <a> with a byte-identical returnTo', async () => {
    preview().mockResolvedValue(PREVIEW_BODY);

    render(<GroupInvitePage />);

    const signIn = await screen.findByRole('link', { name: /join tuesday night crew/i });
    expect(signIn).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/invite/group/${TOKEN}`)}`
    );
    expect(signIn.tagName).toBe('A');
  });
});

// Plan 88.6.1-19 task 1 — R8 (register round-2 MED/LOW #24), copy row L1 (D-30) and SPEC
// Prohibition 2 (a failed preview request is never called an invalid link).
//
// The region's test handle is re-declared here, never imported: the page must not export it
// (Next's generated route types reject a page module's non-route named exports).
const PAGE_STATUS_TESTID = 'group-invite-page-status';

describe('invite/group/[token] — R8 page announcement, L1 and the preview failure (plan 88.6.1-19)', () => {
  it('G1 (L1): the loading line names what is loading', async () => {
    preview().mockReturnValue(new Promise(() => {}));

    render(<GroupInvitePage />);

    expect(await screen.findByText('Loading your group invite...')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('G2 (region, joined): one always-mounted sr-only region at slot 0, empty while joining, the SAME node carries the outcome', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);
    let resolveJoin: (v: unknown) => void = () => {};
    join().mockReturnValue(
      new Promise((resolve) => {
        resolveJoin = resolve;
      })
    );

    const { container } = render(<GroupInvitePage />);

    // Positive signal first: the join POST is in flight.
    await screen.findByText(/joining tuesday night crew/i);
    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
    expect(container.firstElementChild, 'the region sits at fragment slot 0').toBe(region);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(region).toHaveClass('sr-only');

    await act(async () => {
      resolveJoin({ success: true, group_id: GROUP_ID });
    });
    await screen.findByRole('heading', { name: "You've joined Tuesday Night Crew!" });

    expect(
      screen.getByTestId(PAGE_STATUS_TESTID),
      'node identity: a region remounted with its text announces nothing'
    ).toBe(region);
    expect(region.textContent).toBe(
      "You've joined Tuesday Night Crew! Redirecting to your group..."
    );
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });

  it('G3 (already-member): the region carries the heading and the redirect line', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);
    join().mockResolvedValue({ already_member: true, group_id: GROUP_ID });

    const { container } = render(<GroupInvitePage />);

    await screen.findByRole('heading', { name: "You're already a member of Tuesday Night Crew" });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      "You're already a member of Tuesday Night Crew Redirecting to your group..."
    );
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });

  it('G4 (join error): the region carries the error heading and the register line; the error glyph is silent', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue(PREVIEW_BODY);
    join().mockRejectedValue(
      new ApiError('HTTP error! status: 403', 'forbidden', 403, { error: 'nope' })
    );

    const { container } = render(<GroupInvitePage />);

    await screen.findByRole('heading', { name: /unable to join group/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      "Unable to join group You don't have access to this. Refresh the page to try again."
    );
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });

  it('G5 (signed-out preview): the region names the group and its member count', async () => {
    preview().mockResolvedValue(PREVIEW_BODY);

    render(<GroupInvitePage />);

    await screen.findByRole('link', { name: /join tuesday night crew/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe('Tuesday Night Crew 4 members');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('G6 (Prohibition 2): a network failure on the preview shows the register line, never "no longer valid"', async () => {
    preview().mockRejectedValue(
      new ApiError('Network error: Could not connect to the server.', 'network', 0)
    );

    render(<GroupInvitePage />);

    await screen.findByRole('heading', { name: 'Unable to join group' });
    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText('This invite link is no longer valid.')).toBeNull();
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      "Unable to join group We couldn't reach the server. Check your connection and try again."
    );
  });

  it('G7 (regression pin): a 404 on the preview keeps the invalid-link line of the page', async () => {
    preview().mockRejectedValue(
      new ApiError('HTTP error! status: 404', 'not_found', 404, { error: 'Invalid invite link' })
    );

    render(<GroupInvitePage />);

    await screen.findByRole('heading', { name: 'Unable to join group' });
    expect(screen.getByText('This invite link is no longer valid.')).toBeInTheDocument();
  });
});
