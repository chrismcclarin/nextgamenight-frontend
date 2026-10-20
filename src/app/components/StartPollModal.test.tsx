// Axe audit for StartPollModal after its migration onto the shared <Modal>
// primitive with overlay-dismiss disabled (PRIM-02 / D-09). StartPollModal
// carries in-progress form state that resets on close, so it migrates with
// `dismissable={false}` (overlay click cannot discard input). This pins the
// migrated modal to the Radix a11y contract: role=dialog + zero axe violations
// rendered open with its form.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

// `importOriginal` spread — NOT a bare `{ apiFetch }` object.
//
// THIS IS A PRECONDITION, not tidiness (88.6-22 task 2). The shipped mock exported ONLY
// `apiFetch`, so `ApiError` resolved to `undefined` in the module under test, and
// `deriveCode`'s `error instanceof ApiError` check (useFetchErrorState.ts) throws a
// TypeError before any assertion in a code-keyed error arm can run. Now that this modal
// derives its copy from `ApiError.code` rather than from backend prose, the real class has
// to be present or the new arms would fail for the wrong reason. Keeping the spread also
// means a REMOVED export fails loudly instead of silently resolving to a mock.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    apiFetch: vi.fn().mockResolvedValue({ prompt: { id: 'p1' } }),
  };
});

import StartPollModal from './StartPollModal';
import { apiFetch, ApiError } from '../../lib/api';

type Mock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (apiFetch as Mock).mockResolvedValue({ prompt: { id: 'p1' } });
});

afterEach(cleanup);

// Copy row R1 (D-32 R1, ratified 2026-10-04), straight apostrophe U+0027 (D-32 R8).
const R1 = "We couldn't start that check-in. Please try again.";

