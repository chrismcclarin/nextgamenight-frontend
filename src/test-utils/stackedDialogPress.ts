// A pointer press on a control inside a STACKED dialog, dispatched in the order production
// Next.js commits it (Phase 88.6.1, wave 5 CI gate; e2e/group-settings-pending-focus.spec.ts
// arm 4, CI runs 38972642726 / 38976822652).
//
// WHY jsdom NEEDS THIS. A modal Radix dialog defers its pointer-down-outside to the click
// (`deferPointerDownOutside: true`, @radix-ui/react-dialog 1.1.17 dist/index.mjs DialogContentImpl).
// So a press on a control inside a SECOND dialog that is a React sibling (not a descendant) of
// the first one arms the FIRST dialog's outside handler on pointerdown and fires it on click,
// after the control's own onClick has already closed the second dialog. Whether that dispatch
// dismisses the first dialog depends on one thing: has the first dialog's layer re-rendered
// since the second dialog's layer left Radix's stack (`isPointerEventsEnabled`,
// @radix-ui/react-dismissable-layer 1.1.13 dist/index.mjs:49)?
//   - react-dom 18.2 (this repo's dependency, so vitest and jsdom): no. The layer-stack update
//     (`dismissableLayer.update`, dist/index.mjs:12) re-renders at default priority, after the
//     click task, so the dispatch reads a stale "pointer events disabled" and is dropped.
//   - production Next 14.2 (its vendored React 18.3.0-canary-178c267a4e-20241218): yes. MEASURED
//     2026-10-16 in Chromium at 375x667 with the shipped Modal + ConfirmDialog + useConfirmAction
//     built on that React: the first layer re-renders inside the click task, the deferred
//     dispatch reads "enabled", and the first dialog closes.
// This helper reproduces the production order inside the click, before Radix's document
// listener: commit the pending sync render (the second dialog closes, its layer leaves the
// stack), then flush the layer-stack update synchronously. A test driven through it is RED
// exactly where production is broken; a plain fireEvent.click or user-event click is green on
// both trees and proves nothing about this path.

import { flushSync } from 'react-dom';

const LAYER_STACK_UPDATE = 'dismissableLayer.update';

type ActFlag = { IS_REACT_ACT_ENVIRONMENT?: boolean };

export function pressInStackedDialog(target: HTMLElement): void {
  const flag = globalThis as ActFlag;
  const previousAct = flag.IS_REACT_ACT_ENVIRONMENT;
  // Outside act, so React schedules the onClick update the way a browser event does and the
  // two flushSync calls below are the only things that commit it.
  flag.IS_REACT_ACT_ENVIRONMENT = false;
  const commitLikeProduction = () => {
    flushSync(() => {});
    flushSync(() => {
      document.dispatchEvent(new CustomEvent(LAYER_STACK_UPDATE));
    });
  };
  try {
    const init = { bubbles: true, cancelable: true, button: 0 };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.focus();
    target.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    // A body listener runs after React's root listener (the render container sits inside
    // body) and before Radix's document listener: the browser's microtask checkpoint slot.
    document.body.addEventListener('click', commitLikeProduction, { once: true });
    target.dispatchEvent(new MouseEvent('click', init));
  } finally {
    document.body.removeEventListener('click', commitLikeProduction);
    flag.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
}
