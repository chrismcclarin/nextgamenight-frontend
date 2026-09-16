/**
 * Req 6 / UI-SPEC §9.2 — the four list surfaces plan 88-18 adopted `EmptyState` on
 * that can be mounted without an Auth0 session. (`grouplist`'s pair lives in
 * `grouplist.identity.test.tsx`, which already owns that surface's mock harness;
 * `GroupGamesList`'s lives in `GroupGamesList.emptyState.test.tsx`.)
 *
 * Two things are pinned per surface, and the SECOND is the one that matters:
 *
 *   1. the empty branch renders the contract heading (so the copy cannot silently
 *      drift back to the hand-rolled line), and
 *   2. a FAILED load renders the shared error treatment and NOT the empty heading.
 *
 * (2) exists because every one of these surfaces used to conflate them: the fetch
 * failure was swallowed in a `console.error`/soft-fail and the list fell through to
 * "nothing here yet", telling someone their data did not exist when the request had
 * merely failed (threat T-88-18-01). An errored fetch ALSO has zero items, so the
 * two branches are one refactor apart forever — these tests are the guard.
 */
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// Children irrelevant to the empty/error split.
vi.mock('@/app/components/StartPollModal', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { ...actual.groupsAPI, getGroupLibrary: vi.fn() },
    promptAPI: { ...actual.promptAPI, getOpenPrompts: vi.fn() },
    // 88.6-15: the admin-role Section arms drive the SETTINGS query too, and the shipped
    // mock covered only `getOpenPrompts` / `getGroupLibrary`. EXTENDED rather than reached
    // around — a second `vi.mock('@/lib/api')` in one file silently replaces the first.
    promptSettingsAPI: {
      ...actual.promptSettingsAPI,
      getGroupPromptSettings: vi.fn(),
    },
  };
});

import ScheduleList from './ScheduleList';
import UpcomingEventsCard from './UpcomingEventsCard';
import GroupLibrary from './GroupLibrary';
import OpenPollsList from './OpenPollsList';
import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import PromptScheduleSection from './PromptScheduleSection';
import { groupsAPI, promptAPI, promptSettingsAPI } from '@/lib/api';
import { promptKeys } from '@/lib/queryKeys/promptKeys';

type Mock = ReturnType<typeof vi.fn>;

// Untyped JS components: spread a typed-any bag so JSX does not demand the
// unrelated props each one destructures.
const anyProps = (p: Record<string, unknown>): any => p;

function withQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('ScheduleList empty state (§9.2)', () => {
  it('renders the contract heading and body when there are no schedules', () => {
    render(<ScheduleList {...anyProps({ schedules: [] })} />);
    expect(
      screen.getByRole('heading', { name: 'No schedules yet' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set one up and we'll ask the group when they're free, so you don't have to."
      )
    ).toBeInTheDocument();
    // the hand-rolled line is gone
    expect(
      screen.queryByText(
        'No schedules yet. Create one to start sending automated prompts.'
      )
    ).toBeNull();
  });

  it('shows the CTA only when the caller passes onCreate (gating stays at the call site)', () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <ScheduleList {...anyProps({ schedules: [], onCreate })} />
    );
    screen.getByRole('button', { name: 'Create a schedule' }).click();
    expect(onCreate).toHaveBeenCalledTimes(1);

    // A member (no manage permission) gets onCreate={null} from the parent.
    rerender(<ScheduleList {...anyProps({ schedules: [], onCreate: null })} />);
    expect(screen.queryByRole('button', { name: 'Create a schedule' })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'No schedules yet' })
    ).toBeInTheDocument();
  });
});

