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
import { Button } from './Button';
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
    // The visible label never changes: the only visible text node is the label.
    const visible = Array.from(button.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('');
    expect(visible).toBe('Save');
    expect(button.getAttribute('aria-disabled')).toBe('true');
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
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(link.textContent).toBe('Go');
  });

  it('Modal.Action forwards busy to Button', () => {
    const { container } = render(<Modal.Action busy>Save Changes</Modal.Action>);
    const button = screen.getByRole('button', { name: 'Save Changes, saving' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
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
    const visible = Array.from(button.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('');
    expect(visible).toBe('Save');
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
