// Axe audit for QRCodeModal after its migration onto the shared <Modal> primitive
// (PRIM-02 / D-09). The pre-migration hand-rolled `.modal-overlay` had no
// role=dialog / focus-trap / aria-modal (the 0/16-axe fleet); this pins the
// migrated modal to the Radix-backed a11y contract: it exposes role=dialog and
// returns zero axe violations rendered open at size="sm".
import * as React from 'react';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { logger } from '@/lib/logger';
import QRCodeModal from './QRCodeModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('QRCodeModal (migrated onto <Modal size="sm">)', () => {
  it('renders as role=dialog when open', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('preserves both Close affordances (corner X + footer button)', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    // The freeform QR modal keeps its original two close affordances: the
    // top-right X (aria-label="Close") and the full-width "Close" button.
    expect(
      screen.getAllByRole('button', { name: /close/i })
    ).toHaveLength(2);
  });

  // 88-33 Task 3 (fork 6, UAT row 333). The walk sighting was that THIS modal's
  // glyph "sits LOWER" than the fleet's: it carried the shared 44px box and the
  // text-2xl size but NOT `leading-none`, so the glyph rode the line-box. The
  // insets now land on the same edge the fleet header's close box does.
  it('centers its close glyph optically and sits on the fleet header inset', () => {
    render(
      <QRCodeModal
        isOpen
        onClose={vi.fn()}
        url="https://nextgamenight.app/invite/abc123"
        title="Invite to group"
      />
    );
    // Two controls share the name 'Close' (corner glyph + footer button); the
    // corner one is first in DOM order.
    const [corner] = screen.getAllByRole('button', { name: 'Close' });
    expect(corner.className).toContain('leading-none');
    expect(corner.className).toContain('min-h-11');
    expect(corner.className).toContain('min-w-11');
    expect(corner.className).toContain('right-3');
    expect(corner.className).toContain('md:right-6');
  });
});

// 88.6.1-12 (copy row G3, D-30; Req 8; Req 11 copy-confirmation timer; SPEC Edge R8, R11).
// The copy outcome is ANNOUNCED from a polite, sr-only status region that is mounted and EMPTY
// before the copy (C-6: the same node carries the text afterwards), the visible label swap is
// kept, and the 2 s label timer never outlives the open dialog. Line comments only (CF-9).
const INVITE_URL = 'https://nextgamenight.app/invite/abc123';
const G3 = 'Invite link copied to the clipboard.';

type TimerSpy = { mock: { calls: unknown[][]; results: { value: unknown }[] } };

// user-event and Radix schedule their own zero-delay timers, so only the 2000 ms calls count.
function handles2000(spy: TimerSpy): unknown[] {
  return spy.mock.calls
    .map((call, i) => ({ call, i }))
    .filter(({ call }) => call[1] === 2000)
    .map(({ i }) => spy.mock.results[i].value);
}

