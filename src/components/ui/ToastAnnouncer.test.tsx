// Pins for the toast-to-dialog announcer bridge (plan 89.6-03; register B4-02, "Error notices are
// not spoken while a dialog is open"). MEASURED on the owner's iPhone with VoiceOver: with
// Customize Group open and Save Changes failing, the error toast was not spoken. Sonner's live
// region sits outside the aria-modal dialog. ToastAnnouncer reads Sonner's toast list and hands
// each new toast's words to the region inside the top open dialog
// (src/components/ui/announcer.ts ("DECISION Phase 89.6-03 (toast-bridge)")).
// jsdom shows only WHERE the words are and when; whether a screen reader speaks them is the
// device row of plan 89.6-32. Tests are numbered as the plan numbers them.
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Toaster, toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '../../app/components/Modal';
import { RootAnnouncer } from './RootAnnouncer';
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { ToastAnnouncer } from './ToastAnnouncer';

const rootRegion = () => document.querySelector('[data-announcer="root"]') as HTMLElement;
const dialogRegion = (dialog: HTMLElement) =>
  dialog.querySelector('[data-announcer="dialog"]') as HTMLElement;
// Sonner's own live region: the one section its Toaster always renders.
const sonnerSection = () =>
  document.querySelector('section[aria-live][aria-label^="Notifications"]') as HTMLElement;

// A node's text, sampled after every step below. A text the announcer store sets stays for its
// 4 s clear window unless a later announcement clears it first and waits the 100 ms dwell, so
// samples 50 ms apart miss no value. `runs` is the sampled text with repeats folded.
type Watch = { read: () => string; runs: string[] };
let watches: Watch[] = [];
function watchText(read: () => string): string[] {
  const watch: Watch = { read, runs: [read()] };
  watches.push(watch);
  return watch.runs;
}
function sample(): void {
  for (const watch of watches) {
    const now = watch.read();
    if (watch.runs.at(-1) !== now) watch.runs.push(now);
  }
}
const SAMPLE_MS = 50;
/** Advance the fake clock, in steps a region's text cannot change twice inside. */
function advance(ms: number): void {
  let left = ms;
  do {
    const step = Math.min(SAMPLE_MS, left);
    act(() => {
      vi.advanceTimersByTime(step);
    });
    sample();
    left -= step;
  } while (left > 0);
}
// Sonner hands each publish to its subscribers in a timer of its own (0 ms), so the bridge sees
// a toast one timer turn after the call.
const sonnerPublishes = () => advance(0);
const land = () => advance(REGION_EMPTY_DWELL_MS);
function raise(run: () => void): void {
  act(run);
  sonnerPublishes();
}

