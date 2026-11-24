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
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '../../app/components/Modal';
import { RootAnnouncer } from './RootAnnouncer';
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { ToastAnnouncer } from './ToastAnnouncer';

const rootRegion = () => document.querySelector('[data-announcer="root"]') as HTMLElement;
const dialogRegion = (dialog: HTMLElement) =>
  dialog.querySelector('[data-announcer="dialog"]') as HTMLElement;

// Sonner hands each publish to its subscribers in a timer of its own (0 ms), so the bridge sees
// a toast one timer turn after the call.
const sonnerPublishes = () =>
  act(() => {
    vi.advanceTimersByTime(0);
  });
const land = () =>
  act(() => {
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
  });

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

beforeEach(() => {
  vi.useFakeTimers();
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
    const rootLog: string[] = [];
    const observer = new MutationObserver(() => rootLog.push(rootRegion().textContent ?? ''));
    observer.observe(rootRegion(), { childList: true, characterData: true, subtree: true });

    act(() => {
      toast.error('Could not save your settings');
    });
    sonnerPublishes();
    // Cleared first, as for every announcement: nothing before the dwell.
    expect(region).toBeEmptyDOMElement();
    land();

    expect(dialogRegion(dialog)).toBe(region);
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toBe('Could not save your settings');
    expect(rootRegion()).toBeEmptyDOMElement();
    observer.disconnect();
    expect(rootLog).not.toContain('Could not save your settings');
  });
});
