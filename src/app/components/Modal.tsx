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
 *   - Content: radius 12px, max-h 90dvh, scroll contained to the Body
 *   - Header:  1.25rem 1.5rem (20/24) padding, 1px bottom border, title 20px/700
 *   - Body:    1.5rem (24) padding, flex:1, scroll-y
 *   - Footer:  1rem 1.5rem (16/24) padding, justify-end, gap 0.75rem (12)
 *
 * Copy-agnostic: every title/label/CTA is supplied by the consumer; nothing is
 * hardcoded. No `dangerouslySetInnerHTML` — children render as escaped React
 * nodes (T-84-03).
 */

import * as React from 'react';

import { Button } from '@/components/ui/Button';
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
  /**
   * Radix close-autofocus pass-through. Radix moves focus AFTER the dialog
   * unmounts, so a caller that restores focus itself (FeedbackModalProvider's
   * invoker restore, T-87.8-22) must do it HERE with `event.preventDefault()`
   * — restoring in a close() handler runs first and is then clobbered by
   * Radix's default. Omit for the default behaviour.
   */
  onCloseAutoFocus?: (event: Event) => void;
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
  onCloseAutoFocus,
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
        onCloseAutoFocus={onCloseAutoFocus}
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
          // to the `.modal-content` chrome: card surface, 12px radius, 90dvh cap,
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
          /* DECISION Phase 88.6-08 (D-30 / W34): the height cap is `90dvh` — the DYNAMIC
             viewport unit — converging the dialog family onto the one unit `BottomSheet`
             already ships (`BottomSheet.tsx:80`, `:82`). W34 was the recorded divergence:
             two viewport-unit idioms inside one primitive family.

             (a) CHOSEN OVER `svh`, and `svh` is a real alternative rather than a strawman.
             `svh` pins the SMALL viewport — the one left when mobile browser chrome is
             fully EXTENDED — so the cap never changes while that chrome animates in and
             out, and a dialog sized against it can never be clipped mid-scroll. Its cost
             is the mirror: once the chrome retracts, an `svh` cap leaves real height
             unused on a surface whose whole job is to fit a form. `dvh` tracks the live
             viewport, which is what D-30 locks and what the sheet already uses.

             (b) WHY THE ANSWER DIFFERS FROM A BOTTOM SHEET'S, and why that is not an
             inconsistency. `BottomSheet` is anchored to the BOTTOM edge — precisely the
             edge iOS Safari's dynamic toolbar occupies — so for it the unit choice decides
             whether the rows a person is reaching for sit UNDER the toolbar; that argument
             is written out at `BottomSheet.tsx:62-77`. `Modal` is CENTRE-anchored and its
             cap is a max rather than a floor, with `Modal.Body` (`:336`) owning the scroll,
             so an over-tall viewport estimate costs scroll distance here rather than
             reachability. Same unit, different reason — recorded so the next reader does
             not conclude the two were converged by coincidence.

             (c) THIS IS A DISCLOSURE, NOT AN OBJECTION. D-30 stands, and `BottomSheet`'s
             `dvh` is never reverted — "simplifying" either side back to `vh` re-opens D-06
             and W34 together. Nothing here re-opens the convergence.

             (d) THE SCROLL CONTAINER DOES NOT MOVE. `Modal.Body` (`:336`) is still the
             only scrolling region, so `FetchErrorBanner`'s §6.2 placement rule — top of
             the surface's scroll container, above the first content element — is
             unaffected by the unit change. RESEARCH § Assumptions Log A7 flags a
             scroll-container change as the thing that would silently move it.

             (e) STALE ON THE OTHER SIDE, routed not edited: `BottomSheet.tsx:62-63` still
             says in the present tense that "`Modal.tsx:186` caps at `max-h-[90vh]` and is
             the known-divergent sibling". That sentence is now false. This plan declares
             neither that file nor its suite, and an edit lands only in a file its plan
             declares — plan 37 declares `BottomSheet.tsx` and owns the amendment.

             Gated by `Modal.test.tsx`: the rendered shell carries `max-h-[90dvh]`, and a
             comment-stripped scan of this file finds no viewport-height unit but `dvh`. */
          'flex max-h-[90dvh] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-[12px] bg-card p-0 md:w-full',
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
  /**
   * PRESENTATION ONLY (88-33 Task 4, createGroup pending-window): renders the
   * close `×` as unavailable — `aria-disabled` + dimmed styling — while a
   * consumer's own `onClose` guard is suppressing close. The click still routes
   * through Radix -> onClose exactly as before; nothing is gated HERE. The
   * actual close suppression lives in the consumer (createGroup.js gates its
   * onClose while a create is in flight) so Esc/×/outside-click stay uniform.
   * This prop must never grow behavior: trapping close at the primitive would
   * reopen the WCAG 2.1.2 No Keyboard Trap decision for all ~37 call sites.
   * @default false
   */
  closeDisabled?: boolean;
  /**
   * PRESENTATION ONLY (88-33 Task 9): extra classes merged onto the close `×`
   * button. Exists for consumers whose × carries a deliberate accent (createGroup's
   * error-red ×, UAT row 283 — the owner's replacement for its removed red Close
   * button). Never grows behavior.
   */
  closeClassName?: string;
}

