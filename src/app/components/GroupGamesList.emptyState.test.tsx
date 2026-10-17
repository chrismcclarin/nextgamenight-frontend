/**
 * Req 6 / UI-SPEC §9.2 — `GroupGamesList`'s empty state, the one row the owner
 * re-approved (E-25).
 *
 * This surface gets its own file rather than a block in `emptyStates.split.test.tsx`
 * because what needs pinning here is different: the other five surfaces are guarded
 * against a fetch failure being dressed up as "nothing here yet", whereas this one
 * takes its list as a PROP and has no fetch of its own. What it needs guarding
 * against is the COPY drifting back to the shelf wording that UI-SPEC §9.2 carried
 * before the owner's ruling — copy that described `GroupLibrary`'s feature, not this
 * one. So the negative assertions below are the load-bearing half: they fail if
 * either the pre-88-18 hand-rolled line OR the rejected shelf row is restored.
 *
 * The file also pins the retained-refresh behaviour (plan 88.6.1-56, AC-29): the failure
 * branch it already guards is where the retained case lives, so a failed refresh over games
 * that loaded for this group (or over a list that loaded empty) keeps them on screen under
 * plan 88.6.1-70's refresh notice, and the full banner shows only while nothing is retained.
 */
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));

import GroupGamesList from './GroupGamesList';
import { ApiError } from '@/lib/api';
import { getFetchErrorMessage, useFetchErrorState } from '@/components/ui/useFetchErrorState';
import { RetainedContentFocusGuard, useRetainedContent } from '@/components/ui/FetchErrorBanner';

// Untyped JS component: spread a typed-any bag so JSX does not demand the
// unrelated props it destructures.
const anyProps = (p: Record<string, unknown>): any => p;

afterEach(cleanup);

