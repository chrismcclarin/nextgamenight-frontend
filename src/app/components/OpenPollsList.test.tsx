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
// - quick-261025-rl3 (261025-dzo review WR-02): an automatic card reads its source label from the
//   wire's schedule_name, then the include's template_name, then the fallback. Tests SL-1..SL-5.
//
// - quick-261026-pi6 (owner R1/R2/R3): the card body is one button that selects the poll, the selected card wears the link-colour border and the Viewing tag, and the chip labels name each poll. Tests SEL-1..SEL-7 and LBL-1..LBL-4 (quick-261026-pi6).
//
// Numbers 4 and 5 are retired here; plan 88.6.1-75's tests reuse the file-scope mocks, render
// wrapper and deferred helper. Numbering: 1-3, 6-10, then RF-1..RF-11, then SL-1..SL-5, then SEL-1..SEL-7 and LBL-1..LBL-4.
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
// A namespace import, so a missing label export fails the LBL tests alone and the rest of the
// file still runs (quick-261026-pi6).
import * as OpenPollsModule from './OpenPollsList';

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

// The message lines, in row order. They are block spans since quick-261026-pi6 (the card body
// is a button, which holds phrasing content only).
const messageParagraphs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('li span.italic')) as HTMLElement[];

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

  // 88.6.1 code review follow-up (contract (1) audit of the bare arm() in handleClose): an End
  // committed with focus on <body> (the WebKit tap shape) still recovers. The arm needs no `from`
  // here: End is a KebabMenu item, and KebabMenu's restoreFocusToTrigger hands focus to the row's
  // trigger, which the hook follows (useFocusRecovery.ts contract (1), its KebabMenu clause).
  it('9b. an End committed with focus on body still floors to the page h1 once the row is gone (contract (1) KebabMenu clause, confirm-only)', async () => {
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

    const list = openKebab(triggers()[0]);
    fireEvent.click(within(list).getByRole('button', { name: 'End check-in' }));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(within(list).getByRole('button', { name: 'Tap again to end' }));
    await act(async () => {
      close.resolve({});
    });
    await act(async () => {
      refetch.resolve({ prompts: [ROW_B] });
    });
    await waitFor(() => {
      expect(screen.queryByText('Started by Ana')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Plan Game Session' }));
    });
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
// 88.6.1 code review CR-6 / A-22 (owner ratified 2026-10-19): this notice passes `sectionName`,
// so its polite region and the Retry's description say "Open polls: " first and the visible line
// holds RF1 alone — RF1 by exact text is found ONCE, the region holds SPOKEN.
const SPOKEN = "Open polls: Couldn't refresh. Showing what loaded earlier.";
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

    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });
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
    // Wait until BOTH copies are in (a region inserted mid-failure fills only after plan 70's
    // dwell), so the identity check below is what decides this test.
    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });

    const region = screen.getAllByRole('status').find((n) => n.textContent === SPOKEN);
    expect(region, 'a status region carries the RF1 sentence').toBeDefined();
    // Node identity (FE-TESTING-CONVENTIONS C-6): the region was in the DOM while healthy.
    expect(before).toContain(region);
  });

  it('RF-3. a successful Retry removes Ana and the notice, and focus lands on the Check-ins control (C8 c, D-05)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client, expandControl } = renderHosted();
    await failRefetchOverRows(client, e500());
    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });

    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_B] } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(expandControl());
      expect(screen.queryByText('Started by Ana')).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-CR6 (CR-6 / A-22): the notice names Open polls in its region and in the Retry description, never visibly', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client } = renderList();
    await failRefetchOverRows(client, e500());
    await waitFor(() => expect(screen.getAllByRole('status').find((n) => n.textContent === SPOKEN)).toBeDefined());
    expect(screen.getAllByText(RF1)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(SPOKEN);
  });

  it('RF-4. a list that loaded EMPTY stays under the RF1 notice, with one Start a check-in (owner ruling Y)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [] } as never);
    const { client } = renderList();
    await screen.findByText('No check-ins running');
    vi.mocked(promptAPI.getOpenPrompts).mockRejectedValue(e500());
    await act(async () => {
      await client.refetchQueries({ queryKey: key });
    });

    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });
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

    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });
    expect(screen.getByText('Started by Ana')).toBeInTheDocument();
    expect(screen.getByText('Started by Ben')).toBeInTheDocument();
    expect(screen.queryByText(FULL_TITLE)).toBeNull();
  });

  it('RF-9. an unpressed 403 refresh withdraws the rows while a row control holds focus: focus goes to the Check-ins control (C8 f1, C12 a)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const { client, expandControl } = renderHosted();
    await failRefetchOverRows(client, e500());
    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });

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
    await waitFor(() => {
      expect(screen.getAllByText(RF1)).toHaveLength(1);
      expect(screen.getByText(SPOKEN)).toBeInTheDocument();
    });

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

