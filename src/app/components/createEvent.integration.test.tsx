// Phase 88.1-07 (D-08 Layer 3) — parent-integration pins for the create-event scheduler.
//
// THIS FILE MOUNTS THE REAL `EventScheduler` ON PURPOSE. Every other create-event suite
// stubs it (`createEvent.participants.test.tsx:39` — "EventScheduler/heatmap pull in
// react-big-calendar"); this one exists precisely because a stub cannot prove the wiring.
//
// THE BUG THIS EXISTS TO CATCH: navigating the visual scheduler to another week left the
// heatmap FETCH on the old week. `currentWeekStart` is what the fetch effect
// (`createEvent.js:310-353`) reads, and it is only ever written from the `onWeekChange`
// prop body. If that write stops happening — a dropped prop during the WeekGrid rebuild, a
// `resolveWeekNav` result that is computed and discarded, a nav handler that updates the
// grid's own internal date and nothing else — the calendar moves, no fetch re-fires,
// `heatmapLookup` (keyed `${dateStr}_${hour}`) matches ZERO slots for the new week, and
// every cell renders untinted. That is SPEC Req 4's regression, and it is INVISIBLE to
// every other layer of the harness: `eventFormUtils.test.ts` proves `resolveWeekNav`
// computes the right Monday but never proves the Monday reaches the network, and
// `EventScheduler.test.tsx` proves the component calls `onWeekChange` but not what the
// parent does with it. This suite is the only construct that fails.
//
// THE LOAD-BEARING PROPERTY (same as Layer 2): role, label and visible-text locators only.
// Zero react-big-calendar class selectors, zero geometry (jsdom has no layout — P7). Assertions
// are on the API SPY, which is implementation-independent by construction. Plan 88.1-09
// swaps react-big-calendar for WeekGrid underneath this file; it must stay green unedited.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, addWeeks, format, parseISO, startOfWeek, subDays } from 'date-fns';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROMPT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// `vi.hoisted`: vi.mock factories are hoisted above module-level consts, so both the
// fixtures and the API spies have to be created here to be referenceable from a factory
// AND from the tests below. Holding the spies in this object (rather than reaching into
// the mocked module) keeps them untyped, so `mockResolvedValue` on a fixture shape does not
// have to satisfy the real `apiFetch<T>` return types.
const fixtures = vi.hoisted(() => ({
  // Synthetic identities only (threat T-88.1-15) — no real user data, no tokens.
  members: [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Alice', email: 'alice@example.com' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'Bob', email: 'bob@example.com' },
  ],
}));

// TZ-01. The profile timezone must be the one that reaches the fetch — `createEvent.js:335`
// resolves "today" through `effectiveTz` and passes it as the third argument. Picking a
// profile TZ that is deliberately NOT the runner's browser TZ is what makes the assertion
// bite: a regression to `Intl.resolvedOptions().timeZone` (or to `browserTimezone`) sends a
// different string and this suite goes red. The conditional keeps that true on a machine
// that happens to be set to the first choice.
const tz = vi.hoisted(() => {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const profileTz = browserTz === 'Australia/Sydney' ? 'America/New_York' : 'Australia/Sydney';
  return { browserTz, profileTz };
});

const api = vi.hoisted(() => ({
  getGroupMembers: vi.fn(),
  searchAll: vi.fn(),
  createEvent: vi.fn(),
  getBallot: vi.fn(),
  getGroupHeatmap: vi.fn(),
  getPromptHeatmap: vi.fn(),
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: tz.profileTz, browserTimezone: tz.browserTz }),
}));

// Heavy, unrelated surfaces stay stubbed so the mount is cheap — but NOT EventScheduler,
// and NOT EventHeatmapBackground's parent wiring. EventHeatmapBackground itself is manual
// mode's surface, not the scheduler's, so it stays mocked.
vi.mock('@/app/components/EventHeatmapBackground', () => ({ default: () => null }));
vi.mock('@/app/components/GameComboInput', () => ({ default: () => <div>game input</div> }));
vi.mock('@/app/components/QuickSuggestions', () => ({ default: () => null }));
vi.mock('@/app/components/BallotOptionsEditor', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/useSwipeNavigation', () => ({ default: () => ({}) }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { ...actual.groupsAPI, getGroupMembers: api.getGroupMembers },
    gamesAPI: { ...actual.gamesAPI, searchAll: api.searchAll },
    eventsAPI: { ...actual.eventsAPI, createEvent: api.createEvent },
    ballotAPI: { ...actual.ballotAPI, getBallot: api.getBallot },
    availabilityAPI: { ...actual.availabilityAPI, getGroupHeatmap: api.getGroupHeatmap },
    promptAPI: { ...actual.promptAPI, getPromptHeatmap: api.getPromptHeatmap },
  };
});

import CreateEvent from './createEvent';

const EMPTY_HEATMAP = { slots: [], totalMembers: 0, totalGroupMembers: 2, membersWithoutDataCount: 2 };

/** Visible day-column header labels, in DOM order (e.g. ['20 Mon', …]). */
const columnHeaders = () => screen.queryAllByRole('columnheader').map((el) => el.textContent);

const toolbarButton = (name: RegExp) => screen.getByRole('button', { name });

/** Every `getGroupHeatmap` call as `[groupId, weekStart, timezone]`. */
const heatmapCalls = () => api.getGroupHeatmap.mock.calls as Array<[string, string, string]>;

