// Plan 88.6-32 task 2 — the FIRST test that renders `ResponseDashboard` at all.
//
// WHY IT HAD TO EXIST BEFORE THE MIGRATION COULD BE ACCEPTED: two of that task's acceptance
// criteria (the coded-`ApiError` copy assertion and the no-flash refocus assertion) had no
// artifact anywhere in the repo that could execute them. A criterion with no executable
// artifact is a sentence, not a gate.
//
// MOCK IDIOM — `importOriginal` + spread, matching `friends/page.backendDown.test.tsx` and
// explicitly NOT the full-replacement factory `ScheduleForm.test.tsx` used before plan 88.6-32
// (that file now spreads `importOriginal` too). A full replacement
// DELETES `ApiError` from `@/lib/api`, and `useFetchErrorState.ts:128` derives the error code
// through `error instanceof ApiError` — so under a full replacement every failure would resolve
// to `unknown`, the generic line would render, and this suite would go GREEN on the exact defect
// it exists to catch.
//
// `MESSAGE_BY_CODE` is NOT imported, and must not be exported to make it importable: it is
// module-private by design (`useFetchErrorState.ts:50`, whose own docblock records that it has
// exactly one reader). The ratified copy is asserted as a literal string instead.
import * as React from 'react';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComponentType } from 'react';
import { formatDateTime } from '@/lib/datetime';
import ResponseDashboardDefault from './ResponseDashboard';
import { logger } from '@/lib/logger';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

// `ResponseDashboard` is a JS component; its inferred prop type marks every prop required and
// mis-widens the destructured defaults. Cast to a permissive type so the suite can render with
// only the props it exercises — the same idiom `ScheduleForm.test.tsx` already uses for the
// same reason.
const ResponseDashboard = ResponseDashboardDefault as unknown as ComponentType<{
  promptId?: string;
  isAdmin?: boolean;
  currentUserId?: string;
  blindVotingEnabled?: boolean;
  pollClosed?: boolean;
}>;

const api = vi.hoisted(() => ({ getRespondents: vi.fn(), sendReminder: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    promptAPI: { ...actual.promptAPI, getRespondents: api.getRespondents, sendReminder: api.sendReminder },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  errCtx: (e: unknown) => ({ name: 'x', message: String(e) }),
}));

const toastCalls = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastCalls.error, success: vi.fn() } }));

// Phase 88.6-57 (CR-301): the profile timezone, MUTABLE per test; `null` is the real
// no-provider context default, so cases that do not set it are unaffected.
const tzState = vi.hoisted(() => ({ timezone: null as string | null }));
vi.mock('./TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: tzState.timezone, setTimezone: () => {} }),
}));

/** A REAL `ApiError` off the unmocked module, so `instanceof` holds. */
async function codedError(code: string, status: number, details?: unknown) {
  const actual = await import('@/lib/api');
  return new actual.ApiError('RAW UPSTREAM TEXT THAT MUST NOT REACH THE DOM', code as never, status, details);
}

/** The register's copy for `forbidden` and for `unknown`, asserted as literals (see header). */
const FORBIDDEN_COPY = "You don't have access to this. Refresh the page to try again.";
const UNKNOWN_COPY = 'Something went wrong. Refresh the page to try again.';

beforeEach(() => {
  api.getRespondents.mockReset();
  api.sendReminder.mockReset();
  toastCalls.error.mockReset();
});
afterEach(() => {
  cleanup();
  tzState.timezone = null;
});

const baseProps = { promptId: 'prompt-1', isAdmin: true, currentUserId: 'me' };

