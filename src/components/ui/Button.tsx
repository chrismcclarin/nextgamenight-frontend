'use client';

/**
 * Button — the one button primitive (PRIM-01 / D-01 elevation, D-02 variants).
 *
 * Five variants (`primary` / `secondary` / `danger` / `ghost` / `accent`) and
 * three sizes (`default` / `icon` / `sm`), on the repo's `cva` + `cn()` +
 * `forwardRef` + `displayName` idiom established by {@link Banner}. Names are
 * deliberately aligned with `Modal.tsx`'s `ModalActionVariant` so the later
 * adoption plans are a mechanical swap, not a rename.
 *
 * What it deliberately does NOT do:
 * - **No hover scale/translate.** Forbidden by the design reference; elevation
 *   is the only hover affordance.
 * - **No press rule of its own.** `.btn:active:not(:disabled) { opacity: .75 }`
 *   already ships it, untransitioned on purpose (87.8 D-12) — adding an opacity
 *   transition here would swallow it on an ~80ms tap.
 * - **No `disabled` styling.** `.btn:disabled` already ships opacity/cursor.
 * - **No widening of the phone-only `.btn` CLASS rule.** The 44px floor this
 *   primitive carries is `min-h-11` on the cva BASE, at every viewport width
 *   (88.6 D-09). The `@media (width < 48rem)` rule on the `.btn` class
 *   (`globals.css:2677-2681`) is left exactly as it is, and an all-viewport
 *   floor on that class stays REJECTED (88-01 D-36, reasoning at
 *   `globals.css:2647-2676`): square-by-design controls wear `.btn`, so a
 *   class-level floor deforms them, while a floor on the PRIMITIVE reaches only
 *   elements that opted in by being a `Button`. See the `DECISION Phase
 *   88.6-06 (D-09)` marker on the base entry below.
 * - **No `compact` rung** (88.6 D-10). It would convert a closed two-site
 *   exemption (`BrowseMoreModal.js:232`, `:270`) into an open sub-44 API
 *   affordance, and would silently add the base's elevation pair to two 32px
 *   squares.
 * - **No size utility of any kind on a size rung.** `text-*`, `px-*`, `py-*`
 *   and `p-*` are DEAD on a `.btn` element: `.btn` declares `font-size`
 *   (`globals.css:2201`) and `padding` (`:2202`) UNLAYERED, and an unlayered
 *   author rule beats every `@layer utilities` rule. The compact horizontal
 *   padding comes from the unlayered `.btn-sm` rule (`globals.css:2722-2725`).
 * - **No bare `hover:` token** in the base or the variant map. A gated control
 *   must not lift or wash, so every hover here goes through the `enabled-hover`
 *   custom variant (`globals.css:177-183`), which is hover-capability-scoped
 *   and excludes both `:disabled` and `[aria-disabled="true"]`.
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
    // The hover half is `enabled-hover:`-gated (88.6 D10) — reasoning is in the
    // `DECISION Phase 88.6-06 (D10)` note below the ring line, kept there so it
    // does not widen the anchor-to-ring distance `cascadeOrder.test.ts` bounds.
    'shadow-theme-sm enabled-hover:shadow-theme-md',
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
    /* DECISION Phase 88.6-06 (D10): the hover elevation above, and the ghost
       variant's hover wash below, are expressed through the `enabled-hover`
       custom variant (`globals.css:177-183`) — chosen OVER the bare `hover:`
       they used to carry.

       WHY. The four legacy rules
       `.btn-*:hover:not(:disabled):not([aria-disabled='true'])`
       (`globals.css:2383`, `:2483`, `:2633`, `:2643`) deliberately withhold the
       hover fill from a gated control. A bare `hover:` in this base re-lifted
       exactly those controls, so a disabled button still rose under the pointer
       and read as pressable. `enabled-hover` is hover-capability-scoped and
       excludes BOTH `:disabled` and `[aria-disabled="true"]`, so the resting
       elevation is untouched and only the hover half is gated.

       ONE VARIANT ON BOTH SIDES, not two spellings: UI-SPEC §3.4 rule 2 requires
       a call site that pins its own elevation to write
       `shadow-theme-lg enabled-hover:shadow-theme-lg`. A bare `hover:` on the
       pin side is REJECTED because `tailwind-merge` would not see it as
       conflicting with this base token and both would survive.

       RETIRED WITH IT: the ghost variant's `aria-disabled:hover:bg-transparent`
       override, which is now redundant — it only ever reached the ARIA half,
       while a natively-`disabled` ghost still washed.

       This placement is deliberate: the marker sits AFTER the ring line so it
       does not widen the anchor-to-ring distance `cascadeOrder.test.ts`'s
       `RingSite.window` (3000) bounds — `withoutComments` blanks comments in
       place rather than deleting them, so comment bytes count. */
    /* DECISION Phase 88.6-06 (D-09): the 44px touch floor lives HERE, on the cva
       BASE, at every viewport width — chosen OVER widening the phone-only
       `@media (width < 48rem)` rule on the `.btn` CLASS
       (`globals.css:2677-2681`), which is left untouched.

       WHY THIS KEEPS D-36 LITERALLY TRUE. D-36 (`globals.css:2647-2676`)
       rejects an all-viewport `min-height` on the `.btn` CLASS, because
       square-by-design controls wear `.btn` — the two `w-8 h-8` player-count
       steppers at `BrowseMoreModal.js:232` and `:270` would be stretched into
       32x44 lozenges. A floor on the PRIMITIVE reaches only elements that opted
       in by being a `Button`, so that rejection stays literally true and the
       eight per-CTA floor markers stay valid.

       THERE IS NO CALL-SITE OPT-OUT BELOW 48rem, and that is a fact rather than
       an oversight: `.btn` is unlayered, so the phone floor beats ANY
       `@layer utilities` `min-h-*` a caller passes. The sentences recording
       this are `globals.css:2666-2674` (re-derived 2026-09-15; plan 06's text
       cites `:2350-2363`, a range that predates plan 05's edits). A call-site
       `min-h-0` is therefore DESKTOP-ONLY — and plan 12's AC-2 desktop arm
       flags it as a violation, so it is not a quiet escape hatch either.
       `.btn-compact` is not a path: it is unlayered at ALL widths, it also
       zeroes horizontal padding (`globals.css:2766-2767`), and it is scoped by
       construction to those same two shipped sites.

       ANY SUB-44 `Button` IS A PHASE 88.9 DECISION, not a cleanup — see the
       `DECISION Phase 88.6-06 (C.1 / D-09)` marker in the size map below. */
    'min-h-11',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        danger: 'btn-danger',
        // 88.6 D-09: the amber CTA family. Emits the CLASS, never the amber as
        // utilities — `.btn-accent` (globals.css:2478-2481) already paints it
        // over `--color-btn-accent-bg` / `--color-btn-accent-text`, and a second
        // inline expression of that value is what the 88.3-18 marker
        // (globals.css:2389) exists to prevent. Byte-equal to the inline style
        // plan 21 retires: `--color-btn-accent-bg` is `var(--amber-700)` in both
        // themes (globals.css:1390, :1827) and `--color-btn-accent-text` is
        // `#ffffff` in both (:1392, :1829) — white on amber-700 = 5.0216:1.
        accent: 'btn-accent',
        // No legacy class exists for ghost, and `.btn` sets no background,
        // so utilities are the correct tool here.
        // Hover gating, added 2026-09-05 (code review #37) as
        // `aria-disabled:hover:bg-transparent`, REPLACED 88.6-06 by the single
        // `enabled-hover:` variant: the DECISION block in globals.css claims the
        // `:not(:disabled)` hover rules were narrowed for gated controls, but
        // ghost's hover is a Tailwind UTILITY and sits outside that CSS
        // entirely — so a gated ghost Resend still lit up on hover and read as
        // pressable. The comment was true of the legacy `.btn-*` classes and
        // false of this one. The old override only ever reached the ARIA half,
        // so a NATIVELY-disabled ghost still washed; `enabled-hover`
        // (globals.css:177-183) excludes both states at once and makes the
        // override redundant. See the `DECISION Phase 88.6-06 (D10)` marker in
        // the cva base.
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
          'bg-transparent text-content-secondary enabled-hover:bg-surface-hover aria-disabled:text-content-muted',
      },
      /* DECISION Phase 88.6-06 (C.1 / D-09): three choices are recorded here,
         each with the alternative it was chosen over.

         (1) THE DEAD ZERO-PADDING UTILITY ON `icon` IS DELETED — chosen OVER
         authoring an unlayered `.btn-icon { padding: 0 }` beside `.btn-sm`. The
         same mechanism would work, but it narrows every icon button by 32px
         (`.btn` is `padding: .5rem 1rem`, i.e. 16px a side, `globals.css:2202`),
         which is a LOOK CHANGE and therefore Phase 88.9's, not this phase's
         (P6). What ships today, and what is being PRESERVED rather than
         overlooked: `size="icon"` renders at least 44x44 but wears `.btn`'s
         8px/16px padding, i.e. a LOZENGE, not a square. It was never zeroed —
         the utility had been dead since the day it was written, because `.btn`
         is unlayered and `@layer utilities` always loses (`globals.css:2205`,
         restated at `:2668-2671`). Deleting it changes no rendered pixel.
         (The retired class is described rather than quoted: plan 06's
         acceptance gate greps this whole FILE for that literal, comments
         included, so writing it here would red a correct tree.)

         (2) `min-h-11` LIVES ON THE cva BASE — chosen OVER widening the
         `@media (width < 48rem)` rule on the `.btn` class. D-36's reasoning is
         at `globals.css:2647-2676`; the full argument is on the base entry
         above.

         (3) THE `sm` RUNG IS HEIGHT-FLOORED AT 44px (from the base) AND
         DELIBERATELY NOT FLOORED IN WIDTH. It is a wide-text row-action rung —
         the rule all eight 87.8 floor markers record as "No `min-w-11`: wide
         text button". Its adopters are CAPPED AT TWO by UI-SPEC §3.3
         (`88.6-UI-SPEC.md:239` — `gameDetail/page.js:198` GuestInviteButton and
         `:1979` the two-tap Remove, "the only two"), so a third `sm` consumer
         is a decision rather than a cleanup, and a `sm` rung on a PRIMARY CTA
         is a Phase 88.9 decision, not this phase's. */
      size: {
        default: '',
        // D-02's "legitimate 44x44 home" for bare icon buttons, delivered once
        // here instead of invented per call site.
        icon: 'min-h-11 min-w-11',
        // 88.6 D-09, the compact row-action rung. `btn-sm` ONLY: the compact
        // horizontal padding comes from the unlayered `.btn-sm` rule
        // (globals.css:2722-2725), and every padding or font-size utility that
        // could be written here is dead under `.btn` (globals.css:2201-2202).
        // The `sm` label is 14px FORCED, not chosen.
        sm: 'btn-sm',
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
