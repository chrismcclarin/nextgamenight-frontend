// Phase 87.5 Plan 09 (SPEC Req 6): behavioral net for the TimezoneProvider
// sender flip. The timezone persist lives INSIDE the user-action setTimezone
// callback (NOT a mount effect), so this test proves two things:
//
//  (a) invoking setTimezone via the provider context with selfUuid resolved
//      persists the caller's UUID (not user.sub); and
//  (b) mounting the provider — and selfUuid transitioning undefined→resolved —
//      does NOT persist anything on its own. This guards the locked Phase 62
//      "no auto-sync from mount-time browser detection" policy: a mount-fire
//      send here would reintroduce the silent profile-TZ-overwrite bug.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// AMENDED Phase 88.9-68 (X33b / Q8 harness): the mock now models the real self cache. It used
// to build a NEW self object on every render with the stored zone always null, and
// patchSelfCache was a bare spy, so the provider's read effect re-ran on every render and
// nothing a save wrote could be read back. Now: ONE stable self object per (selfUuid, stored
// zone), read through useSyncExternalStore, and the patchSelfCache mock writes the stored zone
// and notifies, which forces the re-render the real setQueriesData causes.
type SelfRow = { id: string; user_id: string; timezone: string | null };
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  storedTz: null as string | null,
  listeners: new Set<() => void>(),
  snapshot: null as { key: string; self: SelfRow } | null,
  // A-27 (88.9-52): a counting stand-in for the browser-zone read.
  detect: vi.fn(() => 'UTC'),
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => {
  const subscribe = (listener: () => void) => {
    h.listeners.add(listener);
    return () => {
      h.listeners.delete(listener);
    };
  };
  const readSelf = (): SelfRow | undefined => {
    if (!h.selfUuid) return undefined;
    const key = `${h.selfUuid}|${h.storedTz ?? ''}`;
    if (!h.snapshot || h.snapshot.key !== key) {
      h.snapshot = {
        key,
        self: { id: h.selfUuid, user_id: 'auth0|self', timezone: h.storedTz },
      };
    }
    return h.snapshot.self;
  };
  return {
    SELF_IDENTITY_KEY: ['users', 'self'],
    useSelfIdentity: () => {
      const self = React.useSyncExternalStore(subscribe, readSelf, readSelf);
      return {
        selfUuid: h.selfUuid,
        self,
        query: { isError: false, error: null, isPending: !h.selfUuid, refetch: vi.fn() },
        isPending: !h.selfUuid,
      };
    },
  };
});

vi.mock('@/lib/hooks/selfIdentityCache', () => ({
  patchSelfCache: vi.fn((_queryClient: unknown, patch: { timezone?: string | null }) => {
    if (patch && 'timezone' in patch) {
      h.storedTz = patch.timezone ?? null;
      h.listeners.forEach((listener) => listener());
    }
  }),
}));

// The provider reports a failed save once through logger.error (X33b); a spy so the X33b and
// Q8 arms can count it and nothing reaches Sentry.
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ML-02 (87.5 review): the pre-resolution guard surfaces via toast, not throw —
// mock sonner so the guard test can assert the user actually gets feedback.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));

vi.mock('@/lib/datetime', () => ({ detectBrowserTimezone: () => h.detect() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    usersAPI: { ...actual.usersAPI, updateTimezone: vi.fn().mockResolvedValue({}) },
  };
});

import { TimezoneProvider, useTimezone } from './TimezoneProvider';
import { ApiError, usersAPI } from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { patchSelfCache } from '@/lib/hooks/selfIdentityCache';

type Mock = ReturnType<typeof vi.fn>;

function TZConsumer() {
  // The context's default value types setTimezone as `() => void`; the live
  // provider value is the async `(tz) => Promise<void>` callback. Narrow it here.
  const { setTimezone } = useTimezone() as unknown as {
    setTimezone: (tz: string) => Promise<void>;
  };
  return (
    <button onClick={() => { void setTimezone('America/Chicago'); }}>set-tz</button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  h.storedTz = null;
  h.snapshot = null;
  h.listeners.clear();
});

afterEach(cleanup);

