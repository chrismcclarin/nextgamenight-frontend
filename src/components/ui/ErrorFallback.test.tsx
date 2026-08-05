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
