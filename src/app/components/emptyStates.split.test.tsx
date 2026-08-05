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
  };
});

import ScheduleList from './ScheduleList';
import UpcomingEventsCard from './UpcomingEventsCard';
import GroupLibrary from './GroupLibrary';
import OpenPollsList from './OpenPollsList';
import { groupsAPI, promptAPI } from '@/lib/api';

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
