// Plan 88.9-67 (52-X69 widened, owner 2026-11-14) — the width reserve a gated control wears.
// jsdom has no layout, so these pins read STRUCTURE: where the reserve strings live (an attribute
// painted by a pseudo-element, never a text node), that they are hidden from assistive tech and
// from sight, and that the host's text and name are the visible label alone. The rendered widths
// are measured in a browser by the three e2e titles that start "X69 (88.9)".
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ReservedLabel } from './ReservedLabel';

describe('ReservedLabel (88.9-67)', () => {
  it("X69 (88.9): every reserve string sits in the visible label's grid cell as an aria-hidden, invisible pseudo-element span, and the host's text and name are the visible label alone", () => {
    render(
      <button type="button">
        <ReservedLabel reserve={['Wait (3)', 'Wait (2)', 'Wait (1)', 'Tap again to confirm']} reserveClassName="font-semibold">
          Wait (3)
        </ReservedLabel>
      </button>
    );

    const host = screen.getByRole('button', { name: 'Wait (3)' });
    // The reserve never enters the text: a text-node sizer would make this read five labels.
    expect(host.textContent).toBe('Wait (3)');

    const reserves = Array.from(host.querySelectorAll('[data-reserve]'));
    expect(reserves.map((span) => span.getAttribute('data-reserve'))).toEqual([
      'Wait (3)',
      'Wait (2)',
      'Wait (1)',
      'Tap again to confirm',
    ]);
    for (const span of reserves) {
      expect(span.getAttribute('aria-hidden')).toBe('true');
      expect(span.textContent).toBe('');
      expect(span.childNodes).toHaveLength(0);
      const classes = span.className.split(/\s+/);
      expect(classes).toContain('invisible');
      expect(classes).toContain('col-start-1');
      expect(classes).toContain('row-start-1');
      expect(classes).toContain('before:content-[attr(data-reserve)]');
      expect(classes).toContain('font-semibold');
    }

    // One grid cell: the visible label shares the reserve spans' cell.
    const root = host.firstElementChild as HTMLElement;
    expect(root.className.split(/\s+/)).toContain('inline-grid');
    const visible = root.lastElementChild as HTMLElement;
    expect(visible.textContent).toBe('Wait (3)');
    expect(visible.hasAttribute('aria-hidden')).toBe(false);
    expect(visible.className.split(/\s+/)).toEqual(['col-start-1', 'row-start-1']);
    // The primitive sets no weight, colour or wrapping of its own.
    expect(root.className).not.toMatch(/\bfont-|\btext-|whitespace-/);
  });

  it('X69 (88.9): an empty reserve renders the visible label alone in the same wrapper', () => {
    render(
      <button type="button">
        <ReservedLabel reserve={[]} className="justify-items-end">
          Remove
        </ReservedLabel>
      </button>
    );

    const host = screen.getByRole('button', { name: 'Remove' });
    expect(host.querySelectorAll('[data-reserve]')).toHaveLength(0);
    expect(host.textContent).toBe('Remove');
    // Same wrapper as the reserving form, so arming does not swap the markup's shape; a root
    // className lands beside inline-grid (plan 88.9-68 passes justify-items-end through it).
    const root = host.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.className.split(/\s+/)).toEqual(['inline-grid', 'justify-items-end']);
    expect(root.children).toHaveLength(1);
    expect((root.firstElementChild as HTMLElement).className.split(/\s+/)).toEqual(['col-start-1', 'row-start-1']);
  });
});
