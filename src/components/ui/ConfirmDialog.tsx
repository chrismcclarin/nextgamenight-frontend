'use client';

/**
 * ConfirmDialog — the one rendered destructive-confirmation surface
 * (Req 11 / D-03..D-11, UI-SPEC §8.7).
 *
 * Pairs with {@link useConfirmAction}: the hook owns the state machine, this owns
 * the markup. Spread the hook's `dialogProps` and the pairing is complete —
 * `<ConfirmDialog {...confirm.dialogProps} />`. Switching a gate's tier is then a
 * one-word edit in the hook config and nothing here changes, including for
 * `two-tap`, where this component deliberately renders nothing at all.
 *
 * Composed over the shipped `Modal` compound, which already supplies the focus
 * trap, Esc handling, focus restore and the `aria-labelledby` wiring from its
 * header — none of that is re-implemented here.
 *
 * Visual contract (UI-SPEC §8.7): title 20px/700 (`Modal.Header`), body 16px/400
 * `content-secondary`, confirm on the `danger` Button variant labelled with the
 * VERB ALONE, Cancel on `secondary` and focused on open, 12px radius inherited
 * from `.modal-content`.
 *
 * **Copy rule, and it is enforced elsewhere (§6.1):** bodies state CONCRETE
 * consequences in counts — "its 4 members are emailed a takeover link", not a
 * generic permanence claim. The phrase "cannot be undone" is banned in the
 * group-delete flow by a live CI gate shipped in 88.2 (the group IS recoverable
 * for `recovery_window_days`), and it is against this contract everywhere else
 * because it tells the person nothing they can act on.
 *
 * What it deliberately does NOT do:
 * - **No fetching.** The D-06 pre-flight blocker panel is `blockerPanel`, whose
 *   content the CALLER supplies. `GroupSettings.js` already ships its own
 *   pre-flight (`groupsAPI.getDeletionImpact`); a second one here would double
 *   the request on the most destructive screen in the app.
 * - **No copy of its own.** Every string is a prop (`Modal`'s rule).
 * - **No raw palette, no bare `focus:` variants** — semantic tokens only, this
 *   being `src/components/ui/`.
 */
import * as React from 'react';

import { Modal } from '@/app/components/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import type { ConfirmTier } from '@/components/ui/useConfirmAction';

/**
 * Outside-pointer dismissal is defeated for the `typed` tier only (D-08): that
 * tier is the one carrying in-progress input, so an accidental overlay click
 * must not discard it. `dialog` keeps outside-dismiss, which is an ABORT and
 * therefore always safe.
 *
 * Exported so the decision is pinned deterministically, matching
 * `Modal.tsx`'s `preventNonDismissableClose` idiom (Radix's own outside-pointer
 * detection needs a real browser, not jsdom).
 */
export function isDismissableTier(tier: ConfirmTier): boolean {
  return tier !== 'typed';
}

/* DECISION Phase 88-05 (D-08 vs. the shipped Modal contract): Escape stays LIVE on every
   tier and routes to `onCancel`. The rejected alternative is the one a reader of D-08's
   "blocking semantics" is most likely to implement — trapping Escape on the typed tier so
   the dialog is truly un-exitable.

   TWO REASONS IT LOSES. (1) `Modal.tsx:48` records a deliberate prior decision — "Esc is
   intentionally NOT routed through here; the keyboard close path is never trapped" — and a
   dialog with no keyboard exit is WCAG 2.1.2 (No Keyboard Trap). (2) It buys nothing:
   Escape is an ABORT, and D-08 is about never reaching `onConfirm` without an explicit
   confirmation, not about making the gate inescapable. What blocking actually means here is
   implemented above: no confirmation is ever downgraded to a passive notification, cancel
   aborts, and outside-pointer dismissal is defeated where input would be lost.

   Trapping Escape here is a decision that reopens a shipped a11y call, not a tightening. */

/* DECISION Phase 88-05 (D-07): the `two-tap` tier renders `null` rather than making the
   surface conditionally render `<ConfirmDialog>` at all. Chosen OVER the obvious shape —
   `{confirm.tier !== 'two-tap' && <ConfirmDialog ... />}` at each of the eleven call sites.

   That conditional is the thing that would quietly break the phase's central must-have: with
   it, retiering a gate is a config word PLUS remembering to add or remove a JSX guard, and
   the failure mode of forgetting is a destructive action with no gate rendered. Rendering
   null here makes the call site identical in all three tiers. Deleting this branch and
   pushing the condition outward is a decision, not a simplification. */

