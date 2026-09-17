// Plan 88.6-32 task 2 — the FIRST test that renders `ResponseDashboard` at all.
//
// WHY IT HAD TO EXIST BEFORE THE MIGRATION COULD BE ACCEPTED: two of that task's acceptance
// criteria (the coded-`ApiError` copy assertion and the no-flash refocus assertion) had no
// artifact anywhere in the repo that could execute them. A criterion with no executable
// artifact is a sentence, not a gate.
//
// MOCK IDIOM — `importOriginal` + spread, matching `friends/page.backendDown.test.tsx` and
// explicitly NOT `ScheduleForm.test.tsx:11-16`'s full-replacement factory. A full replacement
// DELETES `ApiError` from `@/lib/api`, and `useFetchErrorState.ts:116` derives the error code
// through `error instanceof ApiError` — so under a full replacement every failure would resolve
// to `unknown`, the generic line would render, and this suite would go GREEN on the exact defect
// it exists to catch.
//
// `MESSAGE_BY_CODE` is NOT imported, and must not be exported to make it importable: it is
// module-private by design (`useFetchErrorState.ts:46`, whose own docblock records that it has
// exactly one reader). The ratified copy is asserted as a literal string instead.
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComponentType } from 'react';
import ResponseDashboardDefault from './ResponseDashboard';

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
afterEach(cleanup);

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
