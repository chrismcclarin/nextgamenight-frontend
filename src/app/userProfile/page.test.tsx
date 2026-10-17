// Phase 88 plan 06 Task 1 — RENDER HARNESS for the userProfile surface.
//
// WHY THIS FILE EXISTS (read before extending):
// userProfile is the phase's ARIA-cluster surface, but until now it had no
// general render harness — only the two narrow `userProfile.identity*.test.tsx`
// sender nets. That made SPEC Req 5's acceptance unassertable BY CONSTRUCTION:
// there was no file in which to make the assertion. This harness supplies the
// mock stack + render helper so later plans add ASSERTIONS, not infrastructure,
// under time pressure.
//
// WHAT IS ASSERTED HERE: only what is true on THIS branch. A harness that
// asserts tomorrow's behaviour is red for every plan between now and then, so
// the not-yet-true pins live in the EXTENSION POINTS block below instead.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`
// (`include: ['src/**/*.{test,spec}.{ts,tsx}']`), and the config's `jsx-in-js`
// pre-transform handles the `.js` page under test.
//
// ---------------------------------------------------------------------------
// EXTENSION POINTS — who adds what, and where
// ---------------------------------------------------------------------------
// * plan 88-10 (SPEC Req 5, ARIA cluster) — LANDED. Its pins live below: the
//   switch semantics on every notification toggle, the tab-strip roles +
//   keyboard, the composed axe audit, the Req 11 gate pins and the Req 12 /
//   OI-5 toast pins. The a11y matcher is registered globally in
//   `vitest.setup.ts` — do NOT add a per-file `expect.extend`.
// * plan 88-19 (SPEC Reqs 1/2/7) — LANDED. Its pins live at the bottom of this
//   file: the 16px control sweep over every control-bearing surface, the type
//   scale on the page's headings, the warm loading copy, and the keyed
//   per-row save status (DEF-88-10-02).
//
// DECISION Phase 88 plan 06 (now historical — kept as the record): the extension
// points above were originally written as PROSE, not as the literal
// attribute/matcher tokens they describe, because 88-06's acceptance gate
// grepped this file to prove those assertions were absent at the time (the same
// false-positive failure mode hit plans 88-01..05). That gate has run; 88-10
// then wrote the real assertions, which is why the literals now appear in the
// test bodies below. Do not "restore" the prose form over a live assertion.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const DEFAULT_PREFS = {
  event_created: { email: true, sms: false },
  reminder: { email: true, sms: false, window_hours: 1 },
  event_updated: { email: true, sms: false },
  event_cancelled: { email: true, sms: false },
};

/**
 * Mutable self row the mocked identity hook returns. Held in `vi.hoisted` so a
 * test can vary it (e.g. flip `sms_enabled`) BEFORE render without re-mocking.
 * The Notification Preferences card is gated on `preferences`, which the page's
 * init sets from the row (`notification_preferences`, or the app's defaults when
 * the row carries none) and, since 88.6.1-61, never sets when there is no row —
 * so with no row the card is absent.
 */
const h = vi.hoisted(() => ({
  self: undefined as undefined | Record<string, unknown>,
  // Plan 88.6.1-61: the identity query's error, read by the mocked `useSelfIdentity` (isError / error).
  selfError: null as null | Error,
  // Plan 88.6.1-61: ONE stable refetch for the identity query, so a case can supply the row on Retry.
  refetchSelf: vi.fn(),
  /**
   * Availability rows the mocked `useQuery` returns. Held here (not baked into
   * the mock) so the two-tap delete pins can render real rows without a
   * QueryClientProvider. Plan 88-10 added this; the default stays `[]` so every
   * pre-existing test sees exactly what it saw before.
   */
  patterns: [] as undefined | Record<string, unknown>[],
  // Plan 88.6.1-59: the patterns query's error, read by the mocked `useQuery` (isError / error).
  patternsError: null as null | Error,
  // Wave 7 CI gate (88.6.1-21 / 59): the query's `isPending`, so a case can hold a never-loaded
  // query in flight the way TanStack reports it (pending, no error) and the page shows its loading line.
  patternsPending: false,
  // Plan 88.6.1-59: ONE stable refetch for the patterns query, so a case can assert on it.
  refetchPatterns: vi.fn(),
  // Plan 88.6.1-59 (P11): the one cache entry the fake QueryClientContext hands back for the
  // patterns key, standing in for a real cache's entry that outlives an unmount.
  patternsEntry: {} as object,
  /**
   * The Auth0 row, held as ONE object rather than rebuilt inside the mock factory.
   * Identity matters: the page's owned-games / calendar-status effect depends on
   * `user`, so a mock that returns a fresh object literal per render re-runs that
   * effect on EVERY render and refetches the collection each time (before plan
   * 88.6.1-67 each of those refetches also blanked the grid mid-interaction; it now
   * keeps the cards, but a refetch per render is still not what the page does in
   * a browser). The real `useUser` returns a stable
   * context value, so the loop is a mock artefact, not page behaviour. Making this
   * stable is a decision, not a tidy-up: reverting it makes any test that clicks a
   * row in the collection non-deterministic.
   */
  authUser: {
    sub: 'auth0|self',
    name: 'Self',
    email: 'self@example.com',
    picture: null,
  } as Record<string, unknown>,
  /**
   * Auth0 session error. Plan 88-19 needs a NON-null value to reach the page's
   * error branch, which no earlier suite exercised — that branch used to render
   * the raw upstream message and nothing else.
   */
  authError: null as null | Error,
  setTimezone: vi.fn(),
  // Plan 88.6.1-18: the useTutorial mock used to build a fresh vi.fn() per call, so nothing
  // could assert on it. Hoisted so the Replay pins can.
  replayTutorial: vi.fn(),
  // Whether the tour is showing, read by the useTutorial mock at CALL time so a rerender sees a
  // changed value. Reset to false in the root beforeEach (clearAllMocks clears no plain values).
  showTutorial: false,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: h.self,
    selfUuid: h.self?.id as string | undefined,
    query: { isError: Boolean(h.selfError), error: h.selfError, isPending: !h.self && !h.selfError, refetch: h.refetchSelf },
    isPending: !h.self && !h.selfError,
    // Plan 88.6.1-79 (D-r3-10): the identity query's cache key, the same shape the real hook builds.
    queryKey: ['users', 'self', h.authUser.sub],
  }),
}));

vi.mock('@/lib/hooks/selfIdentityCache', () => ({ patchSelfCache: vi.fn() }));

// AC-2 (plan 88.6-17): the page's 20 raw console calls became `logger.info` breadcrumbs.
// `errCtx` is kept REAL — it is a pure name+message reducer and mocking it would make the
// PII half of T-84-01 unassertable, which is the only half a test can actually see.
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({
    user: h.authUser,
    error: h.authError,
    isLoading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

// The page reads only `useQueryClient` + `useQuery`. Spread the real module so a
// REMOVED export still fails loudly (T-88-06-01) and only the two hooks that
// would otherwise need a QueryClientProvider are replaced. `useQuery` backs the
// availability-patterns fetch; an empty list keeps it off the network.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
    useQuery: () => ({
      data: h.patterns,
      isPending: h.patternsPending,
      isError: Boolean(h.patternsError),
      error: h.patternsError,
      refetch: h.refetchPatterns,
    }),
  };
});

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

// `toast` is callable AND carries .success/.error — the page uses both shapes.
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast };
});

// Provider hooks the page consumes; each has its own dedicated identity suite.
vi.mock('@/app/components/tutorial/TutorialProvider', () => ({
  useTutorial: () => ({ replayTutorial: h.replayTutorial, showTutorial: h.showTutorial }),
}));
// `setTimezone` is hoisted (not built per call) so the timezone-picker pins can
// assert what the Combobox committed.
vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: h.setTimezone }),
}));

// Heavy / self-fetching children stubbed. NOTE the deliberate omissions:
// `useFetchErrorState` and `FetchErrorBanner` are kept REAL — the hook is a pure
// derivation over the query object supplied above and the banner renders null
// while `showError` is false, so stubbing them would only hide regressions.
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/DangerZoneDeleteAccount', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// Only the network-call surfaces are replaced; `importOriginal` spread keeps
// ApiError/ApiErrorCode (which the real useFetchErrorState reads) intact, and
// makes a removed export fail rather than silently resolve to a mock.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    userGamesAPI: {
      ...actual.userGamesAPI,
      getOwnedGames: vi.fn().mockResolvedValue([]),
      addOwnedGame: vi.fn().mockResolvedValue({}),
      removeOwnedGame: vi.fn().mockResolvedValue({}),
      importBGGCollection: vi.fn().mockResolvedValue({ imported: 0 }),
    },
    gamesAPI: {
      ...actual.gamesAPI,
      searchBGG: vi.fn().mockResolvedValue([]),
      importFromBGG: vi.fn().mockResolvedValue({ id: 'game-imported' }),
    },
    googleCalendarAPI: {
      ...actual.googleCalendarAPI,
      getStatus: vi.fn().mockResolvedValue({ connected: false }),
      getAuthUrl: vi.fn().mockResolvedValue({ url: 'https://example.test/oauth' }),
      disconnect: vi.fn().mockResolvedValue({}),
    },
    usersAPI: {
      ...actual.usersAPI,
      updateNotificationPreferences: vi.fn().mockResolvedValue({}),
      updateUsername: vi.fn().mockResolvedValue({ username: 'Self' }),
      savePhone: vi.fn().mockResolvedValue({}),
      verifyPhone: vi.fn().mockResolvedValue({}),
      removePhone: vi.fn().mockResolvedValue({}),
      resetTutorial: vi.fn().mockResolvedValue({}),
    },
    availabilityAPI: {
      ...actual.availabilityAPI,
      createRecurringPattern: vi.fn().mockResolvedValue({}),
      createOverride: vi.fn().mockResolvedValue({}),
      deleteAvailability: vi.fn().mockResolvedValue({}),
    },
  };
});

import Profile from './page';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { auditFormControls } from '../../test-utils/formControlAudit';
import { ApiError } from '@/lib/api';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
import { availabilityKeys } from '@/lib/queryKeys/availabilityKeys';
import { QueryClientContext } from '@tanstack/react-query';
import { UNAVAILABLE_COPY } from '@/app/components/EmailAddressSection';

/** Accessor for the mocked house logger — AC-2's channel on this surface. */
export function loggerMock() {
  return logger as unknown as {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
}

/** The four notification rows the page renders, in source order. */
export const NOTIFICATION_LABELS = [
  'New Event',
  'Event Reminders',
  'Event Updates',
  'Event Cancelled',
] as const;

/**
 * Accessor for the mocked sonner toast. Plan 88-10's Req 12 / OI-5 pins assert
 * on `toastMock().success` / `.error` rather than re-mocking the module.
 */
export function toastMock() {
  return toast as unknown as {
    (msg: string): void;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

/**
 * Render the profile with a resolved identity.
 *
 * @param selfOverrides merged into the self row — `sms_enabled` and
 *   `phone_verified` drive the entitlement-gated SMS column, and
 *   `notification_preferences` gates the whole Notification Preferences card.
 */
export function renderProfile(
  selfOverrides: Record<string, unknown> = {},
  // Plan 88.6.1-79: `container` too, so a case can render inside a `main` (focus-floor cases).
  options: { wrapper?: React.ComponentType<{ children: React.ReactNode }>; container?: HTMLElement } = {}
) {
  h.self = harnessSelfRow(selfOverrides);
  return render(<Profile />, options);
}

/**
 * The harness identity row with `overrides` merged over it — ONE builder, shared by
 * `renderProfile` and the 88.6.1-61 cases that hand the page a row only after it rendered
 * without one.
 */
function harnessSelfRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SELF_UUID,
    user_id: 'auth0|self',
    username: 'Self',
    sms_enabled: false,
    phone_verified: false,
    notification_preferences: DEFAULT_PREFS,
    ...overrides,
  };
}

/** Plan 88.6.1-79: the profile header card (the calendar zone lives in it in every state). */
function headerCard(): HTMLElement {
  const card = screen.getByRole('heading', { name: 'Google Calendar Integration' }).closest('.card');
  if (!(card instanceof HTMLElement)) throw new Error('no header card around Google Calendar Integration');
  return card;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.self = undefined;
  h.selfError = null;
  h.refetchSelf.mockReset();
  h.patterns = [];
  h.patternsError = null;
  h.patternsPending = false;
  h.patternsEntry = {};
  h.authError = null;
  h.showTutorial = false;
});

afterEach(cleanup);

describe('userProfile render harness', () => {
  it('renders the profile settings surface once identity resolves', async () => {
    renderProfile();
    expect(
      await screen.findByRole('heading', { name: 'Notification Preferences' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Availability Settings' })).toBeInTheDocument();
  });
});

describe('userProfile notification preferences', () => {
  it('renders an email toggle control for every notification type', async () => {
    renderProfile();
    for (const label of NOTIFICATION_LABELS) {
      expect(
        await screen.findByRole('switch', { name: `${label} email notifications` })
      ).toBeInTheDocument();
    }
  });

  // Req 5 / F-353/357/362: the toggles announce as switches with an on/off state.
  // Queried BY ROLE, never by class — a regression to a styled <button> fails here
  // even if it renders pixel-identically.
  it('announces every notification toggle as a switch carrying its on/off state', async () => {
    renderProfile();
    await screen.findByRole('switch', { name: 'New Event email notifications' });

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(NOTIFICATION_LABELS.length);
    for (const control of switches) {
      expect(control).toHaveAttribute('aria-checked', 'true');
    }
  });

  it('flips the checked state on the toggled switch and leaves its siblings alone', async () => {
    renderProfile();
    const target = await screen.findByRole('switch', {
      name: 'New Event email notifications',
    });
    expect(target).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(target);

    await waitFor(() => expect(target).toHaveAttribute('aria-checked', 'false'));
    expect(
      screen.getByRole('switch', { name: 'Event Updates email notifications' })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('renders the reminder-window select and the reset affordance', async () => {
    renderProfile();
    await screen.findByRole('switch', { name: 'New Event email notifications' });
    expect(screen.getByRole('option', { name: '1 hour before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
  });

  // The select shipped with no accessible name at all (axe select-name). Pinned by
  // role+name so the fix cannot be dropped silently.
  it('names the reminder-window select', async () => {
    renderProfile();
    expect(
      await screen.findByRole('combobox', { name: 'Remind me' })
    ).toBeInTheDocument();
  });

  // Folded todo 2026-05-09 / UI-SPEC §6.3: the helper text must name WHO is
  // reminded and WHEN, in one sentence.
  it('states who is reminded and when, under the reminder toggle', async () => {
    renderProfile();
    await screen.findByRole('switch', { name: 'Event Reminders email notifications' });

    const helper = screen.getByText(/You'll get a reminder before events/);
    expect(helper).toHaveTextContent(/still waiting on your availability/);
    // The jargon the todo was raised against is gone.
    expect(screen.queryByText(/poll deadline/i)).not.toBeInTheDocument();
  });

  it('hides the SMS column entirely for a non-entitled user', async () => {
    renderProfile({ sms_enabled: false });
    await screen.findByRole('switch', { name: 'New Event email notifications' });
    expect(
      screen.queryByRole('switch', { name: 'New Event SMS notifications' })
    ).not.toBeInTheDocument();
  });

  it('renders the SMS toggles for an entitled user', async () => {
    renderProfile({ sms_enabled: true, phone_verified: true });
    expect(
      await screen.findByRole('switch', { name: 'New Event SMS notifications' })
    ).toBeInTheDocument();
  });

  it('keeps the SMS switches disabled until the phone is verified', async () => {
    renderProfile({ sms_enabled: true, phone_verified: false });
    expect(
      await screen.findByRole('switch', { name: 'New Event SMS notifications' })
    ).toBeDisabled();
  });

  it('persists an email-toggle flip through the notification-preferences sender', async () => {
    const { usersAPI } = await import('@/lib/api');
    renderProfile();
    fireEvent.click(await screen.findByRole('switch', { name: 'New Event email notifications' }));
    await waitFor(() =>
      expect(usersAPI.updateNotificationPreferences).toHaveBeenCalledWith(
        SELF_UUID,
        expect.any(Object)
      )
    );
  });

  // D-14, asserted rather than merely written down: a switch that visibly flips is
  // its own receipt and deliberately fires NO toast. Without this pin, a later
  // "every mutation gets a receipt" sweep re-adds one and nothing objects.
  it('fires no toast when a self-stating toggle flips (D-14)', async () => {
    const { usersAPI } = await import('@/lib/api');
    renderProfile();
    fireEvent.click(await screen.findByRole('switch', { name: 'New Event email notifications' }));
    await waitFor(() => expect(usersAPI.updateNotificationPreferences).toHaveBeenCalled());
    expect(toastMock().success).not.toHaveBeenCalled();
  });
});

describe('userProfile availability settings', () => {
  it('renders both tabs of the availability tab strip', async () => {
    renderProfile();
    expect(await screen.findByRole('tab', { name: 'Schedules' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Specific Dates' })).toBeInTheDocument();
  });

  // Req 5: the strip announces as a tab strip with a named owner and a selected tab.
  it('exposes the strip as a named tab set with one selected tab and a panel', async () => {
    renderProfile();
    const strip = await screen.findByRole('tablist', { name: 'Availability settings' });
    const tabs = within(strip).getAllByRole('tab');

    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Availability Schedules');
  });

  // The hand-rolled strip had no roving tabindex at all: arrow keys did nothing.
  it('moves the selection with arrow keys', async () => {
    const user = userEvent.setup();
    renderProfile();
    const first = await screen.findByRole('tab', { name: 'Schedules' });
    const second = screen.getByRole('tab', { name: 'Specific Dates' });

    first.focus();
    await user.keyboard('{ArrowRight}');

    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Specific Date Overrides');

    await user.keyboard('{ArrowLeft}');
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  // Driven with userEvent, NOT fireEvent.click: Radix selects a tab on pointer-down
  // and on focus, so a synthetic click alone never reaches it. That is a property of
  // the primitive, not of this page — see the same shape in `Tabs.test.tsx`.
  it('swaps the visible panel when the Specific Dates tab is activated', async () => {
    const user = userEvent.setup();
    renderProfile();
    // Recurring is the default tab.
    expect(
      await screen.findByRole('heading', { name: 'Availability Schedules' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Specific Date Overrides' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Specific Dates' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Specific Date Overrides' })).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('heading', { name: 'Availability Schedules' })
    ).not.toBeInTheDocument();
  });

  // ── Phase 88.6-30 (W53 reopen, row alignment) ────────────────────────────
  //
  // THE DEFECT (owner's iPhone screenshot, 2026-09-21): "Available From (Start
  // Time)" wraps to two lines at phone width while "Available Until (End Time)"
  // does not, so the right-hand control starts a line higher than the left and
  // the left hint text collides with the right column. The fix is a subgrid:
  // the container declares three row tracks and each cell adopts them, so
  // label / control / hint line up across both columns whatever the labels do.
  //
  // WHAT THIS CAN AND CANNOT ASSERT. jsdom performs NO LAYOUT, so the alignment
  // itself is unobservable here — this pins the STRUCTURE that produces it and
  // nothing more. Two specific things it is written to catch: the row-span
  // silently reverting to 2 (measured: at span 2 the hint falls outside the
  // shared tracks and overlaps the control), and the container losing its
  // explicit row tracks, which makes `subgrid` on the cells inert.
  //
  // The three utilities are written as LITERALS, which is the whole difference
  // from the W53 class failure this plan reopened for — an interpolated class
  // is invisible to Tailwind's scanner. Emission verified by command at this
  // commit: compiling globals.css emits `.grid-rows-subgrid`,
  // `.grid-rows-[auto_auto_auto]` and `.row-span-3`.
  it('aligns the two-column availability rows as a subgrid, spanning all three tracks', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(await screen.findByRole('button', { name: '+ Add Schedule' }));

    const startTime = await screen.findByLabelText('Available From (Start Time)');
    const startDate = screen.getByLabelText('Start Date');

    for (const control of [startTime, startDate]) {
      const cell = control.parentElement as HTMLElement;
      const row = cell.parentElement as HTMLElement;

      // The container supplies the tracks the cells adopt. Without these,
      // `grid-rows-subgrid` below has nothing to inherit and does nothing.
      expect(row.className).toContain('grid-cols-2');
      expect(
        row.className,
        'the row lost its explicit track list — subgrid on the cells is inert without it'
      ).toContain('grid-rows-[auto_auto_auto]');

      expect(cell.className).toContain('grid-rows-subgrid');
      expect(
        cell.className,
        'row-span must be 3: at 2 the hint paragraph falls outside the shared tracks and overlaps the control'
      ).toContain('row-span-3');
    }
  });

  // ── Phase 88.6-47 (todo 2026-09-21, "date range inputs allow end before start") ──
  //
  // The recurring DATE pair had NO client guard of any kind: the server rejects an
  // inverted range with a code-less 400 that renders the generic register copy and
  // discards the form (`routes/availability.js:137`). The TIME pair on the same form
  // already refuses it with a ratified toast (`userProfile/page.js:1760`,
  // 88-CODE-REVIEW MED#7) and is deliberately untouched.
  //
  // THIS ASSERTS THE DERIVATION, NOT A DATE. A test that pinned a literal would pass
  // just as happily on a hard-coded bound, which is the wrong fix wearing the right
  // assertion — so each bound is set from a variable and then CHANGED, and the sibling's
  // attribute has to follow. It also pins the empty case: an unset sibling must place
  // NO bound (attribute absent), never an empty string, because the End Date is optional
  // and `min=""` is a real bound of nothing.
  it('bounds each recurring date control by its sibling, and places no bound while the sibling is empty', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(await screen.findByRole('button', { name: '+ Add Schedule' }));

    const startDate = screen.getByLabelText('Start Date') as HTMLInputElement;
    const endDate = screen.getByLabelText('End Date (Optional)') as HTMLInputElement;

    // THE EMPTY-SIBLING CASE, on the control that actually has one. `start_date` seeds to
    // today (userProfile/page.js:222, HEAT-02 expansion 4) while `end_date` seeds to '', so
    // it is the START control whose bound must be ABSENT here — not an empty string, which
    // would be a real bound of nothing on a field the user is entitled to leave blank.
    expect(
      startDate.getAttribute('max'),
      'Start Date carries an upper bound while End Date is empty — an empty-string bound is a real bound of nothing, and the End Date is OPTIONAL'
    ).toBeNull();

    // And the seeded start already bounds the END control, derived from the rendered value
    // rather than from any date this test knows.
    expect(
      endDate.getAttribute('min'),
      'End Date lower bound does not track the seeded Start Date value'
    ).toBe(startDate.value);

    // A start value bounds the END control from below, and the value is the one set.
    const firstStart = '2026-03-10';
    fireEvent.change(startDate, { target: { value: firstStart } });
    expect(
      endDate.getAttribute('min'),
      'End Date lower bound does not track the Start Date value — the bound must be DERIVED from the sibling, never hard-coded'
    ).toBe(firstStart);

    // CHANGE it: a hard-coded bound would still read the first date here.
    const secondStart = '2026-07-04';
    fireEvent.change(startDate, { target: { value: secondStart } });
    expect(
      endDate.getAttribute('min'),
      'End Date lower bound did not follow a CHANGED Start Date — this is the assertion that separates a derived bound from a constant'
    ).toBe(secondStart);

    // And the reverse direction, so neither edit order can dead-end the user.
    const end = '2026-09-01';
    fireEvent.change(endDate, { target: { value: end } });
    expect(
      startDate.getAttribute('max'),
      'Start Date upper bound does not track the End Date value — the bounds are two-sided on purpose: a user who sets the end first must still be able to reach a valid start'
    ).toBe(end);
  });
});

// ---------------------------------------------------------------------------
// Req 11 — the four native prompts, retiered (plan 88-10 Task 2)
// ---------------------------------------------------------------------------
// Blocking semantics are the thing under test in every tier: the API is not
// reached until an explicit second act, and cancel aborts. These pins are what
// make a silent regression to a toast-and-proceed gate fail.

const OWNED_GAMES = [
  { id: 'game-catan', name: 'Catan', year_published: 1995, image_url: null },
  { id: 'game-brass', name: 'Brass', year_published: 2007, image_url: null },
];

const PATTERNS = [
  {
    id: 'pattern-mon',
    type: 'recurring_pattern',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    pattern_data: { dayOfWeek: 1, startTime: '18:00', endTime: '22:00' },
  },
  {
    id: 'pattern-tue',
    type: 'recurring_pattern',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    pattern_data: { dayOfWeek: 2, startTime: '18:00', endTime: '22:00' },
  },
];

/** The armed live-region text, as composed by the hook's default announcement. */
function armedAnnouncement() {
  return screen
    .getAllByRole('status')
    .map((node) => node.textContent ?? '')
    .join(' | ');
}

describe('userProfile destructive gates (Req 11)', () => {
  it('disconnect Google Calendar blocks in a dialog and does not call the API until confirmed', async () => {
    const { googleCalendarAPI } = await import('@/lib/api');
    (googleCalendarAPI.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      connected: true,
    });

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Calendar' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Disconnect Google Calendar?')).toBeInTheDocument();
    expect(googleCalendarAPI.disconnect).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(googleCalendarAPI.disconnect).toHaveBeenCalledWith(SELF_UUID)
    );
  });

  it('cancel on the disconnect dialog aborts — the API is never reached', async () => {
    const { googleCalendarAPI } = await import('@/lib/api');
    (googleCalendarAPI.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      connected: true,
    });

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Calendar' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(googleCalendarAPI.disconnect).not.toHaveBeenCalled();
  });

  // UI-SPEC §11.2 copy, verbatim — and the banned generic permanence claim.
  it('ships the ratified disconnect body and no "cannot be undone"', async () => {
    const { googleCalendarAPI } = await import('@/lib/api');
    (googleCalendarAPI.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      connected: true,
    });

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Calendar' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Future events stop syncing. Events already on your calendar stay.'
      )
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });

  it('remove-game needs two taps and names the action AND the game (F-369)', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockResolvedValue(OWNED_GAMES);

    renderProfile();
    const trigger = await screen.findByRole('button', { name: 'Remove Catan' });

    fireEvent.click(trigger);
    expect(userGamesAPI.removeOwnedGame).not.toHaveBeenCalled();
    // Armed: aria-pressed appears (F-357) and the live region names the target.
        expect(armedAnnouncement()).toContain('Catan');

    // 88-33 Task 5 (fork 7, walk row 381): the GLYPH control arms into the
    // labeled verb 'Remove' — not the default instruction copy.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(userGamesAPI.removeOwnedGame).toHaveBeenCalledWith(SELF_UUID, 'game-catan')
    );
  });

  // 88-33 Task 5 (fork 7): resting prominence + no-reflow reservation on the
  // collection glyph control — a real affordance box at the 44px floor, with the
  // armed label's width reserved at rest so arming cannot squeeze the title.
  it('collection remove is a 44px affordance box whose armed width is pre-reserved', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockResolvedValue(OWNED_GAMES);

    renderProfile();
    const trigger = await screen.findByRole('button', { name: 'Remove Catan' });
    expect(trigger.className).toContain('min-h-11');
    expect(trigger.className).toContain('min-w-11');
    expect(trigger.className).toContain('border');
    // The invisible sizer carries the armed label so the box is armed-width at rest.
    const sizer = trigger.querySelector('[aria-hidden="true"]');
    expect(sizer?.textContent).toBe('Remove');
    expect(sizer?.className).toContain('invisible');

    // Armed: visible label swaps to 'Remove' on the error-subtle treatment.
    fireEvent.click(trigger);
    const armed = screen.getByRole('button', { name: 'Remove' });
    expect(armed.className).toContain('bg-status-error-subtle');
  });

  // AR DEC-2: the armed state is keyed by TARGET, not a boolean. Without that,
  // arming one row and single-tapping another destroys the second one.
  it('arming one game then tapping another re-arms instead of removing', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockResolvedValue(OWNED_GAMES);

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Catan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Brass' }));

    expect(userGamesAPI.removeOwnedGame).not.toHaveBeenCalled();
    // The new target is armed (labeled 'Remove' — fork 7), the old one is back at rest.
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Catan' })).toBeInTheDocument();
    expect(armedAnnouncement()).toContain('Brass');
  });

  it('delete-pattern needs two taps, keyed per pattern', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    h.patterns = PATTERNS;

    renderProfile();
    const trigger = await screen.findByRole('button', { name: 'Delete Monday schedule' });

    fireEvent.click(trigger);
    expect(availabilityAPI.deleteAvailability).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-pressed', 'true');

    // A different row must not commit the armed one.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tuesday schedule' }));
    expect(availabilityAPI.deleteAvailability).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() =>
      expect(availabilityAPI.deleteAvailability).toHaveBeenCalledWith('pattern-tue')
    );
  });

  // D-10: this one is a SLOW-OPERATION warning, so it is an ordinary informational
  // Modal and deliberately NOT on the destructive ladder. It still has to block, and
  // it still must not be a native browser prompt (88-29's census arms at zero).
  it('BGG import warns in an ordinary modal and imports only on Continue', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import Collection' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/may take a few minutes/)).toBeInTheDocument();
    expect(userGamesAPI.importBGGCollection).not.toHaveBeenCalled();

    // Neutral verb, not a destructive one — this is not a consequence gate.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(userGamesAPI.importBGGCollection).toHaveBeenCalledWith(SELF_UUID, 'someone')
    );
  });

  it('cancelling the BGG warning imports nothing', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import Collection' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(userGamesAPI.importBGGCollection).not.toHaveBeenCalled();
  });

  // The D-10 exclusion is only durable if the reason survives at the SITE. This pins
  // the marker itself, so a later "finish the migration" sweep cannot absorb the BGG
  // gate onto the ladder without first deleting an assertion.
  it('records the D-10 exclusion with a marker at the BGG site', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/userProfile/page.js', 'utf8')
    );
    expect(source).toContain('DECISION Phase 88-10 (D-10)');
  });

  // Req 11's real acceptance: ZERO native prompts survive in this file. The upstream
  // census gate grepped for the `window.`-qualified form and would have passed with
  // all four of these live (§11.1 / OI-8).
  it('leaves no native browser prompt in the file', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/userProfile/page.js', 'utf8')
    );
    // Built from fragments so this assertion cannot trip the phase's own grep gate.
    const bare = new RegExp(`(^|[^.a-zA-Z_$])${['con', 'firm'].join('')}\\(`, 'm');
    expect(source).not.toMatch(bare);
  });
});