describe('UpcomingEventsCard empty vs failed (§9.2 / T-88-18-01)', () => {
  it('renders the contract heading when there is nothing scheduled', () => {
    render(<UpcomingEventsCard {...anyProps({ events: [] })} />);
    expect(
      screen.getByRole('heading', { name: 'Nothing on the calendar' })
    ).toBeInTheDocument();
    expect(screen.queryByText('No upcoming events')).toBeNull();
  });

  // 88-33 Task 7 step 3 (M4 rider): the empty body DISCLOSES the 7-day window
  // the card silently filters to. Pinned exactly — recorded for §6.2.1
  // ratification at phase close.
  it('disclosed the 7-day window in the empty body copy', () => {
    render(<UpcomingEventsCard {...anyProps({ events: [] })} />);
    expect(
      screen.getByText(
        "Nothing scheduled in the next 7 days — plan a game night and it'll show up here."
      )
    ).toBeInTheDocument();
  });

  it('renders the error treatment and NOT the empty heading when the fetch failed', () => {
    render(
      <UpcomingEventsCard
        {...anyProps({
          events: [],
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
      screen.getByText("We couldn't load your upcoming events")
    ).toBeInTheDocument();
    // the whole point: a failure is never dressed up as "you have nothing planned"
    expect(
      screen.queryByRole('heading', { name: 'Nothing on the calendar' })
    ).toBeNull();
  });

  it('renders no CTA when the call site passes no action', () => {
    render(<UpcomingEventsCard {...anyProps({ events: [] })} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('GroupLibrary empty vs failed (§9.2 / T-88-18-01)', () => {
  it('renders the contract heading and the "Add games" CTA on an empty library', async () => {
    (groupsAPI.getGroupLibrary as unknown as Mock).mockResolvedValue({
      games: [],
      members: [],
    });
    render(<GroupLibrary {...anyProps({ groupId: 'g1' })} />);

    expect(
      await screen.findByRole('heading', { name: 'This library is empty' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add games' })).toHaveAttribute(
      'href',
      '/userProfile'
    );
    expect(
      screen.queryByText("No games in this group's library yet.")
    ).toBeNull();
  });

  it('renders the error treatment and NOT the empty heading when the fetch rejects', async () => {
    (groupsAPI.getGroupLibrary as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    render(<GroupLibrary {...anyProps({ groupId: 'g1' })} />);

    expect(
      await screen.findByText("We couldn't load this library")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'This library is empty' })
    ).toBeNull();
  });
});

describe('OpenPollsList empty vs failed (§9.2 / T-88-18-01)', () => {
  const props = { groupId: 'g1', group: { id: 'g1' }, userRole: 'admin' };

  it('renders the contract heading and the role-gated CTA when no check-in is running', async () => {
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValue({ prompts: [] });
    render(withQueryClient(<OpenPollsList {...anyProps(props)} />));

    expect(
      await screen.findByRole('heading', { name: 'No check-ins running' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'No active check-ins. Start one to find a time that works for everyone.'
      )
    ).toBeNull();
    // The header CTA is suppressed while the empty state shows its own, so the
    // action resolves to exactly one button — not two identical primaries.
    expect(
      screen.getAllByRole('button', { name: '+ Start a check-in' })
    ).toHaveLength(1);
  });

  // D-UI-03: the empty COPY is identical for every role, and this surface's CTA
  // gate is `userRole && userRole !== 'pending'` — which a plain 'member'
  // satisfies. There is deliberately no "member sees no CTA" case here: the only
  // role that fails the gate is 'pending', and a pending member never reaches
  // this branch at all (the query is `enabled: false` for them, and the parent
  // PromptScheduleSection returns null before mounting this component).
  it('keeps the same copy for a plain member, who CAN start a check-in', async () => {
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValue({ prompts: [] });
    render(
      withQueryClient(
        <OpenPollsList {...anyProps({ ...props, userRole: 'member' })} />
      )
    );
    expect(
      await screen.findByRole('heading', { name: 'No check-ins running' })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: '+ Start a check-in' })
    ).toHaveLength(1);
  });

  it('renders the error treatment and NOT the empty heading when the fetch rejects', async () => {
    (promptAPI.getOpenPrompts as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    render(withQueryClient(<OpenPollsList {...anyProps(props)} />));

    expect(
      await screen.findByText("We couldn't load the check-ins")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'No check-ins running' })
      ).toBeNull()
    );
    // The header CTA survives a failure — the action must not vanish just
    // because the list could not load.
    expect(
      screen.getByRole('button', { name: '+ Start a check-in' })
    ).toBeInTheDocument();
  });
});

// =====================================================================================
// 88.6-15 (D-31 / T-88.6-36) — the prompt trio's [M] false-empty defect, PER COMPONENT.
//
// The two components share the defect's NAME and not its SHAPE, so they get two different
// fixes and two different sets of arms. The earlier premise that both paint "No schedules
// configured." on a fetch failure is FALSE for Section: that string has exactly ONE
// occurrence in src/, at PromptScheduleReadOnly.js. Section renders no schedules empty copy
// at all; its false-empty is the "No open polls" HEADER BADGE on the open-polls key.
//
// WHAT THE SECTION ARMS PROVE AND WHAT THEY DO NOT. They prove EXACTLY ONE live region per
// failure. They do NOT prove ANNOUNCEMENT — StatusRegion is empty-first by contract while
// FetchErrorBanner returns null until it errors, so the region and its text enter the DOM
// together. That gap is plan 13's to route (88.6-13-PLAN.md:518-520); it is not re-opened
// here, and no assertion below may be read as covering it.
// =====================================================================================

function neverResolves() {
  return new Promise(() => {});
}

describe('PromptScheduleReadOnly error vs empty vs soft-failed drift (88.6-15 / D-31)', () => {
  const props = { groupId: 'g1', groupPageUrl: '/groupHomePage?id=g1' };

  it('renders the error surface and NOT the empty copy when the settings fetch rejects', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    render(withQueryClient(<PromptScheduleReadOnly {...anyProps(props)} />));

    expect(
      await screen.findByText("We couldn't load your schedules")
    ).toBeInTheDocument();
    expect(screen.queryByText('No schedules configured.')).toBeNull();
  });

  it('OMITS the parenthesised count from the heading in the error branch', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    render(withQueryClient(<PromptScheduleReadOnly {...anyProps(props)} />));

    // r3 #11: activeCount derives from `data?.schedules || []`, so reordering the BRANCHES
    // alone still paints "Recurring Check-ins (0)" beside the failure banner — the same false
    // claim about server state, one element higher.
    expect(
      await screen.findByRole('heading', { name: 'Recurring Check-ins' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Recurring Check-ins (0)' })
    ).toBeNull();
  });

  it('renders the empty copy — and the TRUE zero count — when the fetch succeeds with none', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue({
      id: null,
      schedules: [],
      games: [],
      members: [],
    });
    render(withQueryClient(<PromptScheduleReadOnly {...anyProps(props)} />));

    expect(
      await screen.findByText('No schedules configured.')
    ).toBeInTheDocument();
    // The count comes BACK for every data branch, a true zero included.
    expect(
      screen.getByRole('heading', { name: 'Recurring Check-ins (0)' })
    ).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your schedules")).toBeNull();
  });

  it('SOFT-FAILS a schema drift to the empty shape, not to the error surface', async () => {
    // The negative control. D-31 keeps softFailPromptQueryFn's ZodError behaviour: a benign
    // backend drift must still DEGRADE to the empty shape rather than showing a person an
    // error. A top-level-invalid body is the only thing safeParse rejects.
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(null);
    render(withQueryClient(<PromptScheduleReadOnly {...anyProps(props)} />));

    expect(
      await screen.findByText('No schedules configured.')
    ).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your schedules")).toBeNull();
  });

  it('shows NO empty copy while the initial fetch is pending (UI-SPEC 9.3 E4 backstop)', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockImplementation(
      neverResolves
    );
    render(withQueryClient(<PromptScheduleReadOnly {...anyProps(props)} />));

    expect(await screen.findByText('Loading schedules...')).toBeInTheDocument();
    // The empty copy must not FLASH before the first response lands.
    expect(screen.queryByText('No schedules configured.')).toBeNull();
    expect(screen.queryByText("We couldn't load your schedules")).toBeNull();
  });
});

describe('PromptScheduleSection badge omits on error and mints no second region (88.6-15 / D-31)', () => {
  function makeClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  }

  function renderSection(extra: Record<string, unknown>, client: QueryClient) {
    return render(
      <QueryClientProvider client={client}>
        <PromptScheduleSection
          {...anyProps({ groupId: 'g1', group: { id: 'g1', games: [] }, ...extra })}
        />
      </QueryClientProvider>
    );
  }

  it('(a) renders NO badge — and no region of its own — when the open-polls query rejects', async () => {
    // A non-admin role suffices: the settings query is admin-gated, so this arm isolates the
    // open-polls key, which is what feeds the badge.
    (promptAPI.getOpenPrompts as unknown as Mock).mockRejectedValue(new Error('boom'));
    renderSection({ userRole: 'member', defaultExpanded: true }, makeClient());

    // SETTLE ON A POSITIVE SIGNAL FIRST. This line is what makes the two ABSENCE assertions
    // below non-vacuous, and it is here because the obvious form was measured going green
    // against the UNFIXED component: `await waitFor(() => expect(queryByText('No open
    // polls')).toBeNull())` satisfies itself on the very first tick, while the badge still
    // reads "Loading...", and never observes the settled error state at all. OpenPollsList's
    // banner is the failure's one real surface, so waiting on it proves the query has landed.
    expect(
      await screen.findByText("We couldn't load the check-ins")
    ).toBeInTheDocument();

    expect(screen.queryByText('No open polls')).toBeNull();
    // Not new copy either — the badge renders NOTHING, it does not reword.
    expect(screen.queryByText(/open polls?$/)).toBeNull();
    // OpenPollsList owns the ONE region for this key. Section adds none, so the count is 1.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  // BOTH (b) LEGS SETTLE ON A POSITIVE SIGNAL BEFORE ASSERTING PERSISTENCE, and that is the
  // load-bearing part of their shape rather than a style choice. These are "assert something
  // STAYS" tests, so the naive form — refetch, then `waitFor(() => expect(getByText(…))
  // .toBeInTheDocument())` — is satisfied by the very first tick, BEFORE the failed refetch has
  // re-rendered anything, and goes green against a wrong fix. Measured: with the retention
  // branch keyed on `openPollCount === 0` (r3 #14's wrong fix, planted deliberately) the naive
  // (b2) PASSED. Expanding the panel gives the failure a positive surface — OpenPollsList's
  // banner on the SAME open-polls key — so awaiting it proves the error state has landed, and
  // only then is the badge's survival a real claim.
  it('(b1) keeps a POPULATED cache count across a failed refetch', async () => {
    const client = makeClient();
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValueOnce({
      prompts: [{ id: 'p1' }, { id: 'p2' }],
    });
    renderSection({ userRole: 'member', defaultExpanded: true }, client);

    expect(await screen.findByText('2 open polls')).toBeInTheDocument();

    (promptAPI.getOpenPrompts as unknown as Mock).mockRejectedValue(new Error('boom'));
    await client.refetchQueries({ queryKey: promptKeys.openPolls('g1') });

    expect(
      await screen.findByText("We couldn't load the check-ins")
    ).toBeInTheDocument();
    // TanStack retains `data` across a refetch error, so a number the user can still trust
    // must not be replaced with nothing.
    expect(screen.getByText('2 open polls')).toBeInTheDocument();
  });

  it('(b2) keeps a SUCCESSFUL-EMPTY cache badge across a failed refetch — the count-keyed leg', async () => {
    // r3 #14. `openPollCount` is 0 for a TRUE zero AND for no data at all, so a retention
    // branch keyed on "the count is non-zero" silently blanks a legitimate "No open polls"
    // here — and (b1) alone would never catch it, because it only exercises the populated
    // case. The discriminator is DATA PRESENCE.
    const client = makeClient();
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValueOnce({ prompts: [] });
    renderSection({ userRole: 'member', defaultExpanded: true }, client);

    expect(await screen.findByText('No open polls')).toBeInTheDocument();

    (promptAPI.getOpenPrompts as unknown as Mock).mockRejectedValue(new Error('boom'));
    await client.refetchQueries({ queryKey: promptKeys.openPolls('g1') });

    expect(
      await screen.findByText("We couldn't load the check-ins")
    ).toBeInTheDocument();
    expect(screen.getByText('No open polls')).toBeInTheDocument();
  });

  it('(c1) COLLAPSED with a failed settings query: zero regions and zero Try again are reachable', async () => {
    // Arm C removes the collapsed panel from the a11y tree and the tab order, so the banner
    // the nested Manager renders for this failure is not reachable while collapsed. This leg
    // proves AC-7 landed; (c2) proves the single-live-region rule still holds when it is open.
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValue({ prompts: [] });
    renderSection({ userRole: 'admin', defaultExpanded: false }, makeClient());

    await screen.findByRole('button', { name: /check-ins/i });
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('(c2) EXPANDED with a failed settings query: exactly ONE region and ONE Try again', async () => {
    // The open-polls query must RESOLVE here, or this arm stops measuring the property it
    // exists to measure.
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValue({ prompts: [] });
    renderSection({ userRole: 'admin', defaultExpanded: true }, makeClient());

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: /try again/i })).toHaveLength(1);
    // Section itself contributes nothing: the one region is the nested Manager's, on the SAME
    // promptKeys.settings key under the SAME admin gate.
    expect(screen.getByText("We couldn't load your schedules")).toBeInTheDocument();
  });

  it('(d) a schema drift on open-polls soft-fails to the empty shape, so the zero badge is legitimate', async () => {
    (promptAPI.getOpenPrompts as unknown as Mock).mockResolvedValue(null);
    renderSection({ userRole: 'member', defaultExpanded: true }, makeClient());

    expect(await screen.findByText('No open polls')).toBeInTheDocument();
  });
});
