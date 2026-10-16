'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { focusPageFloor, isFocusLost, isOpenDialog } from '@/components/ui/focusPageFloor';
import { cn } from '@/lib/cn';

/* DECISION Phase 88-05 (D-35 / E-26 — this IS "the shadcn pass" D-35 deferred to):
   this file KEEPS the shadcn bridge-token vocabulary (`bg-background`, `ring-ring`,
   `text-muted-foreground`, `ring-offset-background`) while every new primitive in
   `src/components/ui/` is authored on the `surface-*` / `content-*` / `line` set.

   The rejected alternative is the tidy one: re-author the whole file onto the project's
   semantic tokens so `ui/` speaks one vocabulary. It loses here because those bridge names
   are NOT raw palette — they resolve through globals.css like any other token — so the
   inconsistency is cosmetic, while the rewrite touches every surface Radix composes and
   puts the shipped `Modal` chrome (which overrides most of it anyway) at risk for no user-
   visible gain. This pass therefore closes only the four CONTRACT conflicts D-35 named:
   the title weight, the focus trigger, the accent misuse and the bare border.

   Re-authoring the vocabulary is a decision that needs its own phase, not a cleanup. */

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Suppress the built-in top-right close button. The compound <Modal>
     * renders its own in-header close affordance (matching today's `.modal-*`
     * chrome 1:1), so it opts out of this default to avoid a duplicate.
     */
    hideCloseButton?: boolean;
  }
