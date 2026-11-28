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
 * AMENDED Phase 89.6-44 (TC-A): that tag is drawn in the line-tall box now, so its two display
 * classes go to lineClassName (a hidden box hides the tag); className still comes last on the tag.
 *
 * DECISION Phase 89.6-44 (TC-A, tag centring): owner ruling TC-A, 2026-11-27 (asked: 'Shouldn't
 * there be one method for them all?'; ruled 'TC-A' on the measured page): every tag is centred on
 * its line: by the flex row where its holder is flex, and by a line-tall box (PILL_LINE, inText)
 * where it sits in a line of text, chosen OVER align-middle in text (it centres on the lowercase
 * letters: 1.64px below a flex-centred tag on the same Manage Members row, 4.16px at 32px text),
 * OVER making the name line a flex row (a wrapped name's row grew 20 to 24px at normal text), OVER
 * the box on every tag (a line of flex-held tags would grow from 20 to 24px) and OVER a baseline
 * tag on the calendar. A tag in a line of text without inText is a defect. Changing this is a
 * decision, not a cleanup.
 * How the box is built: ref, role, tabIndex, onFocus, data attributes, title and className stay on
 * the tag (the inner span), so every locator and focus path still lands on the tag; the box takes
 * only lineClassName (display classes and margins: a hidden box hides the tag, a margin belongs to
 * the box). Where the browser does not know the lh unit (Safari before 16.4) the two supports
 * classes emit nothing and the box keeps the old placement: aligned on the middle, no height of its
 * own. The classes are whole literals (Tailwind v4 emits nothing for a built one). Pinned by
 * src/components/ui/Pill.test.tsx ("TC-A: with inText one box wraps the tag") and, per mount, by
 * src/app/pillFamily.test.ts ("TC-A (89.6-44): every tag in a line of text is drawn in the line-tall box").
 */
import * as React from 'react';

import { cn } from '@/lib/cn';

export type PillTone = 'green' | 'neutral' | 'violet' | 'blue' | 'amber' | 'emerald';

// The B box as drawn on the pick card: 12px words on a 16px line with 2px above and below, 20px tall.
export const PILL_BOX = 'inline-flex items-center align-middle px-1.5 py-0.5 rounded-sm text-xs leading-4';

// The line-tall box of a tag that sits in a line of text (TC-A, the marker above): one line high,
// on the top of its line, with the tag centred in it. Base classes first (the old placement), then
// the two that apply only where the lh unit is supported.
export const PILL_LINE = 'inline-flex items-center align-middle supports-[height:1lh]:h-[1lh] supports-[height:1lh]:align-top';

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
  /** The tag sits in a line of text: draw it in the line-tall box so it is centred on its line. Not supported with wrap (the wrapping faction tag is held by a flex row). A tag held by a flex or grid row never sets it. */
  inText?: boolean;
  /** Classes for the line-tall box, read only with inText: what belongs to a box (hidden, md:hidden, a margin). */
  lineClassName?: string;
}

const Pill = React.forwardRef<HTMLSpanElement, PillProps>(function Pill({ tone, wrap = false, inText = false, lineClassName, className, ...rest }, ref) {
  // Most callers are untyped JS: an unknown tone reads the neutral pair (own keys only), never a tag with no fill.
  const pair = Object.prototype.hasOwnProperty.call(PILL_TONE, tone) ? PILL_TONE[tone] : PILL_TONE.neutral;
  const tag = <span ref={ref} className={cn(PILL_BOX, 'font-normal', wrap ? 'whitespace-normal max-w-full wrap-break-word' : 'whitespace-nowrap', pair, className)} {...rest} />;
  if (!inText) return tag;
  return <span className={cn(PILL_LINE, lineClassName)}>{tag}</span>;
});

Pill.displayName = 'Pill';

export default Pill;
