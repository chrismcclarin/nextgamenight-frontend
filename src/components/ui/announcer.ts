/**
 * announcer — the root announcer's module store (plan 88.9-24; owner ruling 88.9-RULINGS.md R-F1,
 * 2026-11-08, DEC-3 option A). `RootAnnouncer` reads it through `useSyncExternalStore`; callers
 * write it with `announceStatus`. No React import: the store outlives any component that writes it.
 */
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { INLINE_RECEIPT_MS } from './useInlineReceipt';

type Listener = () => void;

let text = '';
const listeners = new Set<Listener>();
let pending: ReturnType<typeof setTimeout> | null = null;

function set(next: string): void {
  if (text === next) return;
  text = next;
  for (const listener of listeners) listener();
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
   decision, not a cleanup. */
export function announceStatus(next: string): void {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  set('');
  pending = setTimeout(() => {
    set(next);
    pending = setTimeout(() => {
      pending = null;
      set('');
    }, INLINE_RECEIPT_MS);
  }, REGION_EMPTY_DWELL_MS);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): string {
  return text;
}

export function getServerSnapshot(): string {
  return '';
}
