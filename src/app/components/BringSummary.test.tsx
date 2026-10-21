// quick-261021-ffb — the FIRST unit test BringSummary has ever had.
//
// Owner suggestion 2026-10-21 (`.planning/deferred/phase-91.3.md`, "Games to Bring has no visible way back
// in once you are a Yes"): a Yes who closed Games to Bring without choosing had no way back except Maybe then
// Yes, because the only other door ("Edit") showed only to someone who already had brings, and the whole
// section was absent when nobody brought anything. These tests pin the fix:
//
//   - GB-1: after a successful read the section always renders, with the line
//     "No one has said what they're bringing yet." when nobody brings anything (BS-1, BS-7, BS-8);
//   - GB-2: ONE control for a Yes — `Add games` with no brings, `Edit` with brings — both calling
//     onEditClick (BS-2..BS-6); a known Maybe / Can't sees none; an unknown RSVP keeps today's Edit;
//     no control while identity is unresolved (Phase 87.3-04);
//   - no blink: during a refetch the last loaded content AND the same control node stay mounted (BS-11),
//     because the picker returns focus to that node; nothing before the first read settles (BS-10), after
//     a failed read (BS-9, BS-12), or while a read for a DIFFERENT event is pending (BS-13).
//
// Harness per `BringGamePicker.test.tsx` (the hoisted API mock spread into `eventBringsAPI`, the REAL
// `errCtx`, a spied `logger.info`). `next/link` and `Heading` stay real.
import * as React from 'react';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_ID_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const GROUP_ID = '99999999-9999-4999-8999-999999999999';

// The owner's ruled words (2026-10-21), typed as literals so a constant edit moves this test.
const ADD_GAMES = 'Add games';
const NOBODY_LINE = "No one has said what they're bringing yet.";

const MY_BRINGS = [
  { game_id: 'g1', User: { id: SELF_ID, username: 'Me' }, Game: { name: 'Azul' } },
];
const OTHER_BRINGS = [
  { game_id: 'g2', User: { id: OTHER_ID, username: 'Sam' }, Game: { name: 'Catan' } },
];

const api = vi.hoisted(() => ({ getEventBrings: vi.fn() }));
const loggerSpies = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    eventBringsAPI: { ...actual.eventBringsAPI, getEventBrings: api.getEventBrings },
  };
});

vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  // `errCtx` is the REAL one: the breadcrumb assertion is about what the call site passes.
  return { ...actual, logger: { ...actual.logger, info: loggerSpies.info } };
});

import BringSummaryJs from './BringSummary';

// JS component: the inferred prop type marks every prop required. Cast so the harness passes
// only what it exercises (the BringGamePicker.test idiom).
const BringSummary = BringSummaryJs as unknown as React.ComponentType<Record<string, unknown>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const onEditClick = vi.fn();

function props(overrides: Record<string, unknown> = {}) {
  return {
    eventId: EVENT_ID,
    groupId: GROUP_ID,
    self: { id: SELF_ID },
    refreshKey: 0,
    onEditClick,
    userRsvpStatus: 'yes',
    ...overrides,
  };
}

