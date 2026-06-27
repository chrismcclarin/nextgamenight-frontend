/**
 * GAP13 + GAP14 integration — the automated analogue of the human Network-tab
 * checkpoint. Mounts the real trio under ONE QueryClientProvider against a mocked
 * `apiFetch` and proves:
 *
 *   GAP14 (dedup): the mounted trio fires each endpoint's fetch EXACTLY ONCE —
 *     prompt-settings 1x despite 3 consumers (Section + Manager + ReadOnly, F-852)
 *     and prompts/open 1x despite 2 consumers (Section badge + OpenPollsList, F-826).
 *
 *   GAP13 (post-write invalidation): a RESOLVED mock write triggers
 *     `queryClient.invalidateQueries` on the matching promptKeys and the list
 *     re-renders without the closed item (OpenPollsList → openPolls; Manager →
 *     settings).
 *
 * Deterministic: retries off, mocked network, no real fetch.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
  CAPTURED_PROMPT_SETTINGS_BODY,
  CAPTURED_OPEN_PROMPTS_BODY,
} from '../../lib/schemas/prompts.contract.test';
import PromptScheduleSection from './PromptScheduleSection';
import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import PromptScheduleManager from './PromptScheduleManager';
import OpenPollsList from './OpenPollsList';

// Per-endpoint fetch counters + a mutable open body so a "write" can return a
// reduced set on refetch.
let settingsCalls = 0;
let openCalls = 0;
let openBody: any;

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: vi.fn(async (url: string) => {
      if (url.endsWith('/prompt-settings')) {
        settingsCalls++;
        return structuredClone(CAPTURED_PROMPT_SETTINGS_BODY);
      }
      if (url.endsWith('/prompts/open')) {
        openCalls++;
        return structuredClone(openBody);
      }
      return {};
    }),
    // Direct-API writes the components still call this phase — resolve them so
    // the post-write invalidateQueries path runs.
    promptAPI: { ...actual.promptAPI, closePrompt: vi.fn().mockResolvedValue({}) },
    promptSettingsAPI: { ...actual.promptSettingsAPI, toggleSchedule: vi.fn().mockResolvedValue({}) },
  };
});

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, ...utils };
}

beforeEach(() => {
  settingsCalls = 0;
  openCalls = 0;
  openBody = structuredClone(CAPTURED_OPEN_PROMPTS_BODY);
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('prompts trio integration (GAP13/GAP14)', () => {
  it('GAP14: mounted trio fires each endpoint exactly once (F-852 settings, F-826 open)', async () => {
    renderWithClient(
      <>
        <PromptScheduleSection groupId="g1" group={{ games: [] }} userRole="owner" />
        <PromptScheduleReadOnly groupId="g1" groupPageUrl="/g" />
      </>,
    );

    // Section (settings + open), Manager (settings), ReadOnly (settings),
    // OpenPollsList (open) all mount under one client → dedup to one fetch each.
    await waitFor(() => expect(settingsCalls).toBeGreaterThan(0));
    await waitFor(() => expect(openCalls).toBeGreaterThan(0));

    expect(settingsCalls).toBe(1); // 3 consumers → 1 fetch (F-852)
    expect(openCalls).toBe(1); // 2 consumers → 1 fetch (F-826)
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('GAP13: closing a poll invalidates openPolls and drops it from the list', async () => {
    const { client } = renderWithClient(
      <OpenPollsList groupId="g1" group={{ games: [] }} userRole="owner" />,
    );
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    // Auto-prompt (can_close=true) renders with its source label + the kebab.
    await screen.findByText('From Friday Game Night');
    expect(screen.getByText(/Who is in for Catan/)).toBeInTheDocument();

    // The next open fetch returns the reduced set (auto-prompt removed).
    openBody = { prompts: [CAPTURED_OPEN_PROMPTS_BODY.prompts[1]] };

    // Open the kebab and two-tap "End check-in".
    fireEvent.click(screen.getByRole('button', { name: 'Check-in actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End check-in' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tap again to end' }));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.openPolls('g1') }),
    );
    await waitFor(() =>
      expect(screen.queryByText('From Friday Game Night')).not.toBeInTheDocument(),
    );
    // The remaining manual poll is still rendered.
    expect(screen.getByText(/Who is in for Catan/)).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('GAP13: a schedule mutation invalidates settings (Manager)', async () => {
    const { client } = renderWithClient(
      <PromptScheduleManager groupId="g1" group={{ games: [], members: [] }} userRole="owner" variant="inline" onClose={() => {}} />,
    );
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    // The active schedule from the captured body renders with a Pause control.
    await waitFor(() => expect(screen.getAllByTitle('Pause schedule').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle('Pause schedule')[0]);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.settings('g1') }),
    );
  });
});
