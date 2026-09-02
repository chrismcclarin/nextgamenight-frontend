'use client';

/**
 * UpcomingCountPill — the amber count pill for "upcoming games this week"
 * (SPEC Req 2 / UI-SPEC §6.1, phase 88.5).
 *
 * ONE implementation, rendered at TWO use sites from ONE count: on the home
 * page's Calendar button (plan 88.5-07) and beside the sheet's "This week"
 * subheader (plan 88.5-08). It renders chrome, not content — the number it
 * shows comes from `selectUpcomingWithin7Days`, the same selector that decides
 * which rows the sheet lists, so the two can never disagree.
 *
 * This component owns the LOOK and the render/no-render rule. It does NOT own
 * the count: the host computes it, and the host announces it (the pill itself
 * is `aria-hidden` — see the render below).
 */
import * as React from 'react';

export interface UpcomingCountPillProps {
  /**
   * The count to show, or `null` for SUPPRESSED.
   *
   * `null` and `0` are NOT the same thing and must not be folded together
   * (carried from the phone bottom bar deleted in plan 88.5-07; the code is in git history
   * at 88.1 plan 08, and this component is now the owner of the rule):
   *   - `0`    — "we counted, and there are none". The host control still says
   *              so in its accessible name; only the visual dot is suppressed.
   *   - `null` — "we are not making a count claim at all", because identity is
   *              still resolving or the events fetch is pending/errored. The
   *              host control drops the count clause from its name entirely.
   * Both render nothing here, which is exactly why the distinction erodes. See
   * the SUPPRESSION half of the DECISION marker below.
   */
  count: number | null;
  /**
   * Positioning for the call site (the two use sites sit in different flows).
   * APPENDED to the contract classes, never a replacement for them.
   */
  className?: string;
}

