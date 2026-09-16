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
    },
  };
});

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
