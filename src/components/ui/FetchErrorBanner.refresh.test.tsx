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
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { Modal } from '@/app/components/Modal';
import {
  FetchErrorBanner,
  RefreshFailedNotice,
  SectionLoadFailedNotice,
  RetainedContentFocusGuard,
  useRetainedContent,
  isAccessOrGoneError,
} from './FetchErrorBanner';
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { getFetchErrorMessage, useFetchErrorState } from './useFetchErrorState';
import type { FetchErrorState, FetchErrorCode } from './useFetchErrorState';
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
  setRows?: (rows: string[]) => void;
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
  const [rows, setRows] = React.useState(['Ann']);
  if (controls) {
    controls.setFailed = setFailed;
    controls.setRows = setRows;
  }
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
          {rows.map((name) => (
            <li key={name}>
              <button type="button">{name}</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

const slot = () => screen.getByTestId('notice-slot');
/** The notice's visible sentence (the only span in the notice position). */
const visibleLine = () => slot().querySelector('span');

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

// ---------------------------------------------------------------------------
// Task 2 — the notice's Retry behaves like every house recovery control (plan 21's shapes, D1-D8
// and A1-A2 in useFetchErrorState.test.tsx), over a real TanStack query too, and a refresh nobody
// pressed never drops a focused retry control to the page body (C12 b).
// ---------------------------------------------------------------------------

// A TanStack harness for RN-11: the queryFn is driven from this module-level slot.
let rn11QueryFn: () => Promise<string[]> = () => Promise.resolve([]);

interface QueryHarnessProps {
  refetchRef: { current: (() => Promise<unknown>) | null };
}

function QueryHarness({ refetchRef }: QueryHarnessProps) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const query = useQuery({ queryKey: ['rn11-members'], queryFn: () => rn11QueryFn() });
  refetchRef.current = query.refetch;
  const errorState = useFetchErrorState(query);
  return (
    <main>
      <h1>Group page</h1>
      <section data-testid="rn11-section">
        <h2 ref={headingRef}>Members</h2>
        <RefreshFailedNotice state={errorState} retained={query.data !== undefined} focusTarget={headingRef} />
        {query.data ? (
          <ul>
            {query.data.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}

describe('RefreshFailedNotice — retry behaviour (plan 88.6.1-70)', () => {
  it('RN-4. two activations in one tick issue ONE retry; Retry stays focusable, aria-disabled, Retrying…, no flash', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    render(<NoticeHost retry={retry} />);
    const region = politeRegionIn(slot()) as HTMLElement;
    await user.tab();
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(document.activeElement).toBe(button);

    act(() => {
      button.click();
      button.click();
    });
    expect(retry, 'two presses in one tick issue exactly ONE retry').toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button, 'never the native gate').not.toHaveAttribute('disabled');
    expect(button).toHaveTextContent('Retrying…');
    // CONFIRM-ONLY in jsdom (C-11: jsdom never blurs a disabled element); the RED half is the
    // attributes and the call count above.
    expect(document.activeElement).toBe(button);
    expect(region.textContent, 'the region is quiet in flight').toBe('');
    expect(visibleLine()?.textContent, 'no visible flash').toBe(RF1);

    await act(async () => {
      pending[0].resolve({ isError: true });
    });
  });

  it('RN-5. three failed Retries in a row: the SAME region empties and refills with RF1 each time, never B1', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    render(<NoticeHost retry={retry} />);
    const region = politeRegionIn(slot()) as HTMLElement;
    const button = screen.getByRole('button', { name: 'Retry' });

    for (const round of [0, 1, 2]) {
      await user.click(button);
      expect(region.textContent, `failure ${round + 1}: emptied in flight`).toBe('');
      await act(async () => {
        pending[round].resolve({ isError: true });
      });
      await waitFor(() => expect(region.textContent, `failure ${round + 1}: refilled`).toBe(RF1));
      expect(politeRegionIn(slot()), `failure ${round + 1}: the SAME node`).toBe(region);
      expect(document.activeElement).toBe(button);
      expect(button).toHaveTextContent('Retry');
      expect(button).not.toHaveAttribute('aria-disabled');
    }
    expect(screen.queryByText(/still unavailable/i), 'never B1').toBeNull();
  });

  it('RN-6. the region stays empty for at least the dwell after the press, even when the failure is instant', async () => {
    // The floor is plan 21's exported dwell constant (AT-4, WebKit's emptyRegionSettleDelay).
    const { retry, pending } = pressableRetry();
    render(<NoticeHost retry={retry} />);
    const region = politeRegionIn(slot()) as HTMLElement;
    const button = screen.getByRole('button', { name: 'Retry' });

    const pressedAt = performance.now();
    await act(async () => {
      button.click();
      pending[0].resolve({ isError: true });
    });
    expect(region.textContent, 'empty right after an instant failure').toBe('');
    await waitFor(() => expect(region.textContent).toBe(RF1));
    expect(performance.now() - pressedAt).toBeGreaterThanOrEqual(REGION_EMPTY_DWELL_MS);
  });

  it('RN-7. a success whose state commits later never re-speaks RF1, and focus moves only after the notice leaves', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    const controls: HostControls = {};
    render(<NoticeHost retry={retry} controls={controls} />);
    const region = politeRegionIn(slot()) as HTMLElement;
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    const button = screen.getByRole('button', { name: 'Retry' });

    await user.click(button);
    await act(async () => {
      pending[0].resolve({ isError: false });
      // Past the dwell, so this checkpoint is about the outcome rule, not the dwell.
      await sleep(REGION_EMPTY_DWELL_MS + 50);
    });
    // Settled as a success; the committed state still shows the failure (the TanStack lag).
    expect(region.textContent, 'never refilled before the success commits').toBe('');
    expect(visibleLine()?.textContent, 'the line is still there').toBe(RF1);
    expect(document.activeElement, 'the pressed Retry keeps focus until the removal').toBe(button);

    act(() => controls.setFailed?.(false));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(visibleLine()).toBeNull();
    expect(region.textContent).toBe('');
  });

  it('RN-8. an unknown outcome re-speaks the sentence the screen still shows, never B1', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    render(<NoticeHost retry={retry} />);
    const region = politeRegionIn(slot()) as HTMLElement;

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(region.textContent).toBe('');
    await act(async () => {
      pending[0].resolve(undefined);
    });
    await waitFor(() => expect(region.textContent).toBe(RF1));
    expect(politeRegionIn(slot())).toBe(region);
    expect(screen.queryByText(/still unavailable/i)).toBeNull();
  });

  it('RN-9. nothing retained: a failure shows NOTHING here — one empty sr-only region, no text, no Retry', () => {
    const { retry } = pressableRetry();
    render(<NoticeHost retry={retry} initialFailed retained={false} />);
    const children = Array.from(slot().children);
    expect(children).toHaveLength(1);
    const region = children[0] as HTMLElement;
    expect(region.matches('[role="status"][aria-live="polite"]')).toBe(true);
    expect(region.textContent).toBe('');
    expect(region.classList.contains('sr-only')).toBe(true);
    expect(screen.queryByText(RF1)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('RN-10. healthy adds no box and no margin; shown, the consumer spacing is on the wrapper and the row wraps', () => {
    const { retry } = pressableRetry();
    const controls: HostControls = {};
    const { container } = render(
      <NoticeHost retry={retry} initialFailed={false} controls={controls} className="mb-4" />
    );
    expect(container.innerHTML, 'no spacing class while healthy').not.toContain('mb-4');

    act(() => controls.setFailed?.(true));
    const row = screen.getByRole('button', { name: 'Retry' }).parentElement as HTMLElement;
    expect(row.parentElement?.classList.contains('mb-4'), 'the consumer class is on the wrapper').toBe(true);
    expect(row.classList.contains('flex-wrap'), 'the row wraps').toBe(true);
    for (const el of Array.from(slot().querySelectorAll('*'))) {
      const tokens = (el.getAttribute('class') ?? '').split(/\s+/);
      expect(tokens).not.toContain('whitespace-nowrap');
      expect(tokens.some((t) => t.startsWith('w-[') || t.startsWith('min-w-['))).toBe(false);
    }
  });

  it('RN-11. over a real TanStack query that holds data, the notice, its Retry and focus stay put through a Retry', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const refetchRef: QueryHarnessProps['refetchRef'] = { current: null };
    rn11QueryFn = () => Promise.resolve(['Ann']);
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <QueryHarness refetchRef={refetchRef} />
      </QueryClientProvider>
    );
    try {
      await screen.findByText('Ann');
      const section = screen.getByTestId('rn11-section');
      const region = politeRegionIn(section) as HTMLElement;
      const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
      expect(region.textContent).toBe('');

      // A refetch fails: RF1 over the rows TanStack kept.
      rn11QueryFn = () => Promise.reject(new ApiError('x', 'internal', 500));
      await act(async () => {
        await refetchRef.current?.();
      });
      await waitFor(() => expect(region.textContent).toBe(RF1));
      expect(screen.getByText('Ann')).toBeInTheDocument();

      // A held Retry: TanStack keeps isError true because data exists, so the row stays mounted.
      const held = deferred<string[]>();
      rn11QueryFn = () => held.promise;
      const button = screen.getByRole('button', { name: 'Retry' });
      await user.click(button);
      await act(async () => {
        await sleep(0);
      });
      expect(button.isConnected, 'the row is still mounted while the refetch is held').toBe(true);
      expect(button).toHaveTextContent('Retrying…');
      expect(document.activeElement).toBe(button);

      await act(async () => {
        held.reject(new ApiError('x', 'internal', 500));
      });
      await waitFor(() => expect(region.textContent).toBe(RF1));
      expect(politeRegionIn(section)).toBe(region);
      expect(document.activeElement).toBe(button);
      expect(button).toHaveTextContent('Retry');

      // The next run succeeds: the row leaves and focus lands on the heading.
      const ok = deferred<string[]>();
      rn11QueryFn = () => ok.promise;
      await user.click(button);
      await act(async () => {
        ok.resolve(['Ann', 'Bo']);
      });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(screen.queryByRole('button', { name: /^(Retry|Retrying…)$/ })).toBeNull();
      expect(screen.getByText('Bo')).toBeInTheDocument();
    } finally {
      unmount();
      client.clear();
    }
  });

  it('RN-12. no focusTarget: a successful Retry lands focus on main h1, never <body>', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    render(<NoticeHost retry={retry} onResolved="clear" withTarget={false} />);
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'Group page' });

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      pending[0].resolve({ isError: false });
    });
    await waitFor(() => expect(document.activeElement).toBe(pageHeading));
  });

  it('RN-13. inside a dialog with no focusTarget, a successful Retry lands on the dialog title', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    function DialogNoticeHost() {
      const [failed, setFailed] = React.useState(true);
      const state: FetchErrorState = {
        showError: failed,
        message: 'boom',
        code: 'internal',
        retry: async () => {
          const result = await retry();
          setFailed(false);
          return result;
        },
      };
      return (
        <Modal open onClose={() => {}}>
          <Modal.Header>Members</Modal.Header>
          <Modal.Body>
            <RefreshFailedNotice state={state} retained />
            <ul>
              <li>Ann</li>
            </ul>
          </Modal.Body>
        </Modal>
      );
    }
    render(<DialogNoticeHost />);
    const title = screen.getByRole('heading', { name: 'Members' });

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      pending[0].resolve({ isError: false });
    });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('RN-14. mounted while a failure already shows: the region is EMPTY on the first commit, then filled after the dwell', async () => {
    const { retry } = pressableRetry();
    const mountedAt = performance.now();
    render(<NoticeHost retry={retry} initialFailed />);
    const region = politeRegionIn(slot()) as HTMLElement;
    expect(visibleLine()?.textContent, 'the line shows at once').toBe(RF1);
    expect(region.textContent, 'the region is empty on the first commit').toBe('');
    await waitFor(() => expect(region.textContent).toBe(RF1));
    expect(politeRegionIn(slot())).toBe(region);
    expect(performance.now() - mountedAt).toBeGreaterThanOrEqual(REGION_EMPTY_DWELL_MS);
    cleanup();

    // T-88.6.1-1405: an unmount inside the mount dwell leaves no late update behind. NOT
    // discriminating on its own (CF-55: React 18 removed the unmounted-setState warning); kept as
    // the threat register's check that no React warning fires.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = render(<NoticeHost retry={retry} initialFailed />);
      unmount();
      await sleep(REGION_EMPTY_DWELL_MS + 50);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('RN-15. an UNPRESSED refresh that succeeds while Retry holds focus lands focus on the heading, never <body>', async () => {
    const { retry } = pressableRetry();
    const controls: HostControls = {};
    render(<NoticeHost retry={retry} controls={controls} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    const button = screen.getByRole('button', { name: 'Retry' });

    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    // The tab-return re-attempt succeeded: nobody pressed Retry, the state clears, the row leaves.
    act(() => controls.setFailed?.(false));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(retry).not.toHaveBeenCalled();
  });

  it('RN-16. the plan-21 banners: an unpressed success that removes a focused Try again or Retry lands on main h1', async () => {
    const { retry } = pressableRetry();
    // (i) Full, caller-gated: the whole banner unmounts with the focused Try again.
    const fullControls: HostControls = {};
    function FullGatedHost() {
      const [failed, setFailed] = React.useState(true);
      fullControls.setFailed = setFailed;
      const state: FetchErrorState = { showError: true, message: 'boom', code: 'internal', retry };
      return (
        <main>
          <h1>Game night</h1>
          {failed && <FetchErrorBanner state={state} title="Couldn't load" />}
        </main>
      );
    }
    render(<FullGatedHost />);
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'Game night' });
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    act(() => tryAgain.focus());
    act(() => fullControls.setFailed?.(false));
    await waitFor(() => expect(document.activeElement).toBe(pageHeading));
    cleanup();

    // (ii) Compact, in-component: the banner stays, its row leaves with the focused Retry.
    const compactControls: HostControls = {};
    function CompactHost() {
      const [failed, setFailed] = React.useState(true);
      compactControls.setFailed = setFailed;
      const state: FetchErrorState = { showError: failed, message: 'boom', code: 'internal', retry };
      return (
        <main>
          <h1>Game night</h1>
          <FetchErrorBanner compact state={state} />
        </main>
      );
    }
    render(<CompactHost />);
    const pageHeading2 = screen.getByRole('heading', { level: 1, name: 'Game night' });
    const compactRetry = screen.getByRole('button', { name: 'Retry' });
    act(() => compactRetry.focus());
    act(() => compactControls.setFailed?.(false));
    await waitFor(() => expect(document.activeElement).toBe(pageHeading2));
    expect(retry).not.toHaveBeenCalled();
  });

  it('RN-17. a user who moved on from Retry to a row is never moved when that row is removed', async () => {
    const user = userEvent.setup();
    const { retry } = pressableRetry();
    const controls: HostControls = {};
    render(<NoticeHost retry={retry} controls={controls} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    const headingFocus = vi.fn();
    heading.addEventListener('focus', headingFocus);
    const button = screen.getByRole('button', { name: 'Retry' });

    act(() => button.focus());
    // One macrotask: the watch's settle takes effect (plan 04: settle lands one macrotask later),
    // as it would between a real focus and a later key press.
    await act(async () => {
      await sleep(0);
    });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ann' }));

    // The row is removed while the notice STAYS: not a withdrawal (C12 a), not the notice's to recover.
    act(() => controls.setRows?.([]));
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
    expect(headingFocus).not.toHaveBeenCalled();
    expect(visibleLine()?.textContent, 'the notice stays').toBe(RF1);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — an access or gone answer is never a refresh failure (C10), a withdrawal never drops
// focus to the page body (C12 a), and FetchErrorBanner takes the same optional focusTarget.
// Expected register lines are READ through getFetchErrorMessage, never typed.
// ---------------------------------------------------------------------------

/** Dispatch a visibilitychange with the document visible (useFetchErrorState.test.tsx's idiom). */
function fireVisible() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The test drives every load: reassign `next` before the load it should answer. */
interface LoadSource {
  next: () => Promise<string[]>;
}
const okLoad = (rows: string[]) => () => Promise.resolve(rows);
const failLoad = (err: unknown) => () => Promise.reject(err);

interface C10Controls {
  load?: () => Promise<unknown>;
}

/** The contract's hand-rolled adapter (C1-C5) and C10 derivation, shared by the C10 hosts. */
function useC10Adapter(source: LoadSource, controls?: C10Controls) {
  const [rows, setRows] = React.useState<string[]>([]);
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const load = async () => {
    try {
      const next = await source.next();
      setRows(next);
      setLoadedFor('g1');
      setError(null);
      return { isError: false };
    } catch (err) {
      // C1 + C2: the rows are never written on a failure; the thrown error itself is stored.
      setError(err);
      return { isError: true };
    }
  };
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const retry = React.useCallback(() => loadRef.current(), []);
  if (controls) controls.load = retry;
  React.useEffect(() => {
    void loadRef.current();
  }, []);
  const errorState = useFetchErrorState({
    isError: Boolean(error),
    error,
    refetch: retry,
  } as unknown as UseQueryResult);
  const retained = useRetainedContent(loadedFor === 'g1', errorState);
  return { rows, errorState, retained };
}

interface C10HostProps {
  source: LoadSource;
  controls?: C10Controls;
  guard?: boolean;
  inDialog?: boolean;
  targetInArm?: boolean;
}

function C10Host({ source, controls, guard = true, inDialog = false, targetInArm = false }: C10HostProps) {
  const { rows, errorState, retained } = useC10Adapter(source, controls);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const armHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const guardTarget = inDialog ? undefined : targetInArm ? armHeadingRef : headingRef;
  const content = (
    <>
      {guard ? <RetainedContentFocusGuard retained={retained} focusTarget={guardTarget} /> : null}
      {retained ? (
        <>
          {targetInArm ? <h3 ref={armHeadingRef}>Member list</h3> : null}
          <RefreshFailedNotice
            state={errorState}
            retained={retained}
            focusTarget={inDialog ? undefined : headingRef}
          />
          <ul>
            {rows.map((name) => (
              <li key={name}>
                <button type="button">{name}</button>
              </li>
            ))}
          </ul>
        </>
      ) : errorState.showError ? (
        <FetchErrorBanner state={errorState} title="Couldn't load members" />
      ) : (
        <p>Loading members</p>
      )}
    </>
  );
  if (inDialog) {
    return (
      <Modal open onClose={() => {}}>
        <Modal.Header>Members</Modal.Header>
        <Modal.Body>{content}</Modal.Body>
      </Modal>
    );
  }
  return (
    <main>
      <h1>Group page</h1>
      <section>
        <h2 ref={headingRef}>Members</h2>
        {content}
      </section>
      <button type="button">Elsewhere</button>
    </main>
  );
}

/** Some `role="alert"` on the page holds `text`. */
const alertHolding = (text: string) =>
  screen.getAllByRole('alert').some((el) => (el.textContent ?? '').includes(text));

// The 25 members of `ApiErrorCode` (src/lib/api.ts, anchor `export type ApiErrorCode =`).
const ALL_CODES: FetchErrorCode[] = [
  'unknown',
  'validation',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'token_invalid',
  'prompt_closed',
  'prompt_deadline_expired',
  'reminder_cooldown',
  'owner_of_active_groups',
  'account_deleted',
  'already_restored',
  'window_expired',
  'already_used',
  'invalid_token',
  'gone',
  'conflict',
  'already_member',
  'invite_pending',
  'not_provisioned',
  'unsupported_address',
  'internal',
  'network',
  'config',
];
const ACCESS_OR_GONE: FetchErrorCode[] = [
  'unauthorized',
  'forbidden',
  'not_found',
  'not_provisioned',
  'gone',
  'account_deleted',
  'invalid_token',
  'already_used',
  'window_expired',
  'token_invalid',
];

/** Render the C10 host, wait for the first load, then fail a refresh with a 500 (RF1 shows). */
async function renderWithRf1Shown(props: Omit<C10HostProps, 'source' | 'controls'> = {}) {
  const source: LoadSource = { next: okLoad(['Ann', 'Bo']) };
  const controls: C10Controls = {};
  const utils = render(<C10Host source={source} controls={controls} {...props} />);
  await screen.findByRole('button', { name: 'Ann' });
  source.next = failLoad(new ApiError('x', 'internal', 500));
  await act(async () => {
    await controls.load?.();
  });
  await waitFor(() => expect(screen.getAllByText(RF1).length).toBeGreaterThan(0));
  return { ...utils, source, controls };
}

describe('C10 — access or gone answers (plan 88.6.1-70, orchestrator F1)', () => {
  it('AG-1. the predicate is true for exactly the ten access or gone codes, only while showing, never without a code', () => {
    expect(ALL_CODES).toHaveLength(25);
    for (const code of ALL_CODES) {
      expect(isAccessOrGoneError({ showError: true, code }), code).toBe(ACCESS_OR_GONE.includes(code));
      expect(isAccessOrGoneError({ showError: false, code }), `${code} while healthy`).toBe(false);
    }
    expect(ALL_CODES.filter((code) => isAccessOrGoneError({ showError: true, code }))).toHaveLength(10);
    // The four wholesale useFetchErrorState mocks return a state with no code at all.
    const noCode = { showError: true } as unknown as Pick<FetchErrorState, 'showError' | 'code'>;
    expect(isAccessOrGoneError(noCode)).toBe(false);
  });

  it('AG-2. a 401 or a 403 refresh over kept rows: no RF1, no rows, the register line in an alert', async () => {
    for (const err of [new ApiError('x', 'unauthorized', 401), new ApiError('x', 'forbidden', 403)]) {
      const source: LoadSource = { next: okLoad(['Ann', 'Bo']) };
      const controls: C10Controls = {};
      render(<C10Host source={source} controls={controls} />);
      await screen.findByRole('button', { name: 'Ann' });
      source.next = failLoad(err);
      await act(async () => {
        await controls.load?.();
      });
      const line = getFetchErrorMessage(err);
      await waitFor(() => expect(alertHolding(line), err.code).toBe(true));
      expect(screen.queryByText(RF1), `${err.code}: never RF1`).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ann' }), `${err.code}: rows withdrawn`).toBeNull();
      cleanup();
    }
  });

  it('AG-3. a 500, a network failure and a code-less side-read Error keep the rows under RF1', async () => {
    const failures: unknown[] = [
      new ApiError('x', 'internal', 500),
      new ApiError('x', 'network', 0),
      // C11: a side read is stored code-less, so its code is `unknown`.
      new Error('side read failed'),
    ];
    for (const err of failures) {
      const source: LoadSource = { next: okLoad(['Ann', 'Bo']) };
      const controls: C10Controls = {};
      render(<C10Host source={source} controls={controls} />);
      await screen.findByRole('button', { name: 'Ann' });
      source.next = failLoad(err);
      await act(async () => {
        await controls.load?.();
      });
      await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
      expect(screen.getByRole('button', { name: 'Ann' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Bo' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('AG-4. after a 403 the next 500 still withdraws; a success restores; a later 500 is RF1 again', async () => {
    const user = userEvent.setup();
    const source: LoadSource = { next: okLoad(['Ann']) };
    const controls: C10Controls = {};
    render(<C10Host source={source} controls={controls} />);
    await screen.findByRole('button', { name: 'Ann' });

    const forbidden = new ApiError('x', 'forbidden', 403);
    source.next = failLoad(forbidden);
    await act(async () => {
      await controls.load?.();
    });
    await waitFor(() => expect(alertHolding(getFetchErrorMessage(forbidden))).toBe(true));

    // The full banner's Try again answers 500.
    const internal = new ApiError('x', 'internal', 500);
    source.next = failLoad(internal);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(alertHolding(getFetchErrorMessage(internal))).toBe(true));
    expect(screen.queryByRole('button', { name: 'Ann' }), 'the withdrawn rows stay withdrawn').toBeNull();
    expect(screen.queryByText(RF1)).toBeNull();

    // A success ends the memory.
    source.next = okLoad(['Ann']);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Ann' });
    expect(screen.queryByText(RF1)).toBeNull();

    // And a later transient failure is RF1 over the rows again.
    source.next = failLoad(new ApiError('x', 'internal', 500));
    await act(async () => {
      await controls.load?.();
    });
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Ann' })).toBeInTheDocument();
  });

  it('AG-12. a code the map does not hold fails CLOSED: it withdraws the rows, while a state with no code stays false', async () => {
    const mystery = 'mystery_code' as unknown as FetchErrorCode;
    expect(isAccessOrGoneError({ showError: true, code: mystery })).toBe(true);
    expect(isAccessOrGoneError({ showError: false, code: mystery })).toBe(false);
    const noCode = { showError: true } as unknown as Pick<FetchErrorState, 'showError' | 'code'>;
    expect(isAccessOrGoneError(noCode)).toBe(false);

    const source: LoadSource = { next: okLoad(['Ann']) };
    const controls: C10Controls = {};
    render(<C10Host source={source} controls={controls} />);
    await screen.findByRole('button', { name: 'Ann' });
    source.next = failLoad(new ApiError('x', mystery, 418));
    await act(async () => {
      await controls.load?.();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
    expect(screen.queryByText(RF1)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ann' })).toBeNull();
  });

  it('AG-13. after a 403 then a 500, a TanStack consumer that remounts over the cached 500 still shows no pre-403 rows', async () => {
    const key = ['ag13-members'];
    let queryFn: () => Promise<string[]> = () => Promise.resolve(['Ann']);
    const refetchRef: { current: (() => Promise<unknown>) | null } = { current: null };
    function TanStackConsumer() {
      const query = useQuery({ queryKey: key, queryFn: () => queryFn() });
      refetchRef.current = query.refetch;
      const errorState = useFetchErrorState(query);
      const retained = useRetainedContent(query.data !== undefined, errorState, { queryKey: key });
      return retained ? (
        <section>
          <RefreshFailedNotice state={errorState} retained={retained} />
          <ul>
            {(query.data ?? []).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      ) : errorState.showError ? (
        <FetchErrorBanner state={errorState} title="Couldn't load members" />
      ) : (
        <p>Loading members</p>
      );
    }
    // A gcTime that outlives the unmount-to-remount gap: gcTime 0 would drop the cached rows.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    const shell = (show: boolean) => (
      <QueryClientProvider client={client}>
        <main>{show ? <TanStackConsumer /> : null}</main>
      </QueryClientProvider>
    );
    const { rerender, unmount } = render(shell(true));
    try {
      await screen.findByText('Ann');

      const forbidden = new ApiError('x', 'forbidden', 403);
      queryFn = () => Promise.reject(forbidden);
      await act(async () => {
        await refetchRef.current?.();
      });
      await waitFor(() => expect(alertHolding(getFetchErrorMessage(forbidden))).toBe(true));
      expect(screen.queryByText('Ann')).toBeNull();

      const internal = new ApiError('x', 'internal', 500);
      queryFn = () => Promise.reject(internal);
      await act(async () => {
        await refetchRef.current?.();
      });
      await waitFor(() => expect(alertHolding(getFetchErrorMessage(internal))).toBe(true));
      expect(screen.queryByText('Ann')).toBeNull();

      // Unmount, then remount under the SAME client while the mount refetch is held.
      rerender(shell(false));
      const held = deferred<string[]>();
      queryFn = () => held.promise;
      rerender(shell(true));
      // Not vacuous: the cache still holds the pre-403 rows and the 500.
      expect(client.getQueryData(key)).toEqual(['Ann']);
      expect((client.getQueryState(key)?.error as ApiError | null)?.code).toBe('internal');
      await waitFor(() => expect(alertHolding(getFetchErrorMessage(internal))).toBe(true));
      expect(screen.queryByText('Ann'), 'no pre-403 rows after the remount').toBeNull();
      expect(screen.queryByText(RF1)).toBeNull();

      // A success brings the rows back.
      await act(async () => {
        held.resolve(['Ann']);
      });
      await screen.findByText('Ann');
    } finally {
      unmount();
      client.clear();
    }
  });

  it('AG-14. a source whose queryKey is undefined is NO source: it keeps its own rows beside a withdrawn TanStack consumer', async () => {
    const keyA = ['ag14-a'];
    let queryFnA: () => Promise<string[]> = () => Promise.resolve(['Ann']);
    const refetchRef: { current: (() => Promise<unknown>) | null } = { current: null };
    function ConsumerA() {
      const query = useQuery({ queryKey: keyA, queryFn: () => queryFnA() });
      refetchRef.current = query.refetch;
      const errorState = useFetchErrorState(query);
      const retained = useRetainedContent(query.data !== undefined, errorState, { queryKey: keyA });
      return (
        <section data-testid="consumer-a">
          {retained ? (
            <ul>
              {(query.data ?? []).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : errorState.showError ? (
            <FetchErrorBanner state={errorState} title="Couldn't load A" />
          ) : null}
        </section>
      );
    }
    const stateB: FetchErrorState = {
      showError: true,
      message: 'boom',
      code: 'internal',
      retry: () => Promise.resolve({ isError: true }),
    };
    function ConsumerB() {
      // The shape a test mock that omits a hook's queryKey field produces.
      const retained = useRetainedContent(true, stateB, { queryKey: undefined });
      return (
        <section data-testid="consumer-b">
          {retained ? (
            <>
              <RefreshFailedNotice state={stateB} retained={retained} />
              <ul>
                <li>Cy</li>
              </ul>
            </>
          ) : (
            <FetchErrorBanner state={stateB} title="Couldn't load B" />
          )}
        </section>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    const shell = (showB: boolean) => (
      <QueryClientProvider client={client}>
        <main>
          <ConsumerA />
          {showB ? <ConsumerB /> : null}
        </main>
      </QueryClientProvider>
    );
    const { rerender, unmount } = render(shell(false));
    try {
      await screen.findByText('Ann');
      const forbidden = new ApiError('x', 'forbidden', 403);
      queryFnA = () => Promise.reject(forbidden);
      await act(async () => {
        await refetchRef.current?.();
      });
      await waitFor(() => expect(alertHolding(getFetchErrorMessage(forbidden))).toBe(true));

      rerender(shell(true));
      const b = within(screen.getByTestId('consumer-b'));
      expect(b.getByText('Cy')).toBeInTheDocument();
      expect(b.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
      expect(b.queryByText("Couldn't load B")).toBeNull();
      const a = within(screen.getByTestId('consumer-a'));
      expect(a.queryByText('Ann')).toBeNull();
      expect(a.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    } finally {
      unmount();
      client.clear();
    }
  });

  it('AG-5. handed retained=true over a 403 anyway, the notice renders the house full banner, never RF1 and never silence', () => {
    const err = new ApiError('x', 'forbidden', 403);
    const state: FetchErrorState = {
      showError: true,
      message: getFetchErrorMessage(err),
      code: 'forbidden',
      retry: () => Promise.resolve({ isError: true }),
    };
    render(
      <main>
        <h1>Group page</h1>
        <div data-testid="notice-slot">
          <RefreshFailedNotice state={state} retained />
        </div>
        <ul>
          <li>Ann</li>
        </ul>
      </main>
    );
    expect(screen.queryByText(RF1)).toBeNull();
    const alert = within(slot()).getByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    expect(alert.textContent).toContain(getFetchErrorMessage(err));
    expect(slot().querySelectorAll('[role="status"][aria-live="polite"]'), 'one polite region, the banner one').toHaveLength(1);
  });

  it('AG-6. RF1 then a Retry answered 403: the retained branch leaves and focus lands on the heading (the notice own press arm)', async () => {
    const user = userEvent.setup();
    const { source } = await renderWithRf1Shown({ guard: false });
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    source.next = failLoad(new ApiError('x', 'forbidden', 403));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Ann' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('AG-7. an UNPRESSED refresh answered 403 or 401 withdraws the rows while a row holds focus: focus lands on the heading', async () => {
    for (const err of [new ApiError('x', 'forbidden', 403), new ApiError('x', 'unauthorized', 401)]) {
      const { source } = await renderWithRf1Shown();
      const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
      act(() => screen.getByRole('button', { name: 'Ann' }).focus());
      source.next = failLoad(err);
      // The tab-return re-attempt: nobody presses anything.
      await act(async () => {
        fireVisible();
      });
      await waitFor(() => expect(alertHolding(getFetchErrorMessage(err)), err.code).toBe(true));
      expect(screen.queryByRole('button', { name: 'Ann' })).toBeNull();
      await waitFor(() => expect(document.activeElement, err.code).toBe(heading));
      cleanup();
    }
  });

  it('AG-8. a user elsewhere when the withdrawal lands is never moved', async () => {
    const { source } = await renderWithRf1Shown();
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    const headingFocus = vi.fn();
    heading.addEventListener('focus', headingFocus);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus());
    const err = new ApiError('x', 'forbidden', 403);
    source.next = failLoad(err);
    await act(async () => {
      fireVisible();
    });
    await waitFor(() => expect(alertHolding(getFetchErrorMessage(err))).toBe(true));
    await act(async () => {});
    expect(document.activeElement).toBe(elsewhere);
    expect(headingFocus).not.toHaveBeenCalled();
  });

  it('AG-9. inside a dialog with no focusTarget, a withdrawn focused row lands focus on the dialog title', async () => {
    const { source } = await renderWithRf1Shown({ inDialog: true });
    const title = screen.getByRole('heading', { name: 'Members' });
    act(() => screen.getByRole('button', { name: 'Ann' }).focus());
    const err = new ApiError('x', 'forbidden', 403);
    source.next = failLoad(err);
    await act(async () => {
      fireVisible();
    });
    await waitFor(() => expect(alertHolding(getFetchErrorMessage(err))).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
  });

  it('AG-10. a focusTarget that went with the content falls through to the floor: main h1', async () => {
    const { source } = await renderWithRf1Shown({ targetInArm: true });
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'Group page' });
    act(() => screen.getByRole('button', { name: 'Ann' }).focus());
    const err = new ApiError('x', 'forbidden', 403);
    source.next = failLoad(err);
    await act(async () => {
      fireVisible();
    });
    await waitFor(() => expect(alertHolding(getFetchErrorMessage(err))).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(pageHeading));
  });

  it('AG-11. the position rule: one guard instance across two distinct returns swapped by the withdrawal', async () => {
    const instances = new Set<RetainedContentFocusGuard>();
    const trackGuard = (instance: RetainedContentFocusGuard | null) => {
      if (instance) instances.add(instance);
    };
    function TwoReturnHost({ source, controls }: { source: LoadSource; controls: C10Controls }) {
      const { rows, errorState, retained } = useC10Adapter(source, controls);
      if (retained) {
        return (
          <div data-testid="retained-view">
            <RetainedContentFocusGuard ref={trackGuard} retained={retained} />
            <RefreshFailedNotice state={errorState} retained={retained} />
            <ul>
              {rows.map((name) => (
                <li key={name}>
                  <button type="button">{name}</button>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      return (
        <div data-testid="banner-view">
          <RetainedContentFocusGuard ref={trackGuard} retained={retained} />
          {errorState.showError ? (
            <FetchErrorBanner state={errorState} title="Couldn't load the event" />
          ) : (
            <p>Loading the event</p>
          )}
        </div>
      );
    }
    const snapshot = vi.spyOn(RetainedContentFocusGuard.prototype, 'getSnapshotBeforeUpdate');
    try {
      const source: LoadSource = { next: okLoad(['Ann']) };
      const controls: C10Controls = {};
      render(
        <main>
          <h1>Event page</h1>
          <TwoReturnHost source={source} controls={controls} />
        </main>
      );
      const pageHeading = screen.getByRole('heading', { level: 1, name: 'Event page' });
      await screen.findByRole('button', { name: 'Ann' });
      source.next = failLoad(new ApiError('x', 'internal', 500));
      await act(async () => {
        await controls.load?.();
      });
      await waitFor(() => expect(screen.getAllByText(RF1).length).toBeGreaterThan(0));
      const ann = screen.getByRole('button', { name: 'Ann' });
      act(() => ann.focus());

      source.next = failLoad(new ApiError('x', 'forbidden', 403));
      await act(async () => {
        fireVisible();
      });
      await screen.findByTestId('banner-view');
      expect(screen.queryByTestId('retained-view')).toBeNull();
      expect(instances.size, 'one guard instance, updated, never remounted').toBe(1);
      expect(
        snapshot.mock.results.some((result) => result.value === ann),
        'the snapshot was taken before the DOM changed'
      ).toBe(true);
      await waitFor(() => expect(document.activeElement).toBe(pageHeading));
    } finally {
      snapshot.mockRestore();
    }
  });
});

describe('FetchErrorBanner — optional focusTarget (plan 88.6.1-70)', () => {
  it('FT-1. full, caller-gated: a successful Try again lands focus on the host target, not main h1', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    function GatedHost() {
      const [failed, setFailed] = React.useState(true);
      const headingRef = React.useRef<HTMLHeadingElement>(null);
      const state: FetchErrorState = {
        showError: true,
        message: 'boom',
        code: 'internal',
        retry: async () => {
          const result = await retry();
          setFailed(false);
          return result;
        },
      };
      return (
        <main>
          <h1>Page</h1>
          <section>
            <h2 ref={headingRef}>Members</h2>
            {failed && <FetchErrorBanner state={state} title="Couldn't load" focusTarget={headingRef} />}
          </section>
        </main>
      );
    }
    render(<GatedHost />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      pending[0].resolve({ isError: false });
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('FT-2. compact, in-component: a successful Retry lands focus on the host target', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    function CompactTargetHost() {
      const [failed, setFailed] = React.useState(true);
      const headingRef = React.useRef<HTMLHeadingElement>(null);
      const state: FetchErrorState = {
        showError: failed,
        message: 'boom',
        code: 'internal',
        retry: async () => {
          const result = await retry();
          setFailed(false);
          return result;
        },
      };
      return (
        <main>
          <h1>Page</h1>
          <section>
            <h2 ref={headingRef}>Members</h2>
            <FetchErrorBanner compact state={state} focusTarget={headingRef} />
          </section>
        </main>
      );
    }
    render(<CompactTargetHost />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Members' });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      pending[0].resolve({ isError: false });
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('FT-3. a focusTarget whose ref is null falls through to the floor: main h1, never <body>', async () => {
    const user = userEvent.setup();
    const { retry, pending } = pressableRetry();
    function NullTargetHost() {
      const [failed, setFailed] = React.useState(true);
      // Never attached: the heading it would point at is not rendered.
      const missingRef = React.useRef<HTMLHeadingElement>(null);
      const state: FetchErrorState = {
        showError: true,
        message: 'boom',
        code: 'internal',
        retry: async () => {
          const result = await retry();
          setFailed(false);
          return result;
        },
      };
      return (
        <main>
          <h1>Page</h1>
          {failed && <FetchErrorBanner state={state} title="Couldn't load" focusTarget={missingRef} />}
        </main>
      );
    }
    render(<NullTargetHost />);
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'Page' });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      pending[0].resolve({ isError: false });
    });
    await waitFor(() => expect(document.activeElement).toBe(pageHeading));
  });
});
