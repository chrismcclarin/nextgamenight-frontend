// Behavior + a11y pins for the compound <Modal> primitive (PRIM-02 / D-09).
//
// The current hand-rolled modal fleet is 0/16 on axe (no focus trap, no Esc, no
// aria-modal). This suite locks the contract the Radix-backed primitive must
// honor so the Phase-88 `.modal-*` -> <Modal.*> swap is mechanical and safe:
//   1. role=dialog + aria-modal + aria-labelledby wired to the header title
//   2. axe-clean render (the headline gate)
//   3. size prop -> max-w mapping
//   4. dismissable escape hatch (overlay-dismiss defeatable for forms)
//   5. Close affordance carries an accessible "Close" name + fires onClose
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { withoutComments } from '../../test-utils/sourceScan';
import { pressInStackedDialog } from '../../test-utils/stackedDialogPress';
import { Combobox, type ComboboxItem } from '../../components/ui/Combobox';
import { DialogTitle } from '../../components/ui/dialog';
import { announceStatus } from '../../components/ui/announcer';
import { RootAnnouncer } from '../../components/ui/RootAnnouncer';
import { REGION_EMPTY_DWELL_MS } from '../../components/ui/StatusRegion';
import { Modal, preventNonDismissableClose } from './Modal';

afterEach(cleanup);

const MODAL_SRC_RAW = fs.readFileSync(path.resolve(__dirname, 'Modal.tsx'), 'utf8');
const MODAL_SRC = withoutComments(MODAL_SRC_RAW);

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Modal open onClose={onClose} {...props}>
      <Modal.Header>Start a check-in</Modal.Header>
      <Modal.Body>
        <p>When are you free?</p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Action variant="secondary" onClick={onClose}>
          Cancel
        </Modal.Action>
        <Modal.Action variant="primary">Start poll</Modal.Action>
      </Modal.Footer>
    </Modal>
  );
  return { onClose, ...utils };
}

