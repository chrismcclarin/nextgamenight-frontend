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
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { RouteFallback } from './RouteFallback';

afterEach(cleanup);

describe('RouteFallback', () => {
  it('is an announced live region with an accessible name (AR R1-M18)', () => {
    render(<RouteFallback label="Getting your groups..." />);
    const region = screen.getByRole('status', { name: 'Getting your groups...' });
    expect(region).toBeInTheDocument();
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
