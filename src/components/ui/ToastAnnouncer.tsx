'use client';

/**
 * ToastAnnouncer — the toast-to-dialog announcer bridge (plan 89.6-03). Mounted once, in the root
 * layout beside the root announcer. It reads Sonner's toast list and hands each new toast's words
 * to the announcer store, which puts them in the region inside the top open house dialog; and
 * while it does, it hides Sonner's own live region from assistive tech, so the words are exposed
 * once. It renders nothing: no node, no swipe stop. No toast call site knows it exists. The
 * reasoning is src/components/ui/announcer.ts ("DECISION Phase 89.6-03 (toast-bridge)").
 */
import * as React from 'react';
import { useSonner, type ToastT } from 'sonner';

import {
  announceInOpenDialog,
  announceStatus,
  dialogHostActive,
  dialogHostOpen,
  subscribeHostState,
} from './announcer';

/* Sonner's one always-mounted live region (its Toaster renders this section on every render and
   never sets aria-hidden on it), and the attribute that says THIS bridge hid it. */
const SONNER_SECTION = 'section[aria-live][aria-label^="Notifications"]';
const HIDDEN_BY_BRIDGE = 'data-toast-bridge-hidden';

function sonnerSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SONNER_SECTION);
}

/* The words of one toast: its title when that is a string (a number becomes its string), then a
   space and its description when that is a string too. Anything else (a React element, a
   function) has no words this bridge can hand over, and the toast is skipped. No toast call site
   passes a description today; a future one is not silently cut to its title. */
function wordsOf(toast: ToastT): { title: string; words: string } | null {
  const { title, description } = toast;
  let text: string;
  if (typeof title === 'string') text = title;
  else if (typeof title === 'number') text = String(title);
  else return null;
  if (text.trim() === '') return null;
  const words = typeof description === 'string' && description !== '' ? `${text} ${description}` : text;
  return { title: text, words };
}

