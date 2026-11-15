// Phase 88.9-66 (X64, X70a, X70b): the one centred frame a page-replacing banner sits in.
// jsdom has no layout, so these two tests pin the frame's class contract and its prop routing;
// the rendered gutter, width and centring are measured in a real browser by
// e2e/signed-out-banner-frame.spec.ts ("X64 (88.9): Plan Game Session signed out").
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CentredPageFrame } from './CentredPageFrame';

afterEach(cleanup);

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('CentredPageFrame (88.9-66: X64 / X70)', () => {
  it('X64 / X70 (88.9): the frame centres its child in a full-height column with a 16px phone gutter widening to 24px at md, the child capped at max-w-xl', () => {
    render(
      <CentredPageFrame>
        <p>the banner</p>
      </CentredPageFrame>
    );
    const inner = screen.getByText('the banner').parentElement as HTMLElement;
    const outer = inner.parentElement as HTMLElement;
    // The outer box: a full-height column that centres on both axes.
    for (const token of ['flex', 'flex-col', 'min-h-screen', 'items-center', 'justify-center']) {
      expect(classesOf(outer), `the outer box lacks ${token}`).toContain(token);
    }
    // The gutter: 16px on a phone (p-4), 24px from md (md:p-6), and no other padding utility.
    const padding = classesOf(outer).filter((t) => /^(?:[a-z0-9]+:)*p[xytrbl]?-/.test(t));
    expect(padding.sort()).toEqual(['md:p-6', 'p-4']);
    // The inner box: full width up to the cap.
    expect(classesOf(inner)).toContain('w-full');
    expect(classesOf(inner)).toContain('max-w-xl');
    expect(outer.children).toHaveLength(1);
  });

  it('X64 / X70 (88.9): ref, tabIndex and other props reach the inner box, which carries data-slot page-frame', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <CentredPageFrame ref={ref} tabIndex={-1} id="frame-under-test" className="text-left">
        <p>the banner</p>
      </CentredPageFrame>
    );
    const inner = screen.getByText('the banner').parentElement as HTMLElement;
    expect(ref.current).toBe(inner);
    expect(inner).toHaveAttribute('data-slot', 'page-frame');
    expect(inner).toHaveAttribute('tabindex', '-1');
    expect(inner).toHaveAttribute('id', 'frame-under-test');
    expect(classesOf(inner)).toContain('text-left');
    expect(classesOf(inner)).toContain('max-w-xl');
    // The outer box takes none of them.
    const outer = inner.parentElement as HTMLElement;
    expect(outer).not.toHaveAttribute('data-slot');
    expect(outer).not.toHaveAttribute('tabindex');
    expect(outer).not.toHaveAttribute('id');
    inner.focus();
    expect(document.activeElement).toBe(inner);
  });
});
