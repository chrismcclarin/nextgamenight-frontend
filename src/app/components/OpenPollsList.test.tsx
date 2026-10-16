// Phase 88.6.1 plan 29, task 2: OpenPollsList.
//
// What this suite pins:
// - R10 / AC-31: the poll message keeps typed line breaks (`whitespace-pre-line wrap-anywhere`),
//   renders as text and never as markup, and a run of 3+ breaks renders as one blank line (owner
//   ruling #115, plan 88.6.1-84's collapseBlankLines).
// - Req 4 / AC-12: one End request per check-in while the first is in flight.
// - D-24: a proxy CSRF 403 toasts the ordinary fallback, never the role refusal (confirm-only;
//   the RED half is plan 88.6.1-07's predicate).
// - R5 empty edge (AC-14): with no host target, focus floors to the page `main h1`.
//
// Numbering: 1-3, 6-10. Numbers 4 and 5 are retired here; plan 88.6.1-75 appends its AC-29 / RF1
// tests to this file in wave 6, reusing the file-scope mocks, render wrapper and deferred helper.
// Every comment is a `//` line (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const toastSpies = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastSpies.error, success: toastSpies.success } }));

vi.mock('@/app/components/StartPollModal', () => ({ default: () => null }));

// The importOriginal spread keeps ApiError and isCsrfRejection REAL, so getFetchErrorMessage sees
// the real predicate (FE-TESTING-CONVENTIONS C-3).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    promptAPI: {
      ...actual.promptAPI,
      getOpenPrompts: vi.fn(),
      closePrompt: vi.fn(),
    },
  };
});

import { promptAPI, ApiError } from '@/lib/api';
import OpenPollsList from './OpenPollsList';

const anyProps = (p: Record<string, unknown>): any => p;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function checkIn(id: string, username: string, extra: Record<string, unknown> = {}) {
  return { id, can_close: true, custom_message: null, Creator: { id: `u-${id}`, username }, ...extra };
}
const ROW_A = checkIn('pa', 'Ana');
const ROW_B = checkIn('pb', 'Ben');

function renderList(ui?: (list: React.ReactElement) => React.ReactElement, extra: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const list = (
    <OpenPollsList
      {...anyProps({ groupId: 'g1', group: { id: 'g1', games: [] }, userRole: 'member', ...extra })}
    />
  );
  return render(<QueryClientProvider client={client}>{ui ? ui(list) : list}</QueryClientProvider>);
}

const triggers = () => screen.getAllByRole('button', { name: 'Check-in actions' });

// Open a row's kebab and return the list its trigger names through aria-controls.
function openKebab(trigger: HTMLElement) {
  fireEvent.click(trigger);
  const list = document.getElementById(trigger.getAttribute('aria-controls') as string);
  expect(list, 'the kebab names its open list through aria-controls').not.toBeNull();
  return list as HTMLElement;
}

// Two-tap "End check-in". The second tap goes to the confirm label when it appears; when the item
// refuses the first tap (aria-disabled), the label never changes and the second tap goes to the
// same item, so this drive works on both a fixed and an unfixed tree.
function endCheckIn(trigger: HTMLElement) {
  const list = openKebab(trigger);
  fireEvent.click(within(list).getByRole('button', { name: 'End check-in' }));
  const confirm =
    within(list).queryByRole('button', { name: 'Tap again to end' }) ??
    within(list).getByRole('button', { name: 'End check-in' });
  fireEvent.click(confirm);
  return list;
}

// The message paragraphs, in row order.
const messageParagraphs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('li p.italic')) as HTMLParagraphElement[];

beforeEach(() => {
  vi.mocked(promptAPI.getOpenPrompts).mockReset();
  vi.mocked(promptAPI.closePrompt).mockReset();
  toastSpies.error.mockReset();
  toastSpies.success.mockReset();
});
afterEach(cleanup);

