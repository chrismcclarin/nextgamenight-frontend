/**
 * announcer — the root announcer's module store (plan 88.9-24; owner ruling 88.9-RULINGS.md R-F1,
 * 2026-11-08, DEC-3 option A). `RootAnnouncer` reads it through `useSyncExternalStore`; callers
 * write it with `announceStatus`. No React import: the store outlives any component that writes it.
 * Since 88.9-52 (A-47) the same store also feeds the region inside the top open dialog: see the
 * A-47 DECISION marker below.
 */
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { INLINE_RECEIPT_MS } from './useInlineReceipt';

type Listener = () => void;

/** One dialog's identity in the store. An empty object; only its identity is read. */
export type AnnounceHost = object;

/**
 * The longest the words wait for a closing dialog to leave the page (88.9-52, A-47). The house
 * exit animation is 200 ms (src/components/ui/dialog.tsx ("gap-4 border border-line bg-background p-6 shadow-theme-lg duration-200")),
 * so this only bounds a dialog whose exit never reports its end: the words then land anyway.
 */
export const LEAVING_WAIT_CAP_MS = 1000;

let text = '';
/* Which region holds `text`: null is the root region, anything else is the dialog host that was
   on top when the words landed. Read only while `text` is not empty. */
let target: AnnounceHost | null = null;
/* Open dialog hosts, oldest first; the last one is on top. */
const hosts: AnnounceHost[] = [];
/* Dialogs that have closed and are still on the page (their exit animation is running). */
const leaving = new Set<AnnounceHost>();
/* Words whose dwell has passed and that are waiting for `leaving` to empty. */
let held: string | null = null;
const listeners = new Set<Listener>();
/* The ONE timer: the dwell, then the clear window; or, while words are held, the wait cap. */
let pending: ReturnType<typeof setTimeout> | null = null;

function set(next: string): void {
  if (text === next) return;
  text = next;
  for (const listener of listeners) listener();
}

function clearPending(): void {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
}

/* The words go into a region: the top open dialog's, else the root's. The target is chosen HERE,
   when the words land, never when announceStatus was called. */
function commit(next: string): void {
  held = null;
  target = hosts.length > 0 ? hosts[hosts.length - 1] : null;
  set(next);
  pending = setTimeout(() => {
    pending = null;
    set('');
  }, INLINE_RECEIPT_MS);
}

/* The dwell has passed. While a dialog is still closing the words are held; they land once it
   has left the page (settle, below), or at the cap. */
function land(next: string): void {
  if (leaving.size === 0) {
    commit(next);
    return;
  }
  held = next;
  pending = setTimeout(() => {
    // The cap: whatever is still "leaving" is given up on, so it cannot delay later words too.
    leaving.clear();
    commit(next);
  }, LEAVING_WAIT_CAP_MS);
}

/* A closing dialog has left the page (or opened again). Once none is left, held words get one
   more dwell, so the focus move that follows a close is done before they land. */
function settle(): void {
  if (held === null || leaving.size > 0) return;
  const next = held;
  held = null;
  clearPending();
  pending = setTimeout(() => land(next), REGION_EMPTY_DWELL_MS);
}

/* DECISION Phase 88.9-24 (owner ruling 88.9-RULINGS.md R-F1 (2026-11-08), save-feedback rule 2
   amended): a save whose result is in view shows no toast, and its outcome is still spoken once —
   this store holds the words for the ONE region RootAnnouncer mounts beside the Toaster. Clear
   first, wait REGION_EMPTY_DWELL_MS, then set, so a repeat of the same words is heard
   (src/components/ui/StatusRegion.tsx ("export const REGION_EMPTY_DWELL_MS = 100;")); cleared again
   after INLINE_RECEIPT_MS so the sr-only node is not left holding text as a phantom swipe stop. A
   module store chosen OVER a React context (src/app/layout.js is a server component and the
   Toaster sits outside every provider) and OVER a per-component region (createEvent and
   GroupSettings unmount on close and would take their region with them). The rule-3 inline
   receipts never call this — each is spoken by its own region or lane. Changing this is a
   decision, not a cleanup.
   AMENDED Phase 88.9-52 (A-47): "the ONE region" is now one region PER PLACE, and the words are
   only ever in one of them — the root region, or the region inside the top open dialog. The
   clear, the dwell and the clear window above are unchanged and shared by every region; the
   marker below records the routing. */
export function announceStatus(next: string): void {
  clearPending();
  held = null;
  set('');
  pending = setTimeout(() => land(next), REGION_EMPTY_DWELL_MS);
}