// An automatic poll as the open-polls route sends it: the settings link set, no Creator.
function autoCheckIn(id: string, extra: Record<string, unknown> = {}) {
  return checkIn(id, 'unused', { created_by_settings_id: 'set-1', Creator: null, ...extra });
}

describe('OpenPollsList: the automatic card names its schedule (quick-261025-rl3, dzo review WR-02)', () => {
  it('SL-1. schedule_name wins over the include template_name', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [
        autoCheckIn('pauto', {
          schedule_name: 'Sunday Wingspan',
          GroupPromptSetting: { id: 'set-1', template_name: 'Old settings name' },
        }),
      ],
    } as never);
    renderList();
    // Positive text first (CF-26), so the absence below is not read before the list paints.
    expect(await screen.findByText('From Sunday Wingspan')).toBeInTheDocument();
    expect(screen.queryByText('From Old settings name')).toBeNull();
  });

  it('SL-2. with no schedule_name the include template_name is the fallback', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [autoCheckIn('pauto', { GroupPromptSetting: { id: 'set-1', template_name: 'Old settings name' } })],
    } as never);
    renderList();
    expect(await screen.findByText('From Old settings name')).toBeInTheDocument();
  });

  it('SL-3. with neither name the card reads From recurring schedule', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [autoCheckIn('pauto', { GroupPromptSetting: null })],
    } as never);
    renderList();
    expect(await screen.findByText('From recurring schedule')).toBeInTheDocument();
  });

  it('SL-4. a non-string schedule_name degrades to the fallback and the card stays', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [
        autoCheckIn('pauto', {
          schedule_name: 42,
          GroupPromptSetting: { id: 'set-1', template_name: null },
        }),
      ],
    } as never);
    renderList();
    const label = await screen.findByText('From recurring schedule');
    // The card is present: the label sits inside a list row, beside the row title.
    const card = label.closest('li') as HTMLElement;
    expect(card, 'the automatic card is rendered').not.toBeNull();
    expect(within(card).getByText('Availability check-in')).toBeInTheDocument();
    expect(screen.queryByText('From 42')).toBeNull();
  });

  it('SL-5. a manual card with a stray schedule_name still reads Started by its creator', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [checkIn('pa', 'Ana', { schedule_name: 'Sunday Wingspan' })],
    } as never);
    renderList();
    expect(await screen.findByText('Started by Ana')).toBeInTheDocument();
    expect(screen.queryByText('From Sunday Wingspan')).toBeNull();
  });
});

// quick-261026-pi6 (owner R1/R2, 2026-10-26): the card body is ONE native button that selects the
// poll; the kebab stays its sibling. A body is found by its role and its accessible name.
const cardBody = (name: RegExp) => screen.getByRole('button', { name });

