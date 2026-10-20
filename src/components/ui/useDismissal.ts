'use client';

/**
 * useDismissal — the ONE shared dismissal hook for a host that opens a small panel from a trigger
 * (a kebab list, a notification dropdown). It carries four pieces, extracted from KebabMenu:
 *   1. the outside mousedown listener, registered ONLY while the host is open;
 *   2. the container Escape handler (`containerProps.onKeyDown`);
 *   3. the non-null relatedTarget focusout rule (`containerProps.onBlur`);
 *   4. the isConnected-guarded restore to the trigger (`restoreFocusToTrigger`).
 * The host spreads `containerProps` onto the element its `containerRef` points at, and calls
 * `restoreFocusToTrigger()` itself after any close of its own that unmounts the focused control.
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
 * document (`src/app/components/ClickableMemberName.js:552-557`, "`useDismiss` ALSO registers the
 * same callback on the DOCUMENT"). It also needs a floating context that neither consumer has,
 * and its name sits one letter from this hook's: they are different engines.
 * REJECTED (d): the hook owning `open`. KebabMenu's close-resets effect
 * (`src/app/components/KebabMenu.js:203-214`, `}, [open, armedIndex]);`) and KM-17 depend on a
 * dismissal changing ONLY the host's `open`, and the bell's `isOpen` drives both of its
 * triggers' `aria-expanded`. A host-owned state keeps both hosts' state shapes unchanged.
 * Changing the event to a document listener, or the event type to pointerdown, is a decision, not
 * a cleanup.
 * AMENDED Phase 88.6.1-80: one exemption added — an open modal dialog that does not contain the
 * container is a layer ABOVE the surface, so a press while it is open, and focus moving into it,
 * never dismiss the surface. See `DECISION Phase 88.6.1-80 (modal layer above, D-18)` below.
 */
import * as React from 'react';

/* DECISION Phase 88.6.1-80 (modal layer above, D-18): CHOSEN — a modal dialog (an element carrying
   aria-modal true: the house Modal, `src/app/components/Modal.tsx`, and BottomSheet,
   `src/components/ui/BottomSheet.tsx`) that is open and does NOT contain the container is a layer
   ABOVE the surface. While one is open, no press dismisses the surface — a press inside its content
   AND a press on its dimmed overlay (rendered outside the content element, `src/components/ui/dialog.tsx`, anchor
   `<DialogOverlay />`) both belong to that dialog — and focus moving into it is not the person
   leaving the surface (the page beneath a modal is inert, and the dialog's close restore returns
   focus to the element that opened it). One Escape or one overlay press closes one layer: the
   dialog's own. A dialog in its exit animation (data-state closed) no longer counts.
   The load-bearing fact for the overlay press (review #92): Radix Dialog passes
   `deferPointerDownOutside: true` (`node_modules/@radix-ui/react-dialog/dist/index.mjs:229`, v1.1.17,
   spread after the consumer's props, so no prop turns it off), so a PRIMARY-button press outside the
   content is dismissed at the click, after this hook's mousedown has seen the dialog still open.
   RESIDUAL, with its size: a NON-primary press on the overlay (mouse middle or right button) is
   dismissed at pointerdown (`node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs:240-241`,
   v1.1.13, anchor `if (!deferPointerDownOutside || event.button !== 0) {`), before this hook's
   mousedown, which then finds no open dialog and dismisses the surface too — that press closes both
   layers. Touch and primary presses are button 0 and deferred; the cost is the surface closing
   with the dialog.
   Escape is untouched: a dialog hosted outside the surface's component tree (the report form,
   hosted by FeedbackModalProvider at the layout root, plan 88.6.1-69) never delivers its keydown to
   the container handler, and Radix claims Escape there in the capture phase.
   The kebab's record of "THE ONE COMPOSITION WHERE THIS CONTRACT DOES NOT HOLD"
   (`src/app/components/KebabMenu.js`, a non-Radix layer INSIDE a dialog, where the dialog below
   still closes first) is untouched: a dialog that contains the container is below it, never above.
   REJECTED: (a) a React-tree press record (a capture-phase press prop on the container) and a
   portal-origin rule for keys and focus moves — no consumer needs them once the report form lives
   in FeedbackModalProvider (orchestrator decision 2026-10-05: a mechanism with no user is not
   shipped); (b) checking only the press target's nearest modal ancestor — it misses the dimmed
   overlay, which sits outside the content, so one tap would close two layers; (c) wrapping the
   surface in Radix's DismissableLayer and its layer stack — a second dismissal engine, where D-18
   says one hook (plan 05 already rejected floating-ui's useDismiss); (d) an explicit layer tree in
   context — every dialog primitive would have to register; (e) a deferred focus check on a timer or
   a microtask — the kebab's focusout record already rejected a deferred check; (f) a
   default-prevented bail on Escape (KM-7).
   Changing this is a decision, not a cleanup. */
