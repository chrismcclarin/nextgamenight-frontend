// Behavior pins for the WriteCell presentational wrapper (PRIM-01 / 84-05).
//
// WriteCell is a thin React.memo wrapper over useHeatmapCell that renders a
// write/preference heatmap cell. It must:
//   1. expose role="button" + aria-pressed + a preference aria-label
//   2. apply preferenceColor(preference, disabled) VERBATIM as its className
//      (byte-identical — no cn/tailwind-merge), enabled AND disabled branches
//   3. cycle null -> preferred -> if-need-be -> null on keyboard select
//   4. honor the disabled/roving tabIndex rule (disabled -> -1; one cell holds 0)
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preferenceColor } from '@/lib/availabilityColor';
import { WriteCell } from './WriteCell';

afterEach(cleanup);

describe('WriteCell — ARIA semantics', () => {
  it('renders role="button"', () => {
    render(<WriteCell row={0} col={0} rows={1} cols={1} preference={null} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('aria-pressed reflects the current preference', () => {
    const { rerender } = render(
      <WriteCell row={0} col={0} rows={1} cols={1} preference={null} />
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    rerender(<WriteCell row={0} col={0} rows={1} cols={1} preference="preferred" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');

    rerender(<WriteCell row={0} col={0} rows={1} cols={1} preference="if-need-be" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('aria-label names the current preference', () => {
    const { rerender } = render(
      <WriteCell row={0} col={0} rows={1} cols={1} preference={null} />
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'not selected');
    rerender(<WriteCell row={0} col={0} rows={1} cols={1} preference="preferred" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'preferred');
  });
});

describe('WriteCell — verbatim preferenceColor className (byte-identical)', () => {
  it('enabled branch equals preferenceColor(preference, false) exactly', () => {
    for (const pref of ['preferred', 'if-need-be', null] as const) {
      cleanup();
      render(<WriteCell row={0} col={0} rows={1} cols={1} preference={pref} />);
      expect(screen.getByRole('button').className).toBe(preferenceColor(pref, false));
    }
  });

  it('disabled branch equals preferenceColor(preference, true) exactly', () => {
    render(<WriteCell row={0} col={0} rows={1} cols={1} preference="preferred" disabled />);
    expect(screen.getByRole('button').className).toBe(preferenceColor('preferred', true));
  });
});

describe('WriteCell — keyboard three-state cycle', () => {
  it('Enter/Space advances null -> preferred -> if-need-be -> null, reporting the cell\'s own (row, col)', () => {
    // Phase 87.8 plan 14: onSelect reports (next, row, col) — the cell resolving
    // its own coordinates is what lets a container share ONE stable handler
    // across every cell instead of allocating per-cell closures each render.
    const onSelect = vi.fn();
    const { rerender } = render(
      <WriteCell row={2} col={3} rows={4} cols={5} focused preference={null} onSelect={onSelect} />
    );
    const btn = screen.getByRole('button');

    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('preferred', 2, 3);

    rerender(
      <WriteCell row={2} col={3} rows={4} cols={5} focused preference="preferred" onSelect={onSelect} />
    );
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('if-need-be', 2, 3);

    rerender(
      <WriteCell row={2} col={3} rows={4} cols={5} focused preference="if-need-be" onSelect={onSelect} />
    );
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(null, 2, 3);
  });
});

describe('WriteCell — disabled / roving tabIndex rule', () => {
  it('disabled cell has tabIndex=-1', () => {
    render(<WriteCell row={0} col={0} rows={1} cols={1} preference={null} disabled />);
    expect(screen.getByRole('button')).toHaveAttribute('tabindex', '-1');
  });

  it('a focused, enabled cell holds tabIndex=0; an unfocused one holds -1', () => {
    render(
      <div role="grid">
        <WriteCell row={0} col={0} rows={1} cols={2} focused preference={null} />
        <WriteCell row={0} col={1} rows={1} cols={2} preference={null} />
      </div>
    );
    const [a, b] = screen.getAllByRole('button');
    expect(a).toHaveAttribute('tabindex', '0');
    expect(b).toHaveAttribute('tabindex', '-1');
  });
});

// Plan 88.6.1-17 (D-14 / D-45): the container may hand the cell its whole accessible name
// (day + time + state, copy row A2 on the check-in grid) through an OPTIONAL override — the
// mechanism ReadCell already has. An absent or empty override falls back to the preference
// name above, so the fallback pins stay unchanged. Review #170: a disabled cell is the grid's
// unavailable-week MODE gate on a div with no native disabled, so it exposes aria-disabled.
describe('88.6.1-17 (D-14 / D-45) — optional ariaLabel override', () => {
  it('W1: a non-empty override wins, and aria-pressed is still present', () => {
    render(
      <WriteCell
        row={0}
        col={0}
        rows={1}
        cols={1}
        preference="preferred"
        ariaLabel="Monday, October 5 at 7:00 PM, preferred"
      />
    );
    const cell = screen.getByRole('button');
    expect(cell).toHaveAttribute('aria-label', 'Monday, October 5 at 7:00 PM, preferred');
    expect(cell).toHaveAttribute('aria-pressed', 'true');
  });

  it('W2: an empty override falls back to the preference name — never a nameless button', () => {
    render(<WriteCell row={0} col={0} rows={1} cols={1} preference={null} ariaLabel="" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'not selected');
  });

  it('W3: an override with no preference is used as given, and aria-pressed reads false', () => {
    render(
      <WriteCell
        row={0}
        col={0}
        rows={1}
        cols={1}
        preference={null}
        ariaLabel="Monday, October 5 at 7:00 PM, not selected"
      />
    );
    const cell = screen.getByRole('button');
    expect(cell).toHaveAttribute('aria-label', 'Monday, October 5 at 7:00 PM, not selected');
    expect(cell).toHaveAttribute('aria-pressed', 'false');
  });

  it('W4: a disabled cell exposes aria-disabled="true"; an enabled one carries no aria-disabled (#170)', () => {
    const { rerender } = render(
      <WriteCell row={0} col={0} rows={1} cols={1} preference={null} disabled />
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    rerender(<WriteCell row={0} col={0} rows={1} cols={1} preference={null} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-disabled');
  });
});