export interface ConfirmDialogProps {
  /** The friction tier. `two-tap` renders nothing — see the marker above. */
  tier: ConfirmTier;
  /** Controlled open state (the hook's `open`). */
  open: boolean;
  /** True while the commit is in flight; the confirm control stays disabled. */
  pending?: boolean;
  /** `{Verb} {specific object}?` */
  title: string;
  /** Concrete consequences, in counts. See the copy rule above. */
  body?: React.ReactNode;
  /** The verb alone: "Remove", "Delete", "Disconnect". Never "OK"/"Yes". */
  confirmLabel: string;
  /** @default 'Cancel' */
  cancelLabel?: string;
  /** `typed` tier: the phrase that must be entered exactly. */
  expectedPhrase?: string;
  /**
   * D-06 pre-flight blocker content, rendered ABOVE the type-to-confirm input.
   * The caller fetches and supplies it; this component never does.
   */
  blockerPanel?: React.ReactNode;
  /**
   * True when the pre-flight found a hard blocker: the confirm control (and the
   * type-to-confirm input) are withheld entirely, leaving only Cancel.
   */
  blocked?: boolean;
  /** Abort. Wired to Esc, Cancel, the close affordance and outside-dismiss. */
  onCancel: () => void;
  /** Commit. Receives the typed value on the `typed` tier. */
  onConfirm: (typedValue?: string) => void;
  /** True while the confirm control must stay disabled (the hook's derivation). */
  confirmDisabled: (typedValue?: string) => boolean;
  className?: string;
}

export function ConfirmDialog({
  tier,
  open,
  pending = false,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  expectedPhrase,
  blockerPanel,
  blocked = false,
  onCancel,
  onConfirm,
  confirmDisabled,
  className,
}: ConfirmDialogProps) {
  const inputId = React.useId();
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  /* DECISION Phase 88-05 (AR R2-M16): the type-to-confirm value is state HERE, not in
     `useConfirmAction`. Chosen OVER holding it in the hook, which is where a reader would
     expect all the gate's state to live. The adopter surfaces are pages of ~2000 lines
     (`userProfile`, `gameDetail`); hook state would put a re-render of the whole host page
     on every keystroke, where this puts one on the dialog alone. Moving it into the hook
     "for cohesion" is a performance decision, not a tidy-up. */
  const [typed, setTyped] = React.useState('');

  // Closing discards the typed value, so reopening never presents a pre-filled
  // confirmation phrase. This component is not unmounted between opens.
  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  if (tier === 'two-tap' || !open) return null;

  const isTyped = tier === 'typed';
  const committedValue = isTyped ? typed : undefined;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissable={isDismissableTier(tier)}
      initialFocusRef={cancelRef}
      className={className}
    >
      <Modal.Header>{title}</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          {body ? (
            <div className="text-base font-normal text-content-secondary">{body}</div>
          ) : null}

          {blockerPanel ? <div className="space-y-2">{blockerPanel}</div> : null}

          {isTyped && !blocked ? (
            <div className="space-y-2">
              <label
                htmlFor={inputId}
                className="block text-base font-normal text-content-secondary"
              >
                To confirm, type{' '}
                <span className="font-bold text-content-primary">{expectedPhrase}</span>{' '}
                below:
              </label>
              <Input
                id={inputId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={pending}
                placeholder={expectedPhrase}
                autoComplete="off"
                // Destructive emphasis, re-authored from the reference
                // implementation's raw palette onto the semantic error token.
                className={cn('border-status-error')}
              />
            </div>
          ) : null}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        {!blocked ? (
          <Button
            variant="danger"
            onClick={() => onConfirm(committedValue)}
            disabled={pending || confirmDisabled(committedValue)}
          >
            {confirmLabel}
          </Button>
        ) : null}
      </Modal.Footer>
    </Modal>
  );
}

ConfirmDialog.displayName = 'ConfirmDialog';
