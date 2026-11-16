// Contract pins for <RouteFallback> — the ONE route loading look (Req 3 / D-19).
//
// AR R1-M18 is the reason this file exists: the 9 route `loading.tsx` states that
// adopt this in plan 88-09 must be ANNOUNCED, not silent. `status` takes its name
// from the author, so the accessible name is pinned here explicitly.
//
// Also pinned: the spinner keeps spinning under reduced motion (a frozen spinner
// reads as a hung app), and no skeleton content creeps in (D-21 — Phase 89 owns
// skeletons).
import * as React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { RouteFallback } from './RouteFallback';
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';

afterEach(cleanup);

describe('RouteFallback', () => {
  it('X35 (88.9-69) + AR R1-M18: the route loading words arrive in a region that mounts empty and says the label after the dwell; the root carries no status role', () => {
    // AR R1-M18 stands: a route loading state is announced, never silent. What changed in 88.9-69
    // is HOW. A labelled status that mounts with the page is not announced (a screen reader speaks
    // a change to a live region, not its arrival), so the root is a plain box and the label is
    // spoken by a visually hidden region inside it that starts empty.
    vi.useFakeTimers();
    try {
      const { container } = render(<RouteFallback label="Getting your groups..." />);
      const root = container.firstElementChild as HTMLElement;
      expect(root, 'the root is still a status region').not.toHaveAttribute('role');
      expect(root).not.toHaveAttribute('aria-label');

      const region = screen.getByRole('status');
      expect(root.contains(region)).toBe(true);
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveClass('sr-only');
      expect(region.textContent, 'the region mounted already holding the label').toBe('');

      act(() => {
        vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
      });
      expect(screen.getByRole('status')).toBe(region);
      expect(region.textContent).toBe('Getting your groups...');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the label visibly at 16px secondary', () => {
    render(<RouteFallback label="Getting your groups..." />);
    const line = screen.getByText('Getting your groups...');
    expect(line).toHaveClass('text-base');
    expect(line).toHaveClass('text-content-secondary');
  });

  it('spins, and keeps spinning under reduced motion', () => {
    const { container } = render(<RouteFallback label="Loading" />);
    const spinner = container.querySelector('[aria-hidden="true"]');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass('animate-spin');
    expect(spinner!.className).not.toMatch(/motion-reduce:animate-none/);
  });

  it('renders on the page ground, centred', () => {
    const { container } = render(<RouteFallback label="Loading" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('bg-surface-page');
    expect(root).toHaveClass('items-center');
    expect(root).toHaveClass('justify-center');
  });

  it('carries no skeleton/placeholder content (D-21 — Phase 89 owns skeletons)', () => {
    const { container } = render(<RouteFallback label="Loading" />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(container.innerHTML).not.toMatch(/skeleton/i);
  });

  it('merges a caller className onto the root', () => {
    const { container } = render(
      <RouteFallback label="Loading" className="min-h-screen" />
    );
    expect(container.firstElementChild).toHaveClass('min-h-screen');
  });

  it('passes an axe audit with no violations', async () => {
    const { container } = render(<RouteFallback label="Getting your groups..." />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