describe('ResponseDashboard — the load arm on the house synthetic-adapter contract', () => {
  it('derives the copy from a CODED ApiError, and never renders the generic unknown line', async () => {
    // A generic `throw new Error(...)` passes either way — a flattened-string store and an
    // Error-object store both resolve to `unknown`. Only a CODED rejection can tell them apart,
    // which is why this arm drives one.
    api.getRespondents.mockRejectedValue(await codedError('forbidden', 403));
    render(<ResponseDashboard {...baseProps} />);

    expect(await screen.findByText(FORBIDDEN_COPY)).toBeInTheDocument();
    expect(screen.queryByText(UNKNOWN_COPY)).toBeNull();
    // The raw upstream message must never reach the DOM (T-88.6-143 / ASVS V7).
    expect(screen.queryByText(/RAW UPSTREAM TEXT/)).toBeNull();
    // The retry affordance survives the swap onto FetchErrorBanner.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('re-issues the fetch when the banner\'s Try again is activated', async () => {
    api.getRespondents.mockRejectedValue(await codedError('forbidden', 403));
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText(FORBIDDEN_COPY);
    expect(api.getRespondents).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button', { name: /try again/i }).click();
    });
    await waitFor(() => expect(api.getRespondents).toHaveBeenCalledTimes(2));
  });

  it('holds the banner across a refocus-driven retry instead of flashing the skeleton', async () => {
    // THE ASSERTION HAS TO LAND WHILE THE RETRY IS STILL IN FLIGHT. Asserting after it settles
    // is green WITH THE DEFECT LIVE, because the banner returns the moment the retry fails
    // again — so a settled-state assertion measures nothing. The second call is therefore a
    // never-settling promise, and the assertions run against that window.
    let releaseSecond: (() => void) | undefined;
    api.getRespondents
      .mockRejectedValueOnce(await codedError('forbidden', 403))
      .mockImplementationOnce(
        () => new Promise((_res, rej) => { releaseSecond = () => rej(new Error('late')); })
      );

    render(<ResponseDashboard {...baseProps} />);
    // POSITIVE settle signal first — an absence/persistence claim asserted off a bare
    // `waitFor(... toBeNull())` is satisfied on the first tick and observes nothing.
    await screen.findByText(FORBIDDEN_COPY);
    expect(screen.queryByTestId('response-dashboard-skeleton')).toBeNull();

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(api.getRespondents).toHaveBeenCalledTimes(2));
    // WHILE THE RETRY IS PENDING: the banner is still mounted and the skeleton has NOT replaced
    // it. This is the pair — the fetch-start `setError(null)` being gone, and the error branch
    // being evaluated before the loading branch. Either half alone fails here.
    expect(screen.getByText(FORBIDDEN_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId('response-dashboard-skeleton')).toBeNull();

    await act(async () => { releaseSecond?.(); });
  });

  it('BOUNDS the refocus retry — two visibility events with no settle between issue ONE fetch', async () => {
    let releaseSecond: (() => void) | undefined;
    api.getRespondents
      .mockRejectedValueOnce(await codedError('forbidden', 403))
      .mockImplementationOnce(
        () => new Promise((_res, rej) => { releaseSecond = () => rej(new Error('late')); })
      );

    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText(FORBIDDEN_COPY);

    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await waitFor(() => expect(api.getRespondents).toHaveBeenCalledTimes(2));
    // TWO refocus events, ONE additional request. Without the in-flight short-circuit this is 3
    // — and on a phone, where `visibilitychange` fires on every app switch and lock/unlock, one
    // outage would file one Sentry event per refocus (`dedupeIntegration` compares only against
    // the immediately preceding event).
    expect(api.getRespondents).toHaveBeenCalledTimes(2);

    await act(async () => { releaseSecond?.(); });
  });

  it('writes NO state from a response that resolves after promptId has moved on', async () => {
    let releaseFirst: ((v: unknown) => void) | undefined;
    api.getRespondents
      .mockImplementationOnce(() => new Promise((res) => { releaseFirst = res; }))
      .mockResolvedValue([{ user_id: 'u2', username: 'Second prompt member', has_responded: true, slot_count: 2 }]);

    const view = render(<ResponseDashboard {...baseProps} />);
    view.rerender(<ResponseDashboard {...baseProps} promptId="prompt-2" />);
    await screen.findByText('Second prompt member');

    // The FIRST prompt's response lands late. The generation guard must drop it on the floor.
    await act(async () => {
      releaseFirst?.([{ user_id: 'u1', username: 'STALE first-prompt member', has_responded: false }]);
    });
    expect(screen.queryByText('STALE first-prompt member')).toBeNull();
    expect(screen.getByText('Second prompt member')).toBeInTheDocument();
  });

  it('clears the banner on a NEW promptId but keeps it across a refetch of the same one', async () => {
    api.getRespondents
      .mockRejectedValueOnce(await codedError('forbidden', 403))
      .mockResolvedValue([{ user_id: 'u2', username: 'Fresh member', has_responded: true, slot_count: 1 }]);

    const view = render(<ResponseDashboard {...baseProps} />);
    await screen.findByText(FORBIDDEN_COPY);

    view.rerender(<ResponseDashboard {...baseProps} promptId="prompt-2" />);
    await screen.findByText('Fresh member');
    expect(screen.queryByText(FORBIDDEN_COPY)).toBeNull();
  });
});

describe('ResponseDashboard — the reminder arm, one sink for both failure modes', () => {
  const pendingMember = [
    { user_id: 'u1', username: 'Pending person', has_responded: false, last_reminded_at: null },
  ];

  it('surfaces the cooldown REOPEN TIME through the toast, not a deleted inline block', async () => {
    api.getRespondents.mockResolvedValue(pendingMember);
    const next = new Date('2026-09-17T19:30:00Z').toISOString();
    api.sendReminder.mockRejectedValue(
      await codedError('reminder_cooldown', 429, { details: { next_reminder_available: next } })
    );

    render(<ResponseDashboard {...baseProps} />);
    const remind = await screen.findByRole('button', { name: /^remind$/i });
    await act(async () => { remind.click(); });

    await waitFor(() => expect(toastCalls.error).toHaveBeenCalledTimes(1));
    // The computed sentence is the most useful string this button produces; deleting the inline
    // renderer without carrying it across would have silently lost it.
    expect(toastCalls.error.mock.calls[0][0]).toMatch(
      /You reminded this user recently\. You can remind them again after .+\./
    );
    // ONE sink: the old inline `{reminderError && …}` block must not have come back.
    expect(screen.queryByText(/You reminded this user recently/)).toBeNull();
  });

  // Phase 88.6-57 (CR-301): the reopen time is formatted in the PROFILE zone the rest of the
  // page uses, not the runner's/browser's zone (`toLocaleString([], …)` before this plan).
  it('formats the cooldown reopen time in the PROFILE timezone (CR-301)', async () => {
    tzState.timezone = 'Pacific/Kiritimati';
    api.getRespondents.mockResolvedValue(pendingMember);
    const next = new Date('2026-09-17T19:30:00Z').toISOString();
    api.sendReminder.mockRejectedValue(
      await codedError('reminder_cooldown', 429, { details: { next_reminder_available: next } })
    );

    render(<ResponseDashboard {...baseProps} />);
    const remind = await screen.findByRole('button', { name: /^remind$/i });
    await act(async () => { remind.click(); });

    await waitFor(() => expect(toastCalls.error).toHaveBeenCalledTimes(1));
    const profileWhen = formatDateTime(new Date(next), 'Pacific/Kiritimati');
    expect(profileWhen).not.toBe(formatDateTime(new Date(next)));
    expect(toastCalls.error.mock.calls[0][0]).toBe(
      `You reminded this user recently. You can remind them again after ${profileWhen}.`
    );
  });

  it('routes a NON-cooldown reminder failure through the same toast sink, on register copy', async () => {
    api.getRespondents.mockResolvedValue(pendingMember);
    api.sendReminder.mockRejectedValue(await codedError('forbidden', 403));

    render(<ResponseDashboard {...baseProps} />);
    const remind = await screen.findByRole('button', { name: /^remind$/i });
    await act(async () => { remind.click(); });

    await waitFor(() => expect(toastCalls.error).toHaveBeenCalledWith(FORBIDDEN_COPY));
    // The raw upstream message never reaches the user through this path either.
    expect(toastCalls.error).not.toHaveBeenCalledWith(expect.stringMatching(/RAW UPSTREAM TEXT/));
  });
});

