// PromptScheduleReadOnly — the Recurring Check-ins summary inside Customize Group keeps what loaded
// earlier when a later refresh fails (Phase 88.6.1 plan 30: MEDLOW-7 / AC-29, copy row RF1 / D-47,
// owner ruling Y, plan 70 contract C1-C12).
//
// Shapes this suite pins, each against the real FetchErrorBanner module (contract C9: no mock of
// it here) and the real useFetchErrorState:
// - a failed REFRESH over a loaded list keeps the rows and the true count under the RF1 notice,
//   whose polite region was already in the DOM while the summary was healthy (C8 a, b);
// - a list that loaded EMPTY keeps its empty sentence and its (0) under the notice (ruling Y);
// - a failed FIRST load shows the full banner and nothing else (error before empty);
// - Retry recovers and lands focus on the section heading (C8 c);
// - a 401 or 403 never keeps the rows, a 500 or a network failure does (C8 e, C10);
// - focus never falls to the page body when a refresh nobody pressed withdraws the rows or
//   succeeds (C8 f, C12);
// - the access memory outlives a remount over a cached error (C10's TanStack form, #309).
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    promptSettingsAPI: {
      ...actual.promptSettingsAPI,
      getGroupPromptSettings: vi.fn(),
    },
  };
});

import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import { promptSettingsAPI, ApiError } from '@/lib/api';
import { promptKeys } from '@/lib/queryKeys/promptKeys';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

type Mock = ReturnType<typeof vi.fn>;

// Copy row RF1 / D-47 (plan 70's REFRESH_FAILED_NOTICE). Written once here; the component never
// writes it (contract C7). While the notice shows it is in the DOM TWICE: the visible line and
// the one polite region. The positive signal waits for BOTH copies (waitFor + getAllByText):
// findAllByText resolves at the first match, so a region that fills a moment later would read 1.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
// The full banner's title at this site (the component's own shipped title, unchanged).
const FULL_TITLE = "We couldn't load your schedules";

const THURSDAY = { id: 's1', template_name: 'Thursday check-in', is_active: true };
const SUNDAY = { id: 's2', template_name: 'Sunday check-in', is_active: false };
const SETTINGS = { id: 'set1', schedules: [THURSDAY, SUNDAY], games: [], members: [] };
const KEY = promptKeys.settings('g1');

const getSettings = () => promptSettingsAPI.getGroupPromptSettings as unknown as Mock;
const anyProps = (p: Record<string, unknown>): any => p;

function newClient(gcTime = 0) {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime } } });
}

function renderReadOnly(client: QueryClient = newClient()) {
  const utils = render(
    <QueryClientProvider client={client}>
      <PromptScheduleReadOnly
        {...anyProps({ groupId: 'g1', groupPageUrl: '/groupHomePage?id=g1' })}
      />
    </QueryClientProvider>
  );
  return { client, ...utils };
}

// The house idiom for a refresh nobody pressed: the hook's tab-return re-attempt
// (src/components/ui/useFetchErrorState.test.tsx ("function fireVisibility")).
function fireVisibility() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function refresh(client: QueryClient) {
  await act(async () => {
    await client.invalidateQueries({ queryKey: KEY });
  });
}

// Loads the two-schedule list, captures the polite regions present while healthy, then fails a
// refresh with a transient answer and waits for RF1 (both copies).
async function reachRetainedFailure() {
  getSettings().mockResolvedValueOnce(SETTINGS);
  const rendered = renderReadOnly();
  await screen.findByText('Thursday check-in');
  const before = screen.queryAllByRole('status');
  getSettings().mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
  await refresh(rendered.client);
  await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
  return { ...rendered, before };
}

beforeEach(() => {
  getSettings().mockReset();
});

afterEach(cleanup);

