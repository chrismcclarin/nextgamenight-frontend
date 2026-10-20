'use client';

/**
 * useFocusRecovery — the one armed hook for Requirement 5 (Phase 88.6.1, D-04 / D-05): when an
 * action removes the element a keyboard or screen-reader user stood on, focus goes to the host's
 * target instead of falling to `<body>`.
 *
 * The host arms it synchronously at the action and settles it when its own work ends. It acts
 * only AFTER the removal is in the DOM (a MutationObserver on the document, live only while
 * armed) and only when focus is LOST (`isFocusLost`) FROM a removed element. Target order: the
 * host's `preferred` resolver, then its `fallback`, then `focusPageFloor` (the open dialog's
 * title, `main h1`, `main`). After recovering once it is disarmed.
 *
 * What it deliberately does NOT do:
 * - It never focuses at settle time. A TanStack host commits the removal one macrotask after
 *   `await invalidateQueries()` resolves, so "after the await" is too early.
 * - It never moves a user who already moved on. The moved-on signal is the BLUR of a
 *   still-connected watched element (a capture-phase focusout with a null `relatedTarget`,
 *   checked one macrotask later: still connected and focus lost means the user pressed blank
 *   page area), not a read taken when a mutation arrives. An unrelated mutation that lands while
 *   focus is lost and the watched element is still connected (a success toast, a spinner, an
 *   inline status line) leaves the hook armed, so the removal that follows is still recovered.
 *   After `settle()` has taken effect, a focus move from one live element to another disarms it.
 * - It never fights a dialog's own close restore. When the watched element was inside a dialog
 *   that has since closed, the `Modal` restore (`DECISION Phase 88.6-44`, `Modal.tsx:173`) and
 *   plan 88.6.1-20's floor own that moment; the hook follows the restored element and recovers
 *   if THAT is later removed.
 * - No logging, no network, no storage, and no user-facing string of any kind.
 *
 * CONSUMER CONTRACT (plans 88.6.1-20, 21, 29, 30, 37, 41, 42, 44, 47, 69, 70 and 74 read this):
 * (1) Call `arm()` synchronously at the START of the action, before any await. Pass `preferred`
 *     when a better target exists (for example the next row), and keep `fallback` as the section
 *     heading or expand control (D-05). A host whose activating control is NOT a KebabMenu item
 *     passes `from: event.currentTarget` (Safari does not focus a clicked button; KebabMenu hosts
 *     are covered by `restoreFocusToTrigger`'s focusin).
 * (2) Call `settle()` in `finally` when the host's own work ends. The refresh may commit later,
 *     and the hook still acts. `settle()` takes effect one macrotask after the call, so settling
 *     synchronously in the same task as a focus restore is safe.
 * (3) The acted-on control must stay focusable while in flight: `aria-disabled` plus a ref latch,
 *     never native `disabled` (the rule of POSITION, `DECISION Phase 88.6-22`,
 *     `FriendInvitePanel.js:59`). A native disable blurs it, and the hook then reads the user as
 *     having moved on.
 * (4) Inside a `Modal`, `fallback` may be omitted: the floor finds the dialog's title.
 * (5) A closing dialog's restore is the primitive's, and the hook follows it.
 * (6) Do not add a fallback prop to `KebabMenu` (`KebabMenu.js:172-183`).
 * (7) In tests, wait for a POSITIVE signal (`waitFor` on `document.activeElement` toBe the
 *     target), with a deferred refetch in the RED arm (P-6).
 * (8) A host may arm and settle on FOCUS to watch a control that an unpressed refresh can remove
 *     (plans 37, 69, 70); `arm()` seeds from the focused control, and the post-settle rules apply
 *     unchanged.
 */
import * as React from 'react';

import {
  DIALOG_ROLE_SELECTOR,
  focusElement,
  focusPageFloor,
  isFocusLost,
  isOpenDialog,
} from './focusPageFloor';

