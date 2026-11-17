'use client';

/* DECISION Phase 88.9-39 D5a: one Guest pill + edge module for the upcoming card and the Calendar
   sheet row, chosen OVER a second copy of the pill classes in the sheet. The classes, the title and
   the word are byte-for-byte the pill UpcomingEventsCard shipped (Phase 71.1 GAMP-09, size 12 since
   88.6-28 D-01, tracking-wider since 88.9-47 K7); the edge string is the one the card's guest row painted inline. A VISUAL cue only
   (isGuestEvent decides it; no route, request or permission reads either export).
   AMENDED Phase 88.9-63 (X16 + X17a): sentence case on the amber pill pair, no edge, chosen OVER
   the shipped capitals and light-only amber. The pair is opaque in both themes on purpose: on a
   guest's picture row (no wash since 88.9-60 X23a) this fill is all that sits between the word
   and the photo, and the callers pass no className to change it.
   AMENDED Phase 88.9-63 (X27, owner at N41, 2026-11-12: yes, wrap the whole row): the month tile's
   full dashed outline, chosen OVER the left-only amber-400 edge (1.67 on white, under 3:1); one 1px
   border, a same-width swap for a hairline. Every consumer imports this string. On a photo row (no
   wash since 88.9-60 X23a) the inner side meets the raw photo, which has no fixed ratio; the outer
   side against the card clears 3:1 in both themes and the Guest pill carries the meaning.
   AMENDED Phase 88.9-52 (S-B3, scoped check): "Every consumer imports this string" stopped being
   true when the month tiles took a full-strength dark edge (W14 follow-up 1 and 2). The guest
   edge is now ONE FAMILY IN THIS FILE, two named exports, chosen OVER a second literal living
   in CalendarMonthView.js (a change to "the" guest edge here would have missed both tiles):
     GUEST_ROW_EDGE   the Calendar list row, the Calendar sheet row and the upcoming card. Dark is
                      amber-500 at 70%, the owner-ruled X27 look; a row sits on the CARD, where 70%
                      clears 3:1.
     GUEST_TILE_EDGE  the two month tiles (compact and full). Dark is amber-500 at FULL strength: a
                      tile sits on a DAY CELL, where 70% measured 2.98, under the floor.
   Light is amber-700 in both. They differ on purpose; merging them is a decision, not a cleanup.
   No class value changed in this move. */
import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * The dashed amber outline a guest ROW swaps in for its hairline (D5a, X27): the Calendar list
 * row, the Calendar sheet row and the upcoming card. The month tiles take GUEST_TILE_EDGE below.
 */
export const GUEST_ROW_EDGE = 'border border-dashed border-amber-700 dark:border-amber-500/70';

/* The three markers below moved here from CalendarMonthView.js with the constants (S-B3), word
   for word; "this file" in them meant CalendarMonthView.js, and the constant was a local there.

   DECISION Phase 88.9-52 (W14 follow-up): the COMPACT guest tile's dashed edge is its own literal,
   amber-500 at FULL strength in dark, chosen OVER the full tile's GUEST_ROW_EDGE (70% in dark). At
   70% a blue-tinted compact tile in today's cell (and in a hovered cell, the same dark ground)
   measured 2.98 on its outer side, under the 3.0 floor; at full strength the worst dark arm is
   5.25. Light is the same amber-700 (worst 3.34). REJECTED: changing GUEST_ROW_EDGE (the full
   tile, the sheet row and the upcoming card are owner-ruled, X27); stacking a second dark:border
   class beside the export (two same-weight utilities, the winner is emission order). A whole
   literal because Tailwind emits nothing for a built class name. Measured by
   src/app/components/CalendarMonthView.test.tsx ("W14 (88.9-52): the compact guest tile edge clears 3:1").
   Changing this is a decision, not a cleanup.
   AMENDED Phase 88.9-52 (W14 follow-up 2, a floor): the FULL guest tile takes this literal too, so
   the constant is renamed (was COMPACT_GUEST_EDGE) and this file no longer imports GUEST_ROW_EDGE.
   Same arithmetic, same failure: at 70% a blue-tinted full tile in today's cell or a hovered cell
   measured 2.9844 on its outer side in dark, under 3.0 (WCAG 1.4.11). At full strength the worst
   dark arm of the full tile is 5.2506 (today's cell and the hovered cell), 5.2589 against its own
   fill (green). The 70% was part of the owner-ruled D5a/O18a look; what changed is the dark edge's
   strength on the two month tiles only, chosen OVER leaving a measured 2.98 (the edge is the only
   guest cue a sighted person gets on the grid) and OVER changing GUEST_ROW_EDGE, which the sheet
   row and the upcoming card still use at 70% on the card (their worst arms clear 3.0 in
   src/app/tokenContrast.test.ts ("X27 (88.9) — the guest edge must clear 3:1 on every ground")).
   Light is unchanged. Measured by
   src/app/components/CalendarMonthView.test.tsx ("W14 follow-up (88.9-52): the full guest tile edge clears 3:1"). */
/** The dashed amber outline a guest month TILE carries, compact and full (W14). */
export const GUEST_TILE_EDGE = 'border border-dashed border-amber-700 dark:border-amber-500';

/* DECISION Phase 88.9-52 (S-B1, scoped check): under the pointer a guest month tile turns its
   dashed edge SOLID and keeps full opacity, chosen OVER the 90% fade every other tile uses. The
   fade paints the edge at 90% over the cell: in light, on today's cell, that measured 2.9520,
   under the 3.0 floor (WCAG 1.4.11), for every tint and for the untinted full tile. A solid edge
   is the same colour, so every hovered arm equals its resting arm (worst light 3.34, worst dark
   5.25). REJECTED: hover:opacity-100 alone (a guest tile would be the one tile with no response
   of its own); a 95% fade (3.14, a thin margin for a change nobody can see); a hover shadow (it
   darkens the ground the edge is measured against); stacking hover:opacity-100 beside
   hover:opacity-90 (two same-weight utilities, the winner is emission order). A member tile's
   hover is unchanged. Tailwind limits hover: to pointers that can hover, so a phone sees nothing.
   Measured by
   src/app/components/CalendarMonthView.test.tsx ("S-B1 (88.9-52): a guest tile answers the pointer with a solid edge").
   Not rendered. Changing this is a decision, not a cleanup. */
/** The hover a guest month tile takes instead of the 90% fade (S-B1). */
export const GUEST_TILE_HOVER = 'hover:border-solid';

export interface GuestPillProps {
  className?: string;
}

/** The 12px sentence-case Guest pill, rendered after the time text of a guest row. */
export default function GuestPill({ className }: GuestPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 ml-2 text-xs rounded-sm bg-surface-pill-amber text-content-pill-amber',
        className,
      )}
      title="You joined this event as a guest (not a group member)"
    >
      Guest
    </span>
  );
}