describe('OpenPollsList: the card body selects the poll (quick-261026-pi6, owner R1/R2)', () => {
  it('SEL-1. tapping a card body calls onSelectPoll once with that poll id', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    const onSelectPoll = vi.fn();
    renderList(undefined, { onSelectPoll });
    await screen.findByText('Started by Ana');
    fireEvent.click(cardBody(/Started by Ana/));
    expect(onSelectPoll).toHaveBeenCalledTimes(1);
    expect(onSelectPoll).toHaveBeenCalledWith('pa');
  });

  it('SEL-2. the selected poll body is pressed and the other is not', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    renderList(undefined, { onSelectPoll: vi.fn(), selectedPollId: 'pb' });
    await screen.findByText('Started by Ben');
    expect(cardBody(/Started by Ben/)).toHaveAttribute('aria-pressed', 'true');
    expect(cardBody(/Started by Ana/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('SEL-3. the Viewing tag renders once, in the selected row only, and stays out of the name', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    renderList(undefined, { onSelectPoll: vi.fn(), selectedPollId: 'pb' });
    await screen.findByText('Started by Ben');
    const tags = screen.getAllByText('Viewing');
    expect(tags).toHaveLength(1);
    const benRow = cardBody(/Started by Ben/).closest('li') as HTMLElement;
    const anaRow = cardBody(/Started by Ana/).closest('li') as HTMLElement;
    expect(benRow.contains(tags[0])).toBe(true);
    expect(anaRow.contains(tags[0])).toBe(false);
    expect(tags[0]).toHaveAttribute('aria-hidden', 'true');
    // aria-pressed already says selected, so no button's accessible name carries the tag.
    expect(screen.queryByRole('button', { name: /Viewing/ })).toBeNull();
  });

  it('SEL-4. opening the kebab and ending the check-in never selects the poll', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    vi.mocked(promptAPI.closePrompt).mockResolvedValue({} as never);
    const onSelectPoll = vi.fn();
    renderList(undefined, { onSelectPoll });
    await screen.findByText('Started by Ana');
    const anaBody = cardBody(/Started by Ana/);
    const [anaTrigger] = triggers();
    // The kebab is the body's sibling, never a control inside it.
    expect(anaBody.contains(anaTrigger)).toBe(false);
    expect(anaBody.closest('li')?.contains(anaTrigger)).toBe(true);
    endCheckIn(anaTrigger);
    await waitFor(() => expect(promptAPI.closePrompt).toHaveBeenCalledTimes(1));
    expect(onSelectPoll).not.toHaveBeenCalled();
  });

  it('SEL-5. the body floors at 44px with the inset ring; the selected row wears the 2px link border', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    renderList(undefined, { onSelectPoll: vi.fn(), selectedPollId: 'pb' });
    await screen.findByText('Started by Ben');
    const anaBody = cardBody(/Started by Ana/);
    const benBody = cardBody(/Started by Ben/);
    expect(anaBody).toHaveClass('min-h-11', 'text-left', 'p-3', 'focus-visible:ring-inset');
    expect(anaBody).not.toHaveClass('focus-visible:ring-offset-2');
    // One pixel less padding when selected, so the 2px border does not grow the card.
    expect(benBody).toHaveClass('p-[11px]');
    expect(benBody.closest('li')).toHaveClass('border-2', 'border-content-link');
    const anaRow = anaBody.closest('li') as HTMLElement;
    expect(anaRow).toHaveClass('border', 'border-line');
    expect(anaRow).not.toHaveClass('border-2');
  });

  it('SEL-6. a body button holds phrasing content only (no paragraph, no div)', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({
      prompts: [checkIn('pa', 'Ana', { custom_message: 'Bring snacks', deadline: '2026-11-02T18:00:00Z' }), ROW_B],
    } as never);
    renderList(undefined, { onSelectPoll: vi.fn(), selectedPollId: 'pa' });
    await screen.findByText('Started by Ana');
    expect(cardBody(/Started by Ana/).querySelector('p, div')).toBeNull();
    expect(cardBody(/Started by Ben/).querySelector('p, div')).toBeNull();
  });

  it('SEL-7. without onSelectPoll the body is not a button and no Viewing tag renders', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    renderList(undefined, { selectedPollId: 'pa' });
    const label = await screen.findByText('Started by Ana');
    expect(screen.queryByRole('button', { name: /Started by Ana/ })).toBeNull();
    expect(screen.queryByText('Viewing')).toBeNull();
    // The card markup is the same in both modes: its text lines are block spans.
    expect(label.tagName).toBe('SPAN');
  });
});

