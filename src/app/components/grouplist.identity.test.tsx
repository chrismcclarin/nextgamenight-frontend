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
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
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
// 88-18: GroupList now mounts TWO of these — the D-08 identity degrade AND the
// groups-fetch failure (which used to be flattened into `setGroups([])` and shown
// as "No groups yet"). The stub renders the `title` so the two are tellable apart;
// the testid is kept for the pre-existing WR-03 assertions.
// 88.6.1-70 contract C9: keep the real module so useRetainedContent and isAccessOrGoneError stay real; the notice itself is proven in grouplist.refresh.test.tsx against the real module.
vi.mock('@/components/ui/FetchErrorBanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/FetchErrorBanner')>()),
  FetchErrorBanner: ({ state, title }: { state: { showError: boolean }; title?: string }) =>
    state.showError ? (
      <div data-testid="identity-degrade-banner">{title ?? 'degraded'}</div>
    ) : null,
  RefreshFailedNotice: () => null,
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

/**
 * Req 6 / UI-SPEC §9.2 + threat T-88-18-01 (plan 88-18).
 *
 * The groups fetch used to `setGroups([])` on catch, so a FAILED request rendered
 * "No groups yet!" — telling someone who may well own several groups that they had
 * none, on the app's landing surface. Identity failure (WR-03 above) and groups-fetch
 * failure are different causes and both must beat the empty copy.
 */
