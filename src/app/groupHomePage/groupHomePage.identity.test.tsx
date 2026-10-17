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
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mutable self-identity the mocked hook reads so each case can present a
// pending (undefined selfUuid) or resolved identity.
// `search` drives useSearchParams (GR-3 switches group); the four `*Props` fields are what the
// createEvent, GroupGamesList, EventCalendar and ManageMembers stubs last rendered with (the refresh
// and load-failure describes drive and read them).
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isPending: true,
  search: 'id=GROUP1',
  createEventProps: null as null | { onEventCreated: (event: unknown) => Promise<void> },
  gamesListProps: null as null | {
    games: unknown[];
    groupId?: string;
    members?: unknown[] | null;
    errorState: { showError: boolean; retry: () => Promise<unknown> };
    retained?: boolean;
    focusRef?: { current: unknown } | null;
  },
  // Every GroupGamesList render, in order (88.6.1-56's GP describe reads the sequence; it clears
  // this in its own hooks).
  gamesListLog: [] as Array<{
    groupId?: string;
    errorState: { showError: boolean };
    retained?: boolean;
    focusRef?: { current: unknown } | null;
  }>,
  calendarProps: null as null | {
    events: unknown[];
    title?: string;
    headingRef?: React.RefObject<HTMLHeadingElement>;
  },
  manageMembersProps: null as null | {
    modal: boolean;
    modaltoggle: () => void;
    onMembersUpdated: () => Promise<unknown>;
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

// Stub the heavy children. Four of the stubs capture their props: createEvent and GroupGamesList for
// the games refresh describe, ManageMembers (its `onMembersUpdated` is a members refresh) and
// EventCalendar for the 88.6.1-71 load-failure describes. Every stub renders nothing EXCEPT the
// calendar's: it renders a `calendar-stub` div holding an h2 with the `title`, carrying
// `props.headingRef` — plan 88.6.1-73's `headingRef` contract in miniature (the real component is
// pinned by plan 73's HR-4), so the events focus target exists in jsdom.
vi.mock('@/app/components/createEvent', () => ({
  default: (props: NonNullable<typeof h.createEventProps>) => {
    h.createEventProps = props;
    return null;
  },
}));
// While its `modal` prop is true the ManageMembers stub renders a REAL `Modal` bound to the page's
// `modal` / `modaltoggle` (Radix hides the page from assistive tech while it is open — RF-8's
// premise); closed it renders nothing, as the real component does (`if (!modal) return null;`).
vi.mock('@/app/components/ManageMembers', async () => {
  const { Modal } = await import('@/app/components/Modal');
  return {
    default: (props: NonNullable<typeof h.manageMembersProps>) => {
      h.manageMembersProps = props;
      if (!props.modal) return null;
      return (
        <Modal open={props.modal} onClose={props.modaltoggle}>
          <Modal.Header>Manage Members</Modal.Header>
          <Modal.Body>
            <button type="button">Stub member</button>
          </Modal.Body>
        </Modal>
      );
    },
  };
});
vi.mock('@/app/components/GroupGamesList', () => ({
  default: (props: NonNullable<typeof h.gamesListProps>) => {
    h.gamesListProps = props;
    h.gamesListLog.push(props);
    return null;
  },
}));
vi.mock('@/app/components/EventCalendar', () => ({
  default: (props: NonNullable<typeof h.calendarProps>) => {
    h.calendarProps = props;
    return (
      <div data-testid="calendar-stub">
        <h2 ref={props.headingRef}>{props.title}</h2>
        <button type="button">Stub day</button>
      </div>
    );
  },
}));
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
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
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
  h.calendarProps = null;
  h.manageMembersProps = null;
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

/** Render the page inside a `main` element — the focus floor's last stop (the app's layout wraps
 *  every page in one), so a test can tell "focus landed on the page" from "focus fell to body". */
function renderInMain() {
  return render(
    <main>
      <GroupHomePage />
    </main>
  );
}

/** The house idiom (`useFetchErrorState.test.tsx`, anchor `function fireVisibility(`): a tab return. */
function fireVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// copy row RF1 / D-47 — the shared refresh notice's sentence (plan 88.6.1-70 owns the one constant;
// written once here, contract C7).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

const EV_A = { id: 'ev-a', start_date: '2026-11-02T19:00:00.000Z' };
const EV_B = { id: 'ev-b', start_date: '2026-11-09T19:00:00.000Z' };
const ROSTER3 = [
  { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role: 'owner' } },
  { id: 'other-uuid', user_id: 'auth0|other', username: 'Other', UserGroup: { role: 'member' } },
  { id: 'third-uuid', user_id: 'auth0|third', username: 'Third', UserGroup: { role: 'member' } },
];

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