// ---------------------------------------------------------------------------
// The G6 residue — F-359 / F-357 (plan 88-10 Task 4)
// ---------------------------------------------------------------------------
// The picker this replaces opened on click, closed only on a second click, and
// its options were plain <button>s unreachable by keyboard from the field. Every
// pin below is on behaviour the PRIMITIVE owns, so a regression to a hand-rolled
// panel fails here even if it looks identical.

describe('userProfile timezone picker (F-359)', () => {
  it('shows the current selection in the field and opens on focus', async () => {
    renderProfile();
    const field = await screen.findByRole('combobox', { name: 'Timezone' });

    expect(field).toHaveValue('America/New York (EDT)');
    expect(field).toHaveAttribute('aria-expanded', 'false');

    fireEvent.focus(field);
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes on Escape and leaves focus on the field', async () => {
    const user = userEvent.setup();
    renderProfile();
    const field = await screen.findByRole('combobox', { name: 'Timezone' });

    // The query is set in ONE change event rather than typed character by
    // character: every keystroke re-filters the full IANA set and re-renders the
    // listbox, which is real work the assertion below does not care about.
    await user.click(field);
    fireEvent.change(field, { target: { value: 'Chicago' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('aria-expanded', 'false');
    // The field falls back to the selection, not the abandoned query.
    expect(field).toHaveValue('America/New York (EDT)');
    expect(h.setTimezone).not.toHaveBeenCalled();
  });

  it('selects with arrow keys and Enter', async () => {
    const user = userEvent.setup();
    renderProfile();
    const field = await screen.findByRole('combobox', { name: 'Timezone' });

    await user.click(field);
    fireEvent.change(field, { target: { value: 'America/Chicago' } });

    await user.keyboard('{ArrowDown}');
    expect(field).toHaveAttribute('aria-activedescendant');

    await user.keyboard('{Enter}');
    expect(h.setTimezone).toHaveBeenCalledWith('America/Chicago');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('groups the options by region', async () => {
    const user = userEvent.setup();
    renderProfile();

    const field = await screen.findByRole('combobox', { name: 'Timezone' });
    await user.click(field);
    fireEvent.change(field, { target: { value: 'America/Chicago' } });

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('group')).toHaveAccessibleName('America');
  });
});

describe('userProfile two-tap armed state (F-357)', () => {
  // The armed disposition must CLEAR when the window lapses, not just when the
  // action commits — an aria-pressed left true on a reverted trigger tells a screen
  // reader the control is still armed when it is not.
  it('drops aria-pressed when the arm window lapses', async () => {
    vi.useFakeTimers();
    try {
      const { userGamesAPI } = await import('@/lib/api');
      (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockResolvedValue(
        OWNED_GAMES
      );

      renderProfile();
      await vi.waitFor(() =>
        expect(screen.getByRole('button', { name: 'Remove Catan' })).toBeInTheDocument()
      );

      fireEvent.click(screen.getByRole('button', { name: 'Remove Catan' }));
      expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      const reverted = screen.getByRole('button', { name: 'Remove Catan' });
      expect(reverted).not.toHaveAttribute('aria-pressed');
      expect(userGamesAPI.removeOwnedGame).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Req 12 / OI-5 — one register for this surface's receipts (plan 88-10 Task 3)
// ---------------------------------------------------------------------------
// §6.2's contract is `{Object} {past-tense verb}`: no "successfully", no
// exclamation mark, <=4 words. These pin the EXACT strings, because the failure
// mode OI-5 exists to close is drift back to a chattier voice one string at a
// time — which no shape-based assertion would catch.

describe('userProfile toast register (OI-5)', () => {
  it('converges the username receipt', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.updateUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      username: 'Renamed',
    });

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit username' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toastMock().success).toHaveBeenCalledWith('Username updated')
    );
  });

  it('converges the Google Calendar receipt', async () => {
    const { googleCalendarAPI } = await import('@/lib/api');
    (googleCalendarAPI.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      connected: true,
    });

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Calendar' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(toastMock().success).toHaveBeenCalledWith('Google Calendar disconnected')
    );
  });

  it('converges the pattern-deleted receipt', async () => {
    h.patterns = PATTERNS;
    renderProfile();

    const trigger = await screen.findByRole('button', { name: 'Delete Monday schedule' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

    await waitFor(() => expect(toastMock().success).toHaveBeenCalledWith('Pattern deleted'));
  });

  it('gives the collection mutations a receipt in the same register', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockResolvedValue(OWNED_GAMES);

    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Catan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(toastMock().success).toHaveBeenCalledWith('Game removed'));
  });

  // The register is a contract, not four hand-checked strings: this reads every
  // success string the file emits and holds them ALL to §6.2, so a sixth added
  // later cannot quietly arrive in the old voice.
  it('holds every success string on this surface to the §6.2 contract', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/userProfile/page.js', 'utf8')
    );
    const strings = [...source.matchAll(/toast\.success\((['"`])([^'"`]*)\1\)/g)].map(
      (match) => match[2]
    );

    expect(strings.length).toBeGreaterThanOrEqual(7);
    for (const value of strings) {
      expect(value).not.toMatch(/successfully/i);
      expect(value).not.toContain('!');
      expect(value.split(' ').length).toBeLessThanOrEqual(4);
    }
  });

  it('records the D-14 self-stating-toggle exemption at the switch cluster', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/userProfile/page.js', 'utf8')
    );
    expect(source).toContain('DECISION Phase 88-10 (D-14)');
  });
});

// Req 5's acceptance criterion, and the composed audit DEF-88-12-04 asks for: the
// primitives' own suites audit them with trivial children and cannot see a
// violation living in a CONSUMER's composed content — which is where the three
// this run found (an unnamed select, two unnamed phone fields) all lived.
describe('userProfile a11y audit', () => {
  // 88-19: the 15s budget below is now on ALL THREE audits, not just the
  // listbox one. Its reason ("an axe pass over a ~2000-line page is seconds of
  // real work, and under the full suite it does not fit the 5s default")
  // applies identically to these two, and 88-19 both grew the page and added
  // 18 tests to this file. One full-suite run failed once and passed three
  // times on identical code; the failure was not attributable from the
  // captured output, and this is the file's own documented flake shape.
  it('passes an axe audit on the default surface', async () => {
    const { container } = renderProfile();
    await screen.findByRole('switch', { name: 'New Event email notifications' });
    expect(await axe(container)).toHaveNoViolations();
  }, 15000);

  // The closed picker is trivially clean and proves nothing; the open listbox is
  // where the combobox pattern's wiring can actually be wrong. Filtered first so
  // the audit runs over a handful of options, not the whole IANA set.
  // The 15s budget is deliberate: an axe pass over a ~2000-line page is seconds of
  // real work, and under the full suite it does not fit the 5s default. Dropping it
  // makes this test flaky under load, not faster.
  it('passes an axe audit with the timezone listbox open', async () => {
    const { container } = renderProfile();

    const field = await screen.findByRole('combobox', { name: 'Timezone' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'America/Chicago' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  }, 15000);

  it('passes an axe audit with the SMS-entitled surface composed in', async () => {
    const { container } = renderProfile({ sms_enabled: true, phone_verified: false });
    await screen.findByRole('switch', { name: 'New Event SMS notifications' });
    expect(await axe(container)).toHaveNoViolations();
  }, 15000);
});

// ===========================================================================
// Plan 88-19 — Req 1 (the 16px iOS focus-zoom floor)
// ===========================================================================
// Swept, not enumerated, for the reason 88-20 gives on the same pin in
// gameDetail: the failure this phase closes is not "control X is 12px", it is
// "nothing notices when a sub-16px control lands". A named-control pin goes
// green forever the moment an eighth availability field is added.
//
// jsdom compiles no Tailwind, so a computed font-size is meaningless here — the
// assertion is on the class contract the `Input`/`SelectControl` primitives
// supply (`text-base`, unconditional, no breakpoint variant).
//
// NOTE for whoever extends this: the plan's shell gate
// (`! grep -nE "<(input|select|textarea)[^>]*text-(xs|sm)"`) is line-based and
// every control in this file is written across multiple lines, so it can never
// match — it passed before any of this work was done. These pins are the real
// gate. Do not delete them in favour of the grep.
// ---------------------------------------------------------------------------

/** Every form control currently in the document, portal-included. */
function allControls(): HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('input, select, textarea')
  );
}

function sizeOffenders(): string[] {
  return allControls()
    .filter((c) => /\btext-(xs|sm)\b/.test(c.className))
    .map((c) => `${c.tagName.toLowerCase()}#${c.id || '(no id)'}: ${c.className}`);
}

function unsizedTextEntry(): string[] {
  // The availability "Mark as available" checkbox is excluded BY TYPE, not by
  // name: iOS focus-zoom is a text-entry behaviour and the primitive's
  // `block w-full p-2` would stretch the box across the form. See the marker at
  // its call site.
  return allControls()
    .filter((c) => !(c instanceof HTMLInputElement && c.type === 'checkbox'))
    .filter((c) => !/\btext-base\b/.test(c.className))
    .map((c) => `${c.tagName.toLowerCase()}#${c.id || '(no id)'}: ${c.className}`);
}

/**
 * Open every control-bearing surface reachable from the DEFAULT tab: the
 * username editor, the recurring-schedule form and the BGG search panel. The
 * phone controls come from `sms_enabled`, so the caller supplies that.
 *
 * The Specific Dates form is deliberately NOT here — Radix unmounts the
 * inactive tab panel, so the two forms cannot be open at once. It has its own
 * test below.
 */
async function openDefaultTabControls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit username' }));
  await user.click(screen.getByRole('button', { name: '+ Add Schedule' }));
  await user.click(screen.getByRole('button', { name: '+ Add from BGG' }));
}

describe('userProfile form controls (Req 1 — the 16px floor)', () => {
  // UI review 2026-09-30 (Top Fix 2, WINDOWS #33): the Edit-username pencil was a bare emoji
  // button (~20x24). It now carries the same negative-margin 44px idiom as the SMS banner
  // dismiss, so the tap target grows; the glyph shifts ~4px right because the -8px margin
  // consumes the row's gap-2 (page.js says the same). Pinned on the class idiom because jsdom
  // has no layout. 88.6.1-53 (V-1a / AC-23): the ring is INSET, so it can no longer paint over
  // the last letter of the name; the geometry half is measured in a real browser by
  // e2e/profile-pencil-ring.spec.ts, not left to the owner's device check. Review #215: the
  // title is the ONE name source; the glyph is hidden, so the name is not read twice.
  it('the Edit-username pencil carries the 44px tap-target idiom, ring inset, one name source (88.6.1-53, V-1a)', async () => {
    renderProfile();
    const pencil = await screen.findByRole('button', { name: 'Edit username' });
    for (const cls of ['-m-2', 'inline-flex', 'min-h-11', 'min-w-11', 'items-center', 'justify-center', 'focus:outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-focus-ring', 'focus-visible:ring-inset']) {
      expect(pencil.className.split(/\s+/)).toContain(cls);
    }
    expect(pencil.className.split(/\s+/)).not.toContain('focus-visible:ring-offset-2');
    // One name source: no aria-label, the title names it, and every glyph is aria-hidden.
    expect(pencil).not.toHaveAttribute('aria-label');
    expect(pencil).toHaveAttribute('title', 'Edit username');
    const hidden = pencil.querySelector('span[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect((pencil.textContent ?? '').length).toBeGreaterThan(0);
    expect(hidden?.textContent).toBe(pencil.textContent);
  });

  it('carries no sub-16px size class on any control', async () => {
    const user = userEvent.setup();
    renderProfile({ sms_enabled: true, phone_verified: false });
    await openDefaultTabControls(user);

    // Guard against the sweep silently passing over an empty set.
    expect(allControls().length).toBeGreaterThanOrEqual(10);
    expect(sizeOffenders()).toEqual([]);
  });

  it('renders every text-entry control at text-base', async () => {
    const user = userEvent.setup();
    renderProfile({ sms_enabled: true, phone_verified: false });
    await openDefaultTabControls(user);

    expect(unsizedTextEntry()).toEqual([]);
  });

  it('holds the Specific Dates form to the same floor', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(await screen.findByRole('tab', { name: 'Specific Dates' }));
    await user.click(await screen.findByRole('button', { name: '+ Add Override' }));

    // 3 date/time controls + the excluded checkbox, plus the timezone combobox
    // and the reminder select that render on every tab.
    expect(allControls().length).toBeGreaterThanOrEqual(6);
    expect(sizeOffenders()).toEqual([]);
    expect(unsizedTextEntry()).toEqual([]);
  });

  it('holds the verify-code step to the same floor', async () => {
    renderProfile({ sms_enabled: true, phone_verified: false });

    const phone = await screen.findByRole('textbox', { name: 'Phone number' });
    // A real, parseable US number: libphonenumber rejects the 555-01xx
    // fictional range, so "Save & Verify" stays disabled with a 555 number and
    // the flow never advances.
    fireEvent.change(phone, { target: { value: '+1 415 555 2671' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Verify' }));

    await screen.findByRole('textbox', { name: 'Verification code' });
    expect(sizeOffenders()).toEqual([]);
    expect(unsizedTextEntry()).toEqual([]);
  });

  // The one fix that would satisfy a naive reading of Req 1 and still ship the
  // blocker: `md:` is the breakpoint phones sit BELOW, so a size variant applies
  // the un-zoomable size to desktop and the zooming size to the phone. Two
  // controls on this surface shipped exactly that.
  //
  // Asserted over the RENDERED controls rather than by grepping the source, on
  // purpose: a source grep for the offending utility also matches the comment
  // that explains why it is banned, and the surrounding prose in this file.
  // Two other elements on this surface legitimately carry a breakpoint size
  // (a body <p> and two `.btn` labels) and are Req 8 / the `.btn` census's, not
  // Req 1's — a file-wide grep could not tell them apart from a control.
  it('never promotes a control to 16px at a breakpoint', async () => {
    const user = userEvent.setup();
    renderProfile({ sms_enabled: true, phone_verified: false });
    await openDefaultTabControls(user);

    const variantSized = allControls()
      .filter((c) => /\b[a-z]+:text-[a-z0-9]+\b/.test(c.className))
      .map((c) => `${c.tagName.toLowerCase()}#${c.id || '(no id)'}: ${c.className}`);
    expect(variantSized).toEqual([]);
  });
});

// ===========================================================================
// Plan 88-19 — Req 2 (the type scale, UI-SPEC §4.1/§4.2)
// ===========================================================================
// Sizes and weights are asserted from the SOURCE rather than from rendered
// nodes: several of these headings live behind a tab or a toggle, and a pin
// that only sees the mounted half is a pin that goes green while the other half
// drifts.
// ---------------------------------------------------------------------------

async function pageSource() {
  return import('node:fs/promises').then((fs) =>
    fs.readFile('src/app/userProfile/page.js', 'utf8')
  );
}

describe('userProfile type scale (Req 2)', () => {
  it('renders exactly one h1, at the Display role', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Notification Preferences' });

    const h1s = Array.from(document.querySelectorAll('h1'));
    expect(h1s).toHaveLength(1);
    expect(h1s[0].className).toMatch(/\btext-3xl\b/);
    expect(h1s[0].className).toMatch(/\bfont-bold\b/);
  });

  // AMENDED Phase 88.6-17 (D-04 / D-05). The three pins below used to read RAW
  // `<hN className="…">` opening tags. All fourteen headings on this surface now
  // render through `<Heading>`, so a raw-tag scan matches ZERO — every one of them
  // would have gone green while asserting nothing about a single heading, which is
  // the "gate that stops measuring" failure this phase keeps finding. They are
  // RE-AIMED at the primitive rather than deleted: the tree-wide rule lives in
  // `typeScaleTouchedSurfaces.test.ts`, but this file is the per-surface guard and
  // a surface with no guard is how a fifth size creeps back into one page.
  //
  // The FOUND-COUNT floor is the anti-vacuity half and is load-bearing: without it
  // a scanner that matched nothing would satisfy every `for` loop below.
  const headingTags = (source: string) =>
    [...source.matchAll(/<Heading\s([^>]*)>/g)].map((m) => m[1]);

  it('renders every heading through the primitive, none raw', async () => {
    const source = await pageSource();
    // Raw heading TAGS survive only inside comment prose (the `DECISION Phase 88-19`
    // block and the inline-editor marker), which is why the count is taken on tags
    // that carry a className — prose does not.
    const raw = [...source.matchAll(/<h[1-6]\s[^>]*className="([^"]*)"/g)];
    expect(raw.map((m) => m[0])).toEqual([]);
    // 14 -> 15 (Phase 88.6.1-79): the withdrawn identity arm's page heading, a second `level={1}`
    // TAG in source; only one of the two arms is ever mounted, so the page renders one h1.
    expect(headingTags(source).length).toBe(15);
  });

  // §4.2 states 600 as a PROHIBITION, not a preference, and D-01 gives it exactly
  // one home — the Button primitive. On the primitive the weight comes from the cva
  // base, so the way 600 could come back is a caller OVERRIDE.
  it('pairs no heading with an off-scale weight override', async () => {
    const source = await pageSource();
    const offenders = headingTags(source).filter((attrs) =>
      /\bfont-(?:medium|semibold|normal)\b/.test(attrs)
    );
    expect(offenders).toEqual([]);
  });

  // The whole point of a 4-size working set is that a fifth size cannot creep back
  // in. `text-lg` (18) and `text-2xl` (24) were both on this surface.
  it('keeps every heading inside the working set', async () => {
    const source = await pageSource();
    const tags = headingTags(source);
    expect(tags.length).toBe(15);
    const offenders = tags.filter((attrs) =>
      /\b(?:[a-z]+:)?text-(?:lg|2xl|4xl|5xl)\b/.test(attrs)
    );
    expect(offenders).toEqual([]);
  });

  it('gives every heading an explicit size and an explicit level', async () => {
    const source = await pageSource();
    const tags = headingTags(source);
    expect(tags.length).toBe(15);
    for (const attrs of tags) {
      // UI-SPEC §4.4: every migrated call site records its rung rather than
      // inheriting one from the level.
      expect(attrs, attrs).toMatch(/\bsize="(?:display|heading|body|label)"/);
      expect(attrs, attrs).toMatch(/\blevel=\{[1-6]\}/);
    }
  });

  // P4. The level distribution is the thing the migration must not move, and it is
  // asserted HERE per surface as well as tree-wide in `typeScaleTouchedSurfaces`.
  it('preserves the level distribution across the migration', async () => {
    const source = await pageSource();
    const counts: Record<string, number> = {};
    for (const attrs of headingTags(source)) {
      const lvl = /\blevel=\{([1-6])\}/.exec(attrs)?.[1] as string;
      counts[lvl] = (counts[lvl] ?? 0) + 1;
    }
    // '1': 1 -> 2 (Phase 88.6.1-79): the withdrawn identity arm's heading; the two arms are exclusive.
    expect(counts).toEqual({ '1': 2, '2': 7, '3': 4, '4': 2 });
  });

  // The two h4s at 16 are the one judgement D-04's table does not make for us.
  it('renders the two h4 sub-headings on the body rung', async () => {
    const source = await pageSource();
    const h4s = headingTags(source).filter((a) => /\blevel=\{4\}/.test(a));
    expect(h4s).toHaveLength(2);
    for (const attrs of h4s) expect(attrs).toMatch(/\bsize="body"/);
  });

  // A-1: the page title WRAPS. `Heading`'s base is `wrap-anywhere`, and a call-site
  // `truncate` would be a clip policy fighting it.
  it('leaves no clip utility on the page title', async () => {
    const source = await pageSource();
    const h1 = headingTags(source).filter((a) => /\blevel=\{1\}/.test(a));
    // 1 -> 2 (Phase 88.6.1-79): the healthy heading and the withdrawn arm's (exclusive arms); both wrap.
    expect(h1).toHaveLength(2);
    for (const attrs of h1) {
      expect(attrs).not.toMatch(/\b(?:truncate|line-clamp-\d|text-ellipsis|whitespace-nowrap)\b/);
    }
  });

  // Plan 08 re-pointed `ModalAction` at `Button` internally and left the call-site
  // API untouched, so a sweep that "helpfully" converted these to `<Button>` would
  // break the contract that plan preserved. Pinned so the non-change is visible.
  it('leaves the two `Modal.Action` call sites on their own API', async () => {
    const source = await pageSource();
    // Matched to end-of-line, not to the first `>`: an arrow function in the handler
    // carries a `>` of its own, and a `[^>]*` form truncates there and pins a prefix.
    const actions = [...source.matchAll(/<Modal\.Action\s.*$/gm)].map((m) => m[0]);
    expect(actions).toEqual([
      '<Modal.Action variant="secondary" onClick={() => setBggImportPromptOpen(false)}>',
      '<Modal.Action variant="primary" onClick={importBGGCollection}>',
    ]);
  });

  // §3.4 rule 3 / AC-3: on a `.btn` element `text-*`, `p*-`, `font-*`, `rounded-*`
  // and `gap-*` are DEAD, so carrying one is a lie about what paints.
  it('leaves no dead class on any `Button` in this file', async () => {
    const source = await pageSource();
    const buttons = [...source.matchAll(/<Button\n((?:\s+[^\n]*\n)*?)\s*>/g)].map((m) => m[1]);
    expect(buttons.length).toBeGreaterThanOrEqual(13);
    for (const attrs of buttons) {
      const cls = /className="([^"]*)"/.exec(attrs)?.[1] ?? '';
      for (const token of cls.split(/\s+/).filter(Boolean)) {
        expect(
          /^(?:[a-z0-9]+:)?(?:text-(?:xs|sm|base|lg|xl|2xl|3xl)|p[xytrbl]?-[\w.]+|font-(?:medium|semibold|bold)|rounded(?:-[\w.]+)?|gap-[\w.]+)$/.test(
            token
          ),
          `${token} is dead on a .btn element`
        ).toBe(false);
      }
    }
  });

  // Req 2's other half. The four survivors are the Google brand mark, which is
  // art rather than theme — each is tagged for 88-29's exemption list, and the
  // tag is what this pin proves is still there.
  it('leaves no untagged raw hex in the file', async () => {
    const source = await pageSource();
    const untagged = source
      .split('\n')
      .filter((line) => /#[0-9a-fA-F]{3,6}\b/.test(line))
      .filter((line) => !line.includes('TODO(88-29)'));
    expect(untagged).toEqual([]);
  });
});


// ===========================================================================
// Plan 88-19 — Req 7 (microcopy, UI-SPEC §6.1/§6.3)
// ===========================================================================

describe('userProfile microcopy (Req 7)', () => {
  it('names what is loading in every loading string', async () => {
    const source = await pageSource();
    // Anything that renders a bare progressive verb with no object.
    expect(source).not.toMatch(/>\s*(Loading|Checking)\.\.\.\s*</);
    expect(source).not.toMatch(/loading data/i);
  });

  // T-88-19-02 / ASVS V7: the page's error branch used to render the raw
  // upstream message as its entire body, with no action offered. Asserted at
  // RUNTIME rather than by grepping the source — a source grep for the
  // interpolation also matches the marker that explains why it was removed.
  //
  // AMENDED Phase 88.6-17 (AC-2 convert-on-touch): the developer half of this pin
  // moved CHANNEL. It used to assert `console.error` was called; the report is now a
  // Sentry breadcrumb via `logger.info`, emitted from a guarded top-level effect rather
  // than from the render body. The PROPERTY is unchanged and is what is asserted — the
  // upstream text reaches the developer and never the person — so this is a re-aim, not
  // a weakening. Asserting the new channel rather than deleting the half is deliberate:
  // an in-place swap here would have flooded the session's finite breadcrumb buffer, and
  // a pin that stopped watching would not have noticed the report disappearing entirely.
  it('renders designed copy, not the raw error, when the session errors', async () => {
    h.authError = new Error('ECONNREFUSED 10.0.0.4:5432 — pool exhausted');
    renderProfile();

    expect(
      await screen.findByText("We couldn't load your profile")
    ).toBeInTheDocument();
    // The upstream text reaches the developer, never the person.
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pool exhausted/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(loggerMock().info).toHaveBeenCalledWith(
        'Auth0 session error on /userProfile:',
        expect.objectContaining({ message: expect.stringContaining('ECONNREFUSED') })
      )
    );
    // And the raw console channel this file used to write to is gone.
    expect(loggerMock().error).not.toHaveBeenCalled();
  });

  // AC-2: the effect is GUARDED. Without the `if (!error) return;` it would fire on every
  // error-free load and evict the session's other breadcrumbs.
  it('files no session-error breadcrumb on an error-free load', async () => {
    renderProfile();
    await screen.findByRole('heading', { name: 'Notification Preferences' });
    expect(loggerMock().info).not.toHaveBeenCalledWith(
      'Auth0 session error on /userProfile:',
      expect.anything()
    );
  });

  // The branch was also a dead end — one red line and nothing to click.
  it('offers a way out of the session-error screen', async () => {
    h.authError = new Error('boom');
    renderProfile();
    expect(
      await screen.findByRole('button', { name: 'Reload page' })
    ).toBeInTheDocument();
  });

  // Errors state what failed AND what to do next (§6.1). Deliberately worded so
  // 88-25's negative "failed to load" gate on this file stays green.
  it('states the next step on the preference-reset failure', async () => {
    const source = await pageSource();
    expect(source).not.toContain('Failed to reset');
    expect(source).toContain("Couldn't reset — try again.");
  });
});


// ===========================================================================
// Plan 88-19 — DEF-88-10-02: the save-status slot is keyed, not single
// ===========================================================================
// D-14 exempts these toggles from a success toast precisely BECAUSE the row's
// own Saving/Saved indicator covers the round trip. A single-slot status made
// that indicator lie the moment a second toggle was flipped: the first row's
// "Saving…" vanished with no receipt, and its unkeyed 2s timer could clear the
// SECOND row's indicator early. Both halves are pinned here.
// ---------------------------------------------------------------------------

describe('userProfile save-status slots (DEF-88-10-02)', () => {
  // The first test below parks the sender on a promise it controls. The global
  // `vi.clearAllMocks()` clears CALLS, not IMPLEMENTATIONS, so without this the
  // parked promise leaks into every later test and nothing ever resolves.
  // Restored on both sides so a describe appended after this one is safe too.
  async function restoreSender() {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.updateNotificationPreferences as ReturnType<typeof vi.fn>).mockResolvedValue({});
  }
  beforeEach(restoreSender);
  afterEach(restoreSender);

  /** The status cell text for one notification row, or '' when at rest. */
  function rowStatusText(label: string) {
    const row = screen.getByText(label).closest('div.py-3') as HTMLElement;
    return row.textContent ?? '';
  }

  it('keeps a second row’s receipt from erasing the first', async () => {
    const { usersAPI } = await import('@/lib/api');
    // Both requests stay in flight so BOTH rows must show "Saving…" at once —
    // the exact state the single slot could not represent.
    const pending: Array<() => void> = [];
    (usersAPI.updateNotificationPreferences as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => pending.push(() => resolve()))
    );

    renderProfile();
    fireEvent.click(await screen.findByRole('switch', { name: 'New Event email notifications' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Event Updates email notifications' }));

    await waitFor(() => expect(rowStatusText('New Event')).toContain('Saving'));
    expect(rowStatusText('Event Updates')).toContain('Saving');

    await act(async () => {
      pending.forEach((resolve) => resolve());
    });
    await waitFor(() => expect(rowStatusText('New Event')).toContain('Saved'));
    expect(rowStatusText('Event Updates')).toContain('Saved');
  });

  it('does not let one row’s clear timer wipe another row’s indicator', async () => {
    vi.useFakeTimers();
    try {
      renderProfile();
      await vi.waitFor(() =>
        expect(
          screen.getByRole('switch', { name: 'New Event email notifications' })
        ).toBeInTheDocument()
      );

      fireEvent.click(screen.getByRole('switch', { name: 'New Event email notifications' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      // 1.5s into the first row's 2s window, flip a second row.
      fireEvent.click(screen.getByRole('switch', { name: 'Event Updates email notifications' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      // The first row's timer has now fired and cleared ONLY the first row.
      expect(rowStatusText('New Event')).not.toContain('Saved');
      expect(rowStatusText('Event Updates')).toContain('Saved');
    } finally {
      vi.useRealTimers();
    }
  });

  // Pre-existing double-render, fixed by the same keying: a reminder-window save
  // set `{type:'reminder'}`, and the ROW indicator never checked the channel, so
  // "Saving…" appeared twice on the reminder row.
  it('lights only the window indicator when the reminder window changes', async () => {
    renderProfile();
    const select = await screen.findByRole('combobox', { name: 'Remind me' });
    fireEvent.change(select, { target: { value: '24' } });

    await waitFor(() =>
      expect(rowStatusText('Event Reminders')).toContain('Saved')
    );
    expect(rowStatusText('Event Reminders').match(/Saved/g)).toHaveLength(1);
  });

  it('surfaces the guard message on the row that was blocked', async () => {
    renderProfile({
      notification_preferences: {
        event_created: { email: true, sms: false },
        reminder: { email: false, sms: false, window_hours: 1 },
        event_updated: { email: false, sms: false },
        event_cancelled: { email: false, sms: false },
      },
    });
    fireEvent.click(
      await screen.findByRole('switch', { name: 'New Event email notifications' })
    );

    await waitFor(() =>
      expect(rowStatusText('New Event')).toContain('At least one notification must stay enabled')
    );
    expect(rowStatusText('Event Updates')).not.toContain('At least one');
  });

  // 88-CODE-REVIEW MED#15: the Switch announces the optimistic flip, so outcomes
  // must be announced too — a failed save's rollback was visual-only. Outcomes
  // land in always-mounted sr-only StatusRegions: polite for saved, ASSERTIVE
  // (role=alert) for error and the guard, since they explain a reverted action.
  it('announces a failed save assertively — the rollback is no longer SR-silent', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.updateNotificationPreferences as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom')
    );

    renderProfile();
    fireEvent.click(await screen.findByRole('switch', { name: 'New Event email notifications' }));

    await waitFor(() =>
      expect(
        screen.getByText('New Event email notifications: save failed — the switch was reset')
      ).toBeInTheDocument()
    );
    const region = screen
      .getByText('New Event email notifications: save failed — the switch was reset')
      .closest('[role="alert"]');
    expect(region).not.toBeNull();
  });

  it('announces a successful save politely through the status region', async () => {
    renderProfile();
    fireEvent.click(await screen.findByRole('switch', { name: 'New Event email notifications' }));

    await waitFor(() =>
      expect(screen.getByText('New Event email notifications: saved')).toBeInTheDocument()
    );
    const region = screen
      .getByText('New Event email notifications: saved')
      .closest('[role="status"]');
    expect(region).not.toBeNull();
  });
});

// ===========================================================================
// 88-CODE-REVIEW H1 — a wrong verification code is NOT success
// ===========================================================================
// The backend's wrong-code outcome is a 200 { verified: false }
// (routes/users.js:823-828 — only MALFORMED input 400s), so the handler must read the
// body. Before H1 it discarded it: a wrong code marked the phone verified in
// local state and the immortal self cache while the DB row stayed false — the
// SMS toggles enabled and SMS silently never sent. These pins hold the gate.
// ===========================================================================
// Plan 88.6-17 — the sms_enabled phone block and the theme toggles
// ===========================================================================
// Every arm below was run against the PRE-SWEEP component (or a deliberately
// planted wrong fix) before being accepted; the red-then-green ledger is in
// `88.6-17-SUMMARY.md`. jsdom performs no layout and loads no stylesheet, so no
// arm here asserts a width, a height or a computed style — the geometry half is
// the rendered 375px measurement recorded in the summary.
// ---------------------------------------------------------------------------

describe('userProfile phone block (plan 88.6-17)', () => {
  const VALID = '+1 415 555 2671';

  async function reachEditing() {
    renderProfile({ sms_enabled: true, phone_verified: false });
    const phone = await screen.findByRole('textbox', { name: 'Phone number' });
    fireEvent.change(phone, { target: { value: VALID } });
    return phone;
  }

  async function reachVerifying() {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await reachEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Verify' }));
    await screen.findByRole('textbox', { name: 'Verification code' });
  }

  // R3 #13 / T-88.6-147. The defect: `'input'` and `'saving'` were SIBLING branches, so
  // pressing Save & Verify destroyed the focused element and dropped focus to <body>
  // mid-submit. The property is a DOM fact and needs no layout.
  it('keeps the pressed Save & Verify control mounted and focused while the request is in flight', async () => {
    const { usersAPI } = await import('@/lib/api');
    let release: (value?: unknown) => void = () => {};
    (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    await reachEditing();
    const save = screen.getByRole('button', { name: 'Save & Verify' });
    save.focus();
    expect(document.activeElement).toBe(save);

    fireEvent.click(save);

    // Settle on the POSITIVE signal — the in-flight label landing on the SAME node —
    // rather than on an absence, which is satisfied on the first tick.
    await waitFor(() => expect(save).toHaveTextContent('Sending code...'));
    expect(save.isConnected).toBe(true);
    expect(document.activeElement).toBe(save);
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();

    release({});
    await screen.findByRole('textbox', { name: 'Verification code' });
  });

  // The other half of the same pair. An `aria-disabled` control with no handler refusal is
  // a re-submittable button — and the shipped `resendCooldown > 0` guard shape cannot help
  // here at all, because nothing is set before the await.
  it('dispatches savePhone exactly once when Save & Verify is pressed three times in flight', async () => {
    const { usersAPI } = await import('@/lib/api');
    let release: (value?: unknown) => void = () => {};
    (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    await reachEditing();
    const save = screen.getByRole('button', { name: 'Save & Verify' });
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(save);
    fireEvent.click(save);

    expect(usersAPI.savePhone).toHaveBeenCalledTimes(1);
    release({});
    await screen.findByRole('textbox', { name: 'Verification code' });
  });

  // Rule of KIND: a precondition gate sits on a control nobody has activated, so it stays
  // native. Only the control the user is standing on moves to `aria-disabled`.
  it('leaves the invalid-input and incomplete-code precondition gates natively disabled', async () => {
    renderProfile({ sms_enabled: true, phone_verified: false });
    const save = await screen.findByRole('button', { name: 'Save & Verify' });
    expect(save).toBeDisabled();
    expect(save).not.toHaveAttribute('aria-disabled');

    cleanup();
    await reachVerifying();
    const code = screen.getByRole('textbox', { name: 'Verification code' });
    const verify = within(code.parentElement as HTMLElement).getByRole('button', { name: 'Verify' });
    expect(verify).toBeDisabled();
    expect(verify).not.toHaveAttribute('aria-disabled');
  });

  // D-11 / §3.4 rule 3 / §3.5: on the primitive, with the dead classes gone and the floor
  // supplied by the cva base rather than by a call-site utility.
  it('renders the migrated phone-block controls as `Button` with the primitive floor and no dead classes', async () => {
    await reachEditing();
    const save = screen.getByRole('button', { name: 'Save & Verify' });
    const classes = save.className.split(/\s+/);
    expect(classes).toContain('btn');
    expect(classes).toContain('btn-primary');
    expect(classes).toContain('min-h-11');
    expect(classes).not.toContain('bg-indigo-600');
    for (const dead of ['text-sm', 'px-4', 'py-2', 'rounded-lg', 'font-semibold', 'gap-2']) {
      expect(classes, `${dead} is dead on a .btn element and must not survive`).not.toContain(dead);
    }
  });

  // D-8. The countdown is a label the user has to READ, so it must not be washed out by
  // `.btn:disabled { opacity: .5 }` — which is exactly what keeping the native attribute
  // would have done, while ghost's gated ink (keyed on `aria-disabled:`) never fired.
  it('gates Resend with aria-disabled, never natively, and keeps the countdown ink readable', async () => {
    await reachVerifying();
    const resend = screen.getByRole('button', { name: 'Resend code' });
    expect(resend).not.toBeDisabled();

    fireEvent.click(resend);
    const cooling = await screen.findByRole('button', { name: /^Resend in \d+s$/ });
    expect(cooling).toHaveAttribute('aria-disabled', 'true');
    expect(cooling).not.toBeDisabled();
    const classes = cooling.className.split(/\s+/);
    expect(classes).toContain('aria-disabled:text-content-muted');
    expect(classes.some((c) => /^disabled:opacity-/.test(c))).toBe(false);
  });

  // R2 #29 / T-88.6-146. This control's per-press side effect is an outbound SMS — the one
  // control in this phase with a money cost per press. `setResendCooldown(60)` runs AFTER
  // the await, so the shipped cooldown guard passes for the whole in-flight window.
  it('dispatches one outbound SMS when Resend is pressed three times in flight', async () => {
    const { usersAPI } = await import('@/lib/api');
    await reachVerifying();

    let release: (value?: unknown) => void = () => {};
    (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockClear();
    (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    const resend = screen.getByRole('button', { name: 'Resend code' });
    fireEvent.click(resend);
    fireEvent.click(resend);
    fireEvent.click(resend);

    expect(usersAPI.savePhone).toHaveBeenCalledTimes(1);
    release({});
    await screen.findByRole('button', { name: /^Resend in \d+s$/ });
  });

  // R2 #29, second defect: the ticker was a LOCAL `const timer`, cleared only by its own
  // tick, so an unmount mid-countdown leaked it.
  it('clears the cooldown ticker on unmount', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      await reachVerifying();
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
      await screen.findByRole('button', { name: /^Resend in \d+s$/ });

      const timerId = setIntervalSpy.mock.results.at(-1)?.value;
      expect(timerId).toBeDefined();
      clearIntervalSpy.mockClear();
      cleanup();
      expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  // A10 / T-88.6-43 + T-88.6-41. These three stay RAW `<button>`s: `.btn`'s unlayered
  // `font-weight: 600` would render both arms of the Remove ternary at 600 and delete the
  // armed cue on the SOLE path to removing a verified phone number. This arm pins the
  // MECHANISM and the preserved ink; the 44px measurement is the rendered one.
  it('floors the token-inked block controls in place, keeps them off the primitive, and preserves the armed cue', async () => {
    const { usersAPI } = await import('@/lib/api');
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });
    const change = await screen.findByRole('button', { name: 'Change number' });
    const remove = screen.getByRole('button', { name: 'Remove' });

    for (const el of [change, remove]) {
      const classes = el.className.split(/\s+/);
      expect(classes).toContain('min-h-11');
      expect(classes, 'these are floored IN PLACE, not migrated').not.toContain('btn');
      expect(classes).toContain('focus-visible:ring-focus-ring');
      expect(classes).toContain('focus-visible:ring-offset-2');
    }
    expect(remove.className).toMatch(/\btext-content-status-error\b/);

    fireEvent.click(remove);
    const armed = screen.getByRole('button', { name: 'Tap again to remove' });
    expect(armed.className).toMatch(/\bfont-semibold\b/);
    expect(usersAPI.removePhone).not.toHaveBeenCalled();
  });

  it('floors the SMS-disabled banner dismiss in place and leaves its glyph sizing alone', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.removePhone as ReturnType<typeof vi.fn>).mockResolvedValue({
      sms_enabled: true,
      phone: null,
      notification_preferences: DEFAULT_PREFS,
    });
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to remove' }));

    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    const classes = dismiss.className.split(/\s+/);
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('min-w-11');
    expect(classes).toContain('focus-visible:ring-focus-ring');
    // §4.3: a glyph-only control is ICON sizing, never a type rung — byte-unchanged.
    expect(classes).toContain('text-lg');
  });
});

describe('userProfile theme toggles + landmark + legal text (plan 88.6-17)', () => {
  // W19's precondition, asserted HERE as well as in `cascadeOrder.test.ts`, because this is
  // the file whose controls lose a visible border if the reset goes back to being unlayered
  // — and that failure is silent.
  it('W19: the `.btn` border reset is inside `@layer components`', async () => {
    const css = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/globals.css', 'utf8')
    );
    expect(css).toMatch(/@layer components\s*\{\s*\.btn\s*\{\s*border:\s*none;\s*\}\s*\}/);
  });

  // D-11 outcome (a). The fill is byte-unchanged (P6) and the border survives (W19).
  it('renders both theme toggles as `Button` with their fills, borders and pressed state intact', async () => {
    renderProfile();
    const light = await screen.findByRole('button', { name: 'Light' });
    const dark = screen.getByRole('button', { name: 'Dark' });
    const lightClasses = light.className.split(/\s+/);

    expect(lightClasses).toContain('btn');
    expect(lightClasses).toContain('min-h-11');
    expect(light).toHaveAttribute('aria-pressed', 'true');
    expect(dark).toHaveAttribute('aria-pressed', 'false');

    // P6: the fill and the amber border are byte-unchanged.
    expect(lightClasses).toContain('bg-amber-50');
    expect(lightClasses).toContain('border-amber-500');
    expect(lightClasses).toContain('border');
    // `resolvedTheme` is mocked 'light', so Dark renders its UNSELECTED arm here.
    expect(dark.className.split(/\s+/)).toContain('bg-surface-card');
    expect(dark.className.split(/\s+/)).toContain('border-line');
    // The selected DARK arm is unreachable under this mock, so its fill and its hover pin
    // are held at the source rather than left unasserted.
    const source = await pageSource();
    expect(source).toContain("'border-amber-500 bg-purple-900 enabled-hover:bg-purple-900 text-white'");

    // The selected fill is PINNED through hover: ghost's base carries
    // `enabled-hover:bg-surface-hover`, which would otherwise wash the amber on hover.
    expect(lightClasses).toContain('enabled-hover:bg-amber-50');
    expect(lightClasses).not.toContain('enabled-hover:bg-surface-hover');

    // The dead classes went with the migration.
    for (const dead of ['px-4', 'py-2', 'rounded-lg', 'font-semibold', 'gap-2']) {
      expect(lightClasses).not.toContain(dead);
    }
  });

  // Owner ruling 175 (2026-09-14). The property is the landmark's accessible NAME, so it is
  // asserted by a role-plus-name query and not by pinning the attribute.
  it('names the breadcrumb landmark', async () => {
    renderProfile();
    expect(
      await screen.findByRole('navigation', { name: 'Breadcrumb' })
    ).toBeInTheDocument();
  });

  // T-88.6-138: once the current-page span drops to 400, colour is the only remaining
  // VISUAL cue, so the state is exposed programmatically as well.
  it('exposes the breadcrumb current page programmatically, at 400', async () => {
    renderProfile();
    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    const current = within(nav).getByText('Profile');
    expect(current).toHaveAttribute('aria-current', 'page');
    const classes = current.className.split(/\s+/);
    expect(classes).toContain('font-normal');
    expect(classes).not.toContain('font-semibold');
    expect(classes).toContain('text-content-primary');
  });

  // D-01 / T-88.6-42: legal text is never caption-sized.
  it('renders the TCPA disclosure at 14, with its three inner spans dispositioned', async () => {
    renderProfile({ sms_enabled: true });
    const label = await screen.findByText('SMS Notifications Disclosure');
    expect(label.className.split(/\s+/)).toContain('text-sm');
    expect(label.className.split(/\s+/)).toContain('font-bold');
    expect(label.className.split(/\s+/)).not.toContain('text-xs');

    const stop = screen.getByText('STOP');
    const body = stop.parentElement as HTMLElement;
    expect(body.className.split(/\s+/)).toContain('text-sm');
    expect(body.className.split(/\s+/)).not.toContain('text-xs');

    // STOP / HELP keep `font-mono`, a NON-COLOUR cue, so they drop to 400.
    for (const keyword of ['STOP', 'HELP']) {
      const span = screen.getByText(keyword);
      expect(span.className.split(/\s+/)).toContain('font-mono');
      expect(span.className.split(/\s+/)).toContain('font-normal');
    }
    // The brand span has no surviving non-colour cue, so it takes 700 rather than
    // 400-plus-colour, which would leave a colour-only distinction inside legal text.
    expect(screen.getByText('NextGameNight').className.split(/\s+/)).toContain('font-bold');

    // P1: the wording is byte-unchanged.
    expect(body.textContent).toContain(
      'Consent is not a condition of using the service.'
    );
  });
});

// ===========================================================================
// Plan 88.6-17 task 3 — the type/weight sweep and the muted-ground re-ink
// ===========================================================================

describe('userProfile type + weight sweep (plan 88.6-17)', () => {
  // D-16 / T-88.6-42's sibling: `text-content-link` on `bg-surface-muted` measures 3.9909,
  // below AA. It was never a LINK — zero of the 61 `text-content-link` sites on this ground
  // is — so the token was wrong, not the ground.
  it('re-inks the import-progress banner off the failing muted pairing', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    let release: (value?: unknown) => void = () => {};
    (userGamesAPI.importBGGCollection as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    renderProfile();
    const field = await screen.findByRole('textbox', { name: 'BoardGameGeek username' });
    fireEvent.change(field, { target: { value: 'someone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Collection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    const banner = (await screen.findByText('Fetching your BGG collection...')).parentElement as HTMLElement;
    const classes = banner.className.split(/\s+/);
    expect(classes).toContain('bg-surface-muted');
    expect(classes).toContain('text-content-secondary');
    expect(classes).not.toContain('text-content-link');
    release({ imported: 0 });
  });

  // D-03's floor for this file, held as an ENUMERATION rather than a count: the five 600s that
  // survive are named, so a sixth is a decision and not a rebase.
  it('leaves exactly five 600 weights, all of them armed-state or the armed-label sizer', async () => {
    const source = await pageSource();
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
    const sites = [...stripped.matchAll(/\bfont-(?:medium|semibold)\b/g)];
    expect(sites).toHaveLength(5);
    expect(sites.every((m) => m[0] === 'font-semibold')).toBe(true);

    // Each survivor sits within reach of the thing that justifies it.
    const windows = sites.map((m) => stripped.slice(Math.max(0, m.index! - 400), m.index! + 60));
    const armed = windows.filter((w) => /isArmed|removeArmed/.test(w));
    const sizer = windows.filter((w) => /aria-hidden="true"[^>]*invisible/.test(w));
    expect(armed.length + sizer.length).toBe(5);
    expect(sizer).toHaveLength(1);
  });

  // P1 / 88-UI-SPEC §6.2 OI-5 / D-12: the existing toasts are OUT OF CONTRACT by decision and
  // must survive the sweep untouched. Pinned as the exact SET, not as a count, because a count
  // survives a reworded string.
  it('leaves every existing toast string byte-unchanged', async () => {
    const source = await pageSource();
    // The quote class is `(?!\1)[^\\]` and not `[^'"]`: the Google Calendar error toast is a
    // DOUBLE-quoted string containing an apostrophe, and a naive class drops it silently — an
    // out-of-contract string escaping the pin that exists to protect it.
    const strings = [
      ...source.matchAll(/toast(?:\.(?:success|error))?\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g),
    ].map((m) => m[2]);
    expect(strings).toEqual([
      'Still loading your account — please try again in a moment.',
      'Please enter a username',
      'Username must be 50 characters or less',
      'Still loading your account — please try again in a moment.',
      'Username updated',
      "We couldn't connect Google Calendar. Please try again.",
      'Google Calendar disconnected',
      'Still loading your account — please try again in a moment.',
      'No games found. Try a different search term.',
      'Still loading your account — please try again in a moment.',
      'Game added',
      'Still loading your account — please try again in a moment.',
      'Game removed',
      // 88.6.1-61 (review 65): the two availability create guards reuse the page's existing
      // still-loading sentence instead of returning without a word — no new string.
      'Still loading your account — please try again in a moment.',
      'Please select at least one day.',
      'Start time must be before end time.',
      'Schedules created',
      'Still loading your account — please try again in a moment.',
      'Start time must be before end time.',
      'Override created',
      'Pattern deleted',
      'Please enter your BGG username',
      'Still loading your account — please try again in a moment.',
    ]);
    // And none of them drifted into the chattier register OI-5 closed.
    for (const value of strings) expect(value).not.toMatch(/successfully/i);
  });

  // §4.3: a glyph-only control is ICON sizing. It leaves the type scale and is never converged.
  it('leaves the glyph-only dismiss on its icon size', async () => {
    const source = await pageSource();
    const dismiss = /className="(-m-2 inline-flex[^"]*)"/.exec(source)?.[1] ?? '';
    expect(dismiss.split(/\s+/)).toContain('text-lg');
  });

  // T-88.6-138's general half (R2 #171): the breadcrumb is the one site in this file where the
  // weight was carrying INFORMATION, and it gained a programmatic cue in the same edit. The
  // timezone picker's current-row highlight is the second; it is pinned here so the sweep cannot
  // net to a colour-only "this is your timezone".
  it('exposes the current timezone programmatically, not by colour alone', async () => {
    renderProfile();
    const tz = await screen.findByRole('combobox', { name: 'Timezone' });
    fireEvent.focus(tz);
    await waitFor(() => expect(tz).toHaveAttribute('aria-expanded', 'true'));
    const current = await screen.findByText('America/New York');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current.className).not.toMatch(/\bfont-medium\b/);
    expect(current.className).toMatch(/\btext-content-link\b/);
  });
});

// Shared by the H1 describe below and plan 88.6.1-18's in-flight describe after it (moved to
// module scope by 88.6.1-18, not copied).
async function reachArmedVerify() {
  // An earlier test leaves a never-settling savePhone implementation behind, and
  // vi.clearAllMocks() clears calls, not implementations — so set it here first.
  const { usersAPI } = await import('@/lib/api');
  (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockResolvedValue({});
  renderProfile({ sms_enabled: true, phone_verified: false });
  const phone = await screen.findByRole('textbox', { name: 'Phone number' });
  fireEvent.change(phone, { target: { value: '+1 415 555 2671' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Verify' }));
  const code = await screen.findByRole('textbox', { name: 'Verification code' });
  fireEvent.change(code, { target: { value: '123456' } });
  // Two buttons on the page are named "Verify" (this one + a link-style one in
  // the SMS rows) — scope to the code-entry row.
  return within(code.parentElement as HTMLElement).getByRole('button', { name: 'Verify' });
}

describe('phone verification — wrong code shows error, never verifies (H1)', () => {
  it('200 { verified: false } → error copy, SMS toggles stay disabled, cache untouched', async () => {
    const { usersAPI } = await import('@/lib/api');
    const { patchSelfCache } = await import('@/lib/hooks/selfIdentityCache');
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockResolvedValue({
      verified: false,
      error: 'Invalid or expired code',
    });

    fireEvent.click(await reachArmedVerify());

    expect(
      await screen.findByText("That code didn't match. Check it and try again.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'New Event SMS notifications' })
    ).toBeDisabled();
    expect(patchSelfCache).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phone_verified: true })
    );
  });

  it('200 { verified: true } still completes the verified path', async () => {
    const { usersAPI } = await import('@/lib/api');
    const { patchSelfCache } = await import('@/lib/hooks/selfIdentityCache');
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockResolvedValue({ verified: true });

    fireEvent.click(await reachArmedVerify());

    await waitFor(() =>
      expect(patchSelfCache).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phone_verified: true })
      )
    );
    expect(
      screen.queryByText("That code didn't match. Check it and try again.")
    ).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Plan 88.6.1-18 — the pressed Verify (W066 / WR-505, D-35) and focus after success (Req 5)
// ===========================================================================
// Rule of POSITION: while a check is in flight the pressed Verify is aria-disabled (never
// natively disabled), reads copy row P1, and a synchronous ref latch refuses a second press.
// jsdom never blurs a disabled element (C-11), so the RED half of each in-flight pin is the
// attributes and the request count; the focus lines are confirm-only here and proven in the
// phone e2e spec (e2e/profile-pressed-controls.spec.ts).
describe('phone Verify in flight (88.6.1-18: W066, D-35, Req 5)', () => {
  const WRONG_CODE_LINE = "That code didn't match. Check it and try again.";
  const P1 = 'Verifying...';

  // Each case sets its own verifyPhone implementation; restore the default afterwards so a
  // held or failing implementation never leaks into a later suite (clearAllMocks keeps impls).
  afterEach(async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('V1: the pressed Verify reads Verifying..., is aria-disabled (not native) and stays mounted while the check runs', async () => {
    const { usersAPI } = await import('@/lib/api');
    let release: (value?: unknown) => void = () => {};
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    const verify = await reachArmedVerify();
    verify.focus();
    fireEvent.click(verify);

    // POSITIVE settle on the SAME node.
    await waitFor(() => expect(verify).toHaveTextContent(P1));
    expect(verify).toHaveAttribute('aria-disabled', 'true');
    expect(verify).not.toBeDisabled();
    expect(verify.isConnected).toBe(true);
    // CONFIRM-ONLY in jsdom (jsdom never blurs a disabled element, C-11); the real-browser
    // proof is the phone e2e spec.
    expect(document.activeElement).toBe(verify);

    await act(async () => { release({ verified: false }); });
    await screen.findByText(WRONG_CODE_LINE);
  });

  it('V2: three presses send ONE check, and a losing duplicate can never paint the wrong-code line over a verified number (WR-505)', async () => {
    const { usersAPI } = await import('@/lib/api');
    // The race, modelled for real: the FIRST check is held; every LATER check resolves at
    // once as a duplicate that loses ({ verified: false }).
    let releaseFirst: (value?: unknown) => void = () => {};
    let calls = 0;
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { releaseFirst = resolve; });
      return Promise.resolve({ verified: false, error: 'Invalid or expired code' });
    });

    const verify = await reachArmedVerify();
    fireEvent.click(verify);
    fireEvent.click(verify);
    fireEvent.click(verify);

    await waitFor(() => expect(verify).toHaveTextContent(P1));
    expect(usersAPI.verifyPhone).toHaveBeenCalledTimes(1);
    // Still in flight after the second and third press, until the FIRST check settles.
    expect(verify).toHaveAttribute('aria-disabled', 'true');
    expect(verify).toHaveTextContent(P1);

    await act(async () => { releaseFirst({ verified: true }); });
    // POSITIVE settle first, then the absence (CF-26).
    await screen.findByText('Phone verified');
    expect(screen.queryByText(WRONG_CODE_LINE)).toBeNull();
  });

  it('V3: a failed check releases the latch — the button resets and a second press sends a second check', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockResolvedValue({
      verified: false,
      error: 'Invalid or expired code',
    });

    const verify = await reachArmedVerify();
    fireEvent.click(verify);
    await screen.findByText(WRONG_CODE_LINE);
    expect(verify.textContent).toBe('Verify');
    expect(verify).not.toHaveAttribute('aria-disabled');
    expect(verify).not.toBeDisabled();

    fireEvent.click(verify);
    expect(usersAPI.verifyPhone).toHaveBeenCalledTimes(2);
    await screen.findByText(WRONG_CODE_LINE);
  });

  it('V4: after a successful check focus lands on "Phone verified" (not <body>), only once the button is gone; the checkmark is aria-hidden', async () => {
    const user = userEvent.setup();
    const { usersAPI } = await import('@/lib/api');
    let release: (value?: unknown) => void = () => {};
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    const verify = await reachArmedVerify();
    await user.click(verify);
    // R5 ordering: while the check is held the pressed Verify still holds focus.
    expect(document.activeElement).toBe(verify);

    await act(async () => { release({ verified: true }); });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText('Phone verified'))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(verify.isConnected).toBe(false);

    const row = screen.getByText('Phone verified').parentElement as HTMLElement;
    const checkmark = row.querySelector('svg');
    expect(checkmark).not.toBeNull();
    expect(checkmark).toHaveAttribute('aria-hidden', 'true');
  });

  it('V5: the recovery is wired with the profile h1 as its fallback (R5 empty; the primitive half is plan 04)', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/userProfile/page.js', 'utf8')
    );
    expect(source).toContain('useFocusRecovery({ fallback: profileHeadingRef })');
    expect(source).toContain('ref={profileHeadingRef}');
  });
});

// ===========================================================================
// Plan 88.6.1-18 — Replay Tutorial stays focusable while resetting (W016 / D-35, SPEC
// amendment row 11). The tutorial itself is not changed (D-49).
// ===========================================================================
// The single-request pin is green against the OLD page only because React drops clicks on a
// natively disabled button; the RED half of R1 is the attributes (C-11).
describe('Replay Tutorial in flight (88.6.1-18: W016, D-35)', () => {
  const RESET_FAILED = "We couldn't restart the tour. Please try again.";

  afterEach(async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.resetTutorial as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('R1: the pressed Replay reads Starting..., is aria-disabled (not native), and three presses send ONE reset', async () => {
    const { usersAPI } = await import('@/lib/api');
    let release: (value?: unknown) => void = () => {};
    (usersAPI.resetTutorial as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    renderProfile();
    const replay = await screen.findByRole('button', { name: 'Replay Tutorial' });
    replay.focus();
    fireEvent.click(replay);

    await waitFor(() => expect(replay).toHaveTextContent('Starting...'));
    expect(replay).toHaveAttribute('aria-disabled', 'true');
    expect(replay).not.toBeDisabled();

    fireEvent.click(replay);
    fireEvent.click(replay);
    expect(usersAPI.resetTutorial).toHaveBeenCalledTimes(1);
    expect(replay).toHaveTextContent('Starting...');
    expect(replay).toHaveAttribute('aria-disabled', 'true');
    // CONFIRM-ONLY in jsdom (jsdom never blurs a disabled element, C-11); the real-browser
    // proof is the phone e2e spec.
    expect(document.activeElement).toBe(replay);

    await act(async () => { release({ tutorial_version: 0 }); });
    await waitFor(() => expect(replay.textContent).toBe('Replay Tutorial'));
  });

  it('R2: a successful reset opens the tour once and the button returns to rest', async () => {
    renderProfile();
    const replay = await screen.findByRole('button', { name: 'Replay Tutorial' });
    fireEvent.click(replay);

    await waitFor(() => expect(h.replayTutorial).toHaveBeenCalledTimes(1));
    expect(h.replayTutorial).toHaveBeenCalledWith();
    await waitFor(() => expect(replay.textContent).toBe('Replay Tutorial'));
    expect(replay).not.toHaveAttribute('aria-disabled');
    expect(replay).not.toBeDisabled();
  });

  it('R3: a failed reset toasts once, keeps the diagnostic shape, and releases the latch', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.resetTutorial as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    renderProfile();
    const replay = await screen.findByRole('button', { name: 'Replay Tutorial' });
    fireEvent.click(replay);

    await waitFor(() => expect(toastMock().error).toHaveBeenCalledTimes(1));
    expect(toastMock().error).toHaveBeenCalledWith(RESET_FAILED);
    expect(loggerMock().info).toHaveBeenCalledWith('Error replaying tutorial:', expect.any(Object));
    await waitFor(() => expect(replay.textContent).toBe('Replay Tutorial'));
    expect(replay).not.toHaveAttribute('aria-disabled');

    fireEvent.click(replay);
    expect(usersAPI.resetTutorial).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(toastMock().error).toHaveBeenCalledTimes(2));
  });

  it('R4: while the tour is open Replay is aria-disabled and a press sends no second reset', async () => {
    const { usersAPI } = await import('@/lib/api');
    const { rerender } = renderProfile();
    const replay = await screen.findByRole('button', { name: 'Replay Tutorial' });
    fireEvent.click(replay);
    await waitFor(() => expect(h.replayTutorial).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replay.textContent).toBe('Replay Tutorial'));

    // The tour opened: Replay still holds focus under its scrim (no focus handling in the
    // overlay until the v2.1 rewrite, D-49).
    h.showTutorial = true;
    rerender(<Profile />);

    expect(replay).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(replay);
    expect(usersAPI.resetTutorial).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Delta review 2026-08-06 — consumer-wiring pins (the mechanisms were tested,
// the wiring was not; removing one prop/gate silently restored the defects)
// ===========================================================================
describe('delta-review consumer pins', () => {
  it('bare Enter in the just-focused timezone picker commits NOTHING (selectFirstOnEnter wiring)', async () => {
    renderProfile();
    const tz = await screen.findByRole('combobox', { name: 'Timezone' });

    fireEvent.focus(tz); // opens the picker over the full IANA list, search cleared
    await waitFor(() => expect(tz).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.keyDown(tz, { key: 'Enter' });

    // Without the opt-out prop this commits the alphabetized list's first zone
    // ("Africa/Abidjan") — MED#2's exact defect. The hoisted provider spy is the
    // commit observable; the picker also stays open because nothing selected.
    expect(h.setTimezone).not.toHaveBeenCalled();
    expect(tz).toHaveAttribute('aria-expanded', 'true');
  });

  it('recurring schedule: end-before-start is gated client-side with the actionable toast', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.change(screen.getByLabelText('Available From (Start Time)'), {
      target: { value: '17:00' },
    });
    fireEvent.change(screen.getByLabelText('Available Until (End Time)'), {
      target: { value: '09:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));

    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith('Start time must be before end time.')
    );
    expect(availabilityAPI.createRecurringPattern).not.toHaveBeenCalled();
  });

  it('specific override: end-before-start is gated client-side with the actionable toast', async () => {
    const user = userEvent.setup();
    const { availabilityAPI } = await import('@/lib/api');
    renderProfile();

    (await screen.findByRole('tab', { name: 'Specific Dates' })).focus();
    await user.keyboard('{Enter}');
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Override' }));
    fireEvent.change(screen.getByLabelText('Available From (Start Time)'), {
      target: { value: '17:00' },
    });
    fireEvent.change(screen.getByLabelText('Available Until (End Time)'), {
      target: { value: '09:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Override' }));

    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith('Start time must be before end time.')
    );
    expect(availabilityAPI.createOverride).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 88-33 Task 7 (WI-F7) — truthful loading/empty states on this page.
// ---------------------------------------------------------------------------

describe('userProfile collection loading/empty truthfulness (WI-F7)', () => {
  it('never renders "(0)" while the owned-games fetch is pending (UAT row 272)', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}) // never resolves — pins the mid-fetch state
    );
    renderProfile();
    const heading = await screen.findByRole('heading', { name: /My Game Collection/ });
    expect(heading.textContent).toContain('—'); // the em-dash placeholder
    expect(heading.textContent).not.toContain('(0)');
  });

  it('collection + schedules empties ride the D2 mini-formula (muted + sm, no "!")', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    // Re-set explicitly: the pending-promise implementation from the previous
    // test persists across vi.clearAllMocks() (it clears calls, not impls).
    (userGamesAPI.getOwnedGames as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderProfile(); // no patterns

    const collectionEmpty = await screen.findByText(
      /You don't have any games in your collection yet/
    );
    expect(collectionEmpty.className).toContain('text-content-muted');
    expect(collectionEmpty.className).toContain('text-sm');
    expect(collectionEmpty.textContent).not.toContain('!');

    const schedulesEmpty = await screen.findByText('No schedules set. Add one to get started.');
    expect(schedulesEmpty.className).toContain('text-content-muted');
    expect(schedulesEmpty.className).toContain('text-sm');

    // ...and once the fetch has resolved, the REAL count renders.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'My Game Collection (0)' })
      ).toBeInTheDocument()
    );
  });
});

// 88-33 Task 9 (fork 1, UAT row 590): pattern times print 12-hour.
describe('pattern times print 12-hour (fork 1)', () => {
  it('renders an HH:MM pattern range as 12-hour, never raw 24h', async () => {
    h.patterns = PATTERNS;
    renderProfile();
    await screen.findByRole('button', { name: 'Delete Monday schedule' });
    expect(document.body.textContent).toContain('6:00 PM - 10:00 PM');
    expect(document.body.textContent).not.toContain('18:00');
  });
});

// 88.6.1-48 (D-21 / D-44, AC-19): the seven Days-of-Week buttons are PRESSED toggles; All / Clear
// beside them is an ACTION and carries no pressed state. The floor is pinned here on the class
// tokens (jsdom has no layout); the geometry is measured at 375px in e2e/touch-targets.spec.ts and
// the classes are also source-pinned in controlSizeFloor.test.tsx.
describe('Days of Week toggles (88.6.1-48: D-21 / D-44, AC-19)', () => {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function openDaysGroup() {
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    return screen.getByRole('group', { name: 'Days of Week' });
  }

  it('D1: each day reports its pressed state, and a press flips it both ways', async () => {
    const group = await openDaysGroup();
    for (const name of DAY_NAMES) {
      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    const mon = within(group).getByRole('button', { name: 'Mon' });
    fireEvent.click(mon);
    expect(within(group).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(group).getByRole('button', { name: 'Mon' }));
    expect(within(group).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('D2: All / Clear is an action with no pressed state, and it sets or clears all seven', async () => {
    const group = await openDaysGroup();
    const allButton = within(group).getByRole('button', { name: 'All' });
    expect(allButton).not.toHaveAttribute('aria-pressed');
    fireEvent.click(allButton);
    for (const name of DAY_NAMES) {
      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
    // The SAME node now reads Clear: the label carries what the next press will do.
    const clearButton = within(group).getByRole('button', { name: 'Clear' });
    expect(clearButton).toBe(allButton);
    expect(clearButton).not.toHaveAttribute('aria-pressed');
    fireEvent.click(clearButton);
    for (const name of DAY_NAMES) {
      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('D3: the phone floor sits in the static classes, so pressed, unpressed and All / Clear all carry it', async () => {
    const group = await openDaysGroup();
    fireEvent.click(within(group).getByRole('button', { name: 'Mon' }));
    const pressed = within(group).getByRole('button', { name: 'Mon' });
    const unpressed = within(group).getByRole('button', { name: 'Tue' });
    const allClear = within(group).getByRole('button', { name: 'All' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    for (const el of [pressed, unpressed, allClear]) {
      const tokens = el.className.split(/\s+/);
      for (const cls of ['min-h-11', 'md:min-h-0', 'min-w-11', 'md:min-w-0']) {
        expect(tokens, `${el.textContent} is missing ${cls}`).toContain(cls);
      }
    }
  });
});

// 88.6.1-53 (W065, AC-22, plus the seven controls ST-7 found): every Profile form control carries
// an id AND a name, because browser autofill reads id, name and autocomplete, never ARIA (the
// house rule, src/components/ui/Input.tsx HOUSE RULE). The SMS code field offers the texted code
// and the number pad; the phone field offers the saved number; the Username field is the public
// display name, so it is marked nickname, never username (review #216).
describe('form controls carry id + name (88.6.1-53: W065, AC-22)', () => {
  function expectIdEqualsName(id: string) {
    const el = document.getElementById(id);
    expect(el, `#${id} is not rendered`).not.toBeNull();
    expect(el?.getAttribute('name'), `#${id} has no matching name`).toBe(id);
  }

  it('A1: the default tab, with the username editor, the SMS phone field, the schedule form and the BGG search open, passes the audit', async () => {
    const user = userEvent.setup();
    renderProfile({ sms_enabled: true, phone_verified: false });
    await openDefaultTabControls(user);

    auditFormControls(document.body);
    for (const id of [
      'profile-username',
      'profile-phone',
      'recurring-start-time',
      'recurring-end-time',
      'recurring-start-date',
      'recurring-end-date',
      'bgg-search',
    ]) {
      expectIdEqualsName(id);
    }
    expect(document.getElementById('profile-phone')).toHaveAttribute('autocomplete', 'tel');
    expect(document.getElementById('profile-username')).toHaveAttribute('autocomplete', 'nickname');

    // No two rendered controls share an id.
    const ids = Array.from(document.body.querySelectorAll('input, select, textarea')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('A2: the code-entry step offers the texted code on a number pad and passes the audit', async () => {
    await reachArmedVerify();
    const code = screen.getByRole('textbox', { name: 'Verification code' });
    expect(code.id).toBe('profile-verification-code');
    expect(code).toHaveAttribute('name', 'profile-verification-code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    auditFormControls(document.body);
  });

  it('A3: the Specific Dates form passes the audit, and its checkbox stays native', async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole('tab', { name: 'Specific Dates' }));
    await user.click(await screen.findByRole('button', { name: '+ Add Override' }));

    auditFormControls(document.body);
    for (const id of ['specific-date', 'specific-start-time', 'specific-end-time', 'specific-is-available']) {
      expectIdEqualsName(id);
    }
    const checkbox = document.getElementById('specific-is-available');
    expect(checkbox).toBeInstanceOf(HTMLInputElement);
    expect((checkbox as HTMLInputElement).type).toBe('checkbox');
  });
});

// 88.6.1-53 (D-46 / R7-M7, AC-23): the Profile breadcrumb reaches the house standard the other
// four breadcrumbs reached — the Home link carries the house focus ring, the separator is
// hidden from screen readers, and the nav carries min-w-0.
describe('breadcrumb ring and separator (88.6.1-53: D-46 / R7-M7)', () => {
  it('B1: the separator is aria-hidden and the nav carries min-w-0 beside its overflow tokens', async () => {
    renderProfile();
    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('>')).toHaveAttribute('aria-hidden', 'true');
    const tokens = nav.className.split(/\s+/);
    for (const cls of ['min-w-0', 'inline-block', 'max-w-full', 'wrap-break-word']) {
      expect(tokens, `the nav is missing ${cls}`).toContain(cls);
    }
  });

  it('B2: the Home link carries the house outset focus ring', async () => {
    // Read from source: the next/link mock renders children only, so the Home link has no
    // element of its own in jsdom.
    const src = await pageSource();
    const start = src.indexOf('aria-label="Breadcrumb"');
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start, src.indexOf('</nav>', start));
    expect(slice.length).toBeGreaterThan(0);
    expect(slice.split('<Link href="/"').length - 1).toBe(1);
    const linkAt = slice.indexOf('<Link href="/"');
    const tag = slice.slice(linkAt, slice.indexOf('>', linkAt));
    for (const cls of ['focus:outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-focus-ring', 'focus-visible:ring-offset-2']) {
      expect(tag, `the Home link is missing ${cls}`).toContain(cls);
    }
  });
});

// 88.6.1-53 (Req 5, Req 4, D-42, D-22): the phone block. Change number (two rows), the second tap on
// Remove and the SMS banner's Dismiss each remove the control the person pressed, so focus used to
// fall to <body>; each now lands on a real target through plan 18's shared phoneVerifyRecovery.
// A verify answer that arrives after Change number no longer undoes it (review 61), and never
// writes an old number as verified over a newer save (review M-32). Remove refuses a tap while its
// removal is in flight. The polite format hint is the house always-mounted region.
// jsdom never blurs a disabled element (C-11): the RED half of the Remove latch is the attribute
// and the request count; the focus claims are proven again in e2e/profile-pressed-controls.spec.ts.
describe('phone block focus, Remove in flight, format region (88.6.1-53: Req 5, Req 4, D-42, D-22)', () => {
  const VALID = '+1 415 555 2671';
  const NEWER = '+1 415 555 0199';
  const BANNER = 'SMS disabled — add a phone number to re-enable.';
  const REMOVE_FAILED = "We couldn't remove your number. Please try again.";
  const REMOVED_USER = { sms_enabled: true, phone: null, phone_verified: false, notification_preferences: DEFAULT_PREFS };

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  // Each case sets its own implementations; restore the defaults so a held one never leaks into a
  // later suite (vi.clearAllMocks keeps implementations).
  afterEach(async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (usersAPI.savePhone as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (usersAPI.removePhone as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('C1: Change number in the code-entry row lands focus on the Phone number field, never <body>', async () => {
    const user = userEvent.setup();
    await reachArmedVerify();
    await user.click(screen.getByRole('button', { name: 'Change number' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Phone number' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('C2: Change number in the verified row lands focus on the Phone number field, which holds the number', async () => {
    const user = userEvent.setup();
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });
    await user.click(await screen.findByRole('button', { name: 'Change number' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Phone number' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue(VALID);
  });

  it('C3: a verify answer that lands after Change number does not undo it, and the server truth still lands (review 61)', async () => {
    const user = userEvent.setup();
    const { usersAPI } = await import('@/lib/api');
    const check = deferred();
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockImplementation(() => check.promise);

    const verify = await reachArmedVerify();
    await user.click(verify);
    await waitFor(() => expect(verify).toHaveAttribute('aria-disabled', 'true'));
    await user.click(screen.getByRole('button', { name: 'Change number' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Phone number' }))
    );

    await act(async () => { check.resolve({ verified: true }); });

    // POSITIVE settle first: the server did verify that number, so the SMS toggles unlock.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'New Event SMS notifications' })).not.toBeDisabled()
    );
    const field = screen.getByRole('textbox', { name: 'Phone number' });
    expect(field.isConnected).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(screen.queryByText('Phone verified')).toBeNull();
  });

  it('C4: a verify answer that lands after a NEWER number was saved writes nothing (review M-32, Edge R11 ordering)', async () => {
    const user = userEvent.setup();
    const { usersAPI } = await import('@/lib/api');
    const { patchSelfCache } = await import('@/lib/hooks/selfIdentityCache');
    const check = deferred();
    (usersAPI.verifyPhone as ReturnType<typeof vi.fn>).mockImplementation(() => check.promise);

    const verify = await reachArmedVerify();
    await user.click(verify);
    await waitFor(() => expect(verify).toHaveAttribute('aria-disabled', 'true'));
    await user.click(screen.getByRole('button', { name: 'Change number' }));
    const field = await screen.findByRole('textbox', { name: 'Phone number' });
    fireEvent.change(field, { target: { value: NEWER } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Verify' }));
    // POSITIVE: the page reached code entry for the NEW number.
    const code = await screen.findByRole('textbox', { name: 'Verification code' });
    expect(screen.getByText(/^Code sent to/)).toHaveTextContent('555 0199');

    await act(async () => { check.resolve({ verified: true }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(screen.getByRole('switch', { name: 'New Event SMS notifications' })).toBeDisabled();
    expect(screen.queryByText('Phone verified')).toBeNull();
    expect(code.isConnected).toBe(true);
    expect(patchSelfCache).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phone_verified: true })
    );
  });

  it('R1: four taps across one held removal send ONE removePhone; Remove stays aria-disabled and never re-arms', async () => {
    const { usersAPI } = await import('@/lib/api');
    const removal = deferred();
    (usersAPI.removePhone as ReturnType<typeof vi.fn>).mockImplementation(() => removal.promise);
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });

    const remove = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    // The SAME node is now armed.
    expect(remove).toHaveTextContent('Tap again to remove');
    fireEvent.click(remove);
    // POSITIVE settle on the same node.
    await waitFor(() => expect(remove).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(remove);
    fireEvent.click(remove);

    expect(usersAPI.removePhone).toHaveBeenCalledTimes(1);
    expect(remove).toHaveTextContent('Remove');
    expect(remove).not.toHaveTextContent('Tap again to remove');
    expect(remove).toHaveAttribute('aria-disabled', 'true');

    await act(async () => { removal.resolve(REMOVED_USER); });
    await screen.findByText(BANNER);
    expect(usersAPI.removePhone).toHaveBeenCalledTimes(1);
  });

  it('R2: focus stays on Remove while the removal is held, then lands on the banner statement, never <body>', async () => {
    const user = userEvent.setup();
    const { usersAPI } = await import('@/lib/api');
    const removal = deferred();
    (usersAPI.removePhone as ReturnType<typeof vi.fn>).mockImplementation(() => removal.promise);
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });

    const remove = await screen.findByRole('button', { name: 'Remove' });
    await user.click(remove);
    await user.click(remove);
    // CONFIRM-ONLY in jsdom (C-11): the held removal leaves the pressed control focused. The R5
    // ordering is proven in the phone e2e spec in a real browser.
    expect(document.activeElement).toBe(remove);

    await act(async () => { removal.resolve(REMOVED_USER); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText(BANNER)));
    expect(document.activeElement).not.toBe(document.body);
    expect(remove.isConnected).toBe(false);
  });

  it('R3: a failed removal releases the latch, keeps the diagnostic shape, and a second removal is sent', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.removePhone as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(REMOVED_USER);
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });

    const remove = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    await screen.findByText(REMOVE_FAILED);
    expect(loggerMock().info).toHaveBeenCalledWith('Error removing phone:', expect.any(Object));
    expect(remove).not.toHaveAttribute('aria-disabled');

    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(usersAPI.removePhone).toHaveBeenCalledTimes(2);
    await screen.findByText(BANNER);
  });

  it('R4: the banner Dismiss lands focus on the Phone number field it points at, never <body> (review 214)', async () => {
    const user = userEvent.setup();
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.removePhone as ReturnType<typeof vi.fn>).mockResolvedValue(REMOVED_USER);
    renderProfile({ sms_enabled: true, phone: VALID, phone_verified: true });

    const remove = await screen.findByRole('button', { name: 'Remove' });
    await user.click(remove);
    await user.click(remove);
    await screen.findByText(BANNER);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Phone number' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('F1: the format hint is one always-mounted polite region, empty and visually hidden until an error, and the same node after', async () => {
    renderProfile({ sms_enabled: true });
    const phone = await screen.findByRole('textbox', { name: 'Phone number' });
    const region = document.getElementById('phone-format-error');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region?.textContent).toBe('');
    expect(region?.className.split(/\s+/)).toContain('sr-only');

    fireEvent.change(phone, { target: { value: '1234567' } });
    // C-6: node identity, not presence.
    expect(document.getElementById('phone-format-error')).toBe(region);
    expect(region?.textContent).toBe('Invalid phone number');
    const shown = region?.className.split(/\s+/) ?? [];
    expect(shown).not.toContain('sr-only');
    for (const cls of ['text-content-status-error', 'text-xs', 'mt-1']) expect(shown).toContain(cls);
    expect(phone.getAttribute('aria-describedby') ?? '').toContain('phone-format-error');

    fireEvent.change(phone, { target: { value: VALID } });
    expect(document.getElementById('phone-format-error')).toBe(region);
    expect(region?.textContent).toBe('');
    expect(region?.className.split(/\s+/)).toContain('sr-only');
    expect(phone.getAttribute('aria-describedby') ?? '').not.toContain('phone-format-error');

    // R8 idempotency: the same error a second time re-sets the SAME node's text.
    fireEvent.change(phone, { target: { value: '1234567' } });
    expect(document.getElementById('phone-format-error')).toBe(region);
    expect(region?.textContent).toBe('Invalid phone number');
  });

  it('D1: the phone error alert stays conditionally mounted, and its DECISION marker reads true under D-42', async () => {
    const src = await pageSource();
    expect(src).toContain('DECISION Phase 88-25 (DEF-88-19-04)');
    expect(src).toContain('AMENDED Phase 88.6.1-53 (D-42');
    expect(src).not.toContain('that would make it polite');

    renderProfile({ sms_enabled: true });
    await screen.findByRole('textbox', { name: 'Phone number' });
    expect(document.getElementById('phone-flow-error')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 88.6.1-59 Task 1 (D-35, Req 4, Req 5; D-44, Req 6): Save Schedule and Save Override are
// PRESSED controls. While a save runs each keeps its node, reads Saving..., carries
// aria-disabled (never native disabled) and refuses every further press through one shared
// first-line latch; a success closes the form and focus lands on the form's own toggle. The two
// toggles are disclosures: aria-expanded always, aria-controls only while the form exists.
describe('availability Save in flight (88.6.1-59: D-35, Req 4, Req 5)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  // The Specific Dates tab, reached the way the end-before-start case reaches it.
  async function openSpecificDates(user: ReturnType<typeof userEvent.setup>) {
    (await screen.findByRole('tab', { name: 'Specific Dates' })).focus();
    await user.keyboard('{Enter}');
  }

  // Each case sets its own implementation; vi.clearAllMocks keeps implementations, so a held one
  // would leak into a later suite (the implementation-persistence trap).
  afterEach(async () => {
    const { availabilityAPI } = await import('@/lib/api');
    (availabilityAPI.createRecurringPattern as Mock).mockResolvedValue({});
    (availabilityAPI.createOverride as Mock).mockResolvedValue({});
  });

  it('S1: Save Schedule keeps its node, reads Saving... under aria-disabled, and three presses send one request', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    const pending = deferred();
    (availabilityAPI.createRecurringPattern as Mock).mockReturnValue(pending.promise);
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    const save = screen.getByRole('button', { name: 'Save Schedule' });
    fireEvent.click(save);

    // Positive signal on the SAME node.
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(save).not.toBeDisabled();
    expect(save.isConnected).toBe(true);
    expect(save.textContent).toBe('Saving...');

    fireEvent.click(save);
    fireEvent.click(save);
    expect(availabilityAPI.createRecurringPattern).toHaveBeenCalledTimes(1);
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save.textContent).toBe('Saving...');

    await act(async () => { pending.resolve({}); });
  });

  it('S2: Save Override keeps its node, reads Saving... under aria-disabled, and three presses send one request', async () => {
    const user = userEvent.setup();
    const { availabilityAPI } = await import('@/lib/api');
    const pending = deferred();
    (availabilityAPI.createOverride as Mock).mockReturnValue(pending.promise);
    renderProfile();

    await openSpecificDates(user);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Override' }));
    const save = screen.getByRole('button', { name: 'Save Override' });
    fireEvent.click(save);

    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(save).not.toBeDisabled();
    expect(save.isConnected).toBe(true);
    expect(save.textContent).toBe('Saving...');

    fireEvent.click(save);
    fireEvent.click(save);
    expect(availabilityAPI.createOverride).toHaveBeenCalledTimes(1);
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save.textContent).toBe('Saving...');

    await act(async () => { pending.resolve({}); });
  });

  it('S3: a successful Save Schedule closes the form and focus lands on + Add Schedule, after the removal', async () => {
    const user = userEvent.setup();
    const { availabilityAPI } = await import('@/lib/api');
    const pending = deferred();
    (availabilityAPI.createRecurringPattern as Mock).mockReturnValue(pending.promise);
    renderProfile();

    await user.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Mon' }));
    const save = screen.getByRole('button', { name: 'Save Schedule' });
    await user.click(save);
    // CONFIRM-ONLY in jsdom (jsdom never blurs a disabled element, C-11): the pressed control
    // still holds focus while the create is held. The real-browser proof is the phone e2e arm.
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(document.activeElement).toBe(save);

    await act(async () => { pending.resolve({}); });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add Schedule' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(save.isConnected).toBe(false);
  });

  it('S4: a successful Save Override closes the form and focus lands on + Add Override', async () => {
    const user = userEvent.setup();
    const { availabilityAPI } = await import('@/lib/api');
    const pending = deferred();
    (availabilityAPI.createOverride as Mock).mockReturnValue(pending.promise);
    renderProfile();

    await openSpecificDates(user);
    await user.click(await screen.findByRole('button', { name: '+ Add Override' }));
    const save = screen.getByRole('button', { name: 'Save Override' });
    await user.click(save);
    // CONFIRM-ONLY in jsdom (C-11), as in S3.
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(document.activeElement).toBe(save);

    await act(async () => { pending.resolve({}); });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add Override' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('S5: a failed Save Schedule releases the latch, keeps the form, and logs the unchanged diagnostic', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    (availabilityAPI.createRecurringPattern as Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({});
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));

    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith("We couldn't save that schedule. Please try again.")
    );
    expect(loggerMock().info).toHaveBeenCalledWith('Error creating schedule:', expect.any(Object));
    const save = await screen.findByRole('button', { name: 'Save Schedule' });
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(save).not.toBeDisabled();
    expect(screen.getByRole('heading', { name: 'New Schedule' })).toBeInTheDocument();

    fireEvent.click(save);
    await waitFor(() => expect(availabilityAPI.createRecurringPattern).toHaveBeenCalledTimes(2));
  });

  it('S6: the availability recovery is wired to the heading fallback and both toggles (R5 empty)', async () => {
    const source = await pageSource();
    expect(source).toContain('useFocusRecovery({ fallback: availabilityHeadingRef })');
    expect(source).toContain('ref={availabilityHeadingRef}');
    expect(source).toContain('ref={addScheduleToggleRef}');
    expect(source).toContain('ref={addOverrideToggleRef}');
  });

  it('S7: + Add Schedule is a disclosure, aria-controls only while its form exists (D-44)', async () => {
    renderProfile();
    const toggle = await screen.findByRole('button', { name: '+ Add Schedule' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.textContent).toBe('Cancel'));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole('heading', { name: 'New Schedule' })).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.textContent).toBe('+ Add Schedule'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
  });

  it('S8: + Add Override is a disclosure, aria-controls only while its form exists (D-44)', async () => {
    const user = userEvent.setup();
    renderProfile();
    await openSpecificDates(user);
    const toggle = await screen.findByRole('button', { name: '+ Add Override' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.textContent).toBe('Cancel'));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(
      within(panel as HTMLElement).getByRole('heading', { name: 'New Specific Override' })
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.textContent).toBe('+ Add Override'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
  });
});

// ---------------------------------------------------------------------------
// 88.6.1-59 Task 2 (Req 11, AC-29 / RF1, Req 5): what the availability lists show after a
// write. A multi-day save that fails part-way drops the days it saved from the selection and
// re-reads the list; a failed refresh keeps the rows under plan 70's notice (the full banner only
// when nothing is retained, or on an access answer); focus never falls to the body when a row,
// the notice or the rows leave; a row Delete lands on the panel's toggle.
describe('availability lists after a write (88.6.1-59: Req 11, AC-29 / RF1, Req 5)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  // Copy row RF1 (D-47), written ONCE here (contract C7). The notice renders it twice while it
  // shows (the visible line and its polite region), so every query is an All query. A notice
  // mounted mid-failure fills its region only after plan 70's dwell (quietOnMount), so the
  // two-carrier count is waited for, never read on the first find.
  const RF1 = "Couldn't refresh. Showing what loaded earlier.";
  const OVERRIDE = {
    id: 'override-1',
    type: 'specific_override',
    is_available: true,
    pattern_data: { date: '2026-11-03', startTime: '18:00', endTime: '22:00' },
  };

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  async function openSpecificDates(user: ReturnType<typeof userEvent.setup>) {
    (await screen.findByRole('tab', { name: 'Specific Dates' })).focus();
    await user.keyboard('{Enter}');
  }

  // The unpressed re-attempt: a tab return, the useFetchErrorState.test.tsx idiom.
  function fireVisible() {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  // The mocked useQuery reads `h` on render, so a changed query state commits only on a render.
  async function rerenderPage(rerender: (ui: React.ReactElement) => void) {
    await act(async () => { rerender(<Profile />); });
  }

  const schedulesHeading = () => screen.getByRole('heading', { name: 'Availability Schedules' });

  afterEach(async () => {
    const { availabilityAPI } = await import('@/lib/api');
    h.refetchPatterns.mockReset();
    (availabilityAPI.createRecurringPattern as Mock).mockResolvedValue({});
    (availabilityAPI.deleteAvailability as Mock).mockResolvedValue({});
  });

  it('M1: a multi-day save that fails on Tuesday re-reads the list, drops Monday, and the retry never re-sends Monday', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    let failedOnce = false;
    (availabilityAPI.createRecurringPattern as Mock).mockImplementation(
      async (_id: string, formData: { dayOfWeek: number }) => {
        if (formData.dayOfWeek === 2 && !failedOnce) {
          failedOnce = true;
          throw new Error('boom');
        }
        return {};
      }
    );
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    const mon = screen.getByRole('button', { name: 'Mon' });
    fireEvent.click(mon);
    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));

    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith("We couldn't save that schedule. Please try again.")
    );
    await waitFor(() => expect(mon).toHaveAttribute('aria-pressed', 'false'));
    expect(h.refetchPatterns).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'true');
    const save = await screen.findByRole('button', { name: 'Save Schedule' });
    await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(save);
    await waitFor(() => expect(availabilityAPI.createRecurringPattern).toHaveBeenCalledTimes(4));
    const sent = (availabilityAPI.createRecurringPattern as Mock).mock.calls.map(
      (call) => (call[1] as { dayOfWeek: number }).dayOfWeek
    );
    expect(sent).toEqual([1, 2, 2, 3]);
  });

  it('M2: a failure with nothing confirmed still re-reads the list and keeps the whole selection', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    (availabilityAPI.createRecurringPattern as Mock).mockRejectedValueOnce(
      new ApiError('Gateway timeout', 'internal', 504)
    );
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));

    await waitFor(() => expect(toastMock().error).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Schedule' })).not.toHaveAttribute('aria-disabled')
    );
    expect(h.refetchPatterns).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('P1: a failed refresh keeps the schedules under RF1, in a status region that was already there', async () => {
    h.patterns = PATTERNS;
    const { rerender } = renderProfile();
    await screen.findByRole('button', { name: 'Delete Monday schedule' });
    const before = screen.getAllByRole('status');

    h.patternsError = new Error('boom');
    rerender(<Profile />);

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Delete Monday schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Tuesday schedule' })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your schedules")).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    const region = screen.getAllByRole('status').find((node) => node.textContent === RF1);
    expect(region).toBeDefined();
    // Contract C8 b: the region pre-existed (node identity, C-6).
    expect(before).toContain(region);
  });

  it('P2: a list that loaded empty keeps its empty sentence, with RF1 above it (D-50)', async () => {
    h.patterns = [];
    h.patternsError = new Error('boom');
    renderProfile();

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const sentence = screen.getByText('No schedules set. Add one to get started.');
    const row = screen.getByRole('button', { name: 'Retry' }).parentElement as HTMLElement;
    expect(row.textContent).toContain(RF1);
    expect(row.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Couldn't load your schedules")).toBeNull();
  });

  it('P3: a failed load with nothing retained shows only the full banner, never an empty sentence or RF1', async () => {
    h.patterns = undefined;
    h.patternsError = new Error('boom');
    renderProfile();

    // CONFIRM-ONLY against the pre-task page: it pins that the nothing-retained arm survives.
    await screen.findByText("Couldn't load your schedules");
    expect(screen.queryByText('No schedules set. Add one to get started.')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('P4: a failed refresh keeps the overrides under RF1 on the Specific Dates tab', async () => {
    const user = userEvent.setup();
    h.patterns = [OVERRIDE];
    h.patternsError = new Error('boom');
    renderProfile();
    await openSpecificDates(user);

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('button', { name: /^Delete .+ override$/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your overrides")).toBeNull();
  });

  it('P5: a successful Retry removes the notice and lands focus on the Availability Schedules heading', async () => {
    const user = userEvent.setup();
    h.patterns = PATTERNS;
    h.patternsError = new Error('boom');
    h.refetchPatterns.mockImplementation(async () => {
      h.patternsError = null;
      return { isError: false };
    });
    const { rerender } = renderProfile();

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await rerenderPage(rerender);

    await waitFor(() => expect(document.activeElement).toBe(schedulesHeading()));
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Delete Monday schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Tuesday schedule' })).toBeInTheDocument();
  });

  it('P6: a 401 or 403 over the kept schedules withdraws them for the full banner and its register line', async () => {
    // CONFIRM-ONLY against the pre-task page (its exclusive banner shows exactly this); RED
    // against a plant that hands the rows' presence to the notice without the retention hook.
    for (const error of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      h.patterns = PATTERNS;
      h.patternsError = error;
      renderProfile();
      await screen.findByText("Couldn't load your schedules");
      expect(screen.getByText(getFetchErrorMessage(error))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete Monday schedule' })).toBeNull();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      cleanup();
    }
  });

  it('P7: a first-load Try again that succeeds lands focus on the Availability Schedules heading', async () => {
    const user = userEvent.setup();
    h.patterns = undefined;
    h.patternsError = new Error('boom');
    h.refetchPatterns.mockImplementation(async () => {
      h.patternsError = null;
      h.patterns = PATTERNS;
      return { isError: false };
    });
    const { rerender } = renderProfile();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await rerenderPage(rerender);

    await waitFor(() => expect(document.activeElement).toBe(schedulesHeading()));
    expect(document.activeElement).not.toBe(document.body);
  });

  // Wave 7 CI gate (2026-10-17, run 39020174955): the PRESS half of P7, where a real browser takes
  // it. A never-loaded TanStack query reports `pending` at the press, so the page swaps the full
  // banner for its loading line while Try again holds focus, and focus moves THEN (P7's success
  // rerender finds it already moved). DECISION Phase 88.6.1-59 (AC-29 / RF1, D-05) and DECISION
  // Phase 88.6.1-70 (Req 5, focusTarget) send it to the panel's level-3 heading before plan 21's
  // floor; e2e/error-recovery-floor.spec.ts test 1 and e2e/report-form-survives-recovery.spec.ts
  // follow this record.
  it('P7b: a first-load Try again lands focus on the Availability Schedules heading at the press, not the page h1', async () => {
    const user = userEvent.setup();
    h.patterns = undefined;
    h.patternsError = new Error('boom');
    let release: () => void = () => {};
    h.refetchPatterns.mockImplementation(
      () =>
        new Promise((resolve) => {
          h.patternsError = null;
          h.patternsPending = true;
          release = () => {
            h.patternsPending = false;
            h.patterns = [];
            resolve({ isError: false });
          };
        })
    );
    const { rerender } = renderProfile();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await rerenderPage(rerender);

    expect(screen.getByText('Loading schedules...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(schedulesHeading()));
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));

    await act(async () => { release(); });
    await rerenderPage(rerender);
    expect(screen.queryByText('Loading schedules...')).toBeNull();
    expect(document.activeElement).toBe(schedulesHeading());
  });

  it('P8: a 500 or a network failure over the kept schedules shows RF1 above them', async () => {
    for (const error of [
      new ApiError('Server error', 'internal', 500),
      new ApiError('Network error', 'network', 0),
    ]) {
      h.patterns = PATTERNS;
      h.patternsError = error;
      renderProfile();
      await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
      expect(screen.getByRole('button', { name: 'Delete Monday schedule' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Tuesday schedule' })).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load your schedules")).toBeNull();
      cleanup();
    }
  });

  it('P9: an unpressed re-attempt answered 403 or 401 withdraws the rows while a Delete holds focus, and focus lands on the heading', async () => {
    for (const answer of [
      new ApiError('Forbidden', 'forbidden', 403),
      new ApiError('Unauthorized', 'unauthorized', 401),
    ]) {
      h.patterns = PATTERNS;
      h.patternsError = new Error('boom');
      const { rerender } = renderProfile();
      await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
      act(() => screen.getByRole('button', { name: 'Delete Monday schedule' }).focus());
      h.refetchPatterns.mockImplementation(async () => {
        h.patternsError = answer;
        return { isError: true };
      });

      await act(async () => { fireVisible(); });
      await rerenderPage(rerender);

      await screen.findByText("Couldn't load your schedules");
      expect(screen.queryByRole('button', { name: 'Delete Monday schedule' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(schedulesHeading()));
      expect(document.activeElement).not.toBe(document.body);
      cleanup();
      h.refetchPatterns.mockReset();
    }
  });

  it('P10: an unpressed re-attempt that succeeds while Retry holds focus lands on the heading', async () => {
    h.patterns = PATTERNS;
    h.patternsError = new Error('boom');
    const { rerender } = renderProfile();
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    act(() => screen.getByRole('button', { name: 'Retry' }).focus());
    h.refetchPatterns.mockImplementation(async () => {
      h.patternsError = null;
      return { isError: false };
    });

    await act(async () => { fireVisible(); });
    await rerenderPage(rerender);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Delete Monday schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Tuesday schedule' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(schedulesHeading()));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('P11: an access answer is remembered across a remount over the cached query (C10 memory with the cache entry)', async () => {
    // This suite mocks useQuery, so there is no real cache. A fake QueryClientContext stands in
    // for the one property a real cache gives: the SAME entry object for the patterns key on both
    // sides of an unmount. Every other key finds nothing (the hook's instance memory serves).
    const fakeClient = {
      getQueryCache: () => ({
        find: (filters: { queryKey?: unknown }) =>
          JSON.stringify(filters?.queryKey) ===
          JSON.stringify(availabilityKeys.patterns(h.self?.id as string | undefined))
            ? h.patternsEntry
            : undefined,
      }),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientContext.Provider value={fakeClient as never}>{children}</QueryClientContext.Provider>
    );
    // CONFIRM-ONLY against Task 1's page (its exclusive banner shows on every error); RED against
    // the two-argument hook call.
    h.patterns = PATTERNS;
    const first = renderProfile({}, { wrapper });
    await screen.findByRole('button', { name: 'Delete Monday schedule' });

    h.patternsError = new ApiError('Forbidden', 'forbidden', 403);
    await rerenderPage(first.rerender);
    await screen.findByText("Couldn't load your schedules");

    h.patternsError = new ApiError('Server error', 'internal', 500);
    await rerenderPage(first.rerender);
    expect(screen.getByText("Couldn't load your schedules")).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    first.unmount();
    const second = renderProfile({}, { wrapper });
    await screen.findByText("Couldn't load your schedules");
    expect(screen.queryByRole('button', { name: 'Delete Monday schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Tuesday schedule' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    h.patternsError = null;
    await rerenderPage(second.rerender);
    expect(await screen.findByRole('button', { name: 'Delete Monday schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Tuesday schedule' })).toBeInTheDocument();
  });

  it('D1: deleting a schedule lands focus on + Add Schedule after the row leaves', async () => {
    const user = userEvent.setup();
    const { availabilityAPI } = await import('@/lib/api');
    h.patterns = PATTERNS;
    const pending = deferred();
    (availabilityAPI.deleteAvailability as Mock).mockReturnValue(pending.promise);
    h.refetchPatterns.mockImplementation(async () => {
      h.patterns = [PATTERNS[1]];
      return { isError: false };
    });
    renderProfile();

    const del = await screen.findByRole('button', { name: 'Delete Monday schedule' });
    await user.click(del);
    await user.click(del);
    // CONFIRM-ONLY in jsdom (C-11): the committed Delete still holds focus while it is held.
    await waitFor(() => expect(availabilityAPI.deleteAvailability).toHaveBeenCalledWith('pattern-mon'));
    expect(document.activeElement).toBe(del);

    await act(async () => { pending.resolve({}); });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add Schedule' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole('button', { name: 'Delete Monday schedule' })).toBeNull();
  });

  it('D2: deleting an override lands focus on + Add Override', async () => {
    const user = userEvent.setup();
    h.patterns = [OVERRIDE];
    h.refetchPatterns.mockImplementation(async () => {
      h.patterns = [];
      return { isError: false };
    });
    renderProfile();
    await openSpecificDates(user);

    const del = await screen.findByRole('button', { name: /^Delete .+ override$/ });
    await user.click(del);
    await user.click(del);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add Override' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });
});

// ---------------------------------------------------------------------------
// 88.6.1-59 Task 3 (D-35, Req 4, Req 5): the username editor's Save is a PRESSED control (its
// in-flight half aria-disabled plus a first-line latch; its blank-name half stays native), its
// Cancel is a sibling that stays natively disabled while saving, and both exits land focus on the
// Edit-username pencil that opened the editor.
describe('username Save in flight (88.6.1-59: D-35, Req 4, Req 5)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  // Scoped to the editor's button row: the Email section renders its own Cancel while its editor
  // is open.
  function editorCancel(save: HTMLElement) {
    return within(save.parentElement as HTMLElement).getByRole('button', { name: 'Cancel' });
  }

  afterEach(async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.updateUsername as Mock).mockResolvedValue({ username: 'Self' });
  });

  it('U1: Save keeps its node, reads Saving... under aria-disabled, Cancel stays native, three presses send one request', async () => {
    const { usersAPI } = await import('@/lib/api');
    const pending = deferred();
    (usersAPI.updateUsername as Mock).mockReturnValue(pending.promise);
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit username' }));
    const save = screen.getByRole('button', { name: 'Save' });
    const cancel = editorCancel(save);
    fireEvent.click(save);

    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(save).not.toBeDisabled();
    expect(save.textContent).toBe('Saving...');
    expect(cancel).toBeDisabled();

    fireEvent.click(save);
    fireEvent.click(save);
    expect(usersAPI.updateUsername).toHaveBeenCalledTimes(1);
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save.textContent).toBe('Saving...');

    await act(async () => { pending.resolve({ username: 'Self' }); });
  });

  it('U2: a blank username keeps Save natively disabled, with no aria-disabled (rule of KIND)', async () => {
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit username' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), { target: { value: '   ' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).not.toHaveAttribute('aria-disabled');
  });

  it('U3: a successful Save closes the editor and focus lands on the Edit-username pencil, after the removal', async () => {
    const user = userEvent.setup();
    const { usersAPI } = await import('@/lib/api');
    const pending = deferred();
    (usersAPI.updateUsername as Mock).mockReturnValue(pending.promise);
    renderProfile();

    await user.click(await screen.findByRole('button', { name: 'Edit username' }));
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    // CONFIRM-ONLY in jsdom (C-11): the pressed Save still holds focus while the save is held.
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'));
    expect(document.activeElement).toBe(save);

    await act(async () => { pending.resolve({ username: 'Self' }); });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit username' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(save.isConnected).toBe(false);
  });

  it('U4: Cancel closes the editor and focus lands on the Edit-username pencil', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(await screen.findByRole('button', { name: 'Edit username' }));
    const cancel = editorCancel(screen.getByRole('button', { name: 'Save' }));
    await user.click(cancel);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit username' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('U5: a failed Save releases the latch, keeps the editor, and logs the unchanged diagnostic', async () => {
    const { usersAPI } = await import('@/lib/api');
    (usersAPI.updateUsername as Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ username: 'Self' });
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit username' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith("We couldn't save your username. Please try again.")
    );
    expect(loggerMock().info).toHaveBeenCalledWith('Error updating username:', expect.any(Object));
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save.textContent).toBe('Save');
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('textbox', { name: 'Username' })).toBeInTheDocument();

    fireEvent.click(save);
    await waitFor(() => expect(usersAPI.updateUsername).toHaveBeenCalledTimes(2));
  });

  it('U6: the username recovery is wired to the pencil, the h1 fallback, and both exits (R5 empty)', async () => {
    const source = await pageSource();
    expect(source).toContain('const usernameRecovery = useFocusRecovery({ fallback: profileHeadingRef });');
    expect(source).toContain('ref={editUsernamePencilRef}');
    expect(source.split('usernameRecovery.arm({ preferred: () => editUsernamePencilRef.current').length - 1).toBe(2);
  });
});

describe('BGG import in flight (88.6.1-60: D-35, Req 4, Req 5)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  afterEach(async () => {
    const { userGamesAPI } = await import('@/lib/api');
    // The persistence trap: clearAllMocks keeps an implementation, so restore the default here.
    (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 0 });
  });

  it('I1: Import Collection keeps its node, reads Importing... under aria-disabled, and three presses neither reopen the dialog nor send a second import', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    const pending = deferred();
    (userGamesAPI.importBGGCollection as Mock).mockReturnValue(pending.promise);
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    const importBtn = screen.getByRole('button', { name: 'Import Collection' });
    fireEvent.click(importBtn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(importBtn).toHaveAttribute('aria-disabled', 'true'));
    expect(importBtn).not.toBeDisabled();
    expect(importBtn.isConnected).toBe(true);
    expect(importBtn.textContent).toBe('Importing...');

    // The click handler commits inside act, so a reopened dialog would already be in the document.
    fireEvent.click(importBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(importBtn);
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(userGamesAPI.importBGGCollection).toHaveBeenCalledTimes(1);
    expect(importBtn).toHaveAttribute('aria-disabled', 'true');
    expect(importBtn.textContent).toBe('Importing...');

    await act(async () => { pending.resolve({ imported: 0 }); });
  });

  it('I2: a second Continue before the dialog has gone starts no second import', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    const pending = deferred();
    (userGamesAPI.importBGGCollection as Mock).mockReturnValue(pending.promise);
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import Collection' }));
    const cont = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' });
    // Two native activations before React commits the close: the jsdom model of a double Enter
    // during the dialog's exit animation.
    act(() => {
      cont.click();
      cont.click();
    });

    expect(userGamesAPI.importBGGCollection).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ imported: 0 }); });
  });

  it('I3: a failed import releases the latch, keeps its diagnostic, and a second import can start', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ imported: 0 });
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    const importBtn = screen.getByRole('button', { name: 'Import Collection' });
    fireEvent.click(importBtn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));

    await screen.findByText("We couldn't import that collection. Check the username and try again.");
    expect(loggerMock().info).toHaveBeenCalledWith('Error importing BGG collection:', expect.any(Object));
    await waitFor(() => expect(importBtn.textContent).toBe('Import Collection'));
    expect(importBtn).not.toHaveAttribute('aria-disabled');
    expect(importBtn).not.toBeDisabled();

    fireEvent.click(importBtn);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(userGamesAPI.importBGGCollection).toHaveBeenCalledTimes(2));
  });

  it('I4: after Continue the dialog restores focus to Import Collection, which is still importing', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    const pending = deferred();
    (userGamesAPI.importBGGCollection as Mock).mockReturnValue(pending.promise);
    renderProfile();

    const field = await screen.findByRole('textbox', { name: 'BoardGameGeek username' });
    await user.type(field, 'someone');
    const importBtn = screen.getByRole('button', { name: 'Import Collection' });
    // Focuses the button and opens the dialog, so the dialog records it as the opener.
    await user.click(importBtn);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(document.activeElement).toBe(importBtn));
    expect(document.activeElement).not.toBe(document.body);
    expect(importBtn).toHaveAttribute('aria-disabled', 'true');

    await act(async () => { pending.resolve({ imported: 0 }); });
    // R5 ordering backstop: still there after the held import settles.
    await waitFor(() => expect(importBtn.textContent).toBe('Import Collection'));
    expect(document.activeElement).toBe(importBtn);
  });
});

describe('BGG import outcome region (88.6.1-60: Req 8, D-22)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  async function startImport() {
    fireEvent.click(screen.getByRole('button', { name: 'Import Collection' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));
  }

  afterEach(async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 0 });
  });

  it('R1: one always-mounted polite region, empty and sr-only first, carries the progress line and then the result on the same node', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    const pending = deferred();
    (userGamesAPI.importBGGCollection as Mock).mockReturnValue(pending.promise);
    renderProfile();

    const field = await screen.findByRole('textbox', { name: 'BoardGameGeek username' });
    const region = document.getElementById('bgg-import-status') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
    expect(region.classList).toContain('sr-only');

    fireEvent.change(field, { target: { value: 'someone' } });
    await startImport();

    await waitFor(() => expect(region).toHaveTextContent('Fetching your BGG collection...'));
    expect(document.getElementById('bgg-import-status')).toBe(region);
    expect(region.classList).not.toContain('sr-only');
    for (const cls of ['mt-3', 'p-3', 'rounded-btn', 'bg-surface-muted', 'text-content-secondary', 'text-base']) {
      expect(region.classList).toContain(cls);
    }

    await act(async () => { pending.resolve({ imported: 3, skipped: 1, total: 4 }); });
    await waitFor(() => expect(region).toHaveTextContent('Imported 3 games'));
    expect(document.getElementById('bgg-import-status')).toBe(region);
    expect(region).toHaveTextContent('Total: 4');
    expect(region.classList).toContain('bg-status-success-subtle');
  });

  it('R2: a failed import writes the failure line on the same node', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock).mockRejectedValueOnce(new Error('boom'));
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    const region = document.getElementById('bgg-import-status') as HTMLElement;
    expect(region).not.toBeNull();
    await startImport();

    await waitFor(() =>
      expect(region).toHaveTextContent("We couldn't import that collection. Check the username and try again.")
    );
    expect(document.getElementById('bgg-import-status')).toBe(region);
    expect(region.classList).toContain('bg-status-error-subtle');
  });

  // Held-out backstop for the R8 idempotency edge: a second identical result is still a text
  // change on the node, because the region passes through the progress line between them.
  it('R3: two consecutive imports with the same result each mutate the same node', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    await startImport();
    const region = document.getElementById('bgg-import-status') as HTMLElement;
    await waitFor(() => expect(region).toHaveTextContent('Imported 0 games'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import Collection' })).not.toHaveAttribute('aria-disabled'));

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => { records.push(...list); });
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    await startImport();
    await waitFor(() => expect(userGamesAPI.importBGGCollection).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import Collection' })).not.toHaveAttribute('aria-disabled'));
    await waitFor(() => expect(records.length).toBeGreaterThan(0));
    await waitFor(() => expect(region).toHaveTextContent('Imported 0 games'));
    observer.disconnect();
    expect(document.getElementById('bgg-import-status')).toBe(region);
  });
});