describe('GroupList empty vs failed groups fetch (Req 6 / T-88-18-01)', () => {
  it('renders the shared EmptyState with the §9.2 copy when the caller has no groups', async () => {
    h.selfUuid = SELF_UUID;
    (groupsAPI.getUserGroups as Mock).mockResolvedValue([]);

    render(<GroupList {...listProps} onCreateGroup={vi.fn()} />);

    expect(
      await screen.findByRole('heading', { name: 'No groups yet' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'A group is your people plus the games you play. Make one and invite them.'
      )
    ).toBeInTheDocument();
    // the hand-rolled two-line block is gone
    expect(screen.queryByText('No groups yet!')).toBeNull();
    expect(
      screen.queryByText('Create your first group to get started.')
    ).toBeNull();
  });

  it('keeps the header CTA AND offers one in the empty state (deliberate, unlike OpenPollsList)', async () => {
    h.selfUuid = SELF_UUID;
    (groupsAPI.getUserGroups as Mock).mockResolvedValue([]);

    render(<GroupList {...listProps} onCreateGroup={vi.fn()} />);
    await screen.findByRole('heading', { name: 'No groups yet' });

    // The header button is persistent panel chrome; the empty state's is the
    // in-body next step. Both, on purpose — see the DECISION marker in grouplist.js.
    expect(
      screen.getAllByRole('button', { name: 'Create new group' })
    ).toHaveLength(2);
    // ...but the tutorial hook must still resolve to exactly ONE element.
    expect(
      document.querySelectorAll('[data-tutorial="create-group-btn"]')
    ).toHaveLength(1);
  });

  it('renders the error treatment and NOT the empty copy when the groups fetch rejects', async () => {
    h.selfUuid = SELF_UUID;
    (groupsAPI.getUserGroups as Mock).mockRejectedValue(new Error('boom'));

    render(<GroupList {...listProps} onCreateGroup={vi.fn()} />);

    expect(
      await screen.findByText("We couldn't load your groups")
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No groups yet' })).toBeNull();
    expect(screen.queryByText('No groups yet!')).toBeNull();
  });
});

// Phase 88.6.1-41 (D-37, Req 9): the home list refreshes IN PLACE.
//
// Before this plan every refresh of the home list (a settings save, a bell invite accept, a
// member add, a retry) set the whole component back to its "Loading groups..." return and then
// redrew every card from scratch, and a failed refresh put the full groups banner where the
// cards had been. D-37 keeps "Loading groups..." for the FIRST load of the signed-in identity
// only (a has-loaded flag keyed on that identity, 88.6.1-70 contract C3), keeps the same card
// nodes mounted while a refresh is in flight with aria-busy on the cards wrapper only, never
// covers what loaded with the full banner (D-51; D-50 makes a list that loaded EMPTY retained
// content too), and lets the newest request win. The RF1 notice over retained content is plan
// 88.6.1-77's and is asserted in its real-module suite, not here.
//
// Every absence below is asserted SYNCHRONOUSLY after a positive signal or a deterministic flush,
// never inside a waitFor (FE-TESTING-CONVENTIONS CF-26).
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// No members and no events: no chip stack, no role controls, so each card's only control is its
// title block, whose accessible name is the group name.
const crew = (id: string, name: string) => ({ id, name, Users: [], Events: [] });
const ALPHA = crew('g-alpha', 'Alpha Crew');
const BETA = crew('g-beta', 'Beta Crew');
const GAMMA = crew('g-gamma', 'Gamma Crew');
const ZETA = crew('g-zeta', 'Zeta Crew');

const BANNER_TEXT = "We couldn't load your groups";

describe('D-37 — the home list refreshes in place (Req 9)', () => {
  const getUserGroups = () => groupsAPI.getUserGroups as Mock;
  const titleBlock = (name: string) => screen.getByRole('button', { name });
  const cardOf = (name: string) => titleBlock(name).closest('[data-testid="group-card"]');
  const flush = async () => {
    await act(async () => {});
  };

  beforeEach(() => {
    // A mockResolvedValueOnce queue survives clearAllMocks; reset it so no case inherits one.
    getUserGroups().mockReset();
    h.selfUuid = SELF_UUID;
  });

  it('R1. a refresh keeps the SAME card nodes, marks only their wrapper busy, and applies the result in place', async () => {
    getUserGroups().mockResolvedValueOnce([ALPHA, BETA]);
    const { rerender } = render(<GroupList {...listProps} refreshTrigger={0} />);
    await screen.findByRole('button', { name: 'Alpha Crew' });
    const alphaCard = cardOf('Alpha Crew');
    expect(alphaCard).not.toBeNull();

    const refresh = deferred<unknown[]>();
    getUserGroups().mockReturnValueOnce(refresh.promise);
    rerender(<GroupList {...listProps} refreshTrigger={1} />);
    // POSITIVE signal first: the refresh request really started.
    await waitFor(() => expect(getUserGroups()).toHaveBeenCalledTimes(2));

    expect(screen.queryByText('Loading groups...')).toBeNull();
    expect(alphaCard!.isConnected).toBe(true);
    expect(cardOf('Alpha Crew')).toBe(alphaCard);
    expect(alphaCard!.parentElement).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      refresh.resolve([ALPHA, GAMMA]);
    });
    await waitFor(() => expect(titleBlock('Gamma Crew')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Beta Crew' })).toBeNull();
    expect(cardOf('Alpha Crew')).toBe(alphaCard);
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('R2. a FAILED refresh keeps the loaded cards and never puts the full groups banner over them (D-51)', async () => {
    getUserGroups().mockResolvedValueOnce([ALPHA]);
    const { rerender } = render(<GroupList {...listProps} refreshTrigger={0} />);
    await screen.findByRole('button', { name: 'Alpha Crew' });
    const alphaCard = cardOf('Alpha Crew');

    getUserGroups().mockRejectedValueOnce(new Error('boom'));
    rerender(<GroupList {...listProps} refreshTrigger={1} />);
    await waitFor(() => expect(getUserGroups()).toHaveBeenCalledTimes(2));
    await flush();
    await flush();

    expect(alphaCard!.isConnected).toBe(true);
    expect(cardOf('Alpha Crew')).toBe(alphaCard);
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No groups yet' })).toBeNull();
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('R3. a list that loaded EMPTY is retained content: a failed refresh keeps "No groups yet" and shows no full banner (D-50)', async () => {
    getUserGroups().mockResolvedValueOnce([]);
    const { rerender } = render(<GroupList {...listProps} refreshTrigger={0} />);
    await screen.findByRole('heading', { name: 'No groups yet' });

    getUserGroups().mockRejectedValueOnce(new Error('boom'));
    rerender(<GroupList {...listProps} refreshTrigger={1} />);
    await waitFor(() => expect(getUserGroups()).toHaveBeenCalledTimes(2));
    await flush();
    await flush();

    // What loaded earlier stays; the failure is plan 88.6.1-77's RF1 notice above it (its RF-4).
    expect(screen.getByRole('heading', { name: 'No groups yet' })).toBeInTheDocument();
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('R4. the LATEST request wins: an older refresh that settles last never overwrites a newer one (edge R9 ordering)', async () => {
    getUserGroups().mockResolvedValueOnce([ALPHA]);
    const { rerender } = render(<GroupList {...listProps} refreshTrigger={0} />);
    await screen.findByRole('button', { name: 'Alpha Crew' });

    const older = deferred<unknown[]>();
    const newer = deferred<unknown[]>();
    getUserGroups().mockReturnValueOnce(older.promise);
    rerender(<GroupList {...listProps} refreshTrigger={1} />);
    getUserGroups().mockReturnValueOnce(newer.promise);
    rerender(<GroupList {...listProps} refreshTrigger={2} />);
    await waitFor(() => expect(getUserGroups()).toHaveBeenCalledTimes(3));

    await act(async () => {
      newer.resolve([BETA]);
    });
    await waitFor(() => expect(titleBlock('Beta Crew')).toBeInTheDocument());

    await act(async () => {
      older.resolve([GAMMA]);
    });
    await flush();

    expect(screen.queryByRole('button', { name: 'Gamma Crew' })).toBeNull();
    expect(titleBlock('Beta Crew')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('R5. while nothing is retained, the full banner stays up through its own in-flight retry (88.6.1-70 contract C2)', async () => {
    getUserGroups().mockRejectedValueOnce(new Error('boom'));
    const { rerender } = render(<GroupList {...listProps} refreshTrigger={0} />);
    await screen.findByText(BANNER_TEXT);

    const retry = deferred<unknown[]>();
    getUserGroups().mockReturnValueOnce(retry.promise);
    rerender(<GroupList {...listProps} refreshTrigger={1} />);
    await waitFor(() => expect(getUserGroups()).toHaveBeenCalledTimes(2));

    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('Loading groups...')).toBeNull();

    await act(async () => {
      retry.resolve([ALPHA]);
    });
    await waitFor(() => expect(titleBlock('Alpha Crew')).toBeInTheDocument());

    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
  });

  it('R6. AC-29: a failed self-identity refetch with a RETAINED id keeps the working list, and the compact notice carries the failure', async () => {
    h.selfUuid = SELF_UUID;
    h.isError = true;
    getUserGroups().mockResolvedValueOnce([ALPHA]);
    render(<GroupList {...listProps} refreshTrigger={0} />);

    expect(await screen.findByRole('button', { name: 'Alpha Crew' })).toBeInTheDocument();
    // The file's banner stub renders this test id for every mounted banner whose state shows an
    // error: exactly one here, the in-list compact identity notice (the groups request succeeded).
    expect(screen.getAllByTestId('identity-degrade-banner')).toHaveLength(1);
  });

  it('R7. a change of signed-in identity is a FIRST load again: the previous identity cards never paint (88.6.1-70 contract C3)', async () => {
    h.selfUuid = SELF_UUID;
    getUserGroups().mockResolvedValueOnce([ALPHA]);
    const { rerender } = render(<GroupList {...listProps} refreshTrigger={0} />);
    await screen.findByRole('button', { name: 'Alpha Crew' });

    h.selfUuid = OTHER_UUID;
    const firstForOther = deferred<unknown[]>();
    getUserGroups().mockReturnValueOnce(firstForOther.promise);
    rerender(<GroupList {...listProps} refreshTrigger={0} />);
    // POSITIVE signal: the request for the NEW identity really started.
    await waitFor(() => expect(getUserGroups()).toHaveBeenLastCalledWith(OTHER_UUID));

    expect(screen.getByText('Loading groups...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha Crew' })).toBeNull();
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();

    await act(async () => {
      firstForOther.resolve([ZETA]);
    });
    await waitFor(() => expect(titleBlock('Zeta Crew')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Alpha Crew' })).toBeNull();
  });
});
