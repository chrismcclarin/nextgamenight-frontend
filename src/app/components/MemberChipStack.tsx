'use client';

/**
 * MemberChipStack — the overlapping member-initials stack on home group cards (SPEC Req 5).
 *
 * Replaces the member NAME-PILL row at `grouplist.js:477-489`. Collapsed it is one tap target
 * showing up to four 32px initial circles plus a `+N`; expanded it is a wrapped row of
 * `ClickableMemberName` triggers that open the shipped friend popover.
 *
 * DECISION Phase 88.5 (SPEC Req 6): this is a COMPONENT rather than JSX inside `grouplist.js`,
 * chosen OVER inlining the markup at the one call site it currently has. Two more surfaces —
 * the `groupHomePage` member list and the event participant rows — are already named for
 * conversion in `deferred/phase-88.6.md`, and this phase's acceptance requires both of them to
 * stay BYTE-unchanged in the diff. Inlining would guarantee the next surface forks it.
 *
 * All class strings come from UI-SPEC 6.5.1-6.5.7; the interaction wrapper copies the shipped
 * nested-interactive idiom (`ClickableMemberName.js`) and disclosure idiom
 * (`CalendarListView.js`). Nothing here is invented styling.
 */
import { cn } from '@/lib/cn';
import { initialsOf } from '@/components/ui/UserChip';

/** The exact set `FriendshipStatusProvider.getStatus` can return. */
export type MemberStatus =
  | 'accepted'
  | 'pending_sent'
  | 'pending_received'
  | 'none'
  | 'self'
  | 'unknown';

/** A member as the group payload delivers it. Tolerant of the app's varied user shapes. */
export interface ChipMember {
  id?: string | null;
  username?: string | null;
  email?: string | null;
}

export interface MemberChipProps {
  /** The label initials are derived from — `member.username || member.email`. */
  label?: string | null;
  status?: MemberStatus;
  /** True when the host card carries a group colour or a background photo. */
  tinted?: boolean;
  /** True for a chip inside the COLLAPSED overlapping stack (draws the cut-out ring). */
  separated?: boolean;
  /** When set, renders the `+N` overflow variant instead of initials. */
  overflow?: number;
  className?: string;
}

/* ------------------------------------------------------------------------------------------
 * Chip class strings (UI-SPEC 6.5.1 / 6.5.4 / 6.5.5)
 * ---------------------------------------------------------------------------------------- */

const CHIP_BASE =
  'inline-flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold';

/*
 * DECISION Phase 88.5 (D-11, UI-SPEC 6.5.4): on a TINTED or photo card the chip swaps to a
 * white wash with a neutral hairline and the card's OWN ink, chosen OVER keeping the neutral
 * arm everywhere. WHY, measured: the neutral fill reads 1.11:1 against the blue preset tint —
 * an invisible chip. The wash echoes the shipped Manage Members light-arm treatment
 * (`groupHomePage/page.js`, `bg-white/80 ring-1 ring-line-control dark:ring-0`) with two
 * deliberate deltas: /85 not /80 (the ruled mockup's value; 10.37 vs 10.19 on the ink —
 * indistinguishable), and a neutral hairline instead of `ring-line-control`, which is
 * transparent in dark and is a CONTROL token being borrowed for a non-control.
 *
 * REJECTED: the mockup's per-preset `rgba(preset-ink, .35)` hairline. It measures 1.95:1 to
 * this one's 1.83:1 — statistically the same edge — and needs a derived colour plus a new CSS
 * variable for no visible gain.
 *
 * The ink rides the SHIPPED fallback chain (`grouplist.js:612`), not a fresh one: on photo
 * cards `groupInkVars` returns `{}`, so the group-ink property is absent and the card's own
 * computed text colour behind it takes over. Both halves fork in the CSS cascade rather than
 * through `useTheme` — same reason as the shipped marker at `EventScheduler.tsx`.
 *
 * NOTE for the tint gate: `bg-white/85` and `ring-black/25` are RAW PALETTE, not project
 * semantic tokens, so `tintTreatment.test.ts`'s `parseAlphaToken(token, semantic)` detector
 * does not fire on them. Verified 2026-09-01 against the 68 `--color-*` keys in the
 * `@theme inline` block: neither `white` nor `black` is among them.
 */