>(({ className, children, hideCloseButton = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // D-35: `border` is explicit (`border-line`), not left to the base-layer shim.
        // DECISION Phase 88.6-36 (D49-b, owner ruling 2026-09-09 option i): the elevation is
        // the project tier, chosen OVER the alias-spelled built-in utility this shipped with.
        // A VALUE change, not a rename — Tailwind v4 inlines its built-in scale's cold black
        // literal into the built-in utility in BOTH themes, while the theme tier resolves a
        // warm light value and a purple-hairline-plus-glow dark one (`DECISION Phase 87.7` in
        // `globals.css`; measured before/after at the twin site in `ErrorFallback.tsx`). This
        // file is the ground of every Radix dialog in the app, so this is the WIDEST single
        // visual delta in the D49-b set — disclosed in `88.6-36-SUMMARY.md` for `/gsd-ui-review`.
        // This one class is the ONLY change plan 88.6-36 makes in this file: the title element
        // below is Radix-owned and carries every dialog's accessible name, and this plan
        // authorises no heading, type-scale, structural or copy edit here.
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-line bg-background p-6 shadow-theme-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        // §7.2: the ring fires on `focus-visible` only (a bare focus variant also
        // fires on pointer and programmatic focus); `outline-hidden` keeps the
        // transparent outline forced-colors mode needs. §5.3: amber/accent is a
        // closed list and a dialog close button is not on it.
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-surface-hover data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    // §4.1/§4.2: a dialog title is the Heading role — 20px/700. 600 is
    // Button-only in this phase's type contract (D-01).
    className={cn('text-xl font-bold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

/* DECISION Phase 88.6.1-20 (D-07, W014, N6): ONE close-restore, shared by `Modal`
   (`app/components/Modal.tsx`) and `BottomSheet` (`components/ui/BottomSheet.tsx`). It returns
   focus to the element that opened the dialog when that element can still take focus, acts ONLY
   when focus is lost (plan 04's `isFocusLost`, D-04's one definition), and otherwise floors
   (plan 04's `focusPageFloor`: the still-open dialog's title, then `main h1`, then `main`).
   Closing a dialog therefore never leaves a keyboard or screen-reader user on `<body>` while any
   of those exists, and never moves a user who is already somewhere live.

   `restoreDialogFocus` runs these steps IN THIS ORDER:
   (1) Focus is NOT lost (it sits on a live element: a dialog that opened after this one, or a
       place a consumer chose) -> touch nothing.
   (2) Focus sits on an OPEN dialog's container and the opener is not inside that dialog -> skip
       the opener and floor FROM `document.activeElement`, so that dialog's title takes focus. This
       step exists because a dialog that opened after this one with no tabbable child has its
       container focused by Radix (react-focus-scope's mount effect, `focus(container)`), which
       counts as lost; focusing the old opener there fires a `focus` event on it before that
       dialog's trap pulls focus back (measured RED by `Modal.test.tsx` case D2). The closing
       dialog itself carries `data-state="closed"`, so it never matches here.
   (3) The opener is connected -> `focus()` it and keep it only when `document.activeElement`
       is the opener afterwards (the OUTCOME, not presence: a disabled or hidden opener refuses).
   (4) Otherwise -> `focusPageFloor(opener)`.

   REJECTED, each kept here so it is not re-proposed as a tidy-up:
   (a) two twin copies, one per primitive: they had already drifted (the sheet REPLACED its
       restore whenever a consumer passed a handler; `Modal` composed it).
   (b) a per-consumer `returnFocusRef` prop (WR-201's suggested remedy): `DECISION Phase
       88.6-44` rejects per-consumer focus plumbing, and D-07 puts the floor in the primitive.
   (c) restoring the opener through plan 04's `focusElement`: its tabindex retry makes jsdom
       focus a disabled button that every browser refuses, so a unit test would pass while a
       browser drops the user (jsdom `focusing.js` checks `tabindex` before `disabled`).
   (d) an `isConnected`-only check: it misses a disabled opener (W014).
   (e) restoring while focus is on a live element: it pulled focus out of a dialog that opened
       after this one (the chained Settings -> Manage Members case, measured RED by case D).
   (f) capturing the opener somewhere other than `onOpenAutoFocus` so that a dialog whose
       content holds an auto-focused descendant (React's autofocus prop) returns focus to its
       opener. Radix skips its open event when focus is already inside (react-focus-scope
       `hasFocusedCandidate`), so no
       opener is captured and that case FLOORS, by decision: moving 88.6-44's measured capture
       point on unmeasured Radix-portal timing is not worth it for zero consumers (no dialog
       holds an auto-focused descendant today — the one autofocus prop in non-test source is
       an inline profile editor outside every dialog). A future dialog that adds one revisits
       this. (Spelled without the prop's camel-case name so the census grep counts only code.)
   (g) flooring step (2) from the opener: in a stacked O -> A -> B chain the opener sits inside
       O, so the floor would focus O's title behind B and B's trap would yank focus back
       (review L-29, measured RED by case D3 against a throwaway).
   No markup, no string and no logging live in this code. Removing or reordering these steps is
   a decision, not a cleanup. */

/** Record the element that holds focus as a dialog opens (call from `onOpenAutoFocus`). */
export function recordDialogOpener(openerRef: React.MutableRefObject<HTMLElement | null>): void {
  const active = document.activeElement;
  openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * Put focus back after a dialog closes: the opener when it can take focus, else the floor. Acts
 * only when focus is lost. Returns the element focused, or null when it moved nothing (or found
 * no target). The ordered steps and their reasons are in the marker above.
 */
export function restoreDialogFocus(opener: HTMLElement | null): HTMLElement | null {
  if (!isFocusLost()) return null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && isOpenDialog(active) && !(opener && active.contains(opener))) {
    return focusPageFloor(active);
  }
  if (opener && opener.isConnected) {
    opener.focus();
    if (document.activeElement === opener) return opener;
  }
  return focusPageFloor(opener);
}

/**
 * The primitives' `onCloseAutoFocus`: clear the recorded opener on EVERY path (a stale opener
 * must not survive into the next open), run the consumer's handler FIRST, let a consumer that
 * prevents default keep full control, and otherwise own the close (prevent Radix's fallback,
 * which focuses a `Dialog.Trigger` neither primitive renders) and restore.
 */
export function handleDialogCloseAutoFocus(
  event: Event,
  openerRef: React.MutableRefObject<HTMLElement | null>,
  consumer?: (event: Event) => void
): void {
  const opener = openerRef.current;
  openerRef.current = null;
  consumer?.(event);
  if (event.defaultPrevented) return;
  event.preventDefault();
  restoreDialogFocus(opener);
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
