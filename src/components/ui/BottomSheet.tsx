'use client';

/**
 * BottomSheet — the phone dismiss idiom for Req 11a / 11b (88.1 D-05).
 *
 * A bottom-anchored variant of the shipped Radix dialog, built from the parts
 * `src/components/ui/dialog.tsx` already exports. Radix Dialog supplies the
 * focus trap, `role="dialog"`, Esc-to-close and the `aria-labelledby` wiring
 * from {@link DialogTitle} — none of it is re-implemented here (`Modal.tsx:5-10`
 * records the hand-rolled `.modal-*` fleet was 0/16 on axe before Radix).
 *
 * Focus RESTORE is the one exception: Radix restores to a `DialogTrigger`, and
 * these sheets open from a plain bottom-bar button, so the sheet records its own
 * invoker and puts focus back — see the FOCUS-RESTORE DECISION below.
 *
 * Zero new dependencies: D-05 rejects `vaul` (stale since 2024-12, a second
 * overlay engine, and a new dep in the phase that deletes one). Everything used
 * here ships already — `@radix-ui/react-dialog` and `tw-animate-css`.
 *
 * Chrome (UI-SPEC §Interaction / §Spacing):
 *   - Content: pinned to the bottom edge, full width, `rounded-t-[12px]`
 *     (`--radius-card: 12px`; the design reference's 16px modal radius never
 *     shipped), bottom-slide in/out, `duration-200 ease-out`
 *   - Header:  title 20px/700 + a 44x44 close control, 1px bottom rule
 *   - Body:    16px padding, `flex-1`, the only scrolling region
 *
 * Height is caller-supplied via {@link BottomSheetProps.height} — see
 * {@link HEIGHT_CLASS} for the two shipped consumers' values.
 *
 * Copy-agnostic: the title and all content are supplied by the consumer.
 * Children render as escaped React nodes — no raw-HTML injection prop is used
 * or accepted anywhere in this file (T-84-03, `Modal.tsx:20-22`).
 *
 * What it deliberately does NOT do:
 * - **No gesture dismissal of any kind** (D-05). Dismissal is tap-outside, Esc
 *   and the close button — exactly three paths, all of them keyboard- or
 *   pointer-equivalent, none of them requiring a sustained pointer motion.
 * - **No `dismissable={false}` escape hatch.** `Modal.tsx:43-58` has one
 *   because it hosts in-progress form input; both sheet consumers are READ-ONLY
 *   (upcoming events, calendar list), so there is nothing an accidental
 *   outside-tap could discard. Adding the hatch is a decision that needs a
 *   consumer that would lose data without it.
 * - **No component-level reduced-motion rule.** `globals.css:1447-1455` already
 *   caps every animation duration at 100ms under `prefers-reduced-motion`.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

export type BottomSheetHeight = 'content' | 'full';

/* DECISION Phase 88.1 (D-06 / C13): `dvh` chosen OVER `vh`, which WAS the dialog family's
   existing unit — `Modal.tsx:186` capped at `max-h-[90vh]` and was the known-divergent
   sibling. This is the repo's FIRST `dvh` (`grep -rn 'dvh' src/` returned 0 hits at
   authoring time).

   AMENDED IN PLACE Phase 88.6-37 (W34): THE DIVERGENCE IS CLOSED, and the sentence above is
   kept in the past tense rather than rewritten because the measurement it records was true
   when taken. THE PRESENT-TENSE FACT: `Modal.tsx:228` now caps at `max-h-[90dvh]` — plan
   88.6-08 (D-30 / W34) converged it ONTO this unit, and its own `DECISION Phase 88.6-08`
   marker at `Modal.tsx:187-227` names THIS marker's stale sentence and routes the amendment
   to plan 37 at paragraph (e). The pairing is therefore recorded from both sides. The
   consequence for a future reader is unchanged in direction and stronger in force:
   "simplifying" EITHER side back to `vh` now re-opens D-06 and W34 together, and there is no
   longer a divergent sibling to point at as precedent for doing so.

   WHY `dvh` WINS HERE: a sheet is pinned to the BOTTOM edge, which is precisely the edge iOS
   Safari's dynamic toolbar occupies. `vh` resolves against the LARGEST viewport, so a
   `max-h-[70vh]` sheet is 70% of a viewport taller than the one actually visible — its lower
   rows, including anything the person is reaching for, sit under the toolbar. `dvh` tracks the
   live viewport and is what D-06 locks.

   THE DIVERGENCE IS RECORDED, NOT SHIPPED SILENTLY: two viewport-unit idioms inside one
   primitive family is exactly the consistency debt the v2.0 milestone tenets forbid leaving
   unowned. Converging `Modal` onto `dvh` is a durable deferred entry written by plan 88.1-06 —
   it is NOT free (Modal is centred, ~37 call sites, and its cap is a max not a floor), which is
   why it is a scheduled phase and not an inline edit here. "Simplifying" this back to `vh` for
   consistency re-opens D-06. */
