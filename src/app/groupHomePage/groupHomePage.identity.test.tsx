// Phase 87.3-05 (Task 2): membership/removal gate must treat an unresolved
// self-identity query as LOADING, never as "removed". On a cold cache the
// members fetch races the identity query; if the removal redirect fired while
// selfUuid is still undefined, the find would miss and bounce an ACTIVE member
// off their own group page. This test mounts the page with a pending identity
// query and asserts no removed-redirect fires (loading is shown instead), plus
// the positive path where a resolved member passes the gate without redirect.
import fs from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { render, screen, waitFor, cleanup, within, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mutable self-identity the mocked hook reads so each case can present a
// pending (undefined selfUuid) or resolved identity.
// `search` drives useSearchParams (GR-3 switches group); the two `*Props` fields are what the
// createEvent and GroupGamesList stubs last rendered with (the refresh describe drives and reads them).
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isPending: true,
  search: 'id=GROUP1',
  createEventProps: null as null | { onEventCreated: (event: unknown) => Promise<void> },
  gamesListProps: null as null | {
    games: unknown[];
    errorState: { showError: boolean; retry: () => Promise<unknown> };
  },
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
  useSearchParams: () => new URLSearchParams(h.search),
  useRouter: () => ({ push: pushSpy }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

// Stub the heavy children. Two of the stubs (createEvent, GroupGamesList) capture their props, for
// the refresh describe; every stub still renders nothing.
vi.mock('@/app/components/createEvent', () => ({
  default: (props: NonNullable<typeof h.createEventProps>) => {
    h.createEventProps = props;
    return null;
  },
}));
vi.mock('@/app/components/ManageMembers', () => ({ default: () => null }));
vi.mock('@/app/components/GroupGamesList', () => ({
  default: (props: NonNullable<typeof h.gamesListProps>) => {
    h.gamesListProps = props;
    return null;
  },
}));
vi.mock('@/app/components/EventCalendar', () => ({ default: () => null }));
vi.mock('@/app/components/PendingMemberBanner', () => ({ default: () => null }));
vi.mock('@/app/components/GroupLibrary', () => ({ default: () => null }));
// 88.6-21 task 2: rendered rather than nulled. The kebab GATING is the thing under test, and a
// `() => null` stub makes "the trigger is absent" true for every role — the vacuous shape. This
// stub reproduces only the contract the gating turns on: KM-21's zero-items-renders-no-trigger
// rule (`keyboardOperability.test.tsx`), plus a button per item.
vi.mock('@/app/components/KebabMenu', () => ({
  default: ({ ariaLabel, items }: { ariaLabel: string; items: { label: string }[] }) =>
    items.length === 0 ? null : (
      <div>
        <button type="button" aria-label={ariaLabel} />
        {items.map((i) => (
          <button type="button" key={i.label}>
            {i.label}
          </button>
        ))}
      </div>
    ),
}));
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
import { groupsAPI, eventsAPI, listsAPI, ApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { readOpeningTag, withoutComments } from '../../test-utils/sourceScan';

type Mock = ReturnType<typeof vi.fn>;

const ROSTER = [
  { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'member' } },
  { id: 'other-uuid', user_id: 'auth0|other', username: 'Other', UserGroup: { role: 'owner' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  h.isPending = true;
  h.search = 'id=GROUP1';
  h.createEventProps = null;
  h.gamesListProps = null;
  (groupsAPI.getGroup as Mock).mockResolvedValue({ id: 'GROUP1', name: 'My Group' });
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  (listsAPI.getGroupGames as Mock).mockResolvedValue([]);
});

afterEach(cleanup);

/** A promise with its resolve and reject handed out, so a test decides when a request settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

/* ============================================================================================
 * Phase 88.6-21 task 2 — the three header CTAs on the primitive, and the kebab entry gate.
 *
 * These are RENDERED assertions, not source greps: `btnCensus.test.tsx` already pins that no
 * `.btn` class string survives in this file, and a second source scan would prove the same thing
 * twice while proving nothing about what the browser gets. What can only be seen by rendering is
 * which cva output each control actually receives — that `variant="ghost"` did not quietly become
 * the default `primary`, that the owner-ruled wash and ring survived `cn`'s tailwind-merge rather
 * than being dropped by it, and that the slotted anchor carries no `type`.
 * ========================================================================================== */

/** Mount the page with a resolved identity at `role`, settled on a branch-specific control. */
async function renderHeaderAt(role: string) {
  h.selfUuid = SELF_UUID;
  h.isPending = false;
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue([
    { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role } },
    { id: 'other-uuid', user_id: 'auth0|other', username: 'Other', UserGroup: { role: 'owner' } },
  ]);
  const utils = render(<GroupHomePage />);
  // "Plan Game Session" renders for every role, so it is the settle signal that does not
  // presuppose the gate under test.
  await screen.findByRole('link', { name: 'Plan Game Session' });
  return utils;
}

describe('groupHomePage header CTAs on the Button primitive (88.6-21 D-09 / UI-SPEC §3.2)', () => {
  it('the Create-Event CTA is `variant="accent"` with its inline amber style DELETED', async () => {
    await renderHeaderAt('owner');
    const cta = screen.getByRole('button', { name: 'Add New Game Event' });

    // The class is the whole point: `.btn-accent` paints the SAME `--amber-700` the inline pair
    // did, from the one place that owns it.
    expect(cta).toHaveClass('btn-accent');
    // The routed duplication is gone — no second expression of the amber at this call site.
    expect(cta.getAttribute('style') ?? '').not.toContain('amber-700');
    expect(cta.getAttribute('style') ?? '').not.toContain('background');
    // §3.4 rule 2: it rests at `lg` and must not SHRINK on hover under the base's `md`. The
    // spelling is load-bearing — a bare `hover:` pin would not de-dupe against the base token.
    expect(cta).toHaveClass('shadow-theme-lg', 'enabled-hover:shadow-theme-lg');
    expect(cta.className).not.toContain('hover:shadow-xl');
  });

  it('"Plan Game Session" is `asChild variant="primary"` — one anchor, no `type`', async () => {
    await renderHeaderAt('owner');
    const link = screen.getByRole('link', { name: 'Plan Game Session' });

    expect(link.tagName).toBe('A');
    // `asChild` renders the CHILD, so there must be no wrapping <button> of the same name.
    expect(screen.queryByRole('button', { name: 'Plan Game Session' })).toBeNull();
    // `type` is invalid on an anchor and `Button` omits it on the slotted path.
    expect(link).not.toHaveAttribute('type');
    expect(link).toHaveClass('btn', 'btn-primary');
    expect(link).toHaveClass('shadow-theme-lg', 'enabled-hover:shadow-theme-lg');
    // D-14b: the off-tier token is gone from the control, not merely from the file.
    expect(link.className).not.toContain('shadow-xl');
    // D-36/D-09: the per-CTA desktop floor moved onto the primitive's base in this same commit.
    expect(link).toHaveClass('min-h-11');
  });

  it('"Manage Members" is `variant="ghost"` and KEEPS its 88.3-16 wash, ring and dark arm', async () => {
    await renderHeaderAt('owner');
    const manage = screen.getByRole('button', { name: 'Manage Members' });

    // ghost, not secondary and not primary. `variant="secondary"` is the REJECTED arm of owner
    // ruling 2 (2026-08-27) — the marker prices the opaque fill at 1.1330 on the white header,
    // a WEAKER cue than the ring this control ships. `primary` is forbidden for a bare `.btn`.
    //
    // The identity is asserted on the ghost variant's SURVIVING tokens, not on `bg-transparent`:
    // measured here, tailwind-merge DELETES `bg-transparent` (and the base's `shadow-theme-sm`,
    // and ghost's `text-content-secondary`) because the call site supplies `bg-white/80`,
    // `shadow-theme-md` and `text-content-primary`. That deletion IS the mechanism by which the
    // owner-ruled wash survives the migration, so asserting the token it removes would have
    // asserted the opposite of the contract.
    expect(manage).toHaveClass('enabled-hover:bg-surface-hover', 'aria-disabled:text-content-muted');
    expect(manage.className).not.toContain('btn-secondary');
    expect(manage.className).not.toContain('btn-primary');
    expect(manage.className).not.toContain('btn-accent');

    // The owner-ruled edge treatment SURVIVES the migration, byte for byte.
    expect(manage).toHaveClass('bg-white/80', 'ring-1', 'ring-line-control', 'dark:ring-0');
    expect(manage).toHaveClass('dark:bg-white/10', 'dark:backdrop-blur-xs');
    // The dark hover had to be RE-SPELLED, not kept: `enabled-hover` is (0,4,0) and the old
    // `dark:hover:` form is (0,2,0), so the ghost variant's light-theme surface token would have
    // won in dark mode. This arm is what stops that from being re-introduced as a "simplification".
    expect(manage).toHaveClass('dark:enabled-hover:bg-white/20');
    expect(manage.className).not.toContain('dark:hover:bg-white/20');

    // Measured-safe elevation: rests at `md`, and the base's hover is also `md`. No pin, by design.
    expect(manage).toHaveClass('shadow-theme-md');
    expect(manage.className).not.toContain('enabled-hover:shadow-theme-lg');
  });

  it('all three take the ring from the primitive, not from a per-site string (A-2 ARM A)', async () => {
    await renderHeaderAt('owner');
    for (const el of [
      screen.getByRole('button', { name: 'Manage Members' }),
      screen.getByRole('link', { name: 'Plan Game Session' }),
      screen.getByRole('button', { name: 'Add New Game Event' }),
    ]) {
      // Present exactly ONCE. `cn`'s tailwind-merge would keep a duplicate call-site copy of a
      // ring token beside the base's, so "present" alone would not catch a second expression.
      expect(el.className.match(/focus-visible:ring-2/g) ?? []).toHaveLength(1);
    }
  });
});

describe('groupHomePage group-settings entry is owner/admin (88.6-21 D-31, owner 2026-08-27)', () => {
  it('an OWNER sees the kebab trigger and the "Group settings" item', async () => {
    await renderHeaderAt('owner');
    expect(await screen.findByRole('button', { name: 'Group actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Group settings' })).toBeInTheDocument();
  });

  it('an ADMIN sees it too', async () => {
    await renderHeaderAt('admin');
    expect(await screen.findByRole('button', { name: 'Group actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Group settings' })).toBeInTheDocument();
  });

  it('a plain MEMBER sees NEITHER the wrapper nor the item — and still reaches Manage Members', async () => {
    await renderHeaderAt('member');

    // The POSITIVE half first, so the two absences below are not absence-by-nothing-rendered:
    // an active member still gets the Manage Members opener, which is where Leave Group lives
    // (ManageMembers.js, anchor `{isCurrentUser && !isOwner && (`). This gate strands nobody.
    expect(screen.getByRole('button', { name: 'Manage Members' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Group actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Group settings' })).toBeNull();
  });
});

// 88.6.1-55 Task 1 (D-46 / AC-23, R7-M7). The separator is read by TEXT, not by accessible
// name: an aria-hidden separator is still in the DOM, so a role-based "no > in the name" check
// would pass whether or not the attribute exists (the groupPlanning page test's reasoning).
describe('groupHomePage breadcrumb — hidden separator, min-w-0, ring (88.6.1-55: D-46 / R7-M7)', () => {
  it('BH-1. the separator is aria-hidden, the nav carries min-w-0 beside its overflow tokens, and the Home link keeps the house ring', async () => {
    await renderHeaderAt('member');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });

    expect(within(nav).getByText('>')).toHaveAttribute('aria-hidden', 'true');

    const navTokens = nav.className.split(/\s+/);
    for (const token of ['inline-block', 'max-w-full', 'wrap-break-word', 'min-w-0']) {
      expect(navTokens).toContain(token);
    }

    // The preservation half: the Home link already carried the ring (DECISION Phase 88.3-17).
    const homeTokens = within(nav).getByRole('link', { name: 'Home' }).className.split(/\s+/);
    for (const token of [
      'focus:outline-hidden',
      'focus-visible:ring-2',
      'focus-visible:ring-focus-ring',
      'focus-visible:ring-offset-2',
    ]) {
      expect(homeTokens).toContain(token);
    }
  });
});

// 88.6.1-55 Task 3 (Req 9; D-09a / D-37 precedent). Every absence below is asserted synchronously
// after act returns, never inside waitFor (CF-26): a waitFor around an absence passes on its
// first tick.
describe('groupHomePage games refresh keeps the page (88.6.1-55: Req 9, D-09a / D-37 precedent)', () => {
  const gamesFailure = () => new ApiError('Request failed', 'internal', 500);

  it('GR-1. an event created from the page refreshes the games without replacing the page', async () => {
    await renderHeaderAt('owner');
    const before = screen.getByRole('link', { name: 'Plan Game Session' });
    const refresh = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(refresh.promise);

    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-new' });
    });

    expect(screen.queryByText('Loading games...')).toBeNull();
    expect(screen.getByRole('link', { name: 'Plan Game Session' })).toBe(before);
    expect(listsAPI.getGroupGames as Mock).toHaveBeenCalledTimes(2);

    const game = { id: 'game-1', name: 'Azul' };
    await act(async () => {
      refresh.resolve([game]);
    });
    expect(h.gamesListProps!.games).toEqual([game]);
  });

  it('GR-2. Try again keeps the page AND the banner until the answer, and resolves the outcome', async () => {
    (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(gamesFailure());
    await renderHeaderAt('owner');
    expect(h.gamesListProps!.errorState.showError).toBe(true);
    expect(h.gamesListProps!.games).toEqual([]);
    const before = screen.getByRole('link', { name: 'Plan Game Session' });

    const firstRetry = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(firstRetry.promise);
    let p1!: Promise<unknown>;
    await act(async () => {
      p1 = h.gamesListProps!.errorState.retry();
    });

    // In flight: the page stays mounted and the banner stays (its label and focus live there).
    expect(screen.queryByText('Loading games...')).toBeNull();
    expect(screen.getByRole('link', { name: 'Plan Game Session' })).toBe(before);
    expect(h.gamesListProps!.errorState.showError).toBe(true);

    await act(async () => {
      firstRetry.reject(gamesFailure());
    });
    await expect(p1).resolves.toMatchObject({ isError: true });
    expect(h.gamesListProps!.errorState.showError).toBe(true);

    const game = { id: 'game-1', name: 'Azul' };
    (listsAPI.getGroupGames as Mock).mockResolvedValueOnce([game]);
    let p2!: Promise<unknown>;
    await act(async () => {
      p2 = h.gamesListProps!.errorState.retry();
      await p2;
    });
    await expect(p2).resolves.toMatchObject({ isError: false });
    expect(h.gamesListProps!.errorState.showError).toBe(false);
    expect(h.gamesListProps!.games).toEqual([game]);
  });

  it('GR-3. a switch to another group still names what is loading until that group settles', async () => {
    const { rerender } = await renderHeaderAt('owner');
    const otherGroup = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(otherGroup.promise);

    h.search = 'id=GROUP2';
    rerender(<GroupHomePage />);

    expect(await screen.findByText('Loading games...')).toBeInTheDocument();
    await act(async () => {
      otherGroup.resolve([]);
    });
  });

  it('GR-4. only the newest request writes: an older answer, or an older failure, lands nowhere but the log', async () => {
    const gameA = { id: 'game-a', name: 'Older' };
    const gameB = { id: 'game-b', name: 'Newer' };

    // Arm 1: an older SUCCESS that settles last is dropped.
    await renderHeaderAt('owner');
    const a1 = deferred<unknown[]>();
    const b1 = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(a1.promise).mockReturnValueOnce(b1.promise);
    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-1' });
    });
    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-2' });
    });
    await act(async () => {
      b1.resolve([gameB]);
    });
    await act(async () => {
      a1.resolve([gameA]);
    });
    expect(h.gamesListProps!.games).toEqual([gameB]);
    expect(screen.queryByText('Loading games...')).toBeNull();

    cleanup();

    // Arm 2 (seam pass S7-1): an older FAILURE that settles last writes no error, but is LOGGED
    // first (the house log-first order).
    const infoSpy = vi.spyOn(logger, 'info');
    await renderHeaderAt('owner');
    const a2 = deferred<unknown[]>();
    const b2 = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(a2.promise).mockReturnValueOnce(b2.promise);
    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-3' });
    });
    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-4' });
    });
    await act(async () => {
      b2.resolve([gameB]);
    });
    await act(async () => {
      a2.reject(gamesFailure());
    });
    expect(h.gamesListProps!.games).toEqual([gameB]);
    expect(h.gamesListProps!.errorState.showError).toBe(false);
    expect(infoSpy.mock.calls.some(([msg]) => msg === 'Error fetching games:')).toBe(true);
    infoSpy.mockRestore();
  });
});

