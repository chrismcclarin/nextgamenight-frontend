/**
 * focusPageFloor — the focus primitives Requirement 5 shares (Phase 88.6.1, D-04 / D-05 / D-07).
 *
 * This module is DOM-only: no React, no directive. It is imported by `useFocusRecovery` (the one
 * armed hook a host uses when its action removes the row a user stood on) and by the `Modal` /
 * `BottomSheet` close floor (plan 88.6.1-20). One definition of "focus is lost", one way to put
 * focus on a target that may not be focusable, and one page floor — never per-host copies.
 *
 * What it deliberately does NOT do:
 * - It mints nothing: no heading, no screen-reader-only text, no string of any kind (D-05, OQ-5).
 *   It only moves focus and, when a target cannot take focus, adds `tabindex="-1"` to it.
 * - It never touches a `tabindex` attribute an element already carried.
 * - It adds no class and no inline style. Any focus ring after keyboard use is the browser's
 *   (P-11), and a look question for Phase 88.9, not this module's.
 */

/** Both dialog roles. Radix DialogContent renders `role="dialog"`; an alert dialog counts too. */
export const DIALOG_ROLE_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/**
 * True when `el` is a connected dialog container that is not closing. Radix keeps `data-state`
 * on the content through the exit animation (`@radix-ui/react-dialog` dist `index.mjs:226`), so
 * a `closed` container is treated as already gone.
 */
export function isOpenDialog(el: Element | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  if (!el.matches(DIALOG_ROLE_SELECTOR)) return false;
  return el.getAttribute('data-state') !== 'closed';
}

/**
 * THE one definition of "focus was lost" (D-04): `document.activeElement` is null, is `<body>`,
 * is no longer connected, or is a dialog CONTAINER. The last arm is load-bearing: when the
 * focused node inside a trapped Radix dialog is removed, FocusScope moves focus to the container
 * (`@radix-ui/react-focus-scope` dist `index.mjs:52-57`, `handleMutations2`), so inside a dialog
 * "lost" never reads as `<body>`.
 */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body) return true;
  if (!active.isConnected) return true;
  return active.matches(DIALOG_ROLE_SELECTOR);
}

const HEADING_TAG = /^H[1-6]$/;

/**
 * Focus `el` and report whether focus really landed there (the OUTCOME check — a natively
 * disabled or otherwise unfocusable node fails it, which a presence or `isConnected` test would
 * miss, W014). A plain boolean, not a type predicate: a real `HTMLElement` can refuse focus, so a
 * predicate's false branch would wrongly exclude `HTMLElement`. A caller that needs the narrowed
 * type narrows with its own `instanceof HTMLElement`.
 *
 * When the first attempt fails and `el` has NO `tabindex` attribute, it adds `tabindex="-1"` and
 * tries once more. A retry that still fails removes that attribute at once (no residue). A retry
 * that succeeds hands the added attribute to the tabindex-lifetime rule below. `focus()` is
 * called with the default scroll behaviour on purpose (see the floor's DECISION marker, REJECTED
 * (g)).
 *
 * THE TABINDEX-LIFETIME RULE (its one statement; everything else that relies on `focusElement`
 * points here). It governs ONLY an attribute this function added.
 * - `keepAdded` is computed ONCE, when the attribute is added, never at blur time: a dialog in
 *   its exit animation carries `data-state="closed"`, and a blur-time reading would flip a node
 *   inside it into the strip branch.
 * - keepAdded (a heading, native or `role="heading"`, or a node inside an OPEN dialog): no
 *   listener; the attribute lives as long as the node. Inside a dialog it must, because Radix's
 *   trap pulls focus back to the last focused node with a bare `focus()` (`react-focus-scope`
 *   dist `index.mjs:43`); had the attribute been stripped, that pull-back would land on a node
 *   that can no longer take focus and Shift+Tab would leave the modal. A heading wraps no menu,
 *   so keeping it costs nothing, and a window blur can never strip it.
 * - otherwise (in practice `<main>`): strip it, but only once focus has REALLY left. A
 *   PERSISTENT `blur` listener (not once-only) schedules one MACROTASK; when that runs and `el`
 *   is no longer the active element, the attribute and the listener go. When `el` is still
 *   active (a window or app switch, or focus pulled straight back) nothing happens and the
 *   listener stays. This is the CONSEQUENCE constraint from `DECISION Phase 88.6-16 (D-12)`
 *   (`KebabMenu.js:316`, a focusout closes the menu ONLY on a non-null `relatedTarget`): a
 *   permanently focusable page container would turn a pointer press's null `relatedTarget` into a
 *   non-null one, so an inside tap would close the menu and disarm a live two-tap gate.
 * - Two shapes that look right and are wrong: a MICROTASK check (during a browser focus move a
 *   microtask checkpoint can run before the new element is focused, so `el` still reads as
 *   active and the strip never fires), and a ONCE-ONLY listener (a window blur consumes it while
 *   correctly declining to strip, leaving `<main>` focusable for good).
 */
export function focusElement(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const doc = el.ownerDocument;
  el.focus();
  if (doc.activeElement === el) return true;
  if (el.hasAttribute('tabindex')) return false;

  el.setAttribute('tabindex', '-1');
  el.focus();
  if (doc.activeElement !== el) {
    el.removeAttribute('tabindex');
    return false;
  }

  const keepAdded =
    isOpenDialog(el.closest(DIALOG_ROLE_SELECTOR)) ||
    HEADING_TAG.test(el.tagName) ||
    el.getAttribute('role') === 'heading';
  if (!keepAdded) stripAddedTabindexOnceFocusLeaves(el);
  return true;
}

/** The strip branch of the tabindex-lifetime rule (see `focusElement`). */
function stripAddedTabindexOnceFocusLeaves(el: HTMLElement): void {
  let stripped = false;
  const onBlur = () => {
    setTimeout(() => {
      if (stripped || el.ownerDocument.activeElement === el) return;
      stripped = true;
      el.removeAttribute('tabindex');
      el.removeEventListener('blur', onBlur);
    }, 0);
  };
  el.addEventListener('blur', onBlur);
}