const HEIGHT_CLASS: Record<BottomSheetHeight, string> = {
  /** Req 11a (upcoming events): content-sized, capped, body scrolls internally. */
  content: 'max-h-[70dvh]',
  /** Req 11b (calendar list): fixed full-height, body flexes to fill. */
  full: 'h-[85dvh]',
};

export interface BottomSheetProps {
  /** Controlled open state. */
  open: boolean;
  /** Fired when the sheet requests close (Esc, outside tap, close button). */
  onClose: () => void;
  /**
   * The sheet's title. REQUIRED — it renders the {@link DialogTitle} that
   * supplies the accessible name, and Radix requires one. `BottomSheet.test.tsx`
   * asserts the name directly rather than relying on Radix's dev-time warning,
   * which could not be confirmed to fire in the installed production dist
   * (RESEARCH A2), so an omission could otherwise fail silently.
   */
  title: React.ReactNode;
  /** Height preset — see {@link HEIGHT_CLASS}. @default 'content' */
  height?: BottomSheetHeight;
  /**
   * Radix close-autofocus override, matching `Modal.tsx`'s prop of the same
   * name: a caller that wants focus somewhere OTHER than the element that
   * opened the sheet must place it HERE, because Radix moves focus AFTER the
   * sheet unmounts. Supplying this REPLACES the invoker restore documented at
   * {@link BottomSheet} — call `event.preventDefault()` inside it, or Radix's
   * own default (which focuses nothing here) runs instead.
   */
  onCloseAutoFocus?: (event: Event) => void;
  /** Extra classes merged onto the sheet surface. */
  className?: string;
  /** Extra classes merged onto the scrolling body. */
  bodyClassName?: string;
  children?: React.ReactNode;
}

/* DECISION Phase 88.1 (C14, probed live against the installed tailwind-merge@2.6.1): this
   composes `DialogPortal` + `DialogOverlay` + `DialogPrimitive.Content` DIRECTLY, chosen OVER
   the obvious one-liner — wrapping the centred content component `dialog.tsx` exports and
   passing a bottom-anchored `className`. That is what a future tidier will "simplify" this
   into, and it produces a visibly broken sheet.

   WHY IT LOSES, MEASURED: `dialog.tsx:62-66` funnels through `cn` (tailwind-merge). Position
   and `max-w` utilities DO merge — but the `tw-animate-css` animation utilities are not in
   tailwind-merge's default class groups, so the centred wrapper's hardcoded left/top slide and
   scale classes at `dialog.tsx:64` SURVIVE alongside a bottom-slide. The result is a sheet
   that enters from the left, the top and the bottom at once while scaling. `Modal.tsx` never
   hit this because it overrides layout only, never animation direction (`Modal.tsx:163`).

   Collapsing this back onto that wrapper is a decision, not a cleanup — and `BottomSheet.test`
   cannot catch it, because jsdom does not run the animation. */