describe('TimezoneProvider identity flip (Plan 09 Task 2)', () => {
  it('persists the resolved selfUuid when setTimezone is invoked by the user', async () => {
    h.selfUuid = SELF_UUID;
    render(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );

    fireEvent.click(screen.getByText('set-tz'));

    await waitFor(() =>
      expect(usersAPI.updateTimezone as Mock).toHaveBeenCalledWith(SELF_UUID, 'America/Chicago')
    );
  });

  it('does NOT persist on mount or on selfUuid resolving alone (locked Phase 62 no-auto-sync)', async () => {
    // Mount with identity unresolved — no user action.
    h.selfUuid = undefined;
    const { rerender } = render(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(usersAPI.updateTimezone as Mock).not.toHaveBeenCalled();

    // Identity resolves — still no user action, so still no persist.
    h.selfUuid = SELF_UUID;
    rerender(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(usersAPI.updateTimezone as Mock).not.toHaveBeenCalled();
  });

  it('ML-02: setTimezone before identity resolves toasts an error and sends nothing (no throw — sole caller is fire-and-forget)', async () => {
    h.selfUuid = undefined; // logged-in (mocked auth sub) but identity unresolved
    render(
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );

    // Fires the guard; must NOT reject (the click handler does not await).
    fireEvent.click(screen.getByText('set-tz'));

    await waitFor(() => expect(toast.error as Mock).toHaveBeenCalled());
    expect(usersAPI.updateTimezone as Mock).not.toHaveBeenCalled();
  });
});

describe('TimezoneProvider browser-zone reads (88.9-52, A-27)', () => {
  it('A-27: a re-render with nothing changed does not read the browser zone again', () => {
    h.selfUuid = SELF_UUID;
    // A NEW element each time: React skips a re-render of the very same element object.
    const tree = () => (
      <TimezoneProvider>
        <TZConsumer />
      </TimezoneProvider>
    );
    const { rerender } = render(tree());
    const afterMount = h.detect.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    // Same props, same self row: the read effect does not re-run, so every extra read here would
    // come from the render body (the saved-zone ref built its starting value on every render).
    rerender(tree());
    rerender(tree());
    expect(h.detect.mock.calls.length).toBe(afterMount);
  });
});

describe('TimezoneProvider says whether the profile timezone is KNOWN (88.9-52, W46)', () => {
  const known = () => screen.getByTestId('tz-known').textContent;
  const set = () => screen.getByTestId('tz-set').textContent;
  const mount = () =>
    render(
      <TimezoneProvider>
        <TZProbe zones={[]} />
      </TimezoneProvider>
    );

  it('W46: not known while the self row is pending or its read failed (no row), known and unset once a row with no zone is read, known and set once a row with a zone is read', async () => {
    // No self row (the harness's pending and failed-with-nothing-cached shape): unknown, not "unset".
    h.selfUuid = undefined;
    const pending = mount();
    await act(async () => {});
    expect(known()).toBe('false');
    expect(set()).toBe('false');
    pending.unmount();

    // A row with no stored zone: now it is known that none is set.
    h.selfUuid = SELF_UUID;
    h.storedTz = null;
    const unset = mount();
    await waitFor(() => expect(known()).toBe('true'));
    expect(set()).toBe('false');
    unset.unmount();

    // A row with a stored zone: known and set.
    h.storedTz = 'Europe/Paris';
    h.snapshot = null;
    mount();
    await waitFor(() => expect(known()).toBe('true'));
    expect(set()).toBe('true');
  });
});

// 88.9-68 (X33b and owner ruling Q8 b). setTimezone now answers whether the save landed, sends
// saves one at a time in pick order, and puts the last SAVED zone back on screen when a save
// fails with no later pick pending. The probe prints the provider's value and records what each
// pick resolved to; the stored zone is the harness's model of the self cache (see the mock above).
type TzValue = {
  timezone: string;
  isProfileTimezoneSet: boolean;
  isProfileTimezoneKnown: boolean;
  setTimezone: (tz: string, options?: { onSaveFailed?: (message: string) => void }) => Promise<unknown>;
};

const picked: Array<{ tz: string; ok: unknown }> = [];
// T1 (88.9-52, owner pick Field): what a caller with its own place for the failure was handed.
const handed: Array<{ tz: string; message: string }> = [];

// A caller that shows the failure itself (the Profile page): it passes onSaveFailed.
function TZFieldProbe({ zones }: { zones: string[] }) {
  const { timezone, setTimezone } = useTimezone() as unknown as TzValue;
  return (
    <div>
      <output data-testid="tz">{timezone}</output>
      {zones.map((zone) => (
        <button
          key={zone}
          onClick={() => {
            void setTimezone(zone, { onSaveFailed: (message) => handed.push({ tz: zone, message }) }).then((ok) => {
              picked.push({ tz: zone, ok });
            });
          }}
        >
          {`pick ${zone}`}
        </button>
      ))}
    </div>
  );
}

function TZProbe({ zones }: { zones: string[] }) {
  const { timezone, isProfileTimezoneSet, isProfileTimezoneKnown, setTimezone } = useTimezone() as unknown as TzValue;
  return (
    <div>
      <output data-testid="tz">{timezone}</output>
      <output data-testid="tz-set">{String(isProfileTimezoneSet)}</output>
      <output data-testid="tz-known">{String(isProfileTimezoneKnown)}</output>
      {zones.map((zone) => (
        <button
          key={zone}
          onClick={() => {
            void setTimezone(zone).then((ok) => {
              picked.push({ tz: zone, ok });
            });
          }}
        >
          {`pick ${zone}`}
        </button>
      ))}
    </div>
  );
}

function deferred<T = unknown>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TimezoneProvider save result, pick order and revert (88.9-68: X33b, Q8)', () => {
  const TOKYO = 'Asia/Tokyo';
  const BERLIN = 'Europe/Berlin';
  const PARIS = 'Europe/Paris';
  const DENVER = 'America/Denver';
  const update = () => usersAPI.updateTimezone as Mock;
  const onScreen = () => screen.getByTestId('tz').textContent;
  const isSet = () => screen.getByTestId('tz-set').textContent;
  const pick = (zone: string) => fireEvent.click(screen.getByText(`pick ${zone}`));
  const mountProbe = (zones: string[]) =>
    render(
      <TimezoneProvider>
        <TZProbe zones={zones} />
      </TimezoneProvider>
    );

  beforeEach(() => {
    picked.length = 0;
    handed.length = 0;
    // clearAllMocks keeps queued once-values; start every test from the harness default.
    update().mockReset().mockResolvedValue({});
  });

  it('X33b (88.9-68): setTimezone resolves true once the save lands and false after a failed save or the identity guard; a failed save reports once through logger.error and a 401 shows the session-expired line; saves reach the server in pick order', async () => {
    // The identity guard: signed in, identity not resolved. Nothing is sent, and it resolves false.
    h.selfUuid = undefined;
    const guarded = mountProbe([TOKYO]);
    pick(TOKYO);
    await waitFor(() => expect(picked).toEqual([{ tz: TOKYO, ok: false }]));
    expect(update()).not.toHaveBeenCalled();
    guarded.unmount();
    picked.length = 0;
    vi.mocked(toast.error).mockClear();

    h.selfUuid = SELF_UUID;
    mountProbe([TOKYO, BERLIN]);

    // A save that lands: true, after the PATCH and the cache patch; nothing logged, no toast.
    pick(TOKYO);
    await waitFor(() => expect(picked).toEqual([{ tz: TOKYO, ok: true }]));
    expect(update()).toHaveBeenCalledWith(SELF_UUID, TOKYO);
    expect(vi.mocked(patchSelfCache)).toHaveBeenCalledWith(expect.anything(), { timezone: TOKYO });
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    // A save that fails for an unknown cause: false, logged once, the shipped sentence.
    const boom = new Error('boom');
    update().mockRejectedValueOnce(boom);
    pick(BERLIN);
    await waitFor(() => expect(picked).toHaveLength(2));
    expect(picked[1]).toEqual({ tz: BERLIN, ok: false });
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('Failed to update timezone', boom);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to save your timezone — please try again.');

    // A 401: the register's session-expired line, never the fallback.
    update().mockRejectedValueOnce(new ApiError('Unauthorized', 'unauthorized', 401));
    pick(BERLIN);
    await waitFor(() => expect(picked).toHaveLength(3));
    expect(picked[2]).toEqual({ tz: BERLIN, ok: false });
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.error)).toHaveBeenLastCalledWith('Your session may have expired. Sign in again to continue.');

    // T1 (88.9-52, owner ruling A): a server failure (a 500, and a misconfiguration on our end)
    // reads the timezone sentence too, never the register's shared server-error line.
    for (const [code, status] of [['internal', 500], ['config', 503]] as const) {
      update().mockRejectedValueOnce(new ApiError('Server said no', code, status));
      pick(BERLIN);
      await waitFor(() => expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(code === 'internal' ? 3 : 4));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenLastCalledWith('Failed to save your timezone — please try again.')
      );
    }
    await waitFor(() => expect(picked).toHaveLength(5));
    picked.length = 3;

    // Pick order: with the first PATCH still out, the second is not sent until the first settles.
    const first = deferred();
    update().mockReturnValueOnce(first.promise);
    const sentBefore = update().mock.calls.length;
    pick(TOKYO);
    pick(BERLIN);
    await act(async () => {});
    expect(update().mock.calls.length).toBe(sentBefore + 1);
    expect(update()).toHaveBeenLastCalledWith(SELF_UUID, TOKYO);
    await act(async () => {
      first.resolve({});
    });
    await waitFor(() => expect(update().mock.calls.length).toBe(sentBefore + 2));
    expect(update()).toHaveBeenLastCalledWith(SELF_UUID, BERLIN);
    await waitFor(() => expect(picked).toHaveLength(5));
    expect(picked.slice(3)).toEqual([
      { tz: TOKYO, ok: true },
      { tz: BERLIN, ok: true },
    ]);
  });

  it('Q8 (88.9-68): a failed save puts the last saved zone back on screen with the error toast, and a failed earlier pick never reverts a later pick and shows no toast', async () => {
    // Stored Europe/Paris against the mocked browser zone UTC, so a revert to the SAVED zone is
    // told apart from a fall back to the browser's.
    h.selfUuid = SELF_UUID;
    h.storedTz = PARIS;
    mountProbe([TOKYO, BERLIN, DENVER]);
    await waitFor(() => expect(onScreen()).toBe(PARIS));
    expect(isSet()).toBe('true');

    // One pick, its save fails: the pick shows at once, then the saved zone is back, one toast.
    const lone = deferred();
    update().mockReturnValueOnce(lone.promise);
    pick(TOKYO);
    expect(onScreen()).toBe(TOKYO);
    await act(async () => {
      lone.reject(new Error('lone'));
    });
    await waitFor(() => expect(onScreen()).toBe(PARIS));
    expect(isSet()).toBe('true');
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(picked).toEqual([{ tz: TOKYO, ok: false }]));

    // Two picks, the EARLIER one fails while the later is still saving: logged, no toast, and the
    // later pick stays on screen; when it lands it is still there.
    vi.mocked(toast.error).mockClear();
    vi.mocked(logger.error).mockClear();
    let a = deferred();
    let b = deferred();
    update().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    pick(TOKYO);
    pick(BERLIN);
    expect(onScreen()).toBe(BERLIN);
    await act(async () => {
      a.reject(new Error('earlier'));
    });
    await waitFor(() => expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(update()).toHaveBeenLastCalledWith(SELF_UUID, BERLIN)); // the later PATCH is out
    expect(onScreen()).toBe(BERLIN);
    expect(isSet()).toBe('true');
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    await act(async () => {
      b.resolve({});
    });
    await waitFor(() => expect(picked).toHaveLength(3));
    expect(picked.slice(1)).toEqual([
      { tz: TOKYO, ok: false },
      { tz: BERLIN, ok: true },
    ]);
    expect(onScreen()).toBe(BERLIN);
    expect(h.storedTz).toBe(BERLIN);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);

    // The earlier pick LANDS while the later is still saving: its cache patch re-renders the
    // provider with a new self row, and the later pick is still on screen.
    a = deferred();
    b = deferred();
    update().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    pick(DENVER);
    pick(TOKYO);
    expect(onScreen()).toBe(TOKYO);
    await act(async () => {
      a.resolve({});
    });
    await waitFor(() => expect(h.storedTz).toBe(DENVER)); // the earlier save landed and patched the cache
    await waitFor(() => expect(update()).toHaveBeenLastCalledWith(SELF_UUID, TOKYO));
    await act(async () => {});
    expect(onScreen()).toBe(TOKYO);

    // ...and then the later pick FAILS: the screen shows the earlier pick (the zone the server
    // now holds), with one toast.
    await act(async () => {
      b.reject(new Error('later'));
    });
    await waitFor(() => expect(onScreen()).toBe(DENVER));
    expect(isSet()).toBe('true');
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(picked).toHaveLength(5));
    expect(picked.slice(3)).toEqual([
      { tz: DENVER, ok: true },
      { tz: TOKYO, ok: false },
    ]);
  });

  // T1 (88.9-52, owner pick Field, 2026-11-17: I thought we were making a toast next to the
  // Timezones, not a notice at the top of the page). A caller with a Timezone field on screen
  // passes onSaveFailed and shows the line beside its field; the provider then raises NO toast.
  // A caller that passes nothing keeps the toast (the X33b and Q8 tests above).
  it('T1 (88.9-52): a caller that passes onSaveFailed is handed the failure line and no toast is raised: the timezone sentence for an unknown cause and for a failure on our side, the register line for signed-out, offline and going too fast, the still-loading line at the identity guard; a failed earlier pick with a later one pending hands nothing', async () => {
    const SENTENCE = 'Failed to save your timezone — please try again.';
    const mountField = (zones: string[]) =>
      render(
        <TimezoneProvider>
          <TZFieldProbe zones={zones} />
        </TimezoneProvider>
      );

    // The identity guard: nothing sent, false, the still-loading line handed over, no toast.
    h.selfUuid = undefined;
    const guarded = mountField([TOKYO]);
    pick(TOKYO);
    await waitFor(() => expect(picked).toEqual([{ tz: TOKYO, ok: false }]));
    expect(update()).not.toHaveBeenCalled();
    expect(handed).toEqual([{ tz: TOKYO, message: 'Your account is still loading — please try again in a moment.' }]);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    guarded.unmount();
    picked.length = 0;
    handed.length = 0;

    h.selfUuid = SELF_UUID;
    h.storedTz = PARIS;
    mountField([TOKYO, BERLIN]);
    await waitFor(() => expect(onScreen()).toBe(PARIS));

    const cases: Array<[unknown, string]> = [
      [new Error('boom'), SENTENCE],
      [new ApiError('Server said no', 'internal', 500), SENTENCE],
      [new ApiError('Server said no', 'config', 503), SENTENCE],
      [new ApiError('Unauthorized', 'unauthorized', 401), 'Your session may have expired. Sign in again to continue.'],
      [new ApiError('Offline', 'network', 0), "We couldn't reach the server. Check your connection and try again."],
      [new ApiError('Slow down', 'rate_limited', 429), "You're going a little fast — give it a moment, then try again."],
    ];
    for (const [index, [failure, line]] of cases.entries()) {
      update().mockRejectedValueOnce(failure);
      pick(TOKYO);
      await waitFor(() => expect(picked).toHaveLength(index + 1));
      expect(picked[index]).toEqual({ tz: TOKYO, ok: false });
      expect(handed).toHaveLength(index + 1);
      expect(handed[index]).toEqual({ tz: TOKYO, message: line });
      // The saved zone is back in the field (Q8), and the failure is still logged once per pick.
      expect(onScreen()).toBe(PARIS);
      expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(index + 1);
    }
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    // A save that lands hands nothing.
    pick(BERLIN);
    await waitFor(() => expect(picked).toHaveLength(cases.length + 1));
    expect(picked[cases.length]).toEqual({ tz: BERLIN, ok: true });
    expect(handed).toHaveLength(cases.length);

    // Two picks, the EARLIER fails while the later is still saving: nothing handed, no toast (Q8).
    const a = deferred();
    const b = deferred();
    update().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    pick(TOKYO);
    pick(BERLIN);
    await act(async () => {
      a.reject(new Error('earlier'));
    });
    await waitFor(() => expect(update()).toHaveBeenLastCalledWith(SELF_UUID, BERLIN));
    await act(async () => {
      b.resolve({});
    });
    await waitFor(() => expect(picked).toHaveLength(cases.length + 3));
    expect(handed).toHaveLength(cases.length);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
