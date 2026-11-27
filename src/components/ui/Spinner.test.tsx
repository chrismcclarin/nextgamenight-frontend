// Contract pins for the house Spinner and the Button busy affordance (plan 88.9-24,
// owner pick O16a, save-feedback rule 1; owner ruling Q6(b) 2026-11-08).
//
// The spinner is ONE typed primitive carrying the byte-identical class string of the
// three shipped copies; a busy Button keeps its label, shows that spinner, is
// aria-disabled (the gated colour pair is the dim) and is named '<label>, saving'
// (or '<label>, <its own verb>' through busySuffix). busy never swallows the press:
// each site's own refusal latch stays the refusal.
//
// R-C3b (plan 88.9-54, owner ruling 2026-11-10): the spinner is DELAYED and HELD — it appears
// after SPINNER_DELAY_MS (200) of busy and stays SPINNER_MIN_MS (500) from its appearance;
// aria-disabled and the heard suffix are immediate. Fake timers file-wide so every spinner read
// can advance past the delay deterministically.
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '@/app/components/Modal';
import { BUSY_HELD_CLASSES, BUSY_SPINNER_CLASSES, Button } from './Button';
import { DelayedSpinner } from './DelayedSpinner';
import { Spinner } from './Spinner';
import { SPINNER_DELAY_MS, SPINNER_MIN_MS } from './useDelayedSpinner';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HOUSE_TOKENS = [
  'inline-block',
  'animate-spin',
  'h-4',
  'w-4',
  'border-2',
  'border-line-strong',
  'border-t-transparent',
  'rounded-full',
];

