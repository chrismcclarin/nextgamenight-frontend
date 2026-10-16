// RefreshFailedNotice, SectionLoadFailedNotice, the access-or-gone rule (C10), the withdrawal
// focus guard (C12) and the optional focusTarget on FetchErrorBanner — plan 88.6.1-70.
//
// Testing rules this suite follows (.planning/codebase/FE-TESTING-CONVENTIONS.md): comments are
// line comments only (CF-9); waits are for a POSITIVE signal, and an absence is asserted only
// after a deterministic flush (CF-26); focus is asserted against a NAMED node (C-5); a live
// region is captured BEFORE the outcome and asserted to be the SAME node after it (C-6); the
// in-flight gate is pinned by attributes and a call count, never a blur (C-11); TanStack hosts
// wait for the commit one macrotask after the refetch resolves (C-12).
//
// THE LATER COMMIT IS DRIVEN BY HAND where an arm pins "after the settle, before the commit"
// (plan 21's technique, useFetchErrorState.test.tsx block header): React's async act yields a
// macrotask while it drains, so a zero-delay timer in the host could land inside the act. The
// host exposes `controls.setFailed` and the test releases the commit after the settle.
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FetchErrorBanner,
  RefreshFailedNotice,
  SectionLoadFailedNotice,
} from './FetchErrorBanner';
import { getFetchErrorMessage } from './useFetchErrorState';
import type { FetchErrorState } from './useFetchErrorState';
import { ApiError } from '@/lib/api';

afterEach(() => cleanup());

// Copy row RF1, D-47 (owner-ratified 2026-10-05). The ONE place this suite writes the sentence;
// the component owns its own constant (D-30), so this is the byte-equality check against it.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

/** A promise whose settlement the test drives. */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
type Deferred = ReturnType<typeof deferred>;

