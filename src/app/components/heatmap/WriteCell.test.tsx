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
  it('Enter/Space advances null -> preferred -> if-need-be -> null', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <WriteCell row={0} col={0} rows={1} cols={1} focused preference={null} onSelect={onSelect} />
    );
    const btn = screen.getByRole('button');

    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('preferred');

    rerender(
      <WriteCell row={0} col={0} rows={1} cols={1} focused preference="preferred" onSelect={onSelect} />
    );
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('if-need-be');

    rerender(
      <WriteCell row={0} col={0} rows={1} cols={1} focused preference="if-need-be" onSelect={onSelect} />
    );
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
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
