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
   side against the card clears 3:1 in both themes and the Guest pill carries the meaning. */
import * as React from 'react';

import { cn } from '@/lib/cn';

/** The dashed amber outline a guest row or tile swaps in for its hairline (D5a, X27). */
export const GUEST_ROW_EDGE = 'border border-dashed border-amber-700 dark:border-amber-500/70';

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
