'use client';

/**
 * Pill: the one little tag beside a name (No reply, Going, Maybe, No, Owner, Admin, Friend, Guest,
 * New Player, a faction, Pending). One span, one box (PILL_BOX), regular weight, one fill-and-ink
 * pair per tone. On the repo's cn + forwardRef + displayName idiom (see Heading and Card). No barrel:
 * import it from '@/components/ui/Pill'.
 *
 * DECISION Phase 89.6-30 (N04): owner pick N04 = B (2026-11-22, 'I feel that they are off, but I'm
 * not well versed enough to say why or for what reason'): one tag block, one 20px box, regular
 * weight (font-normal is set on the block OVER inheriting: a tag inside a semibold name span
 * (See-all, the session chip) or a bold review or winner line would otherwise read 600 or 700),
 * chosen OVER per-site class strings (they drifted 1px apart, FL-03) and OVER 700 (UI-SPEC 88.6
 * §4.5's pill-ink row, overruled by the owner's pick; contrast holds at 400, 5.64 to 7.77).
 * whitespace-nowrap is added to the drawn box OVER the bare box because a two-word tag folded
 * mid-phrase when it was not nowrap
 * (src/app/gameDetail/page.js ("is a D-01 FOLD MITIGATION, not decoration")); wrap is the opt-in
 * for free text (the faction) OVER nowrap, which would push a long faction past the page edge at
 * 320 / 200%. Changing this is a decision, not a cleanup.
 *
 * The tone pairs are the X17a pairs, each a WHOLE literal, fill class then ink class, never built
 * from the tone name: Tailwind v4 emits nothing for an interpolated class. They are pinned at the
 * class layer by src/app/pillFamily.test.ts ("the shared tag block") and at the token layer by
 * src/app/tokenContrast.test.ts ("X17a (88.9): six pill families resolve to the picked pairs").
 *
 * A caller's className comes last, so tailwind-merge lets it replace the box's display: the See-all
 * row's desktop Friend passes hidden md:inline-flex and the box's own display is dropped.
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

export type PillTone = 'green' | 'neutral' | 'violet' | 'blue' | 'amber' | 'emerald';

// The B box as drawn on the pick card: 12px words on a 16px line with 2px above and below, 20px tall.
export const PILL_BOX = 'inline-flex items-center align-middle px-1.5 py-0.5 rounded-sm text-xs leading-4';

const PILL_TONE: Record<PillTone, string> = {
  green: 'bg-surface-pill-green text-content-pill-green',
  neutral: 'bg-surface-pill-neutral text-content-pill-neutral',
  violet: 'bg-surface-pill-violet text-content-pill-violet',
  blue: 'bg-surface-pill-blue text-content-pill-blue',
  amber: 'bg-surface-pill-amber text-content-pill-amber',
  emerald: 'bg-surface-pill-emerald text-content-pill-emerald',
};

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Which fill-and-ink pair the tag paints from. */
  tone: PillTone;
  /** Free text (a faction): the tag may wrap by whole words and is held to its container. Fixed words never set it. */
  wrap?: boolean;
}

const Pill = React.forwardRef<HTMLSpanElement, PillProps>(function Pill({ tone, wrap = false, className, ...rest }, ref) {
  // Most callers are untyped JS: an unknown tone reads the neutral pair (own keys only), never a tag with no fill.
  const pair = Object.prototype.hasOwnProperty.call(PILL_TONE, tone) ? PILL_TONE[tone] : PILL_TONE.neutral;
  return <span ref={ref} className={cn(PILL_BOX, 'font-normal', wrap ? 'whitespace-normal max-w-full wrap-break-word' : 'whitespace-nowrap', pair, className)} {...rest} />;
});

Pill.displayName = 'Pill';

export default Pill;