const BottomSheet = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  BottomSheetProps
>(function BottomSheet(
  {
    open,
    onClose,
    title,
    height = 'content',
    onCloseAutoFocus,
    className,
    bodyClassName,
    children,
  },
  ref
) {
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose]
  );

  /* FOCUS-RESTORE DECISION (Phase 88.1 plan 04, T-88.1-08 / T-87.8-22): the sheet records
     its invoker itself and puts focus back on it, chosen OVER "Radix handles focus restore"
     — which is true for `DialogTrigger` consumers and FALSE for ours.

     VERIFIED IN THE INSTALLED DIST: the modal content's own close-autofocus handler
     (`@radix-ui/react-dialog/dist/index.mjs:148-151`) calls `event.preventDefault()` and then
     `context.triggerRef.current?.focus()`. That preventDefault also cancels FocusScope's
     previously-focused-element restore (`react-focus-scope/dist/index.mjs:93-95`). Both sheet
     consumers open from a plain bottom-bar button, not a `DialogTrigger`, so `triggerRef` is
     null, the optional call is a no-op, and a keyboard user is dropped on `<body>` at the top
     of the document every time the sheet closes.

     `document.activeElement` is captured in the OPEN handler because that fires before
     FocusScope moves focus (`react-focus-scope/dist/index.mjs:74-79`); reading it from an
     effect would return the Close button instead. Deleting this restores the bug silently —
     `Modal.tsx`'s `onCloseAutoFocus` doc records the same Radix behaviour from 87.8. */
  const invokerRef = React.useRef<HTMLElement | null>(null);

  const handleOpenAutoFocus = React.useCallback(() => {
    const active = document.activeElement;
    invokerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      if (onCloseAutoFocus) {
        onCloseAutoFocus(event);
        return;
      }
      const invoker = invokerRef.current;
      invokerRef.current = null;
      // Nothing to restore to (or it has since unmounted): leave Radix's own
      // handler to run rather than fighting it.
      if (!invoker || !invoker.isConnected) return;
      event.preventDefault();
      invoker.focus();
    },
    [onCloseAutoFocus]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          // This Radix build does not emit aria-modal on Content; set it
          // explicitly so the sheet advertises modality to assistive tech
          // (`Modal.tsx:154-159`).
          aria-modal="true"
          // The accessible name comes from the DialogTitle below. No description
          // is required, so opt out of Radix's describedby warning.
          aria-describedby={undefined}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          className={cn(
            // Bottom-anchored, full width, 12px top corners. `border-t` only —
            // the other three edges are flush with the viewport.
            /* DECISION Phase 88.6-37 (D49-b, owner ruling 2026-09-09 option i): the sheet
               panel's alias-spelled `shadow-lg` is snapped to `shadow-theme-lg`. This is a
               VALUE change, not a rename: Tailwind v4 INLINES its built-in shadow scale's
               literal values into the built-in utilities instead of reading the theme
               property (`DECISION Phase 87.7`, `globals.css:1141-1155`), so `.shadow-lg`
               renders Tailwind's cold black default while `.shadow-theme-lg` resolves
               through the project's re-tinted light value and its dark-mode `none`. The hue
               changes in BOTH themes and is disclosed in `88.6-37-SUMMARY.md` for
               `/gsd-ui-review` — `BottomSheet` is a PHONE-PRIMARY surface, so this is the
               shadow change most likely to be seen on the device the app is actually used
               on. NO UI-SPEC §3.4 rule-2 hover pin and no `enabled-hover:`: this is a sheet
               SURFACE, not a `.btn`, and it carries no hover shadow today — adding one
               would be a new interaction, not a snap. Measured before editing: ONE
               `shadow-` occurrence in this file. Reverting to the alias is a decision. */
            'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[12px] border-t border-line bg-surface-card shadow-theme-lg',
            // `duration-200` / `ease-out` feed tw-animate-css's --tw-duration
            // and --tw-ease, which is what its enter/exit keyframes read.
            'duration-200 ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            // Entry: bottom edge only.
            'data-[state=open]:slide-in-from-bottom',
            // Exit: bottom edge only.
            'data-[state=closed]:slide-out-to-bottom',
            HEIGHT_CLASS[height],
            className
          )}
        >
          {/* Header: the 20px/700 heading contract (`Modal.tsx:245`) on the
              body's horizontal scale, plus the close control. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
            <DialogTitle className="text-xl font-bold text-content-primary">
              {title}
            </DialogTitle>
            {/* 44x44 via Button's `icon` size (`Button.tsx:79`) rather than a
                bare glyph — the phone touch-target floor applies to the sheet's
                only chrome control. */}
            <DialogClose asChild>
              <Button variant="ghost" size="icon">
                <X className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          </div>

          {/* Body: the only scrolling region. `min-h-0` is what lets it actually
              shrink inside the flex column instead of overflowing the sheet. */}
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto p-4', bodyClassName)}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
});

export { BottomSheet, HEIGHT_CLASS };
