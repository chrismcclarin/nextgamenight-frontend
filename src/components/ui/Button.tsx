'use client';

/**
 * Button — the one button primitive (PRIM-01 / D-01 elevation, D-02 variants).
 *
 * Four variants (`primary` / `secondary` / `danger` / `ghost`) and two sizes
 * (`default` / `icon`), on the repo's `cva` + `cn()` + `forwardRef` +
 * `displayName` idiom established by {@link Banner}. Names are deliberately
 * aligned with `Modal.tsx`'s `ModalActionVariant` so the later adoption plans
 * are a mechanical swap, not a rename.
 *
 * What it deliberately does NOT do:
 * - **No hover scale/translate.** Forbidden by the design reference; elevation
 *   is the only hover affordance.
 * - **No press rule of its own.** `.btn:active:not(:disabled) { opacity: .75 }`
 *   already ships it, untransitioned on purpose (87.8 D-12) — adding an opacity
 *   transition here would swallow it on an ~80ms tap.
 * - **No `disabled` styling.** `.btn:disabled` already ships opacity/cursor.
 * - **No min-height on the `default` size.** `.btn` carries the 44px floor at
 *   PHONE widths only (88-01 D-36); desktop stays deliberately floorless until
 *   the migration sets each height with intent.
 * - **No raw palette classes** — semantic tokens only inside `src/components/ui/`.
 * - **No barrel export.** There is no `src/components/ui/index.ts` and this
 *   phase does not add one; import from `@/components/ui/Button`.
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

/* DECISION Phase 88-02 (D-01/D-02): Button COMPOSES the legacy `.btn` class rather than
   re-emitting its properties as Tailwind utilities. Chosen OVER a pure-utility base
   (`inline-flex items-center gap-2 rounded-btn text-sm font-semibold px-4 py-2 ...` with no
   `.btn`), which is the obvious shadcn-shaped alternative and is the thing a future reader is
   most likely to "clean up" this into.

   WHY THE PURE-UTILITY VERSION LOSES, measured: `.btn` is authored UNLAYERED in globals.css
   (`:950`), and an unlayered rule beats anything Tailwind emits inside `@layer utilities`. A
   utility base would therefore be OVERRIDDEN by `.btn` wherever the two disagree — and the
   repo already has 8 shipped markers recording exactly this failure, compact `.btn` rows whose
   `text-xs px-3 py-1` utilities are dead on arrival. Dropping `.btn` entirely instead is not
   free either: `.btn` is what carries the phone 44px floor (88-01 D-36), the untransitioned
   press (87.8 D-12) and the disabled rule, all of which would silently vanish.

   WHY THE ADDITIONS BELOW ARE STILL SAFE AS UTILITIES: `.btn` declares NO background, NO
   box-shadow, NO min-height and NO outline (verified against globals.css:950-962), so the
   elevation, the focus ring, the ghost background and the icon-size floor have nothing
   unlayered to lose to. That is the whole reason the split falls where it does.

   Replacing `.btn` here with utilities is a DECISION (and requires layering `.btn` first),
   not a cleanup. */
const buttonVariants = cva(
  [
    'btn',
    // D-01's only real drift from the shipped resting look: rest -> hover elevation.
    // In dark this renders as a hairline ring appearing on hover (the dark
    // `--shadow-*` values are rings, globals.css:601) — intended, not a bug.
    'shadow-theme-sm hover:shadow-theme-md',
    // §7.2 ring. `focus:outline-hidden` keeps a transparent outline for forced-colors
    // mode instead of `outline-none`, which removes it outright.
    /* DECISION Phase 88.6-05 (A-2): THIS LINE IS THE FOCUS RING'S ONE HOME for the whole
       `.btn` family. Owner ruling 2026-09-15, ARM A.

       REJECTED — ARM B: one global `.btn:focus-visible { outline: 2px solid var(--ring) }`
       rule in globals.css, with these three utilities and the nine per-site ring strings
       deleted. It is what the record named (88.6-CONTEXT D-09 and `88.6-SPEC.md` R2 both say
       "ONE global `.btn:focus-visible` rule replaces the per-site strings"), and it was
       rejected on the merits with the record amended through plan 46's amendment table
       (row 14) — classified BOOKKEEPING: nothing breaks if it is not honoured and its whole
       cost is one SPEC line.

       WHY ARM A WON. After this phase every `.btn` element is a `Button` except the two
       `BrowseMoreModal` exemption steppers, so a global CSS rule would be a SECOND expression
       of one decision — and if it were ever added WITHOUT deleting these utilities, two
       independent rings would paint, because a CSS `outline` and a Tailwind `ring-*`
       box-shadow are different properties and neither suppresses the other. Expressing it
       here also keeps it inside the primitive, where `cn()`'s last-wins lets a call site
       override it; an unlayered global rule cannot be overridden per call site at all.

       ROUTED, not ignored: the two `BrowseMoreModal` steppers (`BrowseMoreModal.js:232`,
       `:270`) carry no focus string of their own, so under ARM A they stay on the browser
       default outline (no AA violation — the UA outline satisfies WCAG 2.4.7; the gap is
       consistency) until plan 32 gives them the house string in its `ring-inset` form, per
       the owner's AC-10 ruling of 2026-09-09.

       GATED: `src/app/cascadeOrder.test.ts` asserts exactly ONE of the two mechanisms exists
       — both-present and both-absent each red — over a CLOSED, ENUMERATED list of ten
       `.btn`-family ring holders on comment-stripped source. Deleting this line, or adding
       the global rule beside it, is a decision, not a cleanup. */
    'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        danger: 'btn-danger',
        // No legacy class exists for ghost, and `.btn` sets no background,
        // so utilities are the correct tool here.
        // `aria-disabled:hover:` narrowing added 2026-09-05 (code review #37): the
        // DECISION block in globals.css claims the `:not(:disabled)` hover rules
        // were narrowed for gated controls, but ghost's hover is a Tailwind
        // UTILITY and sits outside that CSS entirely — so a gated ghost Resend
        // still lit up on hover and read as pressable. The comment was true of
        // the legacy `.btn-*` classes and false of this one.
        // `aria-disabled:text-content-muted` added 2026-09-05 (code review round 2
        // HIGH-A): the gated state is COLOUR, not element opacity, for every
        // variant. primary/secondary get theirs from `.btn-*[aria-disabled]` rules
        // in globals.css; ghost has no legacy class, so its gated ink lives here.
        // ALIVE, not dead: `.btn` declares no `color`, so no unlayered rule can
        // beat this utility (a gated `bg-*` utility WOULD be dead — see the
        // `.btn[aria-disabled]` marker). Its ground is the card; Gate A test 53
        // pins `--color-text-muted` on `--color-bg-card` in both themes and scans
        // this string.
        ghost:
          'bg-transparent text-content-secondary hover:bg-surface-hover aria-disabled:hover:bg-transparent aria-disabled:text-content-muted',
      },
      size: {
        default: '',
        // D-02's "legitimate 44x44 home" for bare icon buttons, delivered once
        // here instead of invented per call site.
        icon: 'min-h-11 min-w-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the single child element instead of a `<button>` (Radix Slot). */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant, size, asChild = false, className, type = 'button', ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        // `type` is meaningless (and invalid) on a slotted <a>/<Link>.
        {...(asChild ? {} : { type })}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
