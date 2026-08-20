'use client';

/**
 * Modal — compound dialog primitive (PRIM-02 / D-09).
 *
 * Radix-backed replacement for the hand-rolled `.modal-*` fleet (QRCodeModal,
 * StartPollModal, BrowseMoreModal, ...), which is 0/16 on axe. Radix Dialog
 * provides focus-trap, Esc-to-close, focus-restore, `role="dialog"` +
 * `aria-modal`, and `aria-labelledby` (auto-wired from <Modal.Header> via the
 * underlying DialogTitle) for free.
 *
 * The chrome reproduces today's `globals.css` `.modal-*` rules 1:1 so the
 * Phase-88 migration is a near-mechanical class -> component swap:
 *   - Content: radius 12px, max-h 90vh, scroll contained to the Body
 *   - Header:  1.25rem 1.5rem (20/24) padding, 1px bottom border, title 20px/700
 *   - Body:    1.5rem (24) padding, flex:1, scroll-y
 *   - Footer:  1rem 1.5rem (16/24) padding, justify-end, gap 0.75rem (12)
 *
 * Copy-agnostic: every title/label/CTA is supplied by the consumer; nothing is
 * hardcoded. No `dangerouslySetInnerHTML` — children render as escaped React
 * nodes (T-84-03).
 */

import * as React from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

export type ModalSize = 'sm' | 'default' | 'lg';

/** size -> max-width. `default` matches the legacy `max-w-lg` modal width. */
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  default: 'max-w-lg',
  lg: 'max-w-4xl',
};

/**
 * Outside-dismiss guard (D-09). When the modal is NOT dismissable, cancel the
 * Radix outside-interaction event so an accidental overlay click can't discard
 * in-progress form input (the StartPollModal data-loss case). Radix honors
 * `preventDefault()` on these events and skips its close. Esc is intentionally
 * NOT routed through here — the keyboard close path is never trapped.
 *
 * Exported so the escape-hatch decision is unit-pinned deterministically;
 * Radix's outside-click detection itself is exercised by E2E, not jsdom.
 */
export function preventNonDismissableClose(
  dismissable: boolean,
  event: Pick<Event, 'preventDefault'>
): void {
  if (!dismissable) event.preventDefault();
}

/**
 * Initial-focus override (88-05, UI-SPEC §8.7). Radix's default auto-focus takes
 * the first focusable node in the content — which here is the header's close
 * `×`. A destructive confirmation must open with CANCEL focused, so consumers
 * pass the element that should receive focus and this cancels Radix's default.
 *
 * With no ref supplied, Radix's default is left completely alone.
 *
 * Exported so the decision is unit-pinned deterministically, matching the
 * {@link preventNonDismissableClose} idiom directly above.
 */
export function applyInitialFocus(
  ref: React.RefObject<HTMLElement | null> | undefined,
  event: Pick<Event, 'preventDefault'>
): boolean {
  const node = ref?.current;
  if (!node) return false;
  event.preventDefault();
  node.focus();
  return true;
}

export interface ModalProps {
  /** Controlled open state. */
  open: boolean;
  /** Fired when the dialog requests close (Esc, overlay click, close button). */
  onClose: () => void;
  /** Width preset. @default 'default' */
  size?: ModalSize;
  /**
   * When false, overlay/outside-pointer dismissal is defeated so in-progress
   * form input is not lost (D-09, StartPollModal). Esc and the explicit close
   * button still close — only the implicit outside-click is suppressed.
   * @default true
   */
  dismissable?: boolean;
  /**
   * Element focused when the dialog opens, instead of Radix's default (the
   * first focusable node, i.e. the header close `×`). `ConfirmDialog` uses it to
   * put opening focus on Cancel — the safe choice on a destructive gate.
   * Omit for the default behaviour.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Extra classes merged onto the dialog content surface. */
  className?: string;
  children?: React.ReactNode;
}

