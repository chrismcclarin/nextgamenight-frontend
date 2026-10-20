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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

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

// D-38 (SPEC amendment row 32): the thumbnail is hidden from assistive tech by an aria-hidden
// wrapper ONLY. SafeImage keeps alt={game.name} and its default dice fallback, so a missing or
// failed thumbnail still LOOKS exactly as before (the dice on the name-derived colour); what
// changes is that it is no longer heard. The metadata stays audible as the button's description.
describe('GameSuggestionCard — the thumbnail adds nothing to the name (D-38), metadata described', () => {
  const NO_THUMB: SuggestionGame = { ...CATAN, thumbnail_url: null };
  const DICE = '\u{1F3B2}';

  it('G. a missing thumbnail is silent: no img role, the dice fallback still drawn under a hidden wrapper', () => {
    renderCard(NO_THUMB);
    const button = screen.getByRole('button', { name: 'Catan' });
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    const fallback = button.querySelector('[role="img"]');
    expect(fallback, 'SafeImage fallback not rendered').not.toBeNull();
    const wrapper = (fallback as HTMLElement).closest('[aria-hidden="true"]');
    expect(wrapper, 'fallback has no aria-hidden ancestor').not.toBeNull();
    expect((wrapper as HTMLElement).parentElement).toBe(button);
    // alt is kept (D-38), so the fallback's colour and label are what they were; the dice is the
    // default icon, so nothing visible changed.
    expect(fallback).toHaveAttribute('aria-label', 'Catan');
    expect(fallback?.textContent).toContain(DICE);
  });

  it('H. a failing thumbnail is silent before and after the error swaps in the fallback', () => {
    renderCard();
    const button = screen.getByRole('button', { name: 'Catan' });
    const img = button.querySelector('img');
    expect(img, 'thumbnail img not rendered').not.toBeNull();
    expect(img).toHaveAttribute('alt', 'Catan');
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    fireEvent.error(img as HTMLImageElement);
    expect(button.querySelector('img')).toBeNull();
    expect(button.querySelector('[role="img"]'), 'fallback not swapped in').not.toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('I. the name is never doubled and "Image placeholder" is never announced, thumbnail missing or failed', () => {
    const states: Array<[string, () => void]> = [
      ['missing', () => renderCard(NO_THUMB)],
      ['loaded', () => renderCard()],
      [
        'failed',
        () => {
          renderCard();
          fireEvent.error(document.querySelector('img') as HTMLImageElement);
        },
      ],
    ];
    for (const [label, mount] of states) {
      mount();
      const button = screen.getByRole('button');
      expect(button, `${label}: name`).not.toHaveAccessibleName(/Image placeholder/);
      expect(button, `${label}: description`).not.toHaveAccessibleDescription(/Image placeholder/);
      expect(button, `${label}: name`).toHaveAccessibleName('Catan');
      cleanup();
    }
  });

  it('J. the metadata stays audible as the description, and describedby names only rendered ids', () => {
    renderCard();
    const button = screen.getByRole('button', { name: 'Catan' });
    for (const part of ['3-4 players', '60 min', 'Weight 2.3', 'Owned by Alice, Bob', '4.2']) {
      expect(button).toHaveAccessibleDescription(expect.stringContaining(part));
    }
    cleanup();

    renderCard({ ...CATAN, owners: [], avg_group_rating: null });
    const bare = screen.getByRole('button', { name: 'Catan' });
    const ids = (bare.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids.length, 'aria-describedby missing or empty').toBeGreaterThan(0);
    for (const id of ids) {
      expect(document.getElementById(id), `aria-describedby names a missing id: ${id}`).not.toBeNull();
    }
    expect(bare).toHaveAccessibleDescription(expect.stringContaining('3-4 players'));
    expect(bare).not.toHaveAccessibleDescription(/Owned by/);
    expect(bare).not.toHaveAccessibleDescription(/4\.2/);
  });

  // Held-out encoding backstop (SPEC Edge R2): green on arrival by design; its teeth are shown by
  // a temporary raw-HTML render of the title, recorded in the plan SUMMARY.
  it('K. a name with quotes, an apostrophe, an emoji, markup and an ampersand is the exact name, as text', () => {
    const name = 'Bob\'s "Big" Game \u{1F3B2} <b>x</b> & Co.';
    const { container } = renderCard({ ...NO_THUMB, name });
    const button = screen.getByRole('button', { name });
    const labelId = button.getAttribute('aria-labelledby') as string;
    expect(document.getElementById(labelId)?.textContent).toBe(name);
    expect(container.querySelector('b')).toBeNull();
  });

  // Green on arrival by design (guards the useId ids); teeth recorded in the plan SUMMARY.
  it('L. two cards side by side each carry their OWN name (the ids do not collide)', () => {
    const onClick = vi.fn();
    render(
      <>
        <GameSuggestionCard game={CATAN} onClick={onClick} />
        <GameSuggestionCard game={{ ...CATAN, id: 'azul-id', name: 'Azul' }} onClick={onClick} />
      </>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Azul' })).toBeInTheDocument();
  });

  // Green on arrival by design; teeth recorded in the plan SUMMARY with the axe rule id that fired.
  it('M. the card with a missing thumbnail passes an axe audit', async () => {
    const { container } = renderCard(NO_THUMB);
    expect(await axe(container)).toHaveNoViolations();
  });
});
