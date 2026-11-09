'use client';

/**
 * Spinner — the house in-flight spinner (plan 88.9-24).
 *
 * A decorative, always aria-hidden span. The busy NAME lives on the control
 * (Button's sr-only suffix), never on the spinner.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

export const SPINNER_CLASS =
  'inline-block animate-spin h-4 w-4 border-2 border-line-strong border-t-transparent rounded-full';

/* DECISION Phase 88.9-24 (owner pick O16a, 88.9-PICKS-B9.json; R2-33 keep-as-shipped): the house
   spinner is ONE typed primitive carrying the byte-identical class string of the three shipped
   copies (src/app/components/RsvpSection.js ("THE BUSY STRING ADDS TO THE NAME, it does not replace it.")),
   chosen OVER a lucide icon or a new look (the owner ratified this spinner on page 3) and OVER
   pasting the span into eight more sites. Always aria-hidden: the busy NAME is the control's
   sr-only suffix, never a label on the spinner. Changing the class string is a look change — a
   decision, not a cleanup. */
const Spinner = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="spinner"
      className={cn(SPINNER_CLASS, className)}
      {...props}
    />
  )
);

Spinner.displayName = 'Spinner';

export { Spinner };