export interface FocusRecoveryOptions {
  /**
   * The host's section heading, or its expand control when the section has no heading (D-05).
   * Required for a host outside a dialog (D-05); a host inside a Modal may omit it — the floor
   * resolves to that dialog's own title.
   */
  fallback?: React.RefObject<HTMLElement | null>;
}

export interface ArmOptions {
  /** A better target than the fallback, e.g. the next row's control. */
  preferred?: () => HTMLElement | null | undefined;
  /** The control the user activated (`event.currentTarget`), for a non-KebabMenu host. */
  from?: Element | null;
}

export interface FocusRecovery {
  /** Arm at the action; returns `settle`, called in `finally` when the host's work ends. */
  arm: (options?: ArmOptions) => () => void;
}

interface ArmedState {
  id: number;
  preferred?: () => HTMLElement | null | undefined;
  settled: boolean;
  /** The live element the user was last on during this arm. */
  watched: Element | null;
  /** The dialog that contained `watched` when it was recorded (null outside any dialog). */
  watchedDialog: Element | null;
  observer: MutationObserver;
  onFocusIn: (event: FocusEvent) => void;
  onFocusOut: (event: FocusEvent) => void;
}

/** Connected, not `<body>`, not a dialog container. */
function isLive(el: EventTarget | null | undefined): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    el !== el.ownerDocument.body &&
    !el.matches(DIALOG_ROLE_SELECTOR)
  );
}

/* DECISION Phase 88.6.1-04 (D-04): the hook is armed at the action (or on focus, contract (8)),
   seeded from `from` else the focused control; a MutationObserver on the document, live only
   while armed, triggers the check; it acts only when focus is lost FROM a removed element; the
   moved-on signal is the blur of a still-connected watched element (capture-phase focusout, null
   `relatedTarget`, checked one macrotask later); `settle()` takes effect one macrotask later, so
   a KebabMenu restore in the same click task (`KebabMenu.js:237-239`, `:268-269`,
   `restoreFocusToTrigger();`) is followed as a pre-settle move; it defers to a closing dialog's
   restore.

   RESIDUAL, named: a Safari mouse user who clicks a button and then clicks blank space produces
   no focus events at all, so the hook cannot tell them from a user still on the button, and
   recovers them to the heading when the row is removed.

   REJECTED, each kept here so it is not re-proposed as a tidy-up:
   (a) await-then-focus: TanStack commits the removal one macrotask after the await resolves
       (`@tanstack/query-core` dist `notifyManager.js:3`, `systemSetTimeoutZero`), so focus would
       move off a still-mounted row. Shown RED by a throwaway in task 1.
   (b) per-host inline copies: about seven hosts, rejected by tenet.
   (c) a KebabMenu fallback prop: its own marker (`KebabMenu.js:172-183`), and D-04.
   (d) a no-deps `useEffect` as the trigger (RESEARCH M-2.3's sketch): it observes only its own
       component's commits, so a removal committed by a child's state (ScheduleList's inline
       confirm row under PromptScheduleManager) or one that unmounts this component is never
       checked. Radix FocusScope uses a MutationObserver for the same event.
   (e) acting on any `<body>` focus, or reading "moved on" at mutation time: the first would move
       a pointer user who clicked blank space; the second disarms on any unrelated mutation that
       lands while focus is lost (a toast), which on Safari, where the click never focused the
       button, is the common flow.
   (f) a post-settle time limit on the arm: a refetch can land after any fixed window, and a bound
       would drop the recovery the hook exists for.
   (g) a `cancel()` or `settle({ removed: false })` on a failed action: a failed response can
       still be followed by a refetch that removes the row, and the user would then fall to
       `<body>`. The cost of rejecting (f) and (g) is an O(1) check per mutation batch until
       recovery, a moved-on signal, re-arm or unmount.
   It is a decision, not a cleanup. */
