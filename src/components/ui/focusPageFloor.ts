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
  // DECISION Phase 88.6.1-04 (deviation, Rule 1): a natively disabled control is refused up
  // front, OVER trying it with an added tabindex. No engine focuses a disabled control, but jsdom
  // does once a tabindex is present (measured: case 14 of focusPageFloor.test.ts went RED), so
  // without this the disabled-opener case (W014) would read as focused in every unit test.
  if (el.matches(':disabled')) return false;
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

/** The open dialog the floor must stay inside: the one containing `origin`, else the topmost. */
function findOpenDialog(origin: Element | null | undefined): Element | null {
  if (origin && origin.isConnected) {
    const own = origin.closest(DIALOG_ROLE_SELECTOR);
    if (isOpenDialog(own)) return own;
  }
  const dialogs = document.querySelectorAll(DIALOG_ROLE_SELECTOR);
  for (let i = dialogs.length - 1; i >= 0; i -= 1) {
    if (isOpenDialog(dialogs[i])) return dialogs[i];
  }
  return null;
}

/**
 * A dialog's title: the first id in its aria-labelledby list that resolves to an element the
 * dialog CONTAINS, else its first heading. A labelledby target outside the dialog is skipped:
 * focusing it would floor outside the open dialog (REJECTED (b) below).
 */
function dialogTitle(dialog: Element): HTMLElement | null {
  const ids = (dialog.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of ids) {
    // getElementById, never a selector built from the id: Radix ids contain colons.
    const candidate = document.getElementById(id);
    if (candidate instanceof HTMLElement && dialog.contains(candidate)) return candidate;
  }
  const heading = dialog.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
  return heading instanceof HTMLElement ? heading : null;
}

/* DECISION Phase 88.6.1-04 (D-07, D-05, OQ-5): the page floor focuses, in order, the still-open
   dialog's TITLE (the open dialog that contains `origin`, else the topmost; title = its
   aria-labelledby element when the dialog contains it, else its first heading, else the dialog
   container), then `main h1`, then `main` (`src/app/layout.js:88`, the one `main` the app
   renders). Every candidate is OUTCOME-checked through `focusElement`, so a candidate that does
   not take focus falls through; with nothing left it returns null. It is the ONE floor for
   `useFocusRecovery` and for the `Modal` / `BottomSheet` close (plan 88.6.1-20).

   REJECTED, each kept here so it is not re-proposed as a tidy-up:
   (a) an sr-only `<h1>` on the signed-in home (`/` has no `<h1>`, RESEARCH M-2.5): it would ship
       an unratified string (D-31), and D-05 mints no heading. `main` is the floor there.
   (b) flooring to the page while a dialog is open: a trapped FocusScope pulls focus back to its
       last focused node, which may itself be gone (P-3, `react-focus-scope` dist `index.mjs:43`).
       It is also why an aria-labelledby target the dialog does not contain is skipped.
   (c) an `isConnected`-only test: it misses a natively disabled opener (W014, `Modal.tsx:219`).
       Focus is checked by its outcome, `document.activeElement === candidate`.
   (d) a PERMANENT added tabindex on `main` and on other non-heading page targets outside an open
       dialog: it would turn the null `relatedTarget` that `DECISION Phase 88.6-16 (D-12)` relies
       on into a non-null one (`KebabMenu.js:316`), so an inside tap would close the menu. On
       those targets an added attribute lives only until focus has really left them (the
       tabindex-lifetime rule, stated once on `focusElement`).
   (e) a ref instead of the role query: the `DangerZoneDeleteAccount.tsx:233-239` marker rejected
       a document-level role=dialog lookup for a component choosing among its OWN targets, where
       it held a ref to each. This floor serves dialogs it does not own, so there is no ref to
       hold; jsdom renders Radix's role, so the query is assertable. That marker stands,
       unamended. Precedent for the query in shipped code: `gameDetail/page.js:532`.
   (f) stripping EVERY added attribute on blur: inside an open dialog it defeats Radix's trap
       pull-back, so Shift+Tab would leave the modal; on a heading it buys nothing for D-12 while
       a window blur strips a still-focused element. With the attribute kept, Shift+Tab from a
       floored title stays on the title (Radix wraps only from its first tabbable and pulls the
       move out back); Tab reaches Close, so it is not a trap — the behaviour Radix gives its own
       tabindex -1 container.
   (g) `preventScroll: true` in `focusElement`: the default `focus()` scrolls only when the target
       is out of view, and an off-screen focused target would fail WCAG 2.4.11. A touch user
       whose view moves is the accepted cost, and the host's `preferred` target (the adjacent
       row) keeps that rare.
   Removing or reordering the floor is a decision, not a cleanup. */
export function focusPageFloor(origin?: Element | null): HTMLElement | null {
  const dialog = findOpenDialog(origin);
  if (dialog) {
    const title = dialogTitle(dialog);
    if (title && focusElement(title)) return title;
    if (dialog instanceof HTMLElement && focusElement(dialog)) return dialog;
    return null;
  }
  for (const candidate of [document.querySelector('main h1'), document.querySelector('main')]) {
    if (candidate instanceof HTMLElement && focusElement(candidate)) return candidate;
  }
  return null;
}
