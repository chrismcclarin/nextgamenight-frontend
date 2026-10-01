// quick-260930-w9v — StarRatingPicker takes the rating the API actually sends.
//
// Owner report (production, 2026-09-30): editing a review he had already written showed the
// "Something went wrong" screen, with "TypeError: o.toFixed is not a function" in the console.
// The wire shape: GameReview.rating is a DECIMAL(3, 1) column, so the API sends a saved rating
// as a string such as "4.0", and the edit dialog handed that string straight to this picker.
// Todo: .planning/todos/pending/2026-09-30-game-review-edit-returns-error.md
//
// This is the component's first test file. The page-level pins for the same bug live in
// src/app/gameDetail/page.test.tsx (describe quick-260930-w9v).
import * as React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StarRatingPickerJs from './StarRatingPicker';

// tsc type-checks every .tsx with allowJs, so the JS component's props are inferred from its
// signature (value defaults to 0, so a number) and the wire string is exactly what that
// inference would reject. Same cast idiom as QuickSuggestions.test.tsx.
type StarRatingPickerProps = {
  value?: number | string | null;
  onChange?: (value: number) => void;
  ariaLabel?: string;
};
const StarRatingPicker = StarRatingPickerJs as unknown as React.ComponentType<StarRatingPickerProps>;

function renderPicker(value: number | string | null) {
  return render(<StarRatingPicker value={value} onChange={vi.fn()} ariaLabel="Game rating" />);
}

afterEach(cleanup);

describe('quick-260930-w9v — StarRatingPicker takes the rating the API actually sends', () => {
  // P1 — the crash pin at the primitive: the readout called toFixed on the string.
  it('renders a whole-star rating sent as a string ("4.0"): readout 4.0, the 4-star radio checked', () => {
    renderPicker('4.0');
    expect(screen.getByText('4.0')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  // P2 — a half-star string checks the matching left-half radio.
  it('renders a half-star rating sent as a string ("3.5"): readout 3.5, the 3.5-star radio checked', () => {
    renderPicker('3.5');
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3.5 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  // P3 — the hover preview falls back to the committed value, which must be the number too.
  it('falls back to the string value after a hover preview ends', () => {
    renderPicker('4.0');
    fireEvent.mouseEnter(screen.getByRole('radio', { name: '2 stars' }));
    expect(screen.getByText('2.0')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole('radiogroup', { name: 'Game rating' }));
    expect(screen.getByText('4.0')).toBeInTheDocument();
  });

  // P4 — preservation baseline: the number path is unchanged.
  it('renders a numeric rating (4) exactly as before', () => {
    renderPicker(4);
    expect(screen.getByText('4.0')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  // P5 — the empty state: nothing checked, the em dash readout, no throw.
  it.each([['0.0'], [null], ['abc'], [0]])('shows the empty state for %j', (value) => {
    renderPicker(value as number | string | null);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  });
});
