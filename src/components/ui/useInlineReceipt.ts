'use client';

/**
 * useInlineReceipt — the save-in-place success caption's text and timer (plan 88.9-24,
 * save-feedback rule 3). The caller renders `receipt` in an always-mounted region (or
 * speaks it through its own lane); this hook owns only the words and when they clear.
 */
import * as React from 'react';

import { REGION_EMPTY_DWELL_MS } from './StatusRegion';

export const INLINE_RECEIPT_MS = 4000;

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

function cancelTimer(timer: TimerRef): void {
  if (timer.current !== null) {
    clearTimeout(timer.current);
    timer.current = null;
  }
}

/* DECISION Phase 88.9-24 (save-feedback rule 3, owner pick O16a, 88.9-PICKS-B9.json): a
   save-in-place success shows a success-ink caption beside its control for 4000 ms — the lifetime
   of the sonner toast each one replaces — chosen OVER the matrix's 2000 ms
   (src/app/userProfile/page.js ("setSaveStatus(slot, 'saved', 2000);")), which suits a switch the
   person is already looking at, not a receipt reached after a dialog closes or focus moves —
   cleared early by the next press, chosen OVER a toast (rule 4: toasts only for outcomes the
   person cannot see) and OVER a caption that stays until navigation (stale after the next edit).
   Sites render it in an always-mounted polite StatusRegion so it is announced once, except
   EmailAddressSection, which speaks it through its existing always-mounted announce() lane.
   AMENDED Phase 88.9-52 (A-59): the residual first stated here (the same receipt twice inside one
   window is announced once) is closed. A receipt equal to the one showing, or one shown sooner
   than REGION_EMPTY_DWELL_MS after the text was emptied, goes through an empty spell first: the
   text is '' until the region has been empty for the dwell, then the receipt arrives and its
   window runs from that moment. Why: a live region speaks a change, and WebKit drops words set
   sooner than the dwell after a clear (the AT-4 record cited at REGION_EMPTY_DWELL_MS), so a
   second quick Saved was silent to a screen-reader user. Chosen OVER leaving it as an accepted
   residual (no owner accept was ever recorded) and OVER a dwell on every receipt (a first
   receipt into a long-empty region needs none, and would only show late).
   AMENDED Phase 88.9-68 (owner ruling Q2): a second exception, the Profile Game added line under
   + Add from BGG, is visible text only and spoken once by the root announcer (announceStatus),
   which already owned that outcome. */
export function useInlineReceipt(clearAfterMs: number = INLINE_RECEIPT_MS) {
  const [receipt, setReceipt] = React.useState('');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the text is right now, and when it last became empty (null: empty since mount), read
  // synchronously by showReceipt to decide whether the empty dwell is owed (A-59).
  const shownRef = React.useRef('');
  const emptiedAtRef = React.useRef<number | null>(null);

  const empty = React.useCallback(() => {
    if (shownRef.current !== '') emptiedAtRef.current = Date.now();
    shownRef.current = '';
    setReceipt('');
  }, []);

  const showReceipt = React.useCallback(
    (text: string) => {
      cancelTimer(timer);
      const show = () => {
        shownRef.current = text;
        setReceipt(text);
        timer.current = setTimeout(() => {
          timer.current = null;
          empty();
        }, clearAfterMs);
      };
      // The same words again: empty first, so their return is a change.
      if (text !== '' && shownRef.current === text) empty();
      const emptyFor =
        shownRef.current === '' && emptiedAtRef.current !== null
          ? Date.now() - emptiedAtRef.current
          : REGION_EMPTY_DWELL_MS;
      if (emptyFor >= REGION_EMPTY_DWELL_MS) {
        show();
        return;
      }
      timer.current = setTimeout(show, REGION_EMPTY_DWELL_MS - emptyFor);
    },
    [clearAfterMs, empty]
  );

  const clearReceipt = React.useCallback(() => {
    cancelTimer(timer);
    empty();
  }, [empty]);

  React.useEffect(() => () => cancelTimer(timer), []);

  return { receipt, showReceipt, clearReceipt };
}
