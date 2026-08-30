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
import { addDays, addMinutes, addWeeks, format, parseISO, startOfWeek, subDays } from 'date-fns';

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
  // DECISION Phase 88.3.1 DEF-88.3.1-W-01: the clock is PINNED for this whole describe, and the
  // pin is load-bearing — not tidy-up. `resolveWeekNav`'s week convention is `weekStartsOn: 1`,
  // and the last case below navigates ONE DAY FORWARD in day view and asserts that no second
  // fetch fires. On a Sunday that step legitimately crosses into the next week and fires one, so
  // the case failed one day in seven against the ambient clock (measured on the same tree: 11/12
  // under an ambient Sunday, 12/12 under `TZ=Etc/GMT+12`). The remedy is the PIN and explicitly
  // NOT a widened assertion — a second fetch is CORRECT behaviour on a Sunday, so relaxing the
  // expectation would delete the property this case exists to prove.
  //
  // Wednesday 2026-09-16 at local noon: mid-week in both directions, so `next` and `back` both
  // stay inside the pinned week. Guarded the same way the CR-01 fixtures below are — an edit
  // that slid this onto a Sunday must fail LOUDLY rather than silently restoring the flake.
  const PINNED_WEDNESDAY = new Date(2026, 8, 16, 12, 0, 0);

  beforeEach(() => {
    expect(PINNED_WEDNESDAY.getDay()).toBe(3);
    // `shouldAdvanceTime` is REQUIRED — this harness leans on `waitFor`, which never resolves
    // under frozen timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(PINNED_WEDNESDAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

/* DECISION Phase 88.1-07 Task 2 (D-08 Layer 3): the round-trip below is driven from the
   MANUAL side — type the canonical fields, then read the visual panel — chosen OVER driving
   it from a slot gesture in the visual calendar, which is NOT DRIVABLE IN JSDOM AT ALL.
   Probed during execution against the shipped react-big-calendar 1.12.1: its `Selection`
   module calls `document.elementFromPoint` (Selection.js:27, via `isOverContainer`), which
   jsdom does not implement, so the pointer path throws before any date is ever computed.
   Stubbing `elementFromPoint` only moves the failure one step: `closestSlotFromPoint`
   divides by the height of a zero-height rect, which is RESEARCH P7's "silently passes on
   zeroes" trap — a green pin asserting a slot nobody could have clicked.

   So the GESTURE half (drag/tap -> `onTimeSelected`) belongs to the Playwright spec in plan
   88.1-14, and the STATE half is pinned here. What these tests actually exercise is the
   whole Phase 66-01 mechanism: the parent owns `start_date` + `duration_minutes`,
   `derivedSelectedSlot` (createEvent.js:64-74) is a pure projection of them, and the
   scheduler is CONTROLLED through the `selectedSlot` prop. Both modes read and write the
   same two fields, so entering from manual traverses exactly the same wire as entering from
   a drag would. Do not "complete" this by mocking geometry — that is a decision, not a
   cleanup. */
describe('CreateEvent + real EventScheduler — the Phase 66-01 controlled round-trip', () => {
  // A Thursday of next week at 19:00 — always in the future, so the modal stays on its
  // create-path branches, and stable to format.
  const slotStart = addMinutes(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 10), 19 * 60);
  const slotEnd = addMinutes(slotStart, 150);
  const START_VALUE = format(slotStart, "yyyy-MM-dd'T'HH:mm");

  const manualToggle = () => screen.getByRole('button', { name: 'Switch to Manual Entry' });
  const visualToggle = () => screen.getByRole('button', { name: 'Switch to Visual Calendar' });
  const startInput = () => screen.getByLabelText(/Start Date & Time/) as HTMLInputElement;
  const durationInput = () => screen.getByLabelText(/Duration \(minutes\)/) as HTMLInputElement;

  /** Type a slot into the manual fields (the shipped controls, by their real labels). */
  function enterSlotManually() {
    fireEvent.change(startInput(), { target: { value: START_VALUE } });
    fireEvent.change(durationInput(), { target: { value: '150' } });
  }

  it('projects the parent-owned slot into the scheduler summary panel', async () => {
    await renderAndSettle();
    expect(screen.queryByText('Selected Time:')).not.toBeInTheDocument();

    fireEvent.click(manualToggle());
    enterSlotManually();
    fireEvent.click(visualToggle());

    // Verbatim parity carry — the whole harness keys on this string. Do not reword it.
    const panel = (await screen.findByText('Selected Time:')).closest('div') as HTMLElement;
    expect(panel.textContent).toContain(format(slotStart, 'EEEE, MMMM d, h:mm a'));
    expect(panel.textContent).toContain(format(slotEnd, 'h:mm a'));
    expect(panel.textContent).toContain('(2h 30m)');
  });

  it('round-trips visual -> manual -> visual without losing the selection', async () => {
    await renderAndSettle();

    fireEvent.click(manualToggle());
    enterSlotManually();
    fireEvent.click(visualToggle());
    await screen.findByText('Selected Time:');

    // Back to manual: the SAME canonical values are still in the shipped inputs. This is
    // the leg that proves the parent owns the state — a scheduler holding its own copy
    // would leave these blank.
    fireEvent.click(manualToggle());
    expect(startInput().value).toBe(START_VALUE);
    expect(durationInput().value).toBe('150');

    // …and forward again: the highlight comes back from parent state, not from anything
    // the scheduler remembered across its own unmount.
    fireEvent.click(visualToggle());
    const panel = (await screen.findByText('Selected Time:')).closest('div') as HTMLElement;
    expect(panel.textContent).toContain(format(slotStart, 'EEEE, MMMM d, h:mm a'));
  });

  it('clears the highlight when the canonical field is cleared (no local slot state)', async () => {
    // Phase 66-01's actual contract: there is NO separate `selectedTimeSlot` local state.
    // Clearing the parent's field must empty the panel; a scheduler with its own copy of
    // the selection would keep showing the stale one.
    await renderAndSettle();

    fireEvent.click(manualToggle());
    enterSlotManually();
    fireEvent.click(visualToggle());
    await screen.findByText('Selected Time:');

    fireEvent.click(manualToggle());
    fireEvent.change(startInput(), { target: { value: '' } });
    fireEvent.click(visualToggle());

    await waitFor(() => expect(screen.queryByText('Selected Time:')).not.toBeInTheDocument());
    expect(screen.getByText(/select a time slot for your event/i)).toBeInTheDocument();
  });
});

describe('CreateEvent + real EventScheduler — the displayed day survives the heatmap fetch (CR-01)', () => {
  // CR-01 (88.1-REVIEW.md). `createEvent.js` re-emits the FETCHED WEEK'S MONDAY as a fresh `Date`
  // after every group-heatmap fetch (`:359` setHeatmapWeekStart(effectiveMonday) -> `:840`
  // calendarInitialDate's fallthrough), and the scheduler's `initialDate` re-sync effect used to
  // take it unconditionally. In the DAY arm — the only arm below `md` — that moved the displayed
  // day to Monday on every non-Monday. Only this harness can catch it: the churn originates in the
  // PARENT's memo, so a component-level rerender pin cannot reproduce the source.
  //
  // DELIBERATE COPY, not an accident: `stubMatchMedia` below duplicates the shape at
  // `EventScheduler.test.tsx:490-513`. That helper is file-local and NOT exported; exporting it
  // from a `.test.tsx` to import here would make one suite's harness load-bearing for another's.
  // If the media-query fork ever changes, both copies change.
  function stubMatchMedia() {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => {
      const widthMatch = /max-width:\s*(\d+)px/.exec(query);
      // Phone arm: 375px, coarse pointer.
      const matches = widthMatch
        ? 375 <= Number(widthMatch[1])
        : query.includes('hover: none');
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  }

  let restoreMatchMedia: (() => void) | null = null;

  afterEach(() => {
    restoreMatchMedia?.();
    restoreMatchMedia = null;
    vi.useRealTimers();
  });

  it('the phone arm opens on TODAY, not the week Monday, on a non-Monday', async () => {
    // Thursday 2026-09-17, local noon. Its Monday is 2026-09-14.
    const THURSDAY = new Date(2026, 8, 17, 12, 0, 0);
    // Guard the fixture itself: a future edit that slides this onto a Monday would make the whole
    // case vacuous, because Monday is exactly the value the defect produces.
    expect(THURSDAY.getDay()).toBe(4);

    // `shouldAdvanceTime` is REQUIRED — this harness leans on `waitFor`/`findByText`, which never
    // resolve under frozen timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(THURSDAY);
    restoreMatchMedia = stubMatchMedia();

    await renderModal();
    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(1));

    // The phone day arm rendered: one column, not seven.
    await waitFor(() => expect(columnHeaders()).toHaveLength(1));
    expect(columnHeaders()[0]).toBe(format(THURSDAY, 'dd EEE'));
    // THE FINDING, asserted as a negative on its own line: a positive-only assertion would pass
    // on a Monday-dated fixture and prove nothing.
    expect(columnHeaders()[0]).not.toBe(
      format(startOfWeek(THURSDAY, { weekStartsOn: 1 }), 'dd EEE')
    );

    // …and the strip agrees with the column: today's tab is selected, not index 0.
    const selectedTab = screen
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selectedTab).toBeDefined();
    expect(selectedTab?.getAttribute('aria-label')).toContain(format(THURSDAY, 'EEEE d'));
  });

  it('Back across the week boundary stays on the day the user navigated to', async () => {
    // Time-independent by construction: no fake timers, no hardcoded date — it walks forward to
    // whatever Monday it finds and steps back off it.
    await renderModal({ initialVisualView: 'day' });
    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(columnHeaders()).toHaveLength(1));

    // Walk forward to a Monday. The header format is 'dd EEE' (EventScheduler.tsx), so the
    // suffix test is exact. Bounded — a week of steps must reach one.
    let steps = 0;
    while (!/Mon$/.test(columnHeaders()[0] ?? '')) {
      if (steps >= 7) {
        throw new Error(
          `CR-01 pin: seven day-steps did not reach a Monday. Last header: ${columnHeaders()[0]}`
        );
      }
      fireEvent.click(toolbarButton(/^next$/i));
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(columnHeaders()).toHaveLength(1));
      steps += 1;
    }
    const mondayHeader = columnHeaders()[0];
    const callsAtMonday = heatmapCalls().length;

    fireEvent.click(toolbarButton(/^(back|previous|prev)$/i));

    // One day back off a Monday is the previous week's Sunday.
    await waitFor(() => expect(columnHeaders()[0]).not.toBe(mondayHeader));
    const sundayHeader = columnHeaders()[0];
    expect(sundayHeader).toMatch(/Sun$/);

    // The cross-week refetch really fired, so the parent really re-emitted a Monday and the
    // churn really had its chance to land.
    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(callsAtMonday + 1));

    // Pre-fix this is the six-day jump back to that week's Monday.
    await waitFor(() => expect(columnHeaders()[0]).toBe(sundayHeader));
    expect(columnHeaders()[0]).not.toMatch(/Mon$/);
  });

  it('H1: Next past Sunday then Back lands on Sunday, not on today', async () => {
    // H1 (88.1-CODE-REVIEW.md). The sibling pin above crosses OUT of today's week, so the
    // fetched week is never the week containing today and the seed-half substitution never
    // fires. This pin crosses BACK IN: forward into next week, then one step back onto THIS
    // week's Sunday. Pre-fix the parent re-emits today (a Wednesday) as the day anchor and the
    // scheduler's guard — which suppresses only the displayed week's MONDAY — lets it through.
    //
    // Wednesday 2026-09-16 at local noon. Its Monday is 2026-09-14, its Sunday 2026-09-20.
    // Guarded, exactly as the `:417` fixture is: slid onto a Monday or a Sunday this case
    // would go vacuous, so it must fail LOUDLY instead.
    const WEDNESDAY = new Date(2026, 8, 16, 12, 0, 0);
    expect(WEDNESDAY.getDay()).toBe(3);

    // `shouldAdvanceTime` is REQUIRED — `waitFor`/`findByText` never resolve under frozen timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(WEDNESDAY);
    restoreMatchMedia = stubMatchMedia();

    await renderModal({ initialVisualView: 'day' });
    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(columnHeaders()).toHaveLength(1));
    expect(columnHeaders()[0]).toBe(format(WEDNESDAY, 'dd EEE'));

    // Step Next until the header crosses into next week — i.e. until it reads a Monday.
    // Bounded at seven with an explicit throw naming the last header (the `:458` idiom).
    let steps = 0;
    while (!/Mon$/.test(columnHeaders()[0] ?? '')) {
      if (steps >= 7) {
        throw new Error(
          `H1 pin: seven day-steps did not reach a Monday. Last header: ${columnHeaders()[0]}`
        );
      }
      fireEvent.click(toolbarButton(/^next$/i));
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(columnHeaders()).toHaveLength(1));
      steps += 1;
    }
    const mondayHeader = columnHeaders()[0];
    const callsAtMonday = heatmapCalls().length;

    fireEvent.click(toolbarButton(/^(back|previous|prev)$/i));

    await waitFor(() => expect(columnHeaders()[0]).not.toBe(mondayHeader));

    // The cross-week refetch really fired, so the parent really re-emitted a week anchor for
    // the week CONTAINING TODAY and the churn really had its chance to land. Without this the
    // case can pass for the wrong reason.
    await waitFor(() => expect(api.getGroupHeatmap).toHaveBeenCalledTimes(callsAtMonday + 1));

    // The day the user navigated to.
    await waitFor(() => expect(columnHeaders()[0]).toMatch(/Sun$/));
    // THE FINDING, asserted as a negative on its own line: pre-fix the header reads the faked
    // Wednesday, because `isSameWeek(now, heatmapWeekStart)` substitutes today.
    expect(columnHeaders()[0]).not.toBe(format(WEDNESDAY, 'dd EEE'));
  });
});
