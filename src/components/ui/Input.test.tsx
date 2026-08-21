// Contract pins for the <Input> / <Textarea> / <SelectControl> primitives
// (Req 1 — the iOS focus-zoom blocker, UI-SPEC §8.2).
//
// The pins here are about the CONTRACT the adoption plans depend on, not styling taste:
//   1. 16px (`text-base`) at EVERY breakpoint — never a smaller size, never a `md:` size
//      variant. Below 16px iOS Safari focus-zooms the page on tap; that is the whole
//      reason this primitive exists.
//   2. `focus-visible` ring only — a bare `focus:` ring fires on mouse/programmatic focus
//      too (UI-SPEC §7.2).
//   3. All three are `forwardRef` and spread unknown props onto the DOM node. This is
//      NON-NEGOTIABLE: `FormField` injects `id`/`aria-invalid`/`aria-describedby` via
//      `React.cloneElement`, so a component that swallowed props would silently drop the
//      whole label/error a11y contract.
//   4. Composition, not duplication — the label/error/aria wiring stays in `FormField`.
//   5. axe-clean inside `FormField`.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { FormField } from '@/app/components/form/FormField';
import { Input, Textarea, SelectControl, controlClass } from './Input';

afterEach(cleanup);

describe('Input', () => {
  it('renders an <input> sized at 16px (text-base)', () => {
    render(<Input aria-label="Group name" />);
    const input = screen.getByLabelText('Group name');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveClass('text-base');
  });

  it('never carries a smaller-than-16px size, and never a breakpoint size variant', () => {
    // A `md:text-*` variant would reintroduce the iOS zoom below `md`, which is
    // exactly the breakpoint where phones live.
    expect(controlClass).not.toMatch(/(^|[\s:])text-(xs|sm)\b/);
    expect(controlClass).not.toMatch(/\b(sm|md|lg|xl):text-/);
  });

  it('uses a focus-visible ring and no bare focus: ring/border/bg utility', () => {
    expect(controlClass).toContain('focus-visible:ring-2');
    expect(controlClass).toContain('focus-visible:ring-focus-ring');
    expect(controlClass).not.toMatch(/(^|\s)focus:(ring|border|bg)/);
  });

  it('carries the 44px touch floor at phone widths', () => {
    render(<Input aria-label="Group name" />);
    expect(screen.getByLabelText('Group name')).toHaveClass('max-md:min-h-11');
  });

  it('forwards a ref to the DOM node', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input aria-label="Group name" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByLabelText('Group name'));
  });

  it('spreads unknown props (id / aria-* / register()) onto the DOM node', () => {
    render(
      <Input
        aria-label="Group name"
        id="group-name"
        name="groupName"
        aria-invalid="true"
        aria-describedby="group-name-error"
        placeholder="Board Game Club"
      />
    );
    const input = screen.getByLabelText('Group name');
    expect(input).toHaveAttribute('id', 'group-name');
    expect(input).toHaveAttribute('name', 'groupName');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'group-name-error');
    expect(input).toHaveAttribute('placeholder', 'Board Game Club');
  });

  it('merges a caller className over the control classes', () => {
    render(<Input aria-label="Group name" className="w-full" />);
    expect(screen.getByLabelText('Group name')).toHaveClass('w-full');
  });

  it('renders ONLY the control — no label and no error node of its own', () => {
    const { container } = render(<Input aria-label="Group name" />);
    expect(container.querySelector('label')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Textarea', () => {
  it('renders a <textarea> at 16px and forwards a ref', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea aria-label="Notes" ref={ref} />);
    const el = screen.getByLabelText('Notes');
    expect(el.tagName).toBe('TEXTAREA');
    expect(el).toHaveClass('text-base');
    expect(ref.current).toBe(el);
  });
});

describe('SelectControl', () => {
  it('renders a <select> at 16px, forwards a ref, and renders its options', () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(
      <SelectControl aria-label="Color" ref={ref} defaultValue="red">
        <option value="red">Red</option>
        <option value="blue">Blue</option>
      </SelectControl>
    );
    const el = screen.getByLabelText('Color');
    expect(el.tagName).toBe('SELECT');
    expect(el).toHaveClass('text-base');
    expect(ref.current).toBe(el);
    expect(screen.getByRole('option', { name: 'Red' })).toBeInTheDocument();
  });
});

describe('Input composed inside FormField', () => {
  it('receives the cloneElement-injected id so the visible label points at it', () => {
    render(
      <FormField label="Group name">
        <Input />
      </FormField>
    );
    const input = screen.getByLabelText('Group name');
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toBeTruthy();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('receives the injected aria-invalid + aria-describedby pointing at the error node', () => {
    render(
      <FormField label="Group name" error="Group name is required">
        <Input />
      </FormField>
    );
    const input = screen.getByLabelText('Group name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Group name is required');
    expect(alert.id).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('keeps a caller-supplied aria-describedby alongside the injected error id', () => {
    render(
      <FormField label="Group name" error="Group name is required">
        <Input aria-describedby="group-name-hint" />
      </FormField>
    );
    const input = screen.getByLabelText('Group name');
    const alert = screen.getByRole('alert');
    expect(input.getAttribute('aria-describedby')).toBe(
      `group-name-hint ${alert.id}`
    );
  });

  it('passes an axe audit with a visible label', async () => {
    const { container } = render(
      <FormField label="Group name">
        <Input />
      </FormField>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('passes an axe audit in the errored state', async () => {
    const { container } = render(
      <FormField label="Group name" error="Group name is required">
        <Input />
      </FormField>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