type ChipLabels = (prompts: Record<string, unknown>[], group: Record<string, unknown>) => Map<string, string>;
const chipLabels = (prompts: Record<string, unknown>[], group: Record<string, unknown> = { id: 'g1', games: [] }) =>
  ((OpenPollsModule as unknown as { pollChipLabels: ChipLabels }).pollChipLabels)(prompts, group);

describe('pollChipLabels (quick-261026-pi6, brief B7 label rule)', () => {
  it('LBL-1. a generic manual poll is named for its starter, or for a group member when none is known', () => {
    const labels = chipLabels([ROW_A, ROW_B, checkIn('pc', 'unused', { Creator: null })]);
    expect(labels.get('pa')).toBe("Ana's check-in");
    expect(labels.get('pb')).toBe("Ben's check-in");
    expect(labels.get('pc')).toBe("A group member's check-in");
    for (const label of labels.values()) {
      expect(label).toContain("'");
      expect(label).not.toContain('’');
    }
  });

  it('LBL-2. a poll for one of the group games is named for that game', () => {
    const labels = chipLabels([checkIn('pg', 'Ana', { game_id: 'game-1' })], {
      id: 'g1',
      games: [{ id: 'game-1', name: 'Wingspan' }],
    });
    expect(labels.get('pg')).toBe('Wingspan');
  });

  it('LBL-3. a generic automatic poll is named for its schedule, then the include, then the fallback', () => {
    const labels = chipLabels([
      autoCheckIn('p1', { schedule_name: 'Sunday Wingspan' }),
      autoCheckIn('p2', { GroupPromptSetting: { id: 'set-1', template_name: 'Old settings name' } }),
      autoCheckIn('p3', { GroupPromptSetting: null }),
    ]);
    expect(labels.get('p1')).toBe('Sunday Wingspan');
    expect(labels.get('p2')).toBe('Old settings name');
    expect(labels.get('p3')).toBe('recurring schedule');
  });

  it('LBL-4. colliding labels get the deadline date; a colliding poll with no deadline keeps the bare name', () => {
    const d1 = '2026-11-02T18:00:00Z';
    const d2 = '2026-11-09T18:00:00Z';
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const labels = chipLabels([
      autoCheckIn('p1', { schedule_name: 'Sunday Wingspan', deadline: d1 }),
      autoCheckIn('p2', { schedule_name: 'Sunday Wingspan', deadline: d2 }),
      autoCheckIn('p3', { schedule_name: 'Sunday Wingspan' }),
    ]);
    expect(labels.get('p1')).toBe(`Sunday Wingspan, ${fmt.format(new Date(d1))}`);
    expect(labels.get('p2')).toBe(`Sunday Wingspan, ${fmt.format(new Date(d2))}`);
    expect(labels.get('p3')).toBe('Sunday Wingspan');
  });
});

describe('OpenPollsList: ending a check-in tells the host (quick-261026-pi6-fix F8)', () => {
  it('OPC-1. a successful end calls onPollClosed once with that poll id, after the list refresh', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A, ROW_B] } as never);
    vi.mocked(promptAPI.closePrompt).mockResolvedValue({} as never);
    const onPollClosed = vi.fn();
    renderList(undefined, { onSelectPoll: vi.fn(), onPollClosed });
    await screen.findByText('Started by Ana');
    endCheckIn(triggers()[0]);
    await waitFor(() => expect(onPollClosed).toHaveBeenCalledTimes(1));
    expect(onPollClosed).toHaveBeenCalledWith('pa');
    // The refresh ran before the call: the list GET went out twice by then.
    expect(promptAPI.getOpenPrompts).toHaveBeenCalledTimes(2);
  });

  it('OPC-2. a failed end never calls onPollClosed', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValue({ prompts: [ROW_A] } as never);
    vi.mocked(promptAPI.closePrompt).mockRejectedValueOnce(new ApiError('x', 'internal', 500));
    const onPollClosed = vi.fn();
    renderList(undefined, { onSelectPoll: vi.fn(), onPollClosed });
    await screen.findByText('Started by Ana');
    endCheckIn(triggers()[0]);
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalledTimes(1));
    expect(onPollClosed).not.toHaveBeenCalled();
  });
});