/** `.modal-header`: 1.25rem 1.5rem padding, 1px bottom border, title 20px/700. */
function ModalHeader({ children, className, closeDisabled = false, closeClassName }: ModalHeaderProps) {
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
        aria-disabled={closeDisabled || undefined}
        className={cn(
          'inline-flex min-h-11 min-w-11 items-center justify-center text-2xl leading-none text-content-muted transition-colors hover:text-content-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          // Unavailable presentation only — stays focusable (a real `disabled`
          // would drop keyboard focus mid-interaction); the consumer's onClose
          // guard is what makes the click inert. See `closeDisabled` doc above.
          // Round 3 #39: NO element opacity — it composited this glyph's muted ink
          // at 50% over the modal ground, under 4.5:1, on a control that stays
          // active (the same defect HIGH-A removed from `.btn`). The gated look is
          // the resting muted ink with the hover step removed and the cursor;
          // tokenContrast test 53 now scans src/** for aria-disabled + opacity-*.
          closeDisabled && 'cursor-not-allowed hover:text-content-muted',
          closeClassName
        )}
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

/* DECISION Phase 88.6-08 (D-08): `Modal.Action` RENDERS THE `Button` PRIMITIVE.

   RETIRED WITH THIS CHANGE: the module-private variant map that used to sit on this line —
   named `ACTION_CLASS`, a `Record<ModalActionVariant, string>` holding `btn-primary`,
   `btn-secondary` and `btn-danger` — and the `cn('btn', …)` call it fed, which was the
   tree's SECOND `.btn` emitter after `Button`'s cva base. The name is spelled out here on
   purpose: the project's DECISION convention is greppable, and a future reader asking why
   the variant map vanished will search for it. (This retirement is gated on
   COMMENT-STRIPPED source in `Modal.test.tsx`, not by a raw `git grep`, precisely so a
   faithful marker and a passing gate are not mutually exclusive.)

   CHOSEN OVER: exempting `ModalAction` as a second primitive and keeping the map here.
   That arm expresses the variant mapping in two places — the house duplication tenet's
   explicit target — and leaves the phase's `.btn` emitter census permanently non-zero, so
   it could never honestly reach one emitter. The swap DELETES a map rather than
   translating one because `Button.tsx:6-10` records that its variant names were aligned
   with `ModalActionVariant` "so the later adoption plans are a mechanical swap": the three
   entries matched 1:1 (primary/secondary/danger), byte-identically.

   `ModalActionVariant` STAYS EXPORTED with the same three members. Narrowing it to
   `Button`'s `VariantProps` would move the public API that the 14 call sites and
   `ModalActionProps` read, and this swap's own constraint is that no call site changes.

   WHAT THE 14 CALL SITES GAIN — all three are on UI-SPEC §1.2's closed list of sanctioned
   visible deltas; none is new:
     V-1  a 44px height floor at DESKTOP too (`min-h-11` on `Button`'s cva base). Phone was
          already floored by the unlayered `.btn` `@media (width < 48rem)` rule.
     V-2  hover elevation — INHERITED ALREADY NARROWED, not introduced here. THIS FILE
          AUTHORS NO HOVER TOKEN. The lift lives on `Button`'s base as
          `enabled-hover:shadow-theme-md` (plan 06), and plan 05's `enabled-hover`
          `@custom-variant` (`globals.css:177-183`) compiles inside a hover-capability
          media query and excludes BOTH `:disabled` and `[aria-disabled='true']`. So the
          eight GATED footer actions do not lift: a hover lift on a gated dialog action
          would be a regression, never a sanctioned V-2 delta. Those eight, read live
          2026-09-16: `DangerZoneDeleteAccount.tsx:391`, `StartPollModal.js:274` and `:282`,
          `GroupSettings.js:1168`, `ManageMembers.js:743`, `:750`, `:796`, `:803` — all on
          the NATIVE `disabled` attribute, which `enabled-hover` excludes directly.
     V-3  the house focus ring, whose ONE home is `Button`'s cva base (plan 05, ARM A).

   NO `size` PROP IS ADDED. Dialog footer actions are `size="default"` per UI-SPEC §3.3,
   which caps the `sm` rung at two named adopters; a third `sm` consumer is a decision.

   THE `ref` IS FORWARDED, and that is not scope creep. `ModalAction` was a plain function
   component, so on React 18 a caller's `ref` was silently dropped — which made this file's
   own contract at `:61-71` ("A destructive confirmation must open with CANCEL focused")
   UNREACHABLE through `Modal.Action`. `ConfirmDialog.tsx` gets CANCEL focus only because it
   uses a bare `<Button ref={cancelRef}>` instead, while `DangerZoneDeleteAccount.tsx:384`'s
   Cancel IS a `Modal.Action` and that file passes no `initialFocusRef` at all. `Button` is
   already `forwardRef`, so this is purely additive, and it is a LATENT gap rather than a
   live regression: zero `Modal.Action` sites pass a `ref` today (measured 2026-09-16 —
   `grep -rn 'Modal.Action' src | grep -c 'ref='` returns 0 across all 32 matched lines).

   WHAT THE ref DOES NOT DO: it changes no call site's behaviour today, and this plan wires
   no `initialFocusRef` anywhere. That wiring is ROUTED, not done: plan 30 owns
   `DangerZoneDeleteAccount.tsx` and plan 19 owns `ManageMembers.js`; `StartPollModal.js:171`
   already passes its own. This is also NOT the `DialogContent` ref plan 30 routes — that is
   a different target (the dialog content container, not the footer action) — and D52's
   mechanism is untouched.

   Re-pointing this back at a bare `<button>` with a local variant map is a decision, not a
   cleanup. */
export interface ModalActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual intent. @default 'primary' */
  variant?: ModalActionVariant;
}

/**
 * Footer action button — the `Button` primitive behind this file's stable API. Copy via
 * children. The `danger` rung is the destructive-footer affordance (maps to
 * `--color-error` through `.btn-danger`).
 */
const ModalAction = React.forwardRef<HTMLButtonElement, ModalActionProps>(
  function ModalAction({ variant = 'primary', className, type = 'button', ...props }, ref) {
    // `type` is forwarded explicitly even though `Button` also defaults it to 'button':
    // a caller overriding it to 'submit' (StartPollModal's poll form) must keep that value.
    return (
      <Button
        ref={ref}
        variant={variant}
        type={type}
        className={className}
        {...props}
      />
    );
  }
);

// Preserves the devtools name the plain function component gave for free — a bare
// `forwardRef` wrapper renders as "ForwardRef" in the component tree.
ModalAction.displayName = 'ModalAction';

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
  Action: ModalAction,
});