function callbacks2000(spy: TimerSpy): Array<() => void> {
  return spy.mock.calls
    .filter((call) => call[1] === 2000)
    .map((call) => call[0] as () => void);
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  // Defined AFTER userEvent.setup(), which installs its own clipboard stub
  // (FriendInvitePanel.test.tsx, the clipboard copy arm).
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

// AMENDED 2026-10-19 (88.6.1 code review CR-1 / A-25): the dialog now holds TWO polite regions,
// the sr-only copy announcement first and the copy-failure line second (DOM order).
function regions(): HTMLElement[] {
  const found = screen.getByRole('dialog').querySelectorAll('[role="status"]');
  expect(found).toHaveLength(2);
  return Array.from(found) as HTMLElement[];
}

function region(): HTMLElement {
  const r = regions()[0];
  expect(r).toHaveClass('sr-only');
  return r;
}

function failRegion(): HTMLElement {
  return regions()[1];
}

const COPY_FAILED = "Couldn't copy the link. Press and hold the link to copy it.";

function dialogAt(isOpen: boolean, url: string = INVITE_URL) {
  return (
    <QRCodeModal isOpen={isOpen} onClose={vi.fn()} url={url} title="Game Night Invite QR" />
  );
}

describe('QRCodeModal — the copy outcome (88.6.1-12)', () => {
  let setTimeoutSpy: TimerSpy;
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Call-through spies: no mock implementation, the real timers still run.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout') as unknown as TimerSpy;
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
  });

  it('A: announces G3 from the region that was already mounted and empty (same node)', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(dialogAt(true));
    const before = region();
    expect(before.textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });

    expect(region()).toBe(before);
    expect(before.textContent).toBe(G3);
    // Phone first: the region adds no box — it stays sr-only for its whole life.
    expect(before).toHaveClass('sr-only');
    // The visible label swap is KEPT.
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('B: a second copy inside the 2 s window re-announces on the same node and clears the first timer', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(dialogAt(true));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    const r = region();
    const first = handles2000(setTimeoutSpy);
    expect(first).toHaveLength(1);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(r, { childList: true, characterData: true, subtree: true });

    await user.click(screen.getByRole('button', { name: 'Copied!' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(records.some((m) => m.type === 'childList' || m.type === 'characterData')).toBe(true)
    );
    observer.disconnect();

    expect(region()).toBe(r);
    expect(r.textContent).toBe(G3);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(first[0]);
  });

  it('C: closing clears the pending timer, and reopening is fresh', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { rerender } = render(dialogAt(true));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    const pending = handles2000(setTimeoutSpy);
    expect(pending).toHaveLength(1);

    rerender(dialogAt(false));
    expect(clearTimeoutSpy).toHaveBeenCalledWith(pending[0]);

    rerender(dialogAt(true));
    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
    expect(region().textContent).toBe('');
  });

  it('C2: a clipboard write that settles after the close sets no label, no announcement and no timer', async () => {
    const user = userEvent.setup();
    let resolveWrite: () => void = () => {};
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    stubClipboard(writeText);
    const { rerender } = render(dialogAt(true));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    // The press reached the handler, so this arm cannot pass vacuously.
    expect(writeText).toHaveBeenCalledTimes(1);

    rerender(dialogAt(false));
    const armedAtClose = handles2000(setTimeoutSpy).length;
    await act(async () => {
      resolveWrite();
    });
    rerender(dialogAt(true));

    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
    expect(region().textContent).toBe('');
    expect(handles2000(setTimeoutSpy)).toHaveLength(armedAtClose);
  });

  it('D: unmounting clears the pending timer', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { unmount } = render(dialogAt(true));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    const pending = handles2000(setTimeoutSpy);
    expect(pending).toHaveLength(1);

    unmount();
    // Asserted on the handle itself, never on the dead unmount warning (CF-55).
    expect(clearTimeoutSpy).toHaveBeenCalledWith(pending[0]);
  });

  // AMENDED 2026-10-19 (88.6.1 code review CR-1 / A-25, owner ratified): a rejected write was
  // silent; it now shows and announces the ratified failure sentence plus the link as text.
  it('E1: a rejected write shows and announces the failure sentence, with the link as text', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    render(dialogAt(true));
    const before = region();
    const failBefore = failRegion();
    expect(failBefore.textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(info).toHaveBeenCalledTimes(1));
    expect(info).toHaveBeenCalledWith('Failed to copy link:', expect.any(Object));

    // The failure is spoken from the region that was already mounted and empty, and shown.
    expect(failRegion()).toBe(failBefore);
    expect(failBefore.textContent).toBe(COPY_FAILED);
    expect(failBefore).toHaveAttribute('aria-live', 'polite');
    expect(failBefore).not.toHaveClass('sr-only');
    const link = screen.getByRole('link', { name: INVITE_URL });
    expect(link).toHaveAttribute('href', INVITE_URL);
    // The success announcement stays empty and the label never claims a copy.
    expect(region()).toBe(before);
    expect(before.textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
  });

  it('E1b: the next successful copy clears the failure sentence and the link', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    stubClipboard(writeText);
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    render(dialogAt(true));

    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(failRegion().textContent).toBe(COPY_FAILED));

    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    expect(failRegion().textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
    expect(region().textContent).toBe(G3);
  });

  it('E1c: closing clears the failure, and a rejection that settles after the close stays silent', async () => {
    const user = userEvent.setup();
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied'));
    stubClipboard(writeText);
    const { rerender } = render(dialogAt(true));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(failRegion().textContent).toBe(COPY_FAILED));

    rerender(dialogAt(false));
    rerender(dialogAt(true));
    expect(failRegion().textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();

    // A late rejection: pressed while open, settled after the close.
    let rejectWrite: (e: Error) => void = () => {};
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        })
    );
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    rerender(dialogAt(false));
    await act(async () => {
      rejectWrite(new Error('late'));
    });
    rerender(dialogAt(true));
    expect(failRegion().textContent).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('E2: with no link the copy writes nothing and announces nothing', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(dialogAt(true, ''));

    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await act(async () => {});

    // No positive event exists here; the write happens synchronously inside the click
    // handler, so asserting it did not happen after the flush is discriminating.
    expect(writeText).not.toHaveBeenCalled();
    expect(region().textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
  });

  it('F: the timer expiring resets the label and empties the same region node', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(dialogAt(true));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    const r = region();
    const [expire] = callbacks2000(setTimeoutSpy);
    expect(expire).toBeTypeOf('function');

    act(() => expire());

    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
    expect(region()).toBe(r);
    expect(r.textContent).toBe('');
  });
});

// 88.6.1-12 (D-27, W037 / IN-304). The dialog's controls are exactly what its D48 marker counts:
// the corner close, Copy Invite Link and the footer Close. The conditional destructive tertiary
// control was deleted with its two gating props under D-27 (no host enabled it, no caller supplied
// its handler), so a caller still passing them gets the same three controls.
// JS component: its inferred prop type does not declare the retired props, so cast (the
// formLabels.audit.test idiom).
type AnyComponent = React.ComponentType<Record<string, unknown>>;
const QRCodeModalAny = QRCodeModal as unknown as AnyComponent;

describe('QRCodeModal — controls (88.6.1-12, D-27, W037)', () => {
  it('G: the retired props render no extra control', () => {
    render(
      <QRCodeModalAny
        isOpen
        onClose={vi.fn()}
        url={INVITE_URL}
        title="Game Night Invite QR"
        showReset
        onReset={vi.fn()}
      />
    );
    const names = Array.from(screen.getByRole('dialog').querySelectorAll('button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim()
    );
    expect(names).toEqual(['Close', 'Copy Invite Link', 'Close']);
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
  });

  it('H: three controls, and only the corner close is off the house focus ring', () => {
    render(dialogAt(true));
    const buttons = Array.from(screen.getByRole('dialog').querySelectorAll('button'));
    expect(buttons).toHaveLength(3);
    const offRing = buttons.filter((b) => !b.classList.contains('focus-visible:ring-2'));
    expect(offRing).toHaveLength(1);
    expect(offRing[0]).toBe(buttons[0]);
    expect(offRing[0]).toHaveAccessibleName('Close');
  });
});
