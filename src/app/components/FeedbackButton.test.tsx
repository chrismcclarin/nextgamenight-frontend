// Phase 88.6.1 plan 33 — the Send-feedback dialog (FeedbackButton.js, floating variant, the
// instance that hosts the dialog at the layout root).
//
// What this file pins, by describe:
//   1. the failure region (W019, Req 8, D-22, D-42) — one assertive region, mounted EMPTY
//      whenever the form renders, the SAME node carries the failure line afterwards, and an
//      identical second failure is a real text change on that node (the R8 backstop).
//   2. the pressed Submit (D-35, Req 4 and 5) — it stays focusable while it sends (aria-disabled
//      plus a ref latch), refuses a second press, keeps native disabled for the validity half
//      only, and a successful send hands focus to the thank-you line; the field states its own
//      minimum to assistive technology.
//
// Comment rule for this file: line comments only. A block comment holding a backtick or the
// closing token makes vite:oxc collect ZERO tests while reporting green (FE-TESTING-CONVENTIONS
// CF-9). After every run, read this file's test count and treat 0 as a failure.
import * as React from 'react';
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self', name: 'Self', email: 'self@example.test' }, isLoading: false }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/groupHomePage',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ApiError and plan 07's CSRF predicate stay REAL (C-3): only the writer is replaced.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    feedbackAPI: {
      ...actual.feedbackAPI,
      submitGitHubFeedback: vi.fn(),
    },
  };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import { feedbackAPI, ApiError } from '@/lib/api';
import FeedbackButton from './FeedbackButton';
import { FeedbackModalProvider } from './FeedbackModalProvider';

const writer = () => vi.mocked(feedbackAPI.submitGitHubFeedback);

const INTERNAL_LINE = 'Something went wrong on our end. Please try again shortly.';
const UPSTREAM = 'the backend said something quotable';
const FIRST_MESSAGE = 'Something went wrong on this page.';

