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
import * as React from 'react';
import { useContext, useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { initialsOf } from '@/components/ui/UserChip';

import ClickableMemberName from './ClickableMemberName';
import { FriendshipContext } from './FriendshipStatusProvider';

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

/* ------------------------------------------------------------------------------------------
 * MemberChipStack — the disclosure
 * ---------------------------------------------------------------------------------------- */

export interface MemberChipStackProps {
  /** The group's members, viewer included — self-exclusion happens here, not at the call site. */
  members?: ChipMember[] | null;
  /** The viewer's own `Users.id` UUID. May be `null` while identity is still resolving. */
  selfUuid?: string | null;
  /** True when the host card carries a group colour or a background photo. */
  tinted?: boolean;
}

/** How many member chips the collapsed stack shows before the `+N` (UI-SPEC 6.5.7). */
const COLLAPSED_LIMIT = 4;

/*
 * DECISION Phase 88.5 (T-88.5-22, UI-SPEC 6.5.2): `relative` is written into the SAME constant
 * as the hit-extension pseudo, chosen OVER declaring the pseudo alone and letting the ambient
 * positioning context supply the anchor.
 *
 * WHY THIS IS A CORRECTNESS BUG AND NOT A STYLE PREFERENCE: `after:absolute` resolves against
 * the nearest POSITIONED ancestor, and `grouplist.js` already carries `relative` on the group
 * card. An un-anchored pseudo therefore stretches the invisible 6px hit target over the ENTIRE
 * card — and because these chips call `stopPropagation`, every tap anywhere on the card would
 * open a member popover instead of navigating to the group. The failure is invisible in jsdom
 * (no layout) and invisible in review (the class string looks fine on its own line), which is
 * why it is one constant and why `MemberChipStack.test.tsx` test 38 reads the source.
 *
 * Shipped precedent: `ClickableMemberName.js:333` pairs `relative` with its own hit-extension
 * pseudo on the same element. Splitting them apart again is a decision, not a cleanup.
 */
const HIT_EXTENSION = "relative after:absolute after:-inset-1.5 after:content-['']";

/*
 * DECISION Phase 88.5 (gate compatibility): the house focus ring is written OUT IN FULL at each
 * of the two controls below, chosen OVER hoisting it into a shared constant the way the
 * hit-extension above is hoisted.
 *
 * WHY, measured: `focusAndMotionTreatment.test.ts` test 2 requires every `active:opacity-75`
 * press site to carry a `focus-visible:` treatment in the SAME `className` expression, and it
 * reads the expression's SOURCE TEXT. A constant reference is opaque to it — planted here
 * first, and the gate red-flagged both controls even though the runtime class list was correct.
 * DRYing these two strings back into a constant is therefore a decision that silently disarms a
 * repo-wide accessibility gate, not a cleanup. Every shipped site inlines it for the same reason.
 */

const memberLabel = (m: ChipMember): string => m.username || m.email || '';

/*
 * DECISION Phase 88.5 (D-15, UI-SPEC section 10 row A-8, WCAG 1.4.1): each expanded chip's
 * ACCESSIBLE NAME states identity plus relationship in words, chosen OVER relying on the ring.
 *
 * D-15 suppresses the inline `✓ Friend` / `⏳ Pending` siblings on chips, which is correct for
 * the sighted layout — but it means the ring, a COLOUR, becomes the only status carrier a
 * sighted user gets, and the initials carry no status at all. WCAG 1.4.1 requires a text
 * carrier, so the name is constructed affirmatively here. Suppressing the indicator does NOT
 * satisfy A-8 on its own; neither the ring colour nor any visible text reaches assistive tech.
 *
 * `unknown` is deliberately absent from this map — it never reaches `ClickableMemberName` (see
 * the inert branch below), so it has no interactive accessible name to construct.
 */
function accessibleName(label: string, status: MemberStatus): string {
  if (status === 'accepted') return `${label}, friend`;
  if (status === 'pending_sent' || status === 'pending_received') {
    return `${label}, friend request pending`;
  }
  return label;
}

/**
 * The collapsed control's accessible name (UI-SPEC section 9). The chips inside it are
 * `aria-hidden` glyphs, so this string is the ONLY thing assistive tech hears — the member
 * names and the overflow both have to live in it.
 */
function collapsedName(labels: string[], overflow: number): string {
  const shown = labels.slice(0, COLLAPSED_LIMIT).join(', ');
  const tail = overflow > 0 ? ` and ${overflow} more` : '';
  return `Members: ${shown}${tail}. Show all members.`;
}

/**
 * The overlapping initials stack. Collapsed it is one tap target; expanded it is a wrapped row
 * of `ClickableMemberName` triggers plus a `Show less` control.
 */
export function MemberChipStack({ members, selfUuid, tinted = false }: MemberChipStackProps) {
  /*
   * The context is read, never re-fetched: `FriendshipStatusProvider` already loads friends,
   * sent and received once per session and every member row in the app reads through it.
   *
   * The `as` narrows the JS module's inferred `getStatus: () => string` to the signature the
   * provider actually implements (`FriendshipStatusProvider.js:96-134`). `checkJs` is off, so
   * the inferred arity comes from the context DEFAULT rather than from the real value.
   */
  const { getStatus } = useContext(FriendshipContext) as {
    getStatus: (userId?: string | null) => MemberStatus;
  };

  const uid = useId();
  const rowId = `${uid}-members`;
  const [expanded, setExpanded] = useState(false);

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const lessRef = useRef<HTMLSpanElement | null>(null);
  const didMount = useRef(false);

  // Focus movement (UI-SPEC section 7): expand -> the first chip trigger; collapse -> the
  // control that was activated. Skipped on mount so a freshly rendered card never steals focus.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (expanded) {
      const first =
        rowRef.current?.querySelector<HTMLElement>('[role="button"]') ?? lessRef.current;
      first?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [expanded]);

  /*
   * DECISION Phase 88.5 (D-13, UI-SPEC 6.5.7): `+N` is derived from the SELF-FILTERED array,
   * chosen OVER carrying the shipped raw-length arithmetic at `grouplist.js:486` verbatim.
   *
   * The shipped form is correct only ON THE PREMISE that the viewer is a member of the list —
   * 4 shown out of `length - 1` non-self members leaves `length - 5`. That premise holds on the
   * home page and nowhere else by guarantee, and it is not stated anywhere at the call site. It
   * also understates by one in a REAL transient window: while `selfUuid` is unresolved the
   * filter excludes nobody, so the list has `length` non-self entries but the count says
   * `length - 5`. Deriving from `nonSelf` removes the premise instead of documenting it, which
   * matters because SPEC Req 6 hands this component forward to two more surfaces where the
   * viewer is not necessarily in the array. Re-introducing the raw-length form is a decision.
   */
  const nonSelf = (members ?? []).filter((m) => m && m.id !== selfUuid);

  // UI-SPEC section 8: a viewer-only group renders NO stack — not an empty container.
  if (nonSelf.length === 0) return null;

  const labels = nonSelf.map(memberLabel);
  const overflow = Math.max(0, nonSelf.length - COLLAPSED_LIMIT);

  /*
   * DECISION Phase 88.5 (RESEARCH Pitfall 6): `stopPropagation` on BOTH the click and the key
   * handler of BOTH span controls is LOAD-BEARING, not defensive. The enclosing card at
   * `grouplist.js:359-370` is itself a `role="button"` with its own Enter/Space handler, so
   * without this a tap on the `+N` chip navigates to the group page instead of expanding, and
   * Enter does the same — the keyboard twin of the tap-stealing bug 87.8 D-13 fixed.
   *
   * Space is `preventDefault`ed because its default on a non-button is PAGE SCROLL. Enter is
   * too, for symmetry with the shipped handler at `ClickableMemberName.js:457-465`.
   *
   * And the keys are handled EXPLICITLY because these are spans: a native `<button>`
   * synthesises a click for Enter and Space, a `role="button"` element synthesises NEITHER. A
   * click-only disclosure would ship green against a click-only test while silently removing
   * today's keyboard path into the friend flow the moment 88.5-09 replaces the always-focusable
   * name-pill row (the 88-28 fix) with this stack.
   */
  const activate = (e: React.MouseEvent | React.KeyboardEvent, next: boolean) => {
    e.stopPropagation();
    setExpanded(next);
  };
  const activateOnKey = (e: React.KeyboardEvent, next: boolean) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    setExpanded(next);
  };

  return (
    <div className="mb-3">
      {!expanded && (
        /*
         * DECISION Phase 88.5 (D-09, UI-SPEC 6.5.1): the collapsed stack is a `role="button"`
         * SPAN, chosen OVER a real `<button>`. It renders inside `grouplist.js`'s own
         * `role="button"` card, so a native button here is the axe `nested-interactive` rule —
         * and there is no axe pin on the home group list today that would catch it. This is the
         * shipped precedent at `ClickableMemberName.js:438-445`, whose marker states the same
         * reason. Converting it to a `<button>` is a decision, not a cleanup.
         */
        <span
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-expanded={false}
          aria-controls={rowId}
          aria-label={collapsedName(labels, overflow)}
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center rounded-full pr-1',
            'active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2'
          )}
          onClick={(e) => activate(e, true)}
          onKeyDown={(e) => activateOnKey(e, true)}
        >
          {nonSelf.slice(0, COLLAPSED_LIMIT).map((m, i) => (
            <MemberChip
              key={m.id ?? `chip-${i}`}
              label={memberLabel(m)}
              status={getStatus(m.id)}
              tinted={tinted}
              separated
              className={i === 0 ? undefined : '-ml-2'}
            />
          ))}
          {overflow > 0 && (
            <MemberChip overflow={overflow} tinted={tinted} separated className="-ml-2" />
          )}
        </span>
      )}

      {/*
        The panel is ALWAYS rendered so `aria-controls` always resolves to a real element; only
        its CHILDREN are conditional, so a collapsed stack mounts no triggers. Pattern copied
        from `CalendarListView.js:522-543`; `rowId` is `useId`-derived so two group cards on the
        same page cannot collide on the same target.

        DECISION Phase 88.5 (UI-SPEC 6.5.2): the row's 12px wrap is load-bearing, not styling.
        Dropping it one step on the spacing scale (to 8px) makes each chip's 6px hit extension
        overlap its neighbour's by 4px per side, which re-opens the exact tap-stealing defect
        87.8 D-13 was written against. 6 + 6 = 12 means an extension terminates EXACTLY at the
        gap. Tightening this row is a decision, not a density tweak.
      */}
      <div
        id={rowId}
        ref={rowRef}
        hidden={!expanded}
        className="flex flex-wrap items-center gap-3"
      >
        {expanded && (
          <>
            {nonSelf.map((m, i) => {
              const label = memberLabel(m);
              const status = getStatus(m.id);

              /*
               * DECISION Phase 88.5 (RESEARCH B-5): an `unknown`-status member gets its OWN
               * inert chip here and is NOT routed through `ClickableMemberName`, chosen OVER
               * rendering the component and letting its early return degrade.
               *
               * `ClickableMemberName` returns bare `children` for `unknown`
               * (`ClickableMemberName.js:157-160`) — no role, no tabIndex, no handler. Routing
               * through it produces the right outcome BY ACCIDENT, and a future reader would
               * reasonably "fix" that into something focusable. REJECTED explicitly:
               * focusable-but-inert, which `keyboardOperability.test.tsx:172` test 5 exists to
               * fail — a dead stop in the tab order is worse than being skipped.
               *
               * A-8 does not apply to this chip (it is not interactive, so it has no
               * interactive accessible name) — but it still needs a NAME. Today's shipped
               * degraded state renders the username as visible text, and an initials-only chip
               * would regress that for assistive tech. So it carries the SAME aria-hidden-glyph
               * plus text-carrier composition as an interactive chip, with no status suffix,
               * because `unknown` asserts no relationship. Dropping the carrier is a decision.
               */
              if (status === 'unknown') {
                return (
                  <span
                    key={m.id ?? `inert-${i}`}
                    className="relative inline-flex items-center justify-center"
                  >
                    <MemberChip label={label} status={status} tinted={tinted} />
                    <span className="sr-only">{label}</span>
                  </span>
                );
              }

              /*
               * DECISION Phase 88.5 (D-15): every chip trigger passes
               * `showInlineIndicator={false}`, so the inline `md:hidden` `✓ Friend` /
               * `⏳ Pending` text and the add-friend `+` button never render in this row —
               * status is carried by the RING for sighted users and by the accessible name
               * above for everyone else, and add-friend lives only in the popover. The two-tap
               * flow on phone is the accepted trade-off (owner ruling). Restoring the inline
               * indicator here would also re-open the hit-extension arithmetic: the `+`'s own
               * 10px extension plus the next chip's 6px is 16px reaching into a 12px gap.
               *
               * The identity+status carrier sits INSIDE the trigger's children, which is where
               * `ClickableMemberName` renders them, so it becomes the trigger's accessible
               * name. Same composition `UserChip.tsx:84-94` uses: an aria-hidden glyph paired
               * with a separate text carrier, rather than an `aria-label` that would have to be
               * kept in sync with the visible content.
               */
              return (
                <ClickableMemberName
                  key={m.id ?? `chip-${i}`}
                  userId={m.id as string}
                  username={label}
                  showInlineIndicator={false}
                >
                  <span className={cn(HIT_EXTENSION, 'inline-flex items-center justify-center')}>
                    <MemberChip label={label} status={status} tinted={tinted} />
                    <span className="sr-only">{accessibleName(label, status)}</span>
                  </span>
                </ClickableMemberName>
              );
            })}

            {/*
              `Show less` is an ADDITION to the ruled mockup (UI-SPEC section 13 Flag 4, still
              open with the owner). A one-way disclosure is a defect on two counts: on a phone
              there is no path back without re-navigating, and a control that unmounts while
              `aria-expanded="true"` leaves assistive tech holding a dangling state. It is one
              `text-xs` word-pair, not a new visual idiom, and it can be dropped in one edit.

              Same span-over-button reasoning and the same hit-extension pairing as above.
            */}
            <span
              ref={lessRef}
              role="button"
              tabIndex={0}
              className={cn(
                HIT_EXTENSION,
                'inline-flex min-h-11 cursor-pointer items-center rounded-xs px-1',
                'text-xs text-content-secondary',
                'active:opacity-75 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2'
              )}
              onClick={(e) => activate(e, false)}
              onKeyDown={(e) => activateOnKey(e, false)}
            >
              Show less
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default MemberChipStack;