/** Mount the page with a resolved identity at `role`, settled on a branch-specific control. With
 *  `{ inMain: true }` the page renders inside a `main` (the focus floor's last stop, as in the app's
 *  layout), through `renderInMain`. */
async function renderHeaderAt(role: string, opts: { inMain?: boolean } = {}) {
  h.selfUuid = SELF_UUID;
  h.isPending = false;
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue([
    { id: SELF_UUID, user_id: 'auth0|self', username: 'Me', UserGroup: { role } },
    { id: 'other-uuid', user_id: 'auth0|other', username: 'Other', UserGroup: { role: 'owner' } },
  ]);
  const utils = opts.inMain ? renderInMain() : render(<GroupHomePage />);
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

/* ============================================================================================
 * 88.6.1-71 Task 1 — the page's two first-load failures (Req 9, owner rulings 2026-10-05, D-47).
 * A failed members load used to leave "Loading group…" up forever; a failed events load rendered
 * an empty calendar. Both are now tracked through `useFetchErrorState`, newest run wins, the
 * error clears only on the newest success, and `retained` comes from plan 88.6.1-70's
 * `useRetainedContent` (contract C10: an access or gone answer is never kept on screen). The two
 * titles are copy rows G7 / G8 (D-47), written here as literals.
 * ========================================================================================== */
describe('groupHomePage load failures (88.6.1-71: Req 9, owner rulings 2026-10-05)', () => {
  const G7 = "Couldn't load this group";
  const G8 = "Couldn't load this group's events";
  const internal = () => new ApiError('Request failed', 'internal', 500);
  const membersCalls = () => (groupsAPI.getGroupMembers as Mock).mock.calls.length;
  const eventsCalls = () => (eventsAPI.getGroupEvents as Mock).mock.calls.length;
  const statusHolds = (text: string) => screen.getAllByRole('status').some((r) => r.textContent === text);
  const resolveIdentity = () => {
    h.selfUuid = SELF_UUID;
    h.isPending = false;
  };

  it('MB-1. a failed first members load shows the group banner instead of an endless loading line', async () => {
    resolveIdentity();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(internal());
    render(<GroupHomePage />);
    await screen.findAllByText(G7);
    expect(screen.queryByText('Loading group…')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(listsAPI.getGroupGames as Mock).not.toHaveBeenCalled();
  });

  it('MB-2. a failed Try again keeps focus and speaks the title again; a good one loads the page, focus inside main', async () => {
    resolveIdentity();
    (groupsAPI.getGroupMembers as Mock)
      .mockRejectedValueOnce(internal())
      .mockRejectedValueOnce(internal())
      .mockResolvedValue(ROSTER);
    renderInMain();
    await screen.findAllByText(G7);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Try again' });

    await user.click(button);
    await waitFor(() => expect(membersCalls()).toBe(2));
    await waitFor(() => expect(button).toHaveTextContent('Try again'));
    await waitFor(() => expect(statusHolds(G7)).toBe(true));
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await screen.findByRole('link', { name: 'Plan Game Session' });
    expect(screen.queryAllByText(G7)).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.querySelector('main')!.contains(document.activeElement)).toBe(true);
    });
  });

  it('MB-3. a members answer that is not a list shows the group banner', async () => {
    resolveIdentity();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue({ unexpected: true });
    render(<GroupHomePage />);
    await screen.findAllByText(G7);
    expect(screen.queryByText('Loading group…')).toBeNull();
  });

  it('MB-4. a removal (403) still redirects first and never shows the group banner', async () => {
    resolveIdentity();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('Forbidden', 'forbidden', 403));
    render(<GroupHomePage />);
    await waitFor(() =>
      expect(pushSpy.mock.calls.some(([url]) => String(url).startsWith('/?removedFrom='))).toBe(true)
    );
    expect(screen.queryAllByText(G7)).toHaveLength(0);
  });

  it('MB-5. a failed members refresh keeps the member list (C1)', async () => {
    await renderHeaderAt('owner');
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    const before = screen.getByRole('link', { name: 'Plan Game Session' });
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(internal());
    await act(async () => {
      await h.manageMembersProps!.onMembersUpdated();
    });
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    expect(h.gamesListProps!.members).toHaveLength(2);
    expect(screen.queryAllByText(G7)).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Plan Game Session' })).toBe(before);
  });

  it('MB-6. only the newest members run writes; an overtaken failure is still logged', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    await renderHeaderAt('owner');
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    const callsBefore = membersCalls();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await act(async () => {
      void h.manageMembersProps!.onMembersUpdated();
    });
    await act(async () => {
      void h.manageMembersProps!.onMembersUpdated();
    });
    // A direct caller never joins a pending run (IF-1's other half): both reached the request.
    expect(membersCalls()).toBe(callsBefore + 2);
    await act(async () => {
      b.resolve(ROSTER3);
    });
    await act(async () => {
      a.reject(internal());
    });
    expect(screen.getByText(/3 members/)).toBeInTheDocument();
    expect(h.gamesListProps!.members).toHaveLength(3);
    expect(screen.queryAllByText(G7)).toHaveLength(0);
    expect(infoSpy.mock.calls.some(([msg]) => msg === 'Error fetching group members:')).toBe(true);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    infoSpy.mockRestore();
  });

  it('MB-7. a 401 members refresh replaces the loaded page with the group banner until a load succeeds (C10)', async () => {
    await renderHeaderAt('owner', { inMain: true });
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    const err = new ApiError('Unauthorized', 'unauthorized', 401);
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(err);
    await act(async () => {
      await h.manageMembersProps!.onMembersUpdated();
    });
    await screen.findAllByText(G7);
    expect(screen.getAllByText(getFetchErrorMessage(err)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/2 members/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Plan Game Session' })).toBeNull();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    const user = userEvent.setup();
    const callsBefore = membersCalls();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(internal());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(membersCalls()).toBe(callsBefore + 1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
    expect(screen.getAllByText(G7).length).toBeGreaterThan(0);
    expect(screen.queryByText(/2 members/)).toBeNull();

    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(ROSTER);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: 'Plan Game Session' });
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
  });

  it('EV-1. a failed first events load shows the Calendar heading and the events banner, never an empty calendar', async () => {
    (eventsAPI.getGroupEvents as Mock).mockRejectedValue(internal());
    await renderHeaderAt('owner');
    const [title] = await screen.findAllByText(G8);
    const heading = screen.getByRole('heading', { level: 2, name: 'Calendar' });
    expect(heading.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('calendar-stub')).toBeNull();
  });

  it('EV-2. a failed Try again keeps focus and speaks the title again; a good one brings the calendar back, focus on its heading', async () => {
    resolveIdentity();
    (eventsAPI.getGroupEvents as Mock)
      .mockRejectedValueOnce(internal())
      .mockRejectedValueOnce(internal())
      .mockResolvedValue([EV_A]);
    renderInMain();
    await screen.findByRole('link', { name: 'Plan Game Session' });
    await screen.findAllByText(G8);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Try again' });

    await user.click(button);
    await waitFor(() => expect(eventsCalls()).toBe(2));
    await waitFor(() => expect(button).toHaveTextContent('Try again'));
    await waitFor(() => expect(statusHolds(G8)).toBe(true));
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await screen.findByTestId('calendar-stub');
    expect(h.calendarProps!.events).toEqual([EV_A]);
    expect(screen.queryAllByText(G8)).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(h.calendarProps!.headingRef!.current));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('EV-3. a failed events refresh keeps the calendar and its events (C1)', async () => {
    (eventsAPI.getGroupEvents as Mock).mockResolvedValueOnce([EV_A]);
    await renderHeaderAt('owner');
    await waitFor(() => expect(h.calendarProps!.events).toEqual([EV_A]));
    const first = h.calendarProps!.events;
    (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(internal());
    await act(async () => {
      await h.createEventProps!.onEventCreated({ id: 'e-new' });
    });
    expect(screen.getByTestId('calendar-stub')).toBeInTheDocument();
    expect(h.calendarProps!.events).toBe(first);
    expect(screen.queryAllByText(G8)).toHaveLength(0);
  });

  it('EV-4. only the newest events run writes; an overtaken failure is still logged', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    (eventsAPI.getGroupEvents as Mock).mockResolvedValueOnce([EV_A]);
    await renderHeaderAt('owner');
    await waitFor(() => expect(h.calendarProps!.events).toEqual([EV_A]));
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    (eventsAPI.getGroupEvents as Mock).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-1' });
    });
    await act(async () => {
      void h.createEventProps!.onEventCreated({ id: 'e-2' });
    });
    await act(async () => {
      b.resolve([EV_B]);
    });
    await act(async () => {
      a.reject(internal());
    });
    expect(h.calendarProps!.events).toEqual([EV_B]);
    expect(screen.queryAllByText(G8)).toHaveLength(0);
    expect(infoSpy.mock.calls.some(([msg]) => msg === 'Error fetching group events:')).toBe(true);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    infoSpy.mockRestore();
  });

  it('EV-5. a 401 or a 403 events refresh replaces the loaded calendar with the events banner (C10)', async () => {
    for (const err of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      (eventsAPI.getGroupEvents as Mock).mockResolvedValueOnce([EV_A]);
      await renderHeaderAt('owner');
      await waitFor(() => expect(h.calendarProps!.events).toEqual([EV_A]));
      (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(err);
      await act(async () => {
        await h.createEventProps!.onEventCreated({ id: 'e-new' });
      });
      await screen.findAllByText(G8);
      expect(screen.getAllByText(getFetchErrorMessage(err)).length).toBeGreaterThan(0);
      expect(screen.queryByTestId('calendar-stub')).toBeNull();
      // The events fetch has no removal arm: a 403 here is the banner, never a redirect.
      expect(pushSpy).not.toHaveBeenCalled();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      cleanup();
    }
  });

  it('IF-1. a Try again pressed while a tab-return run is held joins that run instead of sending another', async () => {
    const user = userEvent.setup();

    // Members arm.
    resolveIdentity();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(internal());
    render(<GroupHomePage />);
    await screen.findAllByText(G7);
    const membersBefore = membersCalls();
    const heldMembers = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(heldMembers.promise);
    await act(async () => {
      fireVisibility('visible');
    });
    expect(membersCalls()).toBe(membersBefore + 1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(membersCalls()).toBe(membersBefore + 1);
    await act(async () => {
      heldMembers.resolve(ROSTER);
    });
    await screen.findByRole('link', { name: 'Plan Game Session' });
    expect(screen.queryAllByText(G7)).toHaveLength(0);

    cleanup();

    // Events arm.
    (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(internal());
    render(<GroupHomePage />);
    await screen.findByRole('link', { name: 'Plan Game Session' });
    await screen.findAllByText(G8);
    const eventsBefore = eventsCalls();
    const heldEvents = deferred<unknown>();
    (eventsAPI.getGroupEvents as Mock).mockReturnValueOnce(heldEvents.promise);
    await act(async () => {
      fireVisibility('visible');
    });
    expect(eventsCalls()).toBe(eventsBefore + 1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(eventsCalls()).toBe(eventsBefore + 1);
    await act(async () => {
      heldEvents.resolve([EV_A]);
    });
    await screen.findByTestId('calendar-stub');
    expect(screen.queryAllByText(G8)).toHaveLength(0);
  });
});

/* ============================================================================================
 * 88.6.1-71 Task 2 — a failed REFRESH keeps what was on screen under plan 88.6.1-70's shared notice
 * (AC-29, RF1, owner ruling 2026-10-05; ruling Y: an events list that loaded empty is retained),
 * removal first (C10), focus never falls to the page body when the app's own retry withdraws
 * content (C12, two guards), and the members notice is re-presented when the Manage Members
 * dialog closes over it (review r2 #236).
 * ========================================================================================== */
describe('groupHomePage refresh notice (88.6.1-71: AC-29, RF1, ruling Y, 88.6.1-70 contract C8 / C10 / C12)', () => {
  const internal = () => new ApiError('Request failed', 'internal', 500);
  /** The visible RF1 line: the RF1 text outside the `role="status"` node (it is in the DOM twice). */
  const visibleRf1 = () => screen.getAllByText(RF1).find((el) => !el.closest('[role="status"]'))!;
  const rf1Region = () => screen.getAllByText(RF1).find((el) => el.closest('[role="status"]'))!.closest('[role="status"]')!;
  const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const overview = () => screen.getByRole('button', { name: 'Overview' });
  const loadEvents = async (events: unknown[]) => {
    (eventsAPI.getGroupEvents as Mock).mockResolvedValueOnce(events);
    await renderHeaderAt('owner', { inMain: true });
    await waitFor(() => expect(h.calendarProps!.events).toEqual(events));
  };
  const failMembersRefresh = async (err: unknown = internal()) => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(err);
    await act(async () => {
      await h.manageMembersProps!.onMembersUpdated();
    });
  };
  const failEventsRefresh = async (err: unknown = internal()) => {
    (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(err);
    await act(async () => {
      await h.createEventProps!.onEventCreated({ id: 'e-new' });
    });
  };

  it('RF-1. a failed members refresh keeps the page and shows RF1 between the header and the tabs; Retry lands on the h1', async () => {
    await renderHeaderAt('owner', { inMain: true });
    const regionsBefore = screen.getAllByRole('status');
    await failMembersRefresh();
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    await waitFor(() => expect(regionsBefore).toContain(rf1Region()));
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    expect(follows(screen.getByRole('link', { name: 'Plan Game Session' }), visibleRf1())).toBe(true);
    expect(follows(visibleRf1(), overview())).toBe(true);
    expect(screen.queryAllByText("Couldn't load this group")).toHaveLength(0);

    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(ROSTER);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })));
  });

  it('RF-2. a failed events refresh keeps the calendar and shows RF1 above it; Retry lands on the Calendar heading', async () => {
    await loadEvents([EV_A]);
    const first = h.calendarProps!.events;
    const regionsBefore = screen.getAllByRole('status');
    await failEventsRefresh();
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    await waitFor(() => expect(regionsBefore).toContain(rf1Region()));
    expect(h.calendarProps!.events).toBe(first);
    expect(follows(overview(), visibleRf1())).toBe(true);
    expect(follows(visibleRf1(), screen.getByTestId('calendar-stub'))).toBe(true);
    expect(screen.queryAllByText("Couldn't load this group's events")).toHaveLength(0);

    (eventsAPI.getGroupEvents as Mock).mockResolvedValueOnce([EV_A, EV_B]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
    expect(h.calendarProps!.events).toHaveLength(2);
    await waitFor(() => expect(document.activeElement).toBe(h.calendarProps!.headingRef!.current));
  });

  it('RF-3. a removal (403) on a members refresh still redirects and never shows RF1 (C10)', async () => {
    await renderHeaderAt('owner');
    await failMembersRefresh(new ApiError('Forbidden', 'forbidden', 403));
    expect(pushSpy.mock.calls.some(([url]) => String(url).startsWith('/?removedFrom='))).toBe(true);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
  });

  it('RF-4. an events list that loaded EMPTY is kept under RF1, never the events banner (ruling Y)', async () => {
    await loadEvents([]);
    expect(h.calendarProps!.events).toHaveLength(0);
    const first = h.calendarProps!.events;
    const regionsBefore = screen.getAllByRole('status');
    await failEventsRefresh();
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    await waitFor(() => expect(regionsBefore).toContain(rf1Region()));
    expect(screen.getByTestId('calendar-stub')).toBeInTheDocument();
    expect(h.calendarProps!.events).toBe(first);
    expect(screen.queryAllByText("Couldn't load this group's events")).toHaveLength(0);
    expect(follows(visibleRf1(), screen.getByTestId('calendar-stub'))).toBe(true);
  });

  it('RF-5. a network failure on either refresh is RF1 over the kept content (C8 e, the transient half)', async () => {
    await renderHeaderAt('owner');
    await failMembersRefresh(new ApiError('offline', 'network', 0));
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
    expect(screen.queryAllByText("Couldn't load this group")).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
    cleanup();

    await loadEvents([EV_A]);
    await failEventsRefresh(new ApiError('offline', 'network', 0));
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    expect(screen.getByTestId('calendar-stub')).toBeInTheDocument();
    expect(h.calendarProps!.events).toEqual([EV_A]);
    expect(screen.queryAllByText("Couldn't load this group's events")).toHaveLength(0);
  });

  it('RF-6. a members refresh nobody pressed never drops focus to the body (C8 f / C12)', async () => {
    // (f1) an unpressed 401 withdraws the page while a control inside it holds focus.
    await renderHeaderAt('owner', { inMain: true });
    await failMembersRefresh();
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: 'Plan Game Session' });
    act(() => link.focus());
    expect(document.activeElement).toBe(link);
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(new ApiError('Unauthorized', 'unauthorized', 401));
    await act(async () => {
      fireVisibility('visible');
    });
    await screen.findAllByText("Couldn't load this group");
    expect(screen.queryByRole('link', { name: 'Plan Game Session' })).toBeNull();
    expect(screen.queryByText(/2 members/)).toBeNull();
    await act(async () => {});
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')));
    expect(document.activeElement).not.toBe(document.body);
    cleanup();

    // (f2) an unpressed success removes the focused Retry.
    await renderHeaderAt('owner', { inMain: true });
    await failMembersRefresh();
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(ROSTER);
    await act(async () => {
      fireVisibility('visible');
    });
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })));
  });

  it('RF-7. an events refresh nobody pressed never drops focus to the body (C8 f / C12)', async () => {
    // (f1) an unpressed 403 withdraws the calendar while a control inside it holds focus.
    await loadEvents([EV_A]);
    await failEventsRefresh();
    expect(screen.getAllByText(RF1).length).toBeGreaterThan(0);
    const stubDay = screen.getByRole('button', { name: 'Stub day' });
    act(() => stubDay.focus());
    (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(new ApiError('Forbidden', 'forbidden', 403));
    await act(async () => {
      fireVisibility('visible');
    });
    await screen.findAllByText("Couldn't load this group's events");
    expect(screen.queryByTestId('calendar-stub')).toBeNull();
    await act(async () => {});
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Calendar' }))
    );
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
    cleanup();

    // (f2) an unpressed success removes the focused Retry.
    await loadEvents([EV_A]);
    await failEventsRefresh();
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    (eventsAPI.getGroupEvents as Mock).mockResolvedValueOnce([EV_A, EV_B]);
    await act(async () => {
      fireVisibility('visible');
    });
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
    await waitFor(() => expect(document.activeElement).toBe(h.calendarProps!.headingRef!.current));
  });

  it('RF-8. a members refresh that fails behind the open Manage Members dialog fills a region the dialog does not hide; the close re-presents nothing', async () => {
    await renderHeaderAt('owner', { inMain: true });
    const regionsBefore = screen.getAllByRole('status');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Manage Members' }));
    await screen.findByRole('dialog');
    // Measured premise: the dialog hides the page around it (Radix -> aria-hidden's hideOthers)...
    const link = screen.getByRole('link', { name: 'Plan Game Session', hidden: true });
    expect(link.closest('[aria-hidden="true"]')).not.toBeNull();

    await failMembersRefresh();
    // ...but not the notice's live region (the package exempts aria-live elements): the fill is heard.
    expect(screen.getAllByText(RF1)).toHaveLength(2);
    const region = rf1Region();
    expect(regionsBefore).toContain(region);
    expect(region.closest('[aria-hidden]')).toBeNull();

    act(() => {
      h.manageMembersProps!.modaltoggle();
    });
    // The close re-presents nothing: the same region keeps its text, so the sentence is not spoken twice.
    expect(screen.getAllByText(RF1)).toHaveLength(2);
    expect(rf1Region()).toBe(region);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(rf1Region()).toBe(region);
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
  });
});

