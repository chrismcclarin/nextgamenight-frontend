'use client';

/**
 * Input / Textarea / SelectControl — the form-control primitives (Req 1, UI-SPEC §8.2).
 *
 * One place that fixes the iOS focus-zoom blocker: every control built from here renders
 * at 16px at every breakpoint, so mobile Safari never zooms the page on tap. Built on the
 * repo's `cn()` + `forwardRef` + `displayName` idiom established by {@link Card} and
 * {@link Banner}; semantic tokens only.
 *
 * HOUSE RULE (88-33 Task 8, fork 5 — owner-ruled 2026-08-17): every form field carries
 * **`id` + `name` + an associated label** (`htmlFor`, a wrapping `<label>`, or
 * `aria-labelledby` to visible text). `aria-label` alone is acceptable ONLY where a
 * visible label genuinely cannot exist. `id`/`name` are required even when an
 * `aria-label` already names the control — the browser autofill heuristic (DevTools
 * "form field should have an id or name attribute") does not read ARIA. Section
 * TITLES over multiple controls are `<span>` + `role="group"`/`aria-labelledby`,
 * never an orphan `<label>` (the 88-21 Participants idiom). 88.6's composed axe
 * audits are the recurrence backstop.
 *
 * What these deliberately do NOT do (the composition contract — `useFetchErrorState.ts`
 * is the model for this section):
 * - **No label.** A visible label is required (UI-SPEC §8.2) but it is `FormField`'s to
 *   render, wired via `htmlFor`.
 * - **No error node, no `aria-invalid`, no `aria-describedby`.** `FormField` owns all
 *   three and injects them onto its single child with `React.cloneElement`. That is why
 *   every export here is a `forwardRef` that spreads `...props` straight onto the DOM
 *   element — a component that swallowed unknown props would silently drop the entire
 *   a11y contract, and nothing downstream would notice.
 * - **No placeholder colour.** The base shim already ships it (globals.css `::placeholder`)
 *   precisely so v4's `color-mix` default does not render near-white in dark mode. Do not
 *   re-declare it here.
 * - **No validation.** `zod` + `react-hook-form` own that; `{...register()}` spreads
 *   through untouched.
 * - **No barrel export.** Import from `@/components/ui/Input`.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

/* DECISION Phase 88-03 (Req 1 / UI-SPEC §8.2): the size is `text-base` UNCONDITIONALLY, with
   NO breakpoint variant of any kind. Chosen OVER the shape a future reader is most likely to
   "refine" this into — a smaller size at phone promoted to 16px at `md:`, i.e. the usual
   "compact on mobile" instinct.

   THAT INSTINCT IS EXACTLY BACKWARDS HERE. Below 16px, mobile Safari focus-zooms the whole
   page when the control is tapped, and `md:` is the breakpoint phones sit BELOW — so a
   breakpoint variant applies the un-zoomable size to desktop and the zooming size to the only
   viewport that suffers from it. This primitive exists for that one reason (Req 1 is the
   phase's red blocker, 87 controls across 25 files).

   Adding a size variant here is a decision that re-opens the blocker, not a refinement. */

/* DECISION Phase 88-03 (UI-SPEC §8.2 + §3.1 + D-36): the geometry mirrors the already-shipped
   `DEFAULT_SELECT_CLASS` (`w-full` + `p-2`) rather than being a geometry-free primitive that
   makes each call site supply its own width and padding. The rejected alternative is the
   purist one — a primitive imposes no layout (that IS how `Card` and `FormField` are built) —
   and it loses here only because ~87 controls adopt this: a geometry-free base turns every one
   of them into a hand-authored re-layout instead of a mechanical swap, and `p-2` is what keeps
   a control inside §3.1's 75px phone padding budget. Callers still override; `cn()` resolves.

   The 44px touch floor is `max-md:min-h-11` — PHONE ONLY, matching D-36's treatment of `.btn`,
   where desktop is deliberately left floorless until the migration sets each height with
   intent. An unconditional `min-h-11` would silently grow every desktop control; that is a
   decision, not a cleanup.

   There is NO `ring-offset-2` here, unlike `Button`. §8.2's Input row specifies the ring
   WITHOUT an offset while §7.2 states the general ring WITH one; the narrower contract wins
   for controls, because an offset ring on a full-width control inside a 12px-padded phone card
   renders into its neighbour. Adding the offset to "make it consistent with Button" is the
   thing this marker exists to stop. */
const controlClass = cn(
  'block w-full p-2 max-md:min-h-11',
  'rounded-btn border border-input bg-surface-input',
  'text-base text-content-primary',
  // §7.2: `focus:outline-hidden` keeps a transparent outline for forced-colors mode
  // (v4's `outline-none` removes it outright). The ring itself is `focus-visible` ONLY —
  // a bare `focus:` variant would also fire on programmatic and pointer focus.
  'focus:outline-hidden focus-visible:border-line-strong',
  'focus-visible:ring-2 focus-visible:ring-focus-ring'
);

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(controlClass, className)}
      {...props}
    />
  )
);

Input.displayName = 'Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(controlClass, className)} {...props} />
  )
);

Textarea.displayName = 'Textarea';

export type SelectControlProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * The bare select-class control. Named `SelectControl`, not `Select`, so it never reads as a
 * peer of the `Controller`-wrapped {@link SelectField} — this renders the element only, the
 * same as `Input`.
 */
const SelectControl = React.forwardRef<HTMLSelectElement, SelectControlProps>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(controlClass, className)} {...props}>
      {children}
    </select>
  )
);

SelectControl.displayName = 'SelectControl';

export { Input, Textarea, SelectControl, controlClass };