/** Flush the read's promise chain so a settled read has rendered (or rendered nothing). */
async function flushRead() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  api.getEventBrings.mockReset();
  loggerSpies.info.mockReset();
  onEditClick.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('BringSummary — always present after a successful read (GB-1, quick-261021-ffb)', () => {
  it('BS-1: a successful read of [] renders the Bringing heading and the empty line, and no list', async () => {
    api.getEventBrings.mockResolvedValue([]);
    render(<BringSummary {...props({ userRsvpStatus: 'maybe' })} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Bringing' })).toBeInTheDocument();
    expect(screen.getByText(NOBODY_LINE)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(api.getEventBrings).toHaveBeenCalledWith(EVENT_ID);
  });

  it('BS-7: an unknown RSVP (null) with [] renders the empty line and no button', async () => {
    api.getEventBrings.mockResolvedValue([]);
    render(<BringSummary {...props({ userRsvpStatus: null })} />);

    expect(await screen.findByText(NOBODY_LINE)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('BS-8: identity unresolved (self undefined), Yes, [] renders the empty line and no button (87.3-04)', async () => {
    api.getEventBrings.mockResolvedValue([]);
    render(<BringSummary {...props({ self: undefined })} />);

    expect(await screen.findByText(NOBODY_LINE)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('BringSummary — one viewer control for a Yes (GB-2, quick-261021-ffb)', () => {
  it('BS-2: Yes with [] renders exactly one button, Add games, type="button"; a click calls onEditClick once', async () => {
    api.getEventBrings.mockResolvedValue([]);
    render(<BringSummary {...props()} />);

    const button = await screen.findByRole('button', { name: ADD_GAMES });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(button).toHaveAttribute('type', 'button');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onEditClick).toHaveBeenCalledTimes(1);
  });

  it("BS-3: Yes with someone else's brings renders Add games AND their row, and no empty line", async () => {
    api.getEventBrings.mockResolvedValue(OTHER_BRINGS);
    render(<BringSummary {...props()} />);

    expect(await screen.findByRole('button', { name: ADD_GAMES })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Catan' });
    expect(link.closest('div')?.textContent).toBe('Sam: Catan');
    expect(screen.queryByText(NOBODY_LINE)).not.toBeInTheDocument();
  });

  it('BS-4 (confirm-only): Yes with own brings renders Edit and no Add games; a click calls onEditClick once', async () => {
    api.getEventBrings.mockResolvedValue(MY_BRINGS);
    render(<BringSummary {...props()} />);

    const edit = await screen.findByRole('button', { name: 'Edit' });
    expect(screen.queryByRole('button', { name: ADD_GAMES })).not.toBeInTheDocument();
    fireEvent.click(edit);
    expect(onEditClick).toHaveBeenCalledTimes(1);
  });

  it.each(['maybe', 'no'])('BS-5: a known %s with own brings renders the list and NO button', async (status) => {
    api.getEventBrings.mockResolvedValue(MY_BRINGS);
    render(<BringSummary {...props({ userRsvpStatus: status })} />);

    expect(await screen.findByRole('link', { name: 'Azul' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('BS-6 (confirm-only): an unknown RSVP (null) with own brings keeps today\'s Edit', async () => {
    api.getEventBrings.mockResolvedValue(MY_BRINGS);
    render(<BringSummary {...props({ userRsvpStatus: null })} />);

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('BringSummary — loading, refetch and failure (quick-261021-ffb)', () => {
  it('BS-9 (confirm-only guard): a rejected read renders nothing and leaves the breadcrumb', async () => {
    api.getEventBrings.mockRejectedValue(new Error('boom'));
    const { container } = render(<BringSummary {...props()} />);

    await waitFor(() =>
      expect(loggerSpies.info).toHaveBeenCalledWith('BringSummary: failed to fetch brings', expect.anything()),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('BS-10 (confirm-only guard): while the first read is pending, nothing renders', async () => {
    api.getEventBrings.mockReturnValue(new Promise(() => {}));
    const { container } = render(<BringSummary {...props()} />);

    await flushRead();
    expect(container).toBeEmptyDOMElement();
  });

  it('BS-11: steady across a refetch — the heading, the empty line and the SAME button node stay; it then reads Edit', async () => {
    api.getEventBrings.mockResolvedValueOnce([]);
    const { rerender } = render(<BringSummary {...props()} />);
    const button = await screen.findByRole('button', { name: ADD_GAMES });

    const next = deferred<typeof MY_BRINGS>();
    api.getEventBrings.mockReturnValueOnce(next.promise);
    rerender(<BringSummary {...props({ refreshKey: 1 })} />);
    await flushRead();

    expect(api.getEventBrings).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { level: 3, name: 'Bringing' })).toBeInTheDocument();
    expect(screen.getByText(NOBODY_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ADD_GAMES })).toBe(button);

    await act(async () => {
      next.resolve(MY_BRINGS);
      await next.promise;
    });
    expect(screen.getByRole('button', { name: 'Edit' })).toBe(button);
    expect(screen.getByRole('link', { name: 'Azul' }).closest('div')?.textContent).toBe('Me: Azul');
  });

  it('BS-12 (confirm-only guard): after a successful [] read, a refetch that rejects renders nothing', async () => {
    api.getEventBrings.mockResolvedValueOnce([]);
    const { container, rerender } = render(<BringSummary {...props()} />);
    await flushRead();

    api.getEventBrings.mockRejectedValueOnce(new Error('boom'));
    rerender(<BringSummary {...props({ refreshKey: 1 })} />);

    await waitFor(() =>
      expect(loggerSpies.info).toHaveBeenCalledWith('BringSummary: failed to fetch brings', expect.anything()),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('BS-13: a different event shows nothing stale while its read is pending, then its own answer', async () => {
    api.getEventBrings.mockResolvedValueOnce(MY_BRINGS);
    const { container, rerender } = render(<BringSummary {...props()} />);
    expect(await screen.findByRole('link', { name: 'Azul' })).toBeInTheDocument();

    const next = deferred<never[]>();
    api.getEventBrings.mockReturnValueOnce(next.promise);
    rerender(<BringSummary {...props({ eventId: EVENT_ID_2 })} />);
    await flushRead();

    expect(api.getEventBrings).toHaveBeenLastCalledWith(EVENT_ID_2);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Azul')).not.toBeInTheDocument();

    await act(async () => {
      next.resolve([]);
      await next.promise;
    });
    expect(screen.getByText(NOBODY_LINE)).toBeInTheDocument();
  });

  it('BS-14: a superseded read that fails LATER does not hide the answer of the read that replaced it (executor deviation, pinned by the orchestrator)', async () => {
    // Read 1 hangs; read 2 (a refetch) answers [] first; then read 1 rejects. Without the
    // `if (cancelled) return` in the catch, the stale failure would wipe read 2's answer.
    const first = deferred<never[]>();
    api.getEventBrings.mockReturnValueOnce(first.promise);
    const { container, rerender } = render(<BringSummary {...props()} />);
    await flushRead();
    expect(container).toBeEmptyDOMElement();

    api.getEventBrings.mockResolvedValueOnce([]);
    rerender(<BringSummary {...props({ refreshKey: 1 })} />);
    expect(await screen.findByText(NOBODY_LINE)).toBeInTheDocument();

    await act(async () => {
      first.reject(new Error('late boom'));
      await first.promise.catch(() => undefined);
    });
    expect(screen.getByText(NOBODY_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ADD_GAMES })).toBeInTheDocument();
    // The superseded failure still leaves its breadcrumb (logged before the guard).
    expect(loggerSpies.info).toHaveBeenCalledWith('BringSummary: failed to fetch brings', expect.anything());
  });
});
