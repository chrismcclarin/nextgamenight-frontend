// Pins for the root announcer's module store (plan 88.9-24; owner ruling 88.9-RULINGS.md R-F1,
// 2026-11-08, DEC-3 option A). A save whose result is in view shows no toast (save-feedback
// rule 2) and is still spoken once, by the ONE always-mounted region RootAnnouncer renders from
// this store. Every assert reads the exported snapshot getter or a subscribe() listener log.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LEAVING_WAIT_CAP_MS,
  announceStatus,
  getHostSnapshot,
  getServerSnapshot,
  getSnapshot,
  registerAnnounceHost,
  releaseAnnounceHost,
  subscribe,
  type AnnounceHost,
} from './announcer';
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { INLINE_RECEIPT_MS } from './useInlineReceipt';

let log: string[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  unsubscribe = subscribe(() => log.push(getSnapshot()));
});

afterEach(() => {
  // Run every pending timer so the module store ends empty between tests.
  vi.runAllTimers();
  unsubscribe();
  vi.useRealTimers();
});

describe('announcer store (88.9-24, R-F1)', () => {
  it('announceStatus clears the region at once, then sets the text after REGION_EMPTY_DWELL_MS (100 ms)', () => {
    expect(REGION_EMPTY_DWELL_MS).toBe(100);
    expect(getServerSnapshot()).toBe('');
    announceStatus('Prior words');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Prior words');

    announceStatus('Settings saved');
    // The prior text is gone synchronously.
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1);
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('Settings saved');
  });

  it('a second announceStatus inside the dwell replaces the first', () => {
    announceStatus('A');
    vi.advanceTimersByTime(50);
    announceStatus('B');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('B');
    expect(log).not.toContain('A');
    expect(log).toContain('B');
  });

  it('the text is cleared again after INLINE_RECEIPT_MS', () => {
    expect(INLINE_RECEIPT_MS).toBe(4000);
    announceStatus('Role updated');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Role updated');
    vi.advanceTimersByTime(INLINE_RECEIPT_MS - 1);
    expect(getSnapshot()).toBe('Role updated');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('');
    expect(log.at(-1)).toBe('');
  });
});