/* DECISION Phase 88.5 (SPEC Req 2 / D-01, D-02, D-03-as-amended) — the pill's colour is
   FORKED BY THEME at this use site, and that fork is a ruling, not a duplicate.

   CHOSEN: one component, rendered at both use sites, carrying both arms —
     light  amber-700 fill (`--color-btn-accent-bg`) + white ink (`--color-btn-accent-text`)
     dark   amber-500 fill (`--amber-500`, globals.css:592) + warm-900 ink (`--warm-900`, :643)
   expressed as arbitrary-value token references with a `dark:` variant (the shipped idiom at
   `grouplist.js:612`). Owner ruling 2026-08-31, UI-SPEC §6.1.3 / §13 Flag 1.

   REJECTED (a) — RELAXING SPEC Req 2's ACCEPTANCE. The UI-SPEC draft proposed re-deriving the
   criterion to "ink-on-fill >= 4.5 only", with the four ground ratios merely recorded, on the
   grounds that no shipped amber cleared 3:1 in both themes. This was PUT TO THE OWNER AND
   DECLINED, 2026-08-31: "we made that acceptance for a reason." The 3:1 line is a deliberate
   legibility floor for an indicator that the amended one-anchor rule (UI-SPEC §5.3) exempts
   from the accent budget PRECISELY BECAUSE it is small and non-interactive — a pill that is
   hard to see against its own button collects the exemption without delivering the signal that
   justifies it. Keeping a single theme-equal amber-700 arm is what that relaxation would have
   bought, and it measures 2.2456:1 on the dark button fill (purple-800) and 2.7578:1 on the
   dark sheet card (purple-900). Re-unifying the two arms is a DECISION, not a cleanup.

   REJECTED (b) — MINTING A NEW AMBER TOKEN. `--amber-500` already ships and already MEANS amber
   in dark: it is `--color-accent` (:1552), `--color-status-warning-text`/`-border`
   (:1629/:1631), and the hero eyebrow's dark value. The dark pill JOINS the dark theme's
   existing amber rather than introducing a second one. `new_colour_tokens` for this phase is 0
   and `globals.css` is not edited by this plan.

   REJECTED (c) — PUTTING `.btn-accent` ON THE SPAN. It would work for the light arm (the rule
   only sets background-color + color, globals.css:2036-2039), and it is rejected for two
   INDEPENDENT reasons, either of which is sufficient:
     (i)  a `.btn-*` class on a non-button pre-empts Phase 88.6's `.btn`/border-model sweep,
          which 88.5-CONTEXT says this phase must not pre-empt;
     (ii) the `--color-btn-accent-*` family is theme-EQUAL BY DESIGN and pinned byte-equal
          across themes by `tokenContrast.test.ts` test 45, so it could not express this fork
          at all without changing the colour of every accent button in the app.

   REJECTED (d) — A CORNER BADGE (D-01). On a wide text button a corner badge floats in dead
   space away from the word it counts. The pill sits ADJACENT to the label instead, with no
   `ml-auto` (UI-SPEC §6.1.2).

   MEASURED, and DELIBERATELY NOT ASSERTED ANYWHERE (UI-SPEC §12 item 6) — recorded here so the
   numbers survive. `tokenContrast.test.ts` tests 51-52 pin the six ratios that ARE floors; these
   four are context, not gates, and a future re-tint that moves them will red nothing:
     - button HOVER fill: amber-700 vs warm-300 = 3.1475:1 (light);
                          amber-500 vs purple-700 = 3.6294:1 (dark). Both still clear 3:1 —
                          the worst case in the whole table.
     - the PAGE, as a reference ground the pill never actually sits on:
                          amber-700 vs warm-200 = 3.8463:1 (light);
                          amber-500 vs purple-950 = 7.8736:1 (dark).
   For completeness: white ink on amber-500 is 2.1477:1, an AA failure — which is WHY the ink
   forks with the fill rather than staying white.

   ------------------------------------------------------------------------------------------
   SUPPRESSION — carried history. This reasoning is inherited VERBATIM IN SUBSTANCE from
   the phone bottom bar's `DECISION Phase 88.1 (Req 11a, carrying DECISION Phase 88-33 forward)`
   block, because that file is DELETED in plan 88.5-07 and the reasoning must not die with it.
   Plan 88.5-07 owns the record of the SURFACE reversal; this marker owns the SUPPRESSION rule.

   While the events load is PENDING, or while either the identity or the events error state is
   active, the host makes NO count claim at all — `count={null}` here, and an accessible name
   with no "{n} upcoming games this week" clause. `UserHomePage.js:99-115` records why:
   `upcomingLoading` starts false and the fetch effect early-returns before it ever flips, so
   for the whole identity-resolution window the page holds `events=[]` that means "not fetched
   yet", NOT "nothing scheduled". Rendering that as a confident zero is the exact lie 88-33
   fixed on `UpcomingEventsCard` — a few hundred ms normally, up to ~60s with the backend
   unreachable. Collapsing the `null` branch below into a plain `count > 0` check restores that
   bug and changes NOTHING observable until the backend is slow. That is a decision, not a
   simplification. */
const UpcomingCountPill = React.forwardRef<HTMLSpanElement, UpcomingCountPillProps>(
  function UpcomingCountPill({ count, className }, ref) {
    // Two separate reasons, one outcome. See the SUPPRESSION block above.
    if (count === null) return null; // suppressed — no claim is being made
    if (count === 0) return null; // counted, and it is none — the host says so in its name

    return (
      <span
        ref={ref}
        // The number is already in the HOST control's accessible name
        // (UI-SPEC §6.1.5: "Calendar, 3 upcoming games this week"), so the pill
        // is decorative to assistive tech. Announcing it twice is noise — the
        // shipped precedent is the phone bottom bar's own pill (88.1 plan 08, deleted 88.5-07).
        aria-hidden="true"
        className={[
          'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5',
          'text-xs font-semibold leading-none tabular-nums',
          '[background-color:var(--color-btn-accent-bg)] [color:var(--color-btn-accent-text)]',
          'dark:[background-color:var(--amber-500)]',
          'dark:[color:var(--warm-900)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {count}
      </span>
    );
  }
);

export { UpcomingCountPill };
export default UpcomingCountPill;