describe('ResponseDashboard — the §6.3 title on the respondents-fetch banner (88.6-42)', () => {
  // Added by plan 88.6-42 (owner-authorized addition, 2026-09-16). The string is RATIFIED in
  // UI-SPEC §6.3 in the same commit as this pin — the register was the blocker that made the
  // shipped DECISION marker say "NO `title` PROP", and the amendment is what cleared it.
  it('names WHICH fetch failed instead of falling back to the banner generic heading', async () => {
    api.getRespondents.mockRejectedValue(await codedError('forbidden', 403));
    render(<ResponseDashboard {...baseProps} />);

    expect(await screen.findByText("We couldn't load the respondents.")).toBeInTheDocument();
    // The banner's own ratified default must NOT also render — one heading, not two.
    expect(screen.queryByText('Something went wrong')).toBeNull();
    // …and the BODY copy is still code-derived, untouched by the title: a named heading must
    // not become a second place upstream text could enter.
    expect(screen.getByText(FORBIDDEN_COPY)).toBeInTheDocument();
    expect(screen.queryByText(/RAW UPSTREAM TEXT/)).toBeNull();
  });
});

// Plan 88.6-63 (review round 2 #6) — ARM K, `R2-6-RECONFIRM: keep`. The review asked to move the
// generation guard ABOVE `logger.error`, citing RsvpSection's marker as the guard-first idiom; that
// marker actually names THIS component's log-first order as a deliberate divergence (AC-16 needs a
// Sentry EVENT on this path). The owner's swap ruling rested on that misread and is VOID; the
// recorded DECISION stands. These cases are CONFIRM-ONLY (green on the shipped order) and pin it,
// so a future "tidy to guard-first" goes red here. Their red was demonstrated by MUTATION (guard
// moved above the log -> red -> restored -> green).
describe('ResponseDashboard — a superseded failure is still REPORTED (review round 2 #6, R2-6-RECONFIRM: keep)', () => {
  const errorCalls = () =>
    (logger.error as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'Failed to fetch respondents:',
    );

  beforeEach(() => {
    (logger.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('a failure that lands AFTER promptId moved on is logged once, and writes no banner', async () => {
    let rejectFirst: ((e: unknown) => void) | undefined;
    api.getRespondents
      .mockImplementationOnce(() => new Promise((_res, rej) => { rejectFirst = rej; }))
      .mockResolvedValue([{ user_id: 'u2', username: 'Second prompt member', has_responded: true, slot_count: 2 }]);

    const view = render(<ResponseDashboard {...baseProps} />);
    view.rerender(<ResponseDashboard {...baseProps} promptId="prompt-2" />);
    await screen.findByText('Second prompt member');

    const failure = await codedError('internal', 500);
    await act(async () => {
      rejectFirst?.(failure);
    });

    expect(errorCalls()).toHaveLength(1);
    expect(errorCalls()[0][1]).toBe(failure);
    // Logged, but the generation guard still drops the STATE write: no banner for a poll the
    // user has moved away from.
    expect(screen.queryByText("We couldn't load the respondents.")).toBeNull();
    expect(screen.getByText('Second prompt member')).toBeInTheDocument();
  });

  it('a failure that lands AFTER unmount is logged once', async () => {
    let rejectFirst: ((e: unknown) => void) | undefined;
    api.getRespondents.mockImplementationOnce(
      () => new Promise((_res, rej) => { rejectFirst = rej; }),
    );

    const view = render(<ResponseDashboard {...baseProps} />);
    await waitFor(() => expect(api.getRespondents).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => {
      rejectFirst?.(new Error('late'));
    });
    expect(errorCalls()).toHaveLength(1);
  });

  it('a CURRENT failure is logged exactly once (the non-superseded baseline)', async () => {
    api.getRespondents.mockRejectedValue(await codedError('forbidden', 403));
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText(FORBIDDEN_COPY);
    expect(errorCalls()).toHaveLength(1);
  });
});

// Phase 88.6.1-11 (W031 / D-26, Req 11). `logger.error` is a Sentry EVENT (`logger.ts:45`), so
// WHEN it fires is user-invisible but operator-visible: one outage used to file one event per
// return-to-tab (the hook's error-only refocus refetch), and an expected reminder cooldown filed
// an event every time. These cases pin one event per failure EPISODE and none for a cooldown,
// while every real failure is still captured with the identical error object (T-84-01).
describe('ResponseDashboard — W031: one Sentry event per failure episode, none for an expected cooldown', () => {
  const loggedWith = (msg: string) =>
    (logger.error as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === msg);
  const respondentsCalls = () => loggedWith('Failed to fetch respondents:');
  const reminderCalls = () => loggedWith('Failed to send reminder:');
  const pendingMember = [
    { user_id: 'u1', username: 'Pending person', has_responded: false, last_reminded_at: null },
  ];

  beforeEach(() => {
    // The file-level beforeEach does not reset the logger mock.
    (logger.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('a refocus retry that fails the SAME way files no second event (same episode)', async () => {
    const first = await codedError('forbidden', 403);
    const second = await codedError('forbidden', 403);
    let rejectSecond: ((e: unknown) => void) | undefined;
    api.getRespondents
      .mockRejectedValueOnce(first)
      .mockImplementationOnce(() => new Promise((_res, rej) => { rejectSecond = rej; }));

    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText(FORBIDDEN_COPY);
    expect(respondentsCalls()).toHaveLength(1);

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(api.getRespondents).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectSecond?.(second);
      await Promise.resolve();
      await Promise.resolve();
    });
    // The banner is still the forbidden one, and the retry's failure filed nothing new.
    expect(screen.getByText(FORBIDDEN_COPY)).toBeInTheDocument();
    expect(respondentsCalls()).toHaveLength(1);
    expect(respondentsCalls()[0][1]).toBe(first);
  });

  it('a success ends the episode: a later failure files a NEW event (confirm-only; guards against a once-per-mount latch)', async () => {
    const first = await codedError('forbidden', 403);
    const later = await codedError('forbidden', 403);
    api.getRespondents
      .mockRejectedValueOnce(first)
      .mockResolvedValueOnce(pendingMember)
      .mockRejectedValueOnce(later);

    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText(FORBIDDEN_COPY);
    await act(async () => {
      screen.getByRole('button', { name: /try again/i }).click();
    });
    await screen.findByText('Pending person');

    await act(async () => {
      screen.getByRole('button', { name: /refresh/i }).click();
    });
    // Settle on the logger count this case exists for, never on the banner copy: what a failed
    // 403 Refresh SHOWS changes in plan 88.6.1-73, and a copy-based settle would red there.
    await waitFor(() => expect(respondentsCalls()).toHaveLength(2));
    expect(respondentsCalls()[0][1]).toBe(first);
    expect(respondentsCalls()[1][1]).toBe(later);
  });

  it('a reminder_cooldown answer files NO Sentry event', async () => {
    api.getRespondents.mockResolvedValue(pendingMember);
    api.sendReminder.mockRejectedValue(
      await codedError('reminder_cooldown', 429, {
        details: { next_reminder_available: new Date('2026-10-17T19:30:00Z').toISOString() },
      })
    );

    render(<ResponseDashboard {...baseProps} />);
    const remind = await screen.findByRole('button', { name: /^remind$/i });
    await act(async () => { remind.click(); });

    // POSITIVE signal first: the cooldown toast fired, so the catch has run.
    await waitFor(() => expect(toastCalls.error).toHaveBeenCalledTimes(1));
    expect(reminderCalls()).toHaveLength(0);
  });

  it('a NON-cooldown reminder failure still files exactly one event, with the identical error object (confirm-only)', async () => {
    api.getRespondents.mockResolvedValue(pendingMember);
    const failure = await codedError('forbidden', 403);
    api.sendReminder.mockRejectedValue(failure);

    render(<ResponseDashboard {...baseProps} />);
    const remind = await screen.findByRole('button', { name: /^remind$/i });
    await act(async () => { remind.click(); });

    await waitFor(() => expect(toastCalls.error).toHaveBeenCalledWith(FORBIDDEN_COPY));
    expect(reminderCalls()).toHaveLength(1);
    expect(reminderCalls()[0][1]).toBe(failure);
  });
});

// Phase 88.6.1-11 — D-35 (Req 4, the rule of POSITION: the Remind button the user pressed stays
// focusable while it works, with a per-row ref latch) and Req 5 (D-04 / D-05: when the success
// unmounts that button, focus lands on the row's "Reminded ..." text instead of <body>).
// `useFocusRecovery` is REAL here, never mocked: the focus contract is what these cases pin.
// C-11: jsdom never blurs a disabled element, so an in-flight `activeElement` read is
// CONFIRM-ONLY; the RED halves are the attributes and the request count. The phone e2e
// (`e2e/response-dashboard-remind.spec.ts`) proves focus in a real browser.
describe('ResponseDashboard — D-35 (the pressed Remind stays focusable, per-row latch) and Req 5 (focus survives its success)', () => {
  const memberA = { user_id: 'uA', username: 'Member A', has_responded: false, last_reminded_at: null };
  const memberB = { user_id: 'uB', username: 'Member B', has_responded: false, last_reminded_at: null };
  const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
  // One interactive control per row today: the Remind button (its name changes while in flight).
  const remindIn = (name: string) => within(rowOf(name)).getByRole('button');
  const remindedTextIn = (name: string) => within(rowOf(name)).getByText(/^Reminded \d+m ago$/);
  function deferred() {
    let resolve: (v?: unknown) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('AC-12: the pressed Remind carries aria-disabled (never native disabled), reads "Sending...", and a second press sends nothing', async () => {
    api.getRespondents.mockResolvedValue([memberA]);
    const d = deferred();
    api.sendReminder.mockImplementationOnce(() => d.promise);
    const user = userEvent.setup();
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');
    const button = remindIn('Member A');

    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveTextContent(/^Sending\.\.\.$/);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.sendReminder).toHaveBeenCalledTimes(1);
    // CONFIRM-ONLY in jsdom (C-11).
    expect(document.activeElement).toBe(button);

    await act(async () => { d.resolve({}); });
  });

  it('per row: two rows in flight each keep "Sending..." and aria-disabled, and settling one does not flip the other', async () => {
    api.getRespondents.mockResolvedValue([memberA, memberB]);
    const dA = deferred();
    const dB = deferred();
    api.sendReminder
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise);
    const user = userEvent.setup();
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');

    await user.click(remindIn('Member A'));
    await user.click(remindIn('Member B'));
    for (const name of ['Member A', 'Member B']) {
      expect(remindIn(name)).toHaveTextContent(/^Sending\.\.\.$/);
      expect(remindIn(name)).toHaveAttribute('aria-disabled', 'true');
    }
    expect(api.sendReminder).toHaveBeenCalledWith('prompt-1', 'uA');
    expect(api.sendReminder).toHaveBeenCalledWith('prompt-1', 'uB');

    await act(async () => { dA.resolve({}); });
    // POSITIVE signal: A settled into its "Reminded ..." text; B is still in flight.
    expect(await within(rowOf('Member A')).findByText(/^Reminded \d+m ago$/)).toBeInTheDocument();
    expect(remindIn('Member B')).toHaveTextContent(/^Sending\.\.\.$/);
    expect(remindIn('Member B')).toHaveAttribute('aria-disabled', 'true');

    await act(async () => { dB.resolve({}); });
  });

  it('Req 5: after a successful remind, focus lands on that row\'s "Reminded ..." text, only after the button is removed, never on <body>', async () => {
    api.getRespondents.mockResolvedValue([memberA]);
    const d = deferred();
    api.sendReminder.mockImplementationOnce(() => d.promise);
    const user = userEvent.setup();
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');
    const button = remindIn('Member A');

    await user.click(button);
    expect(document.activeElement).toBe(button);
    // R5 ordering backstop: while the request is held, the pressed button is still there.
    expect(button).toBeInTheDocument();

    await act(async () => { d.resolve({}); });
    // POSITIVE signal (C-5: a NAMED node, not merely "not body").
    await waitFor(() => expect(document.activeElement).toBe(remindedTextIn('Member A')));
    expect(button).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('an unmounted dashboard arms nothing when a late remind succeeds: no focusin listener, no observer', async () => {
    api.getRespondents.mockResolvedValue([memberA]);
    const d = deferred();
    api.sendReminder.mockImplementationOnce(() => d.promise);
    const user = userEvent.setup();
    const view = render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');
    await user.click(remindIn('Member A'));

    view.unmount();
    // Let the hook's own unmount microtask run before the spies go in, so only the late
    // resolve's calls can count.
    await act(async () => { await Promise.resolve(); });
    const addSpy = vi.spyOn(document, 'addEventListener');
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
    try {
      await act(async () => {
        d.resolve({});
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.sendReminder).toHaveBeenCalledTimes(1);
      expect(addSpy.mock.calls.filter((c) => c[0] === 'focusin')).toHaveLength(0);
      expect(observeSpy).not.toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
      observeSpy.mockRestore();
    }
  });

  it('a row the user is not on arms nothing: a later removal of the focused control never sends focus to that row\'s text', async () => {
    api.getRespondents.mockResolvedValue([memberA, memberB]);
    const dA = deferred();
    const dB = deferred();
    api.sendReminder
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise);
    const failure = await codedError('forbidden', 403);
    const user = userEvent.setup();
    const view = render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');

    await user.click(remindIn('Member A'));
    await user.click(remindIn('Member B'));
    const buttonB = remindIn('Member B');
    expect(document.activeElement).toBe(buttonB);

    await act(async () => { dA.resolve({}); });
    const textA = await within(rowOf('Member A')).findByText(/^Reminded \d+m ago$/);
    await act(async () => { dB.reject(failure); });
    await waitFor(() => expect(buttonB).toHaveTextContent(/^Remind$/));
    expect(document.activeElement).toBe(buttonB);

    // Remove B's Remind button by a path that keeps A's text mounted and moves no focus itself:
    // B becomes the viewer's own row, which never shows Remind.
    view.rerender(<ResponseDashboard {...baseProps} currentUserId="uB" />);
    expect(buttonB).not.toBeInTheDocument();
    // Give the hook's observer (a microtask) and any one-macrotask follow-up their turn, then
    // read focus synchronously (CF-26: never a waitFor around an absence).
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(textA).toBeInTheDocument();
    expect(document.activeElement).not.toBe(textA);
  });

  it('floor: the Remind button carries the house 44px negative-margin floor and the aria-disabled wash, never the native-disabled one', async () => {
    api.getRespondents.mockResolvedValue([memberA]);
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');

    const tokens = remindIn('Member A').className.split(/\s+/);
    for (const token of ['min-h-11', '-my-2', 'inline-flex', 'items-center', 'aria-disabled:opacity-50']) {
      expect(tokens).toContain(token);
    }
    expect(tokens).not.toContain('disabled:opacity-50');
  });

  it('the failure path keeps the button: back to "Remind", no aria-disabled, no disabled, one toast (confirm-only)', async () => {
    api.getRespondents.mockResolvedValue([memberA]);
    api.sendReminder.mockRejectedValue(await codedError('forbidden', 403));
    const user = userEvent.setup();
    render(<ResponseDashboard {...baseProps} />);
    await screen.findByText('Member A');
    const button = remindIn('Member A');

    await user.click(button);
    await waitFor(() => expect(toastCalls.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).toHaveTextContent(/^Remind$/));
    expect(button).toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('disabled');
    // CONFIRM-ONLY in jsdom (C-11).
    expect(document.activeElement).toBe(button);
  });
});

// Phase 88.6.1-73 — RF1 / D-47 (owner ruling 2026-10-05, D-51): a failed REFRESH of a roster that
// loaded for the current prompt keeps the roster and says so with plan 88.6.1-70's shared notice and
// its Retry; a failed FIRST load keeps the full banner. Each case cites plan 70's consumer contract
// (C1-C12) by item. RefreshFailedNotice, useRetainedContent, RetainedContentFocusGuard and
// useFocusRecovery are all REAL here: what they do together is what these cases pin.
// The C8 (e) cases read the expected register line through `getFetchErrorMessage`, the module's
// one public reader, because plan 70's contract C8 (e) says so; the older cases above keep their
// literals and the header's MESSAGE_BY_CODE rule is unaffected (a flattened store would render the
// unknown line while getFetchErrorMessage of the coded error returns its own, so they still red).
describe('RF1 — a failed refresh keeps the roster (plan 88.6.1-73)', () => {
  // Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE), written once here (contract C7). It is
  // in the DOM twice while shown: the visible line and the polite region.
  const RF1 = "Couldn't refresh. Showing what loaded earlier.";
  const LOAD_TITLE = "We couldn't load the respondents.";
  const THREE = [
    { user_id: 'm1', username: 'Member One', has_responded: true, slot_count: 2 },
    // Pending and never reminded, not the viewer: an admin sees a Remind button on this row.
    { user_id: 'm2', username: 'Member Two', has_responded: false, last_reminded_at: null },
    { user_id: 'm3', username: 'Member Three', has_responded: true, slot_count: 1 },
  ];
  const TWO_NEW = [
    { user_id: 'n1', username: 'New Member Four', has_responded: true, slot_count: 3 },
    { user_id: 'n2', username: 'New Member Five', has_responded: true, slot_count: 1 },
  ];
  const THREE_NAMES = ['Member One', 'Member Two', 'Member Three'];

  function deferred<T = unknown>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // The house idiom (useFetchErrorState.test.tsx, function fireVisibility): the hook's tab-return
  // re-attempt, the refresh nobody pressed.
  function fireVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  // Inside <main> with an <h1>, so plan 04's floor has somewhere to go.
  function renderInMain(promptId = 'prompt-1') {
    const view = render(
      <main>
        <h1>Planning</h1>
        <ResponseDashboard {...baseProps} promptId={promptId} />
      </main>
    );
    return {
      ...view,
      rerenderPrompt: (next: string) =>
        view.rerender(
          <main>
            <h1>Planning</h1>
            <ResponseDashboard {...baseProps} promptId={next} />
          </main>
        ),
    };
  }
  const planningH1 = () => screen.getByRole('heading', { level: 1, name: 'Planning' });
  const responsesHeading = () => screen.getByRole('heading', { name: /^Responses:/ });
  const refreshButton = () => screen.getByRole('button', { name: 'Refresh' });
  const rf1Region = () =>
    Array.from(document.querySelectorAll('[role="status"]')).find((n) => n.textContent === RF1);
  // The positive RF1 signal waits for BOTH copies (plan 88.6.1-30's lesson: findAllByText
  // resolves at the first match).
  const waitForRf1 = () => waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));

  async function loadThenFailRefresh(user: ReturnType<typeof userEvent.setup>, failure: unknown) {
    api.getRespondents.mockResolvedValueOnce(THREE);
    const view = renderInMain();
    await screen.findByText('Member One');
    api.getRespondents.mockRejectedValueOnce(failure);
    await user.click(refreshButton());
    return view;
  }

  it('RD-RF-1. a failed refresh (a 500) keeps the roster and shows RF1; the full banner is absent (C8 a, C8 e)', async () => {
    const user = userEvent.setup();
    const e500 = await codedError('internal', 500);
    await loadThenFailRefresh(user, e500);

    await waitForRf1();
    for (const name of THREE_NAMES) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
    // The notice renders no state.message: only RF1.
    expect(screen.queryByText(getFetchErrorMessage(e500))).toBeNull();
  });

  it('RD-RF-2. the RF1 region is one of the status nodes present BEFORE the failure (C8 b, Req 8)', async () => {
    const user = userEvent.setup();
    api.getRespondents.mockResolvedValueOnce(THREE);
    renderInMain();
    await screen.findByText('Member One');
    const before = Array.from(document.querySelectorAll('[role="status"]'));

    api.getRespondents.mockRejectedValueOnce(await codedError('internal', 500));
    await user.click(refreshButton());
    await waitForRf1();

    const region = rf1Region();
    expect(region, 'a status node carries RF1').toBeDefined();
    // Node identity (C-6): the same node, filled — never a region mounted with its text.
    expect(before.find((n) => n === region)).toBe(region);
  });

  it('RD-RF-3. a successful Retry removes RF1, shows the new roster, and lands focus on the Responses heading (C8 c, Req 5)', async () => {
    const user = userEvent.setup();
    await loadThenFailRefresh(user, await codedError('internal', 500));
    await waitForRf1();

    api.getRespondents.mockResolvedValueOnce(TWO_NEW);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(document.activeElement).toBe(responsesHeading()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('New Member Four')).toBeInTheDocument();
    expect(screen.getByText('New Member Five')).toBeInTheDocument();
    for (const name of THREE_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('RD-RF-4. a Retry pressed while a Refresh is in flight JOINS that run and answers only when it settles (C4, Edge R5 ordering)', async () => {
    const user = userEvent.setup();
    await loadThenFailRefresh(user, await codedError('internal', 500));
    await waitForRf1();
    const region = rf1Region() as Element;
    const retry = screen.getByRole('button', { name: 'Retry' });

    const held = deferred();
    api.getRespondents.mockImplementationOnce(() => held.promise);
    const callsBefore = api.getRespondents.mock.calls.length;
    await user.click(refreshButton());
    await user.click(retry);
    // ONE request for the two presses: the Retry joined the held run.
    expect(api.getRespondents).toHaveBeenCalledTimes(callsBefore + 1);

    await act(async () => {
      await sleep(150);
    });
    expect(retry).toHaveTextContent('Retrying…');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(retry);
    expect(region.textContent, 'the region stays quiet while the joined run is out').toBe('');

    // A 500 (a 403 here would be an access answer and withdraw the roster, C10).
    await act(async () => {
      held.reject(await codedError('internal', 500));
    });
    await waitFor(() => expect(region.textContent).toBe(RF1));
    expect(document.activeElement).toBe(retry);
    expect(retry).toHaveTextContent('Retry');
  });

  it('RD-RF-5. a pressed Refresh keeps the roster and its focus, with a word-free busy cue, and no skeleton (D-09a / D-37, Req 5, review #237)', async () => {
    const user = userEvent.setup();
    api.getRespondents.mockResolvedValueOnce(THREE);
    renderInMain();
    await screen.findByText('Member One');

    const held = deferred();
    api.getRespondents.mockImplementationOnce(() => held.promise);
    const button = refreshButton();
    await user.click(button);

    expect(screen.queryByTestId('response-dashboard-skeleton')).toBeNull();
    for (const name of THREE_NAMES) expect(screen.getByText(name)).toBeInTheDocument();
    expect(document.activeElement).toBe(button);
    const icon = button.querySelector('svg') as SVGElement;
    expect(icon).toHaveClass('animate-spin');
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      held.resolve(THREE);
    });
    await waitFor(() => expect(icon).not.toHaveClass('animate-spin'));
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(button);
  });

  it('RD-RF-6. a new prompt never shows the previous prompt\'s roster or failure, not even for one commit (C3, the stamped error)', async () => {
    const user = userEvent.setup();
    const view = await loadThenFailRefresh(user, await codedError('internal', 500));
    await waitForRf1();

    const added: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => added.push(node.textContent ?? ''));
        if (record.type === 'characterData') added.push(record.target.textContent ?? '');
      }
    });
    observer.observe(view.container, { childList: true, subtree: true, characterData: true });
    const collect = () => {
      for (const record of observer.takeRecords()) {
        record.addedNodes.forEach((node) => added.push(node.textContent ?? ''));
        if (record.type === 'characterData') added.push(record.target.textContent ?? '');
      }
      return added.join('\n');
    };

    const held = deferred();
    api.getRespondents.mockImplementationOnce(() => held.promise);
    try {
      view.rerenderPrompt('prompt-2');
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId('response-dashboard-skeleton')).toBeInTheDocument();
      const seen = collect();
      for (const name of THREE_NAMES) {
        expect(seen, `${name} was added under prompt-2`).not.toContain(name);
        expect(screen.queryByText(name)).toBeNull();
      }
      expect(seen, 'the previous prompt failure was inserted').not.toContain(LOAD_TITLE);
      expect(screen.queryByText(LOAD_TITLE)).toBeNull();

      await act(async () => {
        held.reject(await codedError('internal', 500));
      });
      // A first-load failure for prompt-2: the full banner, never RF1.
      expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
    } finally {
      observer.disconnect();
    }
  });

  it('RD-RF-7. a 401 refresh withdraws the roster for the full banner, and the pressed Refresh never drops focus to <body> (C8 e, C10, Req 5)', async () => {
    const user = userEvent.setup();
    const e401 = await codedError('unauthorized', 401);
    await loadThenFailRefresh(user, e401);

    expect(await screen.findByText(getFetchErrorMessage(e401))).toBeInTheDocument();
    expect(screen.getByText(LOAD_TITLE)).toBeInTheDocument();
    for (const name of THREE_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Responses:/ })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    // The heading left with the roster, so plan 04's floor takes focus.
    await waitFor(() => expect(document.activeElement).toBe(planningH1()));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('RD-RF-8. a 403 refresh withdraws the roster, and a later 500 does not bring it back (C8 e, C10 memory)', async () => {
    const user = userEvent.setup();
    const e403 = await codedError('forbidden', 403);
    await loadThenFailRefresh(user, e403);

    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();
    expect(screen.getByText(LOAD_TITLE)).toBeInTheDocument();
    for (const name of THREE_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    const e500 = await codedError('internal', 500);
    api.getRespondents.mockRejectedValueOnce(e500);
    const callsBefore = api.getRespondents.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(api.getRespondents).toHaveBeenCalledTimes(callsBefore + 1));
    expect(await screen.findByText(getFetchErrorMessage(e500))).toBeInTheDocument();
    // The hook keeps the access answer until a success: still withdrawn, still no RF1.
    for (const name of THREE_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RD-RF-9. a network failure on refresh keeps the roster under RF1 (C8 e)', async () => {
    const user = userEvent.setup();
    await loadThenFailRefresh(user, await codedError('network', 0));

    await waitForRf1();
    for (const name of THREE_NAMES) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText(LOAD_TITLE)).toBeNull();
  });

  it('RD-RF-10. a refresh nobody pressed never drops focus to <body>: a 403 withdrawal and a success while Retry holds focus (C8 f, C12)', async () => {
    const user = userEvent.setup();

    // (f1) A control inside the retained roster holds focus; the tab-return re-attempt is a 403.
    await loadThenFailRefresh(user, await codedError('internal', 500));
    await waitForRf1();
    // Let the pressed Refresh's settle take effect (plan 04's settle lands one macrotask later).
    await act(async () => {
      await sleep(0);
    });
    const remind = screen.getAllByRole('button', { name: /Remind/ })[0];
    // A move from one live control to another after the press settled DISARMS the press arm, so
    // only the guard can act on what follows.
    act(() => remind.focus());
    expect(document.activeElement).toBe(remind);
    const e403 = await codedError('forbidden', 403);
    api.getRespondents.mockRejectedValueOnce(e403);
    await act(async () => {
      fireVisibility('visible');
    });
    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();
    for (const name of THREE_NAMES) expect(screen.queryByText(name)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(planningH1()));
    expect(document.activeElement).not.toBe(document.body);

    cleanup();

    // (f2) Retry holds focus; the tab-return re-attempt succeeds.
    await loadThenFailRefresh(user, await codedError('internal', 500));
    await waitForRf1();
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    api.getRespondents.mockResolvedValueOnce(TWO_NEW);
    await act(async () => {
      fireVisibility('visible');
    });
    await waitFor(() => expect(document.activeElement).toBe(responsesHeading()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('New Member Four')).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('RD-RF-11. a successful Try again on the FIRST-load banner lands focus on the Responses heading (review #82, Req 5)', async () => {
    const user = userEvent.setup();
    api.getRespondents.mockRejectedValueOnce(await codedError('internal', 500));
    renderInMain();
    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();

    api.getRespondents.mockResolvedValueOnce(THREE);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(document.activeElement).toBe(responsesHeading()));
    expect(document.activeElement).not.toBe(planningH1());
    expect(document.activeElement).not.toBe(document.body);
  });
});

// Phase 88.6.1-86 — close ruling P-14 (owner 2026-10-17), Req 9 (AC-27): while nothing has loaded
// for the current prompt, the Responses card names what is loading with a visible line in the
// calendar loader's plain-paragraph shape, in the slot the heading will take, OUTSIDE the pulsing
// skeleton block. The skeleton keeps its test id (the four assertions above read it).
describe('ResponseDashboard — the first load names what is loading (88.6.1-86, close ruling P-14)', () => {
  // Copy row P14 (AC-33), written once here: three ASCII dots, byte for byte.
  const LOADING_RESPONSES = 'Loading responses...';
  const LOAD_TITLE = "We couldn't load the respondents.";
  const THREE = [
    { user_id: 'm1', username: 'Member One', has_responded: true, slot_count: 2 },
    { user_id: 'm2', username: 'Member Two', has_responded: false, last_reminded_at: null },
    { user_id: 'm3', username: 'Member Three', has_responded: true, slot_count: 1 },
  ];

  function deferred<T = unknown>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('RD-L1. the line shows while the first load is out, visibly, outside the pulsing skeleton and before it in the card', () => {
    api.getRespondents.mockImplementation(() => new Promise(() => {}));
    render(<ResponseDashboard {...baseProps} />);

    const line = screen.getByText(LOADING_RESPONSES);
    const skeleton = screen.getByTestId('response-dashboard-skeleton');
    expect(line).toBeInTheDocument();
    // It does not pulse: it sits outside the skeleton block, as its sibling in the same card,
    // ahead of it (the heading's slot).
    expect(skeleton.contains(line)).toBe(false);
    expect(line.parentElement).toBe(skeleton.parentElement);
    expect(line.compareDocumentPosition(skeleton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A visible line, not screen-reader-only text.
    expect(line).not.toHaveClass('sr-only');
    expect(line.closest('.sr-only')).toBeNull();
  });

  it('RD-L2. the line leaves when the roster lands', async () => {
    const held = deferred();
    api.getRespondents.mockImplementationOnce(() => held.promise);
    render(<ResponseDashboard {...baseProps} />);
    expect(screen.getByText(LOADING_RESPONSES)).toBeInTheDocument();

    await act(async () => {
      held.resolve(THREE);
    });
    // Positive signal first (CF-26), then the absence.
    expect(await screen.findByRole('heading', { name: /^Responses:/ })).toBeInTheDocument();
    expect(screen.getByText('Member One')).toBeInTheDocument();
    expect(screen.queryByText(LOADING_RESPONSES)).toBeNull();
  });

  it('RD-L3. a failed first load shows the banner and no loading line (error before loading, unchanged)', async () => {
    const held = deferred();
    api.getRespondents.mockImplementationOnce(() => held.promise);
    render(<ResponseDashboard {...baseProps} />);
    expect(screen.getByText(LOADING_RESPONSES)).toBeInTheDocument();

    await act(async () => {
      held.reject(await codedError('internal', 500));
    });
    // Positive signal first (CF-26), then the absence.
    expect(await screen.findByText(LOAD_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(LOADING_RESPONSES)).toBeNull();
    expect(screen.queryByTestId('response-dashboard-skeleton')).toBeNull();
  });
});