export function ToastAnnouncer() {
  const { toasts } = useSonner();
  const dialogActive = React.useSyncExternalStore(subscribeHostState, dialogHostActive, () => false);
  // The ids already handed over: a re-render or a later toast never repeats an earlier one.
  const handedOver = React.useRef(new Set<ToastT['id']>());
  // Toasts whose words went (or will go) to the ROOT region, by id, with the title Sonner shows:
  // while one of them is still in Sonner's section, that section stays hidden (see below).
  const rootBound = React.useRef(new Map<ToastT['id'], string>());

  // Declared BEFORE the effect that un-hides Sonner's section: on a list change this one runs
  // first, so a toast that has just arrived is already counted as root-bound when that one looks.
  React.useEffect(() => {
    // Sonner's list is newest first, and the store holds ONE text: walk from the oldest to the
    // newest, so the newest is handed over last.
    for (let index = toasts.length - 1; index >= 0; index -= 1) {
      const toast = toasts[index];
      if (handedOver.current.has(toast.id)) continue;
      handedOver.current.add(toast.id);
      const spoken = wordsOf(toast);
      if (spoken === null) continue;
      if (dialogHostActive()) {
        // A dialog is open or closing: the A-47 landing takes the words. With none OPEN (the
        // only one is closing) they land in the root once it has left the page.
        if (!dialogHostOpen()) rootBound.current.set(toast.id, spoken.title);
        announceInOpenDialog(spoken.words);
      } else if (sonnerSection()?.hasAttribute(HIDDEN_BY_BRIDGE)) {
        // No dialog, and this bridge still holds Sonner's section hidden: nothing else would
        // speak this toast, so its words go to the root region.
        rootBound.current.set(toast.id, spoken.title);
        announceStatus(spoken.words);
      }
      // Otherwise nothing is written: Sonner's own region speaks, and it alone.
    }
    // The set becomes exactly the ids Sonner still lists: a dismissed toast drops out, so a new
    // toast under a reused id is a new toast.
    handedOver.current = new Set(toasts.map((toast) => toast.id));
  }, [toasts]);

  /* DECISION Phase 89.6-03 (toast-single-reading): while a house dialog is open or closing,
     Sonner's section is hidden from assistive tech (aria-hidden), so a toast's words are in the
     accessibility tree ONCE: in the dialog region, or, after a closing dialog has left, in the
     root region. Chosen OVER leaving both copies exposed: aria-modal does not prune Sonner's
     aria-live section from Chromium's tree, and the package Radix hides the page with skips
     aria-live nodes, so Android TalkBack, which reads Blink's tree, would read the toast twice
     (plan review scoped check S01). And OVER keeping toasts out of the dialog region: iOS
     VoiceOver never reads Sonner's region under a dialog
     (planning:.planning/deferred/phase-89.6.md ("Error notices are not spoken while a dialog is open")).
     Sonner renders the section on every render and does not manage aria-hidden, so the attribute
     holds until this bridge removes it; the bridge removes only the attribute it set
     (data-toast-bridge-hidden says so). aria-hidden changes nothing for sight or for a pointer.
     (While a modal dialog is OPEN, Radix turns the page's pointer events off outside it, with or
     without this bridge, so a toast's close button takes no click then; it does again once the
     dialog starts to close.)
     THE CLOSE PATH. The store picks its target when words land. Words for a toast that arrived
     while a dialog was OPEN are spoken in the dialog region and leave with it, so at the leave
     the section is exposed again (that toast may still show; it is the only copy). Words for a
     toast that arrived while the dialog was CLOSING land in the root after the leave, the moment
     the section would be exposed with that toast still in it. So after the leave the section
     stays hidden until it no longer holds a toast whose words went to the root, and a toast that
     arrives meanwhile is spoken by the root too. Chosen OVER clearing the root copy when
     Sonner's copy is exposed: iOS VoiceOver announces a live region's CHANGE, not text already
     present when the region is exposed, so the root copy is the one that is heard.
     aria-hidden over Sonner's focusable Close toast buttons (the root layout mounts the Toaster
     with closeButton) is what axe's aria-hidden-focus rule flags. Chosen OVER inert, which
     would also block the pointer close. It is safe while a dialog is open: both hosts, Modal and
     BottomSheet, are Radix modal dialogs whose focus trap keeps keyboard focus out of the
     section. After the leave, in the short window the section stays hidden for a root-bound
     toast, no focus trap applies: a residual, recorded for the phase's close ledger (plan
     89.6-34), not hidden. A later axe scan of a dialog-open state with a toast showing that
     reports aria-hidden-focus is this choice. Changing this is a decision, not a cleanup. */
  React.useEffect(() => {
    const section = sonnerSection();
    if (section === null) return undefined;
    if (dialogActive) {
      // Never take over an aria-hidden someone else set: the bridge could not hand it back.
      if (!section.hasAttribute('aria-hidden') || section.hasAttribute(HIDDEN_BY_BRIDGE)) {
        section.setAttribute('aria-hidden', 'true');
        section.setAttribute(HIDDEN_BY_BRIDGE, '');
      }
      return undefined;
    }
    if (!section.hasAttribute(HIDDEN_BY_BRIDGE)) return undefined;

    const listed = new Set(toasts.map((toast) => toast.id));
    /* Expose the section again, unless it still shows a root-bound toast: one Sonner still
       lists, or one whose title is still in the section (Sonner drops a dismissed toast from its
       list about 200 ms before it leaves the page). */
    const expose = (): boolean => {
      const shown = section.textContent ?? '';
      for (const [id, title] of rootBound.current) {
        if (listed.has(id) || shown.includes(title)) return false;
      }
      rootBound.current.clear();
      section.removeAttribute('aria-hidden');
      section.removeAttribute(HIDDEN_BY_BRIDGE);
      return true;
    };
    if (expose()) return undefined;
    const observer = new MutationObserver(() => {
      if (expose()) observer.disconnect();
    });
    observer.observe(section, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [dialogActive, toasts]);

  // On unmount the bridge hands back the attribute it set.
  React.useEffect(
    () => () => {
      const section = sonnerSection();
      if (section?.hasAttribute(HIDDEN_BY_BRIDGE)) {
        section.removeAttribute('aria-hidden');
        section.removeAttribute(HIDDEN_BY_BRIDGE);
      }
    },
    []
  );

  return null;
}