// Radix keeps a closed dialog's content mounted until its exit animation ends. jsdom runs no
// animation, so the close-path tests give the dialog one (a different animation name once
// data-state is closed) and end it by hand, the way the browser's animationend would. The same
// stage as src/app/components/Modal.test.tsx ("function plantExitAnimation() {").
function plantExitAnimation() {
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const styles = realGetComputedStyle(element, pseudo);
    if (!(element instanceof Element) || element.getAttribute('role') !== 'dialog') return styles;
    return new Proxy(styles, {
      get(target, property) {
        if (property === 'animationName') {
          return element.getAttribute('data-state') === 'closed' ? 'exit' : 'enter';
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
}
function endExitAnimation(dialog: HTMLElement) {
  const ended = new Event('animationend', { bubbles: true });
  Object.defineProperty(ended, 'animationName', { value: 'exit' });
  act(() => {
    dialog.dispatchEvent(ended);
  });
  sample();
}

function Dialog({ open = true }: { open?: boolean }) {
  return (
    <Modal open={open} onClose={() => {}}>
      <Modal.Header>Customize Group</Modal.Header>
      <Modal.Body>
        <p>Group settings</p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Action variant="primary">Save Changes</Modal.Action>
      </Modal.Footer>
    </Modal>
  );
}

function Stage({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <RootAnnouncer />
      <ToastAnnouncer />
      {children}
    </>
  );
}

// The root layout's own order: Sonner's Toaster, the root region, the bridge, then the page.
function StageWithToaster({ open }: { open: boolean }) {
  return (
    <>
      <Toaster closeButton />
      <Stage>
        <Dialog open={open} />
      </Stage>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  watches = [];
});

afterEach(() => {
  // Sonner keeps its toasts in a module store: empty it, then run every timer while the tree is
  // still mounted, so the announcer store and the bridge end each test empty.
  act(() => {
    toast.dismiss();
    vi.runAllTimers();
  });
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('89.6-03 (toast-bridge): ToastAnnouncer', () => {
  it('1. a toast raised while a house Modal is open lands in that Modal own region, the same node, and never in the root', () => {
    render(
      <Stage>
        <Dialog />
      </Stage>
    );
    const dialog = screen.getByRole('dialog', { name: 'Customize Group' });
    // C-6 node identity: the region that is on the page BEFORE the toast is the one that speaks.
    const region = dialogRegion(dialog);
    expect(region).toBeEmptyDOMElement();
    const rootRuns = watchText(() => rootRegion().textContent ?? '');

    raise(() => {
      toast.error('Could not save your settings');
    });
    // Cleared first, as for every announcement: nothing before the dwell.
    expect(region).toBeEmptyDOMElement();
    land();

    expect(dialogRegion(dialog)).toBe(region);
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toBe('Could not save your settings');
    expect(rootRegion()).toBeEmptyDOMElement();
    advance(5000);
    expect(rootRuns).toEqual(['']);
  });

  // A pin (green before Task 2): outside dialogs Sonner's own region is the one that speaks.
  it('2. with no dialog open a toast writes nothing to the root region', () => {
    render(
      <Stage>
        <Dialog open={false} />
      </Stage>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const rootRuns = watchText(() => rootRegion().textContent ?? '');
    raise(() => {
      toast.error('Could not save your settings');
    });
    advance(5000);
    expect(rootRuns).toEqual(['']);
    expect(document.querySelector('[data-announcer="dialog"]')).toBeNull();
  });

  // FIX b: the bridge forgets an id once Sonner no longer lists it.
  it('3. a toast id reused after its toast was dismissed is a new toast: the second words land, the first are not repeated', () => {
    render(
      <Stage>
        <Dialog />
      </Stage>
    );
    const dialog = screen.getByRole('dialog', { name: 'Customize Group' });
    const regionRuns = watchText(() => dialogRegion(dialog).textContent ?? '');

    raise(() => {
      toast.error('First', { id: 'save' });
    });
    land();
    expect(dialogRegion(dialog).textContent).toBe('First');

    // Dismissed: Sonner drops it from its list one frame and one timer turn later.
    act(() => {
      toast.dismiss('save');
    });
    advance(50);

    raise(() => {
      toast.error('Second', { id: 'save' });
    });
    land();
    expect(dialogRegion(dialog).textContent).toBe('Second');
    advance(5000);
    expect(regionRuns.filter((words) => words === 'First')).toHaveLength(1);
    expect(regionRuns.filter((words) => words === 'Second')).toHaveLength(1);
    expect(rootRegion()).toBeEmptyDOMElement();
  });

  // A pin (green before Task 2): a toast with no string title has no words to hand over.
  it('4. a toast whose message is a React element is not handed over', () => {
    render(
      <Stage>
        <Dialog />
      </Stage>
    );
    const dialog = screen.getByRole('dialog', { name: 'Customize Group' });
    const regionRuns = watchText(() => dialogRegion(dialog).textContent ?? '');
    const rootRuns = watchText(() => rootRegion().textContent ?? '');
    raise(() => {
      toast.error(<span>Could not save your settings</span>);
    });
    advance(5000);
    expect(regionRuns).toEqual(['']);
    expect(rootRuns).toEqual(['']);
  });

  // A pin (green before Task 2): no toast call site passes a description today; a future one
  // is not silently cut to its title.
  it('5. a string description is handed over after the title', () => {
    render(
      <Stage>
        <Dialog />
      </Stage>
    );
    const dialog = screen.getByRole('dialog', { name: 'Customize Group' });
    raise(() => {
      toast.error('Could not save', { description: 'Check your connection' });
    });
    land();
    expect(dialogRegion(dialog).textContent).toBe('Could not save Check your connection');
    expect(rootRegion()).toBeEmptyDOMElement();
  });

  // FIX d (plan review scoped check S01): aria-modal does not prune Sonner's aria-live section
  // from Chromium's accessibility tree, and the page-hiding package skips aria-live nodes. With
  // the bridge's copy in the dialog region the toast would be in the tree twice, so the bridge
  // hides Sonner's section from assistive tech while a house dialog is open or closing.
  it('6. Sonner section is aria-hidden while a house Modal is open or closing, and not before or after', () => {
    plantExitAnimation();
    const { rerender } = render(<StageWithToaster open={false} />);
    const section = sonnerSection();
    expect(section).not.toBeNull();
    expect(section).not.toHaveAttribute('aria-hidden');

    rerender(<StageWithToaster open />);
    const dialog = screen.getByRole('dialog', { name: 'Customize Group' });
    expect(sonnerSection()).toBe(section);
    expect(section).toHaveAttribute('aria-hidden', 'true');

    // Closed, its exit still running: the dialog is on the page and still holds focus.
    rerender(<StageWithToaster open={false} />);
    expect(dialog.isConnected).toBe(true);
    expect(dialog).toHaveAttribute('data-state', 'closed');
    expect(section).toHaveAttribute('aria-hidden', 'true');

    // The dialog leaves the page (the A-47 leave): no toast is showing, so the section is back.
    endExitAnimation(dialog);
    expect(dialog.isConnected).toBe(false);
    expect(section).not.toHaveAttribute('aria-hidden');
    expect(section).not.toHaveAttribute('data-toast-bridge-hidden');
  });

  // FIX d, the close path (plan review scoped check 2 T02): a toast that arrives while the
  // dialog is closing is spoken in the ROOT after the leave, the moment Sonner's section would
  // be exposed again with that toast still in it. The section stays hidden until it no longer
  // shows a toast whose words went to the root, and the bridge speaks meanwhile.
  it('7. after the leave Sonner section stays aria-hidden while it shows a toast whose words went to the root, and the bridge speaks meanwhile', () => {
    plantExitAnimation();
    const { rerender } = render(<StageWithToaster open />);
    const dialog = screen.getByRole('dialog', { name: 'Customize Group' });
    const section = sonnerSection();
    const rootRuns = watchText(() => rootRegion().textContent ?? '');
    expect(section).toHaveAttribute('aria-hidden', 'true');

    rerender(<StageWithToaster open={false} />);
    expect(dialog.isConnected).toBe(true);
    raise(() => {
      toast.error('Could not save your settings');
    });
    // The dwell passes during the exit: the words are held, in no region.
    land();
    expect(rootRegion()).toBeEmptyDOMElement();
    expect(dialogRegion(dialog)).toBeEmptyDOMElement();

    endExitAnimation(dialog);
    expect(dialog.isConnected).toBe(false);
    land();
    // The root holds the words (FIX a), and Sonner's section, which shows the same toast, is
    // still hidden: the words are exposed once.
    expect(rootRegion().textContent).toBe('Could not save your settings');
    expect(section.textContent).toContain('Could not save your settings');
    expect(section).toHaveAttribute('aria-hidden', 'true');

    // A second toast now, with no dialog: Sonner's section is hidden, so the bridge speaks it.
    raise(() => {
      toast.error('Could not load the members');
    });
    land();
    expect(rootRegion().textContent).toBe('Could not load the members');
    expect(section).toHaveAttribute('aria-hidden', 'true');

    // Past Sonner's lifetime (4 s) and its unmount (200 ms): both toasts are gone from the
    // section, and only then is it exposed again.
    advance(6000);
    expect(section.textContent).not.toContain('Could not save your settings');
    expect(section.textContent).not.toContain('Could not load the members');
    expect(section).not.toHaveAttribute('aria-hidden');
    expect(section).not.toHaveAttribute('data-toast-bridge-hidden');
    expect(rootRuns.filter((words) => words === 'Could not save your settings')).toHaveLength(1);
    expect(rootRuns.filter((words) => words === 'Could not load the members')).toHaveLength(1);

    // With the section exposed again and no dialog, the bridge is silent, as before (test 2).
    raise(() => {
      toast.error('Could not remove the member');
    });
    advance(1000);
    expect(rootRegion()).toBeEmptyDOMElement();
    expect(section).not.toHaveAttribute('aria-hidden');
  });
});
