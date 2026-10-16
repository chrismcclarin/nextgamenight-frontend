'use client';

/**
 * BottomSheet — the phone dismiss idiom for Req 11a / 11b (88.1 D-05).
 *
 * A bottom-anchored variant of the shipped Radix dialog, built from the parts
 * `src/components/ui/dialog.tsx` already exports. Radix Dialog supplies the
 * focus trap, `role="dialog"`, Esc-to-close and the `aria-labelledby` wiring
 * from {@link DialogTitle} — none of it is re-implemented here (the "0/16 on axe"
 * sentence in `Modal.tsx`'s docblock records the hand-rolled `.modal-*` fleet
 * before Radix).
 *
 * Focus RESTORE is the one exception: Radix restores to a `DialogTrigger`, and
 * these sheets open from a plain bottom-bar button, so the sheet records its own
 * invoker and puts focus back — see the FOCUS-RESTORE DECISION below. Since
 * Phase 88.6.1-20 that restore is the one `Modal` shares (`restoreDialogFocus`
 * in `dialog.tsx`), and it floors to the page heading when the invoker is gone.
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
 * {@link HEIGHT_CLASS}. ONE consumer ships today (re-read 2026-10-15, plan
 * 88.6.1-20): the Calendar sheet in `UserHomePage.js`, `height="full"`. The
 * `content` preset was written for the upcoming-events sheet (Req 11a) and is
 * kept; removing a preset is a decision, not this file's cleanup.
 *
 * Copy-agnostic: the title and all content are supplied by the consumer.
 * Children render as escaped React nodes — no raw-HTML injection prop is used
 * or accepted anywhere in this file (T-84-03, the escaped-children sentence in
 * `Modal.tsx`'s docblock).
 *
 * What it deliberately does NOT do:
 * - **No gesture dismissal of any kind** (D-05). Dismissal is tap-outside, Esc
 *   and the close button — exactly three paths, all of them keyboard- or
 *   pointer-equivalent, none of them requiring a sustained pointer motion.
 * - **No `dismissable={false}` escape hatch.** `Modal` has one
 *   (`preventNonDismissableClose`) because it hosts in-progress form input; the
 *   sheet's consumer is READ-ONLY (the calendar list; the upcoming-events sheet
 *   it was also written for was read-only too), so there is nothing an accidental
 *   outside-tap could discard. Adding the hatch is a decision that needs a
 *   consumer that would lose data without it.
 * - **No component-level reduced-motion rule.** `globals.css`'s
 *   `@media (prefers-reduced-motion: reduce)` block already caps every animation
 *   duration at 100ms.
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
  handleDialogCloseAutoFocus,
  recordDialogOpener,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

export type BottomSheetHeight = 'content' | 'full';

/* DECISION Phase 88.1 (D-06 / C13): `dvh` chosen OVER `vh`, which WAS the dialog family's
   existing unit — `Modal.tsx:186` (the line number as it stood then, kept as the historical
   measurement) capped at `max-h-[90vh]` and was the known-divergent sibling. This is the
   repo's FIRST `dvh` (`grep -rn 'dvh' src/` returned 0 hits at authoring time).

   AMENDED IN PLACE Phase 88.6-37 (W34): THE DIVERGENCE IS CLOSED, and the sentence above is
   kept in the past tense rather than rewritten because the measurement it records was true
   when taken. THE PRESENT-TENSE FACT: `Modal`'s content class list now caps at
   `max-h-[90dvh]` — plan 88.6-08 (D-30 / W34) converged it ONTO this unit, and its own
   `DECISION Phase 88.6-08 (D-30 / W34)` marker in `Modal.tsx` named THIS marker's stale
   sentence and routed the amendment to plan 37 at its paragraph (e), now marked historical.
   The pairing is therefore recorded from both sides. The consequence for a future reader is
   unchanged in direction and stronger in force:
   "simplifying" EITHER side back to `vh` now re-opens D-06 and W34 together, and there is no
   longer a divergent sibling to point at as precedent for doing so.

   WHY `dvh` WINS HERE: a sheet is pinned to the BOTTOM edge, which is precisely the edge iOS
   Safari's dynamic toolbar occupies. `vh` resolves against the LARGEST viewport, so a
   `max-h-[70vh]` sheet is 70% of a viewport taller than the one actually visible — its lower
   rows, including anything the person is reaching for, sit under the toolbar. `dvh` tracks the
   live viewport and is what D-06 locks.

   AMENDED IN PLACE Phase 88.6.1-20 (W072) — the paragraph that stood here is now history: it
   said, in the present tense, that the divergence was recorded rather than shipped silently,
   that converging `Modal` onto `dvh` was a durable deferred entry written by plan 88.1-06, and
   that the convergence was not free (`Modal` is centred, its cap is a max not a floor, and it
   then had more call sites than this file could edit inline). That convergence has since
   SHIPPED (plan 88.6-08, above), so the deferral it described is closed. `Modal` has 22 mounts
   in 18 files today (`grep -rn -e '^[[:space:]]*<Modal open' -e '^[[:space:]]*<Modal$' src`,
   test and spec files excluded, measured 2026-10-15). "Simplifying" this back to `vh` still
   re-opens D-06. */
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
   * Radix close-autofocus pass-through, matching `Modal.tsx`'s prop of the
   * same name: a caller that wants focus somewhere OTHER than the element that
   * opened the sheet must place it HERE, because Radix moves focus AFTER the
   * sheet unmounts. Since Phase 88.6.1-20 the handler runs FIRST and is
   * COMPOSED with the restore, not substituted for it: call
   * `event.preventDefault()` inside it to place focus yourself; otherwise the
   * invoker restore and the page floor run after it.
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

   WHY IT LOSES, MEASURED: `dialog.tsx`'s `DialogContent` class list funnels through `cn`
   (tailwind-merge). Position and `max-w` utilities DO merge — but the `tw-animate-css`
   animation utilities are not in tailwind-merge's default class groups, so the centred
   wrapper's hardcoded left/top slide and scale classes in `DialogContent`'s base class
   literal SURVIVE alongside a bottom-slide. The result is a sheet that enters from the left,
   the top and the bottom at once while scaling. `Modal.tsx` never
   hit this because it overrides layout only, never animation direction (`Modal`'s content
   class list).

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
     previously-focused-element restore (`react-focus-scope/dist/index.mjs:93-95`). The sheet's
     consumers (one today, re-read 2026-10-15) open from a plain bottom-bar button, not a
     `DialogTrigger`, so `triggerRef` is null, the optional call is a no-op, and a keyboard
     user is dropped on `<body>` at the top of the document every time the sheet closes.

     `document.activeElement` is captured in the OPEN handler because that fires before
     FocusScope moves focus (`react-focus-scope/dist/index.mjs:74-79`); reading it from an
     effect would return the Close button instead. Deleting this restores the bug silently —
     `Modal.tsx`'s `onCloseAutoFocus` doc records the same Radix behaviour from 87.8.

     AMENDED IN PLACE Phase 88.6.1-20 (D-07, N6): the record and the restore are now the SHARED
     `recordDialogOpener` / `restoreDialogFocus` in `components/ui/dialog.tsx` (reached through
     `handleDialogCloseAutoFocus`), the same code `Modal` runs — CHOSEN OVER keeping this twin
     copy, which had drifted from `Modal`'s (it handed the whole close to any consumer handler,
     so a handler that did not prevent default left the user on `<body>`). The restore is
     outcome-checked, acts only when focus is lost, and floors (the still-open dialog's title,
     `main h1`, `main`) when the invoker is gone, disabled or was a sheet that handed off. A
     consumer handler now COMPOSES: it runs first, and only a handler that prevents default
     keeps control. The invoker is still recorded in the open handler, for the reason above. */
  const invokerRef = React.useRef<HTMLElement | null>(null);

  const handleOpenAutoFocus = React.useCallback(() => {
    recordDialogOpener(invokerRef);
  }, []);

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => handleDialogCloseAutoFocus(event, invokerRef, onCloseAutoFocus),
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
          // (the matching `aria-modal` comment in `Modal.tsx`).
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
               property (the `DECISION Phase 87.7 (Plan 06, RESEARCH Pitfall 2)` note under
               `globals.css`'s Shadows heading), so `.shadow-lg`
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
          {/* Header: the 20px/700 heading contract (`Modal.Header`'s title classes) on the
              body's horizontal scale, plus the close control. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
            <DialogTitle className="text-xl font-bold text-content-primary">
              {title}
            </DialogTitle>
            {/* 44x44 via Button's `icon` size (its size map in `Button.tsx`) rather than a
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
