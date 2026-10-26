/**
 * AC-7 (owner ruling 2026-09-09, option 1) — the collapsed check-ins panel leaves the TAB ORDER
 * and the A11Y TREE, and the header points at it.
 *
 * WHAT WAS WRONG. `PromptScheduleSection`'s collapse was CSS-only: `overflow-hidden` plus
 * `max-h-0 opacity-0`, with no `hidden`, no `inert` and no `aria-hidden`. So while the section
 * READ as collapsed, every descendant control stayed focusable and announced —
 * `AutoPromptBehaviorBanner`, `OpenPollsList`'s "Start a poll" and its `FetchErrorBanner`, and
 * for an admin the inline `PromptScheduleManager`'s "Try again" / "Report this". WCAG 2.4.3
 * (focus order) and 2.4.7 (focus visible) both. The header carried `aria-expanded` and ZERO
 * `aria-controls`, so nothing named the region it toggled either.
 *
 * WHY THESE ASSERT REACHABILITY AND NOT THE `hidden` ATTRIBUTE. An attribute pin is the shape
 * this repo's gate ledger keeps catching: it goes green on a tree where the attribute is present
 * and the property it is supposed to buy is not. So every assertion below is a DEFAULT ROLE
 * QUERY — `*ByRole` excludes inaccessible subtrees, which is the same computation a screen
 * reader and the tab order make — asked in BOTH polarities: nothing inside the panel is findable
 * while collapsed, and the SAME descendants are findable after expanding.
 *
 * THE ONE ATTRIBUTE-LEVEL ASSERTION HERE IS THE CHEVRON'S `aria-hidden` (owner ruling #165,
 * 2026-09-14), and it is acceptable for that item ONLY, because `aria-hidden` IS a mechanism
 * `@testing-library/dom`'s `isSubtreeInaccessible` reads — unlike `inert`, which it ignores
 * entirely. That asymmetry is also why `inert` was rejected as AC-7's gate: probed against this
 * repo's `node_modules` 2026-09-14, `inert` appears ZERO times in `@testing-library/dom/dist`,
 * ZERO times in `jsdom/lib/jsdom` and ZERO times in `user-event/dist/cjs`, and React 18.2 has no
 * boolean `inert` prop — so under `inert` neither half of AC-7 could be proven at all.
 *
 * NOT IN THIS FILE, deliberately: an arm in `keyboardOperability.test.tsx`. That file already
 * owns the `PromptScheduleSection` describe, but it is declared by plan 88.6-16 in this SAME
 * wave, so an arm added there asserting behaviour THIS plan implements could run before the fix
 * lands and go red for a scheduling reason rather than a real one. Its three shipped Section
 * tests are byte-unchanged and that file is not opened by plan 15.
 *
 * NOT IN THIS FILE either: an axe audit. R7 stays scoped to MODAL surfaces (owner ruling #165);
 * this is an inline disclosure, and adding a Section audit here would amend R7's surface list by
 * the back door.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/app/components/StartPollModal', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    promptSettingsAPI: {
      ...actual.promptSettingsAPI,
      getGroupPromptSettings: vi.fn(async () => ({
        id: null,
        schedules: [],
        games: [],
        members: [],
      })),
    },
    promptAPI: {
      ...actual.promptAPI,
      getOpenPrompts: vi.fn(async () => ({ prompts: [] })),
      closePrompt: vi.fn(async () => ({})),
    },
  };
});

import { act, within } from '@testing-library/react';
import { promptAPI, ApiError } from '@/lib/api';
import PromptScheduleSection from './PromptScheduleSection';

const anyProps = (p: Record<string, unknown>): any => p;

function renderSection(extra: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PromptScheduleSection
        {...anyProps({ groupId: 'g1', group: { id: 'g1', games: [] }, userRole: 'member', ...extra })}
      />
    </QueryClientProvider>
  );
}

const header = () => screen.getByRole('button', { name: /check-ins/i });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('PromptScheduleSection collapsed panel (AC-7)', () => {
  it('1. COLLAPSED: no descendant control is reachable — the header is the only one', async () => {
    renderSection({ defaultExpanded: false });
    await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'false'));

    // The reachability claim, not an attribute claim.
    expect(screen.queryByRole('button', { name: '+ Start a check-in' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByRole('button')[0]).toBe(header());
  });

  it('2. EXPANDED: the same descendants ARE reachable', async () => {
    renderSection({ defaultExpanded: true });

    expect(
      await screen.findByRole('button', { name: '+ Start a check-in' })
    ).toBeInTheDocument();
    expect(header()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1);
  });

  it('3. toggling the header moves the panel BETWEEN those two states', async () => {
    // The pair above could both pass on a component that hard-codes one state. This one
    // proves the SAME mount crosses the boundary.
    renderSection({ defaultExpanded: false });
    await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('button', { name: '+ Start a check-in' })).toBeNull();

    fireEvent.click(header());

    expect(
      await screen.findByRole('button', { name: '+ Start a check-in' })
    ).toBeInTheDocument();

    fireEvent.click(header());

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '+ Start a check-in' })).toBeNull()
    );
  });

  it('4. the header carries aria-controls naming the panel that actually holds the body', async () => {
    const { container } = renderSection({ defaultExpanded: true });
    await screen.findByRole('button', { name: '+ Start a check-in' });

    const controls = header().getAttribute('aria-controls');
    expect(controls, 'the header must name the region it toggles').toBeTruthy();

    const panel = container.querySelector(`#${CSS.escape(controls as string)}`);
    expect(panel, 'aria-controls must resolve to a real element').not.toBeNull();
    // It is the panel and not some other node: the body lives inside it.
    expect(
      panel?.contains(screen.getByRole('button', { name: '+ Start a check-in' }))
    ).toBe(true);
  });

  it('5. the header chevron is decorative and the accessible name is untouched', async () => {
    renderSection({ defaultExpanded: false });
    await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'false'));

    const svg = header().querySelector('svg');
    expect(svg, 'the chevron is still rendered').not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');

    // The name comes from the "Check-ins" span plus the badge; the svg never contributed to
    // it, so `keyboardOperability.test.tsx`'s `{ name: /check-ins/i }` is undisturbed.
    expect(header()).toHaveAccessibleName(/check-ins/i);
  });
});

// Plan 88.6.1-29 task 1 (H4, D-04, D-05): the host arms the shared focus-recovery hook, and the
// Check-ins expand control is the fallback. Every comment in this block is a `//` line (CF-9).
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const checkIn = (id: string, username: string) => ({
  id,
  can_close: true,
  custom_message: null,
  Creator: { id: `u-${id}`, username },
});
const ROW_A = checkIn('pa', 'Ana');
const ROW_B = checkIn('pb', 'Ben');

// Open row A's kebab and two-tap "End check-in", scoped to the list its trigger names through
// aria-controls (the house idiom, prompts.invalidation.test.tsx `GAP13: closing a poll`).
function endCheckIn(trigger: HTMLElement) {
  fireEvent.click(trigger);
  const list = document.getElementById(trigger.getAttribute('aria-controls') as string);
  expect(list, 'the kebab names its open list through aria-controls').not.toBeNull();
  fireEvent.click(within(list as HTMLElement).getByRole('button', { name: 'End check-in' }));
  fireEvent.click(within(list as HTMLElement).getByRole('button', { name: 'Tap again to end' }));
}

describe('Check-ins: ending a check-in keeps focus off <body> (H4, D-04, D-05)', () => {
  it('T1. focus lands on the expand control only AFTER the ended row leaves the DOM', async () => {
    const refetch = deferred<{ prompts: unknown[] }>();
    const close = deferred<unknown>();
    vi.mocked(promptAPI.getOpenPrompts)
      .mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never)
      .mockImplementationOnce(() => refetch.promise as never);
    vi.mocked(promptAPI.closePrompt).mockImplementationOnce(() => close.promise as never);

    renderSection({ defaultExpanded: true });
    await screen.findByText('Started by Ana');
    const triggerA = screen.getAllByRole('button', { name: 'Check-in actions' })[0];

    endCheckIn(triggerA);
    // KebabMenu's commit restores focus to the row's own trigger.
    expect(document.activeElement).toBe(triggerA);

    await act(async () => {
      close.resolve({});
    });
    // The close resolved but the refetch is still held: the row is on screen, so focus stays.
    expect(document.activeElement).toBe(triggerA);
    expect(document.activeElement).not.toBe(header());

    await act(async () => {
      refetch.resolve({ prompts: [ROW_B] });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(header());
      expect(screen.queryByText('Started by Ana')).toBeNull();
    });
    // Focusing the expand control must not toggle the section.
    expect(header()).toHaveAttribute('aria-expanded', 'true');
  });

  it('T2. a failed end moves nothing: the row stays and its trigger keeps focus', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    vi.mocked(promptAPI.closePrompt).mockImplementationOnce(async () => {
      throw new ApiError('x', 'internal', 500);
    });

    renderSection({ defaultExpanded: true });
    await screen.findByText('Started by Ana');
    const triggerA = screen.getAllByRole('button', { name: 'Check-in actions' })[0];

    endCheckIn(triggerA);
    await act(async () => {});
    await act(async () => {});

    // Asserted synchronously after the flush, never inside waitFor (CF-26).
    expect(screen.getByText('Started by Ana')).toBeInTheDocument();
    expect(document.activeElement).toBe(triggerA);
  });
});

// Plan 88.6.1-29 task 3: W018 (Req 11, WR-205) and copy row G4 (Req 12).
describe('Check-ins panel classes and loading badge (W018, G4)', () => {
  it('W1. the expanded panel carries mt-3 alone; every animation-era class is gone', async () => {
    renderSection({ defaultExpanded: true });
    await screen.findByRole('button', { name: '+ Start a check-in' });
    // useId ids contain colons, so the panel is resolved by id, never by a CSS selector.
    const panel = document.getElementById(header().getAttribute('aria-controls') as string);
    expect(panel, 'aria-controls must resolve to the panel').not.toBeNull();
    expect((panel as HTMLElement).className).toBe('mt-3');
  });

  // quick-261020-tz3 (VO-P2-7, owner VoiceOver walk 2026-10-20): VoiceOver read the three ASCII
  // full stops aloud inside the header button's name ("check-ins three periods expanded"), so G4
  // moved to ONE U+2026 ellipsis — the same words, one glyph.
  it('G1. while the open-polls query is pending, the badge says what is loading, with one ellipsis character', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockImplementationOnce(() => new Promise(() => {}) as never);
    renderSection({ defaultExpanded: false });
    expect(within(header()).getByText('Loading check-ins\u2026')).toBeInTheDocument();
    expect(header()).toHaveAccessibleName(/Loading check-ins\u2026/);
    expect(header()).not.toHaveAccessibleName(/\.\.\./);
  });

  it('G1b. expanded while pending: the badge and the list loading line say the same thing in the same glyph (VO-P2-7)', async () => {
    // One fetch serves both (the shared openPolls key), so one never-resolving mock holds both.
    vi.mocked(promptAPI.getOpenPrompts).mockImplementationOnce(() => new Promise(() => {}) as never);
    renderSection({ defaultExpanded: true });
    expect(await screen.findAllByText('Loading check-ins\u2026')).toHaveLength(2);
    const dotted = Array.from(document.body.querySelectorAll('*')).filter((el) =>
      Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes('...'))
    );
    expect(dotted).toHaveLength(0);
  });
});

// quick-261026-pi6 (owner R1): the section passes the planning page's selection through to the
// open-polls list. Every comment in this block is a // line (CF-9).
describe('Check-ins: the selection passes through to the cards (quick-261026-pi6)', () => {
  it('PSS-SEL-1. the selected poll card is pressed and a card tap reaches onSelectPoll', async () => {
    vi.mocked(promptAPI.getOpenPrompts).mockResolvedValueOnce({ prompts: [ROW_A, ROW_B] } as never);
    const onSelectPoll = vi.fn();
    renderSection({ defaultExpanded: true, selectedPollId: 'pb', onSelectPoll });
    await screen.findByText('Started by Ben');
    expect(screen.getByRole('button', { name: /Started by Ben/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Started by Ana/ }));
    expect(onSelectPoll).toHaveBeenCalledTimes(1);
    expect(onSelectPoll).toHaveBeenCalledWith('pa');
  });
});
