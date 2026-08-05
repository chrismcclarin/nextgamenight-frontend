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
// * plan 88-19 extends this file with the 16px control pins for the profile's
//   inputs/selects.
//
// DECISION Phase 88 plan 06 (now historical — kept as the record): the extension
// points above were originally written as PROSE, not as the literal
// attribute/matcher tokens they describe, because 88-06's acceptance gate
// grepped this file to prove those assertions were absent at the time (the same
// false-positive failure mode hit plans 88-01..05). That gate has run; 88-10
// then wrote the real assertions, which is why the literals now appear in the
// test bodies below. Do not "restore" the prose form over a live assertion.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
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
    user: { sub: 'auth0|self', name: 'Self', email: 'self@example.com', picture: null },
    error: null,
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
    useQuery: () => ({ data: [], isPending: false, isError: false, error: null, refetch: vi.fn() }),
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
vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
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

// Req 5's acceptance criterion, and the composed audit DEF-88-12-04 asks for: the
// primitives' own suites audit them with trivial children and cannot see a
// violation living in a CONSUMER's composed content — which is where the three
// this run found (an unnamed select, two unnamed phone fields) all lived.
describe('userProfile a11y audit', () => {
  it('passes an axe audit on the default surface', async () => {
    const { container } = renderProfile();
    await screen.findByRole('switch', { name: 'New Event email notifications' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('passes an axe audit with the SMS-entitled surface composed in', async () => {
    const { container } = renderProfile({ sms_enabled: true, phone_verified: false });
    await screen.findByRole('switch', { name: 'New Event SMS notifications' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
