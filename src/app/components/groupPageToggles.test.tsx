// Phase 88.6.1-48 (D-21 / D-44, AC-19; Req 6, Req 12): the group page's toggle controls report
// their state to assistive tech, and each carries the 44px phone floor in its static classes.
//
// What this suite pins:
//   - GroupLibrary's owner-filter chips are PRESSED toggles (aria-pressed), inside a group named
//     "Filter by owner" (owner ruling 2026-10-13, #210); the chip bar carries the focus ring's top
//     inset (#211).
//   - GroupGamesList's Filter is a DISCLOSURE (aria-expanded plus an aria-controls that exists only
//     while the panel does), never a pressed toggle.
//   - GroupGamesList's sort arrow is named in words (owner ruling 2026-10-05, S1).
//
// jsdom has no layout, so the floors are pinned here on class tokens only. They are also
// source-pinned in controlSizeFloor.test.tsx (NAMED_SUBJECTS) and measured at 375px in
// e2e/touch-targets.spec.ts. Comments in this file are line comments only (CF-9).
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));

// Keep the real module (ApiError stays real, C-3); replace only the one call GroupLibrary makes.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: { ...actual.groupsAPI, getGroupLibrary: vi.fn() },
  };
});

import GroupLibrary from './GroupLibrary';
import GroupGamesList from './GroupGamesList';
import { groupsAPI } from '@/lib/api';

// Untyped JS components: spread a typed-any bag so JSX does not demand every prop.
const anyProps = (p: Record<string, unknown>): any => p;

const FLOOR = ['min-h-11', 'md:min-h-0', 'min-w-11', 'md:min-w-0'];

function tokensOf(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/);
}

afterEach(cleanup);

