// Contract pins for the <Button> primitive (PRIM-01 / D-01 elevation, D-02 variants).
//
// Button is imported by almost every later Phase-88 adoption plan, so the pins
// here are deliberately about the CONTRACT, not the styling taste:
//   1. it composes the legacy unlayered `.btn` (see the DECISION marker in
//      Button.tsx) rather than re-emitting its properties as utilities
//   2. D-01's elevation + focus ring live in the cva BASE, so every variant gets
//      them for free
//   3. `ghost` carries NO `.btn-*` background class — that is what makes it a
//      legitimate home for bare icon buttons
//   4. `size="icon"` is the 44x44 floor, delivered once instead of per-site
//   5. `asChild` hands rendering to the child (Radix Slot)
//   6. axe-clean with an accessible name
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Button, buttonVariants } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders a type="button" carrying btn + btn-primary by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass('btn');
    expect(btn).toHaveClass('btn-primary');
  });

  it('keeps the D-01 elevation and focus ring in the base, on every variant', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost'] as const) {
      const base = buttonVariants({ variant });
      expect(base).toContain('btn');
      expect(base).toContain('shadow-theme-sm');
      expect(base).toContain('hover:shadow-theme-md');
      expect(base).toContain('focus-visible:ring-2');
      expect(base).toContain('focus-visible:ring-focus-ring');
      expect(base).toContain('focus-visible:ring-offset-2');
    }
  });

  it('maps secondary and danger to their legacy .btn-* classes', () => {
    const { rerender } = render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-secondary');

    rerender(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn-danger');
  });

  it('renders ghost with btn but no .btn-* background class', () => {
    render(<Button variant="ghost">Menu</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('btn');
    expect(btn).not.toHaveClass('btn-primary');
    expect(btn).not.toHaveClass('btn-secondary');
    expect(btn).not.toHaveClass('btn-danger');
    expect(btn).toHaveClass('bg-transparent');
  });

  it('gives size="icon" a 44x44 floor', () => {
    render(
      <Button variant="ghost" size="icon" aria-label="Open menu">
        <span aria-hidden="true">x</span>
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Open menu' });
    expect(btn).toHaveClass('min-h-11');
    expect(btn).toHaveClass('min-w-11');
  });

  it('never emits a scale/transform press or hover (reference forbids it)', () => {
    const all = [
      buttonVariants(),
      buttonVariants({ variant: 'ghost', size: 'icon' }),
    ].join(' ');
    expect(all).not.toMatch(/scale-|transform/);
  });

  it('renders the child element instead of a <button> when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/events">Browse events</a>
      </Button>
    );
    expect(screen.queryByRole('button')).toBeNull();
    const link = screen.getByRole('link', { name: 'Browse events' });
    expect(link).toHaveClass('btn', 'btn-primary');
  });

  it('merges a caller className over the variant classes', () => {
    render(<Button className="w-full">Save</Button>);
    expect(screen.getByRole('button')).toHaveClass('w-full');
  });

  it('passes an axe audit with no violations', async () => {
    render(<Button>Save</Button>);
    expect(await axe(screen.getByRole('button'))).toHaveNoViolations();
  });
});
