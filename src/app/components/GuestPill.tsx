'use client';

/* DECISION Phase 88.9-39 D5a: one Guest pill + edge module for the upcoming card and the Calendar
   sheet row, chosen OVER a second copy of the pill classes in the sheet. The classes, the title and
   the word are byte-for-byte the pill UpcomingEventsCard shipped (Phase 71.1 GAMP-09, size 12 since
   88.6-28 D-01, tracking-wider since 88.9-47 K7); the edge string is the one the card's guest row painted inline. A VISUAL cue only
   (isGuestEvent decides it; no route, request or permission reads either export). */
import * as React from 'react';

import { cn } from '@/lib/cn';

/** The dashed amber left edge a guest row swaps in for its hairline (D5a, R2-27). */
export const GUEST_ROW_EDGE = 'border-l-2 border-dashed border-amber-400 dark:border-amber-500/70';

export interface GuestPillProps {
  className?: string;
}

/** The 12px uppercase Guest pill, rendered after the time text of a guest row. */
export default function GuestPill({ className }: GuestPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 ml-2 text-xs uppercase tracking-wider rounded-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50',
        className,
      )}
      title="You joined this event as a guest (not a group member)"
    >
      Guest
    </span>
  );
}