describe('Spinner + Button busy (88.9-24, save-feedback rule 1)', () => {
  it('Spinner renders the house spinner: an aria-hidden span carrying every house token', () => {
    const { container } = render(<Spinner className="align-middle" />);
    const el = container.querySelector('[data-slot="spinner"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SPAN');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    const classes = el.className.split(/\s+/);
    // 8 house tokens + the caller's extra class = 9; each must survive cn().
    for (const token of HOUSE_TOKENS) expect(classes).toContain(token);
    expect(classes).toContain('align-middle');
  });

  it("rule 1 (88.9): a busy Button keeps its label, shows the spinner and is named '<label>, saving'", () => {
    const { container } = render(<Button busy>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save, saving' });
    // The visible label never changes.
    // AMENDED Phase 89.6-06 (bb-label): the label is read from the label span, chosen OVER the
    // button's direct text nodes this read used: the text now sits in span.bb-label, so the button
    // has no direct text node left (the sr-only suffix stays outside the span).
    expect(button.querySelector('.bb-label')?.textContent).toBe('Save');
    expect(Array.from(button.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(0);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it("busy={false} renders no spinner and no suffix and passes a caller's aria-disabled through", () => {
    const { container, rerender } = render(<Button busy={false}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    rerender(
      <Button busy={false} aria-disabled="true">
        Save
      </Button>
    );
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it('busySuffix replaces the suffix', () => {
    render(
      <Button busy busySuffix=", sending">
        Send
      </Button>
    );
    expect(screen.getByRole('button', { name: 'Send, sending' })).toBeTruthy();
    expect(screen.queryByText(', saving')).toBeNull();
  });

  it('busy under asChild sets aria-disabled and appends nothing (Slot takes one child)', () => {
    const { container } = render(
      <Button asChild busy>
        <a href="/x">Go</a>
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.getAttribute('aria-disabled')).toBe('true');
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS + 1)); // AMENDED Phase 88.9-54 (R-C3b): read after the appear window
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(link.textContent).toBe('Go');
  });

  it('Modal.Action forwards busy to Button', () => {
    const { container } = render(<Modal.Action busy>Save Changes</Modal.Action>);
    const button = screen.getByRole('button', { name: 'Save Changes, saving' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
  });

  it('busy never swallows the press: onClick still fires once per click', () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Save, saving' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe('Button busy is delayed and held (88.9-54, R-C3b)', () => {
  it('R-C3b (88.9): a busy Button is named and aria-disabled from the first ms but shows no spinner until 200 ms', () => {
    const { container } = render(<Button busy>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save, saving' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // AMENDED Phase 89.6-06 (bb-label): read from the label span, as in the rule 1 test above.
    expect(button.querySelector('.bb-label')?.textContent).toBe('Save');
    expect(Array.from(button.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0);
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS - 1));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save, saving' })).toBe(button);
  });

  it('R-C3b (88.9): once shown the spinner stays 500 ms after busy drops while the control is live again', () => {
    const { container, rerender } = render(<Button busy>Save</Button>);
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    rerender(<Button busy={false}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(SPINNER_MIN_MS - 1));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBe(button);
  });

  it('R-C3b (88.9): DelayedSpinner renders nothing until the delay, the house Spinner after, and keeps it through the hold', () => {
    const { container, rerender } = render(<DelayedSpinner busy className="ml-2" />);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS));
    const spinners = container.querySelectorAll('[data-slot="spinner"]');
    expect(spinners).toHaveLength(1);
    expect(spinners[0].className.split(/\s+/)).toContain('ml-2');
    expect(spinners[0].getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(50));
    rerender(<DelayedSpinner busy={false} className="ml-2" />); // 250 ms
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1); // 600 ms
    act(() => vi.advanceTimersByTime(100));
    expect(container.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0); // 700 ms
  });
});

// S4w = S4-c (plan 89.6-36, owner pick 2026-11-23: Same width, spinner only). At rest a Button is
// exactly as before; while its Spinner shows it holds its resting size: the children stay in flow
// but transparent, the Spinner sits centred over them, and the name still says the label and the
// suffix. The held look lasts exactly as long as the Spinner (its 500 ms hold included).
describe('S4w (89.6-36): a busy Button keeps its resting size; the words give way to a centred spinner', () => {
  const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);
  const spinnersIn = (root: ParentNode): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-slot="spinner"]'));

  it("S4w (89.6-36): at rest a busy-capable Button carries a plain Button's class string", () => {
    const plain = render(<Button>Save</Button>);
    const plainButton = plain.container.querySelector('button') as HTMLButtonElement;
    const plainClass = plainButton.className;
    const plainHtml = plainButton.innerHTML;
    plain.unmount();

    const resting = render(<Button busy={false}>Save</Button>);
    const restingButton = resting.container.querySelector('button') as HTMLButtonElement;
    expect(restingButton.className).toBe(plainClass);
    expect(restingButton.innerHTML).toBe(plainHtml);
    resting.unmount();

    // Busy, but the Spinner has not shown yet: the look is still the resting one.
    const early = render(<Button busy>Save</Button>);
    const earlyButton = early.container.querySelector('button') as HTMLButtonElement;
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS - 1));
    expect(earlyButton.className).toBe(plainClass);
    expect(spinnersIn(early.container)).toHaveLength(0);
  });

  it('S4w (89.6-36): once the spinner shows the button holds its look and keeps its name', () => {
    const { container } = render(<Button busy>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS));

    const held = tokens(button);
    for (const token of BUSY_HELD_CLASSES.split(' ')) expect(held, `the held button carries ${token}`).toContain(token);

    const spinners = spinnersIn(container);
    expect(spinners).toHaveLength(1);
    const spinnerTokens = tokens(spinners[0]);
    for (const token of HOUSE_TOKENS) expect(spinnerTokens, `the spinner keeps the house token ${token}`).toContain(token);
    for (const token of BUSY_SPINNER_CLASSES.split(' ')) expect(spinnerTokens, `the spinner carries ${token}`).toContain(token);

    // The words are hidden from the eye only: the name and the text are still there.
    expect(screen.getByRole('button', { name: 'Save, saving' })).toBe(button);
    expect(button.textContent).toContain('Save');
    const hidden = Array.from(button.querySelectorAll('[aria-hidden="true"]'));
    expect(hidden).toEqual(spinners);
  });

  it('S4w (89.6-36): the held look ends with the spinner', () => {
    const plain = render(<Button>Save</Button>);
    const plainClass = (plain.container.querySelector('button') as HTMLButtonElement).className;
    plain.unmount();

    const { container, rerender } = render(<Button busy>Save</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS));
    rerender(<Button busy={false}>Save</Button>);
    // Busy has dropped, the Spinner is inside its hold: the look is still held.
    expect(spinnersIn(container)).toHaveLength(1);
    for (const token of BUSY_HELD_CLASSES.split(' ')) expect(tokens(button), `still held: ${token}`).toContain(token);

    act(() => vi.advanceTimersByTime(SPINNER_MIN_MS));
    expect(spinnersIn(container)).toHaveLength(0);
    expect(button.className).toBe(plainClass);
  });

  it("S4w (89.6-36): a caller's fixed class wins and asChild holds nothing", () => {
    const placed = render(
      <Button busy className="fixed bottom-4 right-4">
        Save
      </Button>
    );
    const placedButton = placed.container.querySelector('button') as HTMLButtonElement;
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS));
    expect(spinnersIn(placed.container)).toHaveLength(1);
    expect(tokens(placedButton)).toContain('fixed');
    expect(tokens(placedButton)).not.toContain('relative');
    placed.unmount();

    const slotted = render(
      <Button asChild busy>
        <a href="/x">Go</a>
      </Button>
    );
    const link = slotted.container.querySelector('a') as HTMLAnchorElement;
    act(() => vi.advanceTimersByTime(SPINNER_DELAY_MS + 1));
    for (const token of BUSY_HELD_CLASSES.split(' ')) expect(tokens(link), `asChild holds no ${token}`).not.toContain(token);
    expect(spinnersIn(slotted.container)).toHaveLength(0);
  });

  it('S4w (89.6-36): the two class strings, pinned', () => {
    expect(BUSY_HELD_CLASSES).toBe('relative [&>:not(.btn-busy-spinner)]:opacity-0');
    expect(BUSY_SPINNER_CLASSES).toBe('btn-busy-spinner absolute inset-0 m-auto');
  });
});
