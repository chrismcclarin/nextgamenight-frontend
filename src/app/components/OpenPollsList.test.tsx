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
// - AC-29 / RF1 (plan 88.6.1-75, owner ruling D-47): a failed refresh keeps the check-ins under
//   plan 88.6.1-70's RefreshFailedNotice; an access or gone answer withdraws them under the full
//   banner (C10); focus never falls to <body> when they leave (C12). Tests RF-1..RF-11.
//
// Numbering: 1-3, 6-10, then RF-1..RF-11. Numbers 4 and 5 are retired here; plan 88.6.1-75's
// tests reuse the file-scope mocks, render wrapper and deferred helper.
// Every comment is a `//` line (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { promptKeys } from '@/lib/queryKeys/promptKeys';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';
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

// The client is returned so a test can drive its query (plan 88.6.1-75's RF tests refetch through
// it), and a test may pass its own (RF-11 keeps the cached entry across a remount).
function renderList(
  ui?: (list: React.ReactElement) => React.ReactElement,
  extra: Record<string, unknown> = {},
  client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
) {
  const list = (
    <OpenPollsList
      {...anyProps({ groupId: 'g1', group: { id: 'g1', games: [] }, userRole: 'member', ...extra })}
    />
  );
  return { ...render(<QueryClientProvider client={client}>{ui ? ui(list) : list}</QueryClientProvider>), client };
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

// Copy row RF1 / D-47: plan 88.6.1-70's REFRESH_FAILED_NOTICE, written once in this file (C7). While
// the notice shows and its region is not quiet it is in the DOM twice: the visible line and the one
// polite region.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
const FULL_TITLE = "We couldn't load the check-ins";

describe('OpenPollsList — a failed refresh keeps the check-ins under the RF1 notice (88.6.1-75, AC-29 / D-47)', () => {
  const key = promptKeys.openPolls('g1');
  const e500 = () => new ApiError('Server error', 'internal', 500);

  // tabReturn() defines visibilityState on the document instance; deleting it restores jsdom's own.
  afterEach(() => {
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });

  // RF-3's host: the page floor heading, and a stand-in for the Section's Check-ins expand control
  // (plan 29's `focusFallbackRef`, D-05), rendered OUTSIDE the list as the Section renders it.
  function renderHosted(client?: QueryClient) {
    const expandRef = React.createRef<HTMLDivElement>();
    const result = renderList(
      (list) => (
        <main>
          <h1>Plan Game Session</h1>
          <div role="button" tabIndex={0} ref={expandRef}>
            Check-ins
          </div>
          {list}
        </main>
      ),
      { focusFallbackRef: expandRef },
      client
    );
    return { ...result, expandControl: () => expandRef.current as HTMLDivElement };
  }

  // First load [Ana, Ben], then a refetch that fails with `error` (the REAL ApiError, so its code
  // reaches useFetchErrorState unflattened). Returns once the refetch has settled.
  async function failRefetchOverRows(client: QueryClient, error: unknown) {
    await screen.findByText('Started by Ana');
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(error);
    await act(async () => {
      await client.refetchQueries({ queryKey: key });
    });
  }

  // The hook's tab-return re-attempt: a refresh nobody pressed (useFetchErrorState.test.tsx's
  // fireVisibility idiom).
  function tabReturn() {
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  it('RF-1. a 500 refetch keeps both rows under the RF1 notice with one Retry, and no full banner (C8 a / e)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client } = renderList();
    await failRefetchOverRows(client, e500());

    expect(await screen.findAllByText(RF1)).toHaveLength(2);
    expect(screen.getByText('Started by Ana')).toBeInTheDocument();
    expect(screen.getByText('Started by Ben')).toBeInTheDocument();
    expect(screen.queryByText(FULL_TITLE)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('RF-2. the RF1 region is one of the status nodes that were there BEFORE the failure (C8 b, R8)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client } = renderList();
    await screen.findByText('Started by Ana');
    const before = screen.queryAllByRole('status');

    await failRefetchOverRows(client, e500());
    expect(await screen.findAllByText(RF1)).toHaveLength(2);

    const region = screen.getAllByRole('status').find((n) => n.textContent === RF1);
    expect(region, 'a status region carries the RF1 sentence').toBeDefined();
    // Node identity (FE-TESTING-CONVENTIONS C-6): the region was in the DOM while healthy.
    expect(before).toContain(region);
  });

  it('RF-3. a successful Retry removes Ana and the notice, and focus lands on the Check-ins control (C8 c, D-05)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client, expandControl } = renderHosted();
    await failRefetchOverRows(client, e500());
    expect(await screen.findAllByText(RF1)).toHaveLength(2);

    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_B] } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(expandControl());
      expect(screen.queryByText('Started by Ana')).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-4. a list that loaded EMPTY stays under the RF1 notice, with one Start a check-in (owner ruling Y)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [] } as never);
    const { client } = renderList();
    await screen.findByText('No check-ins running');
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(e500());
    await act(async () => {
      await client.refetchQueries({ queryKey: key });
    });

    expect(await screen.findAllByText(RF1)).toHaveLength(2);
    expect(screen.getByText('No check-ins running')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '+ Start a check-in' })).toHaveLength(1);
    expect(screen.queryByText(FULL_TITLE)).toBeNull();
  });

  it('RF-5. a failed FIRST load shows the full banner alone: no RF1, no empty state, the header CTA kept (control)', async () => {
    // Confirm-only: green before and after; it pins that the first-load arm is unchanged.
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(e500());
    renderList();

    expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText('No check-ins running')).toBeNull();
    expect(screen.getAllByRole('button', { name: '+ Start a check-in' })).toHaveLength(1);
  });

  it('RF-6. a 401 refetch withdraws the rows under the full banner and its register line, never RF1 (C8 e, C10)', async () => {
    const e401 = new ApiError('Unauthorized', 'unauthorized', 401);
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client } = renderList();
    await failRefetchOverRows(client, e401);

    expect(await screen.findByText(getFetchErrorMessage(e401))).toBeInTheDocument();
    expect(screen.getByText(FULL_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Started by Ana')).toBeNull();
    expect(screen.queryByText('Started by Ben')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: '+ Start a check-in' })).toHaveLength(1);
  });

  it('RF-7. after a 403, a later 500 keeps the rows withdrawn until a success (C8 e, C10 memory)', async () => {
    const e403 = new ApiError('Access denied', 'forbidden', 403);
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client } = renderList();
    await failRefetchOverRows(client, e403);

    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();
    expect(screen.queryByText('Started by Ana')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    const later = e500();
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(later);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(getFetchErrorMessage(later))).toBeInTheDocument();
    expect(screen.queryByText('Started by Ana')).toBeNull();
    expect(screen.queryByText('Started by Ben')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-8. a network failure on refetch keeps both rows under the RF1 notice (C8 e)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client } = renderList();
    await failRefetchOverRows(client, new ApiError('Network', 'network', 0));

    expect(await screen.findAllByText(RF1)).toHaveLength(2);
    expect(screen.getByText('Started by Ana')).toBeInTheDocument();
    expect(screen.getByText('Started by Ben')).toBeInTheDocument();
    expect(screen.queryByText(FULL_TITLE)).toBeNull();
  });

  it('RF-9. an unpressed 403 refresh withdraws the rows while a row control holds focus: focus goes to the Check-ins control (C8 f1, C12 a)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client, expandControl } = renderHosted();
    await failRefetchOverRows(client, e500());
    expect(await screen.findAllByText(RF1)).toHaveLength(2);

    const e403 = new ApiError('Access denied', 'forbidden', 403);
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(e403);
    act(() => triggers()[0].focus());
    tabReturn();

    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(expandControl()));
    expect(screen.queryByText('Started by Ana')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-10. an unpressed refresh that SUCCEEDS while Retry holds focus lands focus on the Check-ins control (C8 f2, C12 b)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client, expandControl } = renderHosted();
    await failRefetchOverRows(client, e500());
    expect(await screen.findAllByText(RF1)).toHaveLength(2);

    act(() => screen.getByRole('button', { name: 'Retry' }).focus());
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_B] } as never);
    tabReturn();

    await waitFor(() => {
      expect(document.activeElement).toBe(expandControl());
      expect(screen.queryByText('Started by Ana')).toBeNull();
    });
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-11. the access memory survives a remount over the cached 500, until a success clears it (C10, finding #309)', async () => {
    // gcTime Infinity: the describe's gcTime 0 would drop the cached rows at the unmount and make
    // this arm vacuous.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const first = renderList(undefined, {}, client);
    await screen.findByText('Started by Ana');

    const e403 = new ApiError('Access denied', 'forbidden', 403);
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValueOnce(e403);
    await act(async () => {
      await client.refetchQueries({ queryKey: key });
    });
    expect(await screen.findByText(getFetchErrorMessage(e403))).toBeInTheDocument();

    const later = e500();
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(later);
    await act(async () => {
      await client.refetchQueries({ queryKey: key });
    });
    expect(await screen.findByText(getFetchErrorMessage(later))).toBeInTheDocument();
    expect(screen.queryByText('Started by Ana')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    first.unmount();
    // Not vacuous: the cache still holds the pre-403 rows and the 500.
    const cached = client.getQueryData(key) as { prompts: { id: string }[] } | undefined;
    expect(cached?.prompts.map((p) => p.id)).toEqual([ROW_A.id, ROW_B.id]);
    expect(client.getQueryState(key)?.status).toBe('error');

    renderList(undefined, {}, client);
    expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Started by Ana')).toBeNull();
    expect(screen.queryByText('Started by Ben')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_B] } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Started by Ben')).toBeInTheDocument();
    client.clear();
  });
});