/* DECISION Phase 88.9-52 (A-47): while a house dialog is open, the words go to a polite region
   INSIDE that dialog, and the root region stays empty. MEASURED 2026-11-16 on the owner's iPhone
   with VoiceOver, on production: changing a member's role in Manage Members did not speak Role
   updated. The root region sits outside the open dialog, and both house dialogs set aria-modal
   true (src/app/components/Modal.tsx ("This Radix build does not emit aria-modal on Content; set it"),
   src/components/ui/BottomSheet.tsx ("explicitly so the sheet advertises modality to assistive tech")).
   The outcome is measured; the cause (VoiceOver keeps to the aria-modal dialog that holds focus)
   is the reading that fits it and was not isolated on the device.
   HOW: each house dialog mounts one region and registers a host here
   (src/components/ui/RootAnnouncer.tsx ("export function DialogAnnouncer")). The open hosts are
   a stack; the last one opened is on top. When the words LAND, the top open host takes them;
   with no host open the root takes them, exactly as before. Every region reads this one store,
   so the clear, the dwell, the repeat handling and the politeness are the root's own, not a copy.
   Call sites are unchanged.
   THE TARGET IS FIXED WHEN THE WORDS LAND, chosen OVER fixing it when announceStatus is called
   and OVER re-routing live as dialogs open and close:
   - Fixed at the call: createEvent, the Google Calendar disconnect confirm and the Manage
     Members confirms all announce and then close their dialog in the same tick. The words would
     land in a dialog that is on its way out and be cut off with it. Fixed at landing, a dialog
     that closes inside the dwell hands the words to what is beneath it (the dialog under it,
     else the root).
   - Re-routed live: the words would move into a second region when a dialog opens or closes,
     and a screen reader would speak them twice.
   THE WORDS WAIT FOR A CLOSING DIALOG TO LEAVE THE PAGE. A dialog that has closed stays mounted
   for its exit animation (200 ms, longer than the 100 ms dwell), still holds focus, and still
   hides the page and the dialog beneath it. Words landing then would land outside the dialog
   that holds focus, the very case that was measured silent. So a host that closes moves to
   `leaving` until its content unmounts; words whose dwell has passed are held until `leaving` is
   empty, get one more dwell (the close moves focus first), and land. LEAVING_WAIT_CAP_MS bounds
   the wait; at the cap the words land anyway and the stuck dialog is forgotten. A dialog that unmounts outright on close (createEvent, GroupSettings) is never in
   `leaving`, so its words land after the one dwell, as before. This wait is reasoned from the
   measurement, not itself measured on the device.
   A host that closes while it HOLDS the words takes them with it (the text is cleared), so the
   root never repeats them and the same dialog opening again finds no stale words.
   REJECTED: a region added by hand inside Manage Members (it fixes two call sites and leaves
   the next dialog that announces silently broken; with the root also filled, a platform that
   does expose the root would speak twice). REJECTED: removing aria-modal from the dialogs (a
   fleet-wide change to what a screen reader can reach behind every dialog). REJECTED: a toast
   (save-feedback rule 2: the result is in view). REJECTED: a new parameter on announceStatus
   naming the dialog (ten call sites change, and the next caller can forget it).
   KNOWN SIDE EFFECT: the aria-hidden package Radix hides the page with never hides an aria-live
   node or its ancestors. Every house dialog now holds one, so a dialog BENEATH another is no
   longer hidden as one node: its header, body and footer are hidden and its own node and empty
   region stay exposed. That was already the state of every dialog with a live region of its own
   (Manage Members among them).
   Not verifiable off the device: whether VoiceOver speaks the in-dialog region. jsdom shows only
   where the words are and when. Changing any of this is a decision, not a cleanup. */

/** A dialog opened: it becomes the top announce target. Returns its close (the open prop went false). */
export function registerAnnounceHost(host: AnnounceHost): () => void {
  hosts.push(host);
  // Opened again before its exit finished: it is no longer leaving.
  if (leaving.delete(host)) settle();
  return () => {
    const index = hosts.lastIndexOf(host);
    if (index !== -1) hosts.splice(index, 1);
    leaving.add(host);
    if (text !== '' && target === host) {
      clearPending();
      set('');
    }
  };
}

/** A dialog's content left the page (unmount). Held words may land now. */
export function releaseAnnounceHost(host: AnnounceHost): void {
  if (leaving.delete(host)) settle();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The ROOT region's view: the words, unless a dialog host holds them. */
export function getSnapshot(): string {
  return target === null ? text : '';
}

/** One dialog region's view: the words only while THIS host holds them. */
export function getHostSnapshot(host: AnnounceHost): string {
  return target === host ? text : '';
}

export function getServerSnapshot(): string {
  return '';
}
