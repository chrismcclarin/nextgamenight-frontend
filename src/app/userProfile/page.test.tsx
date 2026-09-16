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
 * `preferences` is derived from `notification_preferences`, and the whole
 * Notification Preferences card is gated on it — an identity row without it
 * renders no toggles at all.
 */
const h = vi.hoisted(() => ({
  self: undefined as undefined | Record<string, unknown>,
  /**
   * Availability rows the mocked `useQuery` returns. Held here (not baked into
   * the mock) so the two-tap delete pins can render real rows without a
   * QueryClientProvider. Plan 88-10 added this; the default stays `[]` so every
   * pre-existing test sees exactly what it saw before.
   */
  patterns: [] as Record<string, unknown>[],
  /**
   * The Auth0 row, held as ONE object rather than rebuilt inside the mock factory.
   * Identity matters: the page's owned-games / calendar-status effect depends on
   * `user`, so a mock that returns a fresh object literal per render re-runs that
   * effect on EVERY render — which flips `loadingGames` back to true and unmounts
   * the collection grid mid-interaction. The real `useUser` returns a stable
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
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: h.self,
    selfUuid: h.self?.id as string | undefined,
    query: { isError: false, error: null, isPending: !h.self, refetch: vi.fn() },
    isPending: !h.self,
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
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
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
  useTutorial: () => ({ replayTutorial: vi.fn() }),
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
export function renderProfile(selfOverrides: Record<string, unknown> = {}) {
  h.self = {
    id: SELF_UUID,
    user_id: 'auth0|self',
    username: 'Self',
    sms_enabled: false,
    phone_verified: false,
    notification_preferences: DEFAULT_PREFS,
    ...selfOverrides,
  };
  return render(<Profile />);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.self = undefined;
  h.patterns = [];
  h.authError = null;
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
    expect(headingTags(source).length).toBe(14);
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
    expect(tags.length).toBe(14);
    const offenders = tags.filter((attrs) =>
      /\b(?:[a-z]+:)?text-(?:lg|2xl|4xl|5xl)\b/.test(attrs)
    );
    expect(offenders).toEqual([]);
  });

  it('gives every heading an explicit size and an explicit level', async () => {
    const source = await pageSource();
    const tags = headingTags(source);
    expect(tags.length).toBe(14);
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
    expect(counts).toEqual({ '1': 1, '2': 7, '3': 4, '4': 2 });
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
    expect(h1).toHaveLength(1);
    expect(h1[0]).not.toMatch(/\b(?:truncate|line-clamp-\d|text-ellipsis|whitespace-nowrap)\b/);
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
// The backend's wrong-code outcome is a 200 { verified: false } (routes/
// users.js:727-732 — only MALFORMED input 400s), so the handler must read the
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
      'Please select at least one day.',
      'Start time must be before end time.',
      'Schedules created',
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

describe('phone verification — wrong code shows error, never verifies (H1)', () => {
  async function reachArmedVerify() {
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
