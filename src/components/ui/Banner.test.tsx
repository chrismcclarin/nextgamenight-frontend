// Contract pins for <Banner>'s additive `actions` slot (Phase 88.6.1-21, AC-11 / D-42).
//
// Banner's title and message render inside its own StatusRegion (assertive on warning/error,
// polite on info/success). A control placed in `children` sits INSIDE that aria-atomic region,
// so a label change on it (Try again -> Retrying...) is a mutation inside the live region. The
// `actions` slot puts controls in the bordered box, below the message, OUTSIDE the region.
//
// What these arms pin:
//   N1 — omitting `actions` keeps the original markup: the region is the box's second child
//        (after the icon) and carries `flex-1`; tone picks the role.
//   N2 — `actions` renders inside the box but never inside the region; a `flex-1` column wrapper
//        holds the region, then the actions, in that order.
//   N3 — `actions={null}` selects the same column shape with nothing after the region.
//   N4 — the prop never reaches the DOM as an attribute.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Banner } from './Banner';

afterEach(cleanup);

describe('Banner — the additive actions slot (plan 88.6.1-21, AC-11 / D-42)', () => {
  it('N1: with no actions the markup is unchanged — the region is the second child and carries flex-1', () => {
    for (const [tone, role] of [
      ['warning', 'alert'],
      ['error', 'alert'],
      ['info', 'status'],
      ['success', 'status'],
    ] as const) {
      const { container, unmount } = render(
        <Banner tone={tone} title="Heads up">
          <p>Body text</p>
        </Banner>
      );
      const box = container.firstElementChild as HTMLElement;
      expect(box.children, `${tone}: the icon, then the region`).toHaveLength(2);
      const region = box.children[1] as HTMLElement;
      expect(region, `${tone}: role follows tone`).toHaveAttribute('role', role);
      expect(region).toHaveAttribute('aria-live');
      expect(region).toHaveClass('flex-1');
      expect(region.textContent).toBe('Heads upBody text');
      unmount();
    }
  });

  it('N2: actions render inside the box, after the region, never inside the live region', () => {
    const { container } = render(
      <Banner tone="warning" title="Heads up" actions={<button type="button">Go</button>}>
        <p>Body text</p>
      </Banner>
    );
    const box = container.firstElementChild as HTMLElement;
    const button = screen.getByRole('button', { name: 'Go' });
    expect(box.contains(button), 'the control stays inside the bordered box').toBe(true);
    expect(button.closest('[aria-live]'), 'the control is outside the live region').toBeNull();

    const column = box.children[1] as HTMLElement;
    expect(column).toHaveClass('flex-1');
    expect(column.children).toHaveLength(2);
    const region = column.children[0] as HTMLElement;
    expect(region).toHaveAttribute('role', 'alert');
    expect(region.className, 'the region carries only its own base class here').toBe('text-sm');
    expect(region.textContent, 'the region holds the title and children only').toBe('Heads upBody text');
    expect(column.children[1]).toBe(button);
  });

  it('N3: actions={null} selects the column shape with nothing after the region', () => {
    const { container } = render(
      <Banner tone="warning" title="Heads up" actions={null}>
        <p>Body text</p>
      </Banner>
    );
    const box = container.firstElementChild as HTMLElement;
    const column = box.children[1] as HTMLElement;
    expect(column).toHaveClass('flex-1');
    expect(column).not.toHaveAttribute('aria-live');
    expect(column.children).toHaveLength(1);
    expect(column.children[0]).toHaveAttribute('aria-live', 'assertive');
  });

  it('N4: the actions prop never reaches the DOM as an attribute', () => {
    const { container } = render(
      <Banner tone="info" actions={<button type="button">Go</button>}>
        <p>Body text</p>
      </Banner>
    );
    expect(container.querySelector('[actions]')).toBeNull();
  });
});