/** A retry that hands back a fresh deferred on every call, so each press is driven separately. */
function pressableRetry() {
  const pending: Deferred[] = [];
  const retry = vi.fn(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  return { retry, pending };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The one polite region inside an element. */
const politeRegionIn = (el: Element) =>
  el.querySelector('[role="status"][aria-live="polite"]') as HTMLElement | null;

interface HostControls {
  setFailed?: (failed: boolean) => void;
}

interface NoticeHostProps {
  retry: () => Promise<unknown>;
  initialFailed?: boolean;
  retained?: boolean;
  // What the host does once the retry's promise resolves: 'clear' (the success commits with the
  // settle) or 'none' (the state is kept, or the test commits later through `controls`).
  onResolved?: 'clear' | 'none';
  controls?: HostControls;
  withTarget?: boolean;
  className?: string;
}

// The contract's usage shape, cut down: a section heading the notice hands focus to, the notice
// above the retained rows, each row a focusable control. Every failing state is `internal` (a 500)
// so the access-or-gone rule (Task 3) never changes these arms.
function NoticeHost({
  retry,
  initialFailed = true,
  retained = true,
  onResolved = 'none',
  controls,
  withTarget = true,
  className,
}: NoticeHostProps) {
  const [failed, setFailed] = React.useState(initialFailed);
  if (controls) controls.setFailed = setFailed;
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const state: FetchErrorState = {
    showError: failed,
    message: 'boom',
    code: 'internal',
    retry: async () => {
      const result = await retry();
      if (onResolved === 'clear') setFailed(false);
      return result;
    },
  };
  return (
    <main>
      <h1>Group page</h1>
      <section>
        <h2 ref={headingRef}>Members</h2>
        <div data-testid="notice-slot">
          <RefreshFailedNotice
            state={state}
            retained={retained}
            focusTarget={withTarget ? headingRef : undefined}
            className={className}
          />
        </div>
        <ul>
          <li>
            <button type="button">Ann</button>
          </li>
        </ul>
      </section>
    </main>
  );
}

const slot = () => screen.getByTestId('notice-slot');

describe('RefreshFailedNotice — tracer (plan 88.6.1-70, RF1 / D-47)', () => {
  it('RN-1. healthy: exactly one EMPTY sr-only polite region, nothing visible, the rows render', () => {
    const { retry } = pressableRetry();
    render(<NoticeHost retry={retry} initialFailed={false} />);
    const children = Array.from(slot().children);
    expect(children, 'one element in the notice position').toHaveLength(1);
    const region = children[0] as HTMLElement;
    expect(region.matches('[role="status"][aria-live="polite"]')).toBe(true);
    expect(region.textContent).toBe('');
    expect(region.classList.contains('sr-only')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(RF1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ann' })).toBeInTheDocument();
  });

  it('RN-2. a failed refresh is a CHANGE to the same region node, plus the visible line and Retry', () => {
    const { retry } = pressableRetry();
    const controls: HostControls = {};
    render(<NoticeHost retry={retry} initialFailed={false} controls={controls} />);
    const region = politeRegionIn(slot());
    expect(region).not.toBeNull();

    act(() => controls.setFailed?.(true));
    expect(politeRegionIn(slot()), 'the SAME region node').toBe(region);
    expect(region?.textContent).toBe(RF1);
    expect(screen.getAllByText(RF1), 'one constant, two carriers').toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ann' }), 'the retained rows stay').toBeInTheDocument();
  });

  it('RN-3. a successful Retry removes the notice and lands focus on the host heading, never <body>', async () => {
    // The console.error spy is NOT discriminating on its own (CF-55: React 18 removed the
    // unmounted-setState warning); it is kept as the threat register's T-88.6.1-1405 check that
    // no other React warning fires across a press, a removal and an unmount.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const { retry, pending } = pressableRetry();
      const { unmount } = render(<NoticeHost retry={retry} onResolved="clear" />);
      const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
      const region = politeRegionIn(slot());

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await act(async () => {
        pending[0].resolve({ isError: false });
      });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(screen.queryByRole('button', { name: /^(Retry|Retrying…)$/ })).toBeNull();
      expect(politeRegionIn(slot())).toBe(region);
      expect(region?.textContent).toBe('');

      unmount();
      await sleep(150);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('RN-18. every small-notice Retry is described by its own row sentence (#339)', () => {
    // (i) RF1's Retry.
    const { retry } = pressableRetry();
    render(<NoticeHost retry={retry} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(RF1);
    cleanup();

    // (ii) The compact identity notice's Retry: the sentence is read from the rendered row.
    const failing: FetchErrorState = {
      showError: true,
      message: 'boom',
      code: 'internal',
      retry: () => Promise.resolve(undefined),
    };
    const { container } = render(<FetchErrorBanner compact state={failing} />);
    const region = politeRegionIn(container) as HTMLElement;
    const rowSentence = region.nextElementSibling?.firstElementChild?.textContent ?? '';
    expect(rowSentence.length, 'the row renders a sentence').toBeGreaterThan(0);
    expect(rowSentence).not.toBe(RF1);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(rowSentence);
  });

  it('RN-19. SectionLoadFailedNotice shows the caller register line, re-announced after a failed Retry, never the identity line or B1', async () => {
    const user = userEvent.setup();
    const msg = getFetchErrorMessage(new ApiError('Network', 'network', 0));
    const { retry, pending } = pressableRetry();
    const controls: HostControls = {};
    function SectionHost() {
      const [failed, setFailed] = React.useState(false);
      controls.setFailed = setFailed;
      const state: FetchErrorState = { showError: failed, message: msg, code: 'network', retry };
      return (
        <main data-testid="section-host">
          <h2>Reviews</h2>
          <SectionLoadFailedNotice state={state} />
        </main>
      );
    }
    render(<SectionHost />);
    const host = screen.getByTestId('section-host');

    // (i) Healthy: one empty sr-only region, no Retry.
    const regions = host.querySelectorAll('[role="status"][aria-live="polite"]');
    expect(regions).toHaveLength(1);
    const region = regions[0] as HTMLElement;
    expect(region.textContent).toBe('');
    expect(region.classList.contains('sr-only')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    // (ii) The read fails: the SAME node carries the caller's line, twice on the page.
    act(() => controls.setFailed?.(true));
    await waitFor(() => expect(region.textContent).toBe(msg));
    expect(politeRegionIn(host)).toBe(region);
    expect(screen.getAllByText(msg)).toHaveLength(2);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(button).toHaveAccessibleDescription(msg);
    expect(screen.queryByText(/personal controls/i), 'never the identity line').toBeNull();

    // (iii) A failed Retry: emptied in flight, then the SAME sentence again, focus kept.
    await user.click(button);
    expect(region.textContent, 'emptied from the press').toBe('');
    await act(async () => {
      pending[0].resolve({ isError: true });
    });
    await waitFor(() => expect(region.textContent).toBe(msg));
    expect(politeRegionIn(host)).toBe(region);
    expect(screen.queryByText(/still unavailable/i), 'never B1').toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button).toHaveTextContent('Retry');
    expect(button).not.toHaveAttribute('aria-disabled');
  });
});
