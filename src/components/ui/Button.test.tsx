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

  // ───────────────────────────────────────────────────────────────────────────
  // 88.6-06 (D-09 / C.1) — the two new rungs (`accent`, `sm`), the all-viewport
  // 44px floor on the cva BASE, the dead-class rule, and the enabled-only hover.
  //
  // WHY EVERY HOVER CHECK BELOW IS AN EXACT-TOKEN CHECK, never a substring one:
  // `enabled-hover:` CONTAINS `hover:`, so `toContain('hover:')` is satisfied by
  // BOTH the old (bare, ungated) and the new (gated) spelling and therefore
  // proves nothing. Each check splits the class string on whitespace first and
  // compares whole tokens.
  // ───────────────────────────────────────────────────────────────────────────
  describe('88.6-06 — accent + sm rungs, base 44px floor, enabled-only hover', () => {
    const tokensOf = (s: string): string[] =>
      s.trim().split(/\s+/).filter(Boolean);

    /** The whole emitted surface: every variant x size the primitive ships. */
    const ALL_VARIANTS = [
      'primary',
      'secondary',
      'danger',
      'ghost',
      'accent',
    ] as const;
    const ALL_SIZES = ['default', 'icon', 'sm'] as const;

    it('variant="accent" emits btn-accent and paints no colour utility of its own', () => {
      render(<Button variant="accent">Create Event</Button>);
      const btn = screen.getByRole('button', { name: 'Create Event' });
      expect(btn).toHaveClass('btn');
      expect(btn).toHaveClass('btn-accent');
      // The amber is carried by `.btn-accent` (globals.css:2478-2481) over
      // `--color-btn-accent-bg` / `-text`. Re-emitting it as utilities would be
      // the SECOND expression of one value — exactly what the 88.3-18 marker
      // (globals.css:2389) exists to prevent.
      for (const tok of tokensOf(btn.className)) {
        expect(
          tok,
          `88.6-06 D-09 — \`accent\` must emit the CLASS, never the amber as utilities; found \`${tok}\``
        ).not.toMatch(/^(bg-|text-content-)/);
      }
    });

    it('size="sm" emits btn-sm and no padding or font-size utility (they would be DEAD)', () => {
      render(<Button size="sm">Invite guest</Button>);
      const btn = screen.getByRole('button', { name: 'Invite guest' });
      expect(btn).toHaveClass('btn');
      expect(btn).toHaveClass('btn-sm');
      for (const tok of tokensOf(btn.className)) {
        expect(
          tok,
          `88.6-06 D-09 — \`${tok}\` is DEAD on a \`.btn\` element: \`.btn\` declares \`padding: .5rem 1rem\` (globals.css:2202) and \`font-size: .875rem\` (:2201) UNLAYERED, and an unlayered author rule beats every \`@layer utilities\` rule. The compact padding comes from the unlayered \`.btn-sm\` rule (globals.css:2722-2725), never from a utility`
        ).not.toMatch(/^(p-|px-|py-|text-xs$|text-sm$|text-base$)/);
      }
    });

    it('size="icon" is a two-axis floor and emits no dead padding utility', () => {
      render(
        <Button variant="ghost" size="icon" aria-label="Close">
          <span aria-hidden="true">x</span>
        </Button>
      );
      const btn = screen.getByRole('button', { name: 'Close' });
      expect(btn).toHaveClass('min-h-11');
      expect(btn).toHaveClass('min-w-11');
      expect(
        tokensOf(btn.className),
        '88.6-06 C.1 — `p-0` was DEAD from the day it was written: `.btn` declares `padding: .5rem 1rem` UNLAYERED (globals.css:2202) and `@layer utilities` always loses. Re-adding it changes no rendered pixel and re-introduces a class the AC-3 dead-class rule forbids'
      ).not.toContain('p-0');
    });

    it('every variant x size emits the base min-h-11 floor, at every viewport width', () => {
      for (const variant of ALL_VARIANTS) {
        for (const size of ALL_SIZES) {
          const { container } = render(
            <Button variant={variant} size={size} aria-label="x">
              go
            </Button>
          );
          const cls = (container.firstElementChild as HTMLElement).className;
          expect(
            tokensOf(cls),
            `88.6-06 D-09 — the 44px floor lives on the cva BASE so it reaches every viewport width (variant=${variant} size=${size}). The phone-only \`.btn\` class rule (globals.css:2677-2681) is deliberately NOT widened — D-36 rejects an all-viewport floor on the CLASS, which square-by-design controls wear`
          ).toContain('min-h-11');
          cleanup();
        }
      }
    });

    it('no UNPREFIXED hover token survives in any emitted class string', () => {
      for (const variant of ALL_VARIANTS) {
        for (const size of ALL_SIZES) {
          for (const tok of tokensOf(buttonVariants({ variant, size }))) {
            expect(
              tok,
              `88.6-06 D10 — \`${tok}\` is an UNPREFIXED hover token (variant=${variant} size=${size}). It lifts or washes controls that are \`disabled\` or \`aria-disabled\` — exactly the controls the four legacy \`.btn-*:hover:not(:disabled):not([aria-disabled='true'])\` rules (globals.css:2383, :2483, :2633, :2643) deliberately exclude. Express it through the \`enabled-hover\` variant (globals.css:177-183)`
            ).not.toMatch(/^hover:/);
          }
        }
      }
    });

    it('the base elevation pair is a resting shadow plus an enabled-hover lift', () => {
      const base = tokensOf(buttonVariants({ variant: 'primary' }));
      expect(base).toContain('shadow-theme-sm');
      expect(
        base,
        '88.6-06 D10 — the hover half of the elevation pair must be gated by the `enabled-hover` variant so a disabled or aria-disabled control never lifts'
      ).toContain('enabled-hover:shadow-theme-md');
    });

    it('the ghost wash is enabled-hover-scoped and keeps its gated ink', () => {
      const ghost = tokensOf(buttonVariants({ variant: 'ghost' }));
      expect(ghost).toContain('bg-transparent');
      expect(ghost).toContain('text-content-secondary');
      expect(
        ghost,
        "88.6-06 D10 — a NATIVELY-disabled ghost washed on hover until this narrowing: the shipped `aria-disabled:hover:bg-transparent` override only ever reached the ARIA half"
      ).toContain('enabled-hover:bg-surface-hover');
      // Gate A test 53's pin (tokenContrast.test.ts:1647-1648) scans this same
      // string: the gated state is COLOUR, never element opacity.
      expect(ghost).toContain('aria-disabled:text-content-muted');
      expect(ghost.join(' ')).not.toMatch(/aria-disabled:opacity/);
    });

    it('the four shipped variants are otherwise unchanged — the rungs are ADDITIVE', () => {
      expect(buttonVariants({ variant: 'primary' })).toContain('btn-primary');
      expect(buttonVariants({ variant: 'secondary' })).toContain(
        'btn-secondary'
      );
      expect(buttonVariants({ variant: 'danger' })).toContain('btn-danger');
      for (const v of ['primary', 'secondary', 'danger'] as const) {
        const toks = tokensOf(buttonVariants({ variant: v }));
        expect(
          toks.filter((t) => t.startsWith('btn-')),
          `88.6-06 — \`${v}\` must still emit exactly its one legacy class`
        ).toEqual([`btn-${v}`]);
      }
    });

    it('a caller bg/text utility still beats the ghost variant string (twMerge, not absence)', () => {
      render(
        <Button variant="ghost" className="bg-surface-card text-content-primary">
          Menu
        </Button>
      );
      const btn = screen.getByRole('button', { name: 'Menu' });
      // The MECHANISM is `cn` = `twMerge(clsx(...))` (src/lib/cn.ts:34), NOT
      // "the base declares neither". The cva BASE declares no `bg-*` and no text
      // colour, but the GHOST VARIANT STRING declares BOTH `bg-transparent` and
      // `text-content-secondary` — the caller wins because tailwind-merge drops
      // the earlier conflicting tokens. A future editor who breaks this should
      // be sent to `cn`, not to the base.
      const toks = tokensOf(btn.className);
      expect(
        toks,
        '88.6-06 — tailwind-merge (src/lib/cn.ts) must drop the ghost string`s own bg-transparent for the caller`s bg-*'
      ).toContain('bg-surface-card');
      expect(toks).not.toContain('bg-transparent');
      expect(toks).toContain('text-content-primary');
      expect(toks).not.toContain('text-content-secondary');
    });

    it('asChild renders an <a> with the button classes and no type attribute', () => {
      render(
        <Button asChild variant="accent">
          <a href="/x">y</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'y' });
      expect(link.tagName).toBe('A');
      expect(link).toHaveClass('btn', 'btn-accent');
      expect(link).not.toHaveAttribute('type');
    });
  });
});
