// Contract pins for <ErrorFallback> — the ONE error look (Req 3 / D-20), extracted
// from AppErrorBoundary's shipped JSX so 9 route boundaries reuse it in plan 88-09.
//
// The pins are about the contract the 9 adopters depend on:
//   1. it announces: role="alert" + aria-live="assertive" on the wrapper
//   2. "Try again" / "Reload page" call the caller's handlers
//   3. `loopGuardTripped` hides the retry affordance and swaps the copy — the
//      reset COUNTER stays owned by the caller (it must survive a reset)
//   4. it renders DESIGNED COPY ONLY: no error object, digest, stack or backend
//      message ever reaches the DOM (T-88-04-01 / ASVS V7)
//   5. the borders use `border-line-strong`, which actually resolves — the
//      extracted-from source used `border-strong`, which is not a token
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ErrorFallback } from './ErrorFallback';

afterEach(cleanup);

describe('ErrorFallback', () => {
  it('announces assertively as an alert', () => {
    render(<ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toBeInTheDocument();
  });

  it('renders the designed heading and both affordances by default', () => {
    render(<ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />);
    expect(
      screen.getByRole('heading', { name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reload page' })
    ).toBeInTheDocument();
  });

  // Plan 88.6-36 task 2 (D-05). THE ANTI-GROWTH PIN — this is the assertion that stops a future
  // "consistency" pass growing this heading to Display.
  //
  // WHY 20 AND NOT 30, in the one place a reader will look for it: `<h1>` is the document
  // OUTLINE (this is the only heading on a crashed boundary) and 20 is the type ROLE. They are
  // different facts, which is exactly what `Heading`'s two independent props express and what
  // this file has been the shipped precedent for since 88-04. `typeScaleTouchedSurfaces.test.ts`'s
  // 30/700 Display assertion is scoped to `PAGE_SURFACES` for this reason and its own comment
  // says so: growing THIS `<h1>` to `text-3xl` "would be that exact demotion in reverse, on nine
  // error boundaries at once".
  //
  // The `text-3xl` half is a NEGATIVE assertion and is therefore paired with the positive
  // `text-xl` one — a bare not-`text-3xl` would stay green if the heading vanished entirely.
  it('renders the heading through Heading at level 1 and size 20 — never grown to Display', () => {
    render(<ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />);
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Something went wrong',
    });
    expect(heading.tagName).toBe('H1');
    expect(heading, 'the 20px Heading rung').toHaveClass('text-xl');
    expect(heading, 'the 30px Display rung is the rejected alternative — see 88-29').not.toHaveClass(
      'text-3xl'
    );
    // Supplied by Heading's cva base, so this arm also proves the element is the PRIMITIVE and
    // not a raw tag that happens to carry the same size. It is RED against the pre-migration
    // `<h1 className="text-xl font-bold text-content-primary">`.
    expect(heading, '700 from the primitive base, not from the call site').toHaveClass('font-bold');
    expect(heading, 'wrap utility from the primitive base').toHaveClass('wrap-anywhere');
    expect(heading).toHaveClass('leading-tight');
    expect(heading).toHaveClass('text-content-primary');
  });

  // Plan 88.6-36 task 2 (D-03 / UI-SPEC §4.5). The two affordances are raw `<button>`s by
  // D-20's recorded decision, so their `font-medium` was LIVE, not dead-on-a-`.btn`. It deletes
  // to 400 and the 14px control-label rung STAYS. Class-level, because jsdom performs no layout
  // and loads no stylesheet: a computed `fontWeight` here reads the UA default before and after
  // and would prove nothing (the D28 rule).
  it('carries no off-scale weight on either affordance, and keeps the 14px control rung', () => {
    render(<ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />);
    for (const name of ['Try again', 'Reload page']) {
      const button = screen.getByRole('button', { name });
      expect(button, `${name}: 500 is a §4.5 prohibition outside Button`).not.toHaveClass(
        'font-medium'
      );
      expect(button, `${name}: 600 likewise`).not.toHaveClass('font-semibold');
      expect(button, `${name}: the control-label rung is unchanged`).toHaveClass('text-sm');
    }
  });

  // Plan 88.6-36 task 2 (D49-b, owner ruling 2026-09-09 option i). The card's elevation is the
  // PROJECT tier, not Tailwind's alias-spelled built-in. `shadowTier.test.ts` scans the source
  // tree-wide; this arm pins the RENDERED element, so the class cannot be moved onto a wrapper
  // the source scan still counts as this file's.
  it('elevates the card on the project shadow tier, never the alias-spelled built-in', () => {
    const { container } = render(<ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />);
    const card = container.querySelector('.rounded-card');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('shadow-theme-lg');
    expect(card, 'the built-in inlines a cold black literal in BOTH themes').not.toHaveClass(
      'shadow-lg'
    );
  });

  it('calls onRetry when "Try again" is pressed', async () => {
    const onRetry = vi.fn();
    render(<ErrorFallback onRetry={onRetry} onReload={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onReload when "Reload page" is pressed', async () => {
    const onReload = vi.fn();
    render(<ErrorFallback onRetry={vi.fn()} onReload={onReload} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('hides the retry affordance once loopGuardTripped, keeping the escape hatch', () => {
    render(
      <ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} loopGuardTripped />
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Reload page' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The problem is still happening/)
    ).toBeInTheDocument();
  });

  it('omits retry entirely when no onRetry handler is supplied', () => {
    render(<ErrorFallback onReload={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('renders designed copy only — no digest, stack or backend message leaks', () => {
    const { container } = render(
      <ErrorFallback
        onRetry={vi.fn()}
        onReload={vi.fn()}
        title="We could not load this group"
        body="Try again in a moment."
      />
    );
    expect(
      screen.getByRole('heading', { name: 'We could not load this group' })
    ).toBeInTheDocument();
    expect(screen.getByText('Try again in a moment.')).toBeInTheDocument();
    // the DOM carries nothing that looks like machine detail
    expect(container.textContent).not.toMatch(
      /digest|stack|at\s+\w+\s+\(|Error:/i
    );
    expect(container.querySelector('pre')).toBeNull();
  });

  it('uses border-line-strong, never the non-resolving border-strong', () => {
    const { container } = render(
      <ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />
    );
    const classes = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .map((el) => el.className)
      .join(' ');
    expect(classes).toMatch(/border-line-strong/);
    expect(classes).not.toMatch(/(^|\s)border-strong(\s|$)/);
  });

  it('keeps the focus-visible ring on both affordances', () => {
    render(<ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />);
    for (const name of ['Try again', 'Reload page']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).toMatch(/focus-visible:ring-2/);
      expect(btn.className).toMatch(/focus-visible:outline-hidden/);
    }
  });

  it('passes an axe audit with no violations', async () => {
    const { container } = render(
      <ErrorFallback onRetry={vi.fn()} onReload={vi.fn()} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