// 88.9-52 (A-47): the owner's iPhone (production, 2026-11-16) did not speak Role updated while
// Manage Members stayed open, because the root region sits outside the open aria-modal dialog.
// The store now routes the words to the top open dialog host. getSnapshot() is the ROOT region's
// view; getHostSnapshot(host) is one dialog region's view. A dialog has three moments here:
// it opens (registerAnnounceHost), its open prop turns false (the returned close), and its
// content leaves the page (releaseAnnounceHost). Between the last two it is still mounted for
// its exit animation.
describe('announcer store routes to the top open dialog host (88.9-52, A-47)', () => {
  const closers = new Map<AnnounceHost, () => void>();
  /** The dialog opens. */
  function open(host: AnnounceHost): void {
    closers.set(host, registerAnnounceHost(host));
  }
  /** The open prop turns false; the content is still on the page (exit animation). */
  function startClosing(host: AnnounceHost): void {
    closers.get(host)?.();
    closers.delete(host);
  }
  /** The content leaves the page. */
  function leavePage(host: AnnounceHost): void {
    releaseAnnounceHost(host);
  }
  /** Closed and unmounted in one commit (createEvent, GroupSettings; every dialog in jsdom). */
  function shut(host: AnnounceHost): void {
    startClosing(host);
    leavePage(host);
  }
  const everyHost: AnnounceHost[] = [];
  function host(): AnnounceHost {
    const next: AnnounceHost = {};
    everyHost.push(next);
    return next;
  }

  afterEach(() => {
    // Every host leaves, so no test hands an open or a closing host to the next one.
    for (const each of everyHost.splice(0)) shut(each);
  });

  it('with one host open the words land in that host and never in the root', () => {
    const dialog = host();
    open(dialog);
    announceStatus('Role updated');
    expect(getHostSnapshot(dialog)).toBe('');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(dialog)).toBe('Role updated');
    expect(getSnapshot()).toBe('');
    // The same clear window as the root: gone after INLINE_RECEIPT_MS.
    vi.advanceTimersByTime(INLINE_RECEIPT_MS);
    expect(getHostSnapshot(dialog)).toBe('');
    expect(getSnapshot()).toBe('');
    expect(log).not.toContain('Role updated');
  });

  it('with no host open the words land in the root, as before', () => {
    const dialog = host();
    announceStatus('Settings saved');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Settings saved');
    expect(getHostSnapshot(dialog)).toBe('');
  });

  it('stacked hosts route to the top one; closing it restores the one beneath, then the root', () => {
    const lower = host();
    const upper = host();
    open(lower);
    open(upper);
    announceStatus('First');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(upper)).toBe('First');
    expect(getHostSnapshot(lower)).toBe('');
    expect(getSnapshot()).toBe('');

    shut(upper);
    announceStatus('Second');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(lower)).toBe('Second');
    expect(getHostSnapshot(upper)).toBe('');
    expect(getSnapshot()).toBe('');

    shut(lower);
    announceStatus('Third');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Third');
    expect(getHostSnapshot(lower)).toBe('');
  });

  it('a lower host that closes first leaves the upper host as the target', () => {
    const lower = host();
    const upper = host();
    open(lower);
    open(upper);
    shut(lower);
    announceStatus('Member removed');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(upper)).toBe('Member removed');
    expect(getSnapshot()).toBe('');
  });

  it('a host that closes and unmounts in the same tick as the announce hands the words to the root after the one dwell', () => {
    const dialog = host();
    open(dialog);
    announceStatus('Event created');
    shut(dialog);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1);
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('Event created');
    expect(getHostSnapshot(dialog)).toBe('');
  });

  it('a nested host that closes and unmounts in the same tick hands the words to the host beneath, not the root', () => {
    const lower = host();
    const upper = host();
    open(lower);
    open(upper);
    announceStatus('Member removed');
    shut(upper);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(lower)).toBe('Member removed');
    expect(getSnapshot()).toBe('');
  });

  it('while a closed dialog is still on the page the words are HELD; they land one dwell after it leaves', () => {
    const dialog = host();
    open(dialog);
    announceStatus('Google Calendar disconnected');
    startClosing(dialog);
    // The dwell passes while the exit animation still runs: nothing lands anywhere.
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('');
    expect(getHostSnapshot(dialog)).toBe('');
    vi.advanceTimersByTime(100);
    expect(getSnapshot()).toBe('');
    // The content unmounts. One more dwell (the close moves focus first), then the root has them.
    leavePage(dialog);
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1);
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('Google Calendar disconnected');
    expect(getHostSnapshot(dialog)).toBe('');
    // The usual clear window follows.
    vi.advanceTimersByTime(INLINE_RECEIPT_MS);
    expect(getSnapshot()).toBe('');
  });

  it('a closing confirm over an open dialog: the words are held, then land in the dialog beneath', () => {
    const members = host();
    const confirm = host();
    open(members);
    open(confirm);
    announceStatus('Role updated');
    startClosing(confirm);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(members)).toBe('');
    expect(getHostSnapshot(confirm)).toBe('');
    expect(getSnapshot()).toBe('');
    leavePage(confirm);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(members)).toBe('Role updated');
    expect(getSnapshot()).toBe('');
    expect(log).not.toContain('Role updated');
  });

  it('a dialog whose exit never ends cannot swallow the words: they land at LEAVING_WAIT_CAP_MS', () => {
    expect(LEAVING_WAIT_CAP_MS).toBe(1000);
    const dialog = host();
    open(dialog);
    announceStatus('Event updated');
    startClosing(dialog);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS + LEAVING_WAIT_CAP_MS - 1);
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('Event updated');
    vi.advanceTimersByTime(INLINE_RECEIPT_MS);
    expect(getSnapshot()).toBe('');
    // The stuck dialog is forgotten at the cap: the NEXT words land after the one dwell.
    announceStatus('Settings saved');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Settings saved');
  });

  it('a new announce while words are held replaces them; only the new words land', () => {
    const dialog = host();
    open(dialog);
    announceStatus('First');
    startClosing(dialog);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    announceStatus('Second');
    leavePage(dialog);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Second');
    vi.advanceTimersByTime(INLINE_RECEIPT_MS + LEAVING_WAIT_CAP_MS);
    expect(log).not.toContain('First');
  });

  it('a dialog that opens again before its exit finished stops holding the words and takes them', () => {
    const dialog = host();
    open(dialog);
    announceStatus('Role updated');
    startClosing(dialog);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(dialog)).toBe('');
    open(dialog);
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(dialog)).toBe('Role updated');
    expect(getSnapshot()).toBe('');
  });

  it('a host that closes while it holds the words takes them with it: the root never repeats them', () => {
    const dialog = host();
    open(dialog);
    announceStatus('Role updated');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getHostSnapshot(dialog)).toBe('Role updated');
    log = [];
    shut(dialog);
    expect(getHostSnapshot(dialog)).toBe('');
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(INLINE_RECEIPT_MS);
    // log holds the ROOT view at every store change: the words never reached it.
    expect(log).not.toContain('Role updated');
    // The same host opening again does not find stale words waiting.
    open(dialog);
    expect(getHostSnapshot(dialog)).toBe('');
  });

  it('a host that opens while the root holds the words does not take them (no second reading)', () => {
    const dialog = host();
    announceStatus('Settings saved');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    open(dialog);
    expect(getSnapshot()).toBe('Settings saved');
    expect(getHostSnapshot(dialog)).toBe('');
  });

  it('a repeat of the same words in a host is cleared first, then set after the dwell', () => {
    const dialog = host();
    open(dialog);
    announceStatus('Role updated');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    announceStatus('Role updated');
    expect(getHostSnapshot(dialog)).toBe('');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1);
    expect(getHostSnapshot(dialog)).toBe('');
    vi.advanceTimersByTime(1);
    expect(getHostSnapshot(dialog)).toBe('Role updated');
  });
});