describe('BGG search in flight (88.6.1-60: D-35, Req 4)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  async function openSearch(query: string) {
    fireEvent.click(await screen.findByRole('button', { name: '+ Add from BGG' }));
    const field = screen.getByRole('textbox', { name: 'Search BoardGameGeek' });
    fireEvent.change(field, { target: { value: query } });
    return { field, search: screen.getByRole('button', { name: 'Search' }) };
  }

  afterEach(async () => {
    const { gamesAPI } = await import('@/lib/api');
    (gamesAPI.searchBGG as Mock).mockResolvedValue([]);
  });

  it('S1: Search keeps its node under aria-disabled and two presses plus a field Enter send one request', async () => {
    const { gamesAPI } = await import('@/lib/api');
    const pending = deferred();
    (gamesAPI.searchBGG as Mock).mockReturnValue(pending.promise);
    renderProfile();

    const { field, search } = await openSearch('catan');
    fireEvent.click(search);

    await waitFor(() => expect(search).toHaveAttribute('aria-disabled', 'true'));
    expect(search).not.toBeDisabled();
    expect(search.isConnected).toBe(true);
    expect(search.textContent).toBe('Searching...');

    fireEvent.click(search);
    fireEvent.click(search);
    fireEvent.keyPress(field, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(gamesAPI.searchBGG).toHaveBeenCalledTimes(1);
    expect(search).toHaveAttribute('aria-disabled', 'true');
    expect(search.textContent).toBe('Searching...');

    await act(async () => { pending.resolve([]); });
  });

  // CONFIRM-ONLY (green before this plan): the blank-query half stays a native disable.
  it('S2: a blank or whitespace query keeps Search natively disabled, with no aria-disabled (rule of KIND)', async () => {
    renderProfile();
    const { field, search } = await openSearch('');
    expect(search).toBeDisabled();
    expect(search).not.toHaveAttribute('aria-disabled');
    fireEvent.change(field, { target: { value: '   ' } });
    expect(search).toBeDisabled();
    expect(search).not.toHaveAttribute('aria-disabled');
  });

  it('S3: a failed search releases the latch; its toast and diagnostic are unchanged', async () => {
    const { gamesAPI } = await import('@/lib/api');
    (gamesAPI.searchBGG as Mock).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    renderProfile();

    const { search } = await openSearch('catan');
    fireEvent.click(search);

    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith(
        "We couldn't reach BoardGameGeek. Please try again in a few moments."
      )
    );
    expect(loggerMock().info).toHaveBeenCalledWith('Error searching BGG:', expect.any(Object));
    await waitFor(() => expect(search.textContent).toBe('Search'));
    expect(search).not.toHaveAttribute('aria-disabled');

    fireEvent.click(search);
    await waitFor(() => expect(gamesAPI.searchBGG).toHaveBeenCalledTimes(2));
  });

  it('S4: a search with results is announced once, screen-reader only; a zero result keeps the toast alone', async () => {
    const { gamesAPI } = await import('@/lib/api');
    (gamesAPI.searchBGG as Mock).mockResolvedValueOnce([
      { bgg_id: 1, name: 'Azul', year_published: 2017 },
      { bgg_id: 2, name: 'Catan', year_published: 1995 },
    ]);
    renderProfile();

    const { search } = await openSearch('azul');
    fireEvent.click(search);

    const line = await screen.findByText('Found 2 games.');
    const region = line.closest('[role="status"]') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.classList).toContain('sr-only');
    expect(toastMock()).not.toHaveBeenCalledWith('No games found. Try a different search term.');

    await waitFor(() => expect(search.textContent).toBe('Search'));
    (gamesAPI.searchBGG as Mock).mockResolvedValueOnce([{ bgg_id: 3, name: 'Azul: Summer', year_published: 2019 }]);
    fireEvent.click(search);
    await screen.findByText('Found 1 game.');
    expect(screen.queryByText('Found 2 games.')).toBeNull();

    await waitFor(() => expect(search.textContent).toBe('Search'));
    (gamesAPI.searchBGG as Mock).mockResolvedValueOnce([]);
    fireEvent.click(search);
    await waitFor(() =>
      expect(toastMock()).toHaveBeenCalledWith('No games found. Try a different search term.')
    );
    expect(screen.queryByText(/^Found \d+ games?\.$/)).toBeNull();
  });
});

