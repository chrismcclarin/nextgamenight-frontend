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

