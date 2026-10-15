'use client';

/**
 * useFocusRecovery — the one armed hook for Requirement 5 (Phase 88.6.1, D-04 / D-05): when an
 * action removes the element a keyboard or screen-reader user stood on, focus goes to the host's
 * target instead of falling to `<body>`.
 *
 * The host arms it synchronously at the action and settles it when its own work ends. It acts
 * only AFTER the removal is in the DOM (a MutationObserver on the document, live only while
 * armed) and only when focus is LOST (`isFocusLost`). Target order: the host's `preferred`
 * resolver, then its `fallback`, then `focusPageFloor` (the open dialog's title, `main h1`, `main`).
 */
import * as React from 'react';

import { DIALOG_ROLE_SELECTOR, focusElement, focusPageFloor, isFocusLost } from './focusPageFloor';

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
  watched: Element | null;
  observer: MutationObserver;
  onFocusIn: (event: FocusEvent) => void;
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
  }, []);

  const check = React.useCallback(() => {
    const armed = armedRef.current;
    if (!armed || !isFocusLost()) return;
    const { watched, preferred } = armed;
    if (!watched || watched.isConnected) return;
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

      const onFocusIn = (event: FocusEvent) => {
        const current = armedRef.current;
        if (!current || current.id !== id) return;
        if (isLive(event.target)) current.watched = event.target;
      };
      const observer = new MutationObserver(() => check());

      armedRef.current = {
        id,
        preferred: armOptions.preferred,
        settled: false,
        watched,
        observer,
        onFocusIn,
      };
      document.addEventListener('focusin', onFocusIn, true);
      observer.observe(document.body, { childList: true, subtree: true });

      return () => {
        const current = armedRef.current;
        if (current && current.id === id) current.settled = true;
      };
    },
    [check, disarm]
  );

  React.useEffect(() => disarm, [disarm]);

  return { arm };
}
