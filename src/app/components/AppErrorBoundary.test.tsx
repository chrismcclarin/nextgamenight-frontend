// GUARD-01 forced-throw evidence (Plan 86-09, Task 2 automated discharge).
//
// This exercises the AppErrorBoundary fallback contract that Plan 86-08 built:
// a render-time throw below the boundary must render the STYLED fallback (not a
// blank page) with a working "Try again" + "Reload page", auto-report to Sentry,
// and trip the reset-loop guard after MAX_RESET_ATTEMPTS so "Try again" is hidden.
//
// `@sentry/nextjs` is mocked with a faithful minimal ErrorBoundary (catch ->
// captureException -> render `fallback({ resetError })`; resetError clears the
// errored state) so the test drives OUR fallback JSX + reset-loop guard, and can
// assert the Sentry auto-report is wired without initializing the real SDK.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the (also-hoisted) vi.mock factory below can reference it.
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => {
  type FallbackRender = (args: { resetError: () => void; error: unknown }) => React.ReactNode;
  class ErrorBoundary extends React.Component<
    { children: React.ReactNode; fallback: FallbackRender },
    { error: unknown }
  > {
    state = { error: null as unknown };
    static getDerivedStateFromError(error: unknown) {
      return { error };
    }
    componentDidCatch(error: unknown) {
      // Mirrors @sentry/nextjs ErrorBoundary's built-in auto-report.
      captureException(error);
    }
    resetError = () => this.setState({ error: null });
    render() {
      if (this.state.error != null) {
        return this.props.fallback({ resetError: this.resetError, error: this.state.error });
      }
      return this.props.children;
    }
  }
  return { ErrorBoundary, captureException };
});

import AppErrorBoundary from './AppErrorBoundary';

// A child that throws on render while `shouldThrow` is true. Kept as a mutable
// module flag so "Try again" (resetError) can re-mount it and it throws again,
// exercising the reset-loop guard.
let shouldThrow = true;
function Boom() {
  if (shouldThrow) throw new Error('forced provider render throw');
  return <div>recovered content</div>;
}

beforeEach(() => {
  shouldThrow = true;
  captureException.mockClear();
});
afterEach(cleanup);

describe('AppErrorBoundary — GUARD-01 forced-throw fallback', () => {
  it('renders the styled fallback (not a blank page) with both action buttons on a render throw', () => {
    // Silence React's expected error-boundary console noise for this throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );
    spy.mockRestore();

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    // Auto-report to Sentry is wired.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('reset-loop guard hides "Try again" after MAX_RESET_ATTEMPTS, leaving only "Reload page"', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );

    // Two "Try again" clicks (MAX_RESET_ATTEMPTS = 2) with the error still firing.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    spy.mockRestore();

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.getByText(/please reload the page/i)).toBeInTheDocument();
  });
});