describe('GroupLibrary owner chips (88.6.1-48: D-21 / D-44)', () => {
  beforeEach(() => {
    (groupsAPI.getGroupLibrary as unknown as Mock).mockResolvedValue({
      games: [
        { id: 'g-azul', name: 'Azul', owners: [{ user_id: 'u1', username: 'Alice' }] },
        { id: 'g-catan', name: 'Catan', owners: [{ user_id: 'u2', username: 'Bob' }] },
      ],
      members: [
        { user_id: 'u1', username: 'Alice' },
        { user_id: 'u2', username: 'Bob' },
      ],
    });
  });

  it('C1: the chips sit in a group named Filter by owner and report which owner is pressed, both ways', async () => {
    render(<GroupLibrary {...anyProps({ groupId: 'g1' })} />);
    // #210 (owner 2026-10-13): the chip row is a group named in the ratified words.
    const group = await screen.findByRole('group', { name: 'Filter by owner' });
    const all = within(group).getByRole('button', { name: 'All' });
    expect(all.parentElement).toBe(group);
    // Every game row also renders Alice / Bob owner-link buttons in its collapsed section, so
    // the chips are queried ONLY inside the bar.
    const bar = within(all.parentElement as HTMLElement);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(bar.getByRole('button', { name: 'Alice' })).toHaveAttribute('aria-pressed', 'false');
    expect(bar.getByRole('button', { name: 'Bob' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(bar.getByRole('button', { name: 'Bob' }));
    expect(bar.getByRole('button', { name: 'Bob' })).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(bar.getByRole('button', { name: 'Alice' })).toHaveAttribute('aria-pressed', 'false');
    // Positive signal first, then the absence (CF-26).
    expect(await screen.findByText('Catan')).toBeInTheDocument();
    expect(screen.queryByText('Azul')).toBeNull();

    // A member chip is two-way: pressing the selected member returns to All.
    fireEvent.click(bar.getByRole('button', { name: 'Bob' }));
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(bar.getByRole('button', { name: 'Bob' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('C2: All is one-way, so pressing it while pressed changes nothing', async () => {
    render(<GroupLibrary {...anyProps({ groupId: 'g1' })} />);
    const all = await screen.findByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Azul')).toBeInTheDocument();
    expect(screen.getByText('Catan')).toBeInTheDocument();
  });

  it('C3: both chip shapes carry the phone floor in their static classes, and the bar carries the ring inset', async () => {
    render(<GroupLibrary {...anyProps({ groupId: 'g1' })} />);
    const all = await screen.findByRole('button', { name: 'All' });
    const barEl = all.parentElement as HTMLElement;
    const alice = within(barEl).getByRole('button', { name: 'Alice' });
    // All is the pressed shape here, Alice the unpressed one.
    for (const el of [all, alice]) {
      for (const cls of FLOOR) {
        expect(tokensOf(el), `${el.textContent} is missing ${cls}`).toContain(cls);
      }
    }
    // #211: the bar clips in both axes; -mt-1 pt-1 gives the chips' focus ring its top 4px
    // without moving the chips.
    expect(tokensOf(barEl)).toContain('-mt-1');
    expect(tokensOf(barEl)).toContain('pt-1');
  });
});

const GAMES = [
  {
    id: 'game-azul',
    name: 'Azul',
    play_count: 1,
    last_played: '2026-09-01T19:00:00Z',
    winners: [{ user_id: 'u1', username: 'Alice', count: 1, is_custom: false }],
    pickers: [],
  },
  {
    id: 'game-catan',
    name: 'Catan',
    play_count: 2,
    last_played: '2026-09-08T19:00:00Z',
    winners: [],
    pickers: [],
  },
];

function renderGames() {
  return render(<GroupGamesList {...anyProps({ games: GAMES, groupId: 'g1', members: [] })} />);
}

describe('GroupGamesList Filter disclosure (88.6.1-48: D-44)', () => {
  it('F1: Filter reports the panel open or closed, and aria-controls names the panel only while it exists', () => {
    renderGames();
    const filter = screen.getByRole('button', { name: /^Filter/ });
    expect(filter).toHaveAttribute('aria-expanded', 'false');
    expect(filter).not.toHaveAttribute('aria-controls');

    fireEvent.click(filter);
    expect(filter).toHaveAttribute('aria-expanded', 'true');
    const id = filter.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    const panel = document.getElementById(id as string);
    expect(panel, 'aria-controls names an id with no element in the document').not.toBeNull();
    // By id, not label text: the select sits inside its label, so a label-text match would also
    // read the option text.
    expect((panel as HTMLElement).querySelector('#group-games-filter-winner')).not.toBeNull();
    expect(within(panel as HTMLElement).getByText('Winner')).toBeInTheDocument();

    fireEvent.click(filter);
    expect(filter).toHaveAttribute('aria-expanded', 'false');
    expect(filter).not.toHaveAttribute('aria-controls');
    expect(screen.queryByText('Winner')).toBeNull();
  });

  it('F2: the applied count and the open state are separate facts', () => {
    renderGames();
    const filter = screen.getByRole('button', { name: /^Filter/ });
    fireEvent.click(filter);
    const winner = document.getElementById('group-games-filter-winner') as HTMLSelectElement;
    fireEvent.change(winner, { target: { value: 'u1' } });
    expect(filter).toHaveAccessibleName('Filter (1)');
    expect(filter).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(filter);
    expect(filter).toHaveAccessibleName('Filter (1)');
    expect(filter).toHaveAttribute('aria-expanded', 'false');
  });

  it('F3: Filter carries the phone floor in its static classes', () => {
    renderGames();
    const filter = screen.getByRole('button', { name: /^Filter/ });
    expect(tokensOf(filter)).toContain('min-h-11');
    expect(tokensOf(filter)).toContain('md:min-h-0');
  });
});

describe('GroupGamesList sort toggle (88.6.1-48: D-31 ruling of 2026-10-05, S1)', () => {
  it('S1: the arrow is named in the ratified words, the glyph is hidden, and the hover tip is the description', () => {
    // Owner ruling 2026-10-05, "Ok and ratified" (S1, option A): the screen-reader name is
    // "Sort order: ascending" / "Sort order: descending"; the arrow and its hover tip stay as
    // they look. The tip is what a screen reader gets as the description.
    renderGames();
    const sort = screen.getByRole('button', { name: 'Sort order: ascending' });
    expect(sort).toHaveAttribute('title', 'Ascending (click to reverse)');
    expect(sort).toHaveAccessibleDescription('Ascending (click to reverse)');
    const glyph = sort.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect((glyph as Element).textContent).toBe('↑');

    fireEvent.click(sort);
    expect(sort).toHaveAccessibleName('Sort order: descending');
    expect(sort).toHaveAttribute('title', 'Descending (click to reverse)');
    expect(sort).toHaveAccessibleDescription('Descending (click to reverse)');
    expect((sort.querySelector('[aria-hidden="true"]') as Element).textContent).toBe('↓');

    fireEvent.click(sort);
    expect(sort).toHaveAccessibleName('Sort order: ascending');
  });

  it('S2: a press reverses the order of the list', () => {
    renderGames();
    const azul = screen.getByRole('heading', { name: 'Azul' });
    const catan = screen.getByRole('heading', { name: 'Catan' });
    expect(azul.compareDocumentPosition(catan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Located by the hover tip, which is byte-unchanged by this plan, so this arm reads the same
    // control before and after the name changes.
    fireEvent.click(screen.getByTitle('Ascending (click to reverse)'));
    const azulAfter = screen.getByRole('heading', { name: 'Azul' });
    const catanAfter = screen.getByRole('heading', { name: 'Catan' });
    expect(catanAfter.compareDocumentPosition(azulAfter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('S3: the arrow carries the phone floor in its classes', () => {
    renderGames();
    const sort = screen.getByTitle('Ascending (click to reverse)');
    for (const cls of FLOOR) {
      expect(tokensOf(sort), `the sort arrow is missing ${cls}`).toContain(cls);
    }
  });
});
