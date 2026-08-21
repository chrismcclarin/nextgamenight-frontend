// Contract pins for the designed 404 (Req 3 / D-20, plan 88-09) — specifically
// the heading-level fix DEF-88-09-01 closed in plan 88-18.
//
// This page is the ONLY surface where `EmptyState` IS the page: the layout
// supplies no heading (`src/app/Header.js` renders none), so if this file stops
// passing `headingLevel="h1"` the app regains a page with no `<h1>` and nothing
// else catches it. The DECISION block in not-found.tsx warns against the other
// "fix" (a second bolted-on heading); these tests pin BOTH halves — there is an
// h1, and it is the only heading.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import NotFound from './not-found';

afterEach(cleanup);

describe('not-found (404)', () => {
  it('supplies the page <h1> through EmptyState (DEF-88-09-01)', () => {
    render(<NotFound />);
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'This page took a wrong turn',
    });
    expect(heading.tagName).toBe('H1');
  });

  it('has exactly one heading, so no level is skipped', () => {
    render(<NotFound />);
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe('H1');
  });

  it('keeps the way back', () => {
    render(<NotFound />);
    const link = screen.getByRole('link', { name: 'Back to your groups' });
    expect(link).toHaveAttribute('href', '/');
  });

  it('passes an axe audit with no violations', async () => {
    const { container } = render(<NotFound />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