const TINTED_FILL = 'bg-white/85 ring-1 ring-black/25';
const TINTED_INK =
  '[color:var(--group-ink-l,var(--t-color-l))] dark:[color:var(--group-ink,var(--t-color))]';

const NEUTRAL_FILL = 'bg-surface-card-hover';

/*
 * DECISION Phase 88.5 (D-12, D-12b, UI-SPEC 6.5.5): the status cue is an `outline`, chosen
 * OVER `ring-*` and OVER `border-2`.
 *   - `ring-*` in Tailwind is a BOX-SHADOW. It emits no dashed variant at all, so the pending
 *     cue below could not exist in that form.
 *   - `border-2` on a fixed `h-8 w-8` chip changes the content box AND fights the cut-out
 *     separation ring, which is a real ring.
 *   - `outline` is layout-neutral and stacks cleanly on top of a ring.
 *
 * THE DASH IS LOAD-BEARING, NOT STYLING. Solid green and solid amber measure 1.04:1 apart in
 * light and 1.06:1 in dark — luminance-identical — so under red-green CVD two solid rings are
 * ONE ring. Dash-vs-solid is the non-hue differentiator. Solid amber WAS offered to the owner
 * and was rejected on exactly that number. A future "let's make the two rings consistent" is a
 * DECISION, not a cleanup, and `MemberChipStack.test.tsx` test 7 exists to fail it.
 *
 * Both cues are written ONCE as constants rather than per-status map entries, so the file
 * carries exactly one instance of each utility and the phase's greps can count them.
 */
const FRIEND_CUE = 'outline-2 -outline-offset-2 outline-status-success';
const PENDING_CUE = 'outline-2 outline-dashed -outline-offset-2 outline-status-warning';

function ringCue(status: MemberStatus): string {
  if (status === 'accepted') return FRIEND_CUE;
  if (status === 'pending_sent' || status === 'pending_received') return PENDING_CUE;
  // `none`, `self` and `unknown` get NOTHING. `unknown` is a real state, not a default:
  // rendering no cue is the ABSENCE of a claim, whereas coercing it to `none` would assert
  // "not a friend" on data that has not loaded. Chip-level twin of D-03's count suppression.
  return '';
}

/**
 * One 32px circle. Purely presentational and ALWAYS `aria-hidden` — identity reaches assistive
 * tech through a separate text carrier at the call site, exactly as `UserChip.tsx:84-94` pairs
 * its aria-hidden initials glyph with a visible name span. Both fill arms and all three ring
 * states live here and only here, so the collapsed stack and the expanded row cannot drift.
 */
export function MemberChip({
  label,
  status = 'none',
  tinted = false,
  separated = false,
  overflow,
  className,
}: MemberChipProps) {
  const isOverflow = typeof overflow === 'number';

  /*
   * DECISION Phase 88.5 (UI-SPEC 6.5.1 vs 6.5.4): the cut-out separation ring is NEUTRAL-ARM
   * ONLY, chosen OVER applying it on every collapsed chip. `ring-surface-card` paints the
   * card's own ground so the overlap reads as a cut-out; on a TINTED card the ground is the
   * group colour, so that same ring would draw a stray white outline around every chip. The
   * tinted arm's hairline already does the separating. Dropping this gate is a decision.
   */
  const separation = separated && !tinted ? 'ring-2 ring-surface-card' : '';

  const neutralInk = isOverflow ? 'text-content-muted' : 'text-content-secondary';

  return (
    <span
      aria-hidden="true"
      className={cn(
        CHIP_BASE,
        tinted ? `${TINTED_FILL} ${TINTED_INK}` : `${NEUTRAL_FILL} ${neutralInk}`,
        separation,
        ringCue(status),
        className
      )}
    >
      {isOverflow ? `+${overflow}` : initialsOf(label)}
    </span>
  );
}

export default MemberChip;