const MODAL_LAYER_SELECTOR = '[aria-modal="true"]:not([data-state="closed"])';

/** Every open modal dialog in the container's document that does not contain the container. */
function openModalLayersAbove(container: HTMLElement): Element[] {
  return Array.from(container.ownerDocument.querySelectorAll(MODAL_LAYER_SELECTOR)).filter(
    (dialog) => !dialog.contains(container)
  );
}

export interface UseDismissalOptions {
  /** The host's open state. The hook reads it and never writes it. */
  open: boolean;
  /** Called when the person dismisses. The host closes (and does nothing else it would not do on
   *  any other close). */
  onDismiss: () => void;
  /** The element that holds the trigger and the panel. A press or a focus move INSIDE it is never a
   *  dismissal. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The control that opened the panel. Escape returns focus to it. */
  triggerRef: React.RefObject<HTMLElement | null>;
}

/** Spread onto the host's container element. These two members are the type's final shape. */
export interface DismissalContainerProps {
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onBlur: (event: React.FocusEvent<HTMLElement>) => void;
}

export interface Dismissal {
  containerProps: DismissalContainerProps;
  /** Focus the trigger, but only while it is still in the document. */
  restoreFocusToTrigger: () => void;
}

export function useDismissal({
  open,
  onDismiss,
  containerRef,
  triggerRef,
}: UseDismissalOptions): Dismissal {
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
  // POINTER dismissal only. The focusout rule below is the KEYBOARD half beside it, and it
  // deliberately does not guess about pointers. Deleting either one leaves a dismissal hole — that
  // is a decision, not a cleanup.
  //
  // Registered ONLY while open, and the cleanup removes the very function it added, so a closed
  // host leaves nothing on the document that could close a later surface.
  React.useEffect(() => {
    if (!open) return;
    function handleOutsideMouseDown(event: MouseEvent) {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) {
        // Plan 88.6.1-80: a press while a modal dialog is open above the surface belongs to that
        // dialog, inside its content or on its overlay.
        if (openModalLayersAbove(container).length > 0) return;
        onDismissRef.current();
      }
    }
    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
    // containerRef is a stable ref object; the effect depends on `open` only, by design (P4).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Focus returns to the trigger after a close that unmounted the focused control. GUARDED on the
     trigger still being in the document, because a committing action can unmount its own row and
     take the trigger with it (the kebab's Remove: `src/app/components/ManageMembers.js:247-248`,
     `removeUserFromGroup` then `await fetchMembers();`). On that path the guard is exactly
     equivalent to no restore: it prevents focusing a detached node, not a lost focus position.
     Recovering focus after a host refresh is the HOST's job (plan 88.6.1-04's helper, D-04). */
  const restoreFocusToTrigger = () => {
    const trigger = triggerRef.current;
    if (trigger && trigger.isConnected) trigger.focus();
  };

  /* DECISION Phase 88.6-16 (D-12) (moved here from KebabMenu.js by 88.6.1-05): Escape is bound on
     the host's CONTAINER, as a React onKeyDown handed back in `containerProps`, and claims the key
     with preventDefault() + stopPropagation() only when it ACTS (host open, key Escape) — chosen
     OVER a document listener.
     WHY: a document listener cannot scope Escape to the innermost open layer. Two document bubble
     listeners fire in registration order, and preventDefault cannot un-run the one that already
     ran. The live document listener this contract protects is the description collapse at
     `src/app/gameDetail/page.js:519-537` (`if (!descExpanded) return;`), which bails on
     `event.defaultPrevented` at `:522`. Both states can be live at once (expand the description,
     then open the kebab), so without the claim one Escape would close the panel AND collapse the
     description. `src/app/components/FeedbackButton.js:42-46` (`DECISION Phase 88-17`) records the
     house preference for not stacking document-level Escape listeners.
     stopPropagation here stops React-tree ancestors only (KM-6). In production Next 14's app
     router hydrates React on document itself (the next package's dist/client/app-index.js sets its
     app element to document), so a document-level listener — Header's hamburger Escape, the
     description collapse — sits on the same node as React's root listeners and STILL RUNS after
     this handler; only preventDefault plus that listener's own default-prevented bail protects it.
     So the description collapse is protected by preventDefault and its own bail at `:522`, not by
     stopPropagation. For a consumer rendered INSIDE the Header hamburger (NotificationBell's row
     variant, plan 88.6.1-28) the Header collision is live — `src/app/Header.js:31-42`
     (`if (!mobileMenuOpen) return;`) — so Header's bail (plan 88.6.1-45, D-08a) is REQUIRED, and
     this handler's contract is to call preventDefault so the bail can see it — research P-10.
     Hook test E5 models that production topology.
     NO default-prevented bail of its own, deliberately: KM-7 measures that the kebab still claims
     the key after Radix preventDefaulted it inside a Modal, and a bail would let the in-dialog
     ancestor see it. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
    restoreFocusToTrigger();
  };

  /* DECISION Phase 88.6-16 (D-12) (moved here from KebabMenu.js by 88.6.1-05): a focusout dismisses
     the host ONLY when `relatedTarget` is non-null AND outside the container. A NULL relatedTarget
     NEVER dismisses.
     WHY: null is ambiguous, not "left the document". It is also what a pointer press over
     non-focusable inside chrome (the `py-1` band on the kebab's list) or over a disabled item
     produces — so dismissing on null closes the host on an INSIDE tap and silently disarms a live
     two-tap gate (the kebab's Remove, `src/app/components/ManageMembers.js:723` (`twoTap: true`),
     and `src/app/components/OpenPollsList.js:288` (`twoTap: true`)). Pointer dismissal is already
     owned by the outside mousedown listener above; this half exists for the keyboard and does not
     need to guess about pointers.
     REJECTED, kept not deleted: (a) a deferred `document.activeElement` / `document.hasFocus()`
     check — it fails the same inside-tap case and is untestable in jsdom (measured: no focusout
     fires on a disabled item); (b) treating a null relatedTarget as "left the document".
     Bound through React's onBlur, which is implemented on `focusout` and bubbles (React has no
     `onFocusOut` prop) — so there is no listener to remove and no per-row leak. */
  const onBlur = (event: React.FocusEvent<HTMLElement>) => {
    if (!open) return;
    const next = event.relatedTarget;
    if (!next) return;
    const container = containerRef.current;
    if (container && container.contains(next as Node)) return;
    // Plan 88.6.1-80: focus moving into an open modal dialog above the surface is not the person
    // leaving it.
    if (container && openModalLayersAbove(container).some((dialog) => dialog.contains(next as Node))) return;
    onDismiss();
  };

  return { containerProps: { onKeyDown, onBlur }, restoreFocusToTrigger };
}