describe('BGG import result timer (88.6.1-60: Req 11)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  let setSpy: ReturnType<typeof vi.spyOn> | undefined;
  let clearSpy: ReturnType<typeof vi.spyOn> | undefined;
  const resultTimers: unknown[] = [];

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  // The handle of the most recent 5-second timer the page scheduled.
  function lastResultTimer(): unknown {
    const spy = setSpy as unknown as Mock;
    for (let i = spy.mock.calls.length - 1; i >= 0; i -= 1) {
      if (spy.mock.calls[i][1] === 5000) {
        const handle = spy.mock.results[i].value;
        if (!resultTimers.includes(handle)) resultTimers.push(handle);
        return handle;
      }
    }
    return undefined;
  }

  async function importOnce() {
    fireEvent.click(screen.getByRole('button', { name: 'Import Collection' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));
  }

  afterEach(async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 0 });
    setSpy?.mockRestore();
    clearSpy?.mockRestore();
    setSpy = undefined;
    clearSpy = undefined;
    // No stray result timer outlives a case.
    for (const handle of resultTimers.splice(0)) clearTimeout(handle as ReturnType<typeof setTimeout>);
  });

  it('T1: a second import inside the window clears the first import\'s result timer by its handle', async () => {
    setSpy = vi.spyOn(globalThis, 'setTimeout');
    clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock).mockResolvedValueOnce({ imported: 1 });
    renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    await importOnce();
    const region = document.getElementById('bgg-import-status') as HTMLElement;
    await waitFor(() => expect(region).toHaveTextContent('Imported 1 games'));
    await waitFor(() => expect(lastResultTimer()).toBeDefined());
    const h1 = lastResultTimer();

    const pending = deferred();
    (userGamesAPI.importBGGCollection as Mock).mockReturnValue(pending.promise);
    await importOnce();
    await waitFor(() => expect(region).toHaveTextContent('Fetching your BGG collection...'));
    expect(clearSpy).toHaveBeenCalledWith(h1);

    await act(async () => { pending.resolve({ imported: 0 }); });
  });

  it('T2: unmounting the page cancels a pending result timer by its handle', async () => {
    setSpy = vi.spyOn(globalThis, 'setTimeout');
    clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock).mockResolvedValueOnce({ imported: 1 });
    const { unmount } = renderProfile();

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'BoardGameGeek username' }),
      { target: { value: 'someone' } }
    );
    await importOnce();
    await waitFor(() => expect(document.getElementById('bgg-import-status')).toHaveTextContent('Imported 1 games'));
    await waitFor(() => expect(lastResultTimer()).toBeDefined());
    const h1 = lastResultTimer();

    unmount();
    expect(clearSpy).toHaveBeenCalledWith(h1);
  });
});

