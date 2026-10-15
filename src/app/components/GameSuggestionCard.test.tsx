// Req 2 / AC-8 (WCAG 2.1.1 + 4.1.2, Level A), plan 88.6.1-03: GameSuggestionCard is a real
// keyboard control with ONE accessible name, the game's (copy row E7, `{game name}`).
//
// Before this plan the card was a div carrying an onClick with no role, no tabindex and no key
// handler, so a keyboard or switch user could not choose a game in the Browse Games dialog or
// on the event page's Recommended Games section. These arms assert the OUTCOME of each key
// (the handler ran, once, with the game), Enter and Space in SEPARATE tests, because a one-key
// implementation is the likeliest regression and would pass a single-key test
// (keyboardOperability.test.tsx's discipline).
//
// Line comments only in this file: a block comment holding a backtick or a closing token makes
// vitest collect ZERO tests here while reporting green (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GameSuggestionCardJs from './GameSuggestionCard';

// The component is JS, so its inferred props are loose. Cast to the narrow shape this suite
// drives (the formLabels.audit.test.tsx idiom, typed rather than a record).
type SuggestionGame = {
  id: string;
  name: string;
  thumbnail_url?: string | null;
  min_players?: number | null;
  max_players?: number | null;
  playing_time?: number | null;
  weight?: number | null;
  owners?: string[];
  avg_group_rating?: number | null;
  review_count?: number | null;
};
const GameSuggestionCard = GameSuggestionCardJs as unknown as React.ComponentType<{
  game: SuggestionGame;
  onClick: (game: SuggestionGame) => void;
}>;

const CATAN: SuggestionGame = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Catan',
  thumbnail_url: 'https://cdn.example.com/catan.png',
  min_players: 3,
  max_players: 4,
  playing_time: 60,
  weight: 2.3,
  owners: ['Alice', 'Bob'],
  avg_group_rating: 4.2,
  review_count: 3,
};

function renderCard(game: SuggestionGame = CATAN) {
  const onClick = vi.fn();
  const utils = render(<GameSuggestionCard game={game} onClick={onClick} />);
  return { ...utils, onClick };
}

afterEach(cleanup);

describe('GameSuggestionCard — keyboard operable, one name (Req 2 / AC-8, D-26, E7)', () => {
  it('A. Tab from the page reaches the card', async () => {
    const user = userEvent.setup();
    renderCard();
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Catan' }));
  });

  it('B. Enter on the focused card chooses the game, exactly once', async () => {
    const user = userEvent.setup();
    const { onClick } = renderCard();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Catan' }));
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(CATAN);
  });

  it('C. Space on the focused card chooses the game, exactly once', async () => {
    const user = userEvent.setup();
    const { onClick } = renderCard();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Catan' }));
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(CATAN);
  });

  it('D. exposes exactly one button, named by the title alone (E7 `{game name}`)', () => {
    renderCard();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const button = screen.getByRole('button', { name: 'Catan' });
    // The name is the title, never the whole card text and never the unratified "Choose" form.
    // A string argument to toHaveAccessibleName is an EXACT match.
    expect(button).toHaveAccessibleName('Catan');
    expect(button).not.toHaveAccessibleName(/players|Weight|Choose/);
  });

  it('E. is a native type=button carrying the card padding idiom and the house outset ring', () => {
    renderCard();
    const button = screen.getByRole('button', { name: 'Catan' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    for (const token of [
      'w-full',
      'text-left',
      'focus:outline-hidden',
      'focus-visible:ring-2',
      'focus-visible:ring-focus-ring',
      'focus-visible:ring-offset-2',
      'card',
      'p-3',
      'md:p-6',
    ]) {
      expect(button.classList.contains(token), `class list lacks ${token}`).toBe(true);
    }
  });

  it('F. holds phrasing content only: no paragraph, and no div outside a hidden wrapper', () => {
    renderCard();
    const button = screen.getByRole('button', { name: 'Catan' });
    expect(button.querySelectorAll('p')).toHaveLength(0);
    const exposedDivs = Array.from(button.querySelectorAll('div')).filter(
      (div) => div.closest('[aria-hidden="true"]') === null,
    );
    expect(exposedDivs).toHaveLength(0);
  });
});