beforeEach(() => {
  // A default per test, never a factory default: vi.restoreAllMocks() in afterEach must not be
  // able to strip it between tests.
  writer().mockReset();
  writer().mockResolvedValue({ success: true });
  vi.mocked(Sentry.captureException).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The floating instance, opened by its FAB (the icon-only "Send feedback" button).
async function openDialog() {
  const user = userEvent.setup();
  render(
    <FeedbackModalProvider>
      <FeedbackButton label="Send feedback" onOpen={vi.fn()} />
    </FeedbackModalProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Send feedback' }));
  const dialog = await screen.findByRole('dialog', { name: 'Send Feedback' });
  return { user, dialog };
}

const textareaIn = (dialog: HTMLElement) =>
  within(dialog).getByPlaceholderText("Tell us what's on your mind...");

// Every live region inside the dialog, and the rule that none sits inside another.
function liveRegionsIn(dialog: HTMLElement): Element[] {
  return Array.from(dialog.querySelectorAll('[aria-live], [role="alert"], [role="status"]'));
}
function hasNestedLiveRegion(dialog: HTMLElement): boolean {
  return liveRegionsIn(dialog).some((el) => {
    const parent = el.parentElement;
    const outer = parent ? parent.closest('[aria-live], [role="alert"], [role="status"]') : null;
    return outer !== null && dialog.contains(outer);
  });
}

// A send held open until the test settles it. Every test that creates one settles it before it
// ends, so no request outlives its test.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const BOX_CLASSES = [
  'bg-status-error-subtle',
  'border-status-error',
  'text-content-status-error',
  'px-4',
  'py-3',
  'rounded-sm',
  'text-sm',
];

describe('FeedbackButton — the failure region (88.6.1-33, W019)', () => {
  it('R1 (W019, AC-24, D-22, R8 empty and adjacency): one assertive region, empty and visually hidden before the send, the SAME node carries the register line after a failure, and Submit is described by it only then', async () => {
    const { user, dialog } = await openDialog();

    // Before any outcome: exactly one alert in the dialog, mounted and EMPTY, sr-only.
    const alerts = within(dialog).getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    const before = alerts[0];
    expect(before).toHaveTextContent('');
    expect(before.textContent).toBe('');
    expect(before.classList.contains('sr-only')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Submit' })).not.toHaveAttribute(
      'aria-describedby'
    );

    writer().mockRejectedValueOnce(new ApiError(UPSTREAM, 'internal', 500, {}));
    await user.type(textareaIn(dialog), FIRST_MESSAGE);
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    // POSITIVE signal first: the register line is on screen.
    await within(dialog).findByText(INTERNAL_LINE);
    const after = within(dialog).getByRole('alert');
    // Node identity (C-6): a change to a mounted region, not the mount of a new one.
    expect(after).toBe(before);
    expect(after).toHaveTextContent(INTERNAL_LINE);
    expect(after.classList.contains('sr-only')).toBe(false);
    for (const cls of BOX_CLASSES) expect(after.classList.contains(cls)).toBe(true);

    // Submit is described by the region while it holds a message.
    const submit = within(dialog).getByRole('button', { name: 'Submit' });
    expect(after.id).not.toBe('');
    expect(submit.getAttribute('aria-describedby')).toBe(after.id);
    expect(document.getElementById(after.id)).toBe(after);

    // The backend's own string never reaches the dialog.
    expect(within(dialog).queryByText(new RegExp(UPSTREAM))).toBeNull();
    expect(dialog.textContent).not.toContain(UPSTREAM);

    // Adjacency: still exactly one alert, and no live region inside another.
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1);
    expect(hasNestedLiveRegion(dialog)).toBe(false);
  });

  it('R2 (R8 idempotency backstop): the same failure twice is a real text change on the SAME region node, so it is announced again', async () => {
    const { user, dialog } = await openDialog();
    const region = within(dialog).getByRole('alert');

    writer().mockRejectedValueOnce(new ApiError(UPSTREAM, 'internal', 500, {}));
    await user.type(textareaIn(dialog), FIRST_MESSAGE);
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await within(dialog).findByText(INTERNAL_LINE);
    expect(within(dialog).getByRole('alert')).toBe(region);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    try {
      writer().mockRejectedValueOnce(new ApiError(UPSTREAM, 'internal', 500, {}));
      await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
      // POSITIVE signal: the observer saw at least one text mutation on the region.
      await waitFor(() => expect(records.length).toBeGreaterThanOrEqual(1));
      await within(dialog).findByText(INTERNAL_LINE);
    } finally {
      observer.disconnect();
    }
    const after = within(dialog).getByRole('alert');
    expect(after).toBe(region);
    expect(after).toHaveTextContent(INTERNAL_LINE);
    expect(writer()).toHaveBeenCalledTimes(2);
  });
});

describe('FeedbackButton — the pressed Submit (88.6.1-33, D-35, Req 4 and 5)', () => {
  const LONG_ENOUGH = 'A message that is long enough.';
  const THANKS = 'Thanks! Your feedback has been submitted.';

  it('G1a (R4 concurrency): while the send is pending, Submit reads Submitting..., is aria-disabled and NOT natively disabled, and stays so after a second press; it is released when the first send settles', async () => {
    const held = deferred<unknown>();
    writer().mockImplementationOnce(() => held.promise);
    const { user, dialog } = await openDialog();
    await user.type(textareaIn(dialog), LONG_ENOUGH);
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    const busy = within(dialog).getByRole('button', { name: 'Submitting...' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toHaveAttribute('disabled');

    await user.click(busy);
    const stillBusy = within(dialog).getByRole('button', { name: 'Submitting...' });
    expect(stillBusy).toHaveAttribute('aria-disabled', 'true');
    expect(stillBusy).not.toHaveAttribute('disabled');

    await act(async () => {
      held.reject(new ApiError('x', 'internal', 500, {}));
    });
    const released = await within(dialog).findByRole('button', { name: 'Submit' });
    expect(released).not.toHaveAttribute('aria-disabled');
    expect(released).toBeEnabled();
    // CONFIRM-ONLY in jsdom (C-11: jsdom never blurs a disabled element, so this would also
    // hold against the native attribute). The real-browser proof is e2e/feedback-submit.spec.ts.
    expect(document.activeElement).toBe(released);
  });

  it('G1b (R4 idempotency, the latch): a forced form submit and a second press while pending send no second request', async () => {
    const held = deferred<unknown>();
    writer().mockImplementationOnce(() => held.promise);
    const { user, dialog } = await openDialog();
    await user.type(textareaIn(dialog), LONG_ENOUGH);
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submitting...' }));
    expect(writer()).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve({ success: true });
    });
    await within(dialog).findByText(THANKS);
    expect(writer()).toHaveBeenCalledTimes(1);
  });

  it('G2 (rule of KIND, confirm-only): the validity half stays native — 9 characters disable Submit with no aria-disabled, the 10th enables it', async () => {
    const { user, dialog } = await openDialog();
    await user.type(textareaIn(dialog), '123456789');
    const submit = within(dialog).getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    expect(submit).not.toHaveAttribute('aria-disabled');
    await user.type(textareaIn(dialog), '0');
    expect(within(dialog).getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('G3 (Req 5 / AC-14, R5 adjacency and the R5 ordering backstop): focus stays on Submit while the send is held, and moves to the thank-you line only after the success commits', async () => {
    const held = deferred<unknown>();
    writer().mockImplementationOnce(() => held.promise);
    const { user, dialog } = await openDialog();
    await user.type(textareaIn(dialog), LONG_ENOUGH);
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    // Ordering: nothing moves before the outcome.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Submitting...' }));

    await act(async () => {
      held.resolve({ success: true });
    });
    // POSITIVE signal: the thank-you line is in the DOM and holds focus.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText(THANKS)));
    const target = screen.getByText(THANKS);
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
    expect(document.activeElement).not.toBe(document.body);
    expect(target.tagName).toBe('P');
  });

  it('G4 (review r2 #189): the textarea is described by the character counter, so the minimum is heard on the field; Submit is not described by the counter', async () => {
    const { dialog } = await openDialog();
    const textarea = within(dialog).getByLabelText('Feedback');
    expect(textarea).toBe(textareaIn(dialog));
    expect(textarea).toHaveAccessibleDescription(/10 minimum/);
    const describedBy = textarea.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const counter = document.getElementById(describedBy as string);
    expect(counter).not.toBeNull();
    expect(counter).toHaveTextContent('0 characters (10 minimum)');
    // With no failure shown Submit carries no description at all: the counter's id never lands
    // on it (its description is the failure region's alone, and only while it holds a message).
    expect(within(dialog).getByRole('button', { name: 'Submit' })).not.toHaveAttribute(
      'aria-describedby'
    );
  });
});