describe('BGG import result timer focus (88.6.1-60: Req 5, owner design 2026-10-05)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  // Fake timers are on: vi.waitFor only (RTL's findBy / waitFor poll on the faked clock).
  async function importAndWaitForTimer() {
    const { userGamesAPI } = await import('@/lib/api');
    const getOwnedGames = userGamesAPI.getOwnedGames as Mock;
    renderProfile();
    const field = await vi.waitFor(() => screen.getByRole('textbox', { name: 'BoardGameGeek username' }));
    fireEvent.change(field, { target: { value: 'someone' } });
    const importBtn = screen.getByRole('button', { name: 'Import Collection' });
    act(() => importBtn.focus());
    fireEvent.click(importBtn);
    const refreshesBefore = getOwnedGames.mock.calls.length;
    fireEvent.click(within(await vi.waitFor(() => screen.getByRole('dialog'))).getByRole('button', { name: 'Continue' }));
    await vi.waitFor(() =>
      expect(document.getElementById('bgg-import-status')).toHaveTextContent('Imported 1 games')
    );
    // A positive wait for the post-import refresh; the timer is scheduled right after it.
    await vi.waitFor(() => expect(getOwnedGames.mock.calls.length).toBeGreaterThan(refreshesBefore));
    await act(async () => {});
    return { field: field as HTMLInputElement, importBtn };
  }

  async function runResultTimer() {
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  }

  function expectRegionCleared() {
    const region = document.getElementById('bgg-import-status') as HTMLElement;
    expect(region.textContent).toBe('');
    expect(region.classList).toContain('sr-only');
  }

  afterEach(async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 0 });
  });

  it('T3-A: focus still on Import Collection moves to + Add from BGG before the box empties', async () => {
    vi.useFakeTimers();
    try {
      const { userGamesAPI } = await import('@/lib/api');
      (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 1, skipped: 0, total: 1 });
      const { field, importBtn } = await importAndWaitForTimer();
      act(() => importBtn.focus());
      expect(document.activeElement).toBe(importBtn);

      await runResultTimer();

      expectRegionCleared();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add from BGG' }));
      expect(document.activeElement).not.toBe(document.body);
      expect(field.value).toBe('');
      // The state in which a real browser drops focus; jsdom does not, so the toggle line above
      // is the RED half.
      expect(importBtn).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  // CONFIRM-ONLY on the tree before this plan (nothing moved focus at all); its teeth are a
  // throwaway callback that moves focus without checking where it is.
  it('T3-B: focus the user moved elsewhere is left alone', async () => {
    vi.useFakeTimers();
    try {
      const { userGamesAPI } = await import('@/lib/api');
      (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 1, skipped: 0, total: 1 });
      const { field } = await importAndWaitForTimer();
      act(() => field.focus());
      const toggle = screen.getByRole('button', { name: '+ Add from BGG' });
      const toggleFocused = vi.fn();
      toggle.addEventListener('focus', toggleFocused);

      await runResultTimer();

      expectRegionCleared();
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe('');
      expect(toggleFocused).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('T3-W: the move is wired to the shared refs and plan 04 primitives, and written before the write that disables the button', async () => {
    const source = await pageSource();
    expect(source).toContain('ref={importButtonRef}');
    expect(source).toContain('ref={addFromBggToggleRef}');
    expect(source).toContain('ref={collectionHeadingRef}');
    expect(source).toContain('focusElement(addFromBggToggleRef.current)');
    expect(source).toContain('focusElement(collectionHeadingRef.current)');
    expect(source).toContain('focusPageFloor(');
    const move = source.indexOf('focusElement(addFromBggToggleRef.current)');
    expect(move).toBeGreaterThan(-1);
    expect(move).toBeLessThan(source.indexOf("setBggUsername('')"));
  });

  it('T3-N: a newly typed name is kept, the result line still goes, and focus stays on an enabled Import Collection', async () => {
    vi.useFakeTimers();
    try {
      const { userGamesAPI } = await import('@/lib/api');
      (userGamesAPI.importBGGCollection as Mock).mockResolvedValue({ imported: 1, skipped: 0, total: 1 });
      const { field, importBtn } = await importAndWaitForTimer();
      fireEvent.change(field, { target: { value: 'another' } });
      act(() => importBtn.focus());
      expect(document.activeElement).toBe(importBtn);

      await runResultTimer();

      expectRegionCleared();
      expect(field.value).toBe('another');
      expect(importBtn).not.toBeDisabled();
      expect(document.activeElement).toBe(importBtn);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T3-D: with the import dialog open the name is kept, the result line goes behind it, and Continue re-imports', async () => {
    vi.useFakeTimers();
    try {
      const { userGamesAPI } = await import('@/lib/api');
      const held = deferred();
      (userGamesAPI.importBGGCollection as Mock)
        .mockResolvedValueOnce({ imported: 1, skipped: 0, total: 1 })
        .mockReturnValue(held.promise);
      const { field, importBtn } = await importAndWaitForTimer();
      act(() => importBtn.focus());
      fireEvent.click(importBtn);
      const dialog = await vi.waitFor(() => screen.getByRole('dialog'));

      await runResultTimer();

      expectRegionCleared();
      expect(within(dialog).getByText('someone')).toBeInTheDocument();
      expect(field.value).toBe('someone');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
      await vi.waitFor(() => expect(userGamesAPI.importBGGCollection).toHaveBeenCalledTimes(2));
      expect((userGamesAPI.importBGGCollection as Mock).mock.calls[1]).toEqual([SELF_UUID, 'someone']);
      await act(async () => { held.resolve({ imported: 0 }); });
    } finally {
      vi.useRealTimers();
    }
  });

  it('T3-E: the + Add from BGG toggle is a disclosure: aria-expanded, and aria-controls only while the panel exists', async () => {
    renderProfile();
    const toggle = await screen.findByRole('button', { name: '+ Add from BGG' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('Hide Search');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId as string);
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole('textbox', { name: 'Search BoardGameGeek' })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
  });
});

describe('identity row kept or late (88.6.1-61: Req 11, AC-29)', () => {
  type Mock = ReturnType<typeof vi.fn>;

  // The user's own settings, deliberately unlike DEFAULT_PREFS (Event Updates email off, a
  // one-day reminder), so a page that shows or sends the defaults fails on sight.
  const REAL_PREFS = {
    event_created: { email: true, sms: false },
    reminder: { email: true, sms: false, window_hours: 24 },
    event_updated: { email: false, sms: false },
    event_cancelled: { email: true, sms: false },
  };
  const TOGGLED = { ...REAL_PREFS, event_created: { email: false, sms: false } };

  afterEach(async () => {
    const { userGamesAPI, googleCalendarAPI } = await import('@/lib/api');
    // The persistence trap: clearAllMocks keeps an implementation, so restore the defaults here.
    (userGamesAPI.getOwnedGames as Mock).mockResolvedValue([]);
    (googleCalendarAPI.getStatus as Mock).mockResolvedValue({ connected: false });
  });

  it('I1: a kept row whose refetch failed shows and saves the real settings, never the defaults', async () => {
    const { usersAPI } = await import('@/lib/api');
    h.selfError = new Error('boom');
    renderProfile({ notification_preferences: REAL_PREFS });

    const updates = await screen.findByRole('switch', { name: 'Event Updates email notifications' });
    expect(updates).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('combobox', { name: 'Remind me' })).toHaveValue('24');

    fireEvent.click(screen.getByRole('switch', { name: 'New Event email notifications' }));
    await waitFor(() => expect(usersAPI.updateNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(usersAPI.updateNotificationPreferences).toHaveBeenCalledWith(SELF_UUID, TOGGLED);
  });

  it('I2: a kept row whose refetch failed names the user from the row', async () => {
    h.selfError = new Error('boom');
    renderProfile({ username: 'RealName' });
    expect(await screen.findByRole('heading', { level: 1, name: 'RealName' })).toBeInTheDocument();
  });

  it('I4: a row arriving after a failed first load initializes the page and the card appears with the real settings', async () => {
    const { usersAPI } = await import('@/lib/api');
    h.selfError = new Error('boom');
    const view = render(<Profile />);
    // Positive signal first: the no-row fallback ran (the identity notices are up).
    await screen.findAllByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('heading', { name: 'Notification Preferences' })).toBeNull();

    h.selfError = null;
    h.self = harnessSelfRow({ username: 'RealName', notification_preferences: REAL_PREFS });
    view.rerender(<Profile />);

    await screen.findByRole('heading', { name: 'Notification Preferences' });
    expect(screen.getByRole('switch', { name: 'Event Updates email notifications' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('heading', { level: 1, name: 'RealName' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'New Event email notifications' }));
    await waitFor(() => expect(usersAPI.updateNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(usersAPI.updateNotificationPreferences).toHaveBeenCalledWith(SELF_UUID, TOGGLED);
  });

  it('I5: with no identity row the Notification Preferences card is hidden, not filled with defaults', async () => {
    const { usersAPI } = await import('@/lib/api');
    h.selfError = new Error('boom');
    render(<Profile />);
    // The calendar zone, the ACTIVE availability panel (Radix mounts only that one) and the
    // collection zone each show the identity notice (amended by 88.6.1-61 Task 2, review 65).
    expect(await screen.findAllByRole('button', { name: 'Retry' })).toHaveLength(3);
    expect(screen.queryByText('No schedules set. Add one to get started.')).toBeNull();

    expect(screen.queryByRole('heading', { name: 'Notification Preferences' })).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByText('Choose how you receive notifications')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Timezone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Availability Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Self' })).toBeInTheDocument();
    expect(usersAPI.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it('I6: a row arriving while the username editor is open keeps the typed name, and Cancel restores the row name', async () => {
    h.selfError = new Error('boom');
    const view = render(<Profile />);
    await screen.findAllByRole('button', { name: 'Retry' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit username' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), { target: { value: 'Typed Name' } });

    h.selfError = null;
    h.self = harnessSelfRow({ username: 'RealName', notification_preferences: REAL_PREFS });
    view.rerender(<Profile />);
    // Positive signal: the row init ran (the card only mounts from it).
    await screen.findByRole('heading', { name: 'Notification Preferences' });

    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('Typed Name');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'RealName' })).toBeInTheDocument();
  });

  // ---- 88.6.1-61 Task 2 (AC-29, review 65, review 222) ----

  const STILL_LOADING = 'Still loading your account — please try again in a moment.';

  // A Retry that supplies the row: the mocked refetch swaps the harness to a resolved identity,
  // and the retry's own state write re-renders the page over it.
  function retrySuppliesTheRow() {
    h.refetchSelf.mockImplementation(async () => {
      h.selfError = null;
      h.self = harnessSelfRow();
      return { isError: false, data: h.self };
    });
  }

  it('I3: a kept row whose refetch failed shows the calendar control and the collection, with no identity notice', async () => {
    const { userGamesAPI, googleCalendarAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock).mockResolvedValue(OWNED_GAMES);
    // Re-set explicitly: earlier describes leave `getStatus` answering connected.
    (googleCalendarAPI.getStatus as Mock).mockResolvedValue({ connected: false });
    h.selfError = new Error('boom');
    renderProfile();

    // Positive signal: the collection list renders under the kept row.
    await screen.findByRole('button', { name: 'Remove Catan' });
    expect(await screen.findByRole('button', { name: 'Connect Google Calendar' })).toBeInTheDocument();
    // AMENDED Phase 88.6.1-79 (D-51): the kept row now carries the header card's RF1 Retry; no compact notice replaces the calendar or collection zone
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1));
    expect(within(headerCard()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notification Preferences' })).toBeInTheDocument();
  });

  it('I7: with no row a Save press says the account is still loading, and neither panel says the user has nothing', async () => {
    const { availabilityAPI } = await import('@/lib/api');
    const user = userEvent.setup();
    h.selfError = new Error('boom');
    render(<Profile />);
    await screen.findAllByRole('button', { name: 'Retry' });

    await user.click(screen.getByRole('button', { name: '+ Add Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => expect(toastMock().error).toHaveBeenCalledWith(STILL_LOADING));
    expect(availabilityAPI.createRecurringPattern).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Specific Dates' }));
    await screen.findByRole('heading', { name: 'Specific Date Overrides' });
    expect(screen.queryByText(/No specific overrides set\./)).toBeNull();
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add Override' }));
    await user.click(screen.getByRole('button', { name: 'Save Override' }));
    await waitFor(() =>
      expect(toastMock().error.mock.calls.filter((call) => call[0] === STILL_LOADING)).toHaveLength(2)
    );
    expect(availabilityAPI.createOverride).not.toHaveBeenCalled();
  });

  it('I8: a successful Retry in the collection card lands focus on the My Game Collection heading', async () => {
    const user = userEvent.setup();
    h.selfError = new Error('boom');
    retrySuppliesTheRow();
    render(<Profile />);
    await screen.findAllByRole('button', { name: 'Retry' });

    const card = screen.getByRole('heading', { name: /^My Game Collection/ }).closest('.card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Retry' }));

    // The notice leaves once the row is in hand; focus lands on the section's own heading.
    await waitFor(() => expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: /^My Game Collection/ }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('I9: a successful Retry in the Availability Settings card lands focus on the Availability Schedules heading', async () => {
    const user = userEvent.setup();
    h.selfError = new Error('boom');
    retrySuppliesTheRow();
    render(<Profile />);
    await screen.findAllByRole('button', { name: 'Retry' });

    const card = document.getElementById('availability-settings') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(within(card).queryByRole('button', { name: 'Retry' })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Availability Schedules' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("I10: with no row the BGG search still announces its results (plan 60's region is outside the hidden card)", async () => {
    const { gamesAPI } = await import('@/lib/api');
    (gamesAPI.searchBGG as Mock).mockResolvedValueOnce([
      { bgg_id: 1, name: 'Azul', year_published: 2017 },
      { bgg_id: 2, name: 'Catan', year_published: 1995 },
    ]);
    h.selfError = new Error('boom');
    render(<Profile />);
    await screen.findAllByRole('button', { name: 'Retry' });

    fireEvent.click(screen.getByRole('button', { name: '+ Add from BGG' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search BoardGameGeek' }), { target: { value: 'azul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Found 2 games.')).toBeInTheDocument();
  });
});

describe('collection list and first-load failure (88.6.1-67: D-09a, D-37, Req 9)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  // Copy row P8 (owner-ratified 2026-10-05), straight apostrophe.
  const P8 = "Couldn't load your collection";
  const AZUL_ROW = { id: 'game-azul', name: 'Azul', bgg_id: 230802, year_published: 2017, image_url: null };

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  function collectionHeading() {
    return screen.getByRole('heading', { name: /^My Game Collection/ });
  }

  // The collection Remove is a two-tap gate: the glyph arms into the labelled verb `Remove`.
  async function twoTapRemove(name: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Remove ${name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  }

  afterEach(async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    // The persistence trap: clearAllMocks keeps implementations (and queued once-values), so reset.
    (userGamesAPI.getOwnedGames as Mock).mockReset().mockResolvedValue([]);
    (userGamesAPI.addOwnedGame as Mock).mockReset().mockResolvedValue({});
    (userGamesAPI.removeOwnedGame as Mock).mockReset().mockResolvedValue({});
    (gamesAPI.searchBGG as Mock).mockReset().mockResolvedValue([]);
    (gamesAPI.importFromBGG as Mock).mockReset().mockResolvedValue({ id: 'game-imported' });
  });

  it('R2: a refresh after a removal keeps the remaining cards on screen, the same nodes, marked busy', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    const refresh = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockReturnValueOnce(refresh.promise);
    renderProfile();
    const brass = await screen.findByRole('button', { name: 'Remove Brass' });

    await twoTapRemove('Catan');
    // Positive signal: the refresh is in flight and the grid that holds Brass says so.
    await waitFor(() => expect(brass.closest('[aria-busy="true"]')).not.toBeNull());
    expect(brass.isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'Remove Brass' })).toBe(brass);
    expect(screen.queryByText('Loading your collection...')).toBeNull();
    // D-54: Catan left at the server's confirmation, before the held refresh answered.
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'My Game Collection (1)' })).toBeInTheDocument();

    await act(async () => { refresh.resolve([OWNED_GAMES[1]]); });
    await waitFor(() => expect(document.querySelector('[aria-busy]')).toBeNull());
    expect(screen.getByRole('button', { name: 'Remove Brass' })).toBe(brass);
    expect(screen.getByRole('heading', { name: 'My Game Collection (1)' })).toBeInTheDocument();
  });

  it('R3: a failed refresh after a removal keeps the remaining rows, never the empty sentence', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new Error('boom'));
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Brass' });

    await twoTapRemove('Catan');
    await waitFor(() =>
      expect(loggerMock().info).toHaveBeenCalledWith('Error fetching owned games:', expect.any(Object))
    );
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Brass' })).toBeInTheDocument();
    expect(screen.queryByText(/You don't have any games in your collection yet/)).toBeNull();
    expect(screen.queryByText(P8)).toBeNull();
    expect(screen.getByRole('heading', { name: 'My Game Collection (1)' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  it('R7: a Remove answered 404 drops the row and refreshes; a transient refresh failure keeps the rest', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    (userGamesAPI.removeOwnedGame as Mock).mockRejectedValueOnce(
      new ApiError('Game not found in your collection', 'not_found', 404)
    );
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Brass' });

    await twoTapRemove('Catan');
    await waitFor(() => {
      expect(loggerMock().info).toHaveBeenCalledWith('Error removing game from collection:', expect.any(Object));
      expect(loggerMock().info).toHaveBeenCalledWith('Error fetching owned games:', expect.any(Object));
      expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2);
    });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Brass' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My Game Collection (1)' })).toBeInTheDocument();
    expect(screen.queryByText(P8)).toBeNull();
    expect(toastMock().error).toHaveBeenCalledTimes(1);
  });

  it('R7b: a Remove answered 404 for a gone account withdraws the rest of the list behind the banner', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    const err = new ApiError('User not found', 'not_found', 404);
    (userGamesAPI.getOwnedGames as Mock)
      .mockReset()
      .mockRejectedValue(err)
      .mockResolvedValueOnce(OWNED_GAMES);
    (userGamesAPI.removeOwnedGame as Mock).mockRejectedValueOnce(
      new ApiError('User not found', 'not_found', 404)
    );
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Brass' });

    await twoTapRemove('Catan');
    // Positive signal first: the P8 banner replaced the list.
    await screen.findByText(P8);
    expect(screen.getByText(getFetchErrorMessage(err))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Brass' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    const text = collectionHeading().textContent ?? '';
    expect(text).toContain('—');
    expect(text).not.toContain('(1)');
    expect(text).not.toContain('(2)');
  });

  it('R4: an older collection answer never overwrites a newer one (latest wins)', async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    const refreshA = deferred<unknown>();
    const refreshB = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockReturnValueOnce(refreshA.promise)
      .mockReturnValueOnce(refreshB.promise);
    (gamesAPI.searchBGG as Mock).mockResolvedValueOnce([{ bgg_id: 230802, name: 'Azul', year_published: 2017 }]);
    (gamesAPI.importFromBGG as Mock).mockResolvedValueOnce({ id: 'game-azul' });
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Brass' });

    fireEvent.click(screen.getByRole('button', { name: '+ Add from BGG' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search BoardGameGeek' }), { target: { value: 'azul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: /^(Add to Collection|Adding\.\.\.)$/ });
    fireEvent.click(add);
    await waitFor(() => expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2)); // refresh A held

    await twoTapRemove('Catan');
    await waitFor(() => expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(3)); // refresh B held

    await act(async () => { refreshB.resolve([OWNED_GAMES[1], AZUL_ROW]); });
    await screen.findByRole('button', { name: 'Remove Azul' });
    await act(async () => { refreshA.resolve([...OWNED_GAMES, AZUL_ROW]); });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Brass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Azul' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My Game Collection (2)' })).toBeInTheDocument();
  });

  it('R5: a new identity never shows the previous identity\'s rows (CONFIRM-ONLY; pins the C3 key)', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockReturnValueOnce(new Promise(() => {}));
    const { rerender } = renderProfile();
    await screen.findByRole('button', { name: 'Remove Catan' });

    h.self = { ...(h.self as Record<string, unknown>), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    rerender(<Profile />);
    await screen.findByText('Loading your collection...');
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
  });

  it('F1: a failed first load shows the P8 banner, never the empty sentence and never (0)', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock).mockRejectedValueOnce(new Error('boom'));
    renderProfile();

    await screen.findByText(P8);
    expect(screen.queryByText(/You don't have any games in your collection yet/)).toBeNull();
    const text = collectionHeading().textContent ?? '';
    expect(text).toContain('—');
    expect(text).not.toContain('(0)');
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    expect(screen.queryByText('Loading your collection...')).toBeNull();
  });

  it('F2: Try again after a failed first load brings the games and lands focus on the collection heading', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    const retry = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(retry.promise);
    renderProfile();

    await screen.findByText(P8);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2));
    // C2: the error is kept through the run, so the banner stays and the loader never swaps in.
    expect(screen.getByText(P8)).toBeInTheDocument();
    expect(screen.queryByText('Loading your collection...')).toBeNull();

    await act(async () => { retry.resolve(OWNED_GAMES); });
    await screen.findByRole('button', { name: 'Remove Catan' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'My Game Collection (2)' }))
    );
    expect(screen.queryByText(P8)).toBeNull();
  });

  it('F3: a failed Try again keeps the banner and its polite region says the title', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom again'));
    renderProfile();

    await screen.findByText(P8);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.getAllByText(P8).length).toBeGreaterThan(0);
    expect(screen.queryByText(/You don't have any games in your collection yet/)).toBeNull();
    const card = collectionHeading().closest('.card') as HTMLElement;
    await waitFor(() =>
      expect(within(card).getAllByRole('status').some((node) => node.textContent === P8)).toBe(true)
    );
  });

  it('F4: with no identity row the collection count is an em-dash, never (0)', async () => {
    h.self = undefined;
    h.selfError = new Error('boom');
    render(<Profile />);
    await screen.findAllByRole('button', { name: 'Retry' });
    const text = collectionHeading().textContent ?? '';
    expect(text).toContain('—');
    expect(text).not.toContain('(0)');
  });
});