const baseProps = {
  groupId: 'group-1',
  group: { games: [{ id: 'g1', name: 'Catan' }] },
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('StartPollModal (migrated onto <Modal dismissable={false}>)', () => {
  it('renders as role=dialog when open', () => {
    render(<StartPollModal {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('preserves the "Start a check-in" header copy', () => {
    render(<StartPollModal {...baseProps} />);
    expect(screen.getByText('Start a check-in')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(<StartPollModal {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

// Phase 88.6 plan 22 task 2 (C1a — X1/D16/D54/D15).
//
// The error copy is derived from the HTTP STATUS, never from the backend's prose. Both arms
// below set the thrown error's `message` to `HTTP error! status: 4xx` DELIBERATELY: that is
// exactly what `ApiError.message` became when plan 42 dropped the `body?.error` alias from
// `lib/api.ts`'s message builder (anchor `function extractErrorMessage`, which now reads
// `body?.message` only), because `POST /prompts` returns raw `{ error }` bodies. A passing arm therefore proves
// the copy comes from the CODE and could not have come from the message — which is the property
// the two deleted prose regexes did not have.
describe('StartPollModal — error copy is keyed on the status, not the prose (88.6-22)', () => {
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Start poll' }));

  it('renders the conflict copy for a 409, from the code and not the message', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 409', 'conflict', 409)
    );
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(
        screen.getByText('This group already has an open poll. Close it before starting another.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/HTTP error! status/)).not.toBeInTheDocument();
  });

  it('renders the forbidden copy for a 403, from the code and not the message', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 403', 'forbidden', 403)
    );
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(
        screen.getByText('You must be an active group member to start a poll.')
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/HTTP error! status/)).not.toBeInTheDocument();
  });

  it('shows copy row R1 for a code-less failure, never the register line that says to refresh (S1, D-32 R1)', async () => {
    // FLIPPED by 88.6.1-30 (S1). The call site now passes `fallback: START_CHECKIN_FALLBACK`, so
    // an `unknown` code shows R1. The register's `unknown` line tells the user to refresh, which
    // would throw away the form this non-dismissable modal exists to protect. The retired shipped
    // string 'Something went wrong. Try again.' stays absent too.
    (apiFetch as Mock).mockRejectedValueOnce(new Error('kaboom'));
    render(<StartPollModal {...baseProps} />);
    submit();
    expect(await screen.findByText(R1)).toBeInTheDocument();
    expect(
      screen.queryByText('Something went wrong. Refresh the page to try again.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
    expect(screen.queryByText('kaboom')).not.toBeInTheDocument();
  });

  it('renders the register validation line for a 400 — the disclosed copy change', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('group_id is required', 'validation', 400)
    );
    render(<StartPollModal {...baseProps} />);
    submit();
    await waitFor(() =>
      expect(screen.queryByText('group_id is required')).not.toBeInTheDocument()
    );
    expect(
      screen.getByText('Something looks off with that request. Refresh the page to try again.')
    ).toBeInTheDocument();
  });
});

// Phase 88.6.1 plan 30 task 3: the pressed Start poll keeps focus and refuses a second submit
// (D-35, rule of POSITION), a blocked or code-less failure says R1 (D-32 R1, D-24), and the
// failure line is announced (Req 8, D-42). Line comments only (FE-TESTING-CONVENTIONS CF-9).
//
// jsdom never blurs a disabled element (FE-TESTING-CONVENTIONS C-11), so the RED half of every
// in-flight pin here is the attribute set and the request count; the focus claim itself is
// proven in the phone e2e (e2e/recurring-checkins-phone.spec.ts, E3).
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const form = () => document.getElementById('start-poll-form') as HTMLFormElement;
const footerSubmit = () =>
  document.querySelector('button[form="start-poll-form"]') as HTMLButtonElement;
const deadlineInput = () => document.getElementById('poll-deadline') as HTMLInputElement;
const PAST_DEADLINE = '2000-01-01T00:00';
const PAST_MESSAGE = 'Deadline must be in the future.';

describe('StartPollModal — one submit per press, R1 on a blocked or code-less failure, an announced failure line (88.6.1-30)', () => {
  it('S2. a proxy CSRF 403 shows R1, never the membership sentence (D-24)', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError('Cross-origin request rejected', 'forbidden', 403, {
        error: 'Cross-origin request rejected',
        csrf_rejected: true,
      })
    );
    render(<StartPollModal {...baseProps} />);
    fireEvent.submit(form());

    expect(await screen.findByText(R1)).toBeInTheDocument();
    expect(
      screen.queryByText('You must be an active group member to start a poll.')
    ).not.toBeInTheDocument();
  });

  it('S3. the failure line is announced: it is the one alert, and its text is the failure (Req 8)', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(new Error('kaboom'));
    render(<StartPollModal {...baseProps} />);
    fireEvent.submit(form());

    expect(await screen.findByText(R1)).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(R1);
  });

  it('S4. the same request failure twice inserts a NEW alert node each time (R8 idempotency backstop)', async () => {
    (apiFetch as Mock).mockRejectedValueOnce(new Error('kaboom'));
    render(<StartPollModal {...baseProps} />);
    fireEvent.submit(form());
    const first = await screen.findByRole('alert');
    expect(first).toHaveTextContent(R1);

    const second = deferred();
    (apiFetch as Mock).mockReturnValueOnce(second.promise);
    fireEvent.submit(form());
    // The resubmit clears the line, so the next failure is an insertion, not an edit.
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      second.reject(new Error('kaboom'));
    });
    const again = await screen.findByRole('alert');
    expect(again).not.toBe(first);
    expect(again).toHaveTextContent(R1);
  });

  it('S4b. the same VALIDATION failure twice inserts a NEW alert node each time (#184)', () => {
    render(<StartPollModal {...baseProps} />);
    fireEvent.change(deadlineInput(), { target: { value: PAST_DEADLINE } });
    fireEvent.submit(form());
    const first = screen.getByRole('alert');
    expect(first).toHaveTextContent(PAST_MESSAGE);

    fireEvent.submit(form());
    const again = screen.getByRole('alert');
    expect(again).not.toBe(first);
    expect(again).toHaveTextContent(PAST_MESSAGE);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('S5. two submits while the first is pending send ONE request; Start poll stays focusable with aria-disabled, Cancel is natively gated (D-35)', () => {
    const pending = deferred();
    (apiFetch as Mock).mockReturnValueOnce(pending.promise);
    render(<StartPollModal {...baseProps} />);

    // Each dispatch returns false: the default was prevented, so no native form post.
    expect(fireEvent.submit(form())).toBe(false);
    expect(fireEvent.submit(form())).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    const submitButton = footerSubmit();
    expect(submitButton).toHaveTextContent('Starting...');
    expect(submitButton).toHaveAttribute('aria-disabled', 'true');
    expect(submitButton).not.toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('disabled');
  });

  it('S6. the latch releases when the first request settles: a later submit sends the second request', async () => {
    const pending = deferred<{ prompt: { id: string } }>();
    (apiFetch as Mock).mockReturnValueOnce(pending.promise);
    const onSuccess = vi.fn();
    render(<StartPollModal {...baseProps} onSuccess={onSuccess} />);
    fireEvent.submit(form());
    fireEvent.submit(form());
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ prompt: { id: 'p1' } });
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);

    fireEvent.submit(form());
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('S7. at rest Start poll carries no aria-disabled attribute', () => {
    render(<StartPollModal {...baseProps} />);
    expect(footerSubmit()).not.toHaveAttribute('aria-disabled');
    expect(footerSubmit()).not.toHaveAttribute('disabled');
  });

  it('S8. a close and reopen while the first request works still shows Starting... and aria-disabled until it settles (#35)', async () => {
    const pending = deferred<{ prompt: { id: string } }>();
    (apiFetch as Mock).mockReturnValueOnce(pending.promise);
    const onClose = vi.fn();
    const { rerender } = render(<StartPollModal {...baseProps} onClose={onClose} />);
    fireEvent.submit(form());

    // The header Close stays live while the request works; only Cancel is natively gated.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<StartPollModal {...baseProps} onClose={onClose} isOpen={false} />);
    rerender(<StartPollModal {...baseProps} onClose={onClose} isOpen />);

    expect(footerSubmit()).toHaveTextContent('Starting...');
    expect(footerSubmit()).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      pending.resolve({ prompt: { id: 'p1' } });
    });
    expect(footerSubmit()).toHaveTextContent('Start poll');
    expect(footerSubmit()).not.toHaveAttribute('aria-disabled');
  });

  it('S9. a deadline failure marks the deadline field and describes it; a request failure leaves the field alone (#185)', async () => {
    render(<StartPollModal {...baseProps} />);
    const futureDeadline = deadlineInput().value;
    fireEvent.change(deadlineInput(), { target: { value: PAST_DEADLINE } });
    fireEvent.submit(form());

    expect(deadlineInput()).toHaveAttribute('aria-invalid', 'true');
    expect(deadlineInput()).toHaveAccessibleDescription(PAST_MESSAGE);

    (apiFetch as Mock).mockRejectedValueOnce(new Error('kaboom'));
    fireEvent.change(deadlineInput(), { target: { value: futureDeadline } });
    fireEvent.submit(form());
    expect(await screen.findByText(R1)).toBeInTheDocument();
    expect(deadlineInput()).not.toHaveAttribute('aria-invalid');
    expect(deadlineInput()).not.toHaveAccessibleDescription(R1);
  });
});
