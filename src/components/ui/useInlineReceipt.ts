'use client';

/**
 * useInlineReceipt — the save-in-place success caption's text and timer (plan 88.9-24,
 * save-feedback rule 3). The caller renders `receipt` in an always-mounted region (or
 * speaks it through its own lane); this hook owns only the words and when they clear.
 */
import * as React from 'react';

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
   RESIDUAL, stated: the same receipt twice inside one window is announced once. */
export function useInlineReceipt(clearAfterMs: number = INLINE_RECEIPT_MS) {
  const [receipt, setReceipt] = React.useState('');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showReceipt = React.useCallback(
    (text: string) => {
      cancelTimer(timer);
      setReceipt(text);
      timer.current = setTimeout(() => {
        timer.current = null;
        setReceipt('');
      }, clearAfterMs);
    },
    [clearAfterMs]
  );

  const clearReceipt = React.useCallback(() => {
    cancelTimer(timer);
    setReceipt('');
  }, []);

  React.useEffect(() => () => cancelTimer(timer), []);

  return { receipt, showReceipt, clearReceipt };
}