describe('Modal', () => {
  it('exposes role=dialog, aria-modal, and aria-labelledby wired to the header title', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    const title = screen.getByText('Start a check-in');
    expect(title).toHaveAttribute('id', labelledby as string);
  });

  it('passes an axe audit with no violations', async () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('maps size="sm" to max-w-sm', () => {
    renderModal({ size: 'sm' });
    expect(screen.getByRole('dialog')).toHaveClass('max-w-sm');
  });

  it('maps size="lg" to max-w-4xl', () => {
    renderModal({ size: 'lg' });
    expect(screen.getByRole('dialog')).toHaveClass('max-w-4xl');
  });

  // DEF-88-17-01 (closed by 88-16). The 87.8 DEC-3 12px phone gutter used to be
  // written ONLY in a `@media (width < 48rem)` rule keyed to the legacy overlay
  // class, so it evaporated for each surface as it migrated onto this primitive.
  // It now lives on the content surface itself. jsdom computes no layout, so the
  // pin is on the class contract — which is also the thing a future "tidy" would
  // delete. Both halves matter: the phone inset AND its `md:` neutraliser.
  it('carries the 12px-per-side phone gutter and drops it at md (DEF-88-17-01)', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('w-[calc(100%-1.5rem)]');
    expect(dialog).toHaveClass('md:w-full');
    // A bare `w-full` at the phone tier is the regression this closes.
    expect(dialog.className.split(/\s+/)).not.toContain('w-full');
  });

  // 88.6-08 (D-30 / W34). The dialog family converges on ONE viewport unit: `dvh`, which
  // `BottomSheet` has shipped since 88.1 and which D-30 forbids reverting. The shell's
  // `max-h` was UNPINNED at HEAD (`grep -n 'max-h\|90vh\|90dvh'` over this file returned
  // nothing across its 185 lines before this plan) — so this is a NEW pin, not a migrated
  // one, and its red was demonstrated by temporarily reverting the unit after it was
  // written rather than transcribed from a pre-existing failure.
  it('caps the shell at 90dvh — the converged dialog viewport unit (D-30 / W34)', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-h-[90dvh]');
    // Whole-token, not substring: `max-h-[90dvh]` CONTAINS neither spelling of the other,
    // but the old unit must be gone from the rendered element, not merely outnumbered.
    expect(dialog.className.split(/\s+/)).not.toContain('max-h-[90vh]');
  });

  // Every viewport-height unit in Modal.tsx's CODE is `dvh`. The scan is comment-stripped
  // because this file's markers necessarily discuss the old unit and the rejected `svh` in
  // prose — an unfiltered scan reads a marker and can never reach zero.
  it('SOURCE SCAN: Modal.tsx uses no viewport-height unit but dvh', () => {
    const unit = /(?<![a-zA-Z])(\d+(?:\.\d+)?)(d|s|l)?vh(?![a-zA-Z])/g;
    const prefixes = (text: string) =>
      [...text.matchAll(unit)].map((m) => m[2] ?? '');

    // Detector self-test FIRST. A regex that has never been shown to see a bare `vh`
    // proves nothing by not finding one — this is the anti-vacuity half, and it is a
    // SYNTHETIC control rather than a read of the marker prose, so it cannot go silently
    // vacuous the day a later plan rewords that prose.
    expect(prefixes('max-h-[90vh] max-h-[90dvh] max-h-[70svh] h-[85lvh]')).toEqual([
      '',
      'd',
      's',
      'l',
    ]);

    const found = prefixes(MODAL_SRC);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p === 'd')).toBe(true);
  });

  // 88.6-08 (D-08). What the footer action is COMPOSED of, now that it renders `Button`.
  // The two discriminators below are exactly the classes the retired variant map could not
  // emit — it carried a `.btn-*` variant class and nothing else: no height floor and no
  // elevation at all.
  //
  // DELIBERATELY NOT ASSERTED: "no second `.btn`-family class". Measured 2026-09-16, the
  // retired map and `Button`'s variant map were byte-identical (`primary: 'btn-primary'`
  // and so on), so after a CORRECT swap a `variant="primary"` action still renders `btn`
  // AND `btn-primary`. That clause would red on correct code, or be vacuous. The "would
  // red if the old map came back" property is delivered by the comment-stripped retirement
  // scan above, not restated here.
  it('the footer action is composed by Button: the base floor and the enabled-only lift', () => {
    renderModal();
    const tokens = screen
      .getByRole('button', { name: 'Start poll' })
      .className.split(/\s+/);
    expect(tokens).toContain('min-h-11');
    // WHOLE TOKEN, never a substring: `enabled-hover:shadow-theme-md` CONTAINS
    // `hover:shadow-theme-md`, so a substring check passes identically against the
    // un-narrowed spelling and would have been green before plan 06's D10 fix.
    expect(tokens).toContain('enabled-hover:shadow-theme-md');
    expect(tokens).not.toContain('hover:shadow-theme-md');
  });

  it('renders a single Close affordance with an accessible name that fires onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    expect(closeButtons).toHaveLength(1);
    await user.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Phase 88.6-44 (T-88.6-141, WCAG 2.4.3). MEASURED before this pin existed: Radix's modal
  // Content prevents FocusScope's restore and focuses `Dialog.Trigger`, which this primitive
  // never renders — so focus went to <body> on every close. The assertion is a NAMED identity
  // check against the opener; "not body" would pass on any wrong element.
  describe('focus return on close (88.6-44)', () => {
    function Host({ onCloseAutoFocus }: { onCloseAutoFocus?: (event: Event) => void }) {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open it
          </button>
          <Modal open={open} onClose={() => setOpen(false)} onCloseAutoFocus={onCloseAutoFocus}>
            <Modal.Header>Start a check-in</Modal.Header>
            <Modal.Body>
              <p>When are you free?</p>
            </Modal.Body>
          </Modal>
        </>
      );
    }

    it('returns focus to the element that opened the dialog', async () => {
      const user = userEvent.setup();
      render(<Host />);
      const opener = screen.getByRole('button', { name: 'Open it' });
      opener.focus();
      await user.click(opener);
      const dialog = await screen.findByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);

      await user.keyboard('{Escape}');
      await screen.findByRole('button', { name: 'Open it' });
      expect(screen.queryByRole('dialog')).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    });

    it('a consumer that prevents default in onCloseAutoFocus keeps control (T-87.8-22 shape)', async () => {
      const user = userEvent.setup();
      const elsewhere = document.createElement('button');
      elsewhere.textContent = 'Elsewhere';
      document.body.appendChild(elsewhere);
      try {
        render(
          <Host
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              elsewhere.focus();
            }}
          />
        );
        const opener = screen.getByRole('button', { name: 'Open it' });
        opener.focus();
        await user.click(opener);
        await screen.findByRole('dialog');
        await user.keyboard('{Escape}');
        await vi.waitFor(() => expect(document.activeElement).toBe(elsewhere));
      } finally {
        elsewhere.remove();
      }
    });
  });

  // Phase 88.6.1-20 (D-07, AC-15, W014 / WR-201). MEASURED before the fix: whenever the opener
  // was gone, natively disabled, or a dialog that handed off to this one, the close dropped focus
  // on <body>. Every harness renders a page <main><h1>, and each landing is asserted by IDENTITY
  // against a named node, never "not body" (FE-TESTING-CONVENTIONS C-5). The heading is captured
  // BEFORE the dialog opens: Radix marks everything outside an open modal aria-hidden.
  describe('AC-15 focus floor on close (88.6.1-20)', () => {
    // The `{open && <Modal open>}` unmount shape most consumers use; "Delete" removes the opener
    // and closes the dialog in ONE handler (the H8 shape).
    function RemovedOpenerHost() {
      const [open, setOpen] = React.useState(false);
      const [deleted, setDeleted] = React.useState(false);
      return (
        <main>
          <h1>Game night</h1>
          {!deleted && (
            <button type="button" onClick={() => setOpen(true)}>
              Open it
            </button>
          )}
          {open && (
            <Modal open onClose={() => setOpen(false)}>
              <Modal.Header>Delete the row</Modal.Header>
              <Modal.Body>
                <button
                  type="button"
                  onClick={() => {
                    setDeleted(true);
                    setOpen(false);
                  }}
                >
                  Delete
                </button>
              </Modal.Body>
            </Modal>
          )}
        </main>
      );
    }

    it('A: the opener was removed with the dialog, so focus lands on the page h1', async () => {
      const user = userEvent.setup();
      render(<RemovedOpenerHost />);
      const heading = screen.getByRole('heading', { name: 'Game night' });
      await user.click(screen.getByRole('button', { name: 'Open it' }));
      await screen.findByRole('dialog');

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(screen.queryByRole('button', { name: 'Open it', hidden: true })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));
    });

    // The opener stays mounted and is rerendered natively `disabled` while the dialog is open.
    // NO `tabindex` on it: jsdom focuses a disabled control that carries one, browsers refuse.
    function DisabledOpenerHost({
      openerDisabled = false,
      onCloseAutoFocus,
    }: {
      openerDisabled?: boolean;
      onCloseAutoFocus?: (event: Event) => void;
    }) {
      const [open, setOpen] = React.useState(false);
      return (
        <main>
          <h1>Game night</h1>
          <button type="button" disabled={openerDisabled} onClick={() => setOpen(true)}>
            Open it
          </button>
          <Modal open={open} onClose={() => setOpen(false)} onCloseAutoFocus={onCloseAutoFocus}>
            <Modal.Header>Start a check-in</Modal.Header>
            <Modal.Body>
              <p>When are you free?</p>
            </Modal.Body>
          </Modal>
        </main>
      );
    }

    it('B: the opener was disabled while open, so focus lands on the page h1', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<DisabledOpenerHost />);
      const heading = screen.getByRole('heading', { name: 'Game night' });
      const opener = screen.getByRole('button', { name: 'Open it' });
      await user.click(opener);
      await screen.findByRole('dialog');
      rerender(<DisabledOpenerHost openerDisabled />);
      expect(opener).toBeDisabled();
      expect(opener).not.toHaveAttribute('tabindex');

      await user.keyboard('{Escape}');
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));
    });

    // The EventDayModal -> QR shape (P-3): an outer dialog stays open under an inner one.
    function StackedHost({ shareDisabled = false }: { shareDisabled?: boolean }) {
      const [innerOpen, setInnerOpen] = React.useState(false);
      return (
        <main>
          <h1>Game night</h1>
          <Modal open onClose={() => {}}>
            <Modal.Header>Saturday</Modal.Header>
            <Modal.Body>
              <button type="button" disabled={shareDisabled} onClick={() => setInnerOpen(true)}>
                Share QR
              </button>
            </Modal.Body>
          </Modal>
          <Modal open={innerOpen} onClose={() => setInnerOpen(false)}>
            <Modal.Header>Event QR code</Modal.Header>
            <Modal.Body>
              <p>Scan to join</p>
            </Modal.Body>
          </Modal>
        </main>
      );
    }

    it('C: a disabled opener inside a still-open dialog floors to THAT dialog title, not the page', async () => {
      const user = userEvent.setup();

      // Arm 1: the opener is rerendered disabled while the inner dialog is open.
      const first = render(<StackedHost />);
      const outerTitle = screen.getByRole('heading', { name: 'Saturday' });
      const share = screen.getByRole('button', { name: 'Share QR' });
      await user.click(share);
      await screen.findByRole('dialog', { name: 'Event QR code' });
      first.rerender(<StackedHost shareDisabled />);
      expect(share).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Event QR code', hidden: true })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(outerTitle));
      first.unmount();

      // Arm 2 (WR-201 case 1): a browser blurs a button the moment it is disabled, so the inner
      // dialog opens with focus on <body> and captures NO opener. Emulated: focus, blur, then
      // open by a synthetic click that does not move focus.
      render(<StackedHost />);
      const outerTitle2 = screen.getByRole('heading', { name: 'Saturday' });
      const share2 = screen.getByRole('button', { name: 'Share QR' });
      act(() => share2.focus());
      act(() => share2.blur());
      expect(document.activeElement).toBe(document.body);
      fireEvent.click(share2);
      await screen.findByRole('dialog', { name: 'Event QR code' });
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Event QR code', hidden: true })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(outerTitle2));
    });

    // The groupHomePage Settings -> Manage Members shape: A's button closes A and opens B in ONE
    // handler. `bHasTabbable={false}` gives B a title through the house DialogTitle and no
    // tabbable child, so Radix focuses B's CONTAINER on open (FocusScope `focus(container)`).
    function ChainedHost({ bHasTabbable = true }: { bHasTabbable?: boolean }) {
      const [aOpen, setAOpen] = React.useState(false);
      const [bOpen, setBOpen] = React.useState(false);
      return (
        <main>
          <h1>Game night</h1>
          <button type="button" onClick={() => setAOpen(true)}>
            Group settings
          </button>
          {aOpen && (
            <Modal open onClose={() => setAOpen(false)}>
              <Modal.Header>Customize Group</Modal.Header>
              <Modal.Body>
                <button
                  type="button"
                  onClick={() => {
                    setAOpen(false);
                    setBOpen(true);
                  }}
                >
                  Manage members
                </button>
              </Modal.Body>
            </Modal>
          )}
          <Modal open={bOpen} onClose={() => setBOpen(false)}>
            {bHasTabbable ? (
              <Modal.Header>Manage Group Members</Modal.Header>
            ) : (
              <DialogTitle>Manage Group Members</DialogTitle>
            )}
            <Modal.Body>
              <p>Members list</p>
            </Modal.Body>
          </Modal>
        </main>
      );
    }

    // Flushes A's close: Radix dispatches the unmount autofocus event from a setTimeout queued
    // when A unmounted, so one later macrotask is guaranteed to run after it.
    async function flushClosedDialogRestore() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it('D: a chained hand-off never focuses the old opener, and closing B floors to the page h1', async () => {
      const user = userEvent.setup();
      render(<ChainedHost />);
      const heading = screen.getByRole('heading', { name: 'Game night' });
      const settings = screen.getByRole('button', { name: 'Group settings' });
      await user.click(settings);
      await screen.findByRole('dialog', { name: 'Customize Group' });

      // fireEvent (synchronous, no timer turn) so A's queued restore has NOT run yet.
      fireEvent.click(screen.getByRole('button', { name: 'Manage members' }));
      const b = screen.getByRole('dialog', { name: 'Manage Group Members' });
      const settingsFocus = vi.fn();
      settings.addEventListener('focus', settingsFocus);
      await flushClosedDialogRestore();
      // Asserted synchronously after the deterministic flush, never inside waitFor (CF-26).
      expect(settingsFocus).not.toHaveBeenCalled();
      expect(b.contains(document.activeElement)).toBe(true);

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));
      settings.removeEventListener('focus', settingsFocus);
    });

    it('D2: a chained hand-off into a dialog with no tabbable child lands on THAT dialog title', async () => {
      const user = userEvent.setup();
      render(<ChainedHost bHasTabbable={false} />);
      const settings = screen.getByRole('button', { name: 'Group settings' });
      await user.click(settings);
      await screen.findByRole('dialog', { name: 'Customize Group' });

      fireEvent.click(screen.getByRole('button', { name: 'Manage members' }));
      const b = screen.getByRole('dialog', { name: 'Manage Group Members' });
      const bTitle = screen.getByRole('heading', { name: 'Manage Group Members' });
      // Positive precondition: Radix focused B's container, which counts as lost focus.
      expect(document.activeElement).toBe(b);
      const settingsFocus = vi.fn();
      settings.addEventListener('focus', settingsFocus);
      await flushClosedDialogRestore();
      expect(settingsFocus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(bTitle);
      settings.removeEventListener('focus', settingsFocus);
    });

    // Review L-29: the same hand-off one level down, inside an outer dialog O that stays open.
    function StackedChainHost() {
      const [aOpen, setAOpen] = React.useState(false);
      const [bOpen, setBOpen] = React.useState(false);
      return (
        <main>
          <h1>Game night</h1>
          <Modal open onClose={() => {}}>
            <Modal.Header>Saturday</Modal.Header>
            <Modal.Body>
              <button type="button" onClick={() => setAOpen(true)}>
                Open A
              </button>
            </Modal.Body>
          </Modal>
          {aOpen && (
            <Modal open onClose={() => setAOpen(false)}>
              <Modal.Header>Customize Group</Modal.Header>
              <Modal.Body>
                <button
                  type="button"
                  onClick={() => {
                    setAOpen(false);
                    setBOpen(true);
                  }}
                >
                  Manage members
                </button>
              </Modal.Body>
            </Modal>
          )}
          <Modal open={bOpen} onClose={() => setBOpen(false)}>
            <DialogTitle>Manage Group Members</DialogTitle>
            <Modal.Body>
              <p>Members list</p>
            </Modal.Body>
          </Modal>
        </main>
      );
    }

    it('D3: a stacked hand-off floors from the dialog holding focus, never the outer title behind it', async () => {
      const user = userEvent.setup();
      render(<StackedChainHost />);
      const outerTitle = screen.getByRole('heading', { name: 'Saturday' });
      await user.click(screen.getByRole('button', { name: 'Open A' }));
      await screen.findByRole('dialog', { name: 'Customize Group' });

      fireEvent.click(screen.getByRole('button', { name: 'Manage members' }));
      const b = screen.getByRole('dialog', { name: 'Manage Group Members' });
      const bTitle = screen.getByRole('heading', { name: 'Manage Group Members' });
      expect(document.activeElement).toBe(b);
      const outerTitleFocus = vi.fn();
      outerTitle.addEventListener('focus', outerTitleFocus);
      await flushClosedDialogRestore();
      expect(outerTitleFocus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(bTitle);
      outerTitle.removeEventListener('focus', outerTitleFocus);
    });

    it('E: a consumer onCloseAutoFocus that does not prevent default falls through to the floor', async () => {
      const user = userEvent.setup();
      let openerEl: HTMLElement | null = null;
      // The FeedbackModalProvider failure shape: it tries its invoker, the focus does not land,
      // and it leaves the event unprevented.
      const consumer = vi.fn(() => {
        openerEl?.focus();
      });
      const { rerender } = render(<DisabledOpenerHost onCloseAutoFocus={consumer} />);
      const heading = screen.getByRole('heading', { name: 'Game night' });
      const opener = screen.getByRole('button', { name: 'Open it' });
      openerEl = opener;
      await user.click(opener);
      await screen.findByRole('dialog');
      rerender(<DisabledOpenerHost openerDisabled onCloseAutoFocus={consumer} />);

      await user.keyboard('{Escape}');
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));
      expect(consumer).toHaveBeenCalledTimes(1);
    });

    // WR-201 case 3: an autoFocus descendant already holds focus when Radix's scope mounts, so
    // Radix skips its open event and the primitive captures no opener. Decided (DECISION Phase
    // 88.6.1-20, REJECTED (f)): that case floors.
    function AutoFocusHost() {
      const [open, setOpen] = React.useState(false);
      return (
        <main>
          <h1>Game night</h1>
          <button type="button" onClick={() => setOpen(true)}>
            Rename
          </button>
          <Modal open={open} onClose={() => setOpen(false)}>
            <Modal.Header>Rename group</Modal.Header>
            <Modal.Body>
              <input autoFocus aria-label="Group name" />
            </Modal.Body>
          </Modal>
        </main>
      );
    }

    it('F: a dialog opened with an autoFocus descendant floors to the page h1 on close', async () => {
      const user = userEvent.setup();
      render(<AutoFocusHost />);
      const heading = screen.getByRole('heading', { name: 'Game night' });
      await user.click(screen.getByRole('button', { name: 'Rename' }));
      const input = await screen.findByRole('textbox', { name: 'Group name' });
      await vi.waitFor(() => expect(document.activeElement).toBe(input));

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(heading));
    });
  });

  it('closes on Escape via onClose by default', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // Phase 88.6-57 (CR-502, 88.6-REVIEW.md): Radix's `useEscapeKeydown` listens on `document`
  // in the CAPTURE phase, so it saw Escape before the Combobox's own handler and closed the
  // WHOLE dialog — createEvent opens with focus in its game combobox, so "type a game, press
  // Escape to dismiss the suggestions" threw the form away. The host now lets an EXPANDED
  // combobox own that Escape. The Clear button is a SIBLING of the input inside the combobox
  // root (`GameComboInput`'s trailing slot), which is why the guard is scoped to the root.
  describe('an open Combobox owns Escape (CR-502)', () => {
    const ITEMS: ComboboxItem[] = [
      { key: 'catan', label: 'Catan', onSelect: () => {} },
      { key: 'brass', label: 'Brass', onSelect: () => {} },
    ];

    function ComboInModal({ onClose }: { onClose: () => void }) {
      const [value, setValue] = React.useState('cat');
      const [open, setOpen] = React.useState(true);
      return (
        <Modal open onClose={onClose}>
          <Modal.Header>Create event</Modal.Header>
          <Modal.Body>
            <Combobox
              aria-label="Search for a game"
              items={ITEMS}
              value={value}
              onValueChange={setValue}
              open={open}
              onOpenChange={setOpen}
              trailing={<button type="button">Clear game selection</button>}
            />
          </Modal.Body>
        </Modal>
      );
    }

    it('Escape in the OPEN list closes the list and keeps the dialog; a second Escape closes the dialog', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ComboInModal onClose={onClose} />);
      const input = screen.getByRole('combobox', { name: 'Search for a game' });
      await user.click(input);
      // Positive settle signal: the list is open before the key is pressed.
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-expanded', 'true');

      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(input).toHaveFocus();

      // The list is closed now, so a plain Escape belongs to the dialog again.
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Escape from a sibling control INSIDE the combobox root, list open, keeps the dialog', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ComboInModal onClose={onClose} />);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      const clear = screen.getByRole('button', { name: 'Clear game selection' });
      act(() => clear.focus());
      expect(clear).toHaveFocus();
      expect(screen.getByRole('combobox', { name: 'Search for a game' })).toHaveAttribute(
        'aria-expanded',
        'true'
      );

      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // Review r2 #198 (routed from plan 88.6.1-37): the member pop-up (its floating element carries
  // `data-member-popover`) owns an Escape pressed inside it, exactly as an expanded combobox
  // does above. The harness builds its own marked element; it does not import the pop-up.
  describe('an open member pop-up owns Escape (review r2 #198)', () => {
    it('G: Escape inside the marked pop-up keeps the dialog; Escape elsewhere in it still closes', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(
        <Modal open onClose={onClose}>
          <Modal.Header>Manage Group Members</Modal.Header>
          <Modal.Body>
            <div data-member-popover="">
              <button type="button">Send friend request</button>
            </div>
            <button type="button">Remove member</button>
          </Modal.Body>
        </Modal>
      );
      const inside = screen.getByRole('button', { name: 'Send friend request' });
      act(() => inside.focus());
      expect(inside).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Manage Group Members' })).toBeInTheDocument();

      // Second arm (confirm-only, green before the fix): the guard is not a blanket Escape block.
      const outside = screen.getByRole('button', { name: 'Remove member' });
      act(() => outside.focus());
      expect(outside).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('still closes on Escape when dismissable=false (keyboard is never trapped)', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal({ dismissable: false });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // The outside-click escape hatch (D-09, StartPollModal data-loss fix) is
  // pinned at the seam we own: the guard that cancels Radix's outside event.
  // Radix's own outside-pointer DETECTION needs a real browser (E2E), not
  // jsdom — so we assert the decision logic deterministically here.
  describe('outside-dismiss escape hatch', () => {
    it('cancels the outside event when dismissable=false', () => {
      const event = { preventDefault: vi.fn() };
      preventNonDismissableClose(false, event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('leaves the outside event intact when dismissable=true', () => {
      const event = { preventDefault: vi.fn() };
      preventNonDismissableClose(true, event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  // Phase 88.6.1, wave 5 CI gate (e2e/group-settings-pending-focus.spec.ts arm 4, CI runs
  // 38972642726 / 38976822652): a press inside a SECOND dialog that is a React sibling of this
  // one must never dismiss this one. pressInStackedDialog reproduces the order production Next
  // commits the press in; its header says why a plain click cannot see this path in jsdom.
  describe('a press inside a stacked sibling dialog never dismisses the dialog beneath it', () => {
    function StackedSiblings({ onOuterClose }: { onOuterClose: () => void }) {
      const [second, setSecond] = React.useState(false);
      return (
        <>
          <Modal open onClose={onOuterClose}>
            <Modal.Header>Customize Group</Modal.Header>
            <Modal.Body>
              <button type="button" onClick={() => setSecond(true)}>
                Open the second dialog
              </button>
            </Modal.Body>
          </Modal>
          <Modal open={second} onClose={() => setSecond(false)}>
            <Modal.Header>Remove Bee?</Modal.Header>
            <Modal.Footer>
              <Modal.Action variant="secondary" onClick={() => setSecond(false)}>
                Cancel
              </Modal.Action>
            </Modal.Footer>
          </Modal>
        </>
      );
    }

    async function openSecond() {
      const onOuterClose = vi.fn();
      render(<StackedSiblings onOuterClose={onOuterClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open the second dialog' }));
      const second = await screen.findByRole('dialog', { name: 'Remove Bee?' });
      // Radix registers each layer's document pointerdown listener one macrotask after mount.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      return { onOuterClose, second };
    }

    it('MS1: Cancel in the stacked dialog closes only that dialog', async () => {
      const { onOuterClose, second } = await openSecond();
      pressInStackedDialog(within(second).getByRole('button', { name: 'Cancel' }));
      // positive signal first (CF-26): the second dialog is gone
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Bee?' })).toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(onOuterClose).not.toHaveBeenCalled();
    });

    it('MS2: the header Close in the stacked dialog closes only that dialog', async () => {
      const { onOuterClose, second } = await openSecond();
      pressInStackedDialog(within(second).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Bee?' })).toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(onOuterClose).not.toHaveBeenCalled();
    });

    // CONTROL, green on both trees by design and not counted as a pin: a press on this
    // dialog's own backdrop, with nothing stacked above it, still dismisses it. It proves the
    // stacked-dialog guard does not swallow a genuine outside press.
    it('MS3 (control): a press on the backdrop, with nothing stacked, still dismisses', async () => {
      const onOuterClose = vi.fn();
      render(<StackedSiblings onOuterClose={onOuterClose} />);
      await screen.findByRole('dialog', { name: 'Customize Group' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const backdrop = document.querySelector('[data-state="open"].fixed.inset-0');
      expect(backdrop).toBeInstanceOf(HTMLElement);
      pressInStackedDialog(backdrop as HTMLElement);
      await waitFor(() => expect(onOuterClose).toHaveBeenCalledTimes(1));
    });
  });

  // 88.6-08 (D-08). The second `.btn` emitter is retired: `Modal.Action` renders the
  // `Button` primitive and the module-private variant map is gone.
  //
  // THE SCAN IS COMMENT-STRIPPED, AND THAT IS LOAD-BEARING, NOT HYGIENE. The DECISION
  // marker in `Modal.tsx` names the retired constant on purpose — greppability is the
  // whole point of the house convention — so a RAW `git grep` for the name can never
  // reach zero without gutting the marker. The two assertions below are a matched pair:
  // the RAW source MUST still carry the name (the marker exists) and the STRIPPED source
  // must NOT (no code refers to it). Either one alone can go green while lying.
  describe('88.6-08 — the second `.btn` emitter is retired (D-08)', () => {
    it('no code in Modal.tsx refers to the retired variant map', () => {
      // Positive control FIRST: if this fails, the file was not read or the marker was
      // gutted, and the absence assertion below would be vacuous rather than true.
      expect(MODAL_SRC_RAW).toContain('ACTION_CLASS');
      expect(MODAL_SRC.length).toBeGreaterThan(1000);
      expect(MODAL_SRC).not.toContain('ACTION_CLASS');
    });

    it('Modal.tsx imports the Button primitive by module path (no barrel)', () => {
      expect(MODAL_SRC).toContain("from '@/components/ui/Button'");
    });

    it('forwards a caller ref through to the underlying button element', () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(
        <Modal open onClose={vi.fn()}>
          <Modal.Header>Delete group</Modal.Header>
          <Modal.Body>This cannot be undone.</Modal.Body>
          <Modal.Footer>
            <Modal.Action ref={ref} variant="secondary">
              Cancel
            </Modal.Action>
          </Modal.Footer>
        </Modal>
      );
      // The behaviour that makes `applyInitialFocus`'s CANCEL-focus contract REACHABLE
      // through `Modal.Action`. No call site passes a ref yet — plans 30 and 19 own the
      // destructive dialogs' initial-focus wiring.
      expect(ref.current).toBe(screen.getByRole('button', { name: 'Cancel' }));
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });
  });

  it('renders a destructive footer action affordance mapping to btn-danger', () => {
    render(
      <Modal open onClose={vi.fn()}>
        <Modal.Header>Delete group</Modal.Header>
        <Modal.Body>This cannot be undone.</Modal.Body>
        <Modal.Footer>
          <Modal.Action variant="danger">Delete</Modal.Action>
        </Modal.Footer>
      </Modal>
    );
    const danger = screen.getByRole('button', { name: 'Delete' });
    expect(danger).toHaveClass('btn', 'btn-danger');
  });
});

// ---------------------------------------------------------------------------
// Phase 88-33 Task 3 (fork 6, UAT rows 299/308/317/313/333) — ONE shared
// horizontal scale across header, body and footer.
//
// Assertions read the COMPUTED class list off a real render, not a regex over
// the source: the phase's anti-pattern register records 17 defective
// grep-shaped gates, several of which passed against JSX the regex could not
// see. A render-based pin cannot be vacuous — if the element stops existing,
// the query throws.
// ---------------------------------------------------------------------------
describe('Modal padding scale (fork 6)', () => {
  /** Walk up from the title/body text to the padded container. */
  function headerEl() {
    return screen.getByText('Start a check-in').parentElement as HTMLElement;
  }
  function bodyEl() {
    return screen.getByText('When are you free?').parentElement as HTMLElement;
  }
  function footerEl() {
    return screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
  }

  it('header, body and footer share the SAME horizontal padding at both breakpoints', () => {
    renderModal();
    // Body is the reference scale (88-32 ruling 6: `p-3 md:p-6`).
    expect(bodyEl().className).toContain('p-3');
    expect(bodyEl().className).toContain('md:p-6');

    for (const el of [headerEl(), footerEl()]) {
      expect(el.className).toContain('px-3');
      expect(el.className).toContain('md:px-6');
      // The old flat scale is what indented the title past the body content.
      expect(el.className).not.toMatch(/(^|\s)px-6(\s|$)/);
    }
  });

  it('tightens the header vertically without touching the 44px close box', () => {
    renderModal();
    expect(headerEl().className).toContain('py-2');
    expect(headerEl().className).toContain('md:py-3');
    expect(headerEl().className).not.toMatch(/(^|\s)py-5(\s|$)/);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toContain('min-h-11');
    expect(close.className).toContain('min-w-11');
  });

  // R4 B3 (88.9-52, the round-4 re-shoot: in Manage Members at 320 with 200% text the close
  // button's focus box ran past the dialog's right edge). The title could not shrink below its
  // longest word, so title plus the 88px close box were wider than the header and the close box
  // was pushed out. The title may now shrink and breaks inside a word only when that word cannot
  // fit; the close box never shrinks and keeps a gap from the title.
  // The marker is at src/app/components/Modal.tsx ("AMENDED Phase 88.9-52 (R4 B3, round 4").
  it('R4 B3 (88.9-52): the header title may shrink and break, and the close box never shrinks', () => {
    renderModal();
    const header = headerEl();
    expect(header.className.split(/\s+/)).toContain('gap-2');
    const title = header.querySelector('h2') as HTMLElement;
    expect(title, 'the header holds the dialog title').not.toBeNull();
    for (const t of ['min-w-0', 'wrap-break-word']) expect(title.className.split(/\s+/), `the title lacks ${t}`).toContain(t);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.parentElement).toBe(header);
    expect(close.className.split(/\s+/)).toContain('shrink-0');
  });

  it('88.6.1 code review A-44: the header close carries the stable `data-modal-close` hook (consumers never match its label text)', () => {
    renderModal();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveAttribute('data-modal-close');
    expect(document.querySelectorAll('[data-modal-close]')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.9 round 2 (plan 88.9-29) — the dialog fleet reads the same: ONE title
// rung (C6a, UI-SPEC R2-15), ONE close icon (E8b, R2-75) and ONE scrim token
// (C2a, R2-36). Every pin reads a real render's class tokens or attributes.
// ---------------------------------------------------------------------------
describe('Phase 88.9 round 2 — dialog fleet (C6a, E8b, C2a)', () => {
  function tokens(el: Element): string[] {
    return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }

  it('C6a (88.9): DialogTitle 20/700 leading-tight, no stacked override', () => {
    renderModal();
    const title = screen.getByRole('heading', { level: 2, name: 'Start a check-in' });
    const t = tokens(title);
    for (const token of ['text-xl', 'font-bold', 'leading-tight', 'text-content-primary']) {
      expect(t, `title carries ${token}`).toContain(token);
    }
    expect(t, 'no leading-none on the title').not.toContain('leading-none');
    expect(t, 'no tracking-tight on the title').not.toContain('tracking-tight');
    // The header passes ink only: re-passing a text size makes tailwind-merge drop the base's leading.
    // AMENDED Phase 88.9-52 (R4 B3): ink plus the two tokens that let a long title shrink and break
    // (the test R4 B3 below); still no text size.
    expect(MODAL_SRC).toContain('<DialogTitle className="min-w-0 wrap-break-word text-content-primary">');
  });

  it('E8b: header close is the stroked SVG, label Close, 44 box', () => {
    renderModal();
    const close = screen.getByRole('button', { name: 'Close' });
    const svgs = close.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect((close.textContent ?? '').trim()).toBe('');
    const t = tokens(close);
    expect(t).toContain('min-h-11');
    expect(t).toContain('min-w-11');
    expect(t).not.toContain('text-2xl');
    expect(t).not.toContain('leading-none');
  });

  it('C2a: fleet overlay is bg-surface-overlay', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const overlays = Array.from(document.querySelectorAll('[data-state="open"]')).filter(
      (el) => el !== dialog && el.getAttribute('role') !== 'dialog' && tokens(el).includes('fixed') && tokens(el).includes('inset-0')
    );
    expect(overlays).toHaveLength(1);
    const t = tokens(overlays[0]);
    expect(t).toContain('bg-surface-overlay');
    expect(t.filter((c) => c.startsWith('bg-black'))).toEqual([]);
  });
});

// 88.9-52 (A-47). MEASURED 2026-11-16 on the owner's iPhone with VoiceOver, on production: Role
// updated was not spoken while Manage Members stayed open. The root announcer's region sits
// outside the open aria-modal dialog. Each house Modal now mounts its own polite region inside
// the dialog and the announcer store routes the words to the top open one
// (src/components/ui/announcer.ts ("DECISION Phase 88.9-52 (A-47): while a house dialog is open")). jsdom shows only WHERE the
// words are; whether VoiceOver speaks them is the owner's device check.
describe('88.9-52 (A-47): an announcement made while a Modal is open lands inside that dialog', () => {
  const rootRegion = () => document.querySelector('[data-announcer="root"]') as HTMLElement;
  const dialogRegion = (dialog: HTMLElement) =>
    dialog.querySelector('[data-announcer="dialog"]') as HTMLElement;
  const land = () =>
    act(() => {
      vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Run the store's clear timer while the tree is still mounted, so it ends each test empty.
    act(() => {
      vi.runAllTimers();
    });
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function Stage({ children }: { children?: React.ReactNode }) {
    return (
      <>
        <RootAnnouncer />
        {children}
      </>
    );
  }

  function OneModal({ open = true, onClose = () => {}, title = 'Manage Group Members', children }: {
    open?: boolean;
    onClose?: () => void;
    title?: string;
    children?: React.ReactNode;
  }) {
    return (
      <Modal open={open} onClose={onClose}>
        <Modal.Header>{title}</Modal.Header>
        <Modal.Body>{children}</Modal.Body>
        <Modal.Footer>
          <Modal.Action variant="secondary">Done</Modal.Action>
        </Modal.Footer>
      </Modal>
    );
  }

  it('an open Modal carries ONE empty polite region, last in the dialog, hidden from sight and from focus', () => {
    render(<Stage><OneModal /></Stage>);
    const dialog = screen.getByRole('dialog', { name: 'Manage Group Members' });
    const regions = dialog.querySelectorAll('[data-announcer="dialog"]');
    expect(regions).toHaveLength(1);
    const region = regions[0] as HTMLElement;
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveClass('sr-only');
    expect(region).toBeEmptyDOMElement();
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).not.toHaveAttribute('id');
    // A direct child of the dialog content, after everything the consumer rendered.
    expect(dialog.lastElementChild).toBe(region);
    // The dialog's name and description wiring is untouched.
    expect(dialog).toHaveAccessibleName('Manage Group Members');
    expect(dialog).not.toHaveAttribute('aria-describedby');
    // The root region is still its own, separate node outside the dialog.
    expect(rootRegion()).not.toBeNull();
    expect(dialog.contains(rootRegion())).toBe(false);
  });

  it('the region is never a Tab stop: Tab from the last control wraps to the first', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<Stage><OneModal /></Stage>);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const done = within(dialog).getByRole('button', { name: 'Done' });
    done.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(done);
    vi.useFakeTimers();
  });

  it('with a Modal open the words land in the dialog region and never in the root region', () => {
    render(<Stage><OneModal /></Stage>);
    const dialog = screen.getByRole('dialog');
    const rootLog: string[] = [];
    const observer = new MutationObserver(() => rootLog.push(rootRegion().textContent ?? ''));
    observer.observe(rootRegion(), { childList: true, characterData: true, subtree: true });

    act(() => announceStatus('Role updated'));
    // Empty first: the region is registered before the words arrive.
    expect(dialogRegion(dialog)).toBeEmptyDOMElement();
    land();
    expect(dialogRegion(dialog)).toHaveTextContent(/^Role updated$/);
    expect(within(dialog).getByText('Role updated')).toBe(dialogRegion(dialog));
    expect(rootRegion()).toBeEmptyDOMElement();
    // One region on the whole page holds the words.
    expect(screen.getAllByText('Role updated')).toHaveLength(1);

    act(() => {
      vi.runAllTimers();
    });
    expect(dialogRegion(dialog)).toBeEmptyDOMElement();
    observer.disconnect();
    expect(rootLog).not.toContain('Role updated');
  });

  it('with no Modal open the words land in the root region, as before', () => {
    render(<Stage><OneModal open={false} /></Stage>);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => announceStatus('Settings saved'));
    land();
    expect(rootRegion()).toHaveTextContent(/^Settings saved$/);
    expect(document.querySelector('[data-announcer="dialog"]')).toBeNull();
  });

  it('stacked Modals: the top dialog takes the words; closing it restores the dialog beneath, then the root', () => {
    function Stack({ upper, lower }: { upper: boolean; lower: boolean }) {
      return (
        <Stage>
          <OneModal open={lower} title="Manage Group Members" />
          <OneModal open={upper} title="Remove Target?" />
        </Stage>
      );
    }
    // Opened one after the other, the way a confirm opens over Manage Members.
    const { rerender } = render(<Stack lower upper={false} />);
    const beneath = screen.getByRole('dialog', { name: 'Manage Group Members' });
    rerender(<Stack lower upper />);
    const upper = screen.getByRole('dialog', { name: 'Remove Target?' });
    expect(upper).not.toBe(beneath);
    expect(beneath.isConnected).toBe(true);

    act(() => announceStatus('First'));
    land();
    expect(dialogRegion(upper)).toHaveTextContent(/^First$/);
    expect(dialogRegion(beneath)).toBeEmptyDOMElement();
    expect(rootRegion()).toBeEmptyDOMElement();

    rerender(<Stack lower upper={false} />);
    act(() => announceStatus('Second'));
    land();
    expect(dialogRegion(beneath)).toHaveTextContent(/^Second$/);
    expect(rootRegion()).toBeEmptyDOMElement();

    rerender(<Stack lower={false} upper={false} />);
    act(() => announceStatus('Third'));
    land();
    expect(rootRegion()).toHaveTextContent(/^Third$/);
  });

  // Radix keeps a closed dialog's content mounted until its exit animation ends. jsdom runs no
  // animation, so these two tests give the dialog one (a different animation name once
  // data-state is closed) and end it by hand, the way the browser's animationend would.
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
  }

  it('a Modal that closes in the same tick as the announce: the words wait out its exit animation, then land in the root', () => {
    plantExitAnimation();
    function SaveAndClose() {
      const [open, setOpen] = React.useState(true);
      return (
        <Stage>
          <OneModal open={open} title="Disconnect Google Calendar?">
            <button
              type="button"
              onClick={() => {
                announceStatus('Google Calendar disconnected');
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </OneModal>
        </Stage>
      );
    }
    render(<SaveAndClose />);
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google Calendar?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    // Still mounted, closing: the planted exit animation has not ended.
    expect(dialog.isConnected).toBe(true);
    expect(dialog).toHaveAttribute('data-state', 'closed');
    // The dwell passes during the exit: the words are in NO region yet. Not the closing
    // dialog's (it is going), not the root's (the closing dialog still holds focus).
    land();
    expect(screen.queryByText('Google Calendar disconnected')).toBeNull();
    expect(dialogRegion(dialog)).toBeEmptyDOMElement();
    expect(rootRegion()).toBeEmptyDOMElement();

    endExitAnimation(dialog);
    expect(dialog.isConnected).toBe(false);
    expect(rootRegion()).toBeEmptyDOMElement();
    // One more dwell after the dialog left, then the root has the words, once.
    land();
    expect(rootRegion()).toHaveTextContent(/^Google Calendar disconnected$/);
    expect(screen.getAllByText('Google Calendar disconnected')).toHaveLength(1);
  });

  it('a confirm that closes over an open Modal in the same tick as the announce: the words wait out its exit, then land in the dialog beneath', () => {
    plantExitAnimation();
    function MembersWithConfirm() {
      const [confirmOpen, setConfirmOpen] = React.useState(false);
      return (
        <Stage>
          <OneModal open title="Manage Group Members">
            <button type="button" onClick={() => setConfirmOpen(true)}>
              Remove
            </button>
          </OneModal>
          <OneModal open={confirmOpen} title="Remove Target?">
            <button
              type="button"
              onClick={() => {
                announceStatus('Member removed');
                setConfirmOpen(false);
              }}
            >
              Confirm remove
            </button>
          </OneModal>
        </Stage>
      );
    }
    render(<MembersWithConfirm />);
    const members = screen.getByRole('dialog', { name: 'Manage Group Members' });
    fireEvent.click(within(members).getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('dialog', { name: 'Remove Target?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm remove' }));
    expect(confirm.isConnected).toBe(true);
    expect(confirm).toHaveAttribute('data-state', 'closed');

    land();
    expect(screen.queryByText('Member removed')).toBeNull();

    endExitAnimation(confirm);
    expect(confirm.isConnected).toBe(false);
    land();
    expect(dialogRegion(members)).toHaveTextContent(/^Member removed$/);
    expect(rootRegion()).toBeEmptyDOMElement();
    expect(screen.getAllByText('Member removed')).toHaveLength(1);
  });

  it('a Modal that unmounts outright on close (no exit animation) hands the words to the root after the one dwell', () => {
    function SaveAndUnmount() {
      const [shown, setShown] = React.useState(true);
      return (
        <Stage>
          {shown && (
            <OneModal open title="Create Event">
              <button
                type="button"
                onClick={() => {
                  announceStatus('Event created');
                  setShown(false);
                }}
              >
                Create Event
              </button>
            </OneModal>
          )}
        </Stage>
      );
    }
    render(<SaveAndUnmount />);
    const dialog = screen.getByRole('dialog', { name: 'Create Event' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Event' }));
    expect(dialog.isConnected).toBe(false);
    expect(rootRegion()).toBeEmptyDOMElement();
    land();
    expect(rootRegion()).toHaveTextContent(/^Event created$/);
  });

  it('a Modal that closes while its region holds the words takes them with it: the root never repeats them', () => {
    function Closable({ open }: { open: boolean }) {
      return <Stage><OneModal open={open} /></Stage>;
    }
    const { rerender } = render(<Closable open />);
    const dialog = screen.getByRole('dialog');
    act(() => announceStatus('Role updated'));
    land();
    expect(dialogRegion(dialog)).toHaveTextContent(/^Role updated$/);
    rerender(<Closable open={false} />);
    expect(rootRegion()).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(rootRegion()).toBeEmptyDOMElement();
    expect(screen.queryByText('Role updated')).toBeNull();
  });
});

// R4 L3 (88.9-52 round 4): the fleet form of G5. A screen-reader-only box is position absolute, and
// an absolute box is laid out against its nearest POSITIONED ancestor. While Modal.Body scrolled but
// was not positioned, every such box a consumer put in a Body was laid out against the dialog shell:
// it did not scroll with the Body's content, it sat where the unscrolled content put it, and in a
// dialog taller than its cap that is below the shell's foot, which made the clipping shell
// scrollable. Anything that scrolls an ancestor to reach a field (a focus on a clipped control, a
// find-in-page, a scrollIntoView) could then slide the shell up by its header and leave a blank
// band at its foot. The rule pinned here is the one G5 pinned for the event dialog,
// src/app/components/createEvent.participants.test.tsx ("G5: every sr-only or absolute box under the dialog Body is held by a positioned ancestor inside it"),
// moved to the primitive: walking up from an absolute box, a positioned ancestor comes before, or
// is, the first scrolling box. jsdom lays nothing out, so this reads class tokens; the rendered
// proof is e2e/event-dialog-reopen.spec.ts ("R4 L4 (88.9-52)").
describe('88.9-52 (R4 L3): Modal.Body holds the absolute boxes a consumer puts in it', () => {
  const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const POSITIONED = new Set(['relative', 'absolute', 'fixed', 'sticky']);
  const isPositioned = (el: Element) => tokens(el).some((t) => POSITIONED.has(t));
  const scrolls = (el: Element) => tokens(el).some((t) => /^overflow(-[xy])?-(auto|scroll)$/.test(t));

  // Every sr-only or absolute box in the dialog whose first deciding ancestor is a scrolling box
  // that is not positioned (escaped), instead of a positioned one (held).
  const escapes = (dialog: HTMLElement): string[] => {
    const out: string[] = [];
    for (const el of Array.from(dialog.querySelectorAll('*'))) {
      if (!tokens(el).some((t) => t === 'sr-only' || t === 'absolute')) continue;
      for (let up = el.parentElement; up && up !== dialog; up = up.parentElement) {
        if (isPositioned(up)) break;
        if (scrolls(up)) {
          out.push(`${el.tagName.toLowerCase()}.${tokens(el).join('.')} escapes ${up.tagName.toLowerCase()}.${tokens(up).join('.')}`);
          break;
        }
      }
    }
    return out;
  };

  function renderWithBody(bodyClassName?: string) {
    render(
      <Modal open onClose={() => {}}>
        <Modal.Header>Send feedback</Modal.Header>
        <Modal.Body className={bodyClassName}>
          <span className="sr-only" data-testid="straight-in-body">, saving</span>
          <div>
            <input type="file" aria-label="Screenshot" className="sr-only peer" />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Action>Send</Modal.Action>
        </Modal.Footer>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const body = screen.getByTestId('straight-in-body').parentElement as HTMLElement;
    return { dialog, body };
  }

  it('L3: an sr-only box straight in the Body, and one nested in it, are held by the Body', () => {
    const { dialog, body } = renderWithBody();
    // Guard: the Body is the scrolling box and it does hold such boxes, so the empty list below
    // is not empty by having nothing to check.
    expect(scrolls(body)).toBe(true);
    expect(body.querySelectorAll('.sr-only')).toHaveLength(2);
    expect(escapes(dialog)).toEqual([]);
    expect(tokens(body)).toEqual(expect.arrayContaining(['relative', 'flex-1', 'overflow-y-auto']));
  });

  it('L3: a consumer padding or layout override on the Body keeps it positioned', () => {
    for (const override of ['p-0 md:p-0', 'flex flex-col p-0 md:p-0', 'pt-4 md:pt-4', 'space-y-2']) {
      const { dialog, body } = renderWithBody(override);
      expect(tokens(body), override).toContain('relative');
      expect(escapes(dialog), override).toEqual([]);
      cleanup();
    }
  });

  it('L3: the shell still clips and the Body is still the only scrolling box of the three parts', () => {
    const { dialog, body } = renderWithBody();
    expect(tokens(dialog)).toContain('overflow-hidden');
    expect(scrolls(dialog)).toBe(false);
    const parts = Array.from(dialog.children).filter((el) => el !== dialog.lastElementChild);
    expect(parts.filter(scrolls)).toEqual([body]);
  });
});
