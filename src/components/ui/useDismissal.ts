'use client';

/**
 * useDismissal — the ONE shared dismissal hook for a host that opens a small panel from a trigger
 * (a kebab list, a notification dropdown).
 *
 * DECISION Phase 88.6.1-05 (D-18): ONE hook, consumed by KebabMenu (this plan) and by
 * NotificationBell (planned, plan 88.6.1-28), with the HOST owning the open state. The hook never
 * holds `open`; it only asks the host to dismiss through `onDismiss`.
 * REJECTED (a): a copy of these pieces inside NotificationBell. That is the duplication tenet, and
 * D-18 says "never a copy".
 * REJECTED (b): a document-level keydown listener for Escape. Document bubble listeners run in
 * registration order and cannot be claimed, so Header's earlier-registered listener would run
 * first (research P-10), and an ancestor React handler would also see the key (KM-6).
 * REJECTED (c): `@floating-ui/react`'s `useDismiss`. Measured, it ALSO binds its Escape on the
 * document (`src/app/components/ClickableMemberName.js:552-557`, "registers the same callback on
 * the DOCUMENT"). It also needs a floating context that neither consumer has, and its name sits one
 * letter from this hook's: they are different engines.
 * REJECTED (d): the hook owning `open`. KebabMenu's close-resets effect
 * (`src/app/components/KebabMenu.js:149-160`) and KM-17 depend on a dismissal changing ONLY the
 * host's `open`, and the bell's `isOpen` drives both of its triggers' `aria-expanded`. A host-owned
 * state keeps both hosts' state shapes unchanged.
 * Changing the event to a document listener, or the event type to pointerdown, is a decision, not
 * a cleanup.
 */
import * as React from 'react';

export interface UseDismissalOptions {
  /** The host's open state. The hook reads it and never writes it. */
  open: boolean;
  /** Called when the person dismisses. The host closes (and does nothing else it would not do on
   *  any other close). */
  onDismiss: () => void;
  /** The element that holds the trigger and the panel. A press or a focus move INSIDE it is never a
   *  dismissal. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The control that opened the panel. */
  triggerRef: React.RefObject<HTMLElement | null>;
}

export function useDismissal({ open, onDismiss, containerRef }: UseDismissalOptions): void {
  // Latest-callback ref, synced in a no-deps effect (the useConfirmAction.ts idiom): the outside
  // listener below is registered once per open and must still call the NEWEST onDismiss.
  const onDismissRef = React.useRef(onDismiss);
  React.useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  // Outside press closes the panel. The event is mousedown, never pointerdown: on a phone a
  // pointerdown fires at the start of a scroll gesture, so an open panel would close when the person
  // scrolls the page, while a mousedown is synthesised only after a completed tap. It is also what
  // both shipped consumers used, and this is a behaviour-preserving extraction.
  //
  // KEEP BOTH CLOSE PATHS. This outside mousedown listener is not wrong, it is INCOMPLETE: it owns
  // POINTER dismissal only. The focusout rule on the host's container is the KEYBOARD half beside
  // it, and it deliberately does not guess about pointers. Deleting either one leaves a dismissal
  // hole — that is a decision, not a cleanup.
  //
  // Registered ONLY while open, and the cleanup removes the very function it added, so a closed
  // host leaves nothing on the document that could close a later surface.
  React.useEffect(() => {
    if (!open) return;
    function handleOutsideMouseDown(event: MouseEvent) {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) {
        onDismissRef.current();
      }
    }
    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
    // containerRef is a stable ref object; the effect depends on `open` only, by design (P4).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
