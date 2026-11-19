import * as React from 'react';

import { cn } from '@/lib/cn';

/* DECISION Phase 88.9-67 (X69 width): a gated control reserves the widest of its countdown and
   post-wait labels as aria-hidden pseudo-element text in one grid cell, chosen OVER text-node
   sizers (the 88.6-17 x shape), which enter textContent and every toHaveText. Changing this is a
   decision, not a cleanup.

   HOW IT HOLDS THE WIDTH: the root is a one-cell inline grid. Each reserve string gets an EMPTY
   span placed in that cell whose before pseudo-element paints the string from its data-reserve
   attribute, invisibly; the visible label sits in the same cell. The cell is as wide as its widest
   occupant, so the control keeps one width while its label changes. Pseudo-element content is not
   in the DOM: textContent, innerText and the accessible name are the visible label alone.

   WHAT IT DOES NOT SET: weight, colour or wrapping. A reserve span inherits the weight its host
   paints at, so it measures what the visible label measures. A host whose reserved label paints
   at another weight than the host does at that moment passes it through reserveClassName (the
   Profile collection x reserves its armed 600 at rest, DECISION Phase 88.6-17 (D-03 / T-88.6-41)).

   AMENDED Phase 88.9-52 (R13): one more optional occupant, reserveTrailing: a string plus trailing
   room, for a label that gains an element after its word (the kebab item's busy spinner). It is the
   same kind of empty span, painted from its own attribute (data-reserve-trailing) so every reader
   of data-reserve still sees the label strings alone, and it does NOT take reserveClassName: it
   measures the label at the weight the host paints it with that element beside it.
   AMENDED Phase 88.9-52 (G2, round 4): a host whose OWN weight changes with its state names that
   weight in reserveTrailing.className, because an occupant with no weight class inherits the
   host's weight of the moment and the cell follows it (the kebab item is bold while armed and
   its busy reserve is font-normal: src/app/components/KebabMenu.js ("className: 'pr-6 font-normal'")). */

export interface ReservedLabelProps {
  /** The visible label. */
  children: React.ReactNode;
  /**
   * Every string whose width the label must hold. An empty list reserves nothing, and the label
   * renders in the same wrapper, so a control's markup does not change shape when it arms.
   */
  reserve: readonly string[];
  /** Whole-literal classes for every reserve span, for example the weight the reserved label paints at. */
  reserveClassName?: string;
  /**
   * One more width to hold: `text` followed by the room `className` adds (whole-literal padding
   * classes), for a label that gains a trailing element. Omitted, nothing more is reserved.
   */
  reserveTrailing?: { text: string; className: string };
  /** Whole-literal classes joined after inline-grid on the root span. */
  className?: string;
}

export function ReservedLabel({ children, reserve, reserveClassName, reserveTrailing, className }: ReservedLabelProps) {
  return (
    <span className={cn('inline-grid', className)}>
      {reserve.map((text, index) => (
        <span
          key={`${index}:${text}`}
          aria-hidden="true"
          data-reserve={text}
          className={cn('invisible col-start-1 row-start-1 before:content-[attr(data-reserve)]', reserveClassName)}
        />
      ))}
      {reserveTrailing ? (
        <span
          aria-hidden="true"
          data-reserve-trailing={reserveTrailing.text}
          className={cn(
            'invisible col-start-1 row-start-1 before:content-[attr(data-reserve-trailing)]',
            reserveTrailing.className
          )}
        />
      ) : null}
      <span className="col-start-1 row-start-1">{children}</span>
    </span>
  );
}

ReservedLabel.displayName = 'ReservedLabel';