describe('groupHomePage games retention (88.6.1-56: C3 + C10)', () => {
  const GAME = { id: 'game-1', name: 'Wingspan' };
  const err = (code: 'internal' | 'network' | 'unauthorized' | 'forbidden', status: number) =>
    new ApiError('Request failed', code, status);
  const refreshVia = async () => {
    await act(async () => {
      await h.createEventProps!.onEventCreated({ id: 'e-new' });
    });
  };

  beforeEach(() => {
    h.gamesListLog = [];
  });
  afterEach(() => {
    h.gamesListLog = [];
    h.search = 'id=GROUP1';
  });

  it('GP-1. a first load sets retained, one page-owned focusRef; a 500 or network refresh keeps the games retained', async () => {
    (listsAPI.getGroupGames as Mock).mockResolvedValue([GAME]);
    await renderHeaderAt('owner');
    await waitFor(() => expect(h.gamesListProps!.retained).toBe(true));
    const ref = h.gamesListProps!.focusRef;
    expect(ref).toBeTruthy();
    expect(ref).toHaveProperty('current');
    for (const props of h.gamesListLog) expect(props.focusRef).toBe(ref);

    for (const error of [err('internal', 500), err('network', 0)]) {
      (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(error);
      await refreshVia();
      expect(h.gamesListProps!.retained).toBe(true);
      expect(h.gamesListProps!.errorState.showError).toBe(true);
      expect(h.gamesListProps!.games).toEqual([GAME]);
    }
    for (const props of h.gamesListLog) expect(props.focusRef).toBe(ref);
  });

  it('GP-2. a 401 withdraws until the next success; a 403 is still the removal redirect', async () => {
    (listsAPI.getGroupGames as Mock).mockResolvedValue([GAME]);
    await renderHeaderAt('owner');
    await waitFor(() => expect(h.gamesListProps!.retained).toBe(true));

    (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(err('unauthorized', 401));
    await refreshVia();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(h.gamesListProps!.retained).toBe(false);
    expect(h.gamesListProps!.errorState.showError).toBe(true);

    (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(err('internal', 500));
    await act(async () => {
      await h.gamesListProps!.errorState.retry();
    });
    expect(h.gamesListProps!.errorState.showError).toBe(true);
    expect(h.gamesListProps!.retained).toBe(false);

    (listsAPI.getGroupGames as Mock).mockResolvedValueOnce([GAME]);
    await act(async () => {
      await h.gamesListProps!.errorState.retry();
    });
    expect(h.gamesListProps!.retained).toBe(true);
    expect(h.gamesListProps!.errorState.showError).toBe(false);

    (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(err('forbidden', 403));
    await refreshVia();
    expect(pushSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/\?removedFrom=/));
    expect(h.gamesListProps!.errorState.showError).toBe(false);
  });

  it('GP-3. a group switch never renders the previous group’s kept error under the new id, and never retains its list', async () => {
    (listsAPI.getGroupGames as Mock).mockResolvedValue([GAME]);
    const { rerender } = await renderHeaderAt('owner');
    await waitFor(() => expect(h.gamesListProps!.retained).toBe(true));
    (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(err('internal', 500));
    await refreshVia();
    expect(h.gamesListProps!.errorState.showError).toBe(true);
    expect(h.gamesListProps!.retained).toBe(true);

    const second = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(second.promise);
    const mark = h.gamesListLog.length;
    h.search = 'id=GROUP2';
    rerender(<GroupHomePage />);
    expect(await screen.findByText('Loading games...')).toBeInTheDocument();
    const duringSwitch = h.gamesListLog.slice(mark);
    expect(
      duringSwitch.filter((p) => p.groupId === 'GROUP2' && p.errorState.showError === true)
    ).toHaveLength(0);

    await act(async () => {
      second.reject(err('internal', 500));
    });
    await waitFor(() => expect(screen.queryByText('Loading games...')).toBeNull());
    expect(h.gamesListProps!.groupId).toBe('GROUP2');
    expect(h.gamesListProps!.errorState.showError).toBe(true);
    expect(h.gamesListProps!.retained).toBe(false);
  });

  it('GP-4. a games retry joins the pending tab-return run instead of starting another', async () => {
    (listsAPI.getGroupGames as Mock).mockRejectedValueOnce(err('internal', 500));
    await renderHeaderAt('owner');
    await waitFor(() => expect(h.gamesListProps!.errorState.showError).toBe(true));
    const calls = (listsAPI.getGroupGames as Mock).mock.calls.length;

    const held = deferred<unknown[]>();
    (listsAPI.getGroupGames as Mock).mockReturnValueOnce(held.promise);
    act(() => fireVisibility('visible'));
    expect((listsAPI.getGroupGames as Mock).mock.calls.length).toBe(calls + 1);

    act(() => {
      void h.gamesListProps!.errorState.retry();
    });
    expect((listsAPI.getGroupGames as Mock).mock.calls.length).toBe(calls + 1);

    await act(async () => {
      held.resolve([GAME]);
    });
    await waitFor(() => expect(h.gamesListProps!.games).toEqual([GAME]));
    expect(h.gamesListProps!.errorState.showError).toBe(false);
  });
});
