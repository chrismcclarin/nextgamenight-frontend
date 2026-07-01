// D-05 aria-live contract for the shared StatusRegion (PRIM-04).
//
// The live container must mount EMPTY-FIRST and inject text on change (SRs
// announce changes to a live region, not conditional mounts), and expose
// polite (role=status) and assertive (role=alert) variants.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StatusRegion } from './StatusRegion';

afterEach(cleanup);

describe('StatusRegion aria-live contract', () => {
  it('mounts empty-first: the polite live region is present but has no text', () => {
    render(<StatusRegion />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
  });

  it('injects text on change without remounting the region (same node)', () => {
    const { rerender } = render(<StatusRegion />);
    const before = screen.getByRole('status');
    expect(before).toHaveTextContent('');

    rerender(<StatusRegion message="Saved" />);
    const after = screen.getByRole('status');
    expect(after).toBe(before); // same live node — text injected, not remounted
    expect(after).toHaveTextContent('Saved');
  });

  it('polite variant (default) → role="status" + aria-live="polite"', () => {
    render(<StatusRegion message="Loading" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Loading');
  });

  it('assertive variant → role="alert" + aria-live="assertive"', () => {
    render(<StatusRegion politeness="assertive" message="Request failed" />);
    const region = screen.getByRole('alert');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveTextContent('Request failed');
  });
});