describe('collection refresh notice and Remove focus (88.6.1-67: RF1, Req 5)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  // Copy row RF1 (D-47), written ONCE here (88.6.1-70 contract C7): plan 70's notice renders it
  // twice while it shows (the visible line and its polite region), so every lookup is an All query.
  const RF1 = "Couldn't refresh. Showing what loaded earlier.";
  const P8 = "Couldn't load your collection";

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  // The unpressed re-attempt: a tab return, the useFetchErrorState.test.tsx idiom.
  function fireVisible() {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  // Both taps of the two-tap Remove with real focus (userEvent), so the focus hook has a seed.
  async function twoTapRemove(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await screen.findByRole('button', { name: `Remove ${name}` }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
  }

  function addFromBgg() {
    return screen.getByRole('button', { name: '+ Add from BGG' });
  }

  afterEach(async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    // clearAllMocks keeps implementations and queued once-values, so reset to the harness defaults.
    (userGamesAPI.getOwnedGames as Mock).mockReset().mockResolvedValue([]);
    (userGamesAPI.removeOwnedGame as Mock).mockReset().mockResolvedValue({});
    (userGamesAPI.addOwnedGame as Mock).mockReset().mockResolvedValue({});
    (gamesAPI.searchBGG as Mock).mockReset().mockResolvedValue([]);
    (gamesAPI.importFromBGG as Mock).mockReset().mockResolvedValue({ id: 'game-imported' });
  });

  it('N1: a failed refresh keeps the remaining rows under RF1, less the confirmed removal', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    renderProfile();

    await twoTapRemove(user, 'Catan');
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    const brass = screen.getByRole('button', { name: 'Remove Brass' });
    expect(screen.getByRole('heading', { name: 'My Game Collection (1)' })).toBeInTheDocument();
    expect(screen.queryByText(P8)).toBeNull();
    expect(screen.queryByText(/You don't have any games in your collection yet/)).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.compareDocumentPosition(brass) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('N2: the RF1 region is on the page before the refresh fails, and the failure fills that node', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Brass' });
    const before = screen.getAllByRole('status');

    await twoTapRemove(user, 'Catan');
    let filled: HTMLElement | undefined;
    await waitFor(() => {
      filled = screen.getAllByRole('status').find((node) => node.textContent === RF1);
      expect(filled).toBeDefined();
    });
    expect(before).toContain(filled);
  });

  it('N3: a successful Retry removes the notice and lands focus on the collection heading', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    const again = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500))
      .mockReturnValueOnce(again.promise);
    renderProfile();

    await twoTapRemove(user, 'Catan');
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(3));
    await act(async () => { again.resolve([OWNED_GAMES[1]]); });
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'My Game Collection (1)' }))
    );
  });

  it('R1: a confirmed Remove lands focus on + Add from BGG when the row leaves, before the refresh answers', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    const refresh = deferred<unknown>();
    const removal = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockReturnValueOnce(refresh.promise);
    (userGamesAPI.removeOwnedGame as Mock).mockReturnValueOnce(removal.promise);
    renderProfile();

    const remove = await screen.findByRole('button', { name: 'Remove Catan' });
    await user.click(remove);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(userGamesAPI.removeOwnedGame).toHaveBeenCalledTimes(1));
    // CONFIRM-ONLY in jsdom: the pressed Remove keeps focus and its row stays while the call is held.
    expect(document.activeElement).toBe(remove);
    expect(remove.isConnected).toBe(true);

    await act(async () => { removal.resolve({}); });
    await waitFor(() => expect(document.activeElement).toBe(addFromBgg()));
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2); // the refresh is still held
    expect(document.activeElement).not.toBe(document.body);

    await act(async () => { refresh.resolve([OWNED_GAMES[1]]); });
    await act(async () => {});
    expect(document.activeElement).toBe(addFromBgg());
  });

  it('N4: a collection that loaded EMPTY keeps its empty sentence under RF1 after a failed refresh (owner ruling Y)', async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    (gamesAPI.searchBGG as Mock).mockResolvedValueOnce([{ bgg_id: 230802, name: 'Azul', year_published: 2017 }]);
    // `addOwnedGame` keeps the harness default: an answer with NO `game` row, so the add's
    // confirmation append (Task 3, finding #75) adds nothing and the list stays the empty one.
    renderProfile();
    await screen.findByText(/You don't have any games in your collection yet/);

    fireEvent.click(addFromBgg());
    fireEvent.change(screen.getByRole('textbox', { name: 'Search BoardGameGeek' }), { target: { value: 'azul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /^(Add to Collection|Adding\.\.\.)$/ }));

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const empty = screen.getByText(/You don't have any games in your collection yet/);
    expect(screen.queryByText(P8)).toBeNull();
    expect(screen.getByRole('heading', { name: 'My Game Collection (0)' })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('E1: a 401 or 403 refresh withdraws the rows for the P8 banner and its register line, never RF1', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    for (const err of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      const user = userEvent.setup();
      (userGamesAPI.getOwnedGames as Mock)
        .mockReset()
        .mockResolvedValueOnce(OWNED_GAMES)
        .mockRejectedValueOnce(err);
      renderProfile();

      await twoTapRemove(user, 'Catan');
      await screen.findByText(P8);
      expect(screen.getByText(getFetchErrorMessage(err))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove Brass' })).toBeNull();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      const text = screen.getByRole('heading', { name: /^My Game Collection/ }).textContent ?? '';
      expect(text).toContain('—');
      expect(text).not.toContain('(1)');
      expect(text).not.toContain('(2)');
      await waitFor(() => expect(document.activeElement).toBe(addFromBgg()));
      expect(document.activeElement).not.toBe(document.body);
      cleanup();
    }
  });

  it('E2: a 500 or a network failure on the refresh keeps the rows under RF1', async () => {
    const { userGamesAPI } = await import('@/lib/api');
    for (const err of [
      new ApiError('Server error', 'internal', 500),
      new ApiError('Network error', 'network', 0),
    ]) {
      const user = userEvent.setup();
      (userGamesAPI.getOwnedGames as Mock)
        .mockReset()
        .mockResolvedValueOnce(OWNED_GAMES)
        .mockRejectedValueOnce(err);
      renderProfile();

      await twoTapRemove(user, 'Catan');
      expect(await screen.findAllByText(RF1)).toHaveLength(2);
      expect(screen.getByRole('button', { name: 'Remove Brass' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
      expect(screen.queryByText(P8)).toBeNull();
      expect(screen.getByRole('heading', { name: 'My Game Collection (1)' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('R8: a Remove answered 404 lands focus on + Add from BGG and the failed refresh shows RF1 over the rest', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    (userGamesAPI.removeOwnedGame as Mock).mockRejectedValueOnce(
      new ApiError('Game not found in your collection', 'not_found', 404)
    );
    renderProfile();

    await twoTapRemove(user, 'Catan');
    await waitFor(() => expect(document.activeElement).toBe(addFromBgg()));
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
  });

  it('R6: the notice, the guard and the focus instance are wired to plan 60\'s refs, which are declared and attached once', async () => {
    const src = await pageSource();
    const count = (needle: string) => src.split(needle).length - 1;
    expect(src).toContain('useFocusRecovery({ fallback: collectionHeadingRef })');
    expect(src).toContain('collectionRecovery.arm({ preferred: () => addFromBggToggleRef.current })');
    expect(src).toContain(
      '<RefreshFailedNotice state={collectionErrorState} retained={collectionRetained} focusTarget={collectionHeadingRef}'
    );
    expect(count('<RetainedContentFocusGuard retained={collectionRetained} focusTarget={collectionHeadingRef} />')).toBe(1);
    expect(count('ref={collectionHeadingRef}')).toBe(1);
    expect(count('ref={addFromBggToggleRef}')).toBe(1);
    expect(count('const addFromBggToggleRef = useRef(null);')).toBe(1);
    expect(count('const collectionHeadingRef = useRef(null);')).toBe(1);
    expect(src).not.toContain(RF1);
  });

  it('G1: an unpressed refresh that withdraws the rows while a row control holds focus lands on the heading', async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    renderProfile();

    await twoTapRemove(user, 'Catan');
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    (userGamesAPI.getOwnedGames as Mock).mockRejectedValue(new ApiError('Forbidden', 'forbidden', 403));
    act(() => { screen.getByRole('button', { name: 'Remove Brass' }).focus(); });
    act(() => { fireVisible(); });

    await screen.findByText(P8);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: /^My Game Collection/ }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole('button', { name: 'Remove Brass' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it("G2: an unpressed refresh that succeeds while the notice's Retry holds focus lands on the heading", async () => {
    const user = userEvent.setup();
    const { userGamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    renderProfile();

    await twoTapRemove(user, 'Catan');
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    act(() => { screen.getByRole('button', { name: 'Retry' }).focus(); });
    (userGamesAPI.getOwnedGames as Mock).mockResolvedValue([OWNED_GAMES[1]]);
    act(() => { fireVisible(); });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'My Game Collection (1)' }))
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Remove Catan' })).toBeNull();
  });
});

describe('Add to Collection in flight (88.6.1-67: D-35, Req 4, Req 5)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  const AZUL_RESULT = { bgg_id: 230802, name: 'Azul', year_published: 2017 };
  const BRASS_RESULT = { bgg_id: 224517, name: 'Brass: Birmingham', year_published: 2018 };
  const AZUL_ROW = { id: 'game-azul', name: 'Azul', bgg_id: 230802, year_published: 2017, image_url: null };
  // The pressed Add's name follows its visible label (P7), so a lookup matches both labels.
  const ADD_NAME = /^(Add to Collection|Adding\.\.\.)$/;

  function deferred<T = unknown>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  function addFromBgg() {
    return screen.getByRole('button', { name: '+ Add from BGG' });
  }

  function searchFor(query: string) {
    fireEvent.click(addFromBgg());
    fireEvent.change(screen.getByRole('textbox', { name: 'Search BoardGameGeek' }), { target: { value: query } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  }

  // The result row's one button, found through the row that names the game (with its year, so a
  // listed card's heading of the same name never matches).
  function rowButton(name: RegExp) {
    return within(screen.getByText(name).closest('div') as HTMLElement).getByRole('button');
  }

  afterEach(async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    // clearAllMocks keeps implementations and queued once-values, so reset to the harness defaults.
    (gamesAPI.searchBGG as Mock).mockReset().mockResolvedValue([]);
    (gamesAPI.importFromBGG as Mock).mockReset().mockResolvedValue({ id: 'game-imported' });
    (userGamesAPI.addOwnedGame as Mock).mockReset().mockResolvedValue({});
    (userGamesAPI.getOwnedGames as Mock).mockReset().mockResolvedValue([]);
  });

  it('A1: a burst of presses sends one import and one add; the pressed Add reads Adding... and stays aria-disabled', async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    const imported = deferred<unknown>();
    (gamesAPI.searchBGG as Mock).mockResolvedValue([AZUL_RESULT]);
    (gamesAPI.importFromBGG as Mock).mockReturnValueOnce(imported.promise);
    renderProfile();
    await screen.findByRole('heading', { name: /^My Game Collection/ });

    searchFor('azul');
    const add = await screen.findByRole('button', { name: 'Add to Collection' });
    fireEvent.click(add);
    await waitFor(() => expect(add).toHaveAttribute('aria-disabled', 'true'));
    expect(add).not.toBeDisabled();
    expect(add.isConnected).toBe(true);
    expect(add.textContent).toBe('Adding...');

    fireEvent.click(add);
    fireEvent.click(add);
    expect(gamesAPI.importFromBGG).toHaveBeenCalledTimes(1);
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add.textContent).toBe('Adding...');

    await act(async () => { imported.resolve({ id: 'game-azul' }); });
    await waitFor(() => expect(userGamesAPI.addOwnedGame).toHaveBeenCalledWith(SELF_UUID, 'game-azul'));
    await act(async () => {});
    expect(userGamesAPI.addOwnedGame).toHaveBeenCalledTimes(1);
  });

  it('A2: while an add is in flight its sibling Adds are natively disabled, and Already Owned stays native', async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock).mockResolvedValue([
      { id: 'game-catan', name: 'Catan', bgg_id: 13, year_published: 1995, image_url: null },
    ]);
    (gamesAPI.searchBGG as Mock).mockResolvedValue([AZUL_RESULT, BRASS_RESULT, { bgg_id: 13, name: 'Catan', year_published: 1995 }]);
    (gamesAPI.importFromBGG as Mock).mockReturnValueOnce(new Promise(() => {}));
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Catan' });

    searchFor('a');
    await screen.findByText(/^Brass: Birmingham/);
    fireEvent.click(rowButton(/^Azul \(2017\)/));
    await waitFor(() => expect(rowButton(/^Azul \(2017\)/)).toHaveAttribute('aria-disabled', 'true'));
    const brass = rowButton(/^Brass: Birmingham/);
    expect(brass).toHaveTextContent('Add to Collection');
    expect(brass).toBeDisabled();
    expect(brass).not.toHaveAttribute('aria-disabled');
    // CONFIRM-ONLY half: the owned game's gate is native today and stays so (rule of KIND).
    expect(screen.getByRole('button', { name: 'Already Owned' })).toBeDisabled();
  });

  it('A3: a successful add closes the panel before the refresh and lands focus on + Add from BGG', async () => {
    const user = userEvent.setup();
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    const refresh = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockReturnValueOnce(refresh.promise);
    (gamesAPI.searchBGG as Mock).mockResolvedValue([AZUL_RESULT]);
    (gamesAPI.importFromBGG as Mock).mockResolvedValueOnce({ id: 'game-azul' });
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Catan' });

    await user.click(addFromBgg());
    await user.type(screen.getByRole('textbox', { name: 'Search BoardGameGeek' }), 'azul');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: ADD_NAME }));

    await waitFor(() => expect(document.activeElement).toBe(addFromBgg()));
    expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2); // the refresh is still held
    expect(toastMock().success).not.toHaveBeenCalledWith('Game added');

    await act(async () => { refresh.resolve([...OWNED_GAMES, AZUL_ROW]); });
    await screen.findByRole('button', { name: 'Remove Azul' });
    await waitFor(() => expect(toastMock().success).toHaveBeenCalledWith('Game added'));
    expect(toastMock().success).toHaveBeenCalledTimes(1);
  });

  it('A4: a failed add releases the latch and the label; toast and diagnostic unchanged', async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    (gamesAPI.searchBGG as Mock).mockResolvedValue([AZUL_RESULT]);
    (userGamesAPI.addOwnedGame as Mock).mockRejectedValueOnce(new Error('boom'));
    renderProfile();
    await screen.findByRole('heading', { name: /^My Game Collection/ });

    searchFor('azul');
    fireEvent.click(await screen.findByRole('button', { name: ADD_NAME }));
    await waitFor(() =>
      expect(toastMock().error).toHaveBeenCalledWith("We couldn't add that game. Please try again.")
    );
    expect(loggerMock().info).toHaveBeenCalledWith('Error adding game to collection:', expect.any(Object));
    const add = screen.getByRole('button', { name: ADD_NAME });
    await waitFor(() => expect(add.textContent).toBe('Add to Collection'));
    expect(add).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('textbox', { name: 'Search BoardGameGeek' })).toBeInTheDocument();

    fireEvent.click(add);
    await waitFor(() => expect(gamesAPI.importFromBGG).toHaveBeenCalledTimes(2));
  });

  it('A5: one focus instance serves Remove and Add, the latch exists, and P7 ships with three ASCII full stops', async () => {
    const src = await pageSource();
    // CODE lines only: a comment that names the arm call is not a second call site.
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    expect(count(code, 'collectionRecovery.arm({ preferred: () => addFromBggToggleRef.current })')).toBe(2);
    expect(src).toContain('addGameInFlightRef');
    expect(count(src, "const ADDING_TO_COLLECTION_LABEL = 'Adding...';")).toBe(1);
    expect(src).not.toContain('Adding…');
  });

  it('A6: the latch is released at the add\'s confirmation and the added game reads as owned before the refresh lands', async () => {
    const { userGamesAPI, gamesAPI } = await import('@/lib/api');
    const refresh = deferred<unknown>();
    (userGamesAPI.getOwnedGames as Mock)
      .mockResolvedValueOnce(OWNED_GAMES)
      .mockReturnValueOnce(refresh.promise);
    (gamesAPI.searchBGG as Mock).mockResolvedValue([AZUL_RESULT, BRASS_RESULT]);
    (gamesAPI.importFromBGG as Mock).mockResolvedValueOnce({ id: 'game-azul' });
    (userGamesAPI.addOwnedGame as Mock).mockResolvedValueOnce({ message: 'Game added to your collection', game: AZUL_ROW });
    renderProfile();
    await screen.findByRole('button', { name: 'Remove Catan' });

    searchFor('azul');
    await screen.findByText(/^Brass: Birmingham/);
    const azulAdd = rowButton(/^Azul \(2017\)/);
    act(() => { azulAdd.focus(); });
    fireEvent.click(azulAdd);
    await waitFor(() => expect(document.activeElement).toBe(addFromBgg()));

    // The refresh is still held: reopen the search.
    searchFor('azul');
    await screen.findByText(/^Brass: Birmingham/);
    const brass = rowButton(/^Brass: Birmingham/);
    expect(brass).toHaveTextContent('Add to Collection');
    expect(brass).not.toBeDisabled();
    expect(brass).not.toHaveAttribute('aria-disabled');
    const azul = rowButton(/^Azul \(2017\)/);
    expect(azul).toHaveTextContent('Already Owned');
    expect(azul).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Azul' })).toBeInTheDocument();
    expect(userGamesAPI.getOwnedGames).toHaveBeenCalledTimes(2);

    await act(async () => { refresh.resolve([...OWNED_GAMES, AZUL_ROW]); });
    expect(screen.getAllByRole('button', { name: 'Remove Azul' })).toHaveLength(1);
  });
});

describe('a failed identity refresh on Profile is labelled (88.6.1-79, D-51, RF1)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  // Copy row RF1 (D-47, owner-ratified) — declared once here (88.6.1-70 contract C7); the page
  // itself never spells it (plan 70's one constant renders it).
  const RF1 = "Couldn't refresh. Showing what loaded earlier.";
  const ROW_ADDRESS = 'row-address@example.com';

  beforeEach(async () => {
    const { userGamesAPI, googleCalendarAPI } = await import('@/lib/api');
    (userGamesAPI.getOwnedGames as Mock).mockResolvedValue(OWNED_GAMES);
    // Re-set explicitly: earlier describes leave `getStatus` answering connected.
    (googleCalendarAPI.getStatus as Mock).mockResolvedValue({ connected: false });
  });
  afterEach(async () => {
    const { userGamesAPI, googleCalendarAPI } = await import('@/lib/api');
    // The persistence trap: clearAllMocks keeps an implementation, so restore the defaults here.
    (userGamesAPI.getOwnedGames as Mock).mockResolvedValue([]);
    (googleCalendarAPI.getStatus as Mock).mockResolvedValue({ connected: false });
    document.querySelectorAll('main[data-k-main]').forEach((m) => m.remove());
  });

  // The mocked identity hook reads `h` on render, so a changed query state commits only on a render.
  async function commit(rerender: (ui: React.ReactElement) => void) {
    await act(async () => { rerender(<Profile />); });
  }
  function mainContainer(): HTMLElement {
    const main = document.createElement('main');
    main.setAttribute('data-k-main', '');
    document.body.appendChild(main);
    return main;
  }
  // The unpressed re-attempt: a tab return, the useFetchErrorState.test.tsx idiom.
  function fireVisible() {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  const visibleRf1 = (root: HTMLElement) => {
    const node = within(root).getAllByText(RF1).find((n) => !n.closest('.sr-only'));
    if (!node) throw new Error('no visible RF1 line');
    return node;
  };
  const collectionCard = () => {
    const card = screen.getByRole('heading', { name: /^My Game Collection/ }).closest('.card');
    if (!(card instanceof HTMLElement)) throw new Error('no collection card');
    return card;
  };

  async function healthy(container?: HTMLElement) {
    const view = renderProfile({ username: 'RealName' }, container ? { container } : {});
    await screen.findByRole('heading', { level: 1, name: 'RealName' });
    return view;
  }

  it('K1: a 500 refresh keeps the name under the header card RF1 notice, with no full banner', async () => {
    const view = await healthy();
    h.selfError = new ApiError('Server error', 'internal', 500);
    await commit(view.rerender);

    await waitFor(() => expect(within(headerCard()).getAllByText(RF1)).toHaveLength(2));
    const heading = screen.getByRole('heading', { level: 1, name: 'RealName' });
    expect(visibleRf1(headerCard()).compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(headerCard()).queryByText('Something went wrong')).toBeNull();
  });

  it('K2: the RF1 region is one of the header card status nodes present before the failure', async () => {
    const view = await healthy();
    const before = within(headerCard()).queryAllByRole('status');
    h.selfError = new ApiError('Server error', 'internal', 500);
    await commit(view.rerender);

    await waitFor(() => expect(within(headerCard()).getAllByText(RF1)).toHaveLength(2));
    const region = within(headerCard()).getAllByRole('status').find((n) => n.textContent === RF1);
    expect(region).toBeDefined();
    expect(before).toContain(region);
  });

  it('K3: Retry recovers, the notice leaves and focus lands on the page h1, never body', async () => {
    const user = userEvent.setup();
    const view = await healthy(mainContainer());
    h.selfError = new ApiError('Server error', 'internal', 500);
    await commit(view.rerender);
    await waitFor(() => expect(within(headerCard()).getAllByText(RF1)).toHaveLength(2));

    h.refetchSelf.mockImplementation(async () => { h.selfError = null; return { isError: false }; });
    await user.click(within(headerCard()).getByRole('button', { name: 'Retry' }));
    await commit(view.rerender);

    await waitFor(() => expect(within(headerCard()).queryAllByText(RF1)).toHaveLength(0));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'RealName' }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  async function withdrawnCase(err: ApiError) {
    const view = await healthy();
    // Positive signal: the collection list renders live over the healthy row.
    await screen.findByRole('button', { name: 'Remove Catan' });
    h.selfError = err;
    await commit(view.rerender);

    const line = (await within(headerCard()).findAllByText(getFetchErrorMessage(err)))[0];
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName('Self');
    expect(screen.queryByRole('heading', { level: 1, name: 'RealName' })).toBeNull();
    expect(headings[0].compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Google Calendar Integration' })).toBeInTheDocument();
    // Review #117: the collection card shows its existing compact notice, no live Remove control.
    const card = collectionCard();
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(card).queryAllByRole('button', { name: /^Remove / })).toHaveLength(0);
  }

  it('K4: a 401 over the kept row withdraws it; the page keeps one h1 (the session name) above the register line', async () => {
    await withdrawnCase(new ApiError('Unauthorized', 'unauthorized', 401));
  });

  it('K5: a 403 over the kept row withdraws it; the page keeps one h1 (the session name) above the register line', async () => {
    await withdrawnCase(new ApiError('Forbidden', 'forbidden', 403));
  });

  it('K6: a network failure keeps the name under RF1', async () => {
    const view = await healthy();
    h.selfError = new ApiError('Network error', 'network', 0);
    await commit(view.rerender);

    await waitFor(() => expect(within(headerCard()).getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { level: 1, name: 'RealName' })).toBeInTheDocument();
  });

  it('K7: a 403 then a 500 stays withdrawn; the next success brings the row back (C10 memory)', async () => {
    const view = await healthy();
    const forbidden = new ApiError('Forbidden', 'forbidden', 403);
    h.selfError = forbidden;
    await commit(view.rerender);
    await within(headerCard()).findAllByText(getFetchErrorMessage(forbidden));

    h.selfError = new ApiError('Server error', 'internal', 500);
    await commit(view.rerender);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Self');
    expect(screen.queryByRole('heading', { level: 1, name: 'RealName' })).toBeNull();

    h.selfError = null;
    await commit(view.rerender);
    expect(await screen.findByRole('heading', { level: 1, name: 'RealName' })).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('K8: an unpressed re-attempt answered 403, then 401, withdraws the focused pencil and focus lands on the h1, never body (C12 a)', async () => {
    for (const err of [
      new ApiError('Forbidden', 'forbidden', 403),
      new ApiError('Unauthorized', 'unauthorized', 401),
    ]) {
      const view = await healthy(mainContainer());
      h.selfError = new ApiError('Server error', 'internal', 500);
      await commit(view.rerender);
      await waitFor(() => expect(within(headerCard()).getAllByText(RF1)).toHaveLength(2));

      act(() => screen.getByRole('button', { name: 'Edit username' }).focus());
      h.refetchSelf.mockImplementation(async () => { h.selfError = err; return { isError: true }; });
      await act(async () => { fireVisible(); });
      await commit(view.rerender);

      expect(screen.queryByRole('button', { name: 'Edit username' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })));
      expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Self');
      expect(document.activeElement).not.toBe(document.body);

      cleanup();
      document.querySelectorAll('main[data-k-main]').forEach((m) => m.remove());
      h.selfError = null;
      h.refetchSelf.mockReset();
    }
  });

  it('K9: the notice Retry holds focus and an unpressed re-attempt succeeds; focus lands on the RealName h1 (C12 b)', async () => {
    const view = await healthy(mainContainer());
    h.selfError = new ApiError('Server error', 'internal', 500);
    await commit(view.rerender);
    await waitFor(() => expect(within(headerCard()).getAllByText(RF1)).toHaveLength(2));

    act(() => within(headerCard()).getByRole('button', { name: 'Retry' }).focus());
    h.refetchSelf.mockImplementation(async () => { h.selfError = null; return { isError: false }; });
    await act(async () => { fireVisible(); });
    await commit(view.rerender);

    await waitFor(() => expect(within(headerCard()).queryAllByText(RF1)).toHaveLength(0));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'RealName' }))
    );
  });

  it('K10: an access answer puts the Email card on its unavailable arm (said, not empty), and a success restores it (review #125)', async () => {
    const view = renderProfile({ username: 'RealName', email: ROW_ADDRESS });
    await screen.findByRole('heading', { level: 1, name: 'RealName' });
    const emailRegion = () => screen.getByRole('region', { name: 'Email' });
    expect(await within(emailRegion()).findByText(ROW_ADDRESS)).toBeInTheDocument();
    expect(within(emailRegion()).getByRole('button', { name: 'Change' })).toBeInTheDocument();

    const forbidden = new ApiError('Forbidden', 'forbidden', 403);
    h.selfError = forbidden;
    await commit(view.rerender);
    await within(headerCard()).findAllByText(getFetchErrorMessage(forbidden));

    expect(within(emailRegion()).queryByText(ROW_ADDRESS)).toBeNull();
    expect(within(emailRegion()).queryByRole('button', { name: 'Change' })).toBeNull();
    const said = await within(emailRegion()).findByText(UNAVAILABLE_COPY);
    expect(said).not.toHaveClass('sr-only');

    h.selfError = null;
    await commit(view.rerender);
    expect(await within(emailRegion()).findByText(ROW_ADDRESS)).toBeInTheDocument();
    expect(within(emailRegion()).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(within(emailRegion()).queryByText(UNAVAILABLE_COPY)).toBeNull();
  });

  it('K11: the access memory survives a remount over the cached identity entry (C10 TanStack source)', async () => {
    // This suite mocks the identity hook, so there is no real cache. A fake QueryClientContext
    // stands in for the one property a real cache gives: the SAME entry object for the identity
    // key on both sides of an unmount (plan 59's P11 shape). Every other key finds nothing.
    const selfEntry = {};
    const fakeClient = {
      getQueryCache: () => ({
        find: (filters: { queryKey?: unknown }) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(['users', 'self', h.authUser.sub])
            ? selfEntry
            : undefined,
      }),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientContext.Provider value={fakeClient as never}>{children}</QueryClientContext.Provider>
    );
    const first = renderProfile({ username: 'RealName' }, { wrapper });
    await screen.findByRole('heading', { level: 1, name: 'RealName' });

    const forbidden = new ApiError('Forbidden', 'forbidden', 403);
    h.selfError = forbidden;
    await commit(first.rerender);
    await within(headerCard()).findAllByText(getFetchErrorMessage(forbidden));
    h.selfError = new ApiError('Server error', 'internal', 500);
    await commit(first.rerender);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Self');
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    first.unmount();
    // `h` unchanged: the held row and the 500 a real cache would still hold.
    const second = renderProfile({ username: 'RealName' }, { wrapper });
    expect(await screen.findByRole('heading', { level: 1, name: 'Self' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'RealName' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    h.selfError = null;
    await commit(second.rerender);
    expect(await screen.findByRole('heading', { level: 1, name: 'RealName' })).toBeInTheDocument();
  });
});
