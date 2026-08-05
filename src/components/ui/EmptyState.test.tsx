// Contract pins for the <EmptyState> primitive (Req 6 / D-15..D-18, UI-SPEC §9.1).
//
// Six empty surfaces adopt this in later Phase-88 plans, so the pins are about
// the CONTRACT, not the styling taste:
//   1. the heading is a real <h3> and carries the meaning (§9.1 a11y row)
//   2. the glyph is DECORATIVE — aria-hidden, never role="img" (Icon.tsx:70-72)
//   3. `illustration` (D-17) REPLACES the icon circle at the same position, so
//      real artwork drops in later with no layout change
//   4. `action` is a caller-owned node, so CTA gating stays at the call site
//      (GroupGamesList's `userRole && userRole !== 'pending'` shape)
//   5. type sizes stay inside the 4-size working set (§4.1)
//   6. axe-clean
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { EmptyState } from './EmptyState';
import { Button } from './Button';

afterEach(cleanup);

const base = {
  icon: 'Vote',
  heading: 'No check-ins running',
  body: "Start one and everyone picks the nights that work — you'll see the overlap.",
} as const;

describe('EmptyState', () => {
  it('renders the heading as an h3 at the 20px/700 Heading role', () => {
    render(<EmptyState {...base} />);
    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'No check-ins running',
    });
    expect(heading.tagName).toBe('H3');
    expect(heading).toHaveClass('text-xl');
    expect(heading).toHaveClass('font-bold');
    expect(heading).toHaveClass('text-content-primary');
  });

  it('renders the body at 16px/400 secondary, measure-capped', () => {
    render(<EmptyState {...base} />);
    const body = screen.getByText(base.body);
    expect(body).toHaveClass('text-base');
    expect(body).toHaveClass('text-content-secondary');
    expect(body.className).toMatch(/max-w-\[60ch\]/);
  });

  it('renders the glyph as decorative (aria-hidden, never role="img")', () => {
    const { container } = render(<EmptyState {...base} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role', 'img');
    expect(svg).not.toHaveAttribute('aria-label');
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('puts the glyph in a 96px accent-tinted circle', () => {
    const { container } = render(<EmptyState {...base} />);
    const media = container.querySelector('[data-slot="empty-state-media"]');
    expect(media).not.toBeNull();
    expect(media).toHaveClass('h-24');
    expect(media).toHaveClass('w-24');
    expect(media).toHaveClass('rounded-full');
    expect(media).toHaveClass('bg-surface-accent-subtle');
    expect(media).toHaveClass('text-accent');
  });

  it('renders `illustration` INSTEAD of the icon circle, in the same position', () => {
    const { container } = render(
      <EmptyState
        {...base}
        illustration={<img src="/art/empty-polls.png" alt="" width={96} />}
      />
    );
    const media = container.querySelector('[data-slot="empty-state-media"]');
    expect(media).not.toBeNull();
    expect(media!.querySelector('img')).not.toBeNull();
    // the circle + glyph are gone, not merely hidden
    expect(container.querySelector('svg')).toBeNull();
    expect(media).not.toHaveClass('bg-surface-accent-subtle');
    // same position: still the FIRST child of the root
    expect(container.firstElementChild!.firstElementChild).toBe(media);
  });

  it('renders one caller-owned CTA when `action` is passed', () => {
    render(
      <EmptyState {...base} action={<Button>+ Start a check-in</Button>} />
    );
    expect(
      screen.getByRole('button', { name: '+ Start a check-in' })
    ).toBeInTheDocument();
  });

  it('renders no button and keeps the layout when `action` is omitted', () => {
    const { container } = render(<EmptyState {...base} />);
    expect(screen.queryByRole('button')).toBeNull();
    // heading + body still render; no empty CTA row is left behind
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="empty-state-action"]')).toBeNull();
  });

  it('merges a caller className onto the root', () => {
    const { container } = render(<EmptyState {...base} className="py-4" />);
    expect(container.firstElementChild).toHaveClass('py-4');
  });

  it('stays inside the 4-size type working set (no text-xs/sm/lg/2xl)', () => {
    const { container } = render(
      <EmptyState {...base} action={<Button>Go</Button>} />
    );
    const root = container.firstElementChild as HTMLElement;
    // scan EmptyState's own markup only — the Button primitive owns its own size
    const emitted = Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter((el) => el.closest('[data-slot="empty-state-action"]') === null)
      .map((el) => el.className)
      .concat(root.className)
      .join(' ');
    expect(emitted).not.toMatch(/(^|\s)text-(xs|sm|lg|2xl)(\s|$)/);
  });

  it('passes an axe audit with no violations', async () => {
    const { container } = render(
      <EmptyState {...base} action={<Button>+ Start a check-in</Button>} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
