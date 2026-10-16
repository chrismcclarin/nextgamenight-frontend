// Phase 88.6.1-43 (D-20 / D-43): the ONE typed radio-group hook.
//
// The hook hands back the radio role, aria-checked, the roving tabIndex, type="button",
// a ref and the arrow handler TOGETHER, so a consumer cannot take the role without its
// keyboard model. These arms pin the ARIA APG radio pattern: one tab stop, arrows that
// move AND check (wrapping at both ends), Space through native button activation, and a
// group name that is required.
//
// Two harnesses: Harness renders three sibling radios with string values; NestedHarness
// wraps each radio in its own div and uses numeric values, which is the shape of Phase
// 88.9's StarRatingPicker (half-star radios nested inside per-star wrappers).
//
// Comments in this file are line comments only (FE-TESTING-CONVENTIONS CF-9).
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { useRadioGroup } from './useRadioGroup';

const VALUES = ['a', 'b', 'c'] as const;

type GroupName = { labelledBy: string } | { label: string };

function Harness({
  initial,
  onCheck,
  name = { labelledBy: 'lbl' },
  values = VALUES,
}: {
  initial: string | null;
  onCheck: (value: string) => void;
  name?: GroupName;
  values?: readonly string[];
}) {
  const [checked, setChecked] = React.useState<string | null>(initial);
  const { groupProps, getRadioProps } = useRadioGroup<string>({
    values,
    checked,
    onCheck: (value) => {
      onCheck(value);
      setChecked(value);
    },
    ...name,
  });
  return (
    <div>
      <span id="lbl">Pick a letter</span>
      <div {...groupProps} data-testid="group">
        {values.map((value, index) => (
          <button key={value} {...getRadioProps(index)}>
            {value.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

const HALVES = [0.5, 1, 1.5] as const;

function NestedHarness({ initial, onCheck }: { initial: number; onCheck: (value: number) => void }) {
  const [checked, setChecked] = React.useState<number>(initial);
  const { groupProps, getRadioProps } = useRadioGroup<number>({
    values: HALVES,
    checked,
    onCheck: (value) => {
      onCheck(value);
      setChecked(value);
    },
    label: 'Rating',
  });
  return (
    <div {...groupProps}>
      {HALVES.map((value, index) => (
        <div key={value} className="star-wrapper">
          <button {...getRadioProps(index)} aria-label={`${value} stars`} />
        </div>
      ))}
    </div>
  );
}

function radio(name: string): HTMLElement {
  return screen.getByRole('radio', { name });
}

afterEach(() => {
  cleanup();
});

describe('Phase 88.6.1-43 — useRadioGroup (D-20 / D-43)', () => {
  it('RG1: the container is a radiogroup of three button radios, with exactly the checked one aria-checked', () => {
    render(<Harness initial="b" onCheck={vi.fn()} />);
    expect(screen.getByTestId('group')).toHaveAttribute('role', 'radiogroup');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r).toHaveAttribute('type', 'button');
    expect(radio('A')).toHaveAttribute('aria-checked', 'false');
    expect(radio('B')).toHaveAttribute('aria-checked', 'true');
    expect(radio('C')).toHaveAttribute('aria-checked', 'false');
  });

  it('RG2: exactly one tab stop — the checked radio, else the first when nothing (or a non-value) is checked', () => {
    const { unmount } = render(<Harness initial="b" onCheck={vi.fn()} />);
    let stops = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
    expect(stops).toEqual([radio('B')]);
    for (const r of screen.getAllByRole('radio').filter((x) => x !== radio('B'))) {
      expect(r).toHaveAttribute('tabindex', '-1');
    }
    unmount();

    for (const initial of [null, 'z']) {
      const view = render(<Harness initial={initial} onCheck={vi.fn()} />);
      stops = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
      expect(stops).toEqual([radio('A')]);
      expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
      view.unmount();
    }
  });

  it('RG3: ArrowRight and ArrowDown each move focus to the next radio AND check it', () => {
    for (const key of ['ArrowRight', 'ArrowDown']) {
      const onCheck = vi.fn();
      const view = render(<Harness initial="b" onCheck={onCheck} />);
      radio('B').focus();
      fireEvent.keyDown(radio('B'), { key });
      expect(onCheck).toHaveBeenCalledTimes(1);
      expect(onCheck).toHaveBeenCalledWith('c');
      expect(document.activeElement).toBe(radio('C'));
      expect(radio('C')).toHaveAttribute('aria-checked', 'true');
      expect(radio('B')).toHaveAttribute('aria-checked', 'false');
      expect(radio('C')).toHaveAttribute('tabindex', '0');
      view.unmount();
    }
  });

  it('RG4: ArrowRight from the LAST radio wraps to the first', () => {
    const onCheck = vi.fn();
    render(<Harness initial="c" onCheck={onCheck} />);
    radio('C').focus();
    fireEvent.keyDown(radio('C'), { key: 'ArrowRight' });
    expect(onCheck).toHaveBeenCalledWith('a');
    expect(document.activeElement).toBe(radio('A'));
    expect(radio('A')).toHaveAttribute('aria-checked', 'true');
  });

  it('RG5: ArrowLeft and ArrowUp move to the previous radio; ArrowLeft from the FIRST wraps to the last', () => {
    for (const key of ['ArrowLeft', 'ArrowUp']) {
      const onCheck = vi.fn();
      const view = render(<Harness initial="b" onCheck={onCheck} />);
      radio('B').focus();
      fireEvent.keyDown(radio('B'), { key });
      expect(onCheck).toHaveBeenCalledWith('a');
      expect(document.activeElement).toBe(radio('A'));
      expect(radio('A')).toHaveAttribute('aria-checked', 'true');
      view.unmount();
    }

    const onCheck = vi.fn();
    render(<Harness initial="a" onCheck={onCheck} />);
    radio('A').focus();
    fireEvent.keyDown(radio('A'), { key: 'ArrowLeft' });
    expect(onCheck).toHaveBeenCalledWith('c');
    expect(document.activeElement).toBe(radio('C'));
    expect(radio('C')).toHaveAttribute('aria-checked', 'true');
  });

  it('RG6: arrows are default-prevented; other keys and modified arrows are left alone', () => {
    const onCheck = vi.fn();
    render(<Harness initial="b" onCheck={onCheck} />);
    radio('B').focus();
    // fireEvent returns false when a handler called preventDefault
    expect(fireEvent.keyDown(radio('B'), { key: 'ArrowRight' })).toBe(false);
    onCheck.mockClear();

    const c = radio('C');
    for (const key of ['Tab', 'Home', 'a']) {
      expect(fireEvent.keyDown(c, { key })).toBe(true);
    }
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
      expect(fireEvent.keyDown(c, { key: 'ArrowRight', [modifier]: true })).toBe(true);
    }
    expect(onCheck).not.toHaveBeenCalled();
    expect(c).toHaveAttribute('aria-checked', 'true');
  });

  it('RG7: clicking an unchecked radio checks it through onCheck, once', () => {
    const onCheck = vi.fn();
    render(<Harness initial="a" onCheck={onCheck} />);
    fireEvent.click(radio('C'));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onCheck).toHaveBeenCalledWith('c');
    expect(radio('C')).toHaveAttribute('aria-checked', 'true');
  });

  it('RG8: Space on a focused unchecked radio checks it and never submits a surrounding form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onCheck = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <Harness initial="a" onCheck={onCheck} />
      </form>,
    );
    radio('B').focus();
    await user.keyboard(' ');
    expect(onCheck).toHaveBeenCalledWith('b');
    expect(radio('B')).toHaveAttribute('aria-checked', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('RG9: radios that are not DOM siblings, with numeric values, still move and wrap', () => {
    const onCheck = vi.fn();
    const view = render(<NestedHarness initial={0.5} onCheck={onCheck} />);
    radio('0.5 stars').focus();
    fireEvent.keyDown(radio('0.5 stars'), { key: 'ArrowRight' });
    expect(onCheck).toHaveBeenLastCalledWith(1);
    expect(document.activeElement).toBe(radio('1 stars'));
    expect(radio('1 stars')).toHaveAttribute('aria-checked', 'true');
    view.unmount();

    const onCheck2 = vi.fn();
    render(<NestedHarness initial={0.5} onCheck={onCheck2} />);
    radio('0.5 stars').focus();
    fireEvent.keyDown(radio('0.5 stars'), { key: 'ArrowLeft' });
    expect(onCheck2).toHaveBeenLastCalledWith(1.5);
    expect(document.activeElement).toBe(radio('1.5 stars'));
    expect(radio('1.5 stars')).toHaveAttribute('aria-checked', 'true');
  });

  it('RG10: the group is named by labelledBy or by label, and the labelled group passes axe', async () => {
    const view = render(<Harness initial="a" onCheck={vi.fn()} name={{ labelledBy: 'lbl' }} />);
    expect(screen.getByTestId('group')).toHaveAttribute('aria-labelledby', 'lbl');
    expect(screen.getByTestId('group')).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('radiogroup', { name: 'Pick a letter' })).toBe(screen.getByTestId('group'));
    expect(await axe(view.container)).toHaveNoViolations();
    view.unmount();

    render(<Harness initial="a" onCheck={vi.fn()} name={{ label: 'Rating' }} />);
    expect(screen.getByTestId('group')).toHaveAttribute('aria-label', 'Rating');
    expect(screen.getByTestId('group')).not.toHaveAttribute('aria-labelledby');
  });

  it('RG11: a single-option group keeps focus on its one radio and checks it, without throwing', () => {
    const onCheck = vi.fn();
    render(<Harness initial={null} onCheck={onCheck} values={['solo']} />);
    const only = radio('SOLO');
    only.focus();
    expect(() => fireEvent.keyDown(only, { key: 'ArrowRight' })).not.toThrow();
    expect(onCheck).toHaveBeenCalledWith('solo');
    expect(document.activeElement).toBe(only);
    expect(only).toHaveAttribute('aria-checked', 'true');
  });
});

