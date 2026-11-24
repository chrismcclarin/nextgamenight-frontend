'use client';

/**
 * ToastAnnouncer — the toast-to-dialog announcer bridge (plan 89.6-03). Mounted once, in the root
 * layout beside the root announcer. It reads Sonner's toast list and hands each new toast's words
 * to the announcer store, which puts them in the region inside the top open house dialog. It
 * renders nothing: no node, no swipe stop. No toast call site knows it exists. The reasoning is
 * src/components/ui/announcer.ts ("DECISION Phase 89.6-03 (toast-bridge)").
 */
import * as React from 'react';
import { useSonner, type ToastT } from 'sonner';

import { announceInOpenDialog } from './announcer';

/* The words of one toast: its title when that is a string (a number becomes its string), then a
   space and its description when that is a string too. Anything else (a React element, a
   function) has no words this bridge can hand over, and the toast is skipped. No toast call site
   passes a description today; a future one is not silently cut to its title. */
function wordsOf(toast: ToastT): string | null {
  const { title, description } = toast;
  let words: string;
  if (typeof title === 'string') words = title;
  else if (typeof title === 'number') words = String(title);
  else return null;
  if (typeof description === 'string' && description !== '') words = `${words} ${description}`;
  return words.trim() === '' ? null : words;
}

export function ToastAnnouncer() {
  const { toasts } = useSonner();
  // The ids already handed over: a re-render or a later toast never repeats an earlier one.
  const handedOver = React.useRef(new Set<ToastT['id']>());

  React.useEffect(() => {
    // Sonner's list is newest first, and the store holds ONE text: walk from the oldest to the
    // newest, so the newest is handed over last.
    for (let index = toasts.length - 1; index >= 0; index -= 1) {
      const toast = toasts[index];
      if (handedOver.current.has(toast.id)) continue;
      handedOver.current.add(toast.id);
      const words = wordsOf(toast);
      if (words !== null) announceInOpenDialog(words);
    }
  }, [toasts]);

  return null;
}