export function useFocusRecovery(options: FocusRecoveryOptions = {}): FocusRecovery {
  const fallbackRef = React.useRef(options.fallback);
  fallbackRef.current = options.fallback;

  const armedRef = React.useRef<ArmedState | null>(null);
  const nextIdRef = React.useRef(0);

  const disarm = React.useCallback(() => {
    const armed = armedRef.current;
    if (!armed) return;
    armedRef.current = null;
    armed.observer.disconnect();
    document.removeEventListener('focusin', armed.onFocusIn, true);
    document.removeEventListener('focusout', armed.onFocusOut, true);
  }, []);

  const check = React.useCallback(() => {
    const armed = armedRef.current;
    if (!armed || !isFocusLost()) return;
    const { watched, watchedDialog, preferred } = armed;
    // Focus was never on a live element during this arm: moving it would be the "unrequested
    // jump" the availability-form precedent declines (`availability-form/[token]/page.js:263`).
    if (!watched) {
      disarm();
      return;
    }
    // Still connected: a mutation-time read cannot tell a user who moved on from a mutation
    // that merely arrived first. The moved-on signal is the focusout rule in `arm()`.
    if (watched.isConnected) return;
    // The dialog that held it has closed: its own restore owns this moment; follow it.
    if (watchedDialog && !isOpenDialog(watchedDialog)) return;

    // Captured BEFORE disarming: inside a Modal this is the container Radix focused, so the floor
    // lands on THAT dialog's title.
    const origin = document.activeElement;
    // Disarm FIRST, so the hook's own focus move is never observed.
    disarm();
    if (focusElement(preferred?.())) return;
    if (focusElement(fallbackRef.current?.current)) return;
    focusPageFloor(origin);
  }, [disarm]);

  const arm = React.useCallback(
    (armOptions: ArmOptions = {}) => {
      disarm();
      nextIdRef.current += 1;
      const id = nextIdRef.current;
      const active = document.activeElement;
      const watched = isLive(armOptions.from) ? armOptions.from : isLive(active) ? active : null;

      const current = () => {
        const armed = armedRef.current;
        return armed && armed.id === id ? armed : null;
      };

      const onFocusIn = (event: FocusEvent) => {
        const armed = current();
        if (!armed || !isLive(event.target)) return;
        // After settle, a move from one LIVE control to another is the user moving on. A focusin
        // from `<body>` or from a dialog container (a restore) is followed.
        if (armed.settled && isLive(event.relatedTarget)) {
          disarm();
          return;
        }
        armed.watched = event.target;
        armed.watchedDialog = event.target.closest(DIALOG_ROLE_SELECTOR);
      };

      const onFocusOut = (event: FocusEvent) => {
        const armed = current();
        const left = armed?.watched;
        if (!left || event.target !== left || event.relatedTarget !== null) return;
        setTimeout(() => {
          if (!current()) return;
          // Still connected and focus lost: the user pressed blank page area. A window or app
          // blur leaves it the active element (not lost); a removal is left to `check()`.
          if (left.isConnected && isFocusLost()) disarm();
        }, 0);
      };

      const observer = new MutationObserver(() => check());

      armedRef.current = {
        id,
        preferred: armOptions.preferred,
        settled: false,
        watched,
        watchedDialog: watched ? watched.closest(DIALOG_ROLE_SELECTOR) : null,
        observer,
        onFocusIn,
        onFocusOut,
      };
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('focusout', onFocusOut, true);
      observer.observe(document.body, { childList: true, subtree: true });

      return () => {
        // Takes effect one macrotask later; a replaced arm's settle is a no-op (id guard).
        setTimeout(() => {
          const armed = current();
          if (armed) armed.settled = true;
        }, 0);
      };
    },
    [check, disarm]
  );

  // On unmount: one final check, then disconnect. A MutationObserver record already queued by
  // the commit that removed this host runs first; the final check covers the case where the
  // observer has not fired yet (a host whose own unmount IS the removal).
  React.useEffect(
    () => () => {
      queueMicrotask(() => {
        check();
        disarm();
      });
    },
    [check, disarm]
  );

  return { arm };
}
