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

  // DEF-88-09-01 (closed in 88-18): the heading LEVEL is overridable so a
  // page-level EmptyState can supply the document's <h1>; the 20px/700 type
  // role must NOT follow the level.
  it('keeps h3 as the default heading level so no shipped call site moves', () => {
    render(<EmptyState {...base} />);
    expect(
      screen.getByRole('heading', { level: 3, name: base.heading })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('renders the heading as an h1 when `headingLevel="h1"`, at the SAME type role', () => {
    render(<EmptyState {...base} headingLevel="h1" />);
    const heading = screen.getByRole('heading', { level: 1, name: base.heading });
    expect(heading.tagName).toBe('H1');
    // the level moved; the 20px/700 Heading role did not
    expect(heading).toHaveClass('text-xl');
    expect(heading).toHaveClass('font-bold');
    expect(heading).toHaveClass('text-content-primary');
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('renders the heading as an h2 when asked', () => {
    render(<EmptyState {...base} headingLevel="h2" />);
    expect(
      screen.getByRole('heading', { level: 2, name: base.heading })
    ).toBeInTheDocument();
  });

  // Plan 88.6-36 task 1 (D-05). The three pins above assert the RENDERED RESULT and would stay
  // green against the raw `<HeadingTag>` this file shipped before — they are the PRESERVATION
  // halves, and they are what proves the migration moved nothing visible. This arm is the one
  // that proves the COMPOSITION: `wrap-anywhere` comes from `Heading`'s cva BASE and
  // `leading-tight` from its `heading` size variant, and neither was on the raw tag, so this
  // assertion is RED against the pre-migration component. Written that way on purpose — a
  // migration pinned only by "it still looks the same" cannot tell a migration from a no-op.
  it('renders the headline THROUGH the Heading primitive at every supported level', () => {
    for (const [tag, level] of [
      ['h1', 1],
      ['h2', 2],
      ['h3', 3],
    ] as const) {
      cleanup();
      render(<EmptyState {...base} headingLevel={tag} />);
      const heading = screen.getByRole('heading', { level, name: base.heading });
      expect(heading.tagName).toBe(tag.toUpperCase());
      // Heading.tsx's cva base (`font-bold wrap-anywhere`) and its `heading` size variant
      // (`text-xl leading-tight`) — the primitive's fingerprint.
      expect(heading, `${tag}: wrap utility comes from the primitive base`).toHaveClass(
        'wrap-anywhere'
      );
      expect(heading, `${tag}: 20px rung`).toHaveClass('text-xl');
      expect(heading, `${tag}: 1.25 line height`).toHaveClass('leading-tight');
      expect(heading, `${tag}: 700 from the base, never from the call site`).toHaveClass(
        'font-bold'
      );
      // SIZE DOES NOT FOLLOW LEVEL — the 88-18 marker's whole point, now enforced by the
      // primitive. `Heading`'s derived default for level 1 is `display` (30); `EmptyState`
      // passes `size="heading"` explicitly, so the 404's title stays at 20.
      expect(heading, `${tag}: never grown to Display`).not.toHaveClass('text-3xl');
    }
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
    expect(media).toHaveClass('bg-surface-accent-subtle-strong');
    expect(media).toHaveClass('text-content-accent-strong');
  });

  it('renders `illustration` INSTEAD of the icon circle, in the same position', () => {
    const { container } = render(
      <EmptyState
        {...base}
        illustration={
          // A raw <img> is the point: the slot must accept ANY node, including
          // artwork a caller has not routed through next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/art/empty-polls.png" alt="" width={96} />
        }
      />
    );
    const media = container.querySelector('[data-slot="empty-state-media"]');
    expect(media).not.toBeNull();
    expect(media!.querySelector('img')).not.toBeNull();
    // the circle + glyph are gone, not merely hidden
    expect(container.querySelector('svg')).toBeNull();
    expect(media).not.toHaveClass('bg-surface-accent-subtle-strong');
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
