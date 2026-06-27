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
  /** Extra classes merged onto the dialog content surface. */
  className?: string;
  children?: React.ReactNode;
}

function ModalRoot({
  open,
  onClose,
  size = 'default',
  dismissable = true,
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
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
          'flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden rounded-[12px] bg-card p-0',
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
      className={cn(
        'flex items-center justify-between border-b border-border px-6 py-5',
        className
      )}
    >
      <DialogTitle className="text-xl font-bold text-content-primary">
        {children}
      </DialogTitle>
      <DialogClose
        aria-label="Close"
        className="text-2xl leading-none text-content-muted transition-colors hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    <div className={cn('flex-1 overflow-y-auto p-6', className)}>{children}</div>
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
      className={cn(
        'flex justify-end gap-3 border-t border-border px-6 py-4',
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