async function renderModal(props: Record<string, unknown> = {}) {
  const view = render(
    <CreateEvent
      group_id={GROUP_ID}
      modal
      modaltoggle={vi.fn()}
      onEventCreated={vi.fn()}
      user={{ sub: 'auth0|self' }}
      userRole="owner"
      {...props}
    />
  );
  // The member rows arrive with the group-members fetch; the scheduler renders with them.
  await screen.findByText('Alice');
  return view;
}

/** Render, then wait for the modal's first group-heatmap fetch to have landed. */
async function renderAndSettle(props: Record<string, unknown> = {}) {
  const view = await renderModal(props);
  await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(columnHeaders()).toHaveLength(7));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getGroupMembers.mockResolvedValue(fixtures.members);
  api.searchAll.mockResolvedValue([]);
  api.createEvent.mockResolvedValue({});
  api.getBallot.mockResolvedValue(null);
  api.getGroupHeatmap.mockResolvedValue(EMPTY_HEATMAP);
  api.getPromptHeatmap.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CreateEvent + real EventScheduler — week nav re-fires the heatmap fetch (Req 4)', () => {
  it('fetches the group heatmap for the profile-timezone week on open', async () => {
    await renderAndSettle();

    const [groupId, weekStart, timezone] = heatmapCalls()[0];
    expect(groupId).toBe(GROUP_ID);
    expect(weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The anchor is a Monday (HEAT-01), resolved in the PROFILE timezone.
    expect(format(startOfWeek(parseISO(weekStart), { weekStartsOn: 1 }), 'yyyy-MM-dd')).toBe(weekStart);
    // TZ-01: the profile TZ, never the browser's.
    expect(timezone).toBe(tz.profileTz);
    expect(timezone).not.toBe(tz.browserTz);
  });

  it('re-fetches for the week SEVEN DAYS LATER after next-week navigation', async () => {
    await renderAndSettle();
    const [, firstWeek] = heatmapCalls()[0];

    fireEvent.click(toolbarButton(/^next$/i));

    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(2));
    const [groupId, weekStart, timezone] = heatmapCalls()[1];
    expect(weekStart).toBe(format(addDays(parseISO(firstWeek), 7), 'yyyy-MM-dd'));
    // Same group, same timezone — only the week moved.
    expect(groupId).toBe(GROUP_ID);
    expect(timezone).toBe(tz.profileTz);
    // …and the grid itself moved with it, so the fetched week is the rendered week.
    expect(columnHeaders()[0]).toBe(format(addDays(parseISO(firstWeek), 7), 'dd EEE'));
  });

  it('re-fetches for the week SEVEN DAYS EARLIER after previous-week navigation', async () => {
    await renderAndSettle();
    const [, firstWeek] = heatmapCalls()[0];

    fireEvent.click(toolbarButton(/^(back|previous|prev)$/i));

    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(2));
    const [groupId, weekStart, timezone] = heatmapCalls()[1];
    expect(weekStart).toBe(format(subDays(parseISO(firstWeek), 7), 'yyyy-MM-dd'));
    expect(groupId).toBe(GROUP_ID);
    expect(timezone).toBe(tz.profileTz);
  });

  it('does NOT re-fetch for navigation that stays inside the same week', async () => {
    // The other half of what `resolveWeekNav` exists for: day-granularity navigation
    // within an already-fetched week is the SAME data, so it must not hit the network.
    // Driven through day view, which navigates a day at a time.
    await renderAndSettle();

    fireEvent.click(toolbarButton(/^day$/i));
    await waitFor(() => expect(columnHeaders()).toHaveLength(1));
    const startDay = columnHeaders()[0];

    fireEvent.click(toolbarButton(/^next$/i));

    // The navigation really happened — the visible day changed…
    await waitFor(() => expect(columnHeaders()[0]).not.toBe(startDay));
    // …and no second fetch was fired for it.
    expect(api.getGroupHeatmap).toHaveBeenCalledTimes(1);
  });
});

describe('CreateEvent + real EventScheduler — the poll-CTA week anchor (Phase 71.2)', () => {
  // The `promptId` journey: arriving from a closed-poll notification, the heatmap is the
  // POLL's responses and carries its own `weekStart`, which reaches the scheduler through
  // `calendarInitialDate` (createEvent.js:815-817) only AFTER the fetch resolves. So
  // `initialDate` is a HYBRID contract — mount seed AND post-mount re-sync. A rebuilt
  // scheduler that treats it as a mount-only seed opens on the CURRENT week, shows no poll
  // slots, and passes every other pin in this harness. The component-level half of the same
  // contract is plan 88.1-01's Layer-2 behavior 6.
  const pollMonday = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 2);
  const pollWeekStart = format(pollMonday, 'yyyy-MM-dd');

  it("opens on the poll's own week, not the current one", async () => {
    api.getPromptHeatmap.mockResolvedValue({ ...EMPTY_HEATMAP, weekStart: pollWeekStart });

    await renderModal({ promptId: PROMPT_ID });

    await waitFor(() => expect(api.getPromptHeatmap).toHaveBeenCalledWith(PROMPT_ID));
    await waitFor(() => expect(columnHeaders()[0]).toBe(format(pollMonday, 'dd EEE')));
    expect(columnHeaders()).toHaveLength(7);
    // Not still parked on this week.
    expect(columnHeaders()[0]).not.toBe(
      format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'dd EEE')
    );
  });

  it('never asks for the GROUP heatmap on the poll path', async () => {
    api.getPromptHeatmap.mockResolvedValue({ ...EMPTY_HEATMAP, weekStart: pollWeekStart });

    await renderModal({ promptId: PROMPT_ID });

    await waitFor(() => expect(api.getPromptHeatmap).toHaveBeenCalledTimes(1));
    expect(api.getGroupHeatmap).not.toHaveBeenCalled();
  });
});