describe('PromptScheduleReadOnly — a failed refresh keeps what loaded earlier (88.6.1-30, MEDLOW-7 / RF1)', () => {
  it('R1. a failed refresh keeps the rows and the true count under RF1, in a region that was already there', async () => {
    const { before } = await reachRetainedFailure();

    expect(screen.getByText('Thursday check-in')).toBeInTheDocument();
    expect(screen.getByText('Sunday check-in')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins (1)' })).toBeInTheDocument();
    expect(screen.queryByText(FULL_TITLE)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    const region = screen.getAllByRole('status').find((n) => n.textContent === RF1);
    expect(region).toBeDefined();
    // C8 (b): the node that speaks is one that existed while the summary was healthy.
    expect(before).toContain(region);
  });

  it('R2. a list that loaded EMPTY keeps its empty sentence and its (0) under RF1 (owner ruling Y)', async () => {
    getSettings().mockResolvedValueOnce({ ...SETTINGS, schedules: [] });
    const { client } = renderReadOnly();
    await screen.findByText('No schedules configured.');
    getSettings().mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    await refresh(client);

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('No schedules configured.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins (0)' })).toBeInTheDocument();
    expect(screen.queryByText(FULL_TITLE)).toBeNull();
  });

  it('R3. a failed FIRST load shows the full banner and never the empty sentence, a count or RF1 (control)', async () => {
    getSettings().mockRejectedValue(new Error('boom'));
    renderReadOnly();

    expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Thursday check-in')).toBeNull();
    expect(screen.queryByText('Sunday check-in')).toBeNull();
    expect(screen.queryByText('No schedules configured.')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins' })).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('R4. a successful Retry removes the notice and lands focus on the section heading', async () => {
    await reachRetainedFailure();
    getSettings().mockResolvedValueOnce({ ...SETTINGS, schedules: [THURSDAY] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 3, name: /^Recurring Check-ins/ })
      );
      expect(screen.queryByText('Sunday check-in')).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('R5. a 401 and a 403 refresh never keep the rows: the full banner with the register line, no RF1, no count (C8 e)', async () => {
    for (const err of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      getSettings().mockReset();
      getSettings().mockResolvedValueOnce(SETTINGS).mockRejectedValue(err);
      const { client } = renderReadOnly();
      await screen.findByText('Thursday check-in');
      await refresh(client);

      expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();
      expect(screen.getByText(getFetchErrorMessage(err))).toBeInTheDocument();
      expect(screen.queryByText('Thursday check-in')).toBeNull();
      expect(screen.queryByText('Sunday check-in')).toBeNull();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      expect(screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('R6. a 500 and a network failure keep the rows under RF1 with the true count (C8 e)', async () => {
    for (const err of [
      new ApiError('Server error', 'internal', 500),
      new ApiError('Network error', 'network', 0),
    ]) {
      getSettings().mockReset();
      getSettings().mockResolvedValueOnce(SETTINGS).mockRejectedValue(err);
      const { client } = renderReadOnly();
      await screen.findByText('Thursday check-in');
      await refresh(client);

      await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
      expect(screen.getByText('Thursday check-in')).toBeInTheDocument();
      expect(screen.getByText('Sunday check-in')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins (1)' })).toBeInTheDocument();
      expect(screen.queryByText(FULL_TITLE)).toBeNull();
      cleanup();
    }
  });

  it('R7. a refresh nobody pressed answered 403 while Retry holds focus lands focus on the heading, never <body> (C8 f1)', async () => {
    await reachRetainedFailure();
    screen.getByRole('button', { name: 'Retry' }).focus();
    getSettings().mockRejectedValue(new ApiError('Forbidden', 'forbidden', 403));
    act(() => {
      fireVisibility();
    });

    expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins' })
      )
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByText('Thursday check-in')).toBeNull();
    expect(screen.queryByText('Sunday check-in')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('R8. a refresh nobody pressed that succeeds while Retry holds focus lands focus on the heading (C8 f2)', async () => {
    await reachRetainedFailure();
    screen.getByRole('button', { name: 'Retry' }).focus();
    getSettings().mockResolvedValue(SETTINGS);
    act(() => {
      fireVisibility();
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins (1)' })
      )
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('R9. an access answer is remembered across a remount over a cached 500, until the next success (C10, #309)', async () => {
    // gcTime Infinity: the suite default of 0 would drop the cached rows at the unmount and
    // make this arm vacuous.
    const client = newClient(Infinity);
    getSettings().mockResolvedValueOnce(SETTINGS);
    const first = renderReadOnly(client);
    await screen.findByText('Thursday check-in');

    getSettings().mockRejectedValueOnce(new ApiError('Forbidden', 'forbidden', 403));
    await refresh(client);
    expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();

    getSettings().mockRejectedValue(new ApiError('Server error', 'internal', 500));
    await refresh(client);
    await waitFor(() =>
      expect((client.getQueryState(KEY)?.error as ApiError | null)?.status).toBe(500)
    );
    expect(screen.getByText(FULL_TITLE)).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    first.unmount();
    // Not vacuous: the cache still holds the rows from before the 403, and the 500.
    const cached = client.getQueryData(KEY) as { schedules: Array<{ id: string }> } | undefined;
    expect(cached?.schedules.map((s) => s.id)).toContain('s1');
    const state = client.getQueryState(KEY);
    expect(state?.status).toBe('error');
    expect((state?.error as ApiError | null)?.status).toBe(500);

    renderReadOnly(client);
    expect(await screen.findByText(FULL_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Thursday check-in')).toBeNull();
    expect(screen.queryByText('Sunday check-in')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    // A success clears the memory.
    getSettings().mockResolvedValue(SETTINGS);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Thursday check-in')).toBeInTheDocument();
  });
});