// 88.6.1-55 Task 4 (W051 / AC-35, LATENT-AND-DEAD-RULING item 1, owner 2026-10-03: TIDY). The
// kebab asks the owner/admin question ONCE: the wrapper. The role variable's name is read from the
// page's own declaration rather than spelled here, so no suite names it (AC-35: it occurs in no
// file but the page). The three role tests above stay the behaviour pins.
describe('groupHomePage kebab — one role check (88.6.1-55: W051 / AC-35)', () => {
  it('KB-1. the KebabMenu items are an array literal with no role check, inside the one owner/admin wrapper', () => {
    const src = withoutComments(fs.readFileSync(path.join(__dirname, 'page.js'), 'utf8'));
    const decl = /const\s+([A-Za-z_$][\w$]*)\s*=\s*userRole === 'owner' \|\| userRole === 'admin';/.exec(src);
    expect(decl).not.toBeNull();
    const roleVar = decl![1];

    const opens = [...src.matchAll(/<KebabMenu(?=[\s>/])/g)];
    expect(opens).toHaveLength(1);
    const tag = readOpeningTag(src, opens[0].index ?? 0);
    expect(tag).not.toBeNull();
    expect(tag!).toContain('ariaLabel="Group actions"');
    expect(tag!).toMatch(/items=\{\s*\[/);
    expect(tag!).not.toContain(roleVar);

    // The wrapper still encloses the trigger's div: the role variable, then the div, then the menu.
    expect(src).toMatch(
      new RegExp(`\\{\\s*${roleVar}\\s*&&\\s*\\(\\s*<div className="shrink-0 relative z-20">\\s*<KebabMenu\\b`),
    );
  });
});