describe('GroupGamesList empty state (§9.2, owner-ruled E-25)', () => {
  it('renders the owner-approved history copy, not the rejected shelf copy', () => {
    render(<GroupGamesList {...anyProps({ games: [], groupId: 'g1' })} />);

    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Log a night you played and the group's history builds up here."
      )
    ).toBeInTheDocument();

    // The pre-88-18 hand-rolled lines are gone.
    expect(screen.queryByText('No games played yet')).toBeNull();
    expect(screen.queryByText('Start tracking your game sessions!')).toBeNull();

    // E-25: the contract row this surface was originally given belonged to
    // GroupLibrary. If it ever lands here, that is the regression.
    expect(screen.queryByText('No games on the shelf yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });

  it('shows the CTA for an active member and wires it to onAddEvent', () => {
    const onAddEvent = vi.fn();
    render(
      <GroupGamesList
        {...anyProps({ games: [], groupId: 'g1', userRole: 'member', onAddEvent })}
      />
    );

    screen.getByRole('button', { name: 'Log a game night' }).click();
    expect(onAddEvent).toHaveBeenCalledTimes(1);
  });

  it('hides the CTA for a pending member and for a role-less viewer, keeping the copy', () => {
    const { rerender } = render(
      <GroupGamesList
        {...anyProps({
          games: [],
          groupId: 'g1',
          userRole: 'pending',
          onAddEvent: vi.fn(),
        })}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();

    // No role resolved yet — same gate, same outcome.
    rerender(
      <GroupGamesList
        {...anyProps({ games: [], groupId: 'g1', onAddEvent: vi.fn() })}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();
  });

  it('renders the error treatment and NOT the empty heading when the fetch failed', () => {
    // Phase 88-25 (DEF-88-18-01 / T-88-18-01). Before this, the parent's catch
    // did `setGamesList([])`, so a network/5xx failure arrived here as a
    // legitimately-empty list and a group with years of history was told it had
    // logged nothing. An errored fetch ALSO has zero games, so the branch order
    // is the entire fix — this test is what stops it being flipped back.
    render(
      <GroupGamesList
        {...anyProps({
          games: [],
          groupId: 'g1',
          userRole: 'member',
          onAddEvent: vi.fn(),
          errorState: {
            showError: true,
            message: 'Something went wrong. Refresh the page to try again.',
            code: 'unknown',
            retry: vi.fn(),
          },
        })}
      />
    );

    expect(
      screen.getByText("We couldn't load this group's games")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'No game nights logged yet' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log a game night' })).toBeNull();
  });

  it('a failed fetch wins over a NON-empty stale list too (the error is not hidden by data)', () => {
    // The parent deliberately leaves the previous list in place on a refetch
    // failure rather than blanking it, so this ordering has to hold with data
    // present as well — otherwise a failed refresh would look like a success.
    // AMENDED 88.6.1-56 (AC-29): this render passes no `retained`, which now means
    // nothing is retained for this group (a first load, a group switch, or an access
    // answer — plan 88.6.1-70's contract C10), so the banner still replaces the list.
    // The retained case (games that loaded for this group stay under the refresh
    // notice) is GG-1 below.
    render(
      <GroupGamesList
        {...anyProps({
          games: [{ id: 'game-1', name: 'Wingspan', play_count: 2 }],
          groupId: 'g1',
          userRole: 'member',
          onAddEvent: vi.fn(),
          errorState: {
            showError: true,
            message: 'Something went wrong. Refresh the page to try again.',
            code: 'unknown',
            retry: vi.fn(),
          },
        })}
      />
    );

    expect(
      screen.getByText("We couldn't load this group's games")
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
  });

  it('errorState with showError:false is inert — the normal branches still decide', () => {
    // Anti-vacuity: the two assertions above would also pass for a component
    // that rendered the banner unconditionally.
    render(
      <GroupGamesList
        {...anyProps({
          games: [],
          groupId: 'g1',
          userRole: 'member',
          onAddEvent: vi.fn(),
          errorState: { showError: false, message: '', code: 'unknown', retry: vi.fn() },
        })}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'No game nights logged yet' })
    ).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load this group's games")).toBeNull();
  });

  it('does not render the empty state when the group has played games', () => {
    render(
      <GroupGamesList
        {...anyProps({
          games: [{ id: 'game-1', name: 'Wingspan', play_count: 2 }],
          groupId: 'g1',
          userRole: 'member',
          onAddEvent: vi.fn(),
        })}
      />
    );

    expect(
      screen.queryByRole('heading', { name: 'No game nights logged yet' })
    ).toBeNull();
    expect(screen.getByRole('heading', { name: 'Group Games' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });
});

// Copy row RF1 (D-47), plan 88.6.1-70's one constant, read here as text (contract C7): declared
// ONCE in this describe's scope. While the notice shows, the sentence is in the DOM twice (the
// visible line and the notice's status region), so RF1 queries count both or scope to one.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
const BANNER_TITLE = "We couldn't load this group's games";
const WINGSPAN = { id: 'game-1', name: 'Wingspan', play_count: 2 };

const rf1Region = () =>
  Array.from(document.querySelectorAll('[role="status"]')).find((n) => n.textContent === RF1);
// The visible RF1 line: the RF1 text node that sits in no status region.
const rf1Line = () => screen.getAllByText(RF1).find((n) => !n.closest('[role="status"]'));
const waitForRf1 = () => waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
const follows = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const groupGamesHeading = () => screen.getByRole('heading', { name: 'Group Games' });

// The hook's tab-return re-attempt, the refresh nobody pressed (the house idiom,
// useFetchErrorState.test.tsx, function fireVisibility). It listens only while the error shows.
function fireVisibility() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

type Game = Record<string, unknown>;
interface Outcome {
  games: Game[] | undefined;
  loaded: boolean;
  error: unknown;
}
// The next refetch's outcome, set per test before a press or a re-attempt.
let nextOutcome: Outcome | null = null;

interface HarnessProps {
  games: Game[] | undefined;
  loaded: boolean;
  error: unknown;
  userRole?: string;
  guard?: boolean;
}

// The page's shape: the floor (`main` + `h1`), the list, then the C12 guard as the list's NEXT
// sibling with ONE page-owned ref. The refetch is STABLE and ref-free of render state (the C5
// shape of DECISION Phase 88-14): it applies the next outcome, then resolves `{ isError }` (C4).
function Harness({ games: g0, loaded: l0, error: e0, userRole = 'member', guard = true }: HarnessProps) {
  const [games, setGames] = React.useState<Game[] | undefined>(g0);
  const [loaded, setLoaded] = React.useState(l0);
  const [error, setError] = React.useState<unknown>(e0);
  const gamesFocusRef = React.useRef<HTMLElement | null>(null);
  const refetch = React.useCallback(async () => {
    const o = nextOutcome;
    if (!o) return { isError: true };
    setGames(o.games);
    setLoaded(o.loaded);
    setError(o.error);
    return { isError: Boolean(o.error) };
  }, []);
  const errorState = useFetchErrorState({
    isError: Boolean(error),
    error,
    refetch,
  } as unknown as Parameters<typeof useFetchErrorState>[0]);
  const retained = useRetainedContent(loaded, errorState);
  return (
    <main>
      <h1>Group</h1>
      <GroupGamesList
        {...anyProps({
          games,
          groupId: 'g1',
          userRole,
          onAddEvent: vi.fn(),
          errorState,
          retained,
          focusRef: gamesFocusRef,
        })}
      />
      {guard ? <RetainedContentFocusGuard retained={retained} focusTarget={gamesFocusRef} /> : null}
    </main>
  );
}

const err500 = () => new ApiError('Request failed', 'internal', 500);
const errNetwork = () => new ApiError('Request failed', 'network', 0);
const err401 = () => new ApiError('Request failed', 'unauthorized', 401);
const err403 = () => new ApiError('Request failed', 'forbidden', 403);

describe('GroupGamesList — a failed refresh keeps the games (88.6.1-56: AC-29, RF1 / D-47, D-50, D-51)', () => {
  afterEach(() => {
    nextOutcome = null;
  });

  const failing = (code = 'internal') => ({
    showError: true,
    code,
    message: 'Something went wrong. Refresh the page to try again.',
    retry: vi.fn(),
    retryFailed: false,
  });
  const healthy = () => ({ showError: false, code: 'unknown', message: '', retry: vi.fn(), retryFailed: false });

  it('GG-1. a failed refresh over retained cards keeps them under the RF1 notice, not the banner', async () => {
    render(
      <GroupGamesList
        {...anyProps({ games: [WINGSPAN], groupId: 'g1', userRole: 'member', onAddEvent: vi.fn(), errorState: failing(), retained: true })}
      />
    );
    await waitForRf1();
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Group Games' })).toHaveLength(1);
    const line = rf1Line()!;
    expect(follows(line, screen.getByText('Sort by:'))).toBe(true);
    expect(follows(line, screen.getByRole('heading', { name: 'Wingspan' }))).toBe(true);
  });

  it('GG-2. a failed FIRST load (games undefined, nothing retained) shows the banner, never the empty state or RF1', () => {
    render(
      <GroupGamesList
        {...anyProps({ games: undefined, groupId: 'g1', userRole: 'member', onAddEvent: vi.fn(), errorState: failing() })}
      />
    );
    expect(screen.getByText(BANNER_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No game nights logged yet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log a game night' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GG-3. the cards are the same nodes through a failed refresh, and the RF1 region pre-exists it', async () => {
    const props = { games: [WINGSPAN], groupId: 'g1', userRole: 'member', onAddEvent: vi.fn(), retained: true };
    const { rerender } = render(<GroupGamesList {...anyProps({ ...props, errorState: healthy() })} />);
    const card = screen.getByRole('heading', { name: 'Wingspan' });
    const before = screen.getAllByRole('status');

    rerender(<GroupGamesList {...anyProps({ ...props, errorState: failing() })} />);
    expect(await screen.findAllByText(RF1)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBe(card);
    const region = rf1Region();
    expect(region).toBeDefined();
    expect(before).toContain(region);

    rerender(<GroupGamesList {...anyProps({ ...props, errorState: healthy() })} />);
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBe(card);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GG-4. a list that LOADED EMPTY keeps its empty state under the RF1 notice (D-50)', async () => {
    render(
      <GroupGamesList
        {...anyProps({ games: [], groupId: 'g1', userRole: 'member', onAddEvent: vi.fn(), errorState: failing(), retained: true })}
      />
    );
    await waitForRf1();
    const empty = screen.getByRole('heading', { name: 'No game nights logged yet' });
    expect(follows(rf1Line()!, empty)).toBe(true);
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });

  it('GG-5. through the real hooks: 401 / 403 withdraw the cards to the banner; 500 / network keep them under RF1', async () => {
    for (const error of [err401(), err403()]) {
      render(<Harness games={[WINGSPAN]} loaded error={error} />);
      expect(screen.getByText(BANNER_TITLE)).toBeInTheDocument();
      expect(screen.getByText(getFetchErrorMessage(error))).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      cleanup();
    }
    for (const error of [err500(), errNetwork()]) {
      render(<Harness games={[WINGSPAN]} loaded error={error} />);
      await waitForRf1();
      expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
      expect(screen.queryByText(BANNER_TITLE)).toBeNull();
      cleanup();
    }
  });

  it('GG-6. a successful Retry clears the notice and lands focus on the Group Games heading', async () => {
    const user = userEvent.setup();
    render(<Harness games={[WINGSPAN]} loaded error={err500()} />);
    await waitForRf1();
    nextOutcome = { games: [WINGSPAN], loaded: true, error: null };
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(document.activeElement).toBe(groupGamesHeading()));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('GG-7. a successful Try again on the first-load banner lands focus on the Group Games heading', async () => {
    const user = userEvent.setup();
    render(<Harness games={undefined} loaded={false} error={err500()} />);
    expect(screen.getByText(BANNER_TITLE)).toBeInTheDocument();
    nextOutcome = { games: [WINGSPAN], loaded: true, error: null };
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(document.activeElement).toBe(groupGamesHeading()));
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('GG-8. a successful Retry over a loaded-empty list lands focus on the empty state', async () => {
    const user = userEvent.setup();
    render(<Harness games={[]} loaded error={err500()} />);
    await waitForRf1();
    nextOutcome = { games: [], loaded: true, error: null };
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        document.activeElement?.contains(screen.getByRole('heading', { name: 'No game nights logged yet' }))
      ).toBe(true)
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('GG-9. an unpressed re-attempt answered 403 / 401 withdraws the cards and focus lands on Group Games, never body', async () => {
    for (const error of [err403(), err401()]) {
      render(<Harness games={[WINGSPAN]} loaded error={err500()} />);
      await waitForRf1();
      act(() => screen.getByRole('link', { name: /Wingspan/ }).focus());
      nextOutcome = { games: [WINGSPAN], loaded: true, error };
      fireVisibility();
      expect(await screen.findByText(BANNER_TITLE)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(groupGamesHeading()));
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
      cleanup();
    }
  });

  it('GG-10. an unpressed success while Retry holds focus lands focus on Group Games', async () => {
    render(<Harness games={[WINGSPAN]} loaded error={err500()} />);
    await waitForRf1();
    act(() => screen.getByRole('button', { name: 'Retry' }).focus());
    nextOutcome = { games: [WINGSPAN], loaded: true, error: null };
    fireVisibility();
    await waitFor(() => expect(document.activeElement).toBe(groupGamesHeading()));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('GG-11. withdrawing a loaded-empty list (401, unpressed) while its Retry or CTA holds focus lands on Group Games', async () => {
    for (const focusName of ['Retry', 'Log a game night']) {
      render(<Harness games={[]} loaded error={err500()} userRole="member" />);
      await waitForRf1();
      act(() => screen.getByRole('button', { name: focusName }).focus());
      nextOutcome = { games: [], loaded: true, error: err401() };
      fireVisibility();
      expect(await screen.findByText(BANNER_TITLE)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'No game nights logged yet' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(groupGamesHeading()));
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
      cleanup();
    }
  });
});