function ModalRoot({
  open,
  onClose,
  size = 'default',
  dismissable = true,
  initialFocusRef,
  className,
  children,
}: ModalProps) {
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose]
  );

  // Defeat outside-click dismissal when locked. onPointerDownOutside +
  // onInteractOutside cover the overlay/focus-outside paths; Esc is handled by
  // Radix's onEscapeKeyDown, which we intentionally leave enabled.
  const preventOutsideDismiss = React.useCallback(
    (event: Event) => preventNonDismissableClose(dismissable, event),
    [dismissable]
  );

  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      applyInitialFocus(initialFocusRef, event);
    },
    [initialFocusRef]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        onOpenAutoFocus={handleOpenAutoFocus}
        // This Radix build does not emit aria-modal on Content; set it
        // explicitly so the dialog advertises modality to assistive tech.
        aria-modal="true"
        // The Modal a11y label comes from <Modal.Header> (DialogTitle). We do
        // not require a description, so opt out of Radix's describedby warning.
        aria-describedby={undefined}
        onPointerDownOutside={preventOutsideDismiss}
        onInteractOutside={preventOutsideDismiss}
        className={cn(
          // Reset shadcn Dialog defaults (grid/gap-4/p-6/bg-background/max-w-lg)
          // to the `.modal-content` chrome: card surface, 12px radius, 90vh cap,
          // flex column with the Body owning the scroll.
          //
          /* DECISION Phase 88-16 (DEF-88-17-01): `w-[calc(100%-1.5rem)] md:w-full`
             — NOT a bare `w-full`. This is the 87.8 DEC-3 phone gutter, restored
             at the primitive. DEC-3 wrote 12px-per-side into a `@media (width <
             48rem)` rule keyed to the LEGACY overlay class (globals.css), so
             every surface this phase migrates off that class silently loses the
             gutter and goes edge-to-edge at 375px — a Phone-Forward regression
             the whole fleet inherits one migration at a time, which is why no
             single adoption plan could see it. 1.5rem total = 0.75rem/side =
             exactly DEC-3's value; `md:w-full` makes it inert at >=48rem, the
             same breakpoint DEC-3 used, so desktop geometry is untouched.
             Chosen OVER: (a) a horizontal margin/padding, which would either
             fight `translate-x-[-50%]` centering or eat into the content box
             the Body already pads; (b) leaving it to 88-30/88-31 per the
             original deferral, which would ship the regression through UAT.
             A Tailwind utility IS safe here specifically because nothing
             unlayered targets the Radix dialog (`grep -n "radix\|data-\[state\|
             dialog" globals.css` -> no matches) — unlike the `.btn` case DEC-2
             fixed. Reverting to `w-full` re-opens DEF-88-17-01; that is a
             decision, not a cleanup. Pinned by Modal.test.tsx. */
          'flex max-h-[90vh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-[12px] bg-card p-0 md:w-full',
          SIZE_CLASS[size],
          className
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export interface ModalHeaderProps {
  /** Title content — rendered as the DialogTitle (drives `aria-labelledby`). */
  children: React.ReactNode;
  className?: string;
}

/** `.modal-header`: 1.25rem 1.5rem padding, 1px bottom border, title 20px/700. */
function ModalHeader({ children, className }: ModalHeaderProps) {
  return (
    <div
      /* DECISION Phase 88-33 Task 3 (fork 6, RULED 2026-08-17; UAT rows 299/308/313): the header
         takes the BODY's horizontal scale (`px-3 md:px-6`), chosen OVER keeping its own flat
         `px-6` and OVER widening Body back to match the header.

         THE MISALIGNMENT: header `px-6` (24px) against Body's `p-3` (12px) indented the title
         12px past the field labels underneath it at 375px — a visible step at the top of every
         one of the ~37 Modal.Header call sites. Fork 6 ruled ONE shared horizontal scale, fixed
         at the primitive rather than per consumer.

         VERTICAL: `py-5` (20px) is now `py-2 md:py-3`. The 44px close box — not the padding —
         sets the header's floor (88-CODE-REVIEW D1, see the marker below), so the old 20px was
         pure dead space at phone width. Measured header height at 375px: 85px -> 61px (44px box
         + 2x8px padding + the 1px rule); desktop 85px -> 69px. Growing these back re-opens both
         the alignment step and the phone-height budget. */
      className={cn(
        'flex items-center justify-between border-b border-border px-3 py-2 md:px-6 md:py-3',
        className
      )}
    >
      <DialogTitle className="text-xl font-bold text-content-primary">
        {children}
      </DialogTitle>
      {/* 88-CODE-REVIEW D1 (2026-08-06): 44px REAL box (min-h-11/min-w-11, the KebabMenu/88-28
          idiom) over a pseudo-element hit extension — assertMin44 in e2e/touch-targets.spec.ts
          measures boundingBox(), which ::after never changes (recorded 88-28 decision at
          touch-targets.spec.ts:234-236). The bare glyph measured ~15x24px, below even WCAG
          2.5.8's 24px, on all 37 Modal.Header call sites. Header grows ~68px -> ~84px. */}
      <DialogClose
        aria-label="Close"
        className="inline-flex min-h-11 min-w-11 items-center justify-center text-2xl leading-none text-content-muted transition-colors hover:text-content-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        &times;
      </DialogClose>
    </div>
  );
}

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

/** `.modal-body`: 1.5rem padding, flex:1, scroll-y (the only scrolling region). */
function ModalBody({ children, className }: ModalBodyProps) {
  return (
    /* DECISION Phase 88-32 ruling 6 (DEF-88-30-03): Body defaults to `p-3 md:p-6` —
       chosen OVER the flat `p-6` it shipped with. Same ruling shape as 88-24's card
       idiom: 24px per side put the fleet at 72px of horizontal loss against the 75px
       phone budget at 375px; 12px on phone drops it to 48 with real margin, and
       matches the one consumer (createEvent, 87.8 DEC-3) that was already overriding.
       Widening the phone default back to `p-6` is a decision, not a cleanup.
       COMPOSITION RULE (delta review 2026-08-06, HIGH): a two-breakpoint default means
       padding overrides must cover BOTH buckets — twMerge collapses per-modifier, so a
       bare `p-0` removes `p-3` but leaves `md:p-6` winning at desktop. Zero-padding
       consumers write `p-0 md:p-0`; longhand overrides write both too (`pt-4 md:pt-4`). */
    <div className={cn('flex-1 overflow-y-auto p-3 md:p-6', className)}>{children}</div>
  );
}

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

/** `.modal-footer`: 1rem 1.5rem padding, 1px top border, justify-end, gap 0.75rem. */
function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      /* 88-33 Task 3 (fork 6): the footer rides the SAME horizontal scale as the header and
         body — otherwise the footer's actions sit on a third, different left/right edge at
         phone width. Vertical padding is unchanged; the footer has no 44px box driving it. */
      className={cn(
        'flex justify-end gap-3 border-t border-border px-3 py-4 md:px-6',
        className
      )}
    >
      {children}
    </div>
  );
}

export type ModalActionVariant = 'primary' | 'secondary' | 'danger';

const ACTION_CLASS: Record<ModalActionVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  // Destructive-footer affordance hook for Phase-88 (maps to --color-error).
  // No destructive flow is wired this phase — only the variant is provided.
  danger: 'btn-danger',
};

export interface ModalActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual intent. @default 'primary' */
  variant?: ModalActionVariant;
}

/** Footer action button mapping to the existing `.btn` variants. Copy via children. */
function ModalAction({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ModalActionProps) {
  return (
    <button
      type={type}
      className={cn('btn', ACTION_CLASS[variant], className)}
      {...props}
    />
  );
}

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
  Action: ModalAction,
});
