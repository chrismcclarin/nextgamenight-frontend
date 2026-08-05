'use client';

/**
 * Tabs — the one tab-strip primitive (Req 5, UI-SPEC §8.4).
 *
 * A thin wrapper over `@radix-ui/react-tabs`. As with {@link Switch}, the ARIA is
 * the point: Radix emits `role="tablist"` / `role="tab"` + `aria-selected` /
 * `role="tabpanel"`, wires `aria-controls`/`aria-labelledby` between them, and
 * ships the roving tabindex (arrow keys move between triggers, Tab moves out of
 * the strip and into the panel). The shipped availability strip in
 * `userProfile/page.js` emits none of that. This file authors no ARIA of its own.
 *
 * **Name the strip.** Radix cannot infer one — pass `aria-label` (or
 * `aria-labelledby`) to `TabsList` when the strip is not already introduced by an
 * adjacent heading.
 *
 * @example
 * <Tabs defaultValue="recurring">
 *   <TabsList aria-label="Availability settings">
 *     <TabsTrigger value="recurring">Schedules</TabsTrigger>
 *     <TabsTrigger value="specific">Specific Dates</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="recurring">…</TabsContent>
 *   <TabsContent value="specific">…</TabsContent>
 * </Tabs>
 */
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/cn';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // §8.4: the strip SCROLLS at 375px, it does not wrap. Wrapping a tab strip
      // turns a one-line control into a two-line block that reflows the page under
      // the user's thumb; `overflow-x-auto` keeps the row height stable. Adding a
      // wrap utility here is a decision, not a cleanup (the class name is
      // deliberately unwritten so the phase's no-wrap grep gate cannot match this
      // comment).
      'flex overflow-x-auto border-b border-line',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

/* DECISION Phase 88-07 (UI-SPEC §8.4): the active trigger is distinguished by COLOUR plus a
   2px accent underline at font-weight 400 — chosen OVER the near-universal tab idiom of
   bumping the active label to 600/semibold, which is what a future reader will most likely
   "restore". Two reasons it loses here: (1) §4.2 makes 600 Button-only in this phase's type
   contract, and (2) a weight change re-measures the label, so every sibling trigger shifts a
   few pixels on every selection — the strip visibly jiggles, and at phone width where the
   strip already scrolls, that can move the tab you are aiming at out from under your thumb.
   `font-normal` is written EXPLICITLY (rather than left to inherit) so the intent is visible
   at the site and a weight bump has to overwrite something. The paired test pins it. */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `min-h-11` is the phone touch floor (D-36); `shrink-0` + `whitespace-nowrap`
      // are what make the list scroll instead of squeezing the labels.
      'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap',
      'px-4 text-sm font-normal',
      // -1px pulls the underline onto the list's own bottom border instead of
      // stacking a second line beneath it.
      '-mb-px border-b-2 border-transparent',
      'text-content-secondary hover:text-content-primary',
      'transition-colors duration-200 ease-out',
      'data-[state=active]:border-line-accent data-[state=active]:text-content-primary',
      // §7.2: `focus-visible` only; `outline-hidden` keeps the transparent outline
      // forced-colors mode needs (v4's `outline-none` removes it outright).
      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    // Radix gives the panel `tabIndex={0}` so keyboard users can reach content that
    // holds no focusable child — which means it can receive focus and therefore needs
    // a ring of its own.
    className={cn(
      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
