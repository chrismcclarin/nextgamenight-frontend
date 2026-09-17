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

/* DECISION Phase 88.6-30 (W53 / SPEC R6, owner ruling AC-17 2026-09-09): the native
   date/time normalisation is ATTRIBUTE-GATED — every class of it, not only the shrink.
   CHOSEN OVER adding `appearance-none` / `min-w-0` unconditionally to `controlClass`.

   W53 is the owner's own report (iPhone, light mode, 2026-08-28): `<Input type="date">`
   runs past its cell on the Game Sessions filter card, because iOS Safari's native
   date control keeps its INTRINSIC width and `w-full` cannot shrink it. The fix belongs
   here and not at the page (SPEC R6) — a page fix leaves every other date input broken.

   WHY GATED. `controlClass` is shared geometry. RE-MEASURED 2026-09-17 at this commit:
   `grep -rnE "<(Input|Textarea|SelectControl)\b" src` = 104 usages, 75 outside test files,
   across 23 files. (The plan carried 86/69/24 from 2026-09-14; the population moved during
   waves 8-9. The number that did NOT move is the one the danger turns on: `<SelectControl`
   is 19 non-test sites, exactly as measured then.) The dangerous half is the appearance
   reset, not the shrink: this class declares NO `background-image`, so an UNCONDITIONAL
   `appearance-none` would strip the UA dropdown indicator from all 19 of those sites with
   nothing replacing it — and NOTHING in this repo could see it (jsdom performs no layout,
   `touch-targets.spec.ts` measures named CTA locators, and the W53 phone spec measures the
   date control only). Gated, the other ~73 usages are untouched BY CONSTRUCTION, which is
   stronger than any assertion.

   WHY THE WHOLE date/time FAMILY and not `type=date` alone: the siblings share the iOS
   intrinsic-sizing root cause, and a `type="time"` PAIR sits DIRECTLY ABOVE a `type="date"`
   pair on one screen of the profile's recurring-availability section —
   `userProfile/page.js:2517`/`:2527` (time) immediately above `:2539`/`:2548` (date), with a
   second time pair at `:2654`/`:2664` beside the date at `:2644`. CITES RE-DERIVED
   2026-09-17: the plan's `:2228`/`:2238`/`:2250`/`:2259` are stale by ~290 lines and none of
   them lands on a control any more. Family census, re-measured the same day and excluding
   prose hits: 13 date/time controls in non-test source — 5 `date` (`userProfile` x3,
   `gameDetail` x2) and 8 `time`/`datetime-local` — not the plan's 15. No non-test control
   usage OUTSIDE that family carries those types, so widening the list costs the
   by-construction guarantee nothing. Their iOS behaviour is UNPROVEN-broken, not measured —
   no engine on this project reproduces it.

   THE SET IS MINIMAL, AND WAS MINIMISED BY TESTING. A third member — start-aligning the
   value pseudo-element — was REJECTED on evidence, not taste: Tailwind's own preflight
   already ships `::-webkit-date-and-time-value { text-align: inherit }`
   (`node_modules/tailwindcss/preflight.css:324-327`, comment: "Ensure text alignment can
   be changed on date/time inputs in iOS Safari"), so a
   `[…::-webkit-date-and-time-value]:text-left` would be a no-op dressed as a fix.

   `text-base` is NOT touched — 16px is the iOS-zoom floor (UI-SPEC §4.1) and shrinking
   the type to make the box fit is the wrong fix. Neither are the focus rules above.

   These are the repo's FIRST arbitrary variants (`grep -rn '\[&' src` -> 0 before this
   plan), so `Input.test.tsx` compiles them with the project's own Tailwind and asserts a
   real, SCOPED rule is emitted — a never-emitted rule would otherwise be green on every
   class-string gate. Making any of this unconditional is a decision, not a cleanup. */
const DATE_TIME_CONTROL = '[&:is([type=date],[type=time],[type=datetime-local])]';

const controlClass = cn(
  'block w-full p-2 max-md:min-h-11',
  'rounded-btn border border-input bg-surface-input',
  'text-base text-content-primary',
  // W53: release the UA intrinsic sizing, then remove the intrinsic minimum width so
  // `w-full` can actually shrink the box inside a narrow grid cell.
  `${DATE_TIME_CONTROL}:appearance-none`,
  `${DATE_TIME_CONTROL}:min-w-0`,
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