describe('OpenPollsList: the poll message renders typed line breaks as text (R10 / AC-31)', () => {
  it('1. a typed newline survives, and the paragraph carries both R10 classes', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [checkIn('pa', 'Ana', { custom_message: 'Line one\nLine two' })],
    } as never);
    const { container } = renderList();
    await screen.findByText('Started by Ana');

    const [p] = messageParagraphs(container);
    expect(p).toHaveClass('whitespace-pre-line');
    expect(p).toHaveClass('wrap-anywhere');
    expect(p.textContent).toContain('Line one\nLine two');
  });

  it('2. markup in the message renders as literal characters, never as an element', async () => {
    // Green by construction (React text child): an AC-31 encoding pin, not a fix pin.
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [checkIn('pa', 'Ana', { custom_message: '<b>x</b>' })],
    } as never);
    const { container } = renderList();
    await screen.findByText('Started by Ana');

    const row = container.querySelector('li') as HTMLElement;
    expect(row.textContent).toContain('<b>x</b>');
    expect(row.querySelector('b')).toBeNull();
  });

  it('3. whitespace-only messages render (spaces as typed, a run of three breaks as one blank line)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [
        checkIn('pa', 'Ana', { custom_message: '   ' }),
        checkIn('pb', 'Ben', { custom_message: '\n\n\n' }),
      ],
    } as never);
    const { container } = renderList();
    await screen.findByText('Started by Ben');

    const [spaces, breaks] = messageParagraphs(container);
    for (const p of [spaces, breaks]) {
      expect(p).toHaveClass('whitespace-pre-line');
      expect(p).toHaveClass('wrap-anywhere');
    }
    expect(spaces.textContent).toBe('“   ”');
    expect(breaks.textContent).toBe('“\n\n”');
  });

  it('10. a flood of blank lines renders as exactly one blank line (owner ruling #115)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [checkIn('pa', 'Ana', { custom_message: 'Top' + '\n'.repeat(5000) + 'Bottom' })],
    } as never);
    const { container } = renderList();
    await screen.findByText('Started by Ana');

    const paragraphs = messageParagraphs(container);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveClass('whitespace-pre-line');
    expect(paragraphs[0]).toHaveClass('wrap-anywhere');
    expect(paragraphs[0].textContent).toBe('“Top\n\nBottom”');
  });
});

describe('OpenPollsList: ending a check-in (Req 4, D-24, R5)', () => {
  it('6. a second End commit while the first is in flight sends no request; the item is aria-disabled', async () => {
    // What this pins is the one-request OUTCOME. Its call-count arm is also satisfied by
    // KebabMenu's handler refusal of an aria-disabled item, which runs before handleClose, so it
    // stays green with the ref latch deleted; the latch's own claim is shown by the planted run
    // recorded in the plan 29 SUMMARY.
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    const close = deferred<unknown>();
    vi.mocked(promptAPI.closePrompt).mockImplementationOnce(() => close.promise as never);
    renderList();
    await screen.findByText('Started by Ana');

    endCheckIn(triggers()[0]);
    const reopened = endCheckIn(triggers()[0]);

    expect(promptAPI.closePrompt).toHaveBeenCalledTimes(1);
    const endItem = within(reopened).getByRole('button', { name: 'End check-in' });
    expect(endItem).toHaveAttribute('aria-disabled', 'true');
    expect(endItem).not.toHaveAttribute('disabled');

    await act(async () => {
      close.reject(new ApiError('x', 'internal', 500));
    });
    await act(async () => {});
    expect(within(reopened).getByRole('button', { name: 'End check-in' })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('7. a proxy CSRF 403 toasts the ordinary fallback, never the role refusal (D-24, confirm-only)', async () => {
    // Confirm-only here: the RED half is plan 88.6.1-07's isCsrfRejection predicate.
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A] } as never);
    vi.mocked(promptAPI.closePrompt).mockRejectedValueOnce(
      new ApiError('Cross-origin request rejected', 'forbidden', 403, {
        error: 'Cross-origin request rejected',
        csrf_rejected: true,
      })
    );
    renderList();
    await screen.findByText('Started by Ana');

    endCheckIn(triggers()[0]);
    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("We couldn't end that check-in. Please try again.")
    );
    expect(toastSpies.error).not.toHaveBeenCalledWith(
      'Only the poll creator and group admins can end a check-in.'
    );
  });

  it('8. a real 403 (no CSRF flag) still prints the role sentence (D-24 control, confirm-only)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A] } as never);
    vi.mocked(promptAPI.closePrompt).mockRejectedValueOnce(new ApiError('nope', 'forbidden', 403));
    renderList();
    await screen.findByText('Started by Ana');

    endCheckIn(triggers()[0]);
    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith(
        'Only the poll creator and group admins can end a check-in.'
      )
    );
  });

  it('9. with no host target, focus floors to the page main h1 once the row is gone (R5 empty)', async () => {
    const refetch = deferred<{ prompts: unknown[] }>();
    const close = deferred<unknown>();
    vi.mocked(promptAPI.getOpenPrompts)
      .mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never)
      .mockImplementationOnce(() => refetch.promise as never);
    vi.mocked(promptAPI.closePrompt).mockImplementationOnce(() => close.promise as never);
    renderList((list) => (
      <main>
        <h1>Plan Game Session</h1>
        {list}
      </main>
    ));
    await screen.findByText('Started by Ana');

    endCheckIn(triggers()[0]);
    await act(async () => {
      close.resolve({});
    });
    await act(async () => {
      refetch.resolve({ prompts: [ROW_B] });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Plan Game Session' }));
      expect(screen.queryByText('Started by Ana')).toBeNull();
    });
  });
});
