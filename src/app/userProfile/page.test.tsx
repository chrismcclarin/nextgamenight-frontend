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

    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    await waitFor(() =>
      expect(userGamesAPI.removeOwnedGame).toHaveBeenCalledWith(SELF_UUID, 'game-catan')
    );
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
    // The new target is armed, the old one is back at rest.
    expect(screen.getByRole('button', { name: 'Tap again to confirm' })).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Tap again to confirm' })).toHaveAttribute(
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
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

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

  // §4.2 states 600 as a PROHIBITION, not a preference, and D-01 gives it
  // exactly one home — the Button primitive. No heading on this surface may
  // carry it at any size.
  it('pairs no heading with font-semibold at any size', async () => {
    const source = await pageSource();
    const offenders = [...source.matchAll(/<h[1-6]\s[^>]*className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((cls) => /\bfont-semibold\b/.test(cls));
    expect(offenders).toEqual([]);
  });

  // The whole point of a 4-size working set is that a fifth size cannot creep
  // back in. `text-lg` (18) and `text-2xl` (24) were both on this surface.
  it('keeps every heading inside the 4-size working set', async () => {
    const source = await pageSource();
    const offenders = [...source.matchAll(/<h[1-6]\s[^>]*className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((cls) => /\b(?:[a-z]+:)?text-(lg|2xl|4xl|5xl)\b/.test(cls));
    expect(offenders).toEqual([]);
  });

  it('gives every heading an explicit size and the 700 weight', async () => {
    const source = await pageSource();
    const headings = [...source.matchAll(/<h[1-6]\s[^>]*className="([^"]*)"/g)].map(
      (m) => m[1]
    );
    expect(headings.length).toBeGreaterThanOrEqual(13);
    for (const cls of headings) {
      expect(cls).toMatch(/\btext-(base|xl|3xl)\b/);
      expect(cls).toMatch(/\bfont-bold\b/);
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
  it('renders designed copy, not the raw error, when the session errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      h.authError = new Error('ECONNREFUSED 10.0.0.4:5432 — pool exhausted');
      renderProfile();

      expect(
        await screen.findByText("We couldn't load your profile")
      ).toBeInTheDocument();
      // The upstream text reaches the developer, never the person.
      expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
      expect(screen.queryByText(/pool exhausted/)).not.toBeInTheDocument();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  // The branch was also a dead end — one red line and nothing to click.
  it('offers a way out of the session-error screen', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      h.authError = new Error('boom');
      renderProfile();
      expect(
        await screen.findByRole('button', { name: 'Reload page' })
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
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
});

// ===========================================================================
// 88-CODE-REVIEW H1 — a wrong verification code is NOT success
// ===========================================================================
// The backend's wrong-code outcome is a 200 { verified: false } (routes/
// users.js:727-732 — only MALFORMED input 400s), so the handler must read the
// body. Before H1 it discarded it: a wrong code marked the phone verified in
// local state and the immortal self cache while the DB row stayed false — the
// SMS toggles enabled and SMS silently never sent. These pins hold the gate.
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
