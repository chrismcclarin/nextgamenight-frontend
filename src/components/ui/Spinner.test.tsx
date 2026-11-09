// Contract pins for the house Spinner and the Button busy affordance (plan 88.9-24,
// owner pick O16a, save-feedback rule 1; owner ruling Q6(b) 2026-11-08).
//
// The spinner is ONE typed primitive carrying the byte-identical class string of the
// three shipped copies; a busy Button keeps its label, shows that spinner, is
// aria-disabled (the gated colour pair is the dim) and is named '<label>, saving'
// (or '<label>, <its own verb>' through busySuffix). busy never swallows the press:
// each site's own refusal latch stays the refusal.
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '@/app/components/Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';

afterEach(cleanup);

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
